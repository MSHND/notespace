"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { webcrypto } = require("node:crypto");
const { createSnapshotCursor } = require("./helpers/p366-snapshot-cursor.js");

const ROOT = path.resolve(__dirname, "..");
const HEAD_SCHEMA = "pocket.starling.head.v1";
const SCRIPTS = [
  "js/pocket-state.js", "js/pocket-data.js", "js/pocket-outline-persistence-policy.js",
  "js/pocket-node-content.js", "js/pocket-editor-metadata.js", "js/pocket-pe-import-preserve.js",
  "js/pocket-storage.js", "js/pocket-import.js", "js/pocket-starling-shadow.js",
  "js/pocket-starling-sequence-shadow.js", "js/pocket-starling-placement-shadow.js",
  "js/pocket-starling-bridge-shadow.js", "js/pocket-starling-root-shadow.js",
  "js/pocket-starling-object-seal-shadow.js", "js/pocket-sync-crypto.js",
  "js/pocket-starling-semantic-authority-shadow.js", "js/pocket-starling-crypto-shadow.js",
  "js/pocket-starling-storage-shadow.js", "js/pocket-starling-head-shadow.js",
  "js/pocket-sync-remote-client.js", "js/pocket-starling-logical-edit-shadow.js",
  "js/pocket-starling-publication-shadow.js", "js/pocket-starling-remote-open-shadow.js",
  "js/pocket-starling-materialize-shadow.js",
];

const bundles = new WeakMap();
const plain = (value) => JSON.parse(JSON.stringify(value));
const context = () => ({ syncedPocketId: "p366" });

function runtime() {
  const c = { crypto: webcrypto, TextEncoder, TextDecoder, Uint8Array, ArrayBuffer, URL,
    Date, Math, JSON, Map, Set, WeakMap, WeakSet, Object, Array, String, Number,
    Boolean, Promise, Error, btoa: (value) => Buffer.from(value, "binary").toString("base64"),
    atob: (value) => Buffer.from(value, "base64").toString("binary"),
    localStorage: { getItem() {}, setItem() {}, removeItem() {} },
    document: { body: { classList: { add() {}, remove() {}, toggle() {} } }, getElementById() {}, addEventListener() {} },
    navigator: { clipboard: {} }, location: { href: "https://example.test" }, indexedDB: null,
    open() {}, close() {}, setTimeout, clearTimeout, requestAnimationFrame() { return 1; }, cancelAnimationFrame() {} };
  c.window = c;
  c.globalThis = c;
  vm.createContext(c);
  for (const file of SCRIPTS) vm.runInContext(fs.readFileSync(path.join(ROOT, file), "utf8"), c, { filename: file });
  return c;
}

function fixtureState(c, count) {
  const nodes = [
    { id: "visible", parentId: "root", order: 0, label: "Visible" },
    { id: "unrelated", parentId: "root", order: 1, label: "Unrelated root sibling" },
    { id: "visible-first", parentId: "visible", order: 0, label: "Visible first" },
    { id: "visible-second", parentId: "visible", order: 1, label: "Visible second" },
  ];
  let parentId = "unrelated";
  for (let index = 0; index < count - nodes.length; index += 1) {
    const id = `bulk-${String(index).padStart(4, "0")}`;
    nodes.push({ id, parentId, order: 0, label: `Unrelated ${index}` });
    parentId = id;
  }
  const encoded = c.PocketStarlingBridgeShadow.encode({
    schema: "portal.mtt.web.v1", writtenAt: "2026-10-13T00:00:00.000Z", nodes,
    tombstones: [], rootExtras: {}, dataExtras: {},
  }, { capacity: 4 });
  const built = c.PocketStarlingRootShadow.build(encoded.bridge);
  assert.equal(encoded.ok, true);
  assert.equal(built.ok, true);
  return { state: built.state, nodes };
}

