"use strict";

const test = require("node:test"), assert = require("node:assert/strict"),
  fs = require("node:fs"), path = require("node:path"), vm = require("node:vm"),
  { webcrypto } = require("node:crypto"),
  { createProductionReleaseManifest } = require("../sync-service/pocket-sync-production-server.js"),
  ROOT = path.resolve(__dirname, ".."), HEAD_SCHEMA = "pocket.starling.head.v1",
  SCRIPTS = [
    "js/pocket-state.js", "js/pocket-data.js", "js/pocket-outline-persistence-policy.js", "js/pocket-editor-metadata.js",
    "js/pocket-pe-import-preserve.js", "js/pocket-storage.js", "js/pocket-import.js", "js/pocket-starling-shadow.js",
    "js/pocket-starling-sequence-shadow.js", "js/pocket-starling-placement-shadow.js", "js/pocket-starling-bridge-shadow.js",
    "js/pocket-starling-root-shadow.js", "js/pocket-starling-object-seal-shadow.js", "js/pocket-sync-crypto.js",
    "js/pocket-starling-crypto-shadow.js", "js/pocket-starling-storage-shadow.js", "js/pocket-starling-head-shadow.js",
    "js/pocket-sync-remote-client.js", "js/pocket-starling-logical-edit-shadow.js", "js/pocket-starling-publication-shadow.js",
    "js/pocket-starling-remote-open-shadow.js", "js/pocket-starling-remote-edit-shadow.js",
  ];

function runtime() {
  const c = { crypto: webcrypto, TextEncoder, TextDecoder, Uint8Array, ArrayBuffer, URL, Date, Math, JSON, Map, Set, WeakMap, WeakSet,
    Object, Array, String, Number, Boolean, Promise, Error, btoa: (v) => Buffer.from(v, "binary").toString("base64"),
    atob: (v) => Buffer.from(v, "base64").toString("binary"), localStorage: { getItem() {}, setItem() {}, removeItem() {} },
    document: { body: { classList: { add() {}, remove() {}, toggle() {} } }, getElementById() {}, addEventListener() {} }, navigator: { clipboard: {} },
    location: { href: "https://example.test" }, indexedDB: null, open() {}, close() {}, setTimeout, clearTimeout,
    requestAnimationFrame() { return 1; }, cancelAnimationFrame() {} };
  c.window = c; c.globalThis = c; vm.createContext(c);
  for (const file of SCRIPTS) vm.runInContext(fs.readFileSync(path.join(ROOT, file), "utf8"), c, { filename: file });
  return c;
}

const plain = (value) => JSON.parse(JSON.stringify(value)), context = () => ({ syncedPocketId: "p126" }),
  genesis = () => ({ schema: HEAD_SCHEMA, revision: 0, sealRef: null }), factory = (prefix) => (kind, index) => `${prefix}-${kind}-${index}`;

function stateFor(c, count = 2000) {
  const encoded = c.PocketStarlingBridgeShadow.encode({ schema: "portal.mtt.web.v1", writtenAt: "2026-08-30T00:00:00.000Z",
      nodes: Array.from({ length: count }, (_, index) => ({ id: `n${index}`, parentId: "root", order: index, label: `Node ${index}`, value: index })),
      tombstones: [], rootExtras: {}, dataExtras: {} }, { capacity: 4 }), built = c.PocketStarlingRootShadow.build(encoded.bridge);
  assert.equal(encoded.ok, true); assert.equal(built.ok, true); return built.state;
}

async function keyFor(c) {
  const wrappingKey = await c.PocketSyncCrypto.generateDeviceWrappingKey(), bundle = await c.PocketSyncCrypto.createMasterKeyBundle([{
    context: { syncedPocketId: "p126", envelopeId: "device", envelopeKind: "device", envelopeVersion: 1 }, wrappingKey,
  }]);
  return bundle.masterKey;
}

function remoteState() { return { objects: new Map(), head: genesis(), calls: [], casMode: "normal" }; }

