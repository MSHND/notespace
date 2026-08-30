"use strict";

const test = require("node:test"), assert = require("node:assert/strict"),
  fs = require("node:fs"), path = require("node:path"), vm = require("node:vm"),
  { webcrypto } = require("node:crypto"),
  { createProductionReleaseManifest } = require("../sync-service/pocket-sync-production-server.js"),
  ROOT = path.resolve(__dirname, ".."), HEAD_SCHEMA = "pocket.starling.head.v1",
  SCRIPTS = [
    "js/pocket-state.js", "js/pocket-data.js", "js/pocket-outline-persistence-policy.js",
    "js/pocket-editor-metadata.js", "js/pocket-pe-import-preserve.js", "js/pocket-storage.js",
    "js/pocket-import.js", "js/pocket-starling-shadow.js", "js/pocket-starling-sequence-shadow.js",
    "js/pocket-starling-placement-shadow.js", "js/pocket-starling-bridge-shadow.js",
    "js/pocket-starling-root-shadow.js", "js/pocket-starling-object-seal-shadow.js",
    "js/pocket-sync-crypto.js", "js/pocket-starling-crypto-shadow.js",
    "js/pocket-starling-storage-shadow.js", "js/pocket-starling-head-shadow.js",
    "js/pocket-sync-remote-client.js", "js/pocket-starling-logical-edit-shadow.js",
    "js/pocket-starling-publication-shadow.js", "js/pocket-starling-remote-open-shadow.js",
  ];

function runtime() {
  const c = { crypto: webcrypto, TextEncoder, TextDecoder, Uint8Array, ArrayBuffer, URL,
    Date, Math, JSON, Map, Set, WeakMap, WeakSet, Object, Array, String, Number,
    Boolean, Promise, Error, btoa: (v) => Buffer.from(v, "binary").toString("base64"),
    atob: (v) => Buffer.from(v, "base64").toString("binary"),
    localStorage: { getItem() {}, setItem() {}, removeItem() {} },
    document: { body: { classList: { add() {}, remove() {}, toggle() {} } }, getElementById() {}, addEventListener() {} },
    navigator: { clipboard: {} }, location: { href: "https://example.test" }, indexedDB: null,
    open() {}, close() {}, setTimeout, clearTimeout, requestAnimationFrame() { return 1; }, cancelAnimationFrame() {} };
  c.window = c; c.globalThis = c; vm.createContext(c);
  for (const file of SCRIPTS) vm.runInContext(fs.readFileSync(path.join(ROOT, file), "utf8"), c, { filename: file });
  return c;
}

const plain = (value) => JSON.parse(JSON.stringify(value)),
  context = () => ({ syncedPocketId: "p124" }),
  genesis = () => ({ schema: HEAD_SCHEMA, revision: 0, sealRef: null }),
  operationId = (kind, index) => `${kind}-${index}`;

function stateFor(c, count = 512) {
  const encoded = c.PocketStarlingBridgeShadow.encode({
      schema: "portal.mtt.web.v1", writtenAt: "2026-08-30T00:00:00.000Z",
      nodes: Array.from({ length: count }, (_, i) => ({ id: `n${i}`, parentId: "root", order: i, label: `Node ${i}`, value: i })),
      tombstones: [], rootExtras: {}, dataExtras: {},
    }, { capacity: 4 }), built = c.PocketStarlingRootShadow.build(encoded.bridge);
  assert.equal(encoded.ok, true); assert.equal(built.ok, true); return built.state;
}

function logicalStage(c, stager, state, base = null) {
  const result = c.PocketStarlingObjectSealShadow.stageCandidate(stager, state,
    base ? { previousSealRef: base.sealRef, baseStage: base } : { previousSealRef: null });
  assert.equal(result.ok, true, JSON.stringify(result)); return result.stage;
}

function logicalConfirm(c, stager, stage) {
  const result = c.PocketStarlingObjectSealShadow.verifyNewObjectPresence(stage,
    (ref) => stager.store.has(ref), stage.sealObject.previousSealRef === null ? {} : { baseComplete: true });
  assert.equal(result.ok, true, JSON.stringify(result));
}