async function keyFor(c) {
  const wrappingKey = await c.PocketSyncCrypto.generateDeviceWrappingKey();
  const envelopeContext = { syncedPocketId: "p366", envelopeId: "device", envelopeKind: "device", envelopeVersion: 1 };
  const bundle = await c.PocketSyncCrypto.createMasterKeyBundle([{ context: envelopeContext, wrappingKey }], { semanticAuthority: true });
  bundles.set(bundle.masterKey, { wrappingKey, envelopeContext, record: bundle.envelopes[0].record, semanticAuthority: bundle.semanticAuthority });
  return bundle.masterKey;
}

async function stageFixture(c, count) {
  const { state, nodes } = fixtureState(c, count);
  const stager = c.PocketStarlingObjectSealShadow.createStager();
  const logical = c.PocketStarlingObjectSealShadow.stageCandidate(stager, state, { previousSealRef: null });
  assert.equal(logical.ok, true, JSON.stringify(logical));
  const key = await keyFor(c);
  const audit = c.PocketStarlingObjectSealShadow.auditCandidateSeal(logical.stage.sealRef, (ref) => stager.store.get(ref));
  const issued = await c.PocketStarlingSemanticAuthorityShadow.issueInitial({ authority: bundles.get(key).semanticAuthority,
    auditProof: c.PocketStarlingObjectSealShadow.semanticAuditProvenance(audit) });
  assert.equal(audit.ok, true, JSON.stringify(audit));
  assert.equal(issued.ok, true, JSON.stringify(issued));
  const physical = await c.PocketStarlingStorageShadow.stageCandidate({ sealRef: logical.stage.sealRef,
    resolveLogical: (ref) => stager.store.get(ref), masterKey: key, context: context(),
    semanticAuthority: bundles.get(key).semanticAuthority, semanticValidityProof: issued.proof });
  const present = c.PocketStarlingObjectSealShadow.verifyNewObjectPresence(logical.stage,
    (ref) => stager.store.has(ref), {});
  assert.equal(present.ok, true, JSON.stringify(present));
  return { key, physical, nodes };
}

function remote() { return { objects: new Map(), head: { schema: HEAD_SCHEMA, revision: 0, sealRef: null } }; }

function transport(remoteState, calls) {
  return { async request(route, body) {
    calls.push([route, plain(body)]);
    const common = { apiVersion: 1, ok: true, operationId: body.operationId, syncedPocketId: body.syncedPocketId };
    if (route === "putOpaqueObject") {
      const created = !remoteState.objects.has(body.storageRef);
      remoteState.objects.set(body.storageRef, body.record);
      return { status: 200, body: { ...common, storageRef: body.storageRef, created } };
    }
    if (route === "objectPresence") return { status: 200, body: { ...common,
      rows: body.storageRefs.map((storageRef) => ({ storageRef, present: remoteState.objects.has(storageRef) })) } };
    if (route === "compareAndSetShadowHead") {
      remoteState.head = { schema: HEAD_SCHEMA, revision: body.expectedHead.revision + 1, sealRef: body.candidateSealStorageRef };
      return { status: 200, body: { ...common, head: remoteState.head } };
    }
    if (route === "readShadowHead") return { status: 200, body: { ...common, head: remoteState.head } };
    if (route === "getOpaqueObject") {
      const record = remoteState.objects.get(body.storageRef);
      return { status: 200, body: { ...common, storageRef: body.storageRef, present: !!record, record: record || null } };
    }
    throw new Error(`unexpected route ${route}`);
  } };
}

async function publish(c, stage, remoteState, calls) {
  const service = c.PocketSyncRemoteClient.createObjectHeadService({ transport: transport(remoteState, calls) });
  const publisher = c.PocketStarlingPublicationShadow.createPublisher({ objectHeadService: service,
    operationIdFactory: (kind, index) => `${kind}-${index}` });
  const result = await publisher.publishCandidate({ stage: stage.physical,
    expectedHead: { schema: HEAD_SCHEMA, revision: 0, sealRef: null } });
  assert.equal(result.outcome, "committed", JSON.stringify(result));
}

