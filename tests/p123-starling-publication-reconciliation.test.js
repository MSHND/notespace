"use strict";

const test = require("node:test"),
  assert = require("node:assert/strict"),
  fs = require("node:fs"),
  path = require("node:path"),
  vm = require("node:vm"),
  { webcrypto } = require("node:crypto"),
  { createProductionReleaseManifest } = require("../sync-service/pocket-sync-production-server.js"),
  ROOT = path.resolve(__dirname, ".."),
  SCRIPTS = [
    "js/pocket-state.js", "js/pocket-data.js", "js/pocket-outline-persistence-policy.js",
    "js/pocket-editor-metadata.js", "js/pocket-pe-import-preserve.js", "js/pocket-storage.js",
    "js/pocket-import.js", "js/pocket-starling-shadow.js", "js/pocket-starling-sequence-shadow.js",
    "js/pocket-starling-placement-shadow.js", "js/pocket-starling-bridge-shadow.js",
    "js/pocket-starling-root-shadow.js", "js/pocket-starling-object-seal-shadow.js",
    "js/pocket-sync-crypto.js", "js/pocket-starling-crypto-shadow.js",
    "js/pocket-starling-storage-shadow.js", "js/pocket-starling-head-shadow.js",
    "js/pocket-sync-remote-client.js", "js/pocket-starling-publication-shadow.js",
  ],
  HEAD_SCHEMA = "pocket.starling.head.v1";

function runtime() {
  const c = {
    crypto: webcrypto, TextEncoder, TextDecoder, Uint8Array, ArrayBuffer, URL, Date, Math, JSON,
    Map, Set, WeakMap, WeakSet, Object, Array, String, Number, Boolean, Promise, Error,
    btoa: (value) => Buffer.from(value, "binary").toString("base64"),
    atob: (value) => Buffer.from(value, "base64").toString("binary"),
    localStorage: { getItem() {}, setItem() {}, removeItem() {} },
    document: { body: { classList: { add() {}, remove() {}, toggle() {} } }, getElementById() {}, addEventListener() {} },
    navigator: { clipboard: {} }, location: { href: "https://example.test" }, indexedDB: null,
    open() {}, close() {}, setTimeout() { return 1; }, clearTimeout() {},
    requestAnimationFrame() { return 1; }, cancelAnimationFrame() {},
  };
  c.window = c;
  c.globalThis = c;
  vm.createContext(c);
  for (const file of SCRIPTS)
    vm.runInContext(fs.readFileSync(path.join(ROOT, file), "utf8"), c, { filename: file });
  return c;
}

const plain = (value) => JSON.parse(JSON.stringify(value)),
  context = () => ({ syncedPocketId: "p123" }),
  head = (revision, sealRef) => ({ schema: HEAD_SCHEMA, revision, sealRef });

function stateFor(c) {
  const encoded = c.PocketStarlingBridgeShadow.encode({
      schema: "portal.mtt.web.v1", writtenAt: "2026-08-30T00:00:00.000Z",
      nodes: Array.from({ length: 8 }, (_, index) => ({ id: `n${index}`, parentId: "root", order: index, label: `Node ${index}`, value: index })),
      tombstones: [], rootExtras: {}, dataExtras: {},
    }, { capacity: 4 }),
    built = c.PocketStarlingRootShadow.build(encoded.bridge);
  assert.equal(encoded.ok, true);
  assert.equal(built.ok, true);
  return built.state;
}

async function keyFor(c) {
  const wrappingKey = await c.PocketSyncCrypto.generateDeviceWrappingKey(),
    bundle = await c.PocketSyncCrypto.createMasterKeyBundle([{ context: { syncedPocketId: "p123", envelopeId: "device-envelope", envelopeKind: "device", envelopeVersion: 1 }, wrappingKey }]);
  return bundle.masterKey;
}

function logicalStage(c, stager, state, base = null) {
  const result = c.PocketStarlingObjectSealShadow.stageCandidate(stager, state, base ? { previousSealRef: base.sealRef, baseStage: base } : { previousSealRef: null });
  assert.equal(result.ok, true, JSON.stringify(result));
  return result.stage;
}