async function keyFor(c, envelopeId = "device") {
  const wrappingKey = await c.PocketSyncCrypto.generateDeviceWrappingKey(),
    bundle = await c.PocketSyncCrypto.createMasterKeyBundle([{
      context: { syncedPocketId: "p124", envelopeId, envelopeKind: "device", envelopeVersion: 1 }, wrappingKey,
    }]);
  return bundle.masterKey;
}

async function physicalStage(c, stager, logical, key, baseStage = null) {
  return c.PocketStarlingStorageShadow.stageCandidate({ sealRef: logical.sealRef,
    resolveLogical: (ref) => stager.store.get(ref), masterKey: key, context: context(),
    ...(baseStage ? { baseStage } : {}) });
}

async function genuineStage(c, count = 512) {
  const state = stateFor(c, count), stager = c.PocketStarlingObjectSealShadow.createStager(),
    logical = logicalStage(c, stager, state), key = await keyFor(c),
    physical = await physicalStage(c, stager, logical, key);
  logicalConfirm(c, stager, logical); return { state, stager, logical, key, physical };
}

const remoteState = () => ({ objects: new Map(), head: genesis() }),
  responseBase = (body) => ({ apiVersion: 1, ok: true, operationId: body.operationId, syncedPocketId: body.syncedPocketId });

function transportFor(remote, calls, hooks = {}) {
  return { async request(route, body) {
    calls.push([route, plain(body)]);
    if (hooks.before) await hooks.before(route, body, calls);
    if (hooks.request) return hooks.request(route, body, calls);
    const common = responseBase(body);
    if (route === "putOpaqueObject") {
      const created = !remote.objects.has(body.storageRef); remote.objects.set(body.storageRef, body.record);
      return { status: 200, body: { ...common, storageRef: body.storageRef, created } };
    }
    if (route === "objectPresence") return { status: 200, body: { ...common,
      rows: body.storageRefs.map((storageRef) => ({ storageRef, present: remote.objects.has(storageRef) })) } };
    if (route === "compareAndSetShadowHead") {
      remote.head = { schema: HEAD_SCHEMA, revision: body.expectedHead.revision + 1, sealRef: body.candidateSealStorageRef };
      return { status: 200, body: { ...common, head: remote.head } };
    }
    if (route === "readShadowHead") return { status: 200, body: { ...common, head: remote.head } };
    if (route === "getOpaqueObject") {
      const record = remote.objects.get(body.storageRef);
      return { status: 200, body: { ...common, storageRef: body.storageRef, present: !!record, record: record || null } };
    }
    throw new Error(`unexpected route ${route}`);
  } };
}

const serviceFor = (c, remote, calls, hooks = {}) =>
  c.PocketSyncRemoteClient.createObjectHeadService({ transport: transportFor(remote, calls, hooks) });

async function publishGenuine(c, stage, remote) {
  const calls = [], publisher = c.PocketStarlingPublicationShadow.createPublisher({
    objectHeadService: serviceFor(c, remote, calls), operationIdFactory: operationId,
  }), result = await publisher.publishCandidate({ stage: stage.physical, expectedHead: genesis() });
  assert.equal(result.outcome, "committed");
  assert.deepEqual(remote.head, { schema: HEAD_SCHEMA, revision: 1, sealRef: stage.physical.sealStorageRef });
  return calls;
}

async function openRemote(c, stage, remote, calls, options = {}) {
  const opener = c.PocketStarlingRemoteOpenShadow.createRemoteOpener({
    objectHeadService: serviceFor(c, remote, calls, options.hooks),
    operationIdFactory: options.factory || operationId,
  });
  return opener.openRemote(options.input || { masterKey: stage.key, context: options.context || context() });
}

async function sealAndRootRefs(c, stage) {
  const entry = stage.physical.newRecords.find((item) => item.storageRef === stage.physical.sealStorageRef),
    bytes = await c.PocketStarlingCryptoShadow.openObject(entry.record, entry.storageRef, stage.key, context()),
    capsule = c.PocketStarlingStorageShadow.validateCapsuleBytes(bytes),
    root = capsule.links.find((link) => link.logicalRef === capsule.object.rootRef).storageRef;
  return { seal: entry.storageRef, root };
}

async function publishedFixture(count = 512) {
  const writer = runtime(), stage = await genuineStage(writer, count), remote = remoteState();
  await publishGenuine(writer, stage, remote); return { writer, stage, remote };
}

