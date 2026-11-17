"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");
const { referenceForRecord } = require("../sync-service/pocket-sync-object-head-postgres-store.js");
const { splitRecord, joinRecord, FRAGMENT_CHARS } = require("../sync-service/pocket-sync-opaque-record-fragments.js");
const { createPeTestDom } = require("./helpers/pe-test-dom.js");
const { preflightLegacyMigration } = require("../tools/pocket-legacy-migration-preflight.js");

const fixtureSource = fs.readFileSync(path.join(__dirname, "p146-starling-accepted-document-materialize.test.js"), "utf8");
const harness = new Function("require", "__dirname",
  fixtureSource.replace('const test = require("node:test"),', "const test = () => {},") +
  "\nreturn { runtime, remote, service, context, head, semanticBase };")(require, __dirname);

const time = "2026-01-10T00:00:00.000Z";
const originalText = "  First line 👩🏽‍💻\nSecond line e\u0301\n\n" + "x".repeat(33500) + "\r\n  tail  ";
const largeCapsule = { details: "Fictional protected provenance", nested: { text: "q".repeat(125000) } };
const guard = { schema: "pocket.guard.v1", instanceId: "synthetic-instance", sourceFileName: "fixture.json",
  sourceWrittenAt: time, backupWrittenAt: time };
const tombstones = Array.from({ length: 902 }, (_, index) => ({ id: `deleted-${index}`, deletedAt: time }));
const nodes = Array.from({ length: 24 }, (_, order) => ({
  id: `n${order}`, parentId: "root", order, source: "manual", updatedAt: time,
  label: `Fictional title ${order} ${"t".repeat(250)} exact tail`,
  ...(order === 0 ? { details: originalText } : {}),
  ...(order < 4 ? { peMigrationLegacySourcePreserved: { ...largeCapsule, index: order } } : {}),
}));
const factory = prefix => (kind, index) => `${prefix}-${kind}-${index}`;
const plain = value => JSON.parse(JSON.stringify(value));

function localObjects(directory) {
  // The test backend publishes a manifest only after all its part files exist.
  // The real Starling publication flow uses this backend through its P146 transport.
  function location(ref) { return path.join(directory, encodeURIComponent(ref)); }
  function get(ref) {
    const base = location(ref);
    if (!fs.existsSync(base)) return undefined;
    const { count, ...manifest } = JSON.parse(fs.readFileSync(path.join(base, "manifest.json"), "utf8"));
    if (count !== fs.readdirSync(base).length - 1) throw new Error("Incomplete synthetic fragment inventory");
    const parts = Array.from({ length: count }, (_, i) => fs.readFileSync(path.join(base, String(i)), "ascii"));
    return joinRecord(ref, { ...manifest, parts });
  }
  return {
    get, has: ref => get(ref) !== undefined,
    set(ref, record) {
      const { parts, ...manifest } = splitRecord(ref, plain(record));
      const final = location(ref);
      if (fs.existsSync(final)) {
        assert.deepEqual(get(ref), plain(record));
        return;
      }
      const temporary = fs.mkdtempSync(path.join(directory, "staged-"));
      parts.forEach((part, i) => fs.writeFileSync(path.join(temporary, String(i)), part, "ascii"));
      fs.writeFileSync(path.join(temporary, "manifest.json"), JSON.stringify({ ...manifest, count: parts.length }));
      fs.renameSync(temporary, final);
    },
  };
}

async function fresh(state, prefix, transport) {
  const c = harness.runtime();
  const { record, wrappingKey, envelopeContext } = state.envelope;
  const key = await c.PocketSyncCrypto.openMasterKeyBundle(record, wrappingKey, envelopeContext, [],
    { semanticAuthority: true });
  const service = transport || harness.service(c, state.remote);
  const input = { masterKey: key.masterKey, context: harness.context(), semanticAuthority: key.semanticAuthority };
  const opened = await c.PocketStarlingRemoteOpenShadow.createRemoteOpener({
    objectHeadService: service, operationIdFactory: factory(prefix),
  }).openRemote(input);
  return { c, opened, input, service };
}

