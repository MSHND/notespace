"use strict";

// P349wx isolated publish-last PRE-FLIGHT SIMULATION ONLY.
// No production imports except existing pure identity/digest helpers.
// No execution authority, Google adapter, MCP call, DB or runtime wiring.
const { sha256Utf8 } = require("./pocket-handover-release-witness.js");
const { CORE, GOVERNING, taskIdentity, stateIdentity } =
  require("./pocket-handover-minimum-release-witness.js");

const MANIFEST = "pocket.handover-release";
const PROJECTION = "google-paragraph-text-v1"; // exactly .text in order joined with "\n"
const STRUCTURE = "single-tab-plain-paragraphs";
const SHA = /^[a-f0-9]{64}$/;
const TASK = /^P[0-9]+[a-z]*$/;
const REF = /^(?:git:[a-f0-9]{40}|sha256:[a-f0-9]{64}|approval:[a-z0-9._-]+@[1-9][0-9]*)$/;
const obj = v => !!v && typeof v === "object" && !Array.isArray(v);
const fields = (v, required) => obj(v)
  && JSON.stringify(Object.keys(v).sort()) === JSON.stringify([...required].sort());
const positive = v => Number.isSafeInteger(v) && v > 0;
const nonempty = v => typeof v === "string" && v.length > 0 && v === v.trim();
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const sortedUnique = a => Array.isArray(a) && a.every((v, i) =>
  nonempty(v) && (i === 0 || a[i - 1] < v));
const denied = reason => Object.freeze({ published: false, executable: false, reason });

function validPolicy(p) {
  if (!fields(p, ["releaseId", "taskId", "taskClass", "requiredDocuments", "requiredEvidence"])
      || !nonempty(p.releaseId) || !TASK.test(p.taskId)
      || !["INVESTIGATION", "IMPLEMENTATION"].includes(p.taskClass)
      || !sortedUnique(p.requiredDocuments)
      || !p.requiredDocuments.every(x => GOVERNING.includes(x))
      || (p.taskClass === "IMPLEMENTATION"
          && !p.requiredDocuments.includes("pocket.how-we-build"))
      || !Array.isArray(p.requiredEvidence)) return false;
  const seen = new Set();
  for (const e of p.requiredEvidence) {
    if (!fields(e, ["id", "taskId", "kind", "ref", "outcome"])
        || !nonempty(e.id) || seen.has(e.id) || e.taskId !== p.taskId
        || !["CI", "SAFETY", "APPROVAL"].includes(e.kind)
        || !REF.test(e.ref) || !nonempty(e.outcome)) return false;
    seen.add(e.id);
  }
  return true;
}
const requiredNames = p => [...CORE, ...p.requiredDocuments].sort();

function validGrant(g, p, principal, clock) {
  const names = requiredNames(p);
  if (!fields(g, ["approved", "revoked", "principal", "sourceReaderPrincipal",
    "action", "releaseId", "taskId", "allowedSources", "expiresAtMs", "maxAttempts"])
    || g.approved !== true || g.revoked !== false || !nonempty(principal)
    || g.principal !== principal || !nonempty(g.sourceReaderPrincipal)
    || g.action !== "publish-handover-release" || g.releaseId !== p.releaseId
    || g.taskId !== p.taskId || g.maxAttempts !== 1
    || !Number.isSafeInteger(clock) || !Number.isSafeInteger(g.expiresAtMs)
    || clock >= g.expiresAtMs
    || !Array.isArray(g.allowedSources) || g.allowedSources.length !== names.length)
    return false;
  return g.allowedSources.every((s, i) =>
    fields(s, ["name", "documentId", "tabId", "revisionId", "digest"])
    && s.name === names[i] && nonempty(s.documentId)
    && nonempty(s.tabId) && nonempty(s.revisionId) && SHA.test(s.digest));
}

function canonicalSource(s, expected, readPrincipal) {
  if (!fields(s, ["name", "documentId", "tabId", "revisionId", "structure",
    "projectionVersion", "readPrincipal", "paragraphs", "canonicalText", "digest"])
    || s.name !== expected.name || s.documentId !== expected.documentId
    || s.tabId !== expected.tabId || s.revisionId !== expected.revisionId
    || s.structure !== STRUCTURE || s.projectionVersion !== PROJECTION
    || s.readPrincipal !== readPrincipal || !Array.isArray(s.paragraphs)
    || s.paragraphs.length < 1 || !s.paragraphs.every(p =>
      fields(p, ["text"]) && typeof p.text === "string")
    || typeof s.canonicalText !== "string" || !SHA.test(s.digest)) return null;
  // Trusted adapter promises complete ordered paragraphs and no other structures;
  // a local projection check cannot prove the adapter supplied all Google content.
  const reconstructed = s.paragraphs.map(p => p.text).join("\n");
  if (reconstructed !== s.canonicalText || sha256Utf8(reconstructed) !== s.digest
      || s.digest !== expected.digest) return null;
  return Object.freeze({
    name: s.name, documentId: s.documentId, tabId: s.tabId,
    revisionId: s.revisionId, digest: s.digest, text: reconstructed,
  });
}

function validEvidence(receipt, expected) {
  return fields(receipt, ["id", "taskId", "kind", "ref", "outcome", "verified", "revoked"])
    && receipt.id === expected.id && receipt.taskId === expected.taskId
    && receipt.kind === expected.kind && receipt.ref === expected.ref
    && receipt.outcome === expected.outcome && receipt.verified === true
    && receipt.revoked === false;
}

