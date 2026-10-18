"use strict";

// Disposable candidate only. Read-only P349 release verification, export and
// in-memory reconstruction. No runtime wiring, migration, route or publication.
const { NAMES, sha256Utf8 } = require("./pocket-handover-release-witness.js");

const SHA = /^[a-f0-9]{64}$/;
const RELEASE = /^r[0-9]{1,18}$/;
function refuse(reason) {
  const e = new Error("Disposable handover reconstruction refused.");
  e.code = "p349-history-probe-denied";
  e.reason = reason;
  throw e;
}
function manifestOf(content, releaseId) {
  let m;
  try { m = JSON.parse(content); } catch { refuse("manifest-invalid"); }
  if (!m || typeof m !== "object" || Array.isArray(m)
      || m.releaseId !== releaseId || m.authorityEpoch !== "GOOGLE_ONLY"
      || !Array.isArray(m.documents) || m.documents.length !== NAMES.length) {
    refuse("manifest-invalid");
  }
  for (let i = 0; i < NAMES.length; i++) {
    const d = m.documents[i];
    if (!d || d.name !== NAMES[i] || d.releaseId !== releaseId
        || typeof d.digest !== "string" || !SHA.test(d.digest)) {
      refuse("manifest-invalid");
    }
  }
  return m;
}
function verifySnapshot(snapshot) {
  if (!snapshot || snapshot.schemaVersion !== 1
      || typeof snapshot.releaseId !== "string" || !RELEASE.test(snapshot.releaseId)
      || !Array.isArray(snapshot.documents)
      || snapshot.documents.length !== NAMES.length) refuse("snapshot-invalid");
  const manifest = manifestOf(snapshot.manifestContent, snapshot.releaseId);
  for (let i = 0; i < NAMES.length; i++) {
    const d = snapshot.documents[i], expected = manifest.documents[i];
    if (!d || d.name !== NAMES[i] || d.releaseId !== snapshot.releaseId
        || d.revision !== 1 || typeof d.content !== "string"
        || d.digest !== expected.digest || sha256Utf8(d.content) !== d.digest) {
      refuse("entry-digest-or-identity-invalid");
    }
  }
  return true;
}
async function captureVerifiedRelease({store, auth, releaseId, manifestContent} = {}) {
  if (!store || typeof store.readEntry !== "function"
      || typeof releaseId !== "string" || !RELEASE.test(releaseId)) {
    refuse("trusted-reader-missing");
  }
  const m = manifestOf(manifestContent, releaseId);
  const documents = [];
  for (const expected of m.documents) {
    const found = await store.readEntry({auth, releaseId, name: expected.name});
    if (!found?.ok || !found.entry || found.entry.kind !== "document"
        || found.entry.releaseId !== releaseId || found.entry.name !== expected.name
        || found.entry.revision !== 1 || found.entry.digest !== expected.digest
        || sha256Utf8(found.entry.content) !== expected.digest) {
      refuse("entry-missing-or-invalid");
    }
    documents.push(Object.freeze({
      name: expected.name, releaseId, revision: 1,
      content: found.entry.content, digest: found.entry.digest,
    }));
  }
  const snapshot = {
    schemaVersion: 1, releaseId, manifestContent, documents,
  };
  verifySnapshot(snapshot);
  return Object.freeze({
    snapshot: Object.freeze(snapshot),
    sha256: sha256Utf8(JSON.stringify(snapshot)),
  });
}
function reconstructVerifiedRelease(bundle) {
  if (!bundle || !bundle.snapshot || typeof bundle.sha256 !== "string"
      || !SHA.test(bundle.sha256)
      || sha256Utf8(JSON.stringify(bundle.snapshot)) !== bundle.sha256) {
    refuse("export-fingerprint-invalid");
  }
  verifySnapshot(bundle.snapshot);
  // Return new independent objects; no DB, owner, release or publish authority.
  return Object.freeze(bundle.snapshot.documents.map(d => Object.freeze({
    name: d.name, releaseId: d.releaseId, revision: d.revision,
    content: d.content, digest: d.digest,
  })));
}
module.exports = Object.freeze({
  captureVerifiedRelease, reconstructVerifiedRelease,
});