function transport(remote) {
  return { async request(route, body) {
    remote.calls.push([route, plain(body)]);
    const common = { apiVersion: 1, ok: true, operationId: body.operationId, syncedPocketId: body.syncedPocketId };
    if (route === "putOpaqueObject") {
      const created = !remote.objects.has(body.storageRef); remote.objects.set(body.storageRef, body.record);
      return { status: 200, body: { ...common, storageRef: body.storageRef, created } };
    }
    if (route === "objectPresence") return { status: 200, body: { ...common, rows: body.storageRefs.map((storageRef) => ({ storageRef, present: remote.objects.has(storageRef) })) } };
    if (route === "compareAndSetShadowHead") {
      if (remote.head.revision !== body.expectedHead.revision || remote.head.sealRef !== body.expectedHead.sealRef)
        return { status: 409, body: { ...common, ok: false, reason: "head-conflict" } };
      const next = { schema: HEAD_SCHEMA, revision: body.expectedHead.revision + 1, sealRef: body.candidateSealStorageRef };
      if (remote.casMode === "apply-throw") { remote.head = next; throw new Error("uncertain-after-apply"); }
      if (remote.casMode === "throw-before") throw new Error("uncertain-before-apply");
      remote.head = next; return { status: 200, body: { ...common, head: next } };
    }
    if (route === "readShadowHead") return { status: 200, body: { ...common, head: remote.head } };
    if (route === "getOpaqueObject") {
      const record = remote.objects.get(body.storageRef);
      return { status: 200, body: { ...common, storageRef: body.storageRef, present: !!record, record: record || null } };
    }
    throw new Error(`unexpected ${route}`);
  } };
}

function service(c, remote) { return c.PocketSyncRemoteClient.createObjectHeadService({ transport: transport(remote) }); }
function publisher(c, remote, prefix) { return c.PocketStarlingPublicationShadow.createPublisher({ objectHeadService: service(c, remote), operationIdFactory: factory(prefix) }); }
function reconciler(c, remote, prefix) { return c.PocketStarlingPublicationShadow.createReconciler({ objectHeadService: service(c, remote), operationIdFactory: factory(prefix) }); }

async function setup(count = 2000) {
  const writer = runtime(), state = stateFor(writer, count), stager = writer.PocketStarlingObjectSealShadow.createStager(),
    logical = writer.PocketStarlingObjectSealShadow.stageCandidate(stager, state, { previousSealRef: null });
  assert.equal(logical.ok, true);
  const key = await keyFor(writer), physical = await writer.PocketStarlingStorageShadow.stageCandidate({
    sealRef: logical.stage.sealRef, resolveLogical: (ref) => stager.store.get(ref), masterKey: key, context: context(),
  }), confirmed = writer.PocketStarlingObjectSealShadow.verifyNewObjectPresence(logical.stage, (ref) => stager.store.has(ref), {});
  assert.equal(confirmed.ok, true);
  const remote = remoteState(), committed = await publisher(writer, remote, "genesis").publishCandidate({ stage: physical, expectedHead: genesis() });
  assert.equal(committed.outcome, "committed"); return { writer, key, physical, remote };
}

async function openFresh(fixture, prefix) {
  const reader = runtime(), opened = await reader.PocketStarlingRemoteOpenShadow.createRemoteOpener({
    objectHeadService: service(reader, fixture.remote), operationIdFactory: factory(prefix),
  }).openRemote({ masterKey: fixture.key, context: context() });
  return { reader, opened };
}

async function prepare(reader, opened, key, nodeId, payload) {
  const editor = await reader.PocketStarlingRemoteEditShadow.createEditor({ opened, masterKey: key, context: context() });
  return editor.preparePayloadEdit({ nodeId, payload });
}

