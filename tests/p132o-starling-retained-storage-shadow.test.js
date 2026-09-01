"use strict";

const test = require("node:test"),
  assert = require("node:assert/strict"),
  fs = require("node:fs"),
  path = require("node:path"),
  vm = require("node:vm"),
  { webcrypto } = require("node:crypto"),
  ROOT = path.resolve(__dirname, ".."),
  SCRIPTS = [
    "js/pocket-state.js",
    "js/pocket-data.js",
    "js/pocket-outline-persistence-policy.js",
    "js/pocket-editor-metadata.js",
    "js/pocket-pe-import-preserve.js",
    "js/pocket-storage.js",
    "js/pocket-import.js",
    "js/pocket-starling-shadow.js",
    "js/pocket-starling-sequence-shadow.js",
    "js/pocket-starling-placement-shadow.js",
    "js/pocket-starling-bridge-shadow.js",
    "js/pocket-starling-root-shadow.js",
    "js/pocket-starling-object-seal-shadow.js",
    "js/pocket-sync-crypto.js",
    "js/pocket-starling-semantic-authority-shadow.js",
    "js/pocket-starling-crypto-shadow.js",
    "js/pocket-starling-storage-shadow.js",
  ];

function runtime() {
  const c = {
    crypto: webcrypto, TextEncoder, TextDecoder, Uint8Array, ArrayBuffer, URL,
    Date, Math, JSON, Map, Set, WeakMap, WeakSet, Object, Array, String,
    Number, Boolean, Promise, Error,
    btoa: (value) => Buffer.from(value, "binary").toString("base64"),
    atob: (value) => Buffer.from(value, "base64").toString("binary"),
    console: { log() {}, info() {}, warn() {}, error() {} },
    localStorage: { getItem() {}, setItem() {}, removeItem() {} },
    document: { body: { classList: { add() {}, remove() {}, toggle() {} } }, getElementById() {}, addEventListener() {} },
    navigator: { clipboard: {} }, location: { href: "https://example.test" },
    indexedDB: null, open() {}, close() {}, setTimeout() { return 1; },
    clearTimeout() {}, requestAnimationFrame() { return 1; }, cancelAnimationFrame() {},
  };
  c.window = c;
  c.globalThis = c;
  vm.createContext(c);
  for (const file of SCRIPTS)
    vm.runInContext(fs.readFileSync(path.join(ROOT, file), "utf8"), c, { filename: file });
  return c;
}

function retainedState(c) {
  const nodes = [
      { id: "current", parentId: "root", order: 0, label: "Current" },
      { id: "retained", parentId: "root", order: 1, label: "Literal retained" },
      { id: "retained-root", parentId: "root", order: 2, label: "Retained root" },
      { id: "retained-child", parentId: "retained-root", order: 0, label: "Retained child" },
    ],
    encoded = c.PocketStarlingBridgeShadow.encode({
      schema: "portal.mtt.web.v1", writtenAt: "2026-09-01T00:00:00.000Z",
      nodes, tombstones: [], rootExtras: {}, dataExtras: {},
    }, { capacity: 4 }),
    base = c.PocketStarlingRootShadow.build(encoded.bridge),
    relation = {
      nodeIds: nodes.map((node) => node.id),
      parents: { current: "root", retained: "root", "retained-root": "", "retained-child": "retained-root" },
      children: { root: ["current", "retained"], "": ["retained-root"], "retained-root": ["retained-child"] },
    },
    structural = c.PocketStarlingPlacementShadow.build(relation, { capacity: 4 }),
    components = {
      capacity: base.state.capacity, content: base.state.content,
      placements: structural.model.placements, children: structural.model.children,
      preservation: base.state.preservation,
    },
    witness = c.PocketStarlingRootShadow.diagnosticRootFor(components);
  assert.equal(encoded.ok, true, JSON.stringify(encoded));
  assert.equal(base.ok, true, JSON.stringify(base));
  assert.equal(structural.ok, true, JSON.stringify(structural));
  assert.equal(witness.ok, true, JSON.stringify(witness));
  return Object.freeze({
    schema: c.PocketStarlingRootShadow.SCHEMA, capacity: base.state.capacity,
    content: base.state.content, structural: structural.model,
    preservation: base.state.preservation, root: witness.root,
  });
}

function bytes(c, value) {
  const encoded = c.PocketStarlingObjectSealShadow.canonical(value);
  assert.equal(encoded.ok, true, JSON.stringify(encoded));
  return encoded.bytes;
}

function binding(seal, pocket, logicalSealRef = seal.sealRef) {
  const object = seal.sealObject || seal;
  return Object.freeze({
    syncedPocketId: pocket, logicalSealRef,
    logicalRootRef: object.rootRef,
    previousLogicalSealRef: object.previousSealRef,
    logicalSealSchema: "pocket.starling.candidate-seal.v1",
    logicalRootSchema: "pocket.starling.logical-root.v1",
    logicalObjectSchema: "pocket.starling.logical-object.v1",
    sequenceSchema: "pocket.starling.sequence-page.v2",
    placementGeneration: "pocket.starling.placement-relation.v1",
  });
}