async function physicalStage(c, stager, logical, key, baseStage = null) {
  return c.PocketStarlingStorageShadow.stageCandidate({
    sealRef: logical.sealRef, resolveLogical: (ref) => stager.store.get(ref), masterKey: key, context: context(),
    ...(baseStage ? { baseStage } : {}),
  });
}

function complete(c, logical, physical, stager) {
  assert.equal(c.PocketStarlingObjectSealShadow.verifyNewObjectPresence(logical, (ref) => stager.store.has(ref), logical.sealObject.previousSealRef === null ? {} : { baseComplete: true }).ok, true);
  assert.equal(c.PocketStarlingStorageShadow.verifyNewRecordPresence(physical, () => true).ok, true);
}

async function lineage(c) {
  const state = stateFor(c), stager = c.PocketStarlingObjectSealShadow.createStager(), key = await keyFor(c),
    baseLogical = logicalStage(c, stager, state), basePhysical = await physicalStage(c, stager, baseLogical, key);
  complete(c, baseLogical, basePhysical, stager);
  const candidateState = c.PocketStarlingRootShadow.editPayload(state, "n3", { label: "candidate", value: 123 }),
    candidateLogical = logicalStage(c, stager, candidateState.state, baseLogical),
    candidatePhysical = await physicalStage(c, stager, candidateLogical, key, basePhysical);
  assert.equal(candidateState.ok, true);
  complete(c, candidateLogical, candidatePhysical, stager);
  const laterState = c.PocketStarlingRootShadow.editPayload(candidateState.state, "n3", { label: "later", value: 1234 }),
    laterLogical = logicalStage(c, stager, laterState.state, candidateLogical),
    laterPhysical = await physicalStage(c, stager, laterLogical, key, candidatePhysical);
  assert.equal(laterState.ok, true);
  complete(c, laterLogical, laterPhysical, stager);
  const competingState = c.PocketStarlingRootShadow.editPayload(state, "n4", { label: "competing", value: 55 }),
    competingLogical = logicalStage(c, stager, competingState.state, baseLogical),
    competingPhysical = await physicalStage(c, stager, competingLogical, key, basePhysical);
  assert.equal(competingState.ok, true);
  complete(c, competingLogical, competingPhysical, stager);
  const records = new Map([basePhysical, candidatePhysical, laterPhysical, competingPhysical].flatMap((stage) => stage.newRecords.map((entry) => [entry.storageRef, entry.record])));
  return { state, stager, key, basePhysical, candidatePhysical, laterPhysical, competingPhysical, records };
}

function operationId(kind, index) { return `${kind}-${index}`; }

function service(calls, current, records, behaviour = {}) {
  const unsupported = (kind) => async () => { calls.push([kind]); throw new Error(`${kind} must not run`); };
  return {
    async readShadowHead(input) {
      calls.push(["read", plain(input)]);
      if (behaviour.read) return behaviour.read(input);
      return { head: current };
    },
    async getOpaqueObject(input) {
      calls.push(["get", plain(input)]);
      if (behaviour.get) return behaviour.get(input);
      const record = records.get(input.storageRef);
      return { present: !!record, record: record || null };
    },
    putOpaqueObject: unsupported("put"), objectPresence: unsupported("presence"),
    compareAndSetShadowHead: unsupported("cas"), initialiseShadowHead: unsupported("initialise"),
  };
}

function reconciler(c, calls, current, records, behaviour = {}, factory = operationId) {
  return c.PocketStarlingPublicationShadow.createReconciler({ objectHeadService: service(calls, current, records, behaviour), operationIdFactory: factory });
}

function input(data, currentExpected = head(1, data.basePhysical.sealStorageRef)) {
  return { stage: data.candidatePhysical, expectedHead: currentExpected, masterKey: data.key, context: context() };
}

