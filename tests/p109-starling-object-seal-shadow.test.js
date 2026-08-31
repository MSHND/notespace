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

function cachedRef(stager, source, kind) {
  const refs = stager.cache.get(source);
  return refs ? refs.get(kind) : null;
}

function stage(api, stager, state, baseStage = null) {
  const options = baseStage
      ? { previousSealRef: baseStage.sealRef, baseStage }
      : { previousSealRef: null },
    result = api.stageCandidate(stager, state, options);
  assert.equal(result.ok, true);
  return result.stage;
}

function confirm(api, stager, candidate) {
  const options =
      candidate.sealObject.previousSealRef === null
        ? {}
        : { baseComplete: true },
    result = api.verifyNewObjectPresence(
      candidate,
      (ref) => stager.store.has(ref),
      options,
    );
  assert.equal(result.ok, true);
  return candidate;
}

function rawPut(api, entries, kind, object) {
  const encoded = api.canonical(object);
  assert.equal(encoded.ok, true);
  const ref = api.refFor(kind, encoded.bytes);
  entries.set(ref, encoded.bytes);
  return ref;
}

function objectAt(entries, ref) {
  const bytes = entries.get(ref);
  assert.equal(typeof bytes, "string");
  return JSON.parse(bytes);
}

function rewriteTrieAt(api, entries, ref, key, mutate, offset = 0) {
  const object = objectAt(entries, ref);
  if (offset === key.length)
    return rawPut(api, entries, object.kind, mutate(object));
  const edgeIndex = object.children.findIndex(
    (edge) => edge.key === key[offset],
  );
  assert.notEqual(edgeIndex, -1);
  const childRef = rewriteTrieAt(
      api,
      entries,
      object.children[edgeIndex].ref,
      key,
      mutate,
      offset + 1,
    ),
    children = object.children.map((edge, index) =>
      index === edgeIndex ? { ...edge, ref: childRef } : edge,
    );
  return rawPut(api, entries, object.kind, { ...object, children });
}

function trieValueRefAt(entries, ref, key) {
  let object = objectAt(entries, ref);
  for (const character of key) {
    const edge = object.children.find((item) => item.key === character);
    assert.ok(edge);
    object = objectAt(entries, edge.ref);
  }
  assert.equal(object.hasValue, true);
  return object.valueRef;
}

function forgeRoot(api, entries, staged, rootObject) {
  const rootRef = rawPut(api, entries, "pocket-root", rootObject),
    sealObject = { ...staged.sealObject, rootRef },
    sealRef = rawPut(api, entries, "candidate-seal", sealObject);
  return { rootRef, sealRef, rootObject, sealObject };
}

function forgeComponent(api, entries, staged, field, componentRef) {
  return forgeRoot(api, entries, staged, {
    ...staged.rootObject,
    [field]: componentRef,
  });
}

function forgeSequence(api, entries, staged, mutate) {
  const sequenceRef = trieValueRefAt(
      entries,
      staged.rootObject.childrenRef,
      "root",
    ),
    sequence = objectAt(entries, sequenceRef),
    replacementRef = rawPut(api, entries, sequence.kind, mutate(sequence)),
    childrenRef = rewriteTrieAt(
      api,
      entries,
      staged.rootObject.childrenRef,
      "root",
      (node) => ({ ...node, valueRef: replacementRef }),
    );
  return forgeComponent(api, entries, staged, "childrenRef", childrenRef);
}

function forgeSequenceAt(api, entries, staged, path, mutate) {
  const sequenceRef = trieValueRefAt(entries, staged.rootObject.childrenRef, "root"), pages = [], indexes = [];
  let page = objectAt(entries, sequenceRef); pages.push(page);
  for (const index of path) {
    indexes.push(index); page = objectAt(entries, page.childRefs[index]); pages.push(page);
  }
  let replacementRef = rawPut(api, entries, pages.at(-1).kind, mutate(pages.at(-1)));
  for (let depth = pages.length - 2; depth >= 0; depth -= 1) {
    const parent = pages[depth], childRefs = parent.childRefs.slice();
    childRefs[indexes[depth]] = replacementRef;
    replacementRef = rawPut(api, entries, parent.kind, {
      ...parent,
      childRefs,
      count: childRefs.reduce((total, ref) => total + objectAt(entries, ref).count, 0),
    });
  }
  const childrenRef = rewriteTrieAt(
    api, entries, staged.rootObject.childrenRef, "root",
    (node) => ({ ...node, valueRef: replacementRef }),
  );
  return forgeComponent(api, entries, staged, "childrenRef", childrenRef);
}

