"use strict";
const test = require("node:test"),
  assert = require("node:assert/strict"),
  fs = require("node:fs"),
  path = require("node:path"),
  vm = require("node:vm"),
  { webcrypto } = require("node:crypto");

const ROOT = path.resolve(__dirname, ".."),
  MODULE = "js/pocket-starling-logical-edit-shadow.js",
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
      syncedPocketId: "pocket-p114-tests",
      envelopeId: "device-envelope",
      envelopeKind: "device",
      envelopeVersion: 1,
    },
    bundle = await c.PocketSyncCrypto.createMasterKeyBundle([
      { context: envelopeContext, wrappingKey },
    ]);
  return bundle.masterKey;
}

const storageContext = () => ({ syncedPocketId: "pocket-p114-tests" });

async function physicalGenesis(c, logicalStager, logical, key) {
  return c.PocketStarlingStorageShadow.stageCandidate({
    sealRef: logical.sealRef,
    resolveLogical: (ref) => logicalStager.store.get(ref),
    masterKey: key,
    context: storageContext(),
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
  const index = new Map();
  for (const storageRef of storageRefs) {
    const capsule = await capsuleAt(c, store, storageRef, key);
    index.set(capsule.logicalRef, { storageRef, capsule });
  }
  return index;
}

function linkFor(capsule, logicalRef) {
  return capsule.links.find((link) => link.logicalRef === logicalRef);
}

function putLogical(c, store, kind, object) {
  const encoded = c.PocketStarlingObjectSealShadow.canonical(object);
  assert.equal(encoded.ok, true, JSON.stringify(encoded));
  const ref = c.PocketStarlingObjectSealShadow.refFor(kind, encoded.bytes);
  store.set(ref, encoded.bytes);
  return ref;
}

function wrapContent(c, store, contentRef, capacity = 4) {
  const logical = c.PocketStarlingObjectSealShadow,
    placeholder = (kind) => `proof-ref:v1:${kind}:00000000`,
    rootRef = putLogical(c, store, "pocket-root", {
      schema: logical.ROOT_SCHEMA,
      kind: "pocket-root",
      capacity,
      contentRef,
      placementRef: placeholder("placement-trie"),
      childrenRef: placeholder("children-trie"),
      preservationRef: placeholder("preservation"),
    }),
    sealRef = putLogical(c, store, "candidate-seal", {
      schema: logical.SEAL_SCHEMA,
      kind: "candidate-seal",
      rootRef,
      previousSealRef: null,
    });
  return { store, rootRef, sealRef };
}

function tinyBase(c, options = {}) {
  const logical = c.PocketStarlingObjectSealShadow,
    store = new Map(),
    nodeId = options.nodeId || "n1",
    recordRef = putLogical(c, store, "content-record", {
      schema: logical.OBJECT_SCHEMA,
      kind: "content-record",
      nodeId: options.recordNodeId || nodeId,
      payload: options.payload || { a: 1, b: 2 },
    });
  let ref = putLogical(c, store, "content-trie", {
    schema: logical.OBJECT_SCHEMA,
    kind: "content-trie",
    hasValue: true,
    valueRef: recordRef,
    children: [],
  });
  for (let index = nodeId.length - 1; index >= 0; index -= 1)
    ref = putLogical(c, store, "content-trie", {
      schema: logical.OBJECT_SCHEMA,
      kind: "content-trie",
      hasValue: false,
      valueRef: null,
      children: [{ key: nodeId[index], ref }],
    });
  return wrapContent(c, store, ref);
}

async function openTiny(c, fixture, resolver = null) {
  return c.PocketStarlingLogicalEditShadow.createBase({
    acceptedSealRef: fixture.sealRef,
    resolveLogical: resolver || ((ref) => fixture.store.get(ref)),
  });
}

test("P114 proves fresh object-native payload editing and direct P113 handoff", async () => {
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
  const targetNodeId = "n1337",
    newPayload = { label: "P114 changed", value: 1337 },
    oracleEdit = runtimeA.PocketStarlingRootShadow.editPayload(
      state,
      targetNodeId,
      newPayload,
    );
  assert.equal(oracleEdit.ok, true);
  const oracle = logicalStage(
    runtimeA,
    logicalStager,
    oracleEdit.state,
    logicalBase,
  );
  logicalConfirm(runtimeA, logicalStager, oracle);

  const runtimeB = context(),
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
    }),
    freshBaseProof = resolver.createReuseProof(),
    editor = runtimeB.PocketStarlingLogicalEditShadow,
    opened = await editor.createBase({
      acceptedSealRef: resolver.acceptedSealRef,
      resolveLogical: resolver.resolveLogical,
    });
  assert.equal(opened.ok, true, JSON.stringify(opened));
  assert.equal(Object.isFrozen(opened.base), true);
  assert.deepEqual(Object.getOwnPropertyNames(opened.base), []);
  assert.equal(JSON.stringify(opened.base), "{}");
  assert.equal(opened.diagnostics.logicalFetches, 2);
  assert.ok(physicalFetches <= 2, `${physicalFetches} initial fetches`);
  const beforeEditPhysicalFetches = physicalFetches,
    baseBytes = new Map(
      [...baseStore].map(([ref, record]) => [ref, JSON.stringify(record)]),
    ),
    result = await editor.editPayload(opened.base, targetNodeId, newPayload);
  assert.equal(result.ok, true, JSON.stringify(result));
  assert.equal(result.changed, true);
  const candidate = result.candidate;
  assert.equal(Object.isFrozen(candidate), true);
  assert.equal(candidate.rootRef, oracle.rootRef);
  assert.equal(candidate.sealRef, oracle.sealRef);
  assert.deepEqual(
    [...candidate.newLogicalRefs].sort(),
    [...oracle.newRefs].sort(),
  );
  assert.equal(
    new Set(candidate.newLogicalRefs).size,
    candidate.newLogicalRefs.length,
  );
  assert.ok(
    candidate.newLogicalRefs.length <= targetNodeId.length + 4,
    `${candidate.newLogicalRefs.length} logical frontier objects`,
  );
  for (const ref of candidate.newLogicalRefs)
    assert.equal(candidate.resolveLogical(ref), logicalStager.store.get(ref));
  assert.equal(candidate.resolveLogical(logicalBase.sealRef), undefined);
  assert.ok(physicalFetches < 40, `${physicalFetches} edit fetches`);
  assert.ok(physicalFetches > beforeEditPhysicalFetches);
  assert.ok(physicalFetches * 50 < baseStore.size);
  assert.equal(candidate.diagnostics.newLogicalObjectCount, oracle.newRefs.length);
  assert.equal(
    JSON.stringify(candidate.diagnostics).includes("proof-ref:"),
    false,
  );
  for (const [ref, bytes] of baseBytes)
    assert.equal(JSON.stringify(baseStore.get(ref)), bytes);

  const logical = runtimeB.PocketStarlingObjectSealShadow,
    rootObject = JSON.parse(candidate.resolveLogical(candidate.rootRef)),
    sealObject = JSON.parse(candidate.resolveLogical(candidate.sealRef));
  assert.equal(rootObject.placementRef, logicalBase.rootObject.placementRef);
  assert.equal(rootObject.childrenRef, logicalBase.rootObject.childrenRef);
  assert.equal(
    rootObject.preservationRef,
    logicalBase.rootObject.preservationRef,
  );
  assert.equal(sealObject.previousSealRef, logicalBase.sealRef);
  assert.equal(
    logical.refFor("pocket-root", candidate.resolveLogical(candidate.rootRef)),
    candidate.rootRef,
  );

  const beforeStageFetches = physicalFetches,
    loadedIndex = await capsuleIndex(runtimeB, baseStore, fetched, key),
    loadedBindings = new Map(),
    physicalNext =
      await runtimeB.PocketStarlingStorageShadow.stageCandidate({
        sealRef: candidate.sealRef,
        resolveLogical: candidate.resolveLogical,
        masterKey: key,
        context: storageContext(),
        freshBaseProof,
        newLogicalRefs: candidate.newLogicalRefs,
      });
  for (const entry of loadedIndex.values()) {
    loadedBindings.set(entry.capsule.logicalRef, entry.storageRef);
    for (const link of entry.capsule.links)
      loadedBindings.set(link.logicalRef, link.storageRef);
  }
  assert.equal(physicalFetches, beforeStageFetches);
  assert.ok(physicalNext.newRecords.length < 30);
  const nextStore = publicStore(physicalNext),
    combinedStore = new Map([...baseStore, ...nextStore]);
  physicalConfirm(runtimeB, physicalNext, combinedStore);

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
    baseRoot = await capsuleAt(
      runtimeB,
      baseStore,
      linkFor(baseSeal, logicalBase.rootRef).storageRef,
      key,
    ),
    nextSeal = await capsuleAt(
      runtimeB,
      nextStore,
      physicalNext.sealStorageRef,
      key,
    ),
    nextRoot = await capsuleAt(
      runtimeB,
      nextStore,
      linkFor(nextSeal, candidate.rootRef).storageRef,
      key,
    );
  for (const ref of [
    rootObject.placementRef,
    rootObject.childrenRef,
    rootObject.preservationRef,
  ])
    assert.equal(
      linkFor(nextRoot, ref).storageRef,
      linkFor(baseRoot, ref).storageRef,
    );
  assert.equal(
    linkFor(nextSeal, logicalBase.sealRef).storageRef,
    physicalBase.sealStorageRef,
  );
  const newRefSet = new Set(candidate.newLogicalRefs),
    unchangedContentLink = [...nextIndex.values()]
      .filter((entry) => entry.capsule.logicalKind === "content-trie")
      .flatMap((entry) => entry.capsule.links)
      .find(
        (link) =>
          !newRefSet.has(link.logicalRef) &&
          loadedBindings.has(link.logicalRef),
      );
  assert.ok(unchangedContentLink, "expected an unchanged content subtree");
  assert.equal(
    unchangedContentLink.storageRef,
    loadedBindings.get(unchangedContentLink.logicalRef),
  );

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
  assert.equal(successorRead.ok, true, JSON.stringify(successorRead));
  assert.equal(successorRead.payload.label, "P114 changed");
  assert.equal(successorRead.payload.value, 1337);
});