function validRow(r, name) {
  return fields(r, ["name", "revision", "content"])
    && r.name === name && positive(r.revision) && typeof r.content === "string";
}
function validManifestRow(r) {
  return fields(r, ["name", "revision", "content"])
    && r.name === MANIFEST && positive(r.revision) && typeof r.content === "string";
}
function validMode(m) {
  return fields(m, ["mode", "epoch"]) && m.mode === "GOOGLE_ONLY"
    && m.epoch === "GOOGLE_ONLY";
}
function checks(input) {
  return obj(input) && ["readTrustedPolicy", "readAuthenticatedPrincipal",
    "readTrustedClock", "readAuthorityMode", "readPublisherGrant",
    "readGoogleSource", "readEvidenceReceipt", "readPocketRecord",
    "casStagePocketRecord", "readManifest", "casPublishManifest"]
    .every(x => typeof input[x] === "function");
}

// Finite read -> stage/read-back -> source/grant/evidence recheck -> one manifest CAS.
// Staging mutates MOCKED latest-only records and cannot atomically preserve a prior release.
// All controls are injected independent fixtures; no live service I/O exists here.
async function preflightPublishHandover(input) {
  if (!checks(input)) return denied("missing-trusted-reader");
  try {
    const policy = await input.readTrustedPolicy();
    if (!validPolicy(policy)) return denied("policy-invalid");
    const principal = await input.readAuthenticatedPrincipal();
    const clock = await input.readTrustedClock();
    const mode = await input.readAuthorityMode();
    const grant = await input.readPublisherGrant();
    if (!validMode(mode)) return denied("authority-mode-not-google-only");
    if (!validGrant(grant, policy, principal, clock)) return denied("publisher-grant-invalid");

    const before = await input.readManifest();
    if (!validManifestRow(before)) return denied("manifest-unavailable");

    const initial = [];
    for (const expected of grant.allowedSources) {
      const s = canonicalSource(await input.readGoogleSource(expected.name),
        expected, grant.sourceReaderPrincipal);
      if (!s) return denied("source-invalid-or-stale");
      initial.push(s);
    }
    if (taskIdentity(initial.find(s => s.name === "pocket.current-task")?.text)
        !== policy.taskId
        || stateIdentity(initial.find(s => s.name === "pocket.current-state")?.text)
        !== policy.taskId) return denied("task-identity-mismatch");

    for (const evidence of policy.requiredEvidence) {
      if (!validEvidence(await input.readEvidenceReceipt(evidence), evidence))
        return denied("evidence-unverified");
    }
    const rows = [];
    for (const s of initial) {
      const old = await input.readPocketRecord(s.name);
      if (!validRow(old, s.name) || old.revision >= Number.MAX_SAFE_INTEGER)
        return denied("stage-precondition-failed");
      const next = await input.casStagePocketRecord({
        name: s.name, expectedRevision: old.revision, content: s.text,
      });
      if (!validRow(next, s.name) || next.revision !== old.revision + 1
          || next.content !== s.text) return denied("stage-write-uncertain");
      const confirmed = await input.readPocketRecord(s.name);
      if (!validRow(confirmed, s.name) || !same(confirmed, next)
          || sha256Utf8(confirmed.content) !== s.digest)
        return denied("stage-readback-invalid");
      rows.push({ name: s.name, revision: confirmed.revision,
        digest: s.digest, sourceRevision: s.revisionId, sourceDigest: s.digest });
    }
    // No publication until source currentness and approval are re-established.
    for (const expected of grant.allowedSources) {
      const current = canonicalSource(await input.readGoogleSource(expected.name),
        expected, grant.sourceReaderPrincipal);
      if (!current || !same(current, initial.find(s => s.name === expected.name)))
        return denied("source-changed-before-publish");
    }
    const finalPolicy = await input.readTrustedPolicy();
    const finalPrincipal = await input.readAuthenticatedPrincipal();
    const finalClock = await input.readTrustedClock();
    const finalMode = await input.readAuthorityMode();
    const finalGrant = await input.readPublisherGrant();
    if (!validPolicy(finalPolicy) || !same(finalPolicy, policy)
        || finalPrincipal !== principal || !same(finalMode, mode)
        || !validGrant(finalGrant, policy, finalPrincipal, finalClock)
        || !same(finalGrant, grant)) return denied("permission-or-policy-changed");
    for (const evidence of policy.requiredEvidence) {
      if (!validEvidence(await input.readEvidenceReceipt(evidence), evidence))
        return denied("evidence-changed");
    }
    const currentManifest = await input.readManifest();
    if (!validManifestRow(currentManifest) || !same(currentManifest, before))
      return denied("manifest-concurrently-changed");

    const witness = {
      name: MANIFEST, schemaVersion: 2, revision: before.revision + 1,
      releaseId: policy.releaseId, authorityEpoch: "GOOGLE_ONLY",
      taskId: policy.taskId, documents: rows,
      evidence: policy.requiredEvidence,
    };
    // Only one publish attempt; negative/uncertain result must NEVER be retried.
    const result = await input.casPublishManifest({
      name: MANIFEST, expectedRevision: before.revision,
      content: JSON.stringify(witness),
    });
    if (!validManifestRow(result) || result.revision !== before.revision + 1
        || result.content !== JSON.stringify(witness))
      return denied("publish-uncertain-or-conflict");

    return Object.freeze({
      published: true, executable: false, mode: "GOOGLE_ONLY",
      releaseId: policy.releaseId, taskId: policy.taskId,
      manifestRevision: result.revision, stagedDocuments: rows.length,
    });
  } catch (_error) {
    return denied("read-or-write-failed");
  }
}
module.exports = Object.freeze({ PROJECTION, STRUCTURE, preflightPublishHandover });