test("P123 observes a genuine encrypted physical lineage with exact P110 outcomes and no publication calls", async () => {
  const c = runtime(), data = await lineage(c), expected = head(1, data.basePhysical.sealStorageRef), cases = [
    [expected, "not-committed", 0, 0],
    [head(2, data.candidatePhysical.sealStorageRef), "committed", 1, 1],
    [head(3, data.laterPhysical.sealStorageRef), "committed-and-superseded", 2, 2],
    [head(2, data.competingPhysical.sealStorageRef), "conflict", 1, 1],
    [head(3, data.candidatePhysical.sealStorageRef), "unknown", 2, 2],
    [head(1, data.candidatePhysical.sealStorageRef), "unknown", 0, 0],
    [head(0, null), "unknown", 0, 0],
  ];
  for (const [current, outcome, examined, gets] of cases) {
    const calls = [], result = await reconciler(c, calls, current, data.records).reconcileAmbiguousPublication(input(data));
    assert.deepEqual(plain(result), { outcome, examined });
    assert.equal(Object.isFrozen(result), true);
    assert.equal(calls.filter(([kind]) => kind === "read").length, 1);
    assert.equal(calls.filter(([kind]) => kind === "get").length, gets);
    assert.equal(calls.some(([kind]) => ["put", "presence", "cas", "initialise"].includes(kind)), false);
  }
});

test("P123 fails closed locally and returns unknown for remote absence, faults, invalid Head, crypto/capsule faults, and a broken physical chain", async () => {
  const c = runtime(), data = await lineage(c), current = head(2, data.candidatePhysical.sealStorageRef), invalids = [
    { name: "read throw", behaviour: { read: () => { throw new Error("lost"); } }, examined: 0 },
    { name: "invalid Head", behaviour: { read: () => ({ head: {} }) }, examined: 0 },
    { name: "missing object", behaviour: { get: () => ({ present: false, record: null }) }, examined: 1 },
    { name: "object throw", behaviour: { get: () => { throw new Error("lost"); } }, examined: 1 },
    { name: "malformed object", behaviour: { get: () => ({ present: true, record: {} }) }, examined: 1 },
    { name: "auth failure", behaviour: { get: () => ({ present: true, record: data.records.get(data.basePhysical.sealStorageRef) }) }, examined: 1 },
    { name: "wrong kind", current: head(2, data.basePhysical.newRecords.find((entry) => entry.storageRef !== data.basePhysical.sealStorageRef).storageRef), examined: 1 },
    { name: "chain does not end at expected", current: head(2, data.basePhysical.sealStorageRef), examined: 1 },
  ];
  for (const item of invalids) {
    const calls = [], result = await reconciler(c, calls, item.current || current, data.records, item.behaviour).reconcileAmbiguousPublication(input(data));
    assert.deepEqual(plain(result), { outcome: "unknown", examined: item.examined }, item.name);
    assert.equal(calls.filter(([kind]) => kind === "read").length, 1, item.name);
    assert.equal(calls.some(([kind]) => ["put", "presence", "cas", "initialise"].includes(kind)), false, item.name);
  }
  for (const candidate of [
    { ...input(data), expectedHead: {} },
    { ...input(data), expectedHead: head(1, data.candidatePhysical.sealStorageRef) },
    { ...input(data), context: { syncedPocketId: "other" } },
    { ...input(data), masterKey: {} },
  ]) {
    const calls = [];
    await assert.rejects(reconciler(c, calls, current, data.records).reconcileAmbiguousPublication(candidate));
    assert.equal(calls.length, 0);
  }
});