async function open(c, stage, remoteState, calls) {
  const service = c.PocketSyncRemoteClient.createObjectHeadService({ transport: transport(remoteState, calls) });
  const opener = c.PocketStarlingRemoteOpenShadow.createRemoteOpener({ objectHeadService: service,
    operationIdFactory: (kind, index) => `${kind}-${index}` });
  const bundle = bundles.get(stage.key);
  const reopened = await c.PocketSyncCrypto.openMasterKeyBundle(bundle.record, bundle.wrappingKey, bundle.envelopeContext, [], { semanticAuthority: true });
  const result = await opener.openRemote({ masterKey: reopened.masterKey, context: context(), semanticAuthority: reopened.semanticAuthority });
  assert.equal(result.outcome, "opened", JSON.stringify(result));
  return result;
}

function getCount(calls) { return calls.filter(([route]) => route === "getOpaqueObject").length; }
function writeRoutes(calls) { return calls.filter(([route]) => ["putOpaqueObject", "objectPresence", "compareAndSetShadowHead"].includes(route)); }

function observingSession(session, observations) {
  return Object.freeze({ ...session,
    async readContent(nodeId) { observations.content.add(nodeId); return session.readContent(nodeId); },
    async readPlacement(nodeId) { observations.placement.add(nodeId); return session.readPlacement(nodeId); },
  });
}

function injectedSession(session, injections) {
  return Object.freeze({ ...session,
    async resolveLogical(ref) {
      return injections.has(ref) ? injections.get(ref) : session.resolveLogical(ref);
    },
  });
}

/* This is a negative-test-only ref forgery.  It does not model authenticated
   storage; it reaches structural validation after ref-identity validation. */
function forgedRefLogical(logical, forcedRefs) {
  return Object.freeze({ ...logical,
    refFor(kind, bytes) {
      const key = `${kind}\u0000${bytes}`;
      return forcedRefs.has(key) ? forcedRefs.get(key) : logical.refFor(kind, bytes);
    },
  });
}

function forcedRef(kind, bytes, ref) {
  return new Map([[`${kind}\u0000${bytes}`, ref]]);
}

function canonicalBytes(logical, value) {
  const canonical = logical.canonical(value);
  assert.equal(canonical.ok, true, JSON.stringify(canonical));
  return canonical.bytes;
}

async function childrenSequenceRef(session, root, parentId) {
  let ref = root.childrenRef;
  for (let index = 0; ; index += 1) {
    const trie = JSON.parse(await session.resolveLogical(ref));
    if (index === parentId.length) return trie.hasValue ? trie.valueRef : null;
    const edge = trie.children.find((entry) => entry.key === parentId[index]);
    if (!edge) return null;
    ref = edge.ref;
  }
}

