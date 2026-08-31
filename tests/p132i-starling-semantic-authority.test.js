"use strict";
const test = require("node:test"), assert = require("node:assert/strict"),
  fs = require("node:fs"), path = require("node:path"), vm = require("node:vm"),
  { webcrypto } = require("node:crypto"), ROOT = path.resolve(__dirname, "..");

const SCRIPTS = [
  "js/pocket-state.js", "js/pocket-data.js", "js/pocket-outline-persistence-policy.js",
  "js/pocket-editor-metadata.js", "js/pocket-pe-import-preserve.js", "js/pocket-storage.js",
  "js/pocket-import.js", "js/pocket-starling-shadow.js", "js/pocket-starling-sequence-shadow.js",
  "js/pocket-starling-placement-shadow.js", "js/pocket-starling-bridge-shadow.js",
  "js/pocket-starling-root-shadow.js", "js/pocket-starling-object-seal-shadow.js",
  "js/pocket-sync-crypto.js", "js/pocket-starling-semantic-authority-shadow.js",
  "js/pocket-starling-crypto-shadow.js", "js/pocket-starling-storage-shadow.js",
  "js/pocket-starling-head-shadow.js", "js/pocket-starling-logical-edit-shadow.js",
  "js/pocket-starling-remote-open-shadow.js",
];

function runtime() {
  const c = { crypto: webcrypto, TextEncoder, TextDecoder, Uint8Array, ArrayBuffer, URL, Date, Math, JSON,
    Map, Set, WeakMap, WeakSet, Object, Array, String, Number, Boolean, Promise, Error,
    btoa: (v) => Buffer.from(v, "binary").toString("base64"), atob: (v) => Buffer.from(v, "base64").toString("binary"),
    localStorage: { getItem() {}, setItem() {}, removeItem() {} },
    document: { body: { classList: { add() {}, remove() {}, toggle() {} } }, getElementById() {}, addEventListener() {} },
    navigator: { clipboard: {} }, location: { href: "https://example.test" }, indexedDB: null,
    open() {}, close() {}, setTimeout() { return 1; }, clearTimeout() {}, requestAnimationFrame() { return 1; }, cancelAnimationFrame() {} };
  c.window = c; c.globalThis = c; vm.createContext(c);
  for (const file of SCRIPTS) vm.runInContext(fs.readFileSync(path.join(ROOT, file), "utf8"), c, { filename: file });
  return c;
}

const context = () => ({ syncedPocketId: "p132i-pocket" });

function stateFor(c) {
  const encoded = c.PocketStarlingBridgeShadow.encode({ schema: "portal.mtt.web.v1", writtenAt: "2026-08-31T00:00:00.000Z",
    nodes: [
      { id: "n1", parentId: "root", order: 0, label: "One", value: 1 },
      { id: "n2", parentId: "root", order: 1, label: "Two", value: 2 },
      { id: "parent", parentId: "root", order: 2, label: "Parent", value: 3 },
      { id: "child", parentId: "parent", order: 0, label: "Child", value: 4 },
    ], tombstones: [], rootExtras: {}, dataExtras: {} }, { capacity: 4 }),
    built = c.PocketStarlingRootShadow.build(encoded.bridge);
  assert.equal(encoded.ok, true); assert.equal(built.ok, true); return built.state;
}

function stageLogical(c, stager, state, previousSealRef = null) {
  const staged = c.PocketStarlingObjectSealShadow.stageCandidate(stager, state, { previousSealRef });
  assert.equal(staged.ok, true, JSON.stringify(staged));
  const present = c.PocketStarlingObjectSealShadow.verifyNewObjectPresence(staged.stage,
    (ref) => stager.store.has(ref), previousSealRef === null ? {} : { baseComplete: true });
  assert.equal(present.ok, true, JSON.stringify(present)); return staged.stage;
}

async function bundleFor(c) {
  const wrappingKey = await c.PocketSyncCrypto.generateDeviceWrappingKey(), envelopeContext = {
    syncedPocketId: context().syncedPocketId, envelopeId: "device", envelopeKind: "device", envelopeVersion: 1,
  }, bundle = await c.PocketSyncCrypto.createMasterKeyBundle([{ context: envelopeContext, wrappingKey }], { semanticAuthority: true });
  return { wrappingKey, envelopeContext, bundle };
}