function triePathVisitBound(root, key, includesValueRecord = true) {
  let node = root,
    visits = 1;
  for (const character of key) {
    visits += node.children.length;
    const edge = node.children.find((pair) => pair[0] === character);
    assert.ok(edge);
    node = edge[1];
  }
  visits += node.children.length;
  return visits + (includesValueRecord ? 1 : 0);
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
  for (const forbidden of [
    "timestamp",
    "nonce",
    "newRefs",
    "manifest",
    "physicalLocation",
  ]) {
    assert.equal(forbidden in staged.rootObject, false);
    assert.equal(forbidden in staged.sealObject, false);
  }
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
  confirm(api, stager, base);
  const successor = stage(api, stager, edited.state, base);

  assert.notEqual(successor.rootObject.contentRef, base.rootObject.contentRef);
  assert.equal(successor.rootObject.placementRef, base.rootObject.placementRef);
  assert.equal(successor.rootObject.childrenRef, base.rootObject.childrenRef);
  assert.equal(
    successor.rootObject.preservationRef,
    base.rootObject.preservationRef,
  );
  for (const [ref, bytes] of oldEntries)
    assert.equal(stager.store.get(ref), bytes);
  // One changed record, the fanout encountered along its nodeId trie path,
  // and three cached component roots. No total-node term appears.
  const newObjectBound = 3 * ("n2".length + 1) + 8,
    sourceVisitBound = triePathVisitBound(baseState.content, "n2") + 3;
  assert.ok(successor.diagnostics.newObjectCount <= newObjectBound);
  assert.ok(successor.diagnostics.sourceObjectVisits <= sourceVisitBound);
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
  assert.equal(
    api.auditCandidateSeal(base.sealRef, resolverFor(stager)).ok,
    true,
  );

  const secondEdit = rootApi.editPayload(edited.state, "n3", {
    label: "second generation",
    value: 3,
  });
  assert.equal(secondEdit.ok, true);
  const secondSuccessor = stage(api, stager, secondEdit.state, successor),
    secondNewObjectBound = 3 * ("n3".length + 1) + 8,
    secondSourceVisitBound = triePathVisitBound(edited.state.content, "n3") + 3;
  assert.equal(
    secondSuccessor.rootObject.placementRef,
    successor.rootObject.placementRef,
  );
  assert.equal(
    secondSuccessor.rootObject.childrenRef,
    successor.rootObject.childrenRef,
  );
  // The newly confirmed successor is the explicit base proof. A second local
  // edit remains path/fanout bounded, with no 2,000-node enumeration term.
  assert.ok(secondSuccessor.diagnostics.newObjectCount <= secondNewObjectBound);
  assert.ok(
    secondSuccessor.diagnostics.sourceObjectVisits <= secondSourceVisitBound,
  );
  assert.equal(
    api.verifyNewObjectPresence(
      secondSuccessor,
      (ref) => stager.store.has(ref),
      { baseComplete: true },
    ).ok,
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
  confirm(api, stager, base);
  const successor = stage(api, stager, reordered.state, base);

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
  // Two bounded sequence paths, their capacity-bounded fanout, the parent-key
  // trie path, and fixed component-root visits. No sibling-count term appears.
  const sequenceFrontier =
      2 * (sequenceApi.height(oldSequence) + 1) + "root".length + 2,
    newObjectBound = 8 * sequenceFrontier,
    sourceVisitBound = baseState.capacity * sequenceFrontier + 8;
  assert.ok(successor.diagnostics.newObjectCount <= newObjectBound);
  assert.ok(successor.diagnostics.sourceObjectVisits <= sourceVisitBound);
  assert.equal("manifest" in successor.rootObject, false);
  assert.equal("newRefs" in successor.sealObject, false);
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
      cachedRef(stager, descendantContent, "content-record"),
      cachedRef(stager, descendantPlacement, "placement-record"),
      cachedRef(stager, branchChildren, `sequence-${branchChildren.kind}`),
      cachedRef(
        stager,
        unrelatedChildren,
        `sequence-${unrelatedChildren.kind}`,
      ),
      cachedRef(stager, unrelatedPage, `sequence-${unrelatedPage.kind}`),
    ],
    moved = rootApi.move(baseState, "branch", 0, "dest", 0);
  assert.equal(moved.ok, true);
  confirm(api, stager, base);
  const successor = stage(api, stager, moved.state, base);

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
      cachedRef(
        stager,
        rootApi.getContent(moved.state, "d400"),
        "content-record",
      ),
      cachedRef(
        stager,
        placementApi.getPlacement(moved.state.structural, "d400"),
        "placement-record",
      ),
      cachedRef(
        stager,
        placementApi.getChildrenRoot(moved.state.structural, "branch"),
        `sequence-${branchChildren.kind}`,
      ),
      cachedRef(
        stager,
        placementApi.getChildrenRoot(moved.state.structural, "unrelated"),
        `sequence-${unrelatedChildren.kind}`,
      ),
      cachedRef(stager, unrelatedPage, `sequence-${unrelatedPage.kind}`),
    ],
    retainedRefs,
  );
  // Three changed trie paths and two capacity-bounded sequence frontiers.
  // Descendant count is deliberately absent from both locality ceilings.
  const pathFrontier =
      "branch".length +
      "source".length +
      "dest".length +
      sequenceApi.height(sourceChildren) +
      (destinationChildren ? sequenceApi.height(destinationChildren) : 0) +
      6,
    newObjectBound = 10 * pathFrontier,
    sourceVisitBound = (baseState.capacity + 4) * pathFrontier;
  assert.ok(successor.diagnostics.newObjectCount <= newObjectBound);
  assert.ok(successor.diagnostics.sourceObjectVisits <= sourceVisitBound);
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
    base = confirm(producerApi, stager, stage(producerApi, stager, state)),
    staged = stage(producerApi, stager, state, base),
    missingHistory = base.sealRef,
    exported = plain(producerApi.exportEntries(stager)),
    consumer = context(),
    api = consumer.PocketStarlingObjectSealShadow,
    entries = new Map(exported),
    requested = [],
    resolver = (ref) => {
      requested.push(ref);
      return entries.get(ref);
    };
  entries.delete(missingHistory);
  const opened = api.openFromAcceptedSealRef(staged.sealRef, resolver);

  assert.equal(opened.ok, true);
  assert.ok(entries.size > 2000);
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
  const missingSeal = { ...staged.sealObject };
  delete missingSeal.rootRef;
  const missingSealRef = rawPut(api, wrongShape, "candidate-seal", missingSeal);
  assert.equal(
    api.openFromAcceptedSealRef(missingSealRef, (ref) => wrongShape.get(ref))
      .reason,
    "invalid-seal",
  );

  const rootShapes = new Map(api.exportEntries(stager)),
    extraRoot = forgeRoot(api, rootShapes, staged, {
      ...staged.rootObject,
      manifest: ["not-sealed-truth"],
    });
  assert.equal(
    api.openFromAcceptedSealRef(extraRoot.sealRef, (ref) => rootShapes.get(ref))
      .reason,
    "invalid-root-object",
  );
  const missingRootObject = { ...staged.rootObject };
  delete missingRootObject.contentRef;
  const missingRoot = forgeRoot(api, rootShapes, staged, missingRootObject);
  assert.equal(
    api.openFromAcceptedSealRef(missingRoot.sealRef, (ref) =>
      rootShapes.get(ref),
    ).reason,
    "invalid-root-object",
  );

  for (const [label, mutate] of [
    [
      "duplicate",
      (node) => ({
        ...node,
        children: [
          node.children[0],
          node.children[0],
          ...node.children.slice(1),
        ],
      }),
    ],
    [
      "out-of-order",
      (node) => ({ ...node, children: node.children.slice().reverse() }),
    ],
  ]) {
    const trieDamage = new Map(api.exportEntries(stager)),
      contentRef = rewriteTrieAt(
        api,
        trieDamage,
        staged.rootObject.contentRef,
        "n",
        mutate,
      ),
      forged = forgeComponent(
        api,
        trieDamage,
        staged,
        "contentRef",
        contentRef,
      ),
      opened = api.openFromAcceptedSealRef(forged.sealRef, (ref) =>
        trieDamage.get(ref),
      );
    assert.equal(opened.ok, true, label);
    assert.equal(
      api.readContent(opened.handle, "n0").reason,
      "invalid-trie-object",
      label,
    );
    assert.equal(
      api.auditCandidateSeal(forged.sealRef, (ref) => trieDamage.get(ref))
        .reason,
      "invalid-trie-object",
      label,
    );
  }

  const placementDamage = new Map(api.exportEntries(stager)),
    placementRecordRef = trieValueRefAt(
      placementDamage,
      staged.rootObject.placementRef,
      "n0",
    ),
    placementRecord = objectAt(placementDamage, placementRecordRef),
    wrongPlacementRecordRef = rawPut(api, placementDamage, "placement-record", {
      ...placementRecord,
      nodeId: "different-node",
    }),
    placementRef = rewriteTrieAt(
      api,
      placementDamage,
      staged.rootObject.placementRef,
      "n0",
      (node) => ({ ...node, valueRef: wrongPlacementRecordRef }),
    ),
    wrongPlacement = forgeComponent(
      api,
      placementDamage,
      staged,
      "placementRef",
      placementRef,
    ),
    wrongPlacementOpen = api.openFromAcceptedSealRef(
      wrongPlacement.sealRef,
      (ref) => placementDamage.get(ref),
    );
  assert.equal(wrongPlacementOpen.ok, true);
  assert.equal(
    api.readPlacement(wrongPlacementOpen.handle, "n0").reason,
    "invalid-placement-record",
  );
  assert.equal(
    api.auditCandidateSeal(wrongPlacement.sealRef, (ref) =>
      placementDamage.get(ref),
    ).reason,
    "invalid-placement-record",
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
  // Matching refs authenticate bytes. They neither choose authority nor prove
  // that Placement's independently encoded parent/membership views agree.
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

test("P109 rejects self-authenticating invalid ordered-sequence objects", () => {
  const c = context(),
    api = c.PocketStarlingObjectSealShadow,
    state = stateFor(c, normalised(rootNodes(20))),
    stager = api.createStager(),
    staged = stage(api, stager, state),
    cases = [
      ["old-schema", (page) => ({ ...page, schema: api.OBJECT_SCHEMA })],
      ["capacity", (page) => ({ ...page, capacity: page.capacity + 1 })],
      ["count", (page) => ({ ...page, count: page.count + 1 })],
      [
        "fanout",
        (page) => {
          assert.equal(page.kind, "sequence-branch");
          const childRefs = Array(page.capacity + 1).fill(page.childRefs[0]),
            child = objectAt(stager.store, page.childRefs[0]);
          return {
            ...page,
            childRefs,
            count: child.count * childRefs.length,
          };
        },
      ],
    ];

  // Balanced build never emits a non-root one-child branch.
  const sequenceRoot = objectAt(
    stager.store,
    trieValueRefAt(stager.store, staged.rootObject.childrenRef, "root"),
  );
  assert.equal(
    sequenceRoot.childRefs.some((ref) => {
      const child = objectAt(stager.store, ref);
      return child.kind === "sequence-branch" && child.childRefs.length === 1;
    }),
    false,
  );
  assert.equal(
    api.auditCandidateSeal(staged.sealRef, resolverFor(stager)).ok,
    true,
  );
  const emptyStager = api.createStager(),
    empty = stage(api, emptyStager, stateFor(c, normalised([]))),
    emptyAudit = api.auditCandidateSeal(
      empty.sealRef,
      resolverFor(emptyStager),
    );
  assert.notEqual(empty.rootObject.placementRef, empty.rootObject.childrenRef);
  assert.equal(emptyAudit.ok, true, JSON.stringify(plain(emptyAudit)));

  for (const [label, mutate] of cases) {
    const entries = new Map(api.exportEntries(stager)),
      forged = forgeSequence(api, entries, staged, mutate),
      opened = api.openFromAcceptedSealRef(forged.sealRef, (ref) =>
        entries.get(ref),
      );
    assert.equal(opened.ok, true, label);
    assert.equal(
      api.auditCandidateSeal(forged.sealRef, (ref) => entries.get(ref)).reason,
      "invalid-sequence-object",
      label,
    );
  }
});

test("P132f rejects every persisted v2 occupancy, capacity, and reachability violation", () => {
  const c = context(), api = c.PocketStarlingObjectSealShadow,
    state = stateFor(c, normalised(rootNodes(20))), stager = api.createStager(), staged = stage(api, stager, state);
  const audit = (forged, entries, label, reason = "invalid-sequence-object") => {
    assert.equal(api.openFromAcceptedSealRef(forged.sealRef, (ref) => entries.get(ref)).ok, true, label);
    assert.equal(api.auditCandidateSeal(forged.sealRef, (ref) => entries.get(ref)).reason, reason, label);
  };
  for (const [label, path, mutate] of [
    ["non-root-capacity-mismatch", [0], (page) => ({ ...page, capacity: page.capacity + 1 })],
    ["non-root-capacity-two", [0], (page) => ({ ...page, capacity: 2 })],
    ["underfull-non-root-branch", [0], (page) => ({ ...page, childRefs: [page.childRefs[0]], count: objectAt(stager.store, page.childRefs[0]).count })],
    ["underfull-non-root-leaf", [0, 0], (page) => ({ ...page, items: page.items.slice(0, 1), count: 1 })],
    ["empty-non-root-leaf", [0, 0], (page) => ({ ...page, items: [], count: 0 })],
  ]) {
    const entries = new Map(api.exportEntries(stager)), forged = forgeSequenceAt(api, entries, staged, path, mutate);
    audit(forged, entries, label);
  }
  {
    const entries = new Map(api.exportEntries(stager)), forged = forgeSequence(api, entries, staged, (page) => ({
      ...page, childRefs: [page.childRefs[0]], count: objectAt(entries, page.childRefs[0]).count,
    }));
    audit(forged, entries, "illegal-root-branch-shape");
  }
  {
    const entries = new Map(api.exportEntries(stager)), forged = forgeSequence(api, entries, staged, (page) => {
      const childRef = page.childRefs[0], child = objectAt(entries, childRef);
      return { ...page, childRefs: [childRef, childRef], count: child.count * 2 };
    });
    audit(forged, entries, "repeated-child-reachability");
  }
  {
    const entries = new Map(api.exportEntries(stager)), forged = forgeRoot(api, entries, staged, { ...staged.rootObject, capacity: 2 });
    assert.equal(api.openFromAcceptedSealRef(forged.sealRef, (ref) => entries.get(ref)).ok, false);
    assert.equal(api.auditCandidateSeal(forged.sealRef, (ref) => entries.get(ref)).reason, "invalid-root-object");
  }
});

test("P132f rejects capacity two at Bridge, Placement, Root, and persisted ObjectSeal seams", () => {
  const c = context(), state = stateFor(c, normalised(rootNodes(8))), relation = c.PocketStarlingPlacementShadow.audit(state.structural).relation;
  assert.deepEqual(plain(c.PocketStarlingBridgeShadow.encode(normalised(rootNodes(8)), { capacity: 2 })), { ok: false, reason: "invalid-capacity" });
  assert.deepEqual(plain(c.PocketStarlingPlacementShadow.build(relation, { capacity: 2 })), { ok: false, reason: "invalid-capacity" });
  assert.equal(c.PocketStarlingRootShadow.auditCandidate({ ...state, capacity: 2 }).reason, "invalid-root-config");
});

test("P109 required presence is relative to the supplied complete base", () => {
  const c = context(),
    rootApi = c.PocketStarlingRootShadow,
    api = c.PocketStarlingObjectSealShadow,
    baseState = stateFor(c, normalised(rootNodes(64))),
    stager = api.createStager(),
    base = stage(api, stager, baseState),
    durable = new Map();
  for (const ref of base.newRefs) durable.set(ref, stager.store.get(ref));
  assert.equal(
    api.verifyNewObjectPresence(base, (ref) => durable.has(ref)).ok,
    true,
  );

  const changedA = rootApi.editPayload(baseState, "n2", {
    label: "same changed content",
    value: 2,
  });
  assert.equal(changedA.ok, true);
  const candidateA = stage(api, stager, changedA.state, base);
  assert.ok(candidateA.newRefs.some((ref) => !durable.has(ref)));

  // "staged before" != "committed in the accepted base". Candidate A is
  // abandoned, but its bytes and exact source identities remain in the stager.
  const exactIdentityB = stage(api, stager, changedA.state, base),
    changedFresh = rootApi.editPayload(baseState, "n2", {
      value: 2,
      label: "same changed content",
    });
  assert.equal(changedFresh.ok, true);
  assert.notStrictEqual(changedFresh.state.content, changedA.state.content);
  const freshIdentityB = stage(api, stager, changedFresh.state, base);

  assert.deepEqual(
    exactIdentityB.newRefs.slice().sort(),
    candidateA.newRefs.slice().sort(),
  );
  assert.deepEqual(
    freshIdentityB.newRefs.slice().sort(),
    candidateA.newRefs.slice().sort(),
  );
  assert.equal(exactIdentityB.rootRef, freshIdentityB.rootRef);
  assert.equal(exactIdentityB.sealRef, freshIdentityB.sealRef);
  for (const candidate of [exactIdentityB, freshIdentityB]) {
    assert.ok(candidate.newRefs.length > 0);
    assert.equal(
      candidate.newRefs.every((ref) => stager.store.has(ref)),
      true,
    );
    const missing = api.verifyNewObjectPresence(
      candidate,
      (ref) => durable.has(ref),
      { baseComplete: true },
    );
    assert.equal(missing.reason, "missing-new-object");
    assert.equal(candidate.newRefs.includes(missing.ref), true);
  }

  for (const ref of exactIdentityB.newRefs)
    durable.set(ref, stager.store.get(ref));
  assert.equal(
    api.verifyNewObjectPresence(exactIdentityB, (ref) => durable.has(ref), {
      baseComplete: true,
    }).ok,
    true,
  );
  assert.equal(
    api.verifyNewObjectPresence(freshIdentityB, (ref) => durable.has(ref), {
      baseComplete: true,
    }).ok,
    true,
  );
  assert.equal(
    api.auditCandidateSeal(freshIdentityB.sealRef, (ref) => durable.get(ref))
      .ok,
    true,
  );
  assert.equal(
    api
      .exportEntries(stager)
      .every(
        ([, bytes]) =>
          !/baseStage|provenance|sourceObjectVisits|newRefs/.test(bytes),
      ),
    true,
  );
});

test("P109 successor continuity requires a matching complete stage proof", () => {
  const c = context(),
    rootApi = c.PocketStarlingRootShadow,
    api = c.PocketStarlingObjectSealShadow,
    state = stateFor(c, normalised(rootNodes(8))),
    stager = api.createStager(),
    base = stage(api, stager, state),
    edited = rootApi.editPayload(state, "n2", { label: "changed" });
  assert.equal(edited.ok, true);

  assert.equal(
    api.stageCandidate(stager, edited.state, {
      previousSealRef: base.sealRef,
      baseStage: base,
    }).reason,
    "base-proof-incomplete",
  );
  confirm(api, stager, base);
  assert.equal(
    api.stageCandidate(stager, edited.state, {
      previousSealRef: base.sealRef,
    }).reason,
    "base-proof-required",
  );
  assert.equal(
    api.stageCandidate(stager, edited.state, {
      previousSealRef: base.sealRef,
      baseStage: {},
    }).reason,
    "invalid-base-proof",
  );
  assert.equal(
    api.stageCandidate(stager, edited.state, {
      previousSealRef: "proof-ref:v1:candidate-seal:ffffffff",
      baseStage: base,
    }).reason,
    "base-seal-mismatch",
  );

  // These checks prove only private continuity bookkeeping, never authority.
  const unprovedSuccessor = {
    newRefs: [],
    sealObject: { previousSealRef: base.sealRef },
  };
  assert.equal(
    api.verifyNewObjectPresence(unprovedSuccessor, () => true, {
      baseComplete: true,
    }).reason,
    "continuity-provenance-required",
  );
});

test("P109 completeness, retention, determinism and lineage stay separate", () => {
  const first = context(),
    firstApi = first.PocketStarlingObjectSealShadow,
    state = stateFor(first, normalised(rootNodes(32))),
    stager = firstApi.createStager(),
    genesis = stage(firstApi, stager, state),
    missingGenesisRef = genesis.newRefs.at(0);
  const missingGenesis = firstApi.verifyNewObjectPresence(
    genesis,
    (ref) => ref !== missingGenesisRef && stager.store.has(ref),
  );
  assert.equal(missingGenesis.reason, "missing-new-object");
  assert.equal(missingGenesis.ref, missingGenesisRef);
  confirm(firstApi, stager, genesis);

  const distantRecord = first.PocketStarlingRootShadow.getContent(state, "n31"),
    retainedRef = cachedRef(stager, distantRecord, "content-record"),
    edited = first.PocketStarlingRootShadow.editPayload(state, "n2", {
      label: "changed",
    }),
    successor = stage(firstApi, stager, edited.state, genesis),
    durable = new Map(firstApi.exportEntries(stager)),
    missingSuccessorRef = successor.newRefs.at(0),
    missingSuccessorBytes = durable.get(missingSuccessorRef);
  durable.delete(missingSuccessorRef);
  const missingSuccessor = firstApi.verifyNewObjectPresence(
    successor,
    (ref) => durable.has(ref),
    { baseComplete: true },
  );
  assert.equal(missingSuccessor.reason, "missing-new-object");
  assert.equal(missingSuccessor.ref, missingSuccessorRef);
  durable.set(missingSuccessorRef, missingSuccessorBytes);
  assert.equal(
    firstApi.verifyNewObjectPresence(successor, (ref) => durable.has(ref), {
      baseComplete: true,
    }).ok,
    true,
  );

  // Authentication cannot manufacture redundant bytes. The successor-frontier
  // proof can pass while a separately required retained base object is absent.
  durable.delete(retainedRef);
  assert.equal(
    firstApi.verifyNewObjectPresence(successor, (ref) => durable.has(ref), {
      baseComplete: true,
    }).ok,
    true,
  );
  const retainedOpen = firstApi.openFromAcceptedSealRef(
    successor.sealRef,
    (ref) => durable.get(ref),
  );
  assert.equal(retainedOpen.ok, true);
  const missingLazy = firstApi.readContent(retainedOpen.handle, "n31");
  assert.equal(missingLazy.reason, "missing-object");
  assert.equal(missingLazy.ref, retainedRef);
  const missingAudit = firstApi.auditCandidateSeal(successor.sealRef, (ref) =>
    durable.get(ref),
  );
  assert.equal(missingAudit.reason, "missing-object");
  assert.equal(missingAudit.ref, retainedRef);

  const second = context(),
    third = context(),
    secondApi = second.PocketStarlingObjectSealShadow,
    thirdApi = third.PocketStarlingObjectSealShadow,
    secondState = stateFor(second, normalised(rootNodes(32))),
    thirdState = stateFor(third, normalised(rootNodes(32))),
    secondStager = secondApi.createStager(),
    thirdStager = thirdApi.createStager(),
    secondBase = confirm(
      secondApi,
      secondStager,
      stage(secondApi, secondStager, secondState),
    ),
    thirdBase = confirm(
      thirdApi,
      thirdStager,
      stage(thirdApi, thirdStager, thirdState),
    ),
    secondStage = stage(secondApi, secondStager, secondState, secondBase),
    thirdStage = stage(thirdApi, thirdStager, thirdState, thirdBase),
    lineageStager = thirdApi.createStager(),
    lineageBaseState = third.PocketStarlingRootShadow.editPayload(
      thirdState,
      "n0",
      { lineage: true },
    ).state,
    lineageBase = confirm(
      thirdApi,
      lineageStager,
      stage(thirdApi, lineageStager, lineageBaseState),
    ),
    otherLineage = stage(thirdApi, lineageStager, thirdState, lineageBase);
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

  const reordered = first.PocketStarlingRootShadow.reorder(state, "n0", 0, 2);
  assert.equal(reordered.ok, true);
  const reorderedStage = stage(
    firstApi,
    firstApi.createStager(),
    reordered.state,
  );
  assert.notEqual(reorderedStage.rootRef, genesis.rootRef);

  const collisionStager = firstApi.createStager([
      [genesis.rootRef, "different canonical bytes"],
    ]),
    collision = firstApi.stageCandidate(collisionStager, state);
  assert.equal(collision.reason, "proof-ref-collision");
  assert.equal(collision.ref, genesis.rootRef);
  assert.equal(
    collisionStager.store.get(genesis.rootRef),
    "different canonical bytes",
  );
});
