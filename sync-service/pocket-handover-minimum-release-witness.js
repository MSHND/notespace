"use strict";

// P349wt: proof-only minimum-set model. No production/MCP/DB/Google integration.
// Returns eligibility, NEVER executes or grants authority on its own.
const { sha256Utf8 } = require("./pocket-handover-release-witness.js");

const CORE = Object.freeze(["pocket.current-state", "pocket.current-task", "pocket.start-here"]);
const GOVERNING = Object.freeze([
  "pocket.architecture-grammar",
  "pocket.continuity",
  "pocket.how-we-build",
  "pocket.interaction-change-model",
]);
const HISTORICAL = Object.freeze(["pocket.last-report", "pocket.task-ledger"]);
const DOCS = Object.freeze([...CORE, ...GOVERNING].sort());
const HASH = /^[a-f0-9]{64}$/;
const TASK = /^P[0-9]+[a-z]*$/;
const REF = /^(?:git:[a-f0-9]{40}|sha256:[a-f0-9]{64}|approval:[a-z0-9._-]+@[1-9][0-9]*)$/;
const object = v => !!v && typeof v === "object" && !Array.isArray(v);
const keys = (v, fields) => object(v)
  && JSON.stringify(Object.keys(v).sort()) === JSON.stringify([...fields].sort());
const nonempty = v => typeof v === "string" && v.length > 0 && v.trim() === v;
const positive = v => Number.isSafeInteger(v) && v > 0;
const sortedUnique = arr => Array.isArray(arr) && new Set(arr).size === arr.length
  && arr.every((v, i) => typeof v === "string" && (i === 0 || arr[i - 1] < v));
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const deny = reason => Object.freeze({ eligible: false, reason });

function validPolicy(p) {
  if (!keys(p, ["taskId", "taskClass", "releaseId", "requiredDocuments", "requiredEvidence"])
      || !TASK.test(p.taskId) || !nonempty(p.releaseId)
      || !["IMPLEMENTATION", "INVESTIGATION"].includes(p.taskClass)
      || !sortedUnique(p.requiredDocuments)
      || !p.requiredDocuments.every(n => GOVERNING.includes(n))
      || (p.taskClass === "IMPLEMENTATION"
        && !p.requiredDocuments.includes("pocket.how-we-build"))
      || !Array.isArray(p.requiredEvidence)) return false;
  const ids = new Set();
  for (const r of p.requiredEvidence) {
    if (!keys(r, ["id", "taskId", "kind", "ref", "outcome"])
        || !nonempty(r.id) || ids.has(r.id) || r.taskId !== p.taskId
        || !["CI", "SAFETY", "APPROVAL"].includes(r.kind)
        || !REF.test(r.ref) || !nonempty(r.outcome)) return false;
    ids.add(r.id);
  }
  return true;
}

function requiredNames(p) {
  return [...CORE, ...p.requiredDocuments].sort();
}

function validManifest(m, p) {
  const expected = requiredNames(p);
  return keys(m, ["name", "schemaVersion", "revision", "releaseId",
    "authorityEpoch", "taskId", "documents", "evidence"])
    && m.name === "pocket.handover-release" && m.schemaVersion === 2
    && positive(m.revision) && nonempty(m.releaseId) && nonempty(m.authorityEpoch)
    && m.releaseId === p.releaseId && m.taskId === p.taskId
    && Array.isArray(m.documents) && m.documents.length === expected.length
    && same(m.evidence, p.requiredEvidence)
    && m.documents.every((d, i) =>
      keys(d, ["name", "revision", "digest", "sourceRevision", "sourceDigest"])
      && d.name === expected[i] && positive(d.revision) && HASH.test(d.digest)
      && nonempty(d.sourceRevision) && HASH.test(d.sourceDigest)
      && d.digest === d.sourceDigest);
}

function validGate(g, m) {
  return keys(g, ["mode", "approved", "epoch", "releaseId", "manifestRevision", "taskId"])
    && g.mode === "POCKET" && g.approved === true
    && g.epoch === m.authorityEpoch && g.releaseId === m.releaseId
    && g.manifestRevision === m.revision && g.taskId === m.taskId;
}

function validCurrency(c, m) {
  return keys(c, ["verified", "documents"]) && c.verified === true
    && Array.isArray(c.documents) && c.documents.length === m.documents.length
    && c.documents.every((d, i) => {
      const e = m.documents[i];
      return keys(d, ["name", "sourceRevision", "sourceDigest", "verified"])
        && d.verified === true && d.name === e.name
        && d.sourceRevision === e.sourceRevision
        && d.sourceDigest === e.sourceDigest;
    });
}