test("P132o carries a genuine attested retained Placement through encrypted fresh Storage", async () => {
  const writer = runtime(), state = retainedState(writer), logical = writer.PocketStarlingObjectSealShadow,
    storage = writer.PocketStarlingStorageShadow, stager = logical.createStager(), staged = logical.stageCandidate(stager, state, { previousSealRef: null }),
    current = writer.PocketStarlingPlacementShadow.getPlacement(state.structural, "current"),
    retained = writer.PocketStarlingPlacementShadow.getPlacement(state.structural, "retained-root"),
    objectSchema = logical.OBJECT_SCHEMA;
  assert.equal(staged.ok, true, JSON.stringify(staged));
  assert.equal(logical.verifyNewObjectPresence(staged.stage, (ref) => stager.store.has(ref), {}).ok, true);
  assert.equal(logical.auditCandidateSeal(staged.stage.sealRef, (ref) => stager.store.get(ref)).ok, true);
  assert.equal(current.parentId, "root");
  assert.equal(retained.parentId, "");
  const currentRef = stager.cache.get(current).get("placement-record"),
    retainedRef = stager.cache.get(retained).get("placement-record");
  assert.equal(storage.describeLogical("placement-record", stager.store.get(currentRef)).logicalRef, currentRef);
  assert.equal(storage.describeLogical("placement-record", stager.store.get(retainedRef)).logicalRef, retainedRef);
  for (const invalid of [
    { schema: objectSchema, kind: "placement-record", nodeId: "", parentId: "" },
    { schema: objectSchema, kind: "placement-record", nodeId: "current", parentId: null },
    { schema: objectSchema, kind: "placement-record", nodeId: "current" },
    { schema: objectSchema, kind: "placement-record", nodeId: "current", parentId: "root", extra: true },
  ])
    assert.throws(() => storage.describeLogical("placement-record", bytes(writer, invalid)), (error) => error.code === "logical-object-invalid");
  assert.throws(() => storage.describeLogical("placement-record", `{"schema":"${objectSchema}","kind":"placement-record","nodeId":"current","parentId":"root"}`), (error) => error.code === "logical-object-invalid");

  const pocket = "p132o-retained", context = { syncedPocketId: pocket }, wrappingKey = await writer.PocketSyncCrypto.generateDeviceWrappingKey(),
    envelopeContext = { syncedPocketId: pocket, envelopeId: "device", envelopeKind: "device", envelopeVersion: 1 },
    bundle = await writer.PocketSyncCrypto.createMasterKeyBundle([{ context: envelopeContext, wrappingKey }], { semanticAuthority: true }),
    audit = logical.auditCandidateSeal(staged.stage.sealRef, (ref) => stager.store.get(ref)),
    issued = await writer.PocketStarlingSemanticAuthorityShadow.issueInitial({ authority: bundle.semanticAuthority, auditProof: logical.semanticAuditProvenance(audit) }),
    physical = await storage.stageCandidate({ sealRef: staged.stage.sealRef, resolveLogical: (ref) => stager.store.get(ref), masterKey: bundle.masterKey, context, semanticAuthority: bundle.semanticAuthority, semanticValidityProof: issued.proof }),
    records = new Map(physical.newRecords.map((entry) => [entry.storageRef, entry.record])),
    physicalPresence = storage.verifyNewRecordPresence(physical, (ref) => records.has(ref)),
    sealed = physical.newRecords.find((entry) => entry.storageRef === physical.sealStorageRef),
    sealedBytes = await writer.PocketStarlingCryptoShadow.openObject(sealed.record, sealed.storageRef, bundle.masterKey, context),
    capsule = storage.validateCapsuleBytes(sealedBytes);
  assert.equal(audit.ok, true, JSON.stringify(audit));
  assert.ok(logical.semanticAuditProvenance(audit));
  assert.equal(issued.ok, true, JSON.stringify(issued));
  assert.equal(physicalPresence.ok, true, JSON.stringify(physicalPresence));
  assert.equal(storage.publicationBinding(physical).candidateSealStorageRef, physical.sealStorageRef);
  assert.equal(capsule.logicalRef, staged.stage.sealRef);

  const unattested = await storage.stageCandidate({ sealRef: staged.stage.sealRef, resolveLogical: (ref) => stager.store.get(ref), masterKey: bundle.masterKey, context });
  assert.throws(() => storage.publicationBinding(unattested), (error) => error.code === "publication-semantic-validity-required");

  const reader = runtime(), reopened = await reader.PocketSyncCrypto.openMasterKeyBundle(bundle.envelopes[0].record, wrappingKey, envelopeContext, [], { semanticAuthority: true }),
    resolver = await reader.PocketStarlingStorageShadow.createResolver({
      acceptedSealStorageRef: physical.sealStorageRef, acceptedBaseComplete: true,
      resolveStorage: (ref) => records.get(ref), masterKey: reopened.masterKey, context,
    }),
    accepted = await resolver.openAccepted(),
    authenticated = await reader.PocketStarlingSemanticAuthorityShadow.authenticate({
      authority: reopened.semanticAuthority, semanticValidity: resolver.semanticValidity(),
      binding: binding(accepted.handle.seal, pocket, resolver.acceptedSealRef),
    }),
    retainedRead = await resolver.readPlacement(accepted.handle, "retained-root"),
    currentRead = await resolver.readPlacement(accepted.handle, "current"),
    literalRead = await resolver.readPlacement(accepted.handle, "retained");
  assert.equal(accepted.ok, true, JSON.stringify(accepted));
  assert.equal(authenticated.ok, true, JSON.stringify(authenticated));
  assert.equal(retainedRead.parentId, "");
  assert.equal(currentRead.parentId, "root");
  assert.equal(literalRead.parentId, "root");
});
