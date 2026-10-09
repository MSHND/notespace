"use strict";

// P349xr — DORMANT, SYNTHETIC-only single-principal publish-receipt model.
// No production import, real confirmation ceremony, DB transaction or grants.
// The trusted confirmOwner callback MUST later be backed by an independently
// authenticated owner-presence action, never by an OAuth scope or caller flag.
const { createHash, randomBytes } = require("node:crypto");
const { createHandoverReleaseSafetyStore } =
  require("./pocket-handover-release-safety-store.js");

const digest = text => createHash("sha256").update(text, "utf8").digest("hex");
const isObject = v => !!v && typeof v === "object" && !Array.isArray(v);
const TTL_MS = 60_000;
const PROOF_FIELDS = Object.freeze([
  "ownerId", "resourceId", "principalId", "releaseId", "expectedRevision", "digest",
]);
const CONFIRM_FIELDS = Object.freeze([...PROOF_FIELDS, "challenge", "confirmed"]);
const equalFields = (left, right, keys) =>
  keys.every(key => left?.[key] === right?.[key]);
const fingerprint = proof => JSON.stringify(PROOF_FIELDS.map(key => proof[key]));

function denied(reason) {
  const e = new Error("Synthetic single-principal publish receipt denied.");
  e.code = "handover-single-principal-denied";
  e.reason = reason;
  throw e;
}
function stageBinding(binding) {
  if (!isObject(binding)
      || !["ownerId", "resourceId", "principalId"].every(
        key => typeof binding[key] === "string" && binding[key].length > 0)
      || !Array.isArray(binding.capabilities)
      || !binding.capabilities.includes("stage")
      || binding.capabilities.includes("publish")) denied("stage-owner-unverified");
  return binding;
}
function sameOwner(left, right) {
  return ["ownerId", "resourceId", "principalId"].every(k => left[k] === right[k]);
}

