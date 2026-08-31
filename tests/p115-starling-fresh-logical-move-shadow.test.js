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

function structuredNodes(descendantCount = 1100, fillerCount = 900) {
  return [
    { id: "source", parentId: "root", order: 0, label: "Source" },
    { id: "dest", parentId: "root", order: 10, label: "Destination" },
    { id: "branch", parentId: "source", order: 0, label: "Branch" },
    {
      id: "source-sibling",
      parentId: "source",
      order: 10,
      label: "Source sibling",
    },
    {
      id: "destination-sibling",
      parentId: "dest",
      order: 0,
      label: "Destination sibling",
    },
    ...Array.from({ length: descendantCount }, (_, index) => ({
      id: `d${String(index).padStart(4, "0")}`,
      parentId: "branch",
      order: index,
      label: `Descendant ${index}`,
    })),
    ...Array.from({ length: fillerCount }, (_, index) => ({
      id: `u${String(index).padStart(4, "0")}`,
      parentId: "root",
      order: 100 + index,
      label: `Unrelated ${index}`,
    })),
  ];
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
      syncedPocketId: "pocket-p115-tests",
      envelopeId: "device-envelope",
      envelopeKind: "device",
      envelopeVersion: 1,
    },
    bundle = await c.PocketSyncCrypto.createMasterKeyBundle([
      { context: envelopeContext, wrappingKey },
    ]);
  return bundle.masterKey;
}

const storageContext = () => ({ syncedPocketId: "pocket-p115-tests" });

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

function cachedRef(stager, sourceObject, kind) {
  const refs = stager.cache.get(sourceObject);
  return refs && refs.get(kind);
}

function putLogical(c, store, kind, object) {
  const logical = c.PocketStarlingObjectSealShadow,
    encoded = logical.canonical(object);
  assert.equal(encoded.ok, true, JSON.stringify(encoded));
  const ref = logical.refFor(kind, encoded.bytes);
  store.set(ref, encoded.bytes);
  return ref;
}

function trieRef(c, store, kind, entries, prefix = "") {
  const logical = c.PocketStarlingObjectSealShadow,
    own = entries.has(prefix),
    nextKeys = [...new Set(
      [...entries.keys()]
        .filter((key) => key.length > prefix.length && key.startsWith(prefix))
        .map((key) => key[prefix.length]),
    )].sort((left, right) => left.localeCompare(right)),
    children = nextKeys.map((key) => ({
      key,
      ref: trieRef(c, store, kind, entries, prefix + key),
    }));
  return putLogical(c, store, kind, {
    schema: logical.OBJECT_SCHEMA,
    kind,
    hasValue: own,
    valueRef: own ? entries.get(prefix) : null,
    children,
  });
}