async function measuredCase(count) {
  const writer = runtime();
  const stage = await stageFixture(writer, count);
  const remoteState = remote();
  await publish(writer, stage, remoteState, []);
  const reader = runtime();
  const calls = [];
  const opened = await open(reader, stage, remoteState, calls);
  const initialAuthenticatedOpenGets = getCount(calls);
  const observations = { content: new Set(), placement: new Set() };
  const materialize = reader.PocketStarlingMaterializeShadow;
  let materializeCalls = 0;
  reader.PocketStarlingMaterializeShadow = Object.freeze({ ...materialize,
    async materializeAccepted() { materializeCalls += 1; throw new Error("cursor must not materialise"); },
  });
  const cursor = await createSnapshotCursor({ session: observingSession(opened.session, observations), logical: reader.PocketStarlingObjectSealShadow });
  const before = getCount(calls);
  const rootChildren = await cursor.readChildren("root");
  const visibleChildren = await cursor.readChildren("visible");
  const requested = await cursor.readRequestedNode("visible-second");
  const after = getCount(calls);
  const beforeRepeat = getCount(calls);
  const repeated = await cursor.readChildren("visible");
  const repeatedNode = await cursor.readRequestedNode("visible-second");
  const afterRepeat = getCount(calls);
  assert.equal(materializeCalls, 0);
  assert.equal(afterRepeat - beforeRepeat, 0, "cached repeated scope makes no physical fetch");
  assert.deepEqual(plain(repeated), plain(visibleChildren));
  assert.deepEqual(plain(repeatedNode), plain(requested));
  assert.deepEqual([...observations.content].sort(), ["unrelated", "visible", "visible-first", "visible-second"]);
  assert.deepEqual([...observations.placement].sort(), ["unrelated", "visible", "visible-first", "visible-second"]);
  reader.PocketStarlingMaterializeShadow = materialize;
  const oracle = await materialize.materializeAccepted(opened.session);
  const oraclePhysicalGets = getCount(calls) - afterRepeat;
  assert.equal(oracle.ok, true, oracle.reason);
  assert.ok(oraclePhysicalGets > after - before, "oracle fetches are outside the recorded cursor measurement");
  const expectedRootChildren = oracle.document.nodes.filter((node) => node.parentId === "root");
  const expectedVisibleChildren = oracle.document.nodes.filter((node) => node.parentId === "visible");
  assert.deepEqual(plain(rootChildren), plain(expectedRootChildren));
  assert.deepEqual(plain(visibleChildren), plain(expectedVisibleChildren));
  assert.deepEqual(plain(requested), plain(expectedVisibleChildren.find((node) => node.id === "visible-second")));
  assert.deepEqual(writeRoutes(calls), [], "cursor only reads after authenticated Open");
  const diagnostics = cursor.diagnostics();

  const freshCalls = [];
  const fresh = await open(runtime(), stage, remoteState, freshCalls);
  const freshCursor = await createSnapshotCursor({ session: fresh.session, logical: writer.PocketStarlingObjectSealShadow });
  const freshBefore = getCount(freshCalls);
  await freshCursor.readChildren("root");
  await freshCursor.readChildren("visible");
  const freshAfter = getCount(freshCalls);
  assert.equal(getCount(freshCalls.slice(0, 3)), 2, "fresh authenticated session opens its own Seal and Root");
  assert.ok(freshAfter > freshBefore, "fresh session fetches its own scoped objects");
  return {
    count,
    initialAuthenticatedOpenGets,
    incrementalPhysicalGets: after - before,
    logicalResolutions: diagnostics.logicalResolutions,
    childrenPageReads: diagnostics.childrenPageReads,
    contentReads: diagnostics.contentReads,
    placementReads: diagnostics.placementReads,
    cacheHits: diagnostics.logicalCacheHits + (diagnostics.sessionCacheHits || 0),
    requestedNodesReturned: diagnostics.requestedNodesReturned,
    freshSessionIncrementalGets: freshAfter - freshBefore,
    oraclePhysicalGetsExcluded: oraclePhysicalGets,
  };
}

test("P366 authenticated snapshot cursor reads only root-guided shallow truth with bounded cached work", { timeout: 120000 }, async () => {
  const rows = [];
  for (const count of [100, 500, 2000]) rows.push(await measuredCase(count));
  for (const field of ["incrementalPhysicalGets", "logicalResolutions", "childrenPageReads", "contentReads", "placementReads", "requestedNodesReturned"]) {
    assert.equal(new Set(rows.map((row) => row[field])).size, 1, `${field} is independent of unrelated subtree size`);
  }
  assert.ok(rows.every((row) => row.initialAuthenticatedOpenGets === 2));
  assert.ok(rows.every((row) => row.incrementalPhysicalGets > 0));
  assert.ok(rows.every((row) => row.cacheHits > 0));
  assert.ok(rows.every((row) => row.freshSessionIncrementalGets === row.incrementalPhysicalGets));
  console.log(`P366_SNAPSHOT_CURSOR_MEASUREMENTS ${JSON.stringify(rows)}`);
});

