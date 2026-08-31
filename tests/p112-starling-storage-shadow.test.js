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
const plain = (value) => JSON.parse(JSON.stringify(value));

function source(file) {
  return fs.readFileSync(path.join(ROOT, file), "utf8");
}

function context(crypto = webcrypto) {
  const c = {
    crypto,
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

function confirm(c, stager, stage) {
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
      syncedPocketId: "pocket-p112-tests",
      envelopeId: "device-envelope",
      envelopeKind: "device",
      envelopeVersion: 1,
    },
    bundle = await c.PocketSyncCrypto.createMasterKeyBundle([
      { context: envelopeContext, wrappingKey },
    ]);
  return bundle.masterKey;
}

const storageContext = () => ({ syncedPocketId: "pocket-p112-tests" });

async function physicalStage(c, logicalStager, logical, key, baseStage = null) {
  return c.PocketStarlingStorageShadow.stageCandidate({
    sealRef: logical.sealRef,
    resolveLogical: (ref) => logicalStager.store.get(ref),
    masterKey: key,
    context: storageContext(),
    baseStage,
  });
}

function physicalConfirm(c, stage, store = publicStore(stage)) {
  const result = c.PocketStarlingStorageShadow.verifyNewRecordPresence(
    stage,
    (ref) => store.has(ref),
  );
  assert.equal(result.ok, true, JSON.stringify(result));
  return result;
}

function publicStore(...stages) {
  return new Map(
    stages.flatMap((stage) =>
      stage.newRecords.map((entry) => [entry.storageRef, entry.record]),
    ),
  );
}

async function capsuleIndex(c, stages, key) {
  const result = new Map();
  const store = publicStore(...(Array.isArray(stages) ? stages : [stages]));
  for (const [storageRef, record] of store) {
    const bytes = await c.PocketStarlingCryptoShadow.openObject(
        record,
        storageRef,
        key,
        storageContext(),
      ),
      capsule = c.PocketStarlingStorageShadow.validateCapsuleBytes(bytes);
    result.set(capsule.logicalRef, {
      storageRef,
      record,
      capsule,
    });
  }
  return result;
}

async function expectCode(promise, codes) {
  const accepted = Array.isArray(codes) ? codes : [codes];
  await assert.rejects(
    promise,
    (error) => error && accepted.includes(error.code),
  );
}

function cachedRef(stager, sourceObject, kind) {
  const refs = stager.cache.get(sourceObject);
  return refs && refs.get(kind);
}

test("P112 fresh runtime lazily reopens a real encrypted P109 graph", async () => {
  const c = context(),
    nodes = rootNodes(8),
    distinctiveNodeId = "node-p112-distinctive-semantic-identity";
  nodes[2].id = distinctiveNodeId;
  nodes[2].label = "P112 distinctive payload";
  nodes[2].edgeLike = "proof-ref:v1:content-record:deadbeef";
  const state = stateFor(c, nodes),
    logicalStager = c.PocketStarlingObjectSealShadow.createStager(),
    logical = logicalStage(c, logicalStager, state);
  confirm(c, logicalStager, logical);
  const key = await masterKey(c),
    physical = await physicalStage(c, logicalStager, logical, key),
    store = publicStore(physical),
    fresh = context(),
    fetched = new Set(),
    resolver = await fresh.PocketStarlingStorageShadow.createResolver({
      acceptedSealStorageRef: physical.sealStorageRef,
      resolveStorage(ref) {
        fetched.add(ref);
        return store.get(ref);
      },
      masterKey: key,
      context: storageContext(),
    }),
    opened = await resolver.openAccepted();
  assert.equal(opened.ok, true, JSON.stringify(opened));
  const read = await resolver.readContent(opened.handle, distinctiveNodeId);
  assert.equal(read.ok, true, JSON.stringify(read));
  assert.equal(read.payload.label, "P112 distinctive payload");
  assert.equal(read.payload.edgeLike, "proof-ref:v1:content-record:deadbeef");
  assert.ok(fetched.size < physical.newRecords.length);

  const index = await capsuleIndex(c, physical, key),
    contentRecordRef = cachedRef(
      logicalStager,
      c.PocketStarlingRootShadow.getContent(state, distinctiveNodeId),
      "content-record",
    );
  assert.deepEqual(plain(index.get(contentRecordRef).capsule.links), []);
  const publicMaterial = JSON.stringify(plain(physical));
  for (const secret of [
    distinctiveNodeId,
    "P112 distinctive payload",
    "proof-ref:v1:content-record:deadbeef",
    logical.sealRef,
    logical.rootRef,
    "candidate-seal",
    "content-record",
  ])
    assert.equal(publicMaterial.includes(secret), false, secret);
});

test("P112 rejects tampered storage and malformed or dishonest capsules", async () => {
  const c = context(),
    state = stateFor(c, rootNodes(3)),
    logicalStager = c.PocketStarlingObjectSealShadow.createStager(),
    logical = logicalStage(c, logicalStager, state);
  confirm(c, logicalStager, logical);
  const key = await masterKey(c),
    physical = await physicalStage(c, logicalStager, logical, key),
    store = publicStore(physical),
    sealRecord = store.get(physical.sealStorageRef),
    crypto = c.PocketStarlingCryptoShadow,
    storage = c.PocketStarlingStorageShadow,
    sealPlaintext = await crypto.openObject(
      sealRecord,
      physical.sealStorageRef,
      key,
      storageContext(),
    ),
    capsule = JSON.parse(sealPlaintext);

  await expectCode(
    storage.createResolver({
      acceptedSealStorageRef: physical.sealStorageRef,
      resolveStorage: () => ({
        ...plain(sealRecord),
        ciphertext:
          sealRecord.ciphertext.slice(0, -1) +
          (sealRecord.ciphertext.endsWith("A") ? "B" : "A"),
      }),
      masterKey: key,
      context: storageContext(),
    }),
    ["object-reference-mismatch", "object-record-invalid"],
  );
  const wrongRef =
    physical.sealStorageRef.slice(0, -1) +
    (physical.sealStorageRef.endsWith("A") ? "B" : "A");
  await expectCode(
    storage.createResolver({
      acceptedSealStorageRef: wrongRef,
      resolveStorage: () => sealRecord,
      masterKey: key,
      context: storageContext(),
    }),
    "object-reference-mismatch",
  );
  await expectCode(
    storage.createResolver({
      acceptedSealStorageRef: physical.sealStorageRef,
      resolveStorage: (ref) => store.get(ref),
      masterKey: key,
      context: { syncedPocketId: "wrong-pocket" },
    }),
    "object-authentication-failed",
  );

  const validExtraStorageRef = physical.newRecords[0].storageRef,
    fakeLogicalRef = "proof-ref:v1:content-record:deadbeef",
    variants = [
      "{",
      JSON.stringify({
        schema: capsule.schema,
        logicalRef: capsule.logicalRef,
        logicalKind: capsule.logicalKind,
        logicalBytes: capsule.logicalBytes,
        links: capsule.links,
      }),
      storage.canonicalCapsule({ ...capsule, logicalRef: fakeLogicalRef }),
      storage.canonicalCapsule({ ...capsule, logicalBytes: "{}" }),
      storage.canonicalCapsule({ ...capsule, links: [] }),
      storage.canonicalCapsule({
        ...capsule,
        links: [
          ...capsule.links,
          { logicalRef: fakeLogicalRef, storageRef: validExtraStorageRef },
        ].sort((a, b) => a.logicalRef.localeCompare(b.logicalRef)),
      }),
      storage.canonicalCapsule({
        ...capsule,
        links: [capsule.links[0], ...capsule.links],
      }),
    ];
  for (const bytes of variants) {
    const sealed = await crypto.sealObject(bytes, key, storageContext());
    await expectCode(
      storage.createResolver({
        acceptedSealStorageRef: sealed.ref,
        resolveStorage: () => sealed.record,
        masterKey: key,
        context: storageContext(),
      }),
      [
        "capsule-invalid",
        "capsule-logical-mismatch",
        "capsule-links-invalid",
        "logical-object-invalid",
      ],
    );
  }
});

test("P112 lazy reads and successor encryption stay frontier-bounded at 2000 nodes", async () => {
  const c = context(),
    state = stateFor(c, rootNodes(2000)),
    logicalStager = c.PocketStarlingObjectSealShadow.createStager(),
    logicalBase = logicalStage(c, logicalStager, state);
  confirm(c, logicalStager, logicalBase);
  const key = await masterKey(c),
    physicalBase = await physicalStage(c, logicalStager, logicalBase, key);
  physicalConfirm(c, physicalBase);
  const store = publicStore(physicalBase),
    fresh = context(),
    fetched = new Set(),
    resolver = await fresh.PocketStarlingStorageShadow.createResolver({
      acceptedSealStorageRef: physicalBase.sealStorageRef,
      resolveStorage(ref) {
        fetched.add(ref);
        return store.get(ref);
      },
      masterKey: key,
      context: storageContext(),
    }),
    opened = await resolver.openAccepted(),
    read = await resolver.readContent(opened.handle, "n2");
  assert.equal(read.ok, true);
  assert.equal(read.payload.label, "Node 0002");
  assert.ok(fetched.size < 40, `${fetched.size} physical fetches`);
  assert.ok(fetched.size * 100 < physicalBase.newRecords.length);

  const edited = c.PocketStarlingRootShadow.editPayload(state, "n2", {
    label: "changed",
    value: 2,
  });
  assert.equal(edited.ok, true);
  const logicalNext = logicalStage(c, logicalStager, edited.state, logicalBase);
  confirm(c, logicalStager, logicalNext);
  const physicalNext = await physicalStage(
      c,
      logicalStager,
      logicalNext,
      key,
      physicalBase,
    ),
    nextStore = publicStore(physicalNext),
    combinedStore = publicStore(physicalBase, physicalNext);
  assert.equal(
    physicalNext.diagnostics.newEncryptions,
    logicalNext.newRefs.length,
  );
  assert.ok(physicalNext.diagnostics.newEncryptions < 30);
  assert.equal(
    physicalNext.newRecords.length,
    physicalNext.diagnostics.newEncryptions,
  );
  assert.ok(physicalNext.diagnostics.inheritedLookups < 30);
  assert.ok(physicalNext.diagnostics.baseProofSteps < 30);
  for (const [ref, record] of store)
    assert.equal(nextStore.has(ref), false, `${ref} was re-listed`);
  assert.equal(combinedStore.size, store.size + physicalNext.newRecords.length);
  let frontierPresenceChecks = 0;
  const nextPresence = c.PocketStarlingStorageShadow.verifyNewRecordPresence(
    physicalNext,
    (ref) => {
      frontierPresenceChecks += 1;
      return combinedStore.has(ref);
    },
  );
  assert.equal(nextPresence.checked, physicalNext.newRecords.length);
  assert.equal(frontierPresenceChecks, physicalNext.newRecords.length);
  const nextSealPlaintext = await c.PocketStarlingCryptoShadow.openObject(
      nextStore.get(physicalNext.sealStorageRef),
      physicalNext.sealStorageRef,
      key,
      storageContext(),
    ),
    nextSealCapsule =
      c.PocketStarlingStorageShadow.validateCapsuleBytes(nextSealPlaintext),
    priorSealLink = nextSealCapsule.links.find(
      (link) => link.logicalRef === logicalBase.sealRef,
    );
  assert.equal(priorSealLink.storageRef, physicalBase.sealStorageRef);

  const nextFresh = context(),
    nextResolver = await nextFresh.PocketStarlingStorageShadow.createResolver({
      acceptedSealStorageRef: physicalNext.sealStorageRef,
      resolveStorage: (ref) => combinedStore.get(ref),
      masterKey: key,
      context: storageContext(),
    }),
    nextOpened = await nextResolver.openAccepted(),
    nextRead = await nextResolver.readContent(nextOpened.handle, "n2");
  assert.equal(nextRead.payload.label, "changed");
});

test("P112 branch move preserves descendant logical and physical identity", async () => {
  const c = context(),
    nodes = [
      { id: "source", parentId: "root", order: 1, label: "source" },
      { id: "dest", parentId: "root", order: 2, label: "dest" },
      { id: "branch", parentId: "source", order: 1, label: "branch" },
      ...Array.from({ length: 512 }, (_, index) => ({
        id: `d${index}`,
        parentId: "branch",
        order: index,
        label: `descendant-${index}`,
      })),
    ],
    state = stateFor(c, nodes),
    p = c.PocketStarlingPlacementShadow,
    rootApi = c.PocketStarlingRootShadow,
    logicalStager = c.PocketStarlingObjectSealShadow.createStager(),
    logicalBase = logicalStage(c, logicalStager, state);
  confirm(c, logicalStager, logicalBase);
  const descendantContent = rootApi.getContent(state, "d400"),
    descendantPlacement = p.getPlacement(state.structural, "d400"),
    descendantChildren = p.getChildrenRoot(state.structural, "branch"),
    contentRef = cachedRef(logicalStager, descendantContent, "content-record"),
    placementRef = cachedRef(
      logicalStager,
      descendantPlacement,
      "placement-record",
    ),
    sequenceRef = cachedRef(
      logicalStager,
      descendantChildren,
      `sequence-${descendantChildren.kind}`,
    ),
    key = await masterKey(c),
    physicalBase = await physicalStage(c, logicalStager, logicalBase, key);
  physicalConfirm(c, physicalBase);
  const baseIndex = await capsuleIndex(c, physicalBase, key),
    moved = rootApi.move(state, "branch", 0, "dest", 0);
  assert.equal(moved.ok, true);
  const logicalNext = logicalStage(c, logicalStager, moved.state, logicalBase);
  confirm(c, logicalStager, logicalNext);
  const physicalNext = await physicalStage(
      c,
      logicalStager,
      logicalNext,
      key,
      physicalBase,
    ),
    nextIndex = await capsuleIndex(c, [physicalBase, physicalNext], key);
  for (const ref of [contentRef, placementRef, sequenceRef]) {
    assert.ok(ref);
    assert.equal(nextIndex.get(ref).storageRef, baseIndex.get(ref).storageRef);
    assert.strictEqual(nextIndex.get(ref).record, baseIndex.get(ref).record);
  }
  assert.ok(physicalNext.diagnostics.newEncryptions < 100);
  assert.ok(physicalNext.diagnostics.newEncryptions * 10 < 512);
  assert.ok(physicalNext.diagnostics.baseProofSteps < 100);
  assert.equal(
    physicalNext.newRecords.length,
    physicalNext.diagnostics.newEncryptions,
  );
});

test("P112 private base provenance rejects lookalikes and survives failed successors", async () => {
  const control = { fail: false },
    cryptoFacade = {
      subtle: webcrypto.subtle,
      getRandomValues(target) {
        if (control.fail) throw new Error("synthetic random failure");
        return webcrypto.getRandomValues(target);
      },
    },
    c = context(cryptoFacade),
    state = stateFor(c, rootNodes(20)),
    logicalStager = c.PocketStarlingObjectSealShadow.createStager(),
    logicalBase = logicalStage(c, logicalStager, state);
  confirm(c, logicalStager, logicalBase);
  const key = await masterKey(c),
    physicalBase = await physicalStage(c, logicalStager, logicalBase, key),
    baseStore = publicStore(physicalBase),
    edited = c.PocketStarlingRootShadow.editPayload(state, "n2", {
      label: "changed",
      value: 2,
    }),
    logicalNext = logicalStage(c, logicalStager, edited.state, logicalBase);
  confirm(c, logicalStager, logicalNext);
  await expectCode(
    physicalStage(c, logicalStager, logicalNext, key, physicalBase),
    "base-stage-incomplete",
  );
  const missingBaseRef = physicalBase.newRecords[0].storageRef,
    incomplete = c.PocketStarlingStorageShadow.verifyNewRecordPresence(
      physicalBase,
      (ref) => ref !== missingBaseRef && baseStore.has(ref),
    );
  assert.deepEqual(plain(incomplete), {
    ok: false,
    reason: "missing-new-record",
    storageRef: missingBaseRef,
  });
  await expectCode(
    physicalStage(c, logicalStager, logicalNext, key, physicalBase),
    "base-stage-incomplete",
  );
  physicalConfirm(c, physicalBase, baseStore);
  await expectCode(
    physicalStage(c, logicalStager, logicalNext, key, {
      ...plain(physicalBase),
    }),
    "base-stage-invalid",
  );
  const abandoned = await physicalStage(
      c,
      logicalStager,
      logicalNext,
      key,
      physicalBase,
    ),
    abandonedStore = publicStore(physicalBase, abandoned),
    secondEdit = c.PocketStarlingRootShadow.editPayload(edited.state, "n3", {
      label: "second",
      value: 3,
    }),
    logicalSecond = logicalStage(
      c,
      logicalStager,
      secondEdit.state,
      logicalNext,
    );
  confirm(c, logicalStager, logicalSecond);
  assert.equal(
    abandoned.newRecords.every((entry) => abandonedStore.has(entry.storageRef)),
    true,
  );
  await expectCode(
    physicalStage(c, logicalStager, logicalSecond, key, abandoned),
    "base-stage-incomplete",
  );
  const missingAbandonedRef = abandoned.newRecords[0].storageRef,
    abandonedPresence = c.PocketStarlingStorageShadow.verifyNewRecordPresence(
      abandoned,
      (ref) => ref !== missingAbandonedRef && abandonedStore.has(ref),
    );
  assert.equal(abandonedPresence.reason, "missing-new-record");
  await expectCode(
    physicalStage(c, logicalStager, logicalSecond, key, abandoned),
    "base-stage-incomplete",
  );
  control.fail = true;
  await expectCode(
    physicalStage(c, logicalStager, logicalNext, key, physicalBase),
    "random-generation-failed",
  );
  assert.deepEqual(
    [...publicStore(physicalBase).keys()],
    [...baseStore.keys()],
  );
  for (const [ref, record] of baseStore)
    assert.strictEqual(publicStore(physicalBase).get(ref), record);
  const resolver = await c.PocketStarlingStorageShadow.createResolver({
      acceptedSealStorageRef: physicalBase.sealStorageRef,
      resolveStorage: (ref) => baseStore.get(ref),
      masterKey: key,
      context: storageContext(),
    }),
    opened = await resolver.openAccepted(),
    read = await resolver.readContent(opened.handle, "n2");
  assert.equal(read.payload.label, "Node 0002");
});

test("P112 rejects conflicting authenticated logical-to-physical bindings", async () => {
  const c = context(),
    p109 = c.PocketStarlingObjectSealShadow,
    crypto = c.PocketStarlingCryptoShadow,
    storage = c.PocketStarlingStorageShadow,
    key = await masterKey(c),
    records = new Map();
  async function make(kind, object, links) {
    const logicalBytes = p109.canonical(object).bytes,
      ref = p109.refFor(kind, logicalBytes),
      plaintext = storage.canonicalCapsule({
        schema: storage.CAPSULE_SCHEMA,
        logicalKind: kind,
        logicalRef: ref,
        logicalBytes,
        links: links
          .slice()
          .sort((a, b) => a.logicalRef.localeCompare(b.logicalRef)),
      }),
      sealed = await crypto.sealObject(plaintext, key, storageContext());
    records.set(sealed.ref, sealed.record);
    return { ref, storageRef: sealed.ref, record: sealed.record };
  }
  const objectSchema = p109.OBJECT_SCHEMA,
    sequenceSchema = p109.SEQUENCE_SCHEMA,
    targetObject = {
      schema: sequenceSchema,
      kind: "sequence-leaf",
      capacity: 4,
      count: 1,
      items: ["semantic-node"],
    },
    targetA = await make("sequence-leaf", targetObject, []),
    targetB = await make("sequence-leaf", targetObject, []),
    parentAObject = {
      schema: sequenceSchema,
      kind: "sequence-branch",
      capacity: 4,
      count: 1,
      childRefs: [targetA.ref],
    },
    parentABytes = p109.canonical(parentAObject).bytes,
    parentARef = p109.refFor("sequence-branch", parentABytes),
    parentA = await make("sequence-branch", parentAObject, [
      { logicalRef: targetA.ref, storageRef: targetA.storageRef },
    ]),
    parentBObject = {
      schema: objectSchema,
      kind: "children-trie",
      hasValue: false,
      valueRef: null,
      children: [{ key: "x", ref: targetA.ref }],
    },
    parentB = await make("children-trie", parentBObject, [
      { logicalRef: targetA.ref, storageRef: targetB.storageRef },
    ]),
    fillerA = await make(
      "content-record",
      {
        schema: objectSchema,
        kind: "content-record",
        nodeId: "f",
        payload: {},
      },
      [],
    ),
    fillerB = await make(
      "preservation",
      { schema: objectSchema, kind: "preservation", value: {} },
      [],
    ),
    rootObject = {
      schema: p109.ROOT_SCHEMA,
      kind: "pocket-root",
      capacity: 4,
      contentRef: parentARef,
      placementRef: parentB.ref,
      childrenRef: fillerA.ref,
      preservationRef: fillerB.ref,
    },
    root = await make("pocket-root", rootObject, [
      { logicalRef: parentA.ref, storageRef: parentA.storageRef },
      { logicalRef: parentB.ref, storageRef: parentB.storageRef },
      { logicalRef: fillerA.ref, storageRef: fillerA.storageRef },
      { logicalRef: fillerB.ref, storageRef: fillerB.storageRef },
    ]),
    sealObject = {
      schema: p109.SEAL_SCHEMA,
      kind: "candidate-seal",
      rootRef: root.ref,
      previousSealRef: null,
    },
    seal = await make("candidate-seal", sealObject, [
      { logicalRef: root.ref, storageRef: root.storageRef },
    ]),
    resolver = await storage.createResolver({
      acceptedSealStorageRef: seal.storageRef,
      resolveStorage: (ref) => records.get(ref),
      masterKey: key,
      context: storageContext(),
    });
  assert.equal((await resolver.openAccepted()).ok, true);
  await resolver.resolveLogical(parentA.ref);
  await expectCode(resolver.resolveLogical(parentB.ref), "binding-conflict");
});

test("P112 remains a dormant representation-only proof", () => {
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