test("P124c real P122 publish opens through fresh P120 P124", async () => {
  const { writer, stage, remote } = await publishedFixture(), refs = await sealAndRootRefs(writer, stage),
    publishedSeal = remote.head.sealRef, reader = runtime(), calls = [],
    result = await openRemote(reader, stage, remote, calls);
  assert.deepEqual(calls.slice(0, 3), [
    ["readShadowHead", { apiVersion: 1, operationId: "read-head-0", syncedPocketId: "p124" }],
    ["getOpaqueObject", { apiVersion: 1, operationId: "get-object-0", syncedPocketId: "p124", storageRef: refs.seal }],
    ["getOpaqueObject", { apiVersion: 1, operationId: "get-object-1", syncedPocketId: "p124", storageRef: refs.root }],
  ]);
  assert.equal(calls.some(([route]) => ["putOpaqueObject", "objectPresence", "compareAndSetShadowHead", "initialiseShadowHead"].includes(route)), false);
  assert.deepEqual(Object.keys(result), ["outcome", "head", "session"]);
  assert.equal(result.outcome, "opened"); assert.equal(Object.isFrozen(result), true);
  assert.equal(Object.isFrozen(result.head), true); assert.equal(result.head.sealRef, publishedSeal);
  assert.deepEqual(Object.keys(result.session), ["acceptedSealRef", "resolveLogical", "createReuseProof", "readContent", "readPlacement", "diagnostics"]);
  assert.equal(Object.isFrozen(result.session), true);
  const content = await result.session.readContent("n20"), placement = await result.session.readPlacement("n20");
  assert.deepEqual(plain(content.payload), { label: "Node 20", value: 20 }); assert.equal(placement.parentId, "root");
});

test("P124c open is lazy bounded and cached", async () => {
  const { stage, remote } = await publishedFixture(2000), calls = [], result = await openRemote(runtime(), stage, remote, calls);
  assert.deepEqual(calls.map(([route]) => route), ["readShadowHead", "getOpaqueObject", "getOpaqueObject"]);
  await result.session.readContent("n1337");
  const gets = calls.filter(([route]) => route === "getOpaqueObject").length;
  assert.ok(gets < 40, `${gets} GETs`); assert.ok(gets * 50 < stage.physical.newRecords.length);
  await result.session.readContent("n1337");
  assert.equal(calls.filter(([route]) => route === "getOpaqueObject").length, gets);
});

test("P124c opened reuse proof stages genuine P114 P112 P121 successor", async () => {
  const { stage, remote } = await publishedFixture(1000), reader = runtime(), calls = [],
    result = await openRemote(reader, stage, remote, calls), session = result.session,
    reuseProof = session.createReuseProof();
  assert.equal(Object.isFrozen(reuseProof), true); assert.deepEqual(Object.getOwnPropertyNames(reuseProof), []);
  const opened = await reader.PocketStarlingLogicalEditShadow.createBase({
      acceptedSealRef: session.acceptedSealRef, resolveLogical: session.resolveLogical,
    }), edited = await reader.PocketStarlingLogicalEditShadow.editPayload(
      opened.base, "n777", { label: "P124d changed", value: 124 },
    );
  assert.equal(opened.ok, true); assert.equal(edited.ok, true); assert.equal(edited.changed, true);
  assert.ok(edited.candidate.newLogicalRefs.length > 0);
  const before = calls.length, successorStage = await reader.PocketStarlingStorageShadow.stageCandidate({
      sealRef: edited.candidate.sealRef, resolveLogical: edited.candidate.resolveLogical,
      masterKey: stage.key, context: context(), freshBaseProof: reuseProof,
      newLogicalRefs: edited.candidate.newLogicalRefs,
    }), binding = reader.PocketStarlingStorageShadow.publicationBinding(successorStage);
  assert.equal(calls.length, before); assert.equal(binding.expectedSealStorageRef, remote.head.sealRef);
  assert.equal(binding.candidateSealStorageRef, successorStage.sealStorageRef);
  assert.notEqual(binding.candidateSealStorageRef, binding.expectedSealStorageRef);
  assert.ok(successorStage.newRecords.length < 30);
  assert.ok(successorStage.newRecords.length * 20 < stage.physical.newRecords.length);
});