test("P366 snapshot cursor fails closed for missing, noncanonical, wrong-kind, count, and duplicate logical scope", async () => {
  const writer = runtime();
  const stage = await stageFixture(writer, 100);
  const remoteState = remote();
  await publish(writer, stage, remoteState, []);
  const reader = runtime();
  const opened = await open(reader, stage, remoteState, []);
  const logical = reader.PocketStarlingObjectSealShadow;
  const seal = JSON.parse(await opened.session.resolveLogical(opened.session.acceptedSealRef));
  const root = JSON.parse(await opened.session.resolveLogical(seal.rootRef));
  const rootSequenceRef = await childrenSequenceRef(opened.session, root, "root");
  const rootPage = JSON.parse(await opened.session.resolveLogical(rootSequenceRef));
  assert.equal(rootPage.kind, "sequence-leaf");

  const ordinary = await createSnapshotCursor({ session: opened.session, logical });
  await assert.rejects(ordinary.readRequestedNode("bulk-0000"), (error) => error && error.code === "unreachable-node");
  await assert.rejects(ordinary.readChildren("bulk-0000"), (error) => error && error.code === "unreachable-parent");

  const missing = await createSnapshotCursor({ session: injectedSession(opened.session,
    new Map([[rootSequenceRef, undefined]])), logical });
  await assert.rejects(missing.readChildren("root"), (error) => error && error.code === "missing-logical-object");
  await assert.rejects(missing.readChildren("visible"), (error) => error && error.code === "unreachable-parent");

  const noncanonicalBytes = JSON.stringify({ kind: rootPage.kind, schema: rootPage.schema,
    capacity: rootPage.capacity, count: rootPage.count, items: rootPage.items });
  assert.notEqual(canonicalBytes(logical, JSON.parse(noncanonicalBytes)), noncanonicalBytes);
  const noncanonical = await createSnapshotCursor({ session: injectedSession(opened.session,
    new Map([[rootSequenceRef, noncanonicalBytes]])), logical: forgedRefLogical(logical,
    forcedRef("sequence-leaf", noncanonicalBytes, rootSequenceRef)) });
  await assert.rejects(noncanonical.readChildren("root"), (error) => error && error.code === "noncanonical-logical-object");

  const wrongKindBytes = await opened.session.resolveLogical(root.childrenRef);
  const wrongKind = await createSnapshotCursor({ session: injectedSession(opened.session,
    new Map([[rootSequenceRef, wrongKindBytes]])), logical: forgedRefLogical(logical,
    forcedRef("sequence-leaf", wrongKindBytes, rootSequenceRef)) });
  await assert.rejects(wrongKind.readChildren("root"), (error) => error && error.code === "invalid-sequence-object");

  const invalidCountBytes = canonicalBytes(logical, { ...rootPage, count: rootPage.count + 1 });
  const invalidCount = await createSnapshotCursor({ session: injectedSession(opened.session,
    new Map([[rootSequenceRef, invalidCountBytes]])), logical: forgedRefLogical(logical,
    forcedRef("sequence-leaf", invalidCountBytes, rootSequenceRef)) });
  await assert.rejects(invalidCount.readChildren("root"), (error) => error && error.code === "invalid-sequence-object");

  const duplicateBytes = canonicalBytes(logical, { ...rootPage, items: ["visible", "visible"] });
  const duplicate = await createSnapshotCursor({ session: injectedSession(opened.session,
    new Map([[rootSequenceRef, duplicateBytes]])), logical: forgedRefLogical(logical,
    forcedRef("sequence-leaf", duplicateBytes, rootSequenceRef)) });
  await assert.rejects(duplicate.readChildren("root"), (error) => error && error.code === "duplicate-children");
  await assert.rejects(duplicate.readChildren("visible"), (error) => error && error.code === "unreachable-parent");
});

