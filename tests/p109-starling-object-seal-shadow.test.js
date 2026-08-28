"use strict";
const test = require("node:test"),
  assert = require("node:assert/strict"),
  fs = require("node:fs"),
  path = require("node:path"),
  vm = require("node:vm");

const ROOT = path.resolve(__dirname, ".."),
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
  ];
const plain = (value) => JSON.parse(JSON.stringify(value));

function context() {
  const c = {
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
    console: { log() {}, info() {}, warn() {}, error() {} },
    localStorage: {
      getItem() {
        return null;
      },
      setItem() {},
      removeItem() {},
    },
    document: {
      body: { classList: { add() {}, remove() {}, toggle() {} } },
      getElementById() {
        return null;
      },
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
  return Array.from({ length: count }, (_, i) => ({
    id: `n${i}`,
    parentId: "root",
    order: i * 10,
    label: `Node ${String(i).padStart(4, "0")}`,
    value: i,
  }));
}

function canonicalIngress(c, norm) {
  c.norm = norm;
  c.writtenAt = "2026-08-29T12:00:00.000Z";
  c.payload = vm.runInContext(
    "buildCanonicalPocketPayload(norm,{writtenAt})",
    c,
  );
  return vm.runInContext("normaliseInput(payload)", c);
}

function stateFor(c, norm, canonical = false) {
  const input = canonical ? canonicalIngress(c, norm) : norm,
    encoded = c.PocketStarlingBridgeShadow.encode(input, { capacity: 4 });
  assert.equal(encoded.ok, true);
  const built = c.PocketStarlingRootShadow.build(encoded.bridge);
  assert.equal(built.ok, true);
  return built.state;
}

function resolverFor(stager) {
  return (ref) => stager.store.get(ref);
}

function stage(api, stager, state, previousSealRef = null) {
  const result = api.stageCandidate(stager, state, { previousSealRef });
  assert.equal(result.ok, true);
  return result.stage;
}

function rawPut(api, entries, kind, object) {
  const encoded = api.canonical(object);
  assert.equal(encoded.ok, true);
  const ref = api.refFor(kind, encoded.bytes);
  entries.set(ref, encoded.bytes);
  return ref;
}

test("P109 stages canonical ingress as fixed Root and Seal objects", () => {
  const c = context(),
    api = c.PocketStarlingObjectSealShadow,
    state = stateFor(
      c,
      normalised([
        { id: "a", parentId: "root", order: 20, label: "A" },
        { id: "b", parentId: "root", order: 10, label: "B" },
      ]),
      true,
    ),
    stager = api.createStager(),
    staged = stage(api, stager, state);

  assert.deepEqual(Object.keys(staged.rootObject).sort(), [
    "capacity",
    "childrenRef",
    "contentRef",
    "kind",
    "placementRef",
    "preservationRef",
    "schema",
  ]);
  assert.deepEqual(Object.keys(staged.sealObject).sort(), [
    "kind",
    "previousSealRef",
    "rootRef",
    "schema",
  ]);
  assert.equal("newRefs" in staged.rootObject, false);
  assert.equal("manifest" in staged.rootObject, false);
  assert.equal("newRefs" in staged.sealObject, false);
  assert.equal("manifest" in staged.sealObject, false);
  assert.match(staged.rootRef, /^proof-ref:v1:pocket-root:/);
  assert.equal(api.acceptSeal, undefined);
  assert.equal(api.authoriseSeal, undefined);
  assert.equal(
    api.verifyNewObjectPresence(staged, (ref) => stager.store.has(ref)).ok,
    true,
  );
  assert.equal(
    api.auditCandidateSeal(staged.sealRef, resolverFor(stager)).ok,
    true,
  );

  const opened = api.openFromAcceptedSealRef(
    staged.sealRef,
    resolverFor(stager),
  );
  assert.equal(opened.ok, true);
  assert.equal(opened.diagnostics.fetches, 2);
  assert.equal(api.readContent(opened.handle, "a").payload.label, "A");
  assert.equal(api.readPlacement(opened.handle, "a").parentId, "root");
  assert.equal(api.readContent(opened.handle, "").reason, "invalid-node-id");
  assert.equal(
    fs
      .readFileSync(path.join(ROOT, "index.html"), "utf8")
      .includes("pocket-starling-object-seal-shadow.js"),
    false,
  );
});

test("P109 payload edits stage only the content frontier across 2000 nodes", () => {
  const c = context(),
    rootApi = c.PocketStarlingRootShadow,
    api = c.PocketStarlingObjectSealShadow,
    baseState = stateFor(c, normalised(rootNodes(2000))),
    stager = api.createStager(),
    base = stage(api, stager, baseState),
    oldEntries = new Map(api.exportEntries(stager)),
    edited = rootApi.editPayload(baseState, "n2", {
      label: "changed",
      value: 2,
    });
  assert.equal(edited.ok, true);
  const successor = stage(api, stager, edited.state, base.sealRef);

  assert.notEqual(successor.rootObject.contentRef, base.rootObject.contentRef);
  assert.equal(successor.rootObject.placementRef, base.rootObject.placementRef);
  assert.equal(successor.rootObject.childrenRef, base.rootObject.childrenRef);
  assert.equal(
    successor.rootObject.preservationRef,
    base.rootObject.preservationRef,
  );
  for (const [ref, bytes] of oldEntries)
    assert.equal(stager.store.get(ref), bytes);
  const frontierBound = 3 * ("n2".length + 1) + 8;
  assert.ok(successor.diagnostics.newObjectCount <= frontierBound);
  assert.equal(
    api.verifyNewObjectPresence(successor, (ref) => stager.store.has(ref), {
      baseComplete: true,
    }).ok,
    true,
  );
  assert.equal(
    api.verifyNewObjectPresence(successor, (ref) => stager.store.has(ref))
      .reason,
    "base-completeness-required",
  );
  assert.equal(
    api.auditCandidateSeal(successor.sealRef, resolverFor(stager)).ok,
    true,
  );
});

test("P109 reorder stages a bounded children frontier and preserves full order", () => {
  const c = context(),
    rootApi = c.PocketStarlingRootShadow,
    placementApi = c.PocketStarlingPlacementShadow,
    sequenceApi = c.PocketStarlingSequenceShadow,
    api = c.PocketStarlingObjectSealShadow,
    baseState = stateFor(c, normalised(rootNodes(1024))),
    stager = api.createStager(),
    base = stage(api, stager, baseState),
    oldSequence = placementApi.getChildrenRoot(baseState.structural, "root"),
    reordered = rootApi.reorder(baseState, "n0", 0, 5);
  assert.equal(reordered.ok, true);
  const successor = stage(api, stager, reordered.state, base.sealRef);

  assert.equal(successor.rootObject.contentRef, base.rootObject.contentRef);
  assert.equal(successor.rootObject.placementRef, base.rootObject.placementRef);
  assert.notEqual(
    successor.rootObject.childrenRef,
    base.rootObject.childrenRef,
  );
  assert.equal(
    successor.rootObject.preservationRef,
    base.rootObject.preservationRef,
  );
  const audited = api.auditCandidateSeal(
    successor.sealRef,
    resolverFor(stager),
  );
  assert.equal(audited.ok, true);
  const expected = rootNodes(1024).map((node) => node.id);
  expected.splice(0, 1);
  expected.splice(4, 0, "n0");
  assert.deepEqual(
    plain(
      placementApi.audit(audited.candidate.structural).relation.children.root,
    ),
    expected,
  );
  const frontierBound =
    8 * (2 * (sequenceApi.height(oldSequence) + 1) + "root".length + 2);
  assert.ok(successor.diagnostics.newObjectCount <= frontierBound);
});

test("P109 branch moves do not restage descendants or unrelated pages", () => {
  const c = context(),
    rootApi = c.PocketStarlingRootShadow,
    placementApi = c.PocketStarlingPlacementShadow,
    sequenceApi = c.PocketStarlingSequenceShadow,
    api = c.PocketStarlingObjectSealShadow,
    nodes = [
      { id: "source", parentId: "root", order: 1, label: "source" },
      { id: "dest", parentId: "root", order: 2, label: "dest" },
      { id: "branch", parentId: "source", order: 1, label: "branch" },
      { id: "unrelated", parentId: "root", order: 3, label: "unrelated" },
      {
        id: "unrelated-child",
        parentId: "unrelated",
        order: 1,
        label: "unrelated child",
      },
      ...Array.from({ length: 512 }, (_, i) => ({
        id: `d${i}`,
        parentId: "branch",
        order: i,
        label: `d${i}`,
      })),
    ],
    baseState = stateFor(c, normalised(nodes)),
    descendantContent = rootApi.getContent(baseState, "d400"),
    descendantPlacement = placementApi.getPlacement(
      baseState.structural,
      "d400",
    ),
    branchChildren = placementApi.getChildrenRoot(
      baseState.structural,
      "branch",
    ),
    unrelatedChildren = placementApi.getChildrenRoot(
      baseState.structural,
      "unrelated",
    ),
    unrelatedPage = sequenceApi.pages(unrelatedChildren).at(-1),
    sourceChildren = placementApi.getChildrenRoot(
      baseState.structural,
      "source",
    ),
    destinationChildren = placementApi.getChildrenRoot(
      baseState.structural,
      "dest",
    ),
    stager = api.createStager(),
    base = stage(api, stager, baseState),
    retainedRefs = [
      stager.cache.get(descendantContent),
      stager.cache.get(descendantPlacement),
      stager.cache.get(branchChildren),
      stager.cache.get(unrelatedChildren),
      stager.cache.get(unrelatedPage),
    ],
    moved = rootApi.move(baseState, "branch", 0, "dest", 0);
  assert.equal(moved.ok, true);
  const successor = stage(api, stager, moved.state, base.sealRef);

  assert.equal(successor.rootObject.contentRef, base.rootObject.contentRef);
  assert.notEqual(
    successor.rootObject.placementRef,
    base.rootObject.placementRef,
  );
  assert.notEqual(
    successor.rootObject.childrenRef,
    base.rootObject.childrenRef,
  );
  assert.equal(
    successor.rootObject.preservationRef,
    base.rootObject.preservationRef,
  );
  assert.deepEqual(
    [
      stager.cache.get(rootApi.getContent(moved.state, "d400")),
      stager.cache.get(
        placementApi.getPlacement(moved.state.structural, "d400"),
      ),
      stager.cache.get(
        placementApi.getChildrenRoot(moved.state.structural, "branch"),
      ),
      stager.cache.get(
        placementApi.getChildrenRoot(moved.state.structural, "unrelated"),
      ),
      stager.cache.get(unrelatedPage),
    ],
    retainedRefs,
  );
  const frontierBound =
    10 *
    ("branch".length +
      "source".length +
      "dest".length +
      sequenceApi.height(sourceChildren) +
      (destinationChildren ? sequenceApi.height(destinationChildren) : 0) +
      6);
  assert.ok(successor.diagnostics.newObjectCount <= frontierBound);
  assert.equal(
    api.auditCandidateSeal(successor.sealRef, resolverFor(stager)).ok,
    true,
  );
});

test("P109 fresh runtimes open only Seal and Root then fetch lazy paths", () => {
  const producer = context(),
    producerApi = producer.PocketStarlingObjectSealShadow,
    state = stateFor(producer, normalised(rootNodes(2000))),
    stager = producerApi.createStager(),
    missingHistory = "proof-ref:v1:candidate-seal:00000000",
    staged = stage(producerApi, stager, state, missingHistory),
    exported = plain(producerApi.exportEntries(stager)),
    consumer = context(),
    api = consumer.PocketStarlingObjectSealShadow,
    entries = new Map(exported),
    requested = [],
    resolver = (ref) => {
      requested.push(ref);
      return entries.get(ref);
    },
    opened = api.openFromAcceptedSealRef(staged.sealRef, resolver);

  assert.equal(opened.ok, true);
  assert.equal(opened.diagnostics.fetches, 2);
  assert.deepEqual(requested, [staged.sealRef, staged.rootRef]);
  assert.equal(requested.includes(missingHistory), false);
  const beforeContent = requested.length,
    content = api.readContent(opened.handle, "n1999"),
    contentFetches = requested.length - beforeContent;
  assert.equal(content.ok, true);
  assert.equal(content.payload.label, "Node 1999");
  assert.ok(contentFetches <= "n1999".length + 2);
  const beforeRepeat = requested.length;
  assert.equal(api.readContent(opened.handle, "n1999").ok, true);
  assert.equal(requested.length, beforeRepeat);
  const beforePlacement = requested.length,
    placement = api.readPlacement(opened.handle, "n1999");
  assert.equal(placement.ok, true);
  assert.equal(placement.parentId, "root");
  assert.ok(requested.length - beforePlacement <= "n1999".length + 2);
});

test("P109 rejects damaged graphs and semantic contradictions", () => {
  const c = context(),
    rootApi = c.PocketStarlingRootShadow,
    placementApi = c.PocketStarlingPlacementShadow,
    api = c.PocketStarlingObjectSealShadow,
    state = stateFor(c, normalised(rootNodes(8))),
    stager = api.createStager(),
    staged = stage(api, stager, state),
    sealDamage = new Map(api.exportEntries(stager));
  sealDamage.set(staged.sealRef, `${sealDamage.get(staged.sealRef)} `);
  assert.equal(
    api.openFromAcceptedSealRef(staged.sealRef, (ref) => sealDamage.get(ref))
      .reason,
    "object-ref-mismatch",
  );

  const missing = new Map(api.exportEntries(stager));
  missing.delete(staged.rootObject.contentRef);
  const missingOpen = api.openFromAcceptedSealRef(staged.sealRef, (ref) =>
    missing.get(ref),
  );
  assert.equal(missingOpen.ok, true);
  assert.equal(
    api.readContent(missingOpen.handle, "n0").reason,
    "missing-object",
  );

  const malformed = new Map(api.exportEntries(stager)),
    badTrieRef = rawPut(api, malformed, "content-trie", {
      schema: api.OBJECT_SCHEMA,
      kind: "content-trie",
      hasValue: false,
      valueRef: null,
      children: [],
      extra: true,
    }),
    badRoot = { ...staged.rootObject, contentRef: badTrieRef },
    badRootRef = rawPut(api, malformed, "pocket-root", badRoot),
    badSeal = { ...staged.sealObject, rootRef: badRootRef },
    badSealRef = rawPut(api, malformed, "candidate-seal", badSeal),
    malformedOpen = api.openFromAcceptedSealRef(badSealRef, (ref) =>
      malformed.get(ref),
    );
  assert.equal(malformedOpen.ok, true);
  assert.equal(
    api.readContent(malformedOpen.handle, "n0").reason,
    "invalid-trie-object",
  );

  const wrongShape = new Map(api.exportEntries(stager)),
    extraSealRef = rawPut(api, wrongShape, "candidate-seal", {
      ...staged.sealObject,
      extra: true,
    });
  assert.equal(
    api.openFromAcceptedSealRef(extraSealRef, (ref) => wrongShape.get(ref))
      .reason,
    "invalid-seal",
  );

  const relation = plain(placementApi.audit(state.structural).relation);
  relation.parents.n0 = "n1";
  relation.children.root = relation.children.root.filter((id) => id !== "n0");
  relation.children.n1 = ["n0"];
  const contradictory = placementApi.build(relation, { capacity: 4 }).model,
    candidate = {
      ...state,
      structural: Object.freeze({
        capacity: 4,
        placements: contradictory.placements,
        children: state.structural.children,
      }),
    },
    contradictionStager = api.createStager(),
    contradiction = stage(api, contradictionStager, candidate);
  assert.equal(
    api.openFromAcceptedSealRef(
      contradiction.sealRef,
      resolverFor(contradictionStager),
    ).ok,
    true,
  );
  assert.equal(
    api.auditCandidateSeal(
      contradiction.sealRef,
      resolverFor(contradictionStager),
    ).reason,
    "placement-membership-mismatch",
  );

  const unsupported = api.stageCandidate(api.createStager(), {
    ...state,
    preservation: { invalid: () => true },
  });
  assert.equal(unsupported.reason, "unsupported-proof-material");
  assert.equal(rootApi.auditCandidate(state).ok, true);
});

test("P109 completeness, retention, determinism and lineage stay separate", () => {
  const first = context(),
    firstApi = first.PocketStarlingObjectSealShadow,
    state = stateFor(first, normalised(rootNodes(32))),
    stager = firstApi.createStager(),
    genesis = stage(firstApi, stager, state),
    missingGenesisRef = genesis.newRefs.at(0);
  assert.equal(
    firstApi.verifyNewObjectPresence(
      genesis,
      (ref) => ref !== missingGenesisRef && stager.store.has(ref),
    ).reason,
    "missing-new-object",
  );

  const distantRecord = first.PocketStarlingRootShadow.getContent(state, "n31"),
    retainedRef = stager.cache.get(distantRecord),
    edited = first.PocketStarlingRootShadow.editPayload(state, "n2", {
      label: "changed",
    }),
    successor = stage(firstApi, stager, edited.state, genesis.sealRef);
  stager.store.delete(retainedRef);
  assert.equal(
    firstApi.verifyNewObjectPresence(
      successor,
      (ref) => stager.store.has(ref),
      { baseComplete: true },
    ).ok,
    true,
  );
  const retainedOpen = firstApi.openFromAcceptedSealRef(
    successor.sealRef,
    resolverFor(stager),
  );
  assert.equal(retainedOpen.ok, true);
  assert.equal(
    firstApi.readContent(retainedOpen.handle, "n31").reason,
    "missing-object",
  );

  const second = context(),
    third = context(),
    secondApi = second.PocketStarlingObjectSealShadow,
    thirdApi = third.PocketStarlingObjectSealShadow,
    secondState = stateFor(second, normalised(rootNodes(32))),
    thirdState = stateFor(third, normalised(rootNodes(32))),
    secondStage = stage(
      secondApi,
      secondApi.createStager(),
      secondState,
      "proof-ref:v1:candidate-seal:11111111",
    ),
    thirdStage = stage(
      thirdApi,
      thirdApi.createStager(),
      thirdState,
      "proof-ref:v1:candidate-seal:11111111",
    ),
    otherLineage = stage(
      thirdApi,
      thirdApi.createStager(),
      thirdState,
      "proof-ref:v1:candidate-seal:22222222",
    );
  assert.equal(secondStage.rootRef, thirdStage.rootRef);
  assert.equal(secondStage.sealRef, thirdStage.sealRef);
  assert.equal(otherLineage.rootRef, thirdStage.rootRef);
  assert.notEqual(otherLineage.sealRef, thirdStage.sealRef);

  const orderA = first.PocketStarlingRootShadow.editPayload(state, "n1", {
      a: 1,
      b: 2,
    }).state,
    orderB = first.PocketStarlingRootShadow.editPayload(state, "n1", {
      b: 2,
      a: 1,
    }).state,
    orderAStage = stage(firstApi, firstApi.createStager(), orderA),
    orderBStage = stage(firstApi, firstApi.createStager(), orderB);
  assert.equal(orderAStage.rootRef, orderBStage.rootRef);
  assert.equal(orderAStage.sealRef, orderBStage.sealRef);
});