test("P124c failed lazy ID claim preserves index in same session", async () => {
  const { stage, remote } = await publishedFixture(), calls = []; let fail = true;
  const result = await openRemote(runtime(), stage, remote, calls, { factory(kind, index) {
    if (kind === "get-object" && index === 2 && fail) { fail = false; return " "; }
    return operationId(kind, index);
  } });
  const before = calls.length;
  await assert.rejects(result.session.readContent("n20"), (e) => e && e.code === "remote-open-operation-id-invalid");
  assert.equal(calls.length, before);
  await result.session.readContent("n20"); assert.equal(calls[before][1].operationId, "get-object-2");
});

test("P124e lazy operation ID failures stay local and preserve the GET index", async () => {
  for (const [name, failClaim] of [
    ["throw", () => { throw new Error("factory"); }],
    ["invalid", () => " "],
    ["duplicate", () => "get-object-1"],
  ]) {
    const { stage, remote } = await publishedFixture(), calls = [];
    let fail = true;
    const result = await openRemote(runtime(), stage, remote, calls, { factory(kind, index) {
      if (kind === "get-object" && index === 2 && fail) {
        fail = false;
        return failClaim();
      }
      return operationId(kind, index);
    } });
    assert.deepEqual(calls.map(([, body]) => body.operationId), ["read-head-0", "get-object-0", "get-object-1"], name);
    const before = calls.length;
    await assert.rejects(result.session.readContent("n20"),
      (error) => error && error.code === "remote-open-operation-id-invalid", name);
    assert.equal(calls.length, before, `${name} sent a network GET`);
    const content = await result.session.readContent("n20");
    assert.deepEqual(plain(content.payload), { label: "Node 20", value: 20 }, name);
    assert.equal(calls[before][0], "getOpaqueObject", name);
    assert.equal(calls[before][1].operationId, "get-object-2", name);
  }
});

test("P124c attempted remote GET consumes index", async () => {
  const { stage, remote } = await publishedFixture(), calls = []; let fail = true;
  const result = await openRemote(runtime(), stage, remote, calls, { hooks: { before(route, body) {
    if (route === "getOpaqueObject" && body.operationId === "get-object-2" && fail) { fail = false; throw new Error("lost"); }
  } } });
  const before = calls.length;
  await assert.rejects(result.session.readContent("n20"), (e) => e && e.code === "remote-unavailable");
  assert.equal(calls.length, before + 1); assert.equal(calls.at(-1)[1].operationId, "get-object-2");
  await result.session.readContent("n20"); assert.equal(calls[before + 1][1].operationId, "get-object-3");
});

test("P124c context and Head authority survive mutation", async () => {
  const { stage, remote } = await publishedFixture(), reader = runtime(), calls = [], supplied = context(),
    originalSeal = remote.head.sealRef, mutableHead = { ...remote.head };
  let factoryMutated = false, transportMutated = false, headMutatedAtGetBoundary = false;
  const service = reader.PocketSyncRemoteClient.createObjectHeadService({ transport: { async request(route, body) {
    calls.push([route, plain(body)]);
    if (route === "readShadowHead") return { status: 200, body: { ...responseBase(body), head: mutableHead } };
    if (route === "getOpaqueObject" && !headMutatedAtGetBoundary) {
      headMutatedAtGetBoundary = true;
      mutableHead.sealRef = "redirected";
    }
    if (!transportMutated) { transportMutated = true; supplied.syncedPocketId = "transport-redirect"; }
    const record = remote.objects.get(body.storageRef);
    return { status: 200, body: { ...responseBase(body), storageRef: body.storageRef, present: !!record, record: record || null } };
  } } }), opener = reader.PocketStarlingRemoteOpenShadow.createRemoteOpener({
    objectHeadService: service, operationIdFactory(kind, index) {
      if (!factoryMutated) { factoryMutated = true; supplied.syncedPocketId = "factory-redirect"; }
      return operationId(kind, index);
    },
  }), result = await opener.openRemote({ masterKey: stage.key, context: supplied });
  assert.equal(factoryMutated, true); assert.equal(transportMutated, true);
  assert.equal(headMutatedAtGetBoundary, true); assert.equal(mutableHead.sealRef, "redirected");
  assert.equal(calls[1][0], "getOpaqueObject"); assert.equal(calls[1][1].storageRef, originalSeal);
  assert.equal(result.head.sealRef, originalSeal); assert.equal(Object.isFrozen(result.head), true);
  await result.session.readContent("n20");
  assert.ok(calls.length > 3);
  assert.equal(calls.every(([, body]) => body.syncedPocketId === "p124"), true);
});