function callsSince(remote, offset) { return remote.calls.slice(offset); }
function casCalls(remote, offset) { return callsSince(remote, offset).filter(([route]) => route === "compareAndSetShadowHead"); }
async function expectIncomplete(c, stage, key) {
  await assert.rejects(c.PocketStarlingStorageShadow.stageCandidate({
    sealRef: "proof-ref:v1:candidate-seal:00000000", resolveLogical() { throw new Error("no traversal"); }, masterKey: key, context: context(), baseStage: stage,
  }), (error) => error && error.code === "base-stage-incomplete");
}

test("P126 definite commit closes the manual remote edit publication loop", async () => {
  const fixture = await setup(), first = await openFresh(fixture, "open-one"), revisionOne = plain(fixture.remote.head), afterOpen = fixture.remote.calls.length,
    mutableOpened = { outcome: "opened", head: { ...first.opened.head }, session: first.opened.session },
    editor = await first.reader.PocketStarlingRemoteEditShadow.createEditor({ opened: mutableOpened, masterKey: fixture.key, context: context() });
  mutableOpened.head.revision = 99; mutableOpened.head.sealRef = "redirected-before-prepare";
  const prepared = await editor.preparePayloadEdit({ nodeId: "n1337", payload: { label: "committed", value: 126 } });
  mutableOpened.head.revision = 100; mutableOpened.head.sealRef = "redirected-after-prepare";
  assert.equal(prepared.outcome, "prepared"); assert.equal(Object.isFrozen(prepared.expectedHead), true);
  assert.deepEqual(plain(prepared.expectedHead), revisionOne); assert.equal(prepared.binding.expectedSealStorageRef, revisionOne.sealRef);
  assert.equal(prepared.binding.candidateSealStorageRef, prepared.stage.sealStorageRef); assert.notEqual(prepared.stage.sealStorageRef, revisionOne.sealRef);
  assert.notDeepEqual(mutableOpened.head, revisionOne);
  assert.ok(prepared.stage.newRecords.length < 30); assert.ok(prepared.stage.newRecords.length * 20 < fixture.physical.newRecords.length);
  const beforePublish = fixture.remote.calls.length, result = await publisher(first.reader, fixture.remote, "publish-one").publishCandidate({ stage: prepared.stage, expectedHead: prepared.expectedHead });
  assert.deepEqual(plain(result), { outcome: "committed", head: { schema: HEAD_SCHEMA, revision: 2, sealRef: prepared.stage.sealStorageRef } });
  assert.equal(fixture.remote.head.revision, 2); assert.equal(fixture.remote.head.sealRef, prepared.binding.candidateSealStorageRef);
  assert.equal(casCalls(fixture.remote, beforePublish).length, 1); assert.deepEqual(casCalls(fixture.remote, beforePublish)[0][1].expectedHead, plain(prepared.expectedHead));
  assert.equal(casCalls(fixture.remote, beforePublish)[0][1].candidateSealStorageRef, prepared.binding.candidateSealStorageRef);
  assert.equal(callsSince(fixture.remote, beforePublish).some(([route]) => route === "readShadowHead"), false);
  await assert.rejects(first.reader.PocketStarlingStorageShadow.stageCandidate({
    sealRef: "proof-ref:v1:candidate-seal:00000000", resolveLogical() { throw new Error("reached traversal"); }, masterKey: fixture.key, context: context(), baseStage: prepared.stage,
  }), (error) => error && error.code === "logical-resolution-failed");
  const second = await openFresh(fixture, "open-two"), edited = await second.opened.session.readContent("n1337");
  assert.deepEqual(plain(edited.payload), { label: "committed", value: 126 });
  const next = await prepare(second.reader, second.opened, fixture.key, "n1337", { label: "second", value: 127 });
  assert.equal(next.outcome, "prepared"); assert.equal(next.binding.expectedSealStorageRef, fixture.remote.head.sealRef); assert.notEqual(next.binding.candidateSealStorageRef, fixture.remote.head.sealRef);
  assert.ok(next.stage.newRecords.length < 30); assert.ok(callsSince(fixture.remote, afterOpen).filter(([route]) => route === "getOpaqueObject").length < 40);
});