test("P132i issues, persists and re-authenticates exact semantic validity", async () => {
  const writer = runtime(), state = stateFor(writer), stager = writer.PocketStarlingObjectSealShadow.createStager(),
    logical = stageLogical(writer, stager, state), { wrappingKey, envelopeContext, bundle } = await bundleFor(writer),
    audit = writer.PocketStarlingObjectSealShadow.auditCandidateSeal(logical.sealRef, (ref) => stager.store.get(ref)),
    auditProof = writer.PocketStarlingObjectSealShadow.semanticAuditProvenance(audit),
    issued = await writer.PocketStarlingSemanticAuthorityShadow.issueInitial({ authority: bundle.semanticAuthority, auditProof });
  assert.equal(audit.ok, true, JSON.stringify(audit)); assert.ok(auditProof); assert.equal(issued.ok, true, JSON.stringify(issued));
  assert.deepEqual(Object.keys(bundle), ["masterKey", "envelopes", "semanticAuthority"]);
  assert.deepEqual(Object.getOwnPropertyNames(bundle.semanticAuthority), []);
  const ordinaryBundle = await writer.PocketSyncCrypto.createMasterKeyBundle([{ context: {
    syncedPocketId: context().syncedPocketId, envelopeId: "ordinary-device", envelopeKind: "device", envelopeVersion: 1,
  }, wrappingKey }]);
  assert.deepEqual(Object.keys(ordinaryBundle), ["masterKey", "envelopes"]);
  assert.equal(await writer.PocketStarlingSemanticAuthorityShadow.issueInitial({ authority: bundle.semanticAuthority, auditProof: {} }).then((v) => v.ok), false);
  const physical = await writer.PocketStarlingStorageShadow.stageCandidate({ sealRef: logical.sealRef,
    resolveLogical: (ref) => stager.store.get(ref), masterKey: bundle.masterKey, context: context(),
    semanticAuthority: bundle.semanticAuthority, semanticValidityProof: issued.proof });
  const present = writer.PocketStarlingStorageShadow.verifyNewRecordPresence(physical, () => true);
  assert.equal(present.ok, true); assert.ok(physical.sealStorageRef);
  assert.equal(writer.PocketStarlingStorageShadow.publicationBinding(physical).candidateSealStorageRef, physical.sealStorageRef);

  const legacy = await writer.PocketStarlingStorageShadow.stageCandidate({ sealRef: logical.sealRef,
    resolveLogical: (ref) => stager.store.get(ref), masterKey: bundle.masterKey, context: context() });
  assert.throws(() => writer.PocketStarlingStorageShadow.publicationBinding(legacy), /publication-semantic-validity-required/);

  const records = new Map(physical.newRecords.map((entry) => [entry.storageRef, entry.record])), reader = runtime(),
    reopened = await reader.PocketSyncCrypto.openMasterKeyBundle(bundle.envelopes[0].record, wrappingKey, envelopeContext, [], { semanticAuthority: true }),
    resolver = await reader.PocketStarlingStorageShadow.createResolver({ acceptedSealStorageRef: physical.sealStorageRef,
      acceptedBaseComplete: true, masterKey: reopened.masterKey, context: context(), resolveStorage: (ref) => records.get(ref) }),
    accepted = await resolver.openAccepted(), binding = Object.freeze({ syncedPocketId: context().syncedPocketId,
      logicalSealRef: resolver.acceptedSealRef, logicalRootRef: accepted.handle.seal.rootRef,
      previousLogicalSealRef: accepted.handle.seal.previousSealRef, logicalSealSchema: "pocket.starling.candidate-seal.v1",
      logicalRootSchema: "pocket.starling.logical-root.v1", logicalObjectSchema: "pocket.starling.logical-object.v1",
      sequenceSchema: "pocket.starling.sequence-page.v2", placementGeneration: "pocket.starling.placement-relation.v1" }),
    authenticated = await reader.PocketStarlingSemanticAuthorityShadow.authenticate({ authority: reopened.semanticAuthority,
      semanticValidity: resolver.semanticValidity(), binding });
  assert.equal(authenticated.ok, true, JSON.stringify(authenticated));
  const opener = reader.PocketStarlingRemoteOpenShadow.createRemoteOpener({
    objectHeadService: {
      async readShadowHead() { return { head: { schema: "pocket.starling.head.v1", revision: 1, sealRef: physical.sealStorageRef } }; },
      async getOpaqueObject({ storageRef }) { return { present: records.has(storageRef), record: records.get(storageRef) || null }; },
    }, operationIdFactory: (kind, index) => `${kind}-${index}`,
  });
  assert.deepEqual(Object.keys(reopened), ["masterKey", "envelopes", "semanticAuthority"]);
  assert.ok(reopened.semanticAuthority);
  const remoteInput = vm.runInContext("({ masterKey: null, context: null, semanticAuthority: null })", reader);
  remoteInput.masterKey = reopened.masterKey; remoteInput.context = context(); remoteInput.semanticAuthority = reopened.semanticAuthority;
  reader.__p132iOpener = opener; reader.__p132iInput = remoteInput;
  const remotelyOpened = await vm.runInContext("__p132iOpener.openRemote(__p132iInput)", reader);
  assert.equal(remotelyOpened.outcome, "opened"); assert.ok(remotelyOpened.session.semanticBaseProof);
  const base = await reader.PocketStarlingLogicalEditShadow.createBase({ acceptedSealRef: resolver.acceptedSealRef,
    resolveLogical: resolver.resolveLogical, syncedPocketId: context().syncedPocketId,
    semanticAuthority: reopened.semanticAuthority, semanticBaseProof: authenticated.semanticBaseProof });
  assert.equal(base.ok, true, JSON.stringify(base));
  assert.equal((await reader.PocketStarlingLogicalEditShadow.createBase({ acceptedSealRef: resolver.acceptedSealRef,
    resolveLogical: resolver.resolveLogical, syncedPocketId: context().syncedPocketId, semanticAuthority: reopened.semanticAuthority,
    semanticBaseProof: {} })).reason, "invalid-semantic-base");
  const unchanged = await reader.PocketStarlingLogicalEditShadow.editPayload(base.base, "n1", { label: "One", value: 1 });
  assert.deepEqual(JSON.parse(JSON.stringify(unchanged)), { ok: true, changed: false, reason: "no-change" });
  const edited = await reader.PocketStarlingLogicalEditShadow.editPayload(base.base, "n1", { label: "Changed", value: 20 }),
    successor = await reader.PocketStarlingSemanticAuthorityShadow.issueSuccessor({ authority: reopened.semanticAuthority,
      semanticBaseProof: authenticated.semanticBaseProof, candidate: edited.candidate });
  assert.equal(edited.ok, true, JSON.stringify(edited)); assert.equal(edited.changed, true); assert.equal(successor.ok, true, JSON.stringify(successor));
  const moved = await reader.PocketStarlingLogicalEditShadow.move(base.base, "child", 0, "root", 1),
    reordered = await reader.PocketStarlingLogicalEditShadow.reorder(base.base, "n1", 0, 2),
    inserted = await reader.PocketStarlingLogicalEditShadow.insert(base.base, {
      nodeId: "fresh", parentId: "root", toIndex: 1, payload: { label: "Fresh", value: 5 },
    });
  for (const result of [moved, reordered, inserted]) {
    assert.equal(result.ok, true, JSON.stringify(result));
    const propagated = await reader.PocketStarlingSemanticAuthorityShadow.issueSuccessor({ authority: reopened.semanticAuthority,
      semanticBaseProof: authenticated.semanticBaseProof, candidate: result.candidate });
    assert.equal(propagated.ok, true, JSON.stringify(propagated));
  }
  assert.equal((await reader.PocketStarlingSemanticAuthorityShadow.issueSuccessor({ authority: reopened.semanticAuthority,
    semanticBaseProof: authenticated.semanticBaseProof, candidate: { ...edited.candidate } })).ok, false);
  const bad = { ...resolver.semanticValidity(), syncedPocketId: "other-pocket" };
  assert.equal((await reader.PocketStarlingSemanticAuthorityShadow.authenticate({ authority: reopened.semanticAuthority,
    semanticValidity: bad, binding })).reason, "semantic-validity-invalid");
  assert.equal(fs.readFileSync(path.join(ROOT, "index.html"), "utf8").includes("pocket-starling-semantic-authority-shadow.js"), false);
});