test("P124e operation IDs are unique across Head and all object GETs", async () => {
  const { stage, remote } = await publishedFixture(2000), calls = [],
    result = await openRemote(runtime(), stage, remote, calls);
  await result.session.readContent("n1337");
  await result.session.readPlacement("n20");
  await result.session.readContent("n777");
  const bodies = calls.map(([, body]) => body), ids = bodies.map((body) => body.operationId),
    getIds = calls.filter(([route]) => route === "getOpaqueObject").map(([, body]) => body.operationId);
  assert.ok(getIds.length > 2);
  for (const id of ids) {
    assert.equal(typeof id, "string"); assert.ok(id.length > 0 && id.length <= 160); assert.equal(id, id.trim());
  }
  assert.equal(new Set(ids).size, ids.length);
  assert.deepEqual(ids.slice(0, 3), ["read-head-0", "get-object-0", "get-object-1"]);
  assert.deepEqual(getIds, getIds.map((_, index) => `get-object-${index}`));
});

test("P124c old unadopted Seal cannot override remote Head", async () => {
  const { writer, stage, remote } = await publishedFixture(), accepted = remote.head.sealRef,
    edited = writer.PocketStarlingRootShadow.editPayload(stage.state, "n20", { label: "abandoned", value: -1 }),
    logicalNext = logicalStage(writer, stage.stager, edited.state, stage.logical),
    physicalNext = await physicalStage(writer, stage.stager, logicalNext, stage.key, stage.physical);
  for (const entry of physicalNext.newRecords) remote.objects.set(entry.storageRef, entry.record);
  assert.notEqual(physicalNext.sealStorageRef, accepted);
  const reader = runtime(), rejectedCalls = [];
  await assert.rejects(openRemote(reader, stage, remote, rejectedCalls, {
    input: { masterKey: stage.key, context: context(), sealRef: physicalNext.sealStorageRef },
  }));
  assert.equal(rejectedCalls.length, 0);
  const calls = [], result = await openRemote(reader, stage, remote, calls);
  assert.equal(result.head.sealRef, accepted); assert.equal(calls[1][1].storageRef, accepted);
  assert.equal(calls.some(([, body]) => body.storageRef === physicalNext.sealStorageRef), false);
});

test("P124c missing Root and lazy object fail at exact boundary", async () => {
  const first = await publishedFixture(), refs = await sealAndRootRefs(first.writer, first.stage);
  first.remote.objects.delete(refs.root); const rootCalls = [];
  await assert.rejects(openRemote(runtime(), first.stage, first.remote, rootCalls), (e) => e && e.code === "remote-open-object-missing");
  assert.equal(rootCalls.at(-1)[1].storageRef, refs.root);
  const second = await publishedFixture(), probeCalls = [], probe = await openRemote(runtime(), second.stage, second.remote, probeCalls);
  await probe.session.readContent("n20");
  const lazyRef = probeCalls.slice(3).find(([, body]) => body.storageRef)[1].storageRef;
  second.remote.objects.delete(lazyRef); const lazyCalls = [], opened = await openRemote(runtime(), second.stage, second.remote, lazyCalls);
  assert.equal(opened.outcome, "opened");
  await assert.rejects(opened.session.readContent("n20"), (e) => e && e.code === "remote-open-object-missing");
  assert.equal(lazyCalls.at(-1)[1].storageRef, lazyRef);
});