test("P126 unchanged P125 result never enters publication", async () => {
  const fixture = await setup(), { reader, opened } = await openFresh(fixture, "unchanged-open"), before = fixture.remote.calls.length,
    unchanged = await prepare(reader, opened, fixture.key, "n20", { label: "Node 20", value: 20 });
  assert.deepEqual(plain(unchanged), { outcome: "unchanged" }); assert.equal(Object.isFrozen(unchanged), true);
  const routes = callsSince(fixture.remote, before).map(([route]) => route);
  assert.equal(routes.some((route) => ["putOpaqueObject", "objectPresence", "compareAndSetShadowHead", "readShadowHead"].includes(route)), false);
});

test("P126 conflict preserves material but Head selects the competing candidate", async () => {
  const fixture = await setup(), a = await openFresh(fixture, "a-open"), b = await openFresh(fixture, "b-open"),
    candidateA = await prepare(a.reader, a.opened, fixture.key, "n20", { label: "A", value: 1 }),
    candidateB = await prepare(b.reader, b.opened, fixture.key, "n20", { label: "B", value: 2 });
  const beforeB = fixture.remote.calls.length, committedB = await publisher(b.reader, fixture.remote, "publish-b").publishCandidate({ stage: candidateB.stage, expectedHead: candidateB.expectedHead });
  assert.equal(committedB.outcome, "committed"); assert.equal(casCalls(fixture.remote, beforeB).length, 1);
  const beforeA = fixture.remote.calls.length, rejectedA = await publisher(a.reader, fixture.remote, "publish-a").publishCandidate({ stage: candidateA.stage, expectedHead: candidateA.expectedHead });
  assert.deepEqual(plain(rejectedA), { outcome: "conflict", reason: "head-conflict" }); assert.equal(casCalls(fixture.remote, beforeA).length, 1);
  assert.equal(callsSince(fixture.remote, beforeA).some(([route]) => ["readShadowHead", "getOpaqueObject"].includes(route)), false);
  assert.equal(fixture.remote.head.sealRef, candidateB.binding.candidateSealStorageRef); assert.equal(fixture.remote.objects.has(candidateA.stage.sealStorageRef), true);
  await expectIncomplete(a.reader, candidateA.stage, fixture.key);
  const fresh = await openFresh(fixture, "conflict-open"), content = await fresh.opened.session.readContent("n20");
  assert.deepEqual(plain(content.payload), { label: "B", value: 2 });
});

test("P126 explicit reconciliation observes an ambiguously committed CAS without completion", async () => {
  const fixture = await setup(), opened = await openFresh(fixture, "ambiguous-commit-open"),
    prepared = await prepare(opened.reader, opened.opened, fixture.key, "n20", { label: "ambiguous committed", value: 3 });
  fixture.remote.casMode = "apply-throw"; const beforePublish = fixture.remote.calls.length;
  await assert.rejects(publisher(opened.reader, fixture.remote, "ambiguous-commit-publish").publishCandidate({ stage: prepared.stage, expectedHead: prepared.expectedHead }),
    (error) => error && error.code === "publication-outcome-unknown");
  assert.equal(casCalls(fixture.remote, beforePublish).length, 1); assert.equal(callsSince(fixture.remote, beforePublish).some(([route]) => route === "readShadowHead"), false);
  await expectIncomplete(opened.reader, prepared.stage, fixture.key);
  fixture.remote.casMode = "normal"; const beforeRejectedReconcile = fixture.remote.calls.length;
  await assert.rejects(reconciler(opened.reader, fixture.remote, "ambiguous-commit-reject").reconcileAmbiguousPublication({ stage: prepared.stage, expectedHead: prepared.expectedHead, masterKey: fixture.key, context: context(), sealRef: "redirect" }),
    (error) => error && error.code === "publication-input-invalid");
  assert.equal(fixture.remote.calls.length, beforeRejectedReconcile);
  const beforeReconcile = fixture.remote.calls.length,
    reconciled = await reconciler(opened.reader, fixture.remote, "ambiguous-commit-reconcile").reconcileAmbiguousPublication({ stage: prepared.stage, expectedHead: prepared.expectedHead, masterKey: fixture.key, context: context() });
  assert.deepEqual(plain(reconciled), { outcome: "committed", examined: 1 });
  assert.equal(callsSince(fixture.remote, beforeReconcile).every(([route]) => ["readShadowHead", "getOpaqueObject"].includes(route)), true);
  await expectIncomplete(opened.reader, prepared.stage, fixture.key);
  const fresh = await openFresh(fixture, "ambiguous-commit-reopen"), content = await fresh.opened.session.readContent("n20");
  assert.deepEqual(plain(content.payload), { label: "ambiguous committed", value: 3 });
  assert.equal(casCalls(fixture.remote, beforePublish).length, 1);
  assert.equal(callsSince(fixture.remote, beforeReconcile).every(([route]) => ["readShadowHead", "getOpaqueObject"].includes(route)), true);
});