// Exact, deliberately narrow parsing of the first paragraph and FAST RESUME.
// Never infer active task from an arbitrary historical P mention.
function taskIdentity(content) {
  if (typeof content !== "string") return null;
  const header = content.split("\n", 1)[0];
  const m = /^(P[0-9]+[a-z]*) — [^\n]+$/.exec(header);
  return m ? m[1] : null;
}

function stateIdentity(content) {
  if (typeof content !== "string") return null;
  const lines = content.split("\n");
  if (lines[0] !== "POCKET — CURRENT STATE & DEVELOPMENT PATH") return null;
  // Full Google projection retains blank structural paragraphs after the heading.
  // Skip only blank separators; never search the historical body for an old NEXT.
  let i = 1;
  while (i < lines.length && lines[i].trim() === "") i++;
  if (!lines[i]?.startsWith("FAST RESUME — ")) return null;
  i++;
  while (i < lines.length && lines[i].trim() === "") i++;
  if (!lines[i]) return null;
  const found = [...lines[i].matchAll(/\bNEXT\s+(P[0-9]+[a-z]*)\b/g)];
  return found.length === 1 ? found[0][1] : null;
}

function validEvidence(receipt, expected) {
  return keys(receipt, ["id", "taskId", "kind", "ref", "outcome", "verified", "revoked"])
    && receipt.id === expected.id && receipt.taskId === expected.taskId
    && receipt.kind === expected.kind && receipt.ref === expected.ref
    && receipt.outcome === expected.outcome
    && receipt.verified === true && receipt.revoked === false;
}

// All readers are *injected trusted fixtures* in this isolated proof.
// In production, neither a stored manifest nor a document's own text can
// establish policy, epoch, source currentness, or evidence authenticity.
// One bounded pass; no retries; no execution callback.
async function verifyMinimumHandoverRelease(input) {
  const operations = ["readManifest", "readDocument", "readTrustedTaskPolicy",
    "readTrustedAuthorityGate", "checkSourceCurrency", "readIndependentEvidence"];
  if (!object(input) || operations.some(k => typeof input[k] !== "function"))
    return deny("missing-trusted-reader");
  try {
    const first = await input.readManifest();
    const policy = await input.readTrustedTaskPolicy();
    if (!validPolicy(policy)) return deny("task-policy-invalid");
    if (!validManifest(first, policy)) return deny("manifest-invalid");
    const gate = await input.readTrustedAuthorityGate();
    if (!validGate(gate, first)) return deny("authority-not-approved");
    const currency = await input.checkSourceCurrency(first);
    if (!validCurrency(currency, first)) return deny("source-currency-unverified");

    const read = {};
    for (const d of first.documents) {
      const actual = await input.readDocument(d.name);
      if (!keys(actual, ["name", "revision", "content"])
          || actual.name !== d.name || actual.revision !== d.revision
          || typeof actual.content !== "string"
          || sha256Utf8(actual.content) !== d.digest)
        return deny("document-invalid-or-stale");
      read[d.name] = actual.content;
    }
    if (taskIdentity(read["pocket.current-task"]) !== policy.taskId
        || stateIdentity(read["pocket.current-state"]) !== policy.taskId)
      return deny("task-identity-mismatch");

    for (const r of policy.requiredEvidence) {
      const receipt = await input.readIndependentEvidence(r);
      if (!validEvidence(receipt, r)) return deny("required-evidence-unverified");
    }

    const last = await input.readManifest();
    if (!validManifest(last, policy) || !same(last, first))
      return deny("manifest-changed");
    const finalPolicy = await input.readTrustedTaskPolicy();
    if (!validPolicy(finalPolicy) || !same(finalPolicy, policy))
      return deny("task-policy-changed");
    const finalGate = await input.readTrustedAuthorityGate();
    if (!validGate(finalGate, first) || !same(finalGate, gate))
      return deny("authority-changed");
    const finalCurrency = await input.checkSourceCurrency(first);
    if (!validCurrency(finalCurrency, first) || !same(finalCurrency, currency))
      return deny("source-currency-changed");
    for (const r of policy.requiredEvidence) {
      const receipt = await input.readIndependentEvidence(r);
      if (!validEvidence(receipt, r)) return deny("required-evidence-changed");
    }
    return Object.freeze({ eligible: true, releaseId: first.releaseId,
      taskId: policy.taskId, manifestRevision: first.revision,
      authorityEpoch: first.authorityEpoch });
  } catch (_error) {
    return deny("read-failed");
  }
}

module.exports = Object.freeze({
  CORE, GOVERNING, HISTORICAL, taskIdentity, stateIdentity,
  verifyMinimumHandoverRelease,
});