test("P123 snapshots expected Head and context before callbacks and awaited remote reads", async () => {
  const c = runtime(), data = await lineage(c), expected = head(1, data.basePhysical.sealStorageRef), suppliedContext = context(), calls = [];
  let factoryMutated = false;
  const result = await reconciler(c, calls, head(2, data.candidatePhysical.sealStorageRef), data.records, {
    read: () => {
      expected.revision = 99;
      expected.sealRef = "redirected";
      suppliedContext.syncedPocketId = "redirected";
      return { head: head(2, data.candidatePhysical.sealStorageRef) };
    },
  }, (kind, index) => {
    if (!factoryMutated) {
      factoryMutated = true;
      expected.revision = 88;
      expected.sealRef = "factory-redirect";
      suppliedContext.syncedPocketId = "factory-redirect";
    }
    return operationId(kind, index);
  }).reconcileAmbiguousPublication({ stage: data.candidatePhysical, expectedHead: expected, masterKey: data.key, context: suppliedContext });
  assert.deepEqual(plain(result), { outcome: "committed", examined: 1 });
  assert.deepEqual(calls[0][1], { apiVersion: 1, operationId: "read-head-0", syncedPocketId: "p123" });
  assert.deepEqual(calls[1][1], { apiVersion: 1, operationId: "get-seal-0", syncedPocketId: "p123", storageRef: data.candidatePhysical.sealStorageRef });
});

test("P123 rejects cyclic physical lineage evidence at the authenticated capsule boundary", async () => {
  const c = runtime(), data = await lineage(c), originalCrypto = c.PocketStarlingCryptoShadow,
    candidateCapsule = await originalCrypto.openObject(
      data.records.get(data.candidatePhysical.sealStorageRef),
      data.candidatePhysical.sealStorageRef,
      data.key,
      context(),
    ), calls = [];
  // A content-addressed P111 record cannot self-reference. This fixture mirrors
  // P110's already-authenticated-boundary cycle proof without weakening P112.
  c.PocketStarlingCryptoShadow = Object.freeze({
    ...originalCrypto,
    openObject: async () => candidateCapsule,
  });
  const result = await reconciler(
    c,
    calls,
    head(4, data.candidatePhysical.sealStorageRef),
    data.records,
  ).reconcileAmbiguousPublication(input(data));
  assert.deepEqual(plain(result), { outcome: "unknown", examined: 2 });
  assert.deepEqual(calls.map(([kind]) => kind), ["read", "get", "get"]);
});

test("P123 uses the real P120 service for exactly one Head read followed by Seal GETs", async () => {
  const c = runtime(), data = await lineage(c), transportCalls = [], transport = {
    async request(route, body) {
      transportCalls.push([route, plain(body)]);
      const common = { apiVersion: 1, ok: true, operationId: body.operationId, syncedPocketId: body.syncedPocketId };
      if (route === "readShadowHead") return { status: 200, body: { ...common, head: head(3, data.laterPhysical.sealStorageRef) } };
      const record = data.records.get(body.storageRef);
      return { status: 200, body: { ...common, storageRef: body.storageRef, present: true, record } };
    },
  }, service = c.PocketSyncRemoteClient.createObjectHeadService({ transport }),
    result = await c.PocketStarlingPublicationShadow.createReconciler({ objectHeadService: service, operationIdFactory: operationId }).reconcileAmbiguousPublication(input(data));
  assert.deepEqual(plain(result), { outcome: "committed-and-superseded", examined: 2 });
  assert.deepEqual(transportCalls, [
    ["readShadowHead", { apiVersion: 1, operationId: "read-head-0", syncedPocketId: "p123" }],
    ["getOpaqueObject", { apiVersion: 1, operationId: "get-seal-0", syncedPocketId: "p123", storageRef: data.laterPhysical.sealStorageRef }],
    ["getOpaqueObject", { apiVersion: 1, operationId: "get-seal-1", syncedPocketId: "p123", storageRef: data.candidatePhysical.sealStorageRef }],
  ]);
});

test("P123 leaves the publication module dormant and P122's surface intact", () => {
  const source = fs.readFileSync(path.join(ROOT, "js/pocket-starling-publication-shadow.js"), "utf8"),
    manifest = createProductionReleaseManifest({ browserRoot: ROOT, serviceRoot: "/pocket-sync/v1" });
  assert.equal(source.includes("publishCandidate"), true);
  assert.equal(fs.readFileSync(path.join(ROOT, "index.html"), "utf8").includes("pocket-starling-publication-shadow.js"), false);
  assert.equal(manifest.some((entry) => entry.path === "/js/pocket-starling-publication-shadow.js"), false);
});