test("P366 snapshot cursor rejects cycles and leaves failed expansions uncommitted", async () => {
  const writer = runtime();
  const stage = await stageFixture(writer, 100);
  const remoteState = remote();
  await publish(writer, stage, remoteState, []);
  const reader = runtime();
  const opened = await open(reader, stage, remoteState, []);
  const logical = reader.PocketStarlingObjectSealShadow;
  const seal = JSON.parse(await opened.session.resolveLogical(opened.session.acceptedSealRef));
  const root = JSON.parse(await opened.session.resolveLogical(seal.rootRef));
  const visibleSequenceRef = await childrenSequenceRef(opened.session, root, "visible");
  const visiblePage = JSON.parse(await opened.session.resolveLogical(visibleSequenceRef));
  assert.equal(visiblePage.kind, "sequence-leaf");

  const cycleBytes = canonicalBytes(logical, { ...visiblePage, count: 1, items: ["visible"] });
  const cyclic = await createSnapshotCursor({ session: injectedSession(opened.session,
    new Map([[visibleSequenceRef, cycleBytes]])), logical: forgedRefLogical(logical,
    forcedRef("sequence-leaf", cycleBytes, visibleSequenceRef)) });
  await cyclic.readChildren("root");
  await assert.rejects(cyclic.readChildren("visible"), (error) => error && error.code === "duplicate-or-cyclic-current-node");
  await assert.rejects(cyclic.readRequestedNode("visible-first"), (error) => error && error.code === "unreachable-node");

  const incompleteBytes = canonicalBytes(logical, { ...visiblePage,
    items: ["visible-first", "missing-child"] });
  const incomplete = await createSnapshotCursor({ session: injectedSession(opened.session,
    new Map([[visibleSequenceRef, incompleteBytes]])), logical: forgedRefLogical(logical,
    forcedRef("sequence-leaf", incompleteBytes, visibleSequenceRef)) });
  await incomplete.readChildren("root");
  await assert.rejects(incomplete.readChildren("visible"), (error) => error
    && ["invalid-content-record", "placement-parent-disagreement"].includes(error.code));
  await assert.rejects(incomplete.readRequestedNode("visible-first"), (error) => error && error.code === "unreachable-node");

  const disagreeingSession = Object.freeze({ ...opened.session,
    async readPlacement(nodeId) {
      const placement = await opened.session.readPlacement(nodeId);
      return nodeId === "visible" ? { ...placement, parentId: "wrong" } : placement;
    },
  });
  const disagreeing = await createSnapshotCursor({ session: disagreeingSession, logical });
  await assert.rejects(disagreeing.readChildren("root"), (error) => error && error.code === "placement-parent-disagreement");
  await assert.rejects(disagreeing.readChildren("visible"), (error) => error && error.code === "unreachable-parent");
});

test("P366 cursor remains bound to one authenticated Open session, not the latest Head", async () => {
  const writerA = runtime(), stageA = await stageFixture(writerA, 100), remoteA = remote();
  await publish(writerA, stageA, remoteA, []);
  const readerA = runtime(), readsA = { content: new Set(), placement: new Set() };
  const openedA = await open(readerA, stageA, remoteA, []);

  const writerB = runtime(), stageB = await stageFixture(writerB, 101), remoteB = remote();
  await publish(writerB, stageB, remoteB, []);
  const readerB = runtime(), readsB = { content: new Set(), placement: new Set() };
  const openedB = await open(readerB, stageB, remoteB, []);
  assert.notEqual(openedA.head.sealRef, openedB.head.sealRef, "independent authenticated Heads differ");
  assert.notEqual(openedA.session.acceptedSealRef, openedB.session.acceptedSealRef, "independent accepted Seals differ");

  remoteA.head = { ...remoteA.head, revision: 2, sealRef: "later-head-not-read-by-cursor" };
  const cursor = await createSnapshotCursor({ session: observingSession(openedA.session, readsA),
    logical: readerA.PocketStarlingObjectSealShadow });
  await cursor.readChildren("root");
  await cursor.readChildren("visible");
  assert.deepEqual([...readsB.content], [], "cursor did not read a second session");
  assert.deepEqual([...readsB.placement], [], "cursor did not read a second session");
  assert.equal(cursor.diagnostics().acceptedSealRef, openedA.session.acceptedSealRef);
  assert.equal(cursor.diagnostics().rootRef,
    JSON.parse(await openedA.session.resolveLogical(openedA.session.acceptedSealRef)).rootRef);
});
