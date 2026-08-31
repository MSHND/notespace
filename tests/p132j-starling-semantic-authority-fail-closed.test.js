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
  "js/pocket-sync-crypto.js", "js/pocket-starling-crypto-shadow.js",
  "js/pocket-starling-storage-shadow.js", "js/pocket-starling-head-shadow.js",
  "js/pocket-starling-logical-edit-shadow.js", "js/pocket-starling-publication-shadow.js", "js/pocket-starling-remote-open-shadow.js",
  "js/pocket-starling-remote-edit-shadow.js", "js/pocket-starling-remote-save-shadow.js",
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

function logicalStage(c) {
  const encoded = c.PocketStarlingBridgeShadow.encode({ schema: "portal.mtt.web.v1", writtenAt: "2026-08-31T00:00:00.000Z",
      nodes: [{ id: "n1", parentId: "root", order: 0, label: "One", value: 1 }], tombstones: [], rootExtras: {}, dataExtras: {} }, { capacity: 4 }),
    built = c.PocketStarlingRootShadow.build(encoded.bridge), stager = c.PocketStarlingObjectSealShadow.createStager(),
    staged = c.PocketStarlingObjectSealShadow.stageCandidate(stager, built.state, { previousSealRef: null });
  assert.equal(encoded.ok, true); assert.equal(built.ok, true); assert.equal(staged.ok, true);
  return { stager, stage: staged.stage };
}

test("P132j fails closed when privileged Starling composition lacks semantic authority", async () => {
  const c = runtime(), { stager, stage } = logicalStage(c), context = { syncedPocketId: "p132j-pocket" },
    wrappingKey = await c.PocketSyncCrypto.generateDeviceWrappingKey(),
    bundle = await c.PocketSyncCrypto.createMasterKeyBundle([{ context: {
      syncedPocketId: context.syncedPocketId, envelopeId: "device", envelopeKind: "device", envelopeVersion: 1,
    }, wrappingKey }]), masterKey = bundle.masterKey,
    legacy = await c.PocketStarlingStorageShadow.stageCandidate({ sealRef: stage.sealRef,
      resolveLogical: (ref) => stager.store.get(ref), masterKey, context });

  assert.throws(() => c.PocketStarlingStorageShadow.publicationBinding(legacy),
    /publication-semantic-validity-required/);
  assert.equal((await c.PocketStarlingLogicalEditShadow.createBase({ acceptedSealRef: stage.sealRef,
    resolveLogical: (ref) => stager.store.get(ref), syncedPocketId: context.syncedPocketId,
    semanticAuthority: Object.freeze({}), semanticBaseProof: Object.freeze({}) })).reason,
  "logical-dependency-unavailable");

  let reads = 0, reuseCalls = 0;
  const service = { async readShadowHead() { reads += 1; return { head: null }; }, async getOpaqueObject() { reads += 1; return { present: false, record: null }; },
      putOpaqueObject() {}, objectPresence() {}, compareAndSetShadowHead() {} },
    opener = c.PocketStarlingRemoteOpenShadow.createRemoteOpener({ objectHeadService: service, operationIdFactory: () => "op" }),
    opened = Object.freeze({ outcome: "opened", head: Object.freeze({ schema: "pocket.starling.head.v1", revision: 1, sealRef: stage.sealRef }), session: Object.freeze({
      acceptedSealRef: stage.sealRef, semanticBaseProof: Object.freeze({}), resolveLogical: () => null,
      createReuseProof() { reuseCalls += 1; return Object.freeze({}); }, readContent() {}, readPlacement() {}, diagnostics() {},
    }) });
  await assert.rejects(opener.openRemote({ masterKey, context, semanticAuthority: Object.freeze({}) }), (error) => error.code === "remote-open-input-invalid");
  await assert.rejects(c.PocketStarlingRemoteEditShadow.createEditor({ opened, masterKey, context,
    semanticAuthority: Object.freeze({}) }), (error) => error.code === "remote-edit-input-invalid");
  await assert.rejects(c.PocketStarlingRemoteSaveShadow.createTransaction({ opened, masterKey, context, semanticAuthority: Object.freeze({}),
    objectHeadService: service, operationIdFactory: () => "save" }), (error) => error.code === "remote-edit-input-invalid");
  assert.equal(reads, 0); assert.equal(reuseCalls, 0);
});