function createSinglePrincipalPublishReceiptModel({
  resolvePrincipal, confirmOwner, pool, nowMs = Date.now,
} = {}) {
  if (typeof resolvePrincipal !== "function" || typeof confirmOwner !== "function"
      || !pool || typeof pool.query !== "function" || typeof nowMs !== "function") {
    denied("trusted-dependencies-missing");
  }
  // Object-identity-only authority: no caller-provided approval, receipt ID,
  // publish role or document text can impersonate the private scoped auth.
  const sessions = new WeakMap();
  const scopedAuth = new WeakMap();
  const claimedIntents = new Map();
  const audit = [];

  const record = (event, status) => { audit.push(Object.freeze({ event, status })); };
  const validIntent = ({ auth, releaseId, content, expectedRevision }) => {
    if (!isObject(auth) || !Object.isFrozen(auth)
        || typeof releaseId !== "string" || !/^r[0-9]{1,18}$/.test(releaseId)
        || typeof content !== "string" || content.length === 0
        || !Number.isSafeInteger(expectedRevision) || expectedRevision < 0
        || expectedRevision >= Number.MAX_SAFE_INTEGER) denied("intent-invalid");
  };
  async function requireOwner(auth, original = null) {
    let current;
    try { current = stageBinding(await resolvePrincipal(auth)); }
    catch (_error) { denied("stage-owner-unverified"); }
    if (original && !sameOwner(current, original)) denied("owner-changed");
    return current;
  }
  const store = createHandoverReleaseSafetyStore({
    pool,
    async resolvePrincipal(auth) {
      const scoped = isObject(auth) ? scopedAuth.get(auth) : null;
      if (!scoped) return resolvePrincipal(auth);
      const { realAuth, receipt } = scoped;
      if (receipt.status !== "attempting" || nowMs() >= receipt.expiresAtMs) {
        denied("receipt-not-active");
      }
      const current = await requireOwner(realAuth, receipt.proof);
      // The short-lived capability exists ONLY for this private, unforgeable
      // auth object, never on original authInfo or the stored one-role policy.
      return Object.freeze({
        ...current, capabilities: Object.freeze(["read", "publish"]),
      });
    },
    async verifyPublisherApproval(proof) {
      // Synchronous claim BEFORE returning an approval (no await). A second
      // invocation with the same proof MUST fail before pointer SQL.
      const receipt = claimedIntents.get(fingerprint(proof));
      if (!receipt || receipt.status !== "attempting"
          || nowMs() >= receipt.expiresAtMs
          || !equalFields(proof, receipt.proof, PROOF_FIELDS)) return null;
      receipt.status = "consumed";
      record("redeem", "consumed");
      return Object.freeze({ ...receipt.proof,
        approved: true, revoked: false, oneAttempt: true });
    },
  });

  async function stage({ auth, releaseId, name, kind, content } = {}) {
    await requireOwner(auth);
    return store.createEntry({ auth, releaseId, name, kind, content });
  }
  async function confirm({ auth, releaseId, content, expectedRevision } = {}) {
    validIntent({ auth, releaseId, content, expectedRevision });
    if (sessions.has(auth)) denied("confirmation-already-started");
    // Reserve before any await: two concurrent confirmation attempts cannot
    // mint multiple receipts from the same authenticated session.
    const receipt = { status: "confirming" };
    sessions.set(auth, receipt);
    try {
      const b = await requireOwner(auth);
      const proof = Object.freeze({
        ownerId: b.ownerId, resourceId: b.resourceId, principalId: b.principalId,
        releaseId, expectedRevision, digest: digest(content),
      });
      const key = fingerprint(proof);
      if (claimedIntents.has(key)) denied("intent-already-used");
      const challenge = randomBytes(32).toString("hex");
      const request = Object.freeze({ ...proof, challenge });
      // This is a deliberately distinct TRUSTED confirmation channel, not a
      // user-supplied boolean in the publish call or generic OAuth bearer.
      const confirmation = await confirmOwner(request);
      if (!isObject(confirmation)
          || Object.keys(confirmation).sort().join(",") !== CONFIRM_FIELDS.slice().sort().join(",")
          || confirmation.confirmed !== true || confirmation.challenge !== challenge
          || !equalFields(confirmation, proof, PROOF_FIELDS)) denied("explicit-confirmation-missing");
      const expiresAtMs = nowMs() + TTL_MS;
      if (!Number.isSafeInteger(expiresAtMs)) denied("expiry-invalid");
      receipt.proof = proof;
      receipt.expiresAtMs = expiresAtMs;
      receipt.status = "approved";
      claimedIntents.set(key, receipt);
      record("confirm", "approved");
      return Object.freeze({ confirmed: true, expiresAtMs });
    } catch (_error) {
      receipt.status = "denied";
      record("confirm", "denied");
      denied("confirmation-denied");
    }
  }
  async function cancel({ auth } = {}) {
    const receipt = isObject(auth) ? sessions.get(auth) : null;
    if (!receipt || receipt.status !== "approved") denied("receipt-not-cancellable");
    receipt.status = "cancelled";
    record("cancel", "cancelled");
    return Object.freeze({ cancelled: true });
  }
  async function publish({ auth, releaseId, content, expectedRevision } = {}) {
    validIntent({ auth, releaseId, content, expectedRevision });
    const receipt = sessions.get(auth);
    if (!receipt || receipt.status !== "approved") denied("receipt-absent-or-used");
    const expected = receipt.proof;
    if (!equalFields({ releaseId, expectedRevision, digest: digest(content) },
        expected, ["releaseId", "expectedRevision", "digest"])) denied("receipt-intent-mismatch");
    if (nowMs() >= receipt.expiresAtMs) {
      receipt.status = "expired";
      record("publish", "expired");
      denied("receipt-expired");
    }
    // Single-attempt lock acquired BEFORE first await, independent of SQL.
    receipt.status = "attempting";
    try {
      await requireOwner(auth, expected);
      const scoped = Object.freeze({});
      scopedAuth.set(scoped, { realAuth: auth, receipt });
      const result = await store.publishPointer({
        auth: scoped, releaseId, content, expectedRevision,
      });
      receipt.status = "settled";
      record("publish", result.ok ? "published-synthetic" : result.reason);
      return result;
    } catch (_error) {
      receipt.status = "settled";
      record("publish", "denied-or-ambiguous");
      denied("publish-denied-no-retry");
    }
  }
  return Object.freeze({
    stage, confirm, cancel, publish,
    audit: () => Object.freeze([...audit]),
  });
}

module.exports = Object.freeze({ createSinglePrincipalPublishReceiptModel });