test("P126 explicit reconciliation leaves an ambiguously uncommitted candidate unadopted", async () => {
  const fixture = await setup(), opened = await openFresh(fixture, "ambiguous-none-open"), original = await opened.opened.session.readContent("n20"),
    prepared = await prepare(opened.reader, opened.opened, fixture.key, "n20", { label: "not committed", value: 4 });
  fixture.remote.casMode = "throw-before"; const beforePublish = fixture.remote.calls.length;
  await assert.rejects(publisher(opened.reader, fixture.remote, "ambiguous-none-publish").publishCandidate({ stage: prepared.stage, expectedHead: prepared.expectedHead }),
    (error) => error && error.code === "publication-outcome-unknown");
  assert.equal(casCalls(fixture.remote, beforePublish).length, 1); await expectIncomplete(opened.reader, prepared.stage, fixture.key);
  fixture.remote.casMode = "normal"; const beforeReconcile = fixture.remote.calls.length,
    reconciled = await reconciler(opened.reader, fixture.remote, "ambiguous-none-reconcile").reconcileAmbiguousPublication({ stage: prepared.stage, expectedHead: prepared.expectedHead, masterKey: fixture.key, context: context() });
  assert.deepEqual(plain(reconciled), { outcome: "not-committed", examined: 0 });
  assert.deepEqual(callsSince(fixture.remote, beforeReconcile).map(([route]) => route), ["readShadowHead"]);
  await expectIncomplete(opened.reader, prepared.stage, fixture.key);
  const fresh = await openFresh(fixture, "ambiguous-none-reopen"), content = await fresh.opened.session.readContent("n20");
  assert.deepEqual(plain(content.payload), plain(original.payload)); assert.equal(fixture.remote.objects.has(prepared.stage.sealStorageRef), true);
  assert.deepEqual(plain(fixture.remote.head), plain(prepared.expectedHead)); assert.equal(casCalls(fixture.remote, beforePublish).length, 1);
  assert.equal(callsSince(fixture.remote, beforeReconcile).every(([route]) => ["readShadowHead", "getOpaqueObject"].includes(route)), true);
});

test("P126 keeps P125 dormant outside this proof", () => {
  const manifest = createProductionReleaseManifest({ browserRoot: ROOT, serviceRoot: "/pocket-sync/v1" }), paths = manifest.map((entry) => entry.path);
  assert.equal(paths.includes("/js/pocket-starling-remote-edit-shadow.js"), false);
  assert.equal(fs.readFileSync(path.join(ROOT, "index.html"), "utf8").includes("pocket-starling-remote-edit-shadow.js"), false);
  for (const entry of manifest.filter((item) => item.path.endsWith(".js")))
    assert.equal(fs.readFileSync(path.join(ROOT, `.${entry.path}`), "utf8").includes("PocketStarlingRemoteEditShadow"), false, entry.path);
});
