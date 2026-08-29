"use strict";
const test = require("node:test"),
  assert = require("node:assert/strict"),
  fs = require("node:fs"),
  path = require("node:path"),
  vm = require("node:vm"),
  { webcrypto } = require("node:crypto");

const ROOT = path.resolve(__dirname, ".."),
  MODULE = "js/pocket-starling-storage-shadow.js",
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
    MODULE,
  ];

function source(file) {
  return fs.readFileSync(path.join(ROOT, file), "utf8");
}

function context() {
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
    console: { log() {}, info() {}, warn() {}, error() {} },
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
    vm.runInContext(source(file), c, { filename: file });
  return c;
}

function normalised(nodes) {
  return {
    schema: "portal.mtt.web.v1",
    writtenAt: "2026-08-29T00:00:00.000Z",
    nodes,
    tombstones: [{ id: "gone" }],
    rootExtras: { rootMarker: true },
    dataExtras: { dataMarker: true },
  };
}

function rootNodes(count) {
  return Array.from({ length: count }, (_, index) => ({
    id: `n${index}`,
    parentId: "root",
    order: index * 10,
    label: `Node ${String(index).padStart(4, "0")}`,
    value: index,
  }));
}

function stateFor(c, nodes) {
  const encoded = c.PocketStarlingBridgeShadow.encode(normalised(nodes), {
    capacity: 4,
  });
  assert.equal(encoded.ok, true);
  const built = c.PocketStarlingRootShadow.build(encoded.bridge);
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
    envelopeContext = {
      syncedPocketId: "pocket-p113-tests",
      envelopeId: "device-envelope",
      envelopeKind: "device",
      envelopeVersion: 1,
    },
    bundle = await c.PocketSyncCrypto.createMasterKeyBundle([
      { context: envelopeContext, wrappingKey },
    ]);
  return bundle.masterKey;
}

const storageContext = (syncedPocketId = "pocket-p113-tests") => ({
  syncedPocketId,
});

async function physicalGenesis(c, logicalStager, logical, key) {
  return c.PocketStarlingStorageShadow.stageCandidate({
    sealRef: logical.sealRef,
    resolveLogical: (ref) => logicalStager.store.get(ref),
    masterKey: key,
    context: storageContext(),
  });
}

function physicalConfirm(c, stage, store) {
  let calls = 0;
  const result = c.PocketStarlingStorageShadow.verifyNewRecordPresence(
    stage,
    (ref) => {
      calls += 1;
      return store.has(ref);
    },
  );
  assert.equal(result.ok, true, JSON.stringify(result));
  assert.equal(result.checked, stage.newRecords.length);
  assert.equal(calls, stage.newRecords.length);
}

function publicStore(...stages) {
  return new Map(
    stages.flatMap((stage) =>
      stage.newRecords.map((entry) => [entry.storageRef, entry.record]),
    ),
  );
}

function frontierBytes(stager, stage) {
  return new Map(stage.newRefs.map((ref) => [ref, stager.store.get(ref)]));
}

async function capsuleAt(c, store, storageRef, key) {
  const bytes = await c.PocketStarlingCryptoShadow.openObject(
    store.get(storageRef),
    storageRef,
    key,
    storageContext(),
  );
  return c.PocketStarlingStorageShadow.validateCapsuleBytes(bytes);
}

async function capsuleIndex(c, store, storageRefs, key) {
  const result = new Map();
  for (const storageRef of storageRefs) {
    const capsule = await capsuleAt(c, store, storageRef, key);
    result.set(capsule.logicalRef, { storageRef, capsule });
  }
  return result;
}

function linkFor(capsule, logicalRef) {
  return capsule.links.find((link) => link.logicalRef === logicalRef);
}

async function expectCode(promise, code) {
  await assert.rejects(promise, (error) => error && error.code === code);
}

function cachedRef(stager, sourceObject, kind) {
  const refs = stager.cache.get(sourceObject);
  return refs && refs.get(kind);
}

