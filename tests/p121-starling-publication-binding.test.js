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
    "js/pocket-starling-crypto-shadow.js",
    "js/pocket-starling-storage-shadow.js",
  ];

function runtime() {
  const c = {
    crypto: webcrypto,
    TextEncoder,
    TextDecoder,
    Uint8Array,
    ArrayBuffer,
    URL,
    Date,
    Math,
    JSON,
    Map,
    Set,
    WeakMap,
    WeakSet,
    Object,
    Array,
    String,
    Number,
    Boolean,
    Promise,
    Error,
    btoa: (value) => Buffer.from(value, "binary").toString("base64"),
    atob: (value) => Buffer.from(value, "base64").toString("binary"),
    localStorage: { getItem() {}, setItem() {}, removeItem() {} },
    document: {
      body: { classList: { add() {}, remove() {}, toggle() {} } },
      getElementById() {},
      addEventListener() {},
    },
    navigator: { clipboard: {} },
    location: { href: "https://example.test" },
    indexedDB: null,
    open() {},
    close() {},
    setTimeout() {
      return 1;
    },
    clearTimeout() {},
    requestAnimationFrame() {
      return 1;
    },
    cancelAnimationFrame() {},
  };
  c.window = c;
  c.globalThis = c;
  vm.createContext(c);
  for (const file of SCRIPTS)
    vm.runInContext(fs.readFileSync(path.join(ROOT, file), "utf8"), c, {
      filename: file,
    });
  return c;
}

function stateFor(c) {
  const encoded = c.PocketStarlingBridgeShadow.encode(
      {
        schema: "portal.mtt.web.v1",
        writtenAt: "2026-08-30T00:00:00.000Z",
        nodes: Array.from({ length: 8 }, (_, index) => ({
          id: `n${index}`,
          parentId: "root",
          order: index,
          label: `Node ${index}`,
          value: index,
        })),
        tombstones: [],
        rootExtras: {},
        dataExtras: {},
      },
      { capacity: 4 },
    ),
    built = c.PocketStarlingRootShadow.build(encoded.bridge);
  assert.equal(encoded.ok, true);
  assert.equal(built.ok, true);
  return built.state;
}

function logicalStage(c, stager, state, base = null) {
  const result = c.PocketStarlingObjectSealShadow.stageCandidate(
    stager,
    state,
    base
      ? { previousSealRef: base.sealRef, baseStage: base }
      : { previousSealRef: null },
  );
  assert.equal(result.ok, true, JSON.stringify(result));
  return result.stage;
}

function logicalConfirm(c, stager, stage) {
  const result = c.PocketStarlingObjectSealShadow.verifyNewObjectPresence(
    stage,
    (ref) => stager.store.has(ref),
    stage.sealObject.previousSealRef === null ? {} : { baseComplete: true },
  );
  assert.equal(result.ok, true, JSON.stringify(result));
}

async function masterKey(c) {
  const wrappingKey = await c.PocketSyncCrypto.generateDeviceWrappingKey(),
    bundle = await c.PocketSyncCrypto.createMasterKeyBundle([
      {
        context: {
          syncedPocketId: "p121a",
          envelopeId: "device-envelope",
          envelopeKind: "device",
          envelopeVersion: 1,
        },
        wrappingKey,
      },
    ]);
  return bundle.masterKey;
}

const storageContext = () => ({ syncedPocketId: "p121a" });

async function physicalStage(c, stager, logical, key, baseStage = null) {
  return c.PocketStarlingStorageShadow.stageCandidate({
    sealRef: logical.sealRef,
    resolveLogical: (ref) => stager.store.get(ref),
    masterKey: key,
    context: storageContext(),
    ...(baseStage ? { baseStage } : {}),
  });
}

function publicStore(...stages) {
  return new Map(
    stages.flatMap((stage) =>
      stage.newRecords.map((entry) => [entry.storageRef, entry.record]),
    ),
  );
}

function physicalConfirm(c, stage, store) {
  const result = c.PocketStarlingStorageShadow.verifyNewRecordPresence(
    stage,
    (ref) => store.has(ref),
  );
  assert.equal(result.ok, true, JSON.stringify(result));
  assert.equal(result.checked, stage.newRecords.length);
}

function expectedBinding(stage, expectedSealStorageRef) {
  return {
    syncedPocketId: "p121a",
    expectedSealStorageRef,
    candidateSealStorageRef: stage.sealStorageRef,
    newRecordCount: stage.newRecords.length,
  };
}

