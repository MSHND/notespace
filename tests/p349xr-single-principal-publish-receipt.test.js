"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { createProjectDocumentsTokenVerifier } =
  require("../sync-service/pocket-project-documents-auth.js");
const { createHandoverVerifiedSubjectBinding } =
  require("../sync-service/pocket-handover-verified-subject-binding.js");
const { createSinglePrincipalPublishReceiptModel } =
  require("../sync-service/pocket-handover-single-principal-receipt.js");
const { SQL } = require("../sync-service/pocket-handover-release-safety-store.js");
const { NAMES } = require("../sync-service/pocket-handover-release-witness.js");

const config = Object.freeze({
  issuer: "https://issuer.synthetic.test/",
  audience: "synthetic-project-documents",
  resourceUrl: "https://pocket.synthetic.test/project-docs/mcp",
  jwksUrl: "https://issuer.synthetic.test/keys",
});
const scopes = "openid pocket.project-documents.read pocket.project-documents.write";
const payload = (subject = "user-murray") => ({
  iss: config.issuer, sub: subject, aud: config.audience,
  client_id: "shared-chatgpt-client", exp: Math.floor(Date.now() / 1000) + 300,
  scope: scopes,
});
const row = (subject = "user-murray", owner = "owner-murray", role = "stager") => ({
  issuer: config.issuer, subject, audience: config.audience,
  resourceUrl: config.resourceUrl, ownerId: owner, resourceId: "handover",
  principalId: owner + "-principal", role,
  capabilities: role === "stager" ? ["read", "stage"]
    : role === "publisher" ? ["read", "publish"] : ["read"],
  approved: true, ownerApproved: true, revoked: false,
  expiresAtMs: Date.now() + 300000,
});
const manifest = (releaseId = "r1") => JSON.stringify({
  releaseId, authorityEpoch: "GOOGLE_ONLY",
  documents: NAMES.map(name => ({
    name, releaseId, digest: "a".repeat(64),
  })),
});
function fixture({ confirm = "approve", resultError = false, approvalGate = null } = {}) {
  let clock = Date.now(), current = payload(), confirmation = confirm, uncertain = resultError;
  let policy = { version: 1, approved: true, revoked: false,
    bindings: [row(), row("user-other", "owner-other")] };
  const bridge = createHandoverVerifiedSubjectBinding({
    async readApprovedPolicy() { return policy; },
  });
  const verifier = createProjectDocumentsTokenVerifier({
    config, async verifyJwt() { return current; },
    verifiedSubjectObserver: bridge.verifiedSubjectObserver,
  });
  const sqlCalls = [], entries = new Map(), pointers = new Map();
  const key = (...parts) => JSON.stringify(parts);
  const pool = { async query(sql, values) {
    sqlCalls.push({ sql, values });
    if (uncertain && (sql === SQL.createPointer || sql === SQL.updatePointer)) {
      throw Error("synthetic ambiguous storage error");
    }
    if (sql === SQL.createEntry) {
      const k = key(values[0], values[1], values[2], values[3]);
      if (entries.has(k)) return { rowCount: 0, rows: [] };
      const r = {
        owner_id: values[0], resource_id: values[1],
        release_id: values[2], name: values[3], kind: values[4],
        content: values[5], sha256: values[6], revision: 1,
      };
      entries.set(k, r); return { rowCount: 1, rows: [r] };
    }
    if (sql === SQL.createPointer || sql === SQL.updatePointer) {
      const k = key(values[0], values[1]), prev = pointers.get(k);
      if (sql === SQL.createPointer && prev
          || sql === SQL.updatePointer && (!prev || prev.revision !== values[4])) {
        return { rowCount: 0, rows: [] };
      }
      const r = {
        owner_id: values[0], resource_id: values[1], release_id: values[2],
        content: values[3], revision: prev ? prev.revision + 1 : 1,
      };
      pointers.set(k, r); return { rowCount: 1, rows: [r] };
    }
    if (sql === SQL.readPointer) {
      const r = pointers.get(key(values[0], values[1]));
      return { rowCount: r ? 1 : 0, rows: r ? [r] : [] };
    }
    throw Error("unexpected SQL");
  }};
  const confirmations = [];
  const model = createSinglePrincipalPublishReceiptModel({
    pool, resolvePrincipal: bridge.resolvePrincipal, nowMs: () => clock,
    async confirmOwner(request) {
      confirmations.push(request);
      if (approvalGate) await approvalGate();
      if (confirmation === "none") return null;
      if (confirmation === "wrong") return { ...request,
        confirmed: true, digest: "b".repeat(64) };
      if (confirmation === "wrong-principal") return { ...request,
        confirmed: true, principalId: "different-principal" };
      return { ...request, confirmed: true };
    },
  });
  const auth = async p => { current = p; return verifier.verifyAccessToken("synthetic-bearer"); };
  const stage = a => model.stage({ auth: a, releaseId: "r1",
    name: "pocket.start-here", kind: "document", content: "synthetic staging" });
  const confirmPublish = (a, releaseId = "r1", bytes = manifest(releaseId),
    expectedRevision = 0) => model.confirm({
      auth: a, releaseId, content: bytes, expectedRevision,
    });
  const publish = (a, releaseId = "r1", bytes = manifest(releaseId),
    expectedRevision = 0) => model.publish({
      auth: a, releaseId, content: bytes, expectedRevision,
    });
  return {
    model, auth, stage, confirmPublish, publish,
    calls: () => sqlCalls, confirmations: () => confirmations,
    getPolicy: () => structuredClone(policy), setPolicy: p => { policy = p; },
    tick: n => { clock += n; }, setConfirmation: v => { confirmation = v; },
    setUncertain: v => { uncertain = v; },
    pointer: () => pointers.get(key("owner-murray", "handover")),
    setPointerRevision: rev => {
      const k = key("owner-murray", "handover");
      pointers.set(k, {
        owner_id: "owner-murray", resource_id: "handover",
        release_id: "r0", content: manifest("r0"), revision: rev,
      });
    },
  };
}
async function denied(action, reason = undefined) {
  await assert.rejects(action, e =>
    e?.code === "handover-single-principal-denied"
      && (reason === undefined || e.reason === reason));
}
function pointerWrites(f) {
  return f.calls().filter(x => x.sql === SQL.createPointer || x.sql === SQL.updatePointer);
}

