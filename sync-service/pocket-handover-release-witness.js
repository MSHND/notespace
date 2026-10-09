"use strict";

// P349wq: isolated model only. No imports from production routes or stores.
// Its result is an eligibility classification, never execution authority by itself.
const { createHash } = require("node:crypto");

const NAMES = Object.freeze([
  "pocket.architecture-grammar",
  "pocket.continuity",
  "pocket.current-state",
  "pocket.current-task",
  "pocket.how-we-build",
  "pocket.interaction-change-model",
  "pocket.last-report",
  "pocket.start-here",
  "pocket.task-ledger",
]);
const MANIFEST_NAME = "pocket.handover-release";
const HEX_SHA256 = /^[0-9a-f]{64}$/;
const plain = (v) => !!v && typeof v === "object" && !Array.isArray(v);
const positive = (v) => Number.isSafeInteger(v) && v > 0;
const nonempty = (v) => typeof v === "string" && v.length > 0 && v === v.trim();
const sameKeys = (value, keys) => plain(value)
  && JSON.stringify(Object.keys(value).sort()) === JSON.stringify([...keys].sort());
const sameNames = (names) => Array.isArray(names)
  && names.length === NAMES.length && names.every((n, i) => n === NAMES[i]);

function sha256Utf8(content) {
  if (typeof content !== "string") throw new TypeError("Expected complete document text");
  return createHash("sha256").update(Buffer.from(content, "utf8")).digest("hex");
}

function validManifest(m) {
  if (!sameKeys(m, ["name", "schemaVersion", "revision", "releaseId", "authorityEpoch",
    "requiredNames", "documents"])) return false;
  if (m.name !== MANIFEST_NAME || m.schemaVersion !== 1 || !positive(m.revision)
      || !nonempty(m.releaseId) || !nonempty(m.authorityEpoch)
      || !sameNames(m.requiredNames) || !Array.isArray(m.documents)
      || m.documents.length !== NAMES.length) return false;
  return m.documents.every((d, i) => sameKeys(d, ["name", "revision", "digest", "sourceRevision"])
    && d.name === NAMES[i] && positive(d.revision) && HEX_SHA256.test(d.digest)
    && nonempty(d.sourceRevision));
}

function validGate(g, m) {
  return sameKeys(g, ["mode", "approved", "epoch", "releaseId", "manifestRevision"])
    && g.mode === "POCKET" && g.approved === true
    && nonempty(g.epoch) && g.epoch === m.authorityEpoch
    && g.releaseId === m.releaseId && g.manifestRevision === m.revision;
}

function validCurrency(c, m) {
  if (!sameKeys(c, ["current", "sourceRevisions"]) || c.current !== true
      || !sameKeys(c.sourceRevisions, NAMES)) return false;
  return m.documents.every(d => nonempty(c.sourceRevisions[d.name])
    && c.sourceRevisions[d.name] === d.sourceRevision);
}

function rejected(reason) {
  return Object.freeze({ eligible: false, reason });
}

// Injected readers are an isolated test seam, NOT connected to Google, MCP or Pocket Sync.
// Publication/source currency/epoch require independently trusted external establishment.
// Exactly one pass, bounded by NAMES (9); no retries and no execution callback.
async function verifyHandoverRelease(input) {
  if (!plain(input) || ["readManifest", "readDocument", "readTrustedAuthorityGate",
    "checkSourceCurrency"].some(k => typeof input[k] !== "function")) {
    return rejected("missing-trusted-reader");
  }

  try {
    const first = await input.readManifest();
    if (!validManifest(first)) return rejected("manifest-invalid");

    const gate = await input.readTrustedAuthorityGate();
    if (!validGate(gate, first)) return rejected("authority-not-approved");

    // A stored source revision alone is never a Google-currency proof.
    const currency = await input.checkSourceCurrency(first);
    if (!validCurrency(currency, first)) return rejected("source-currency-unverified");

    for (const expected of first.documents) {
      const actual = await input.readDocument(expected.name);
      if (!sameKeys(actual, ["name", "revision", "content"])
          || actual.name !== expected.name || actual.revision !== expected.revision
          || typeof actual.content !== "string"
          || sha256Utf8(actual.content) !== expected.digest) {
        return rejected("document-invalid-or-stale");
      }
    }

    const last = await input.readManifest();
    if (!validManifest(last) || JSON.stringify(last) !== JSON.stringify(first)) {
      return rejected("manifest-changed");
    }
    const finalGate = await input.readTrustedAuthorityGate();
    if (!validGate(finalGate, first) || JSON.stringify(finalGate) !== JSON.stringify(gate)) {
      return rejected("authority-changed");
    }
    const finalCurrency = await input.checkSourceCurrency(first);
    if (!validCurrency(finalCurrency, first)
        || JSON.stringify(finalCurrency) !== JSON.stringify(currency)) {
      return rejected("source-currency-changed");
    }
    return Object.freeze({ eligible: true, releaseId: first.releaseId,
      manifestRevision: first.revision, authorityEpoch: first.authorityEpoch });
  } catch (_error) {
    return rejected("read-failed");
  }
}

module.exports = Object.freeze({
  NAMES,
  MANIFEST_NAME,
  sha256Utf8,
  verifyHandoverRelease,
});
