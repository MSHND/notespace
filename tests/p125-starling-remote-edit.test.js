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
    "js/pocket-starling-remote-edit-shadow.js",
  ];

function runtime() {
  const c = { crypto: webcrypto, TextEncoder, TextDecoder, Uint8Array, ArrayBuffer, URL,
    Date, Math, JSON, Map, Set, WeakMap, WeakSet, Object, Array, String, Number,
    Boolean, Promise, Error, btoa: (value) => Buffer.from(value, "binary").toString("base64"),
    atob: (value) => Buffer.from(value, "base64").toString("binary"),
    localStorage: { getItem() {}, setItem() {}, removeItem() {} },
    document: { body: { classList: { add() {}, remove() {}, toggle() {} } }, getElementById() {}, addEventListener() {} },
    navigator: { clipboard: {} }, location: { href: "https://example.test" }, indexedDB: null,
    open() {}, close() {}, setTimeout, clearTimeout, requestAnimationFrame() { return 1; }, cancelAnimationFrame() {} };
  c.window = c; c.globalThis = c; vm.createContext(c);
  for (const file of SCRIPTS) vm.runInContext(fs.readFileSync(path.join(ROOT, file), "utf8"), c, { filename: file });
  return c;
}

const plain = (value) => JSON.parse(JSON.stringify(value)),
  context = (syncedPocketId = "p125") => ({ syncedPocketId }),
  genesis = () => ({ schema: HEAD_SCHEMA, revision: 0, sealRef: null }),
  operationId = (kind, index) => `${kind}-${index}`;

function stateFor(c, count = 1000) {
  const encoded = c.PocketStarlingBridgeShadow.encode({ schema: "portal.mtt.web.v1", writtenAt: "2026-08-30T00:00:00.000Z",
      nodes: Array.from({ length: count }, (_, index) => ({ id: `n${index}`, parentId: "root", order: index, label: `Node ${index}`, value: index })),
      tombstones: [], rootExtras: {}, dataExtras: {} }, { capacity: 4 }),
    built = c.PocketStarlingRootShadow.build(encoded.bridge);
  assert.equal(encoded.ok, true); assert.equal(built.ok, true); return built.state;
}

async function keyFor(c, syncedPocketId = "p125", envelopeId = "device") {
  const wrappingKey = await c.PocketSyncCrypto.generateDeviceWrappingKey(), bundle = await c.PocketSyncCrypto.createMasterKeyBundle([{
    context: { syncedPocketId, envelopeId, envelopeKind: "device", envelopeVersion: 1 }, wrappingKey,
  }]);
  return bundle.masterKey;
}

async function publishedFixture(count = 1000) {
  const writer = runtime(), state = stateFor(writer, count), stager = writer.PocketStarlingObjectSealShadow.createStager(),
    logicalResult = writer.PocketStarlingObjectSealShadow.stageCandidate(stager, state, { previousSealRef: null });
  assert.equal(logicalResult.ok, true);
  const key = await keyFor(writer), physical = await writer.PocketStarlingStorageShadow.stageCandidate({
    sealRef: logicalResult.stage.sealRef, resolveLogical: (ref) => stager.store.get(ref), masterKey: key, context: context(),
  }), confirmed = writer.PocketStarlingObjectSealShadow.verifyNewObjectPresence(logicalResult.stage, (ref) => stager.store.has(ref), {});
  assert.equal(confirmed.ok, true);
  const remote = { objects: new Map(), head: genesis() }, publishCalls = [], publisher = writer.PocketStarlingPublicationShadow.createPublisher({
    objectHeadService: serviceFor(writer, remote, publishCalls), operationIdFactory: operationId,
  }), published = await publisher.publishCandidate({ stage: physical, expectedHead: genesis() });
  assert.equal(published.outcome, "committed");
  return { writer, key, physical, remote };
}