function manualFixture(c, options = {}) {
  const logical = c.PocketStarlingObjectSealShadow,
    store = new Map(),
    capacity = options.capacity || 4,
    placements = new Map(),
    placementParents = {
      branch: "source",
      source: "root",
      dest: "root",
      "source-sibling": "source",
      "destination-sibling": "dest",
      child: "branch",
    };
  for (const [nodeId, parentId] of Object.entries(placementParents)) {
    const recordNodeId =
      options.badPlacementNodeId === nodeId ? "wrong-node" : nodeId;
    placements.set(
      nodeId,
      putLogical(c, store, "placement-record", {
        schema: logical.OBJECT_SCHEMA,
        kind: "placement-record",
        nodeId: recordNodeId,
        parentId,
      }),
    );
  }
  let placementRef = trieRef(c, store, "placement-trie", placements);
  if (options.invalidPlacementTrie)
    placementRef = putLogical(c, store, "placement-trie", {
      schema: logical.OBJECT_SCHEMA,
      kind: "placement-trie",
      hasValue: false,
      valueRef: null,
      children: [
        { key: "x", ref: "proof-ref:v1:placement-trie:00000000" },
        { key: "x", ref: "proof-ref:v1:placement-trie:11111111" },
      ],
    });

  const leaf = (items, leafCapacity = capacity) =>
      putLogical(c, store, "sequence-leaf", {
        schema: logical.SEQUENCE_SCHEMA,
        kind: "sequence-leaf",
        capacity: leafCapacity,
        count: items.length,
        items,
      }),
    sourceLeafA = leaf(["branch"]),
    sourceLeafB = leaf(["source-sibling"]);
  let sourceSequenceRef;
  if (options.branchCountMismatch)
    sourceSequenceRef = putLogical(c, store, "sequence-branch", {
      schema: logical.SEQUENCE_SCHEMA,
      kind: "sequence-branch",
      capacity,
      count: 99,
      childRefs: [sourceLeafA, sourceLeafB],
    });
  else if (options.capacityMismatch)
    sourceSequenceRef = leaf(["branch", "source-sibling"], capacity + 1);
  else sourceSequenceRef = leaf(["branch", "source-sibling"]);
  const destSequenceRef = leaf(["destination-sibling"]),
    branchSequenceRef = leaf(["child"]),
    children = new Map([
      ["source", sourceSequenceRef],
      ["branch", branchSequenceRef],
    ]);
  if (!options.destinationWithoutSequence)
    children.set("dest", destSequenceRef);
  let childrenRef = trieRef(c, store, "children-trie", children);
  if (options.invalidChildrenTrie)
    childrenRef = putLogical(c, store, "children-trie", {
      schema: logical.OBJECT_SCHEMA,
      kind: "children-trie",
      hasValue: false,
      valueRef: null,
      children: [{ key: "too-long", ref: sourceSequenceRef }],
    });
  const rootRef = putLogical(c, store, "pocket-root", {
      schema: logical.ROOT_SCHEMA,
      kind: "pocket-root",
      capacity,
      contentRef: "proof-ref:v1:content-trie:00000000",
      placementRef,
      childrenRef,
      preservationRef: "proof-ref:v1:preservation:00000000",
    }),
    sealRef = putLogical(c, store, "candidate-seal", {
      schema: logical.SEAL_SCHEMA,
      kind: "candidate-seal",
      rootRef,
      previousSealRef: null,
    });
  return {
    store,
    sealRef,
    rootRef,
    placementRef,
    childrenRef,
    sourceSequenceRef,
    branchRecordRef: placements.get("branch"),
  };
}

async function openFixture(c, fixture, resolver = null) {
  return c.PocketStarlingLogicalEditShadow.createBase({
    acceptedSealRef: fixture.sealRef,
    resolveLogical: resolver || ((ref) => fixture.store.get(ref)),
  });
}

function expectFailure(result, reason) {
  assert.equal(result.ok, false, JSON.stringify(result));
  assert.equal(result.reason, reason, JSON.stringify(result));
  assert.equal("candidate" in result, false);
}