test("P349xr single verified subject stages, then separately confirms and publishes exactly once", async () => {
  const f = fixture(), a = await f.auth(payload());
  assert.equal((await f.stage(a)).ok, true);
  assert.equal(pointerWrites(f).length, 0);
  await denied(() => f.publish(a), "receipt-absent-or-used");
  assert.equal(pointerWrites(f).length, 0);
  const result = await f.confirmPublish(a);
  assert.equal(result.confirmed, true);
  assert.equal(f.confirmations().length, 1);
  assert.equal(f.confirmations()[0].ownerId, "owner-murray");
  assert.equal(f.confirmations()[0].principalId, "owner-murray-principal");
  assert.equal((await f.publish(a)).ok, true);
  assert.equal(f.pointer().revision, 1);
  assert.equal(pointerWrites(f).length, 1);
  await denied(() => f.publish(a), "receipt-absent-or-used");
  assert.equal(pointerWrites(f).length, 1);
  assert.deepEqual(f.model.audit().map(x => x.status),
    ["approved", "consumed", "published-synthetic"]);
});
test("P349xr confirmed approval is a separate callback, not ordinary write scope or caller boolean", async () => {
  const f = fixture({ confirm: "none" }), a = await f.auth(payload());
  assert.ok(a.scopes.includes("pocket.project-documents.write"));
  assert.equal((await f.stage(a)).ok, true);
  await denied(() => f.confirmPublish(a), "confirmation-denied");
  await denied(() => f.publish(a), "receipt-absent-or-used");
  assert.equal(pointerWrites(f).length, 0);
  assert.equal(f.confirmations().length, 1);
});
test("P349xr forged or mismatched confirmation evidence blocks receipt", async () => {
  for (const confirm of ["wrong", "wrong-principal"]) {
    const f = fixture({ confirm }), a = await f.auth(payload());
    await denied(() => f.confirmPublish(a), "confirmation-denied");
    await denied(() => f.publish(a));
    assert.equal(pointerWrites(f).length, 0);
  }
});
test("P349xr one-subject one-role policy remains untouched; no permanent publisher role", async () => {
  const f = fixture(), a = await f.auth(payload());
  const policy = f.getPolicy();
  assert.equal(policy.bindings.filter(x => x.subject === "user-murray").length, 1);
  assert.deepEqual(policy.bindings[0].capabilities, ["read", "stage"]);
  await f.confirmPublish(a);
  assert.deepEqual((await f.model.stage({
    auth: a, releaseId: "r1", name: "pocket.start-here",
    kind: "document", content: "still a stager",
  })).ok, true);
  assert.deepEqual(f.getPolicy(), policy);
  assert.equal((await f.publish(a)).ok, true);
  assert.deepEqual(f.getPolicy(), policy);
});
test("P349xr concurrent redemption of the exact receipt has one winner, one denial and one SQL pointer write", async () => {
  const f = fixture(), a = await f.auth(payload());
  await f.confirmPublish(a);
  const outcomes = await Promise.allSettled([f.publish(a), f.publish(a)]);
  assert.equal(outcomes.filter(x => x.status === "fulfilled" && x.value.ok).length, 1);
  assert.equal(outcomes.filter(x => x.status === "rejected"
    && x.reason?.code === "handover-single-principal-denied").length, 1);
  assert.equal(pointerWrites(f).length, 1);
  await denied(() => f.publish(a));
});
test("P349xr same intent from distinct authInfo cannot mint duplicate approval", async () => {
  const f = fixture(), a = await f.auth(payload()), b = await f.auth(payload());
  await f.confirmPublish(a);
  await denied(() => f.confirmPublish(b), "confirmation-denied");
  await denied(() => f.publish(b), "receipt-absent-or-used");
  assert.equal(f.confirmations().length, 1);
  assert.equal(pointerWrites(f).length, 0);
});
test("P349xs two simultaneous authInfo sessions with SAME intent reserve exactly one confirmation", { timeout: 5000 }, async () => {
  let enteredCallback;
  const entered = new Promise(resolve => { enteredCallback = resolve; });
  let releaseCallback;
  const gate = new Promise(resolve => { releaseCallback = resolve; });
  const f = fixture({ approvalGate: async () => {
    enteredCallback();
    await gate;
  } });
  // Distinct frozen verified authInfo objects, same trusted subject/policy.
  const a = await f.auth(payload()), b = await f.auth(payload());
  assert.notStrictEqual(a, b);
  assert.equal(a.clientId, b.clientId);
  const left = f.confirmPublish(a);
  const right = f.confirmPublish(b);
  let settled;
  try {
    await entered; // One real callback is now suspended before it can approve.
    // Allow both already-launched confirm() continuations to cross the
    // requireOwner await while the first callback remains deliberately gated.
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(f.confirmations().length, 1,
      "same-intent overlap must not initiate a second confirmation ceremony");
    assert.equal(pointerWrites(f).length, 0,
      "neither confirmation may touch publisher pointer SQL");
  } finally {
    releaseCallback(); // Never strand the pending synthetic ceremony on fail.
  }
  settled = await Promise.allSettled([left, right]);
  assert.equal(settled.filter(x => x.status === "fulfilled" && x.value.confirmed).length, 1);
  assert.equal(settled.filter(x => x.status === "rejected"
    && x.reason?.code === "handover-single-principal-denied"
    && x.reason?.reason === "confirmation-denied").length, 1);
  assert.equal(f.confirmations().length, 1);
  assert.equal(pointerWrites(f).length, 0);
  const winnerAuth = settled[0].status === "fulfilled" ? a : b;
  const loserAuth = winnerAuth === a ? b : a;
  assert.equal((await f.publish(winnerAuth)).ok, true);
  assert.equal(pointerWrites(f).length, 1);
  await denied(() => f.publish(winnerAuth), "receipt-absent-or-used");
  await denied(() => f.publish(loserAuth), "receipt-absent-or-used");
  await denied(() => f.confirmPublish(loserAuth), "confirmation-already-started");
  assert.equal(pointerWrites(f).length, 1);
  assert.equal(f.confirmations().length, 1);
});