function transportFor(remote, calls) {
  return { async request(route, body) {
    calls.push([route, plain(body)]);
    const common = { apiVersion: 1, ok: true, operationId: body.operationId, syncedPocketId: body.syncedPocketId };
    if (route === "putOpaqueObject") {
      const created = !remote.objects.has(body.storageRef); remote.objects.set(body.storageRef, body.record);
      return { status: 200, body: { ...common, storageRef: body.storageRef, created } };
    }
    if (route === "objectPresence") return { status: 200, body: { ...common, rows: body.storageRefs.map((storageRef) => ({ storageRef, present: remote.objects.has(storageRef) })) } };
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

const serviceFor = (c, remote, calls) => c.PocketSyncRemoteClient.createObjectHeadService({ transport: transportFor(remote, calls) });

async function openedFixture(count = 1000) {
  const fixture = await publishedFixture(count), reader = runtime(), calls = [], opener = reader.PocketStarlingRemoteOpenShadow.createRemoteOpener({
    objectHeadService: serviceFor(reader, fixture.remote, calls), operationIdFactory: operationId,
  }), opened = await opener.openRemote({ masterKey: fixture.key, context: context() });
  return { ...fixture, reader, calls, opened };
}

function forbidden(routes) {
  return routes.some((route) => ["putOpaqueObject", "objectPresence", "compareAndSetShadowHead", "initialiseShadowHead", "readShadowHead"].includes(route));
}

test("P125 composes real P122 P124 P114 P112 P121 preparation without remote write", async () => {
  const { reader, key, physical, remote, calls, opened } = await openedFixture(2000), afterOpen = calls.length,
    editor = await reader.PocketStarlingRemoteEditShadow.createEditor({ opened, masterKey: key, context: context() }),
    prepared = await editor.preparePayloadEdit({ nodeId: "n1337", payload: { label: "P125 changed", value: 125 } });
  assert.deepEqual(Object.keys(reader.PocketStarlingRemoteEditShadow), ["createEditor"]);
  assert.equal(Object.isFrozen(reader.PocketStarlingRemoteEditShadow), true);
  assert.deepEqual(Object.keys(editor), ["preparePayloadEdit"]); assert.equal(Object.isFrozen(editor), true);
  assert.deepEqual(Object.keys(prepared), ["outcome", "expectedHead", "stage", "binding"]); assert.equal(Object.isFrozen(prepared), true);
  assert.equal(prepared.outcome, "prepared"); assert.equal(Object.isFrozen(prepared.expectedHead), true);
  assert.deepEqual(plain(prepared.expectedHead), plain(remote.head));
  assert.equal(prepared.binding.expectedSealStorageRef, remote.head.sealRef);
  assert.equal(prepared.binding.candidateSealStorageRef, prepared.stage.sealStorageRef);
  assert.notEqual(prepared.stage.sealStorageRef, remote.head.sealRef);
  assert.ok(prepared.stage.newRecords.length < 30);
  assert.ok(prepared.stage.newRecords.length * 20 < physical.newRecords.length);
  assert.equal(forbidden(calls.slice(afterOpen).map(([route]) => route)), false);
  const staged = new Map(remote.objects);
  for (const entry of prepared.stage.newRecords) staged.set(entry.storageRef, entry.record);
  const resolver = await reader.PocketStarlingStorageShadow.createResolver({
    acceptedSealStorageRef: prepared.stage.sealStorageRef, acceptedBaseComplete: true, masterKey: key, context: context(),
    resolveStorage: (ref) => staged.get(ref),
  }), accepted = await resolver.openAccepted(), changed = await resolver.readContent(accepted.handle, "n1337");
  assert.deepEqual(plain(changed.payload), { label: "P125 changed", value: 125 });
  const beforeIncomplete = calls.length;
  await assert.rejects(reader.PocketStarlingStorageShadow.stageCandidate({
    sealRef: "proof-ref:v1:candidate-seal:00000000", resolveLogical() { throw new Error("must not traverse"); },
    masterKey: key, context: context(), baseStage: prepared.stage,
  }), (error) => error && error.code === "base-stage-incomplete");
  assert.equal(calls.length, beforeIncomplete);
  for (const field of ["masterKey", "context", "base", "freshBaseProof", "session", "resolveLogical", "candidate", "cache", "bindings"])
    assert.equal(Object.hasOwn(editor, field) || Object.hasOwn(prepared, field), false, field);
});

test("P125 returns exact frozen unchanged without a stage or binding", async () => {
  const { reader, key, calls, opened } = await openedFixture(), editor = await reader.PocketStarlingRemoteEditShadow.createEditor({
    opened, masterKey: key, context: context(),
  }), before = calls.length, unchanged = await editor.preparePayloadEdit({ nodeId: "n20", payload: { label: "Node 20", value: 20 } });
  assert.deepEqual(plain(unchanged), { outcome: "unchanged" }); assert.equal(Object.isFrozen(unchanged), true);
  assert.equal(Object.hasOwn(unchanged, "stage"), false); assert.equal(Object.hasOwn(unchanged, "binding"), false);
  assert.equal(forbidden(calls.slice(before).map(([route]) => route)), false);
});

test("P125 snapshots Head authority and rejects redirects before publication", async () => {
  const { reader, key, remote, calls, opened } = await openedFixture(), originalSeal = opened.head.sealRef,
    mutable = { outcome: "opened", head: { ...opened.head }, session: opened.session },
    editor = await reader.PocketStarlingRemoteEditShadow.createEditor({ opened: mutable, masterKey: key, context: context() });
  mutable.head.sealRef = "redirected";
  const prepared = await editor.preparePayloadEdit({ nodeId: "n20", payload: { label: "snapshotted", value: 125 } });
  assert.equal(prepared.expectedHead.sealRef, originalSeal); assert.equal(prepared.binding.expectedSealStorageRef, originalSeal);
  assert.equal(remote.head.sealRef, originalSeal); assert.equal(forbidden(calls.slice(3).map(([route]) => route)), false);
  const lookalike = { outcome: "opened", head: { ...opened.head, sealRef: "other-physical-seal" }, session: opened.session }, before = calls.length,
    redirected = await reader.PocketStarlingRemoteEditShadow.createEditor({ opened: lookalike, masterKey: key, context: context() });
  await assert.rejects(redirected.preparePayloadEdit({ nodeId: "n21", payload: { label: "rejected", value: -1 } }),
    (error) => error && error.code === "remote-edit-authority-mismatch");
  assert.equal(forbidden(calls.slice(before).map(([route]) => route)), false);
});

test("P125 rejects forged proof, key, context, and authority-looking inputs without callbacks", async () => {
  const { reader, key, calls, opened } = await openedFixture();
  let callbacks = 0;
  const watchedSession = { ...opened.session, createReuseProof() { callbacks += 1; return opened.session.createReuseProof(); } },
    watched = { outcome: "opened", head: { ...opened.head }, session: watchedSession };
  await assert.rejects(reader.PocketStarlingRemoteEditShadow.createEditor({ opened: watched, masterKey: {}, context: context() }),
    (error) => error && error.code === "remote-edit-input-invalid");
  await assert.rejects(reader.PocketStarlingRemoteEditShadow.createEditor({ opened: watched, masterKey: key, context: { syncedPocketId: " " } }),
    (error) => error && error.code === "remote-edit-input-invalid");
  for (const field of ["expectedHead", "sealRef", "revision", "baseStage", "freshBaseProof", "newLogicalRefs", "acceptedSealStorageRef", "candidateSealStorageRef"])
    await assert.rejects(reader.PocketStarlingRemoteEditShadow.createEditor({ opened: watched, masterKey: key, context: context(), [field]: "redirect" }),
      (error) => error && error.code === "remote-edit-input-invalid", field);
  assert.equal(callbacks, 0);
  const editor = await reader.PocketStarlingRemoteEditShadow.createEditor({ opened, masterKey: key, context: context() }), beforeExtra = calls.length;
  for (const field of ["expectedHead", "sealRef", "revision", "baseStage", "freshBaseProof", "newLogicalRefs", "acceptedSealStorageRef", "candidateSealStorageRef"])
    await assert.rejects(editor.preparePayloadEdit({ nodeId: "n20", payload: {}, [field]: "redirect" }),
      (error) => error && error.code === "remote-edit-input-invalid", field);
  assert.equal(calls.length, beforeExtra);
  const forgedSession = { ...opened.session, createReuseProof: () => Object.freeze({}) }, forged = await reader.PocketStarlingRemoteEditShadow.createEditor({
    opened: { outcome: "opened", head: { ...opened.head }, session: forgedSession }, masterKey: key, context: context(),
  });
  await assert.rejects(forged.preparePayloadEdit({ nodeId: "n20", payload: { label: "forged", value: 1 } }),
    (error) => error && error.code === "fresh-base-invalid");
  const otherKey = await keyFor(reader), wrongKey = await reader.PocketStarlingRemoteEditShadow.createEditor({ opened, masterKey: otherKey, context: context() });
  await assert.rejects(wrongKey.preparePayloadEdit({ nodeId: "n20", payload: { label: "wrong key", value: 2 } }),
    (error) => error && error.code === "fresh-base-mismatch");
  const wrongContext = await reader.PocketStarlingRemoteEditShadow.createEditor({ opened, masterKey: key, context: context("other-pocket") });
  await assert.rejects(wrongContext.preparePayloadEdit({ nodeId: "n20", payload: { label: "wrong context", value: 3 } }),
    (error) => error && error.code === "fresh-base-mismatch");
});

test("P125 remains absent from production release and live owners", () => {
  const source = fs.readFileSync(path.join(ROOT, "js/pocket-starling-remote-edit-shadow.js"), "utf8"),
    manifest = createProductionReleaseManifest({ browserRoot: ROOT, serviceRoot: "/pocket-sync/v1" }), paths = manifest.map((entry) => entry.path);
  assert.equal(source.includes("verifyNewRecordPresence"), false);
  assert.equal(paths.includes("/js/pocket-starling-remote-edit-shadow.js"), false);
  assert.equal(fs.readFileSync(path.join(ROOT, "index.html"), "utf8").includes("pocket-starling-remote-edit-shadow.js"), false);
  for (const entry of manifest.filter((item) => item.path.endsWith(".js")))
    assert.equal(fs.readFileSync(path.join(ROOT, `.${entry.path}`), "utf8").includes("PocketStarlingRemoteEditShadow"), false, entry.path);
});
