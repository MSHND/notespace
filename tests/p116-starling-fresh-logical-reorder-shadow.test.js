"use strict";
const test = require("node:test"),
  assert = require("node:assert/strict"),
  fs = require("node:fs"),
  path = require("node:path"),
  vm = require("node:vm"),
  { webcrypto } = require("node:crypto"),
  { createBase, semanticBase, authenticateResolver } = require("./helpers/starling-semantic-test.js");

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
    MODULE, "js/pocket-starling-semantic-authority-shadow.js",
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
    { id: "branch", parentId: "source", order: 12, label: "Branch" },
    ...Array.from({ length: 40 }, (_, index) => ({
      id: `s${String(index).padStart(2, "0")}`,
      parentId: "source",
      order: index < 12 ? index : index + 1,
      label: `Sibling ${index}`,
    })),
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
      syncedPocketId: "pocket-p116-tests",
      envelopeId: "device-envelope",
      envelopeKind: "device",
      envelopeVersion: 1,
    },
    bundle = await c.PocketSyncCrypto.createMasterKeyBundle([
      { context: envelopeContext, wrappingKey },
    ], { semanticAuthority: true });
  return { ...bundle, wrappingKey, envelopeContext, record: bundle.envelopes[0].record };
}

const storageContext = () => ({ syncedPocketId: "pocket-p116-tests" });