test("P349xs same session cannot overlap while owner ceremony awaits, nor re-confirm", { timeout: 5000 }, async () => {
  let enteredCallback;
  const entered = new Promise(resolve => { enteredCallback = resolve; });
  let releaseCallback;
  const gate = new Promise(resolve => { releaseCallback = resolve; });
  const f = fixture({ approvalGate: async () => { enteredCallback(); await gate; } });
  const a = await f.auth(payload());
  const first = f.confirmPublish(a);
  try {
    await entered;
    await denied(() => f.confirmPublish(a), "confirmation-already-started");
    assert.equal(f.confirmations().length, 1);
    assert.equal(pointerWrites(f).length, 0);
  } finally {
    releaseCallback();
  }
  assert.equal((await first).confirmed, true);
  await denied(() => f.confirmPublish(a), "confirmation-already-started");
  assert.equal((await f.publish(a)).ok, true);
  assert.equal(pointerWrites(f).length, 1);
});

test("P349xs failed first ceremony leaves exact-intent reservation terminal across authInfo", async () => {
  const f = fixture({ confirm: "none" });
  const a = await f.auth(payload()), b = await f.auth(payload());
  await denied(() => f.confirmPublish(a), "confirmation-denied");
  await denied(() => f.confirmPublish(b), "confirmation-denied");
  assert.equal(f.confirmations().length, 1,
    "a failed ceremony must not silently reopen a second callback");
  assert.equal(pointerWrites(f).length, 0);
  await denied(() => f.publish(a), "receipt-absent-or-used");
  await denied(() => f.publish(b), "receipt-absent-or-used");
});