async function fixture(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pocket-fragments-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const c = harness.runtime();
  const logical = c.PocketStarlingObjectSealShadow;
  const stager = logical.createStager();
  const encoded = c.PocketStarlingBridgeShadow.encode({ schema: "portal.export.v1", writtenAt: time, nodes,
    tombstones, rootExtras: { pocketGuard: guard }, dataExtras: { pocketGuard: guard } });
  assert.equal(encoded.ok, true, encoded.reason);
  const built = c.PocketStarlingRootShadow.build(encoded.bridge);
  assert.equal(built.ok, true, built.reason);
  const result = logical.stageCandidate(stager, built.state, { previousSealRef: null });
  assert.equal(result.ok, true, result.reason);
  const sealRef = result.stage.sealRef;
  const resolveLogical = ref => stager.store.get(ref);
  const semantic = await harness.semanticBase(c, { acceptedSealRef: sealRef, resolveLogical, syncedPocketId: "p146" });
  const stage = await c.PocketStarlingStorageShadow.stageCandidate({
    sealRef, resolveLogical, masterKey: semantic.masterKey, context: harness.context(),
    semanticAuthority: semantic.semanticAuthority, semanticValidityProof: semantic.semanticValidityProof,
  });
  const remote = harness.remote();
  remote.objects = localObjects(dir);
  const publisher = c.PocketStarlingPublicationShadow.createPublisher({
    objectHeadService: harness.service(c, remote), operationIdFactory: factory("initial"),
  });
  const committed = await publisher.publishCandidate({ stage, expectedHead: harness.head(0, null) });
  assert.equal(committed.outcome, "committed");
  return { dir, remote, envelope: semantic.envelope };
}

async function material(reader) {
  const result = await reader.c.PocketStarlingMaterializeShadow.materializeAccepted(reader.opened.session);
  assert.equal(result.ok, true, result.reason);
  return plain(result.document);
}

function transaction(reader, prefix, service = reader.service) {
  return reader.c.PocketStarlingRemoteSaveShadow.createTransaction({
    ...reader.input, opened: reader.opened, objectHeadService: service, operationIdFactory: factory(prefix),
  });
}

async function payload(reader, nodeId) {
  const result = await reader.opened.session.readContent(nodeId);
  assert.equal(result.ok, true, result.reason);
  return plain(result.payload);
}

test("encrypted fragments preserve the old storage reference and reject incomplete or rearranged records", () => {
  const record = { format: "pocket.sync.starling-object.opaque", version: 1, algorithm: "AES-GCM-256",
    nonce: Buffer.alloc(12).toString("base64url"),
    ciphertext: Buffer.concat([Buffer.alloc(6000, 1), Buffer.alloc(6000, 2)]).toString("base64url") };
  const ref = referenceForRecord(record);
  const split = splitRecord(ref, record);
  assert.ok(split.parts.length >= 4);
  assert.ok(split.parts.every(part => part.length <= FRAGMENT_CHARS));
  assert.deepEqual(joinRecord(ref, split), record);
  assert.deepEqual(joinRecord(ref, record), record);
  for (const parts of [split.parts.slice(1), [...split.parts].reverse(),
    [split.parts[1], ...split.parts.slice(1)]]) {
    assert.throws(() => joinRecord(ref, { ...split, parts }), { code: "opaque-fragment-invalid" });
  }
  assert.throws(() => joinRecord(ref, { ...split, schema: "unknown" }), { code: "opaque-fragment-invalid" });
});

test("one thought, 24 full titles and four large capsules survive fresh Starling Open", async t => {
  const f = await fixture(t);
  const reopened = await fresh({ ...f, remote: { ...f.remote, objects: localObjects(f.dir) } }, "fresh");
  const result = await material(reopened);
  assert.deepEqual(result.nodes, nodes);
  assert.deepEqual(result.tombstones, tombstones);
  assert.deepEqual(result.rootExtras.pocketGuard, guard);
  assert.deepEqual(result.dataExtras.pocketGuard, guard);
  const manifests = fs.readdirSync(f.dir).map(name => path.join(f.dir, name, "manifest.json"));
  assert.ok(manifests.filter(file => JSON.parse(fs.readFileSync(file, "utf8")).count >= 4).length >= 4);
  assert.ok(manifests.every(file => !fs.readFileSync(file, "utf8").includes(largeCapsule.details)));

  const preview = require("../js/pocket-natural-unit-preview.js");
  const { Element } = createPeTestDom();
  const document = { createElement: tag => new Element(tag) };
  const view = preview(document, result.nodes[0].details);
  assert.equal(view.tagName, "DETAILS");
  assert.equal(view.children[0].tagName, "SUMMARY");
  assert.equal(view.children[0].textContent, "  First line 👩🏽‍💻\nSecond line e\u0301 More…");
  assert.equal(view.children[1].textContent, originalText);
  assert.equal(view.open, false);
  view.open = true;
  view.dispatch("toggle");
  assert.equal(view.children[0].children[0].style.display, "none");
  assert.equal(view.children[0].children[1].textContent, " Show less");
  assert.equal(view.children[1].textContent, originalText);
  assert.equal(preview(document, null), null);

  const wrongKey = await reopened.c.PocketSyncCrypto.generateDeviceWrappingKey();
  const denied = reopened.c.PocketStarlingRemoteOpenShadow.createRemoteOpener({
    objectHeadService: reopened.service, operationIdFactory: factory("wrong-key"),
  });
  await assert.rejects(denied.openRemote({ ...reopened.input, masterKey: wrongKey }));

  const largeManifest = manifests.find(file => JSON.parse(fs.readFileSync(file, "utf8")).count > 40);
  assert.ok(largeManifest);
  fs.unlinkSync(path.join(path.dirname(largeManifest), "0"));
  const damaged = await fresh(f, "damaged");
  const rejected = await damaged.c.PocketStarlingMaterializeShadow.materializeAccepted(damaged.opened.session);
  assert.equal(rejected.ok, false);
  assert.equal(Object.hasOwn(rejected, "document"), false);
  assert.equal(f.remote.head.revision, 1);
});