test("P124c wrong key and corrupt authenticated material fail closed", async () => {
  const wrong = await publishedFixture(), wrongKey = await keyFor(wrong.writer, "wrong"), wrongCalls = [];
  await assert.rejects(openRemote(runtime(), { ...wrong.stage, key: wrongKey }, wrong.remote, wrongCalls),
    (e) => e && e.code === "object-authentication-failed");
  assert.equal(wrongCalls.length, 2);
  const corrupt = await publishedFixture(), record = corrupt.remote.objects.get(corrupt.remote.head.sealRef),
    changed = { ...record, ciphertext: `${record.ciphertext.startsWith("A") ? "B" : "A"}${record.ciphertext.slice(1)}` };
  corrupt.remote.objects.set(corrupt.remote.head.sealRef, changed); const corruptCalls = [];
  await assert.rejects(openRemote(runtime(), corrupt.stage, corrupt.remote, corruptCalls),
    (e) => e && ["object-reference-mismatch", "object-authentication-failed"].includes(e.code));
  assert.equal(corruptCalls.length, 2);
});

test("P124c exact empty states are frozen", async () => {
  const c = runtime(), stage = await genuineStage(c, 8);
  for (const [remoteHead, expected] of [[null, { outcome: "uninitialised", head: null }],
    [genesis(), { outcome: "empty", head: genesis() }]]) {
    const remote = remoteState(); remote.head = remoteHead; const calls = [], result = await openRemote(c, stage, remote, calls);
    assert.deepEqual(plain(result), expected); assert.equal(Object.isFrozen(result), true);
    if (result.head) assert.equal(Object.isFrozen(result.head), true);
    assert.deepEqual(calls.map(([route]) => route), ["readShadowHead"]);
  }
});

test("P124 retains bounded input Head and operation-ID failures", async () => {
  const c = runtime(), stage = await genuineStage(c, 8), remote = remoteState();
  for (const input of [{ masterKey: {}, context: context() }, { masterKey: stage.key, context: { syncedPocketId: " " } },
    ...["head", "sealRef", "acceptedSealStorageRef", "revision", "acceptedBaseComplete"].map((field) => ({ masterKey: stage.key, context: context(), [field]: "forged" }))]) {
    const calls = []; await assert.rejects(openRemote(c, stage, remote, calls, { input })); assert.equal(calls.length, 0);
  }
  for (const factory of [() => { throw new Error("factory"); }, () => "", () => " ", () => 123, () => "x".repeat(161)]) {
    const calls = []; await assert.rejects(openRemote(c, stage, remote, calls, { factory }),
      (e) => e && e.code === "remote-open-operation-id-invalid"); assert.equal(calls.length, 0);
  }
});

test("P124 retains missing Seal Head transport and no-secret boundaries", async () => {
  const { stage, remote } = await publishedFixture(8), seal = remote.head.sealRef;
  remote.objects.delete(seal); const absentCalls = [];
  await assert.rejects(openRemote(runtime(), stage, remote, absentCalls), (e) => e && e.code === "remote-open-object-missing");
  assert.deepEqual(absentCalls.map(([route]) => route), ["readShadowHead", "getOpaqueObject"]);
  const failedCalls = [];
  await assert.rejects(openRemote(runtime(), stage, remote, failedCalls, { hooks: { before() { throw new Error("offline"); } } }),
    (e) => e && e.code === "remote-unavailable");
  assert.deepEqual(failedCalls.map(([route]) => route), ["readShadowHead"]);
  const restored = await publishedFixture(8), result = await openRemote(runtime(), restored.stage, restored.remote, []);
  for (const field of ["masterKey", "context", "resolveStorage", "records", "handle", "bindings", "cache"])
    assert.equal(Object.hasOwn(result.session, field), false);
});

test("P124 stays absent from the real production release manifest", () => {
  const manifest = createProductionReleaseManifest({ browserRoot: ROOT, serviceRoot: "/pocket-sync/v1" }), paths = manifest.map((e) => e.path);
  assert.equal(paths.includes("/js/pocket-starling-remote-open-shadow.js"), false);
  for (const expected of ["/js/pocket-sync-local-integration.js", "/js/pocket-sync-additional-device.js",
    "/js/pocket-sync-emergency-recovery.js", "/js/pocket-sync-production-bootstrap.js"])
    assert.equal(paths.includes(expected), true, expected);
  assert.equal(fs.readFileSync(path.join(ROOT, "index.html"), "utf8").includes("pocket-starling-remote-open-shadow.js"), false);
  for (const entry of manifest.filter((e) => e.path.endsWith(".js")))
    assert.equal(fs.readFileSync(path.join(ROOT, `.${entry.path}`), "utf8").includes("PocketStarlingRemoteOpenShadow"), false, entry.path);
});