test("P114 fails closed for invalid bases, touched objects and payloads", async () => {
  const c = context(),
    api = c.PocketStarlingLogicalEditShadow,
    logical = c.PocketStarlingObjectSealShadow,
    fixture = tinyBase(c),
    opened = await openTiny(c, fixture);
  assert.equal(opened.ok, true, JSON.stringify(opened));
  assert.equal(
    (await api.editPayload({ ...opened.base }, "n1", { changed: true })).reason,
    "invalid-base-token",
  );
  assert.equal(
    (await api.editPayload(opened.base, "", { changed: true })).reason,
    "invalid-node-id",
  );
  assert.equal(
    (
      await api.createBase({
        acceptedSealRef: fixture.sealRef,
        resolveLogical: () => undefined,
      })
    ).reason,
    "missing-logical-object",
  );
  assert.equal(
    (
      await api.createBase({
        acceptedSealRef: fixture.sealRef,
        resolveLogical() {
          throw new Error("boom");
        },
      })
    ).reason,
    "logical-resolution-failed",
  );
  assert.equal(
    (
      await api.createBase({
        acceptedSealRef: fixture.sealRef,
        resolveLogical: () => Promise.reject(new Error("boom")),
      })
    ).reason,
    "logical-resolution-failed",
  );
  assert.equal(
    (
      await api.createBase({
        acceptedSealRef: fixture.sealRef,
        resolveLogical: () => "{}",
      })
    ).reason,
    "logical-ref-mismatch",
  );

  const invalidSealStore = new Map(),
    invalidSealRef = putLogical(c, invalidSealStore, "candidate-seal", {
      schema: logical.SEAL_SCHEMA,
      kind: "candidate-seal",
      rootRef: fixture.rootRef,
    });
  assert.equal(
    (
      await api.createBase({
        acceptedSealRef: invalidSealRef,
        resolveLogical: (ref) => invalidSealStore.get(ref),
      })
    ).reason,
    "invalid-seal",
  );
  assert.equal(
    (
      await api.createBase({
        acceptedSealRef: fixture.sealRef,
        resolveLogical: (ref) =>
          ref === fixture.rootRef ? undefined : fixture.store.get(ref),
      })
    ).reason,
    "missing-logical-object",
  );

  const invalidRootStore = new Map(),
    invalidRootRef = putLogical(c, invalidRootStore, "pocket-root", {
      schema: logical.ROOT_SCHEMA,
      kind: "pocket-root",
      capacity: 1,
      contentRef: "proof-ref:v1:content-trie:00000000",
      placementRef: "proof-ref:v1:placement-trie:00000000",
      childrenRef: "proof-ref:v1:children-trie:00000000",
      preservationRef: "proof-ref:v1:preservation:00000000",
    }),
    invalidRootSealRef = putLogical(
      c,
      invalidRootStore,
      "candidate-seal",
      {
        schema: logical.SEAL_SCHEMA,
        kind: "candidate-seal",
        rootRef: invalidRootRef,
        previousSealRef: null,
      },
    );
  assert.equal(
    (
      await api.createBase({
        acceptedSealRef: invalidRootSealRef,
        resolveLogical: (ref) => invalidRootStore.get(ref),
      })
    ).reason,
    "invalid-root",
  );

  const noncanonicalStore = new Map(),
    noncanonicalBytes =
      '{"schema":"pocket.starling.logical-object.v1", "kind":"content-trie","hasValue":false,"valueRef":null,"children":[]}',
    noncanonicalRef = logical.refFor("content-trie", noncanonicalBytes);
  noncanonicalStore.set(noncanonicalRef, noncanonicalBytes);
  const noncanonicalFixture = wrapContent(
      c,
      noncanonicalStore,
      noncanonicalRef,
    ),
    noncanonicalBase = await openTiny(c, noncanonicalFixture);
  assert.equal(noncanonicalBase.ok, true);
  assert.equal(
    (await api.editPayload(noncanonicalBase.base, "x", {})).reason,
    "noncanonical-logical-object",
  );

  const malformedStore = new Map(),
    malformedRef = putLogical(c, malformedStore, "content-trie", {
      schema: logical.OBJECT_SCHEMA,
      kind: "content-trie",
      hasValue: false,
      valueRef: null,
      children: [
        { key: "x", ref: "proof-ref:v1:content-trie:00000000" },
        { key: "x", ref: "proof-ref:v1:content-trie:11111111" },
      ],
    }),
    malformedFixture = wrapContent(c, malformedStore, malformedRef),
    malformedBase = await openTiny(c, malformedFixture);
  assert.equal(malformedBase.ok, true);
  assert.equal(
    (await api.editPayload(malformedBase.base, "x", {})).reason,
    "invalid-content-trie",
  );

  const mismatchFixture = tinyBase(c, {
      nodeId: "n1",
      recordNodeId: "other",
    }),
    mismatchBase = await openTiny(c, mismatchFixture);
  assert.equal(mismatchBase.ok, true);
  assert.equal(
    (await api.editPayload(mismatchBase.base, "n1", {})).reason,
    "invalid-content-record",
  );

  const missingTouchedBase = await openTiny(
    c,
    fixture,
    (ref) =>
      ref === JSON.parse(fixture.store.get(fixture.rootRef)).contentRef
        ? undefined
        : fixture.store.get(ref),
  );
  assert.equal(missingTouchedBase.ok, true);
  assert.equal(
    (await api.editPayload(missingTouchedBase.base, "n1", {})).reason,
    "missing-logical-object",
  );

  const throwingTouchedBase = await openTiny(c, fixture, (ref) => {
    if (ref === JSON.parse(fixture.store.get(fixture.rootRef)).contentRef)
      throw new Error("touched resolver failure");
    return fixture.store.get(ref);
  });
  assert.equal(throwingTouchedBase.ok, true);
  assert.equal(
    (await api.editPayload(throwingTouchedBase.base, "n1", {})).reason,
    "logical-resolution-failed",
  );

  const wrongTouchedBase = await openTiny(c, fixture, (ref) => {
    if (ref === JSON.parse(fixture.store.get(fixture.rootRef)).contentRef)
      return "{}";
    return fixture.store.get(ref);
  });
  assert.equal(wrongTouchedBase.ok, true);
  assert.equal(
    (await api.editPayload(wrongTouchedBase.base, "n1", {})).reason,
    "logical-ref-mismatch",
  );

  const beforeUnknown = api.diagnostics(opened.base).logicalFetches;
  assert.equal(
    (await api.editPayload(opened.base, "n2", {})).reason,
    "unknown-node",
  );
  assert.ok(
    api.diagnostics(opened.base).logicalFetches - beforeUnknown <= 3,
  );
  const beforeUnsupported = api.diagnostics(opened.base).logicalFetches,
    cyclic = {};
  cyclic.self = cyclic;
  for (const payload of [cyclic, { n: Infinity }, { f() {} }, Symbol("x")])
    assert.equal(
      (await api.editPayload(opened.base, "n1", payload)).reason,
      "unsupported-payload-material",
    );
  assert.equal(api.diagnostics(opened.base).logicalFetches, beforeUnsupported);

  const noChange = await api.editPayload(opened.base, "n1", { b: 2, a: 1 });
  assert.equal(noChange.ok, true);
  assert.equal(noChange.changed, false);
  assert.equal(noChange.reason, "no-change");
  assert.equal("candidate" in noChange, false);
  assert.equal("newLogicalRefs" in noChange, false);
});

test("P114 remains a dormant logical-only proof", () => {
  const moduleSource = source(MODULE);
  assert.equal(source("index.html").includes(MODULE), false);
  for (const forbidden of [
    "PocketStarlingRootShadow",
    "PocketStarlingPlacementShadow",
    "PocketStarlingBridgeShadow",
    "createStager",
    "baseStage",
    "portal.export.v1",
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