test("P349xr cancellation and expiry deny without pointer access", async () => {
  const f = fixture(), a = await f.auth(payload());
  await f.confirmPublish(a);
  assert.deepEqual(await f.model.cancel({ auth: a }), { cancelled: true });
  await denied(() => f.publish(a), "receipt-absent-or-used");
  const g = fixture(), b = await g.auth(payload());
  await g.confirmPublish(b);
  g.tick(60_001);
  await denied(() => g.publish(b), "receipt-expired");
  assert.equal(pointerWrites(f).length, 0);
  assert.equal(pointerWrites(g).length, 0);
});
test("P349xr receipt digest, release, expected revision and wrong authenticated session deny before SQL", async () => {
  for (const [releaseId, bytes, rev] of [
    ["r2", manifest("r2"), 0],
    ["r1", manifest("r1") + "\n", 0],
    ["r1", manifest("r1"), 1],
  ]) {
    const f = fixture(), a = await f.auth(payload());
    await f.confirmPublish(a);
    await denied(() => f.publish(a, releaseId, bytes, rev), "receipt-intent-mismatch");
    assert.equal(pointerWrites(f).length, 0);
  }
  const f = fixture(), a = await f.auth(payload()),
    other = await f.auth(payload("user-other"));
  assert.equal(a.clientId, other.clientId);
  await f.confirmPublish(a);
  await denied(() => f.publish(other), "receipt-absent-or-used");
  assert.equal(pointerWrites(f).length, 0);
});
test("P349xr missing, machine-like, unknown and ambiguous subjects cannot confirm or publish", async () => {
  for (const subject of [undefined, "", "machine@clients", "unknown-user"]) {
    const f = fixture(), a = await f.auth({ ...payload(), sub: subject });
    await denied(() => f.confirmPublish(a), "confirmation-denied");
    assert.equal(pointerWrites(f).length, 0);
  }
  const f = fixture(), p = f.getPolicy();
  p.bindings.push({ ...p.bindings[0] });
  f.setPolicy(p);
  const a = await f.auth(payload());
  await denied(() => f.confirmPublish(a));
  assert.equal(pointerWrites(f).length, 0);
});
test("P349xr owner policy revoked or changed after confirmation blocks pointer even when receipt exists", async () => {
  const changes = [
    p => { p.revoked = true; },
    p => { p.bindings[0].revoked = true; },
    p => { p.bindings[0].ownerApproved = false; },
    p => { p.bindings[0].expiresAtMs = Date.now() - 1; },
    p => { p.bindings[0].ownerId = "owner-other"; },
    p => { p.bindings[0].resourceId = "wrong-resource"; },
    p => { p.bindings[0].role = "reader"; p.bindings[0].capabilities = ["read"]; },
    p => { p.bindings[0].role = "publisher"; p.bindings[0].capabilities = ["read", "publish"]; },
    p => { p.bindings.push({ ...p.bindings[0] }); },
  ];
  for (const change of changes) {
    const f = fixture(), a = await f.auth(payload());
    await f.confirmPublish(a);
    const p = f.getPolicy(); change(p); f.setPolicy(p);
    await denied(() => f.publish(a), "publish-denied-no-retry");
    assert.equal(pointerWrites(f).length, 0);
    await denied(() => f.publish(a));
  }
});
test("P349xr wrong verified issuer/audience/resource blocks confirmation, without SQL", async () => {
  for (const change of [
    p => { p.iss = "https://other.synthetic.test/"; },
    p => { p.aud = "other-audience"; },
    p => { p.sub = "service@clients"; },
  ]) {
    const f = fixture(); const p = payload(); change(p);
    if (p.iss !== config.issuer || p.aud !== config.audience) {
      await assert.rejects(() => f.auth(p), e => e?.code === "project-documents-auth-invalid");
    } else {
      const a = await f.auth(p);
      await denied(() => f.confirmPublish(a));
    }
    assert.equal(pointerWrites(f).length, 0);
  }
  const f = fixture(), policy = f.getPolicy();
  policy.bindings[0].resourceUrl = "https://wrong.synthetic.test/resource";
  f.setPolicy(policy);
  const wrongResourceAuth = await f.auth(payload());
  await denied(() => f.confirmPublish(wrongResourceAuth));
  assert.equal(pointerWrites(f).length, 0);
});
test("P349xr stale pointer consumes the exact one-attempt receipt, no implicit replay", async () => {
  const f = fixture(), a = await f.auth(payload());
  await f.confirmPublish(a);
  f.setPointerRevision(2);
  assert.deepEqual(await f.publish(a), { ok: false, reason: "revision-conflict" });
  assert.equal(pointerWrites(f).length, 1);
  await denied(() => f.publish(a), "receipt-absent-or-used");
  assert.equal(pointerWrites(f).length, 1);
});
test("P349xr ambiguous storage error is terminal without automatic second attempt", async () => {
  const f = fixture({ resultError: true }), a = await f.auth(payload());
  await f.confirmPublish(a);
  await denied(() => f.publish(a), "publish-denied-no-retry");
  await denied(() => f.publish(a), "receipt-absent-or-used");
  assert.equal(pointerWrites(f).length, 1);
  assert.equal(f.model.audit().at(-1).status, "denied-or-ambiguous");
});
test("P349xr nominal synthetic confirmation is not a live authenticated person or durable DB receipt", async () => {
  const f = fixture(), a = await f.auth(payload());
  await f.confirmPublish(a);
  assert.equal(typeof f.confirmations()[0].challenge, "string");
  assert.equal(f.confirmations()[0].challenge.length, 64);
  assert.ok(f.confirmations()[0].digest.match(/^[a-f0-9]{64}$/));
  assert.equal(pointerWrites(f).length, 0);
  // No public receipt, publisher capability, reusable bearer or live schema.
  assert.deepEqual(Object.keys(f.model).sort(), ["stage", "confirm", "cancel", "publish", "audit"].sort());
});
