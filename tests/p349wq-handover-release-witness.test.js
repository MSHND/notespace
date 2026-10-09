"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { NAMES, MANIFEST_NAME, sha256Utf8, verifyHandoverRelease } =
  require("../sync-service/pocket-handover-release-witness.js");

function fixture() {
  const documents = Object.fromEntries(NAMES.map((name, i) => [name, {
    name, revision: i + 1, content: "complete content " + name + "\n🍃",
  }]));
  const manifest = {
    name: MANIFEST_NAME,
    schemaVersion: 1,
    revision: 7,
    releaseId: "test-release-7",
    authorityEpoch: "approved-pocket-epoch-7",
    requiredNames: [...NAMES],
    documents: NAMES.map((name, i) => ({
      name, revision: i + 1, digest: sha256Utf8(documents[name].content),
      sourceRevision: "google-source-revision-" + (i + 1),
    })),
  };
  const gate = {
    mode: "POCKET", approved: true, epoch: manifest.authorityEpoch,
    releaseId: manifest.releaseId, manifestRevision: manifest.revision,
  };
  const currency = {
    current: true,
    sourceRevisions: Object.fromEntries(manifest.documents.map(d => [d.name, d.sourceRevision])),
  };
  const counts = { manifest: 0, document: 0, gate: 0, currency: 0 };
  const f = { manifest, gate, currency, documents, counts };
  f.readManifest = async () => { counts.manifest++; return structuredClone(manifest); };
  f.readDocument = async name => { counts.document++; return structuredClone(documents[name]); };
  f.readTrustedAuthorityGate = async () => { counts.gate++; return structuredClone(gate); };
  f.checkSourceCurrency = async () => { counts.currency++; return structuredClone(currency); };
  return f;
}

function readers(f) {
  return {
    readManifest: f.readManifest,
    readDocument: f.readDocument,
    readTrustedAuthorityGate: f.readTrustedAuthorityGate,
    checkSourceCurrency: f.checkSourceCurrency,
  };
}

async function denied(f, reason) {
  const result = await verifyHandoverRelease(readers(f));
  assert.deepEqual(result, { eligible: false, reason });
}

test("exact nine-document, two-manifest read under trusted simulated epoch is eligible only in model", { timeout: 5000 }, async () => {
  const f = fixture();
  assert.equal(NAMES.length, 9);
  const result = await verifyHandoverRelease(readers(f));
  assert.deepEqual(result, { eligible: true, releaseId: f.manifest.releaseId,
    manifestRevision: 7, authorityEpoch: f.manifest.authorityEpoch });
  assert.deepEqual(f.counts, { manifest: 2, document: 9, gate: 2, currency: 2 });
});

test("digest is SHA-256 of complete UTF-8 bytes, including unicode and newlines", () => {
  const text = "a\n🍃\n";
  const crypto = require("node:crypto");
  assert.equal(sha256Utf8(text), crypto.createHash("sha256").update(Buffer.from(text, "utf8")).digest("hex"));
  assert.notEqual(sha256Utf8(text), sha256Utf8(text.trim()));
  assert.throws(() => sha256Utf8({ body: text }), TypeError);
});

test("GOOGLE_ONLY, missing or untrusted epoch never authorises stored task", { timeout: 5000 }, async t => {
  for (const mode of ["GOOGLE_ONLY", "UNKNOWN", null]) {
    await t.test("mode " + mode, async () => {
      const f = fixture();
      f.gate.mode = mode;
      await denied(f, "authority-not-approved");
      assert.equal(f.counts.document, 0);
    });
  }
  for (const mutation of [g => { g.approved = false; }, g => { g.epoch = "other"; },
    g => { g.releaseId = "other"; }, g => { g.manifestRevision++; }]) {
    const f = fixture(); mutation(f.gate); await denied(f, "authority-not-approved");
  }
});

test("missing external trusted gate / source currency rejects without reading task", { timeout: 5000 }, async () => {
  const f = fixture();
  const input = readers(f);
  delete input.readTrustedAuthorityGate;
  assert.deepEqual(await verifyHandoverRelease(input),
    { eligible: false, reason: "missing-trusted-reader" });
  assert.equal(f.counts.manifest, 0);
  const c = fixture(); c.currency.current = false;
  await denied(c, "source-currency-unverified");
  assert.equal(c.counts.document, 0);
  const m = fixture(); delete m.currency.sourceRevisions[NAMES[0]];
  await denied(m, "source-currency-unverified");
  const x = fixture(); x.currency.sourceRevisions[NAMES[3]] = "wrong-google-revision";
  await denied(x, "source-currency-unverified");
  const y = fixture(); y.currency.sourceRevisions.unexpected = "google";
  await denied(y, "source-currency-unverified");
});