async function physicalGenesis(c, logicalStager, logical, key) {
  const audit = c.PocketStarlingObjectSealShadow.auditCandidateSeal(logical.sealRef,
      (ref) => logicalStager.store.get(ref)), auditProof = c.PocketStarlingObjectSealShadow.semanticAuditProvenance(audit),
    issued = await c.PocketStarlingSemanticAuthorityShadow.issueInitial({ authority: key.semanticAuthority, auditProof });
  assert.equal(audit.ok, true, JSON.stringify(audit)); assert.equal(issued.ok, true, JSON.stringify(issued));
  return c.PocketStarlingStorageShadow.stageCandidate({
    sealRef: logical.sealRef,
    resolveLogical: (ref) => logicalStager.store.get(ref),
    masterKey: key.masterKey,
    context: storageContext(),
    semanticAuthority: key.semanticAuthority,
    semanticValidityProof: issued.proof,
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
    key.masterKey || key,
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
    placements = new Map();
  for (const [nodeId, parentId] of Object.entries({
    parent: "root",
    alpha: "parent",
    branch: "parent",
    other: "parent",
    omega: "parent",
    child: "branch",
  })) {
    placements.set(
      nodeId,
      putLogical(c, store, "placement-record", {
        schema: logical.OBJECT_SCHEMA,
        kind: "placement-record",
        nodeId: options.badPlacementNodeId === nodeId ? "wrong-node" : nodeId,
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
    leafA = leaf(["alpha", "branch"]),
    leafB = leaf(["other", "omega"]);
  let parentSequenceRef;
  if (options.branchCountMismatch)
    parentSequenceRef = putLogical(c, store, "sequence-branch", {
      schema: logical.SEQUENCE_SCHEMA,
      kind: "sequence-branch",
      capacity,
      count: 99,
      childRefs: [leafA, leafB],
    });
  else if (options.capacityMismatch)
    parentSequenceRef = leaf(
      ["alpha", "branch", "other", "omega"],
      capacity + 1,
    );
  else if (options.malformedSequence)
    parentSequenceRef = putLogical(c, store, "sequence-leaf", {
      schema: logical.SEQUENCE_SCHEMA,
      kind: "sequence-leaf",
      capacity,
      count: 3,
      items: ["alpha", "branch", "other", "omega"],
    });
  else
    parentSequenceRef = putLogical(c, store, "sequence-branch", {
      schema: logical.SEQUENCE_SCHEMA,
      kind: "sequence-branch",
      capacity,
      count: 4,
      childRefs: [leafA, leafB],
    });
  const branchSequenceRef = leaf(["child"]),
    children = new Map([
      ["parent", parentSequenceRef],
      ["branch", branchSequenceRef],
    ]);
  let childrenRef = trieRef(c, store, "children-trie", children);
  if (options.invalidChildrenTrie)
    childrenRef = putLogical(c, store, "children-trie", {
      schema: logical.OBJECT_SCHEMA,
      kind: "children-trie",
      hasValue: false,
      valueRef: null,
      children: [{ key: "too-long", ref: parentSequenceRef }],
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
    parentSequenceRef,
    branchRecordRef: placements.get("branch"),
  };
}

async function openFixture(c, fixture, resolver = null) {
  const admission = await semanticBase(c, { acceptedSealRef: fixture.sealRef,
    resolveLogical: (ref) => fixture.store.get(ref), syncedPocketId: storageContext().syncedPocketId });
  return c.PocketStarlingLogicalEditShadow.createBase({ acceptedSealRef: fixture.sealRef,
    resolveLogical: resolver || ((ref) => fixture.store.get(ref)), ...admission });
}

function expectFailure(result, reason) {
  assert.equal(result.ok, false, JSON.stringify(result));
  assert.equal(result.reason, reason, JSON.stringify(result));
  assert.equal("candidate" in result, false);
}

test("P116 proves a fresh huge-branch reorder and direct P113 handoff", async () => {
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
  const oracleReorder = runtimeA.PocketStarlingRootShadow.reorder(
    state,
    "branch",
    12,
    31,
  );
  assert.equal(oracleReorder.ok, true, JSON.stringify(oracleReorder));
  const oracle = logicalStage(
    runtimeA,
    logicalStager,
    oracleReorder.state,
    logicalBase,
  );
  logicalConfirm(runtimeA, logicalStager, oracle);

  const runtimeB = context(),
    fetched = new Set();
  let physicalFetches = 0;
  const reopened = await runtimeB.PocketSyncCrypto.openMasterKeyBundle(
      key.record, key.wrappingKey, key.envelopeContext, [], { semanticAuthority: true }),
    resolver = await runtimeB.PocketStarlingStorageShadow.createResolver({
      acceptedSealStorageRef: physicalBase.sealStorageRef,
      acceptedBaseComplete: true,
      resolveStorage(ref) {
        physicalFetches += 1;
        fetched.add(ref);
        return baseStore.get(ref);
      },
      masterKey: reopened.masterKey,
      context: storageContext(),
    }),
    accepted = await resolver.openAccepted(),
    semanticBaseProof = await authenticateResolver(runtimeB, { resolver, accepted,
      authority: reopened.semanticAuthority, syncedPocketId: storageContext().syncedPocketId }),
    freshBaseProof = resolver.createReuseProof(),
    editor = runtimeB.PocketStarlingLogicalEditShadow,
    opened = await editor.createBase({
      acceptedSealRef: resolver.acceptedSealRef,
      resolveLogical: resolver.resolveLogical,
      syncedPocketId: storageContext().syncedPocketId,
      semanticAuthority: reopened.semanticAuthority,
      semanticBaseProof,
    });
  assert.equal(opened.ok, true, JSON.stringify(opened));
  assert.equal(opened.diagnostics.logicalFetches, 2);
  assert.ok(physicalFetches <= 2);
  const baseBytes = new Map(
      [...baseStore].map(([ref, record]) => [ref, JSON.stringify(record)]),
    ),
    result = await editor.reorder(opened.base, "branch", 12, 31);
  assert.equal(result.ok, true, JSON.stringify(result));
  assert.equal(result.changed, true);
  const candidate = result.candidate;
  assert.equal(candidate.rootRef, oracle.rootRef);
  assert.equal(candidate.sealRef, oracle.sealRef);
  assert.deepEqual(
    [...candidate.newLogicalRefs].sort(),
    [...oracle.newRefs].sort(),
  );
  for (const ref of candidate.newLogicalRefs)
    assert.equal(candidate.resolveLogical(ref), logicalStager.store.get(ref));
  const structuralBound = 12 * ("branch".length + "source".length + 8);
  assert.ok(candidate.newLogicalRefs.length < structuralBound);
  assert.ok(candidate.diagnostics.logicalFetches < structuralBound);
  assert.ok(physicalFetches < structuralBound);
  assert.ok(physicalFetches * 10 < baseStore.size);
  assert.equal(candidate.diagnostics.destinationAncestryReads, 0);
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
  assert.equal(rootObject.placementRef, logicalBase.rootObject.placementRef);
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
    physicalNext = await runtimeB.PocketStarlingStorageShadow.stageCandidate({
      sealRef: candidate.sealRef,
      resolveLogical: candidate.resolveLogical,
      masterKey: reopened.masterKey,
      context: storageContext(),
      freshBaseProof,
      newLogicalRefs: candidate.newLogicalRefs,
      semanticAuthority: reopened.semanticAuthority,
      semanticValidityProof: (await runtimeB.PocketStarlingSemanticAuthorityShadow.issueSuccessor({
        authority: reopened.semanticAuthority, semanticBaseProof, candidate,
      })).proof,
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
  for (const ref of [
    rootObject.contentRef,
    rootObject.placementRef,
    rootObject.preservationRef,
  ])
    assert.equal(
      linkFor(nextRoot, ref).storageRef,
      linkFor(baseRoot, ref).storageRef,
    );
  const newRefSet = new Set(candidate.newLogicalRefs),
    unchangedStructuralLink = [...nextIndex.values()]
      .filter((entry) =>
        ["children-trie", "sequence-branch"].includes(
          entry.capsule.logicalKind,
        ),
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
        masterKey: reopened.masterKey,
        context: storageContext(),
      }),
    successorOpened = await successorResolver.openAccepted(),
    successorPlacement = await successorResolver.readPlacement(
      successorOpened.handle,
      "branch",
    );
  assert.equal(successorOpened.ok, true, JSON.stringify(successorOpened));
  assert.equal(successorPlacement.ok, true, JSON.stringify(successorPlacement));
  assert.equal(successorPlacement.parentId, "source");

  const tinyState = stateFor(runtimeA, structuredNodes(1, 1)),
    tinyStager = runtimeA.PocketStarlingObjectSealShadow.createStager(),
    tinyBase = logicalStage(runtimeA, tinyStager, tinyState),
    tinyOpened = await createBase(runtimeB, { acceptedSealRef: tinyBase.sealRef,
      resolveLogical: (ref) => tinyStager.store.get(ref), syncedPocketId: storageContext().syncedPocketId }),
    tinyResult = await editor.reorder(tinyOpened.base, "branch", 12, 31);
  assert.equal(tinyResult.ok, true, JSON.stringify(tinyResult));
  assert.equal(
    tinyResult.candidate.newLogicalRefs.length,
    candidate.newLogicalRefs.length,
  );
});

test("P116 preserves append, clamp and no-change reorder semantics", async () => {
  const c = context(),
    state = stateFor(c, structuredNodes(8, 8)),
    stager = c.PocketStarlingObjectSealShadow.createStager(),
    base = logicalStage(c, stager, state);
  logicalConfirm(c, stager, base);
  const editor = c.PocketStarlingLogicalEditShadow,
    open = () => createBase(c, { acceptedSealRef: base.sealRef,
      resolveLogical: (ref) => stager.store.get(ref), syncedPocketId: storageContext().syncedPocketId }),
    clampedBase = await open(),
    appendedBase = await open(),
    clamped = await editor.reorder(clampedBase.base, "branch", 12, 999),
    appended = await editor.reorder(appendedBase.base, "branch", 12),
    oracleState = c.PocketStarlingRootShadow.reorder(
      state,
      "branch",
      12,
      999,
    ).state,
    oracle = logicalStage(c, stager, oracleState, base);
  assert.equal(clamped.ok, true, JSON.stringify(clamped));
  assert.equal(appended.ok, true, JSON.stringify(appended));
  assert.equal(clamped.candidate.sealRef, oracle.sealRef);
  assert.equal(appended.candidate.sealRef, oracle.sealRef);

  for (const toIndex of [12, 13]) {
    const opened = await open(),
      before = new Map(stager.store),
      noChange = await editor.reorder(opened.base, "branch", 12, toIndex);
    assert.equal(noChange.ok, true, JSON.stringify(noChange));
    assert.equal(noChange.changed, false);
    assert.equal(noChange.reason, "no-change");
    assert.equal(Object.isFrozen(noChange), true);
    assert.equal("candidate" in noChange, false);
    assert.equal("newLogicalRefs" in noChange, false);
    assert.deepEqual(new Map(stager.store), before);
  }
});

test("P116 failures are bounded, exact and publish no candidate", async () => {
  const c = context(),
    stager = c.PocketStarlingObjectSealShadow.createStager(),
    staged = logicalStage(c, stager, stateFor(c, structuredNodes(8, 8))),
    root = JSON.parse(stager.store.get(staged.rootRef)),
    fixture = { store: stager.store, sealRef: staged.sealRef, placementRef: root.placementRef, childrenRef: root.childrenRef },
    opened = await openFixture(c, fixture),
    api = c.PocketStarlingLogicalEditShadow,
    originalBytes = new Map(fixture.store);
  assert.equal(opened.ok, true, JSON.stringify(opened));
  expectFailure(
    await api.reorder({ ...opened.base }, "branch", 12, 27),
    "invalid-base-token",
  );
  for (const nodeId of ["", "root"])
    expectFailure(
      await api.reorder(opened.base, nodeId, 12, 27),
      "invalid-node-id",
    );
  expectFailure(
    await api.reorder(opened.base, "missing", 0, 1),
    "unknown-node",
  );
  for (const fromIndex of [1.5, -1, 4])
    expectFailure(
      await api.reorder(opened.base, "branch", fromIndex, 27),
      "placement-membership-mismatch",
    );
  expectFailure(
    await api.reorder(opened.base, "branch", 2, 27),
    "placement-membership-mismatch",
  );
  expectFailure(
    await api.move(opened.base, "branch", 12, "source", 4),
    "same-parent-reorder-not-in-scope",
  );

  for (const options of [
    { badPlacementNodeId: "branch" }, { invalidPlacementTrie: true }, { invalidChildrenTrie: true },
    { capacityMismatch: true }, { branchCountMismatch: true }, { malformedSequence: true },
  ]) { const broken = manualFixture(c, options); assert.equal(c.PocketStarlingObjectSealShadow.auditCandidateSeal(
    broken.sealRef, (ref) => broken.store.get(ref)).ok, false); }

  for (const targetRef of [
    fixture.placementRef,
    fixture.childrenRef,
  ]) {
    const missing = await openFixture(c, fixture, (ref) =>
      ref === targetRef ? undefined : fixture.store.get(ref),
    );
    assert.equal(missing.ok, true);
    expectFailure(
      await api.reorder(missing.base, "branch", 12, 27),
      "missing-logical-object",
    );
    const throwing = await openFixture(c, fixture, (ref) => {
      if (ref === targetRef) throw new Error("structural resolver failure");
      return fixture.store.get(ref);
    });
    assert.equal(throwing.ok, true);
    expectFailure(
      await api.reorder(throwing.base, "branch", 12, 27),
      "logical-resolution-failed",
    );
    const mismatched = await openFixture(c, fixture, (ref) =>
      ref === targetRef ? "{}" : fixture.store.get(ref),
    );
    assert.equal(mismatched.ok, true);
    expectFailure(
      await api.reorder(mismatched.base, "branch", 12, 27),
      "logical-ref-mismatch",
    );
  }
  assert.deepEqual(fixture.store, originalBytes);

  const successfulBase = await openFixture(c, fixture),
    successful = await api.reorder(successfulBase.base, "branch", 12, 27);
  assert.equal(successful.ok, true, JSON.stringify(successful));
  assert.deepEqual(
    Object.keys(successful.candidate).sort(),
    [
      "diagnostics",
      "newLogicalRefs",
      "resolveLogical",
      "rootRef",
      "sealRef",
    ],
  );
  for (const forbidden of [
    "manifest",
    "descendants",
    "sourceState",
    "authority",
    "baseStage",
  ])
    assert.equal(
      JSON.stringify(successful.candidate).includes(forbidden),
      false,
      forbidden,
    );
});

test("P116 remains dormant and adds no broader structural owner", () => {
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
  for (const outOfScope of ["insert(", "delete(", "restore(", "bulk("])
    assert.equal(moduleSource.includes(outOfScope), false, outOfScope);
});