test("P113 proves bounded authenticated reuse across fresh runtimes", async () => {
  const runtimeA = context(),
    state = stateFor(runtimeA, rootNodes(2000)),
    logicalStager = runtimeA.PocketStarlingObjectSealShadow.createStager(),
    logicalBase = logicalStage(runtimeA, logicalStager, state);
  logicalConfirm(runtimeA, logicalStager, logicalBase);
  const key = await masterKey(runtimeA),
    physicalBase = await physicalGenesis(
      runtimeA,
      logicalStager,
      logicalBase,
      key,
    ),
    baseStore = publicStore(physicalBase);
  physicalConfirm(runtimeA, physicalBase, baseStore);
  const baseBytes = new Map(
      [...baseStore].map(([ref, record]) => [ref, JSON.stringify(record)]),
    ),
    targetNodeId = "n1337",
    edited = runtimeA.PocketStarlingRootShadow.editPayload(
      state,
      targetNodeId,
      { label: "P113 changed", value: 1337 },
    );
  assert.equal(edited.ok, true);
  const logicalNext = logicalStage(
    runtimeA,
    logicalStager,
    edited.state,
    logicalBase,
  );
  logicalConfirm(runtimeA, logicalStager, logicalNext);
  const nextFrontier = frontierBytes(logicalStager, logicalNext),
    runtimeB = context(),
    fetched = new Set();
  let physicalFetches = 0;
  const resolver = await runtimeB.PocketStarlingStorageShadow.createResolver({
    acceptedSealStorageRef: physicalBase.sealStorageRef,
    acceptedBaseComplete: true,
    resolveStorage(ref) {
      physicalFetches += 1;
      fetched.add(ref);
      return baseStore.get(ref);
    },
    masterKey: key,
    context: storageContext(),
  });
  assert.equal(physicalFetches, 1);
  const freshBaseProof = resolver.createReuseProof();
  assert.equal(physicalFetches, 1);
  assert.equal(Object.isFrozen(freshBaseProof), true);
  assert.deepEqual(Object.getOwnPropertyNames(freshBaseProof), []);
  assert.equal(JSON.stringify(freshBaseProof), "{}");

  const readOnlyResolver =
    await runtimeB.PocketStarlingStorageShadow.createResolver({
      acceptedSealStorageRef: physicalBase.sealStorageRef,
      acceptedBaseComplete: false,
      resolveStorage: (ref) => baseStore.get(ref),
      masterKey: key,
      context: storageContext(),
    });
  assert.equal((await readOnlyResolver.openAccepted()).ok, true);
  assert.throws(
    () => readOnlyResolver.createReuseProof(),
    (error) => error && error.code === "accepted-base-completeness-required",
  );

  const opened = await resolver.openAccepted();
  assert.equal(opened.ok, true, JSON.stringify(opened));
  assert.ok(physicalFetches <= 2, `${physicalFetches} open fetches`);
  assert.ok(physicalFetches * 100 < baseStore.size);
  const storage = runtimeB.PocketStarlingStorageShadow,
    freshInput = (proof, refs = logicalNext.newRefs, overrides = {}) => ({
      sealRef: logicalNext.sealRef,
      resolveLogical: (ref) => nextFrontier.get(ref),
      masterKey: key,
      context: storageContext(),
      freshBaseProof: proof,
      newLogicalRefs: refs,
      ...overrides,
    });
  await expectCode(
    storage.stageCandidate(freshInput({ ...freshBaseProof })),
    "fresh-base-invalid",
  );
  await expectCode(
    storage.stageCandidate({
      sealRef: logicalNext.sealRef,
      resolveLogical: (ref) => nextFrontier.get(ref),
      masterKey: key,
      context: storageContext(),
      freshBaseProof,
    }),
    "new-logical-frontier-invalid",
  );
  const beforeUnavailable = physicalFetches;
  await expectCode(
    storage.stageCandidate(freshInput(freshBaseProof)),
    "base-binding-unavailable",
  );
  assert.equal(physicalFetches, beforeUnavailable);

  const read = await resolver.readContent(opened.handle, targetNodeId);
  assert.equal(read.ok, true, JSON.stringify(read));
  assert.equal(read.payload.label, "Node 1337");
  assert.ok(physicalFetches < 40, `${physicalFetches} path fetches`);
  assert.ok(physicalFetches * 50 < baseStore.size);
  const afterReadFetches = physicalFetches,
    loadedIndex = await capsuleIndex(runtimeB, baseStore, fetched, key),
    loadedBindings = new Map(),
    physicalNext = await storage.stageCandidate(freshInput(freshBaseProof));
  for (const entry of loadedIndex.values()) {
    loadedBindings.set(entry.capsule.logicalRef, entry.storageRef);
    for (const link of entry.capsule.links)
      loadedBindings.set(link.logicalRef, link.storageRef);
  }
  assert.equal(physicalFetches, afterReadFetches);
  assert.ok(physicalNext.newRecords.length < 30);
  assert.equal(
    physicalNext.newRecords.length,
    physicalNext.diagnostics.newEncryptions,
  );
  assert.ok(physicalNext.diagnostics.exactReuseHits > 0);
  const nextStore = publicStore(physicalNext),
    combinedStore = new Map([...baseStore, ...nextStore]);
  physicalConfirm(runtimeB, physicalNext, combinedStore);
  assert.equal(
    combinedStore.size,
    baseStore.size + physicalNext.newRecords.length,
  );

  const nextIndex = await capsuleIndex(
      runtimeB,
      nextStore,
      nextStore.keys(),
      key,
    ),
    baseSeal = await capsuleAt(
      runtimeB,
      baseStore,
      physicalBase.sealStorageRef,
      key,
    ),
    baseRootLink = linkFor(baseSeal, logicalBase.rootRef),
    baseRoot = await capsuleAt(
      runtimeB,
      baseStore,
      baseRootLink.storageRef,
      key,
    ),
    nextRoot = nextIndex.get(logicalNext.rootRef).capsule,
    nextSeal = nextIndex.get(logicalNext.sealRef).capsule;
  for (const logicalRef of [
    logicalBase.rootObject.placementRef,
    logicalBase.rootObject.childrenRef,
    logicalBase.rootObject.preservationRef,
  ])
    assert.equal(
      linkFor(nextRoot, logicalRef).storageRef,
      linkFor(baseRoot, logicalRef).storageRef,
    );
  assert.equal(
    linkFor(nextSeal, logicalBase.sealRef).storageRef,
    physicalBase.sealStorageRef,
  );
  const nextRefSet = new Set(logicalNext.newRefs),
    oldContentLink = [...nextIndex.values()]
      .filter((entry) => entry.capsule.logicalKind === "content-trie")
      .flatMap((entry) => entry.capsule.links)
      .find(
        (link) =>
          !nextRefSet.has(link.logicalRef) &&
          loadedBindings.has(link.logicalRef),
      );
  assert.ok(oldContentLink, "expected an unchanged loaded content subtree");
  assert.equal(
    oldContentLink.storageRef,
    loadedBindings.get(oldContentLink.logicalRef),
  );
  for (const [ref, bytes] of baseBytes)
    assert.equal(JSON.stringify(baseStore.get(ref)), bytes);

  const redundant = await storage.stageCandidate(
    freshInput(freshBaseProof, [
      ...logicalNext.newRefs,
      logicalBase.rootObject.placementRef,
    ]),
  );
  assert.equal(
    redundant.diagnostics.newEncryptions,
    physicalNext.diagnostics.newEncryptions,
  );
  const redundantStore = publicStore(redundant),
    redundantIndex = await capsuleIndex(
      runtimeB,
      redundantStore,
      redundantStore.keys(),
      key,
    );
  assert.equal(
    linkFor(
      redundantIndex.get(logicalNext.rootRef).capsule,
      logicalBase.rootObject.placementRef,
    ).storageRef,
    linkFor(baseRoot, logicalBase.rootObject.placementRef).storageRef,
  );

  const wrongKey = await masterKey(runtimeB);
  await expectCode(
    storage.stageCandidate(
      freshInput(freshBaseProof, logicalNext.newRefs, { masterKey: wrongKey }),
    ),
    "fresh-base-mismatch",
  );
  await expectCode(
    storage.stageCandidate(
      freshInput(freshBaseProof, logicalNext.newRefs, {
        context: storageContext("wrong-pocket"),
      }),
    ),
    "fresh-base-mismatch",
  );
  const badSealObject = {
      ...logicalNext.sealObject,
      previousSealRef: null,
    },
    badSealCanonical =
      runtimeA.PocketStarlingObjectSealShadow.canonical(badSealObject),
    badSealRef = runtimeA.PocketStarlingObjectSealShadow.refFor(
      "candidate-seal",
      badSealCanonical.bytes,
    ),
    badFrontier = new Map(nextFrontier);
  badFrontier.delete(logicalNext.sealRef);
  badFrontier.set(badSealRef, badSealCanonical.bytes);
  await expectCode(
    storage.stageCandidate({
      sealRef: badSealRef,
      resolveLogical: (ref) => badFrontier.get(ref),
      masterKey: key,
      context: storageContext(),
      freshBaseProof,
      newLogicalRefs: [
        ...logicalNext.newRefs.filter((ref) => ref !== logicalNext.sealRef),
        badSealRef,
      ],
    }),
    "candidate-lineage-mismatch",
  );

  const publicMaterial = JSON.stringify({
    token: freshBaseProof,
    stage: physicalNext,
    diagnostics: physicalNext.diagnostics,
  });
  for (const secret of [
    "proof-ref:",
    targetNodeId,
    "P113 changed",
    logicalBase.sealRef,
    logicalNext.sealRef,
  ])
    assert.equal(publicMaterial.includes(secret), false, secret);

  const runtimeC = context(),
    successorResolver =
      await runtimeC.PocketStarlingStorageShadow.createResolver({
        acceptedSealStorageRef: physicalNext.sealStorageRef,
        resolveStorage: (ref) => combinedStore.get(ref),
        masterKey: key,
        context: storageContext(),
      }),
    successorOpened = await successorResolver.openAccepted(),
    successorRead = await successorResolver.readContent(
      successorOpened.handle,
      targetNodeId,
    );
  assert.equal(successorRead.payload.label, "P113 changed");

  const secondEdit = runtimeA.PocketStarlingRootShadow.editPayload(
    edited.state,
    targetNodeId,
    { label: "P113 changed twice", value: 1337 },
  );
  assert.equal(secondEdit.ok, true);
  const logicalSecond = logicalStage(
    runtimeA,
    logicalStager,
    secondEdit.state,
    logicalNext,
  );
  logicalConfirm(runtimeA, logicalStager, logicalSecond);
  const secondFrontier = frontierBytes(logicalStager, logicalSecond),
    physicalSecond = await storage.stageCandidate({
      sealRef: logicalSecond.sealRef,
      resolveLogical: (ref) => secondFrontier.get(ref),
      masterKey: key,
      context: storageContext(),
      baseStage: physicalNext,
    });
  assert.ok(physicalSecond.newRecords.length < 30);
  assert.ok(
    physicalSecond.diagnostics.baseProofSteps >
      physicalSecond.diagnostics.inheritedLookups,
  );
  physicalConfirm(
    runtimeB,
    physicalSecond,
    new Map([...combinedStore, ...publicStore(physicalSecond)]),
  );
  await expectCode(
    storage.stageCandidate({
      sealRef: logicalSecond.sealRef,
      resolveLogical: (ref) => secondFrontier.get(ref),
      masterKey: key,
      context: storageContext(),
      baseStage: physicalNext,
      freshBaseProof,
      newLogicalRefs: logicalSecond.newRefs,
    }),
    "base-mode-invalid",
  );

  const targetRecordRef = cachedRef(
      logicalStager,
      runtimeA.PocketStarlingRootShadow.getContent(state, targetNodeId),
      "content-record",
    ),
    targetStorageRef = loadedBindings.get(targetRecordRef),
    damagedStore = new Map(baseStore);
  damagedStore.delete(targetStorageRef);
  const damagedSize = damagedStore.size,
    damagedResolver = await runtimeC.PocketStarlingStorageShadow.createResolver(
      {
        acceptedSealStorageRef: physicalBase.sealStorageRef,
        acceptedBaseComplete: true,
        resolveStorage: (ref) => damagedStore.get(ref),
        masterKey: key,
        context: storageContext(),
      },
    ),
    damagedOpened = await damagedResolver.openAccepted();
  damagedResolver.createReuseProof();
  await assert.rejects(
    damagedResolver.readContent(damagedOpened.handle, targetNodeId),
    (error) =>
      error &&
      ["object-record-invalid", "object-authentication-failed"].includes(
        error.code,
      ),
  );
  assert.equal(damagedStore.size, damagedSize);
});

test("P113 remains a dormant representation-only proof", () => {
  const moduleSource = source(MODULE);
  assert.equal(source("index.html").includes(MODULE), false);
  for (const forbidden of [
    "indexedDB",
    "localStorage",
    "fetch(",
    "XMLHttpRequest",
    "WebSocket",
    "conditionalUpload",
    "PocketStarlingHeadShadow",
    "document.",
  ])
    assert.equal(moduleSource.includes(forbidden), false, forbidden);
});