test("one payload edit and a targeted inverse use Head CAS across fragmented storage", async t => {
  const f = await fixture(t);
  const first = await fresh(f, "writer");
  const before = await payload(first, "n0");
  const edited = originalText.slice(0, 4000) + "insert 🪶" + originalText.slice(6000, 9900)
    + "replacement e\u0301" + originalText.slice(16000);
  const one = await transaction(first, "edit");
  assert.equal((await one.savePayload({ nodeId: "n0", payload: { ...before, details: edited } })).outcome, "committed");
  assert.equal(f.remote.head.revision, 2);
  const second = await fresh(f, "independent");
  assert.deepEqual(await payload(second, "n0"), { ...before, details: edited });
  const other = await payload(second, "n1");
  const unrelated = await transaction(second, "other");
  assert.equal((await unrelated.savePayload({ nodeId: "n1", payload: { ...other, details: "Independent edit" } })).outcome, "committed");
  const third = await fresh(f, "inverse-reader");
  const inverse = await transaction(third, "inverse");
  assert.equal((await inverse.savePayload({ nodeId: "n0", payload: before })).outcome, "committed");
  assert.equal(f.remote.head.revision, 4);
  const final = await fresh(f, "final");
  assert.deepEqual(await payload(final, "n0"), before);
  assert.deepEqual(await payload(final, "n1"), { ...other, details: "Independent edit" });
});

test("interrupted and lost-ack saves reconcile without half acceptance and reject the stale writer", async t => {
  const f = await fixture(t);
  const reader = await fresh(f, "writer");
  const before = await payload(reader, "n0");
  const changed = { ...before, details: "Amended\n" + originalText };
  const previous = plain(f.remote.head);
  const interrupted = await transaction(reader, "interrupted", {
    ...reader.service,
    async compareAndSetShadowHead() { throw new Error("synthetic interruption before Head acceptance"); },
  });
  assert.equal((await interrupted.savePayload({ nodeId: "n0", payload: changed })).outcome, "ambiguous");
  assert.deepEqual(plain(f.remote.head), previous);
  assert.equal((await interrupted.reconcileAmbiguous()).outcome, "not-committed");
  assert.deepEqual(await payload(await fresh(f, "survivor"), "n0"), before);

  const lostReply = await transaction(reader, "lost");
  f.remote.mode = "apply";
  assert.equal((await lostReply.savePayload({ nodeId: "n0", payload: changed })).outcome, "ambiguous");
  f.remote.mode = "normal";
  assert.equal((await lostReply.reconcileAmbiguous()).outcome, "committed");
  assert.equal(f.remote.head.revision, previous.revision + 1);
  const stale = await transaction(reader, "stale");
  assert.equal((await stale.savePayload({ nodeId: "n0", payload: { ...before, details: "Stale" } })).outcome, "conflict");
  assert.equal(f.remote.head.revision, previous.revision + 1);
  assert.deepEqual(await payload(await fresh(f, "reconciled"), "n0"), changed);
});

test("the existing mirrored legacy intake still fails closed at the opt-in guard", () => {
  const c = harness.runtime();
  const source = { schema: "portal.export.v1", writtenAt: time, exportedAt: time, pocketGuard: guard,
    mainThoughtTree: nodes, mainThoughtTreeTombstones: tombstones,
    data: { mainThoughtTree: nodes, mainThoughtTreeTombstones: tombstones, pocketGuard: guard } };
  const lossy = c.normaliseInput(source);
  assert.equal(lossy.nodes.filter((node, index) => node.label !== nodes[index].label).length, 24);
  assert.equal(lossy.nodes.slice(0, 4).filter(node => !Object.hasOwn(node, "peMigrationLegacySourcePreserved")).length, 4);
  assert.equal(preflightLegacyMigration(JSON.stringify(source)).reason, "label-would-change");
  const compact = nodes.map((node, index) => ({ ...node, label: `Short ${index}`, details: "Short text" }));
  const capsuleInput = { ...source, mainThoughtTree: compact, data: { ...source.data, mainThoughtTree: compact } };
  assert.equal(preflightLegacyMigration(JSON.stringify(capsuleInput)).reason, "source-capsule-would-change");
});