test("P115 proves a fresh huge-branch move and direct P113 handoff", async () => {
  const runtimeA = context(),
    state = stateFor(runtimeA, structuredNodes()),
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
  const oracleMove = runtimeA.PocketStarlingRootShadow.move(
    state,
    "branch",
    0,
    "dest",
    1,
  );
  assert.equal(oracleMove.ok, true, JSON.stringify(oracleMove));
  const oracle = logicalStage(
    runtimeA,
    logicalStager,
    oracleMove.state,
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
  assert.equal(opened.diagnostics.logicalFetches, 2);
  assert.ok(physicalFetches <= 2);
  const baseBytes = new Map(
      [...baseStore].map(([ref, record]) => [ref, JSON.stringify(record)]),
    ),
    result = await editor.move(opened.base, "branch", 0, "dest", 1);
  assert.equal(result.ok, true, JSON.stringify(result));
  const candidate = result.candidate;
  assert.equal(candidate.rootRef, oracle.rootRef);
  assert.equal(candidate.sealRef, oracle.sealRef);
  assert.deepEqual(
    [...candidate.newLogicalRefs].sort(),
    [...oracle.newRefs].sort(),
  );
  for (const ref of candidate.newLogicalRefs)
    assert.equal(candidate.resolveLogical(ref), logicalStager.store.get(ref));
  const structuralBound =
    12 * ("branch".length + "source".length + "dest".length + 4);
  assert.ok(candidate.newLogicalRefs.length < structuralBound);
  assert.ok(candidate.diagnostics.logicalFetches < structuralBound);
  assert.ok(physicalFetches < structuralBound);
  assert.ok(physicalFetches * 10 < baseStore.size);
  assert.equal(candidate.diagnostics.descendantReads, 0);
  assert.equal(
    JSON.stringify(candidate.diagnostics).includes("proof-ref:"),
    false,
  );

  const fetchedIndex = await capsuleIndex(runtimeB, baseStore, fetched, key),
    fetchedKinds = [...fetchedIndex.values()].map(
      (entry) => entry.capsule.logicalKind,
    );
  assert.equal(fetchedKinds.includes("content-trie"), false);
  assert.equal(fetchedKinds.includes("content-record"), false);
  const descendantRecord =
    runtimeA.PocketStarlingPlacementShadow.getPlacement(
      state.structural,
      "d0500",
    ),
    descendantPlacementRef = cachedRef(
      logicalStager,
      descendantRecord,
      "placement-record",
    ),
    branchChildren = runtimeA.PocketStarlingPlacementShadow.getChildrenRoot(
      state.structural,
      "branch",
    ),
    branchSequenceRef = cachedRef(
      logicalStager,
      branchChildren,
      `sequence-${branchChildren.kind}`,
    );
  assert.equal(fetchedIndex.has(descendantPlacementRef), false);
  assert.equal(candidate.newLogicalRefs.includes(descendantPlacementRef), false);
  assert.equal(candidate.newLogicalRefs.includes(branchSequenceRef), false);

  const rootObject = JSON.parse(candidate.resolveLogical(candidate.rootRef)),
    sealObject = JSON.parse(candidate.resolveLogical(candidate.sealRef));
  assert.equal(rootObject.contentRef, logicalBase.rootObject.contentRef);
  assert.equal(
    rootObject.preservationRef,
    logicalBase.rootObject.preservationRef,
  );
  assert.equal(sealObject.previousSealRef, logicalBase.sealRef);
  for (const [ref, bytes] of baseBytes)
    assert.equal(JSON.stringify(baseStore.get(ref)), bytes);

  const loadedBindings = new Map();
  for (const entry of fetchedIndex.values()) {
    loadedBindings.set(entry.capsule.logicalRef, entry.storageRef);
    for (const link of entry.capsule.links)
      loadedBindings.set(link.logicalRef, link.storageRef);
  }
  const beforeStageFetches = physicalFetches,
    physicalNext =
      await runtimeB.PocketStarlingStorageShadow.stageCandidate({
        sealRef: candidate.sealRef,
        resolveLogical: candidate.resolveLogical,
        masterKey: key,
        context: storageContext(),
        freshBaseProof,
        newLogicalRefs: candidate.newLogicalRefs,
      });
  assert.equal(physicalFetches, beforeStageFetches);
  assert.ok(physicalNext.newRecords.length < 100);
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
  for (const ref of [rootObject.contentRef, rootObject.preservationRef])
    assert.equal(
      linkFor(nextRoot, ref).storageRef,
      linkFor(baseRoot, ref).storageRef,
    );
  const newRefSet = new Set(candidate.newLogicalRefs),
    unchangedStructuralLink = [...nextIndex.values()]
      .filter((entry) =>
        [
          "placement-trie",
          "children-trie",
          "sequence-branch",
        ].includes(entry.capsule.logicalKind),
      )
      .flatMap((entry) => entry.capsule.links)
      .find(
        (link) =>
          !newRefSet.has(link.logicalRef) &&
          loadedBindings.has(link.logicalRef),
      );
  assert.ok(unchangedStructuralLink);
  assert.equal(
    unchangedStructuralLink.storageRef,
    loadedBindings.get(unchangedStructuralLink.logicalRef),
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
    successorPlacement = await successorResolver.readPlacement(
      successorOpened.handle,
      "branch",
    );
  assert.equal(successorPlacement.ok, true, JSON.stringify(successorPlacement));
  assert.equal(successorPlacement.parentId, "dest");
});

test("P115 preserves append/clamp and genuine empty-destination semantics", async () => {
  const c = context(),
    state = stateFor(c, structuredNodes(8, 8)),
    stager = c.PocketStarlingObjectSealShadow.createStager(),
    base = logicalStage(c, stager, state);
  logicalConfirm(c, stager, base);
  const editor = c.PocketStarlingLogicalEditShadow,
    opened = await editor.createBase({
      acceptedSealRef: base.sealRef,
      resolveLogical: (ref) => stager.store.get(ref),
    }),
    clamped = await editor.move(opened.base, "branch", 0, "dest", 99),
    appended = await editor.move(opened.base, "branch", 0, "dest"),
    oracleClampedState = c.PocketStarlingRootShadow.move(
      state,
      "branch",
      0,
      "dest",
      99,
    ).state,
    oracleClamped = logicalStage(c, stager, oracleClampedState, base);
  assert.equal(clamped.ok, true, JSON.stringify(clamped));
  assert.equal(appended.ok, true, JSON.stringify(appended));
  assert.equal(clamped.candidate.sealRef, oracleClamped.sealRef);
  assert.equal(appended.candidate.sealRef, oracleClamped.sealRef);

  const emptyState = stateFor(c, [
      { id: "source", parentId: "root", order: 0, label: "Source" },
      { id: "empty", parentId: "root", order: 1, label: "Empty" },
      { id: "branch", parentId: "source", order: 0, label: "Branch" },
    ]),
    emptyStager = c.PocketStarlingObjectSealShadow.createStager(),
    emptyBase = logicalStage(c, emptyStager, emptyState);
  logicalConfirm(c, emptyStager, emptyBase);
  const emptyOpened = await editor.createBase({
      acceptedSealRef: emptyBase.sealRef,
      resolveLogical: (ref) => emptyStager.store.get(ref),
    }),
    emptyMoved = await editor.move(
      emptyOpened.base,
      "branch",
      0,
      "empty",
      50,
    ),
    emptyOracleState = c.PocketStarlingRootShadow.move(
      emptyState,
      "branch",
      0,
      "empty",
      50,
    ).state,
    emptyOracle = logicalStage(c, emptyStager, emptyOracleState, emptyBase);
  assert.equal(emptyMoved.ok, true, JSON.stringify(emptyMoved));
  assert.equal(emptyMoved.candidate.rootRef, emptyOracle.rootRef);
  assert.equal(emptyMoved.candidate.sealRef, emptyOracle.sealRef);
  assert.deepEqual(
    [...emptyMoved.candidate.newLogicalRefs].sort(),
    [...emptyOracle.newRefs].sort(),
  );
});

test("P115 failures are bounded, exact and publish no candidate", async () => {
  const c = context(),
    fixture = manualFixture(c),
    opened = await openFixture(c, fixture),
    api = c.PocketStarlingLogicalEditShadow;
  assert.equal(opened.ok, true, JSON.stringify(opened));
  expectFailure(
    await api.move({ ...opened.base }, "branch", 0, "dest", 1),
    "invalid-base-token",
  );
  expectFailure(
    await api.move(opened.base, "", 0, "dest", 1),
    "invalid-node-id",
  );
  const beforeUnknownNode = api.diagnostics(opened.base).logicalFetches;
  expectFailure(
    await api.move(opened.base, "missing", 0, "dest", 1),
    "unknown-node",
  );
  assert.ok(
    api.diagnostics(opened.base).logicalFetches - beforeUnknownNode <=
      "missing".length + 1,
  );
  const beforeUnknownParent = api.diagnostics(opened.base).logicalFetches;
  expectFailure(
    await api.move(opened.base, "branch", 0, "missing", 1),
    "unknown-parent",
  );
  assert.ok(
    api.diagnostics(opened.base).logicalFetches - beforeUnknownParent <=
      "missing".length + 2,
  );
  expectFailure(
    await api.move(opened.base, "branch", 0, "source", 1),
    "same-parent-reorder-not-in-scope",
  );
  expectFailure(
    await api.move(opened.base, "branch", 0, "branch", 0),
    "move-would-cycle",
  );
  expectFailure(
    await api.move(opened.base, "branch", 0, "child", 0),
    "move-would-cycle",
  );
  expectFailure(
    await api.move(opened.base, "branch", 1, "dest", 0),
    "placement-membership-mismatch",
  );
  expectFailure(
    await api.move(opened.base, "branch", -1, "dest", 0),
    "placement-membership-mismatch",
  );

  const badRecord = manualFixture(c, { badPlacementNodeId: "branch" }),
    badRecordBase = await openFixture(c, badRecord);
  expectFailure(
    await api.move(badRecordBase.base, "branch", 0, "dest", 1),
    "invalid-placement-record",
  );
  const badPlacementTrie = manualFixture(c, { invalidPlacementTrie: true }),
    badPlacementBase = await openFixture(c, badPlacementTrie);
  expectFailure(
    await api.move(badPlacementBase.base, "branch", 0, "dest", 1),
    "invalid-placement-trie",
  );
  const badChildrenTrie = manualFixture(c, { invalidChildrenTrie: true }),
    badChildrenBase = await openFixture(c, badChildrenTrie);
  expectFailure(
    await api.move(badChildrenBase.base, "branch", 0, "dest", 1),
    "invalid-children-trie",
  );
  const badCapacity = manualFixture(c, { capacityMismatch: true }),
    badCapacityBase = await openFixture(c, badCapacity);
  expectFailure(
    await api.move(badCapacityBase.base, "branch", 0, "dest", 1),
    "invalid-sequence-object",
  );
  const badCount = manualFixture(c, { branchCountMismatch: true }),
    badCountBase = await openFixture(c, badCount);
  expectFailure(
    await api.move(badCountBase.base, "branch", 0, "dest", 1),
    "invalid-sequence-object",
  );

  for (const [targetRef, expected] of [
    [fixture.placementRef, "missing-logical-object"],
    [fixture.childrenRef, "missing-logical-object"],
    [fixture.sourceSequenceRef, "missing-logical-object"],
    [fixture.branchRecordRef, "missing-logical-object"],
  ]) {
    const missing = await openFixture(c, fixture, (ref) =>
      ref === targetRef ? undefined : fixture.store.get(ref),
    );
    assert.equal(missing.ok, true);
    expectFailure(
      await api.move(missing.base, "branch", 0, "dest", 1),
      expected,
    );
  }
  for (const targetRef of [
    fixture.placementRef,
    fixture.childrenRef,
    fixture.sourceSequenceRef,
    fixture.branchRecordRef,
  ]) {
    const throwing = await openFixture(c, fixture, (ref) => {
      if (ref === targetRef) throw new Error("structural resolver failure");
      return fixture.store.get(ref);
    });
    assert.equal(throwing.ok, true);
    expectFailure(
      await api.move(throwing.base, "branch", 0, "dest", 1),
      "logical-resolution-failed",
    );
  }
  const wrongBytes = await openFixture(c, fixture, (ref) =>
    ref === fixture.sourceSequenceRef ? "{}" : fixture.store.get(ref),
  );
  assert.equal(wrongBytes.ok, true);
  expectFailure(
    await api.move(wrongBytes.base, "branch", 0, "dest", 1),
    "logical-ref-mismatch",
  );
});

test("P115 remains dormant and adds no broader structural owner", () => {
  const moduleSource = source(MODULE);
  assert.equal(source("index.html").includes(MODULE), false);
  for (const forbidden of [
    "PocketStarlingRootShadow",
    "PocketStarlingPlacementShadow",
    "PocketStarlingSequenceShadow",
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
  for (const outOfScope of ["reorder(", "insert(", "delete(", "restore("])
    assert.equal(moduleSource.includes(outOfScope), false, outOfScope);
});