test("missing/malformed/unknown manifest schema and release identity fail closed", { timeout: 5000 }, async () => {
  const edits = [
    m => { m.schemaVersion = 2; },
    m => { m.name = "unknown"; },
    m => { m.name = null; },
    m => { m.releaseId = ""; },
    m => { m.authorityEpoch = ""; },
    m => { m.revision = 0; },
    m => { m.unexpected = true; },
    m => { m.documents[0].sourceRevision = ""; },
    m => { m.documents[0].digest = "fake"; },
    m => { m.requiredNames = null; },
  ];
  for (const edit of edits) {
    const f = fixture(); edit(f.manifest);
    await denied(f, "manifest-invalid");
    assert.equal(f.counts.document, 0);
  }
  const missing = fixture(); missing.readManifest = async () => null;
  await denied(missing, "manifest-invalid");
});

test("missing/extra/duplicate names, including a partial release, never assume authority", { timeout: 5000 }, async () => {
  const changes = [
    m => { m.requiredNames.pop(); },
    m => { m.requiredNames.push("unexpected"); },
    m => { m.requiredNames[0] = m.requiredNames[1]; },
    m => { m.documents.pop(); },
    m => { m.documents.push(structuredClone(m.documents[0])); },
    m => { m.documents[0].name = m.documents[1].name; },
    m => { m.documents[0].name = "pocket.not-authorised"; },
    m => { m.documents.reverse(); },
  ];
  for (const mutate of changes) {
    const f = fixture(); mutate(f.manifest);
    await denied(f, "manifest-invalid");
    assert.equal(f.counts.document, 0);
  }
});

test("wrong name, revision, content/digest and unlisted fields reject without execution", { timeout: 5000 }, async () => {
  const edits = [
    d => { d.name = "pocket.other"; },
    d => { d.revision++; },
    d => { d.content += "unpublished change"; },
    d => { d.extra = "hidden"; },
  ];
  for (const edit of edits) {
    const f = fixture(); edit(f.documents[NAMES[4]]);
    await denied(f, "document-invalid-or-stale");
  }
  const f = fixture();
  delete f.documents[NAMES[4]];
  await denied(f, "document-invalid-or-stale");
});

test("partial staged update under older published witness denies temporary availability", { timeout: 5000 }, async () => {
  const f = fixture();
  f.documents[NAMES[0]].revision++;
  f.documents[NAMES[0]].content = "new staged content";
  await denied(f, "document-invalid-or-stale");
  assert.equal(f.counts.document, 1);
});

test("missing/inaccessible reads and exceptions terminate once with no retry", { timeout: 5000 }, async () => {
  const f = fixture();
  f.readDocument = async () => { f.counts.document++; throw Error("not accessible"); };
  await denied(f, "read-failed");
  assert.equal(f.counts.document, 1);
  assert.equal(f.counts.manifest, 1);
  const m = fixture();
  m.readManifest = async () => { m.counts.manifest++; throw Error("missing manifest"); };
  await denied(m, "read-failed");
  assert.equal(m.counts.manifest, 1);
});

test("changed manifest across read window and competing publication reject", { timeout: 5000 }, async () => {
  const f = fixture();
  const first = structuredClone(f.manifest);
  f.readManifest = async () => {
    f.counts.manifest++;
    const answer = structuredClone(first);
    if (f.counts.manifest === 2) answer.revision++;
    return answer;
  };
  await denied(f, "manifest-changed");
  assert.equal(f.counts.manifest, 2);
  const g = fixture();
  const firstG = structuredClone(g.manifest);
  g.readManifest = async () => {
    g.counts.manifest++;
    const answer = structuredClone(firstG);
    if (g.counts.manifest === 2) answer.documents[0].digest = "a".repeat(64);
    return answer;
  };
  await denied(g, "manifest-changed");
});

test("revoked or competing external approval after record reads rejects", { timeout: 5000 }, async () => {
  const f = fixture();
  f.readTrustedAuthorityGate = async () => {
    f.counts.gate++;
    const g = structuredClone(f.gate);
    if (f.counts.gate === 2) g.approved = false;
    return g;
  };
  await denied(f, "authority-changed");
  assert.equal(f.counts.gate, 2);
  const g = fixture();
  g.readTrustedAuthorityGate = async () => {
    g.counts.gate++;
    const x = structuredClone(g.gate);
    if (g.counts.gate === 2) x.epoch = "next-epoch";
    return x;
  };
  await denied(g, "authority-changed");
});

test("source currency changed during read window fails closed", { timeout: 5000 }, async () => {
  const f = fixture();
  f.checkSourceCurrency = async () => {
    f.counts.currency++;
    const c = structuredClone(f.currency);
    if (f.counts.currency === 2) c.sourceRevisions[NAMES[1]] = "new Google revision";
    return c;
  };
  await denied(f, "source-currency-changed");
  assert.equal(f.counts.currency, 2);
});

test("never executes any task and never makes live service calls", { timeout: 5000 }, async () => {
  const f = fixture();
  let executed = 0;
  const result = await verifyHandoverRelease({ ...readers(f), executeStoredTask: () => { executed++; } });
  assert.equal(result.eligible, true);
  assert.equal(executed, 0);
});