function assertBinding(c, stage, expected) {
  const binding = c.PocketStarlingStorageShadow.publicationBinding(stage);
  assert.deepEqual(JSON.parse(JSON.stringify(binding)), expected);
  assert.deepEqual(Object.keys(binding), Object.keys(expected));
  assert.equal(Object.isFrozen(binding), true);
  return binding;
}

function assertPublicationRejected(c, stage) {
  const fields = expectedBinding(stage, null),
    candidates = [
      { ...fields },
      { ...stage },
      null,
      undefined,
      {},
      { unrelated: true },
      { ...fields, syncedPocketId: "forged-pocket" },
      { ...fields, expectedSealStorageRef: "forged-base" },
      { ...fields, candidateSealStorageRef: "forged-candidate" },
      { ...fields, newRecordCount: fields.newRecordCount + 1 },
    ];
  for (const candidate of candidates)
    assert.throws(
      () => c.PocketStarlingStorageShadow.publicationBinding(candidate),
      (error) => error && error.code === "publication-stage-invalid",
    );
}

test("P121a binds only authenticated initial, completed-base, and fresh-reuse stages", async () => {
  const runtimeA = runtime(),
    state = stateFor(runtimeA),
    stager = runtimeA.PocketStarlingObjectSealShadow.createStager(),
    logicalBase = logicalStage(runtimeA, stager, state),
    key = await masterKey(runtimeA),
    physicalBase = await physicalStage(runtimeA, stager, logicalBase, key);
  logicalConfirm(runtimeA, stager, logicalBase);

  assertBinding(runtimeA, physicalBase, expectedBinding(physicalBase, null));
  assertPublicationRejected(runtimeA, physicalBase);
  await assert.rejects(
    physicalStage(runtimeA, stager, logicalBase, key, physicalBase),
    (error) => error && error.code === "base-stage-incomplete",
  );

  const baseStore = publicStore(physicalBase);
  physicalConfirm(runtimeA, physicalBase, baseStore);

  const edited = runtimeA.PocketStarlingRootShadow.editPayload(state, "n3", {
      label: "P121a completed-base successor",
      value: 121,
    }),
    logicalNext = logicalStage(runtimeA, stager, edited.state, logicalBase),
    physicalNext = await physicalStage(
      runtimeA,
      stager,
      logicalNext,
      key,
      physicalBase,
    );
  assert.equal(edited.ok, true);
  logicalConfirm(runtimeA, stager, logicalNext);
  assertBinding(
    runtimeA,
    physicalNext,
    expectedBinding(physicalNext, physicalBase.sealStorageRef),
  );

  const freshEdited = runtimeA.PocketStarlingRootShadow.editPayload(
      state,
      "n3",
      { label: "P121a fresh successor", value: 1211 },
    ),
    logicalFresh = logicalStage(runtimeA, stager, freshEdited.state, logicalBase),
    frontier = new Map(
      logicalFresh.newRefs.map((ref) => [ref, stager.store.get(ref)]),
    ),
    runtimeB = runtime(),
    resolver = await runtimeB.PocketStarlingStorageShadow.createResolver({
      acceptedSealStorageRef: physicalBase.sealStorageRef,
      acceptedBaseComplete: true,
      resolveStorage: (ref) => baseStore.get(ref),
      masterKey: key,
      context: storageContext(),
    }),
    freshBaseProof = resolver.createReuseProof(),
    opened = await resolver.openAccepted();
  assert.equal(freshEdited.ok, true);
  logicalConfirm(runtimeA, stager, logicalFresh);
  assert.equal(opened.ok, true, JSON.stringify(opened));
  const read = await resolver.readContent(opened.handle, "n3");
  assert.equal(read.ok, true, JSON.stringify(read));

  const physicalFresh = await runtimeB.PocketStarlingStorageShadow.stageCandidate({
    sealRef: logicalFresh.sealRef,
    resolveLogical: (ref) => frontier.get(ref),
    masterKey: key,
    context: storageContext(),
    freshBaseProof,
    newLogicalRefs: logicalFresh.newRefs,
  });
  assert.notEqual(physicalBase.sealStorageRef, logicalBase.sealRef);
  assertBinding(
    runtimeB,
    physicalFresh,
    expectedBinding(physicalFresh, physicalBase.sealStorageRef),
  );
});
