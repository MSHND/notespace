"use strict";

const test = require("node:test"), assert = require("node:assert/strict"), fs = require("node:fs"),
  path = require("node:path"), vm = require("node:vm"), { webcrypto } = require("node:crypto"),
  { semanticBase } = require("./helpers/starling-semantic-test.js"),
  { createProductionReleaseManifest } = require("../sync-service/pocket-sync-production-server.js");

const ROOT = path.resolve(__dirname, ".."), HEAD = "pocket.starling.head.v1", SCRIPTS = [
  "js/pocket-state.js", "js/pocket-data.js", "js/pocket-outline-persistence-policy.js", "js/pocket-editor-metadata.js",
  "js/pocket-pe-import-preserve.js", "js/pocket-storage.js", "js/pocket-import.js", "js/pocket-starling-shadow.js",
  "js/pocket-starling-sequence-shadow.js", "js/pocket-starling-placement-shadow.js", "js/pocket-starling-bridge-shadow.js",
  "js/pocket-starling-root-shadow.js", "js/pocket-starling-object-seal-shadow.js", "js/pocket-sync-crypto.js",
  "js/pocket-starling-crypto-shadow.js", "js/pocket-starling-storage-shadow.js", "js/pocket-starling-head-shadow.js",
  "js/pocket-sync-remote-client.js", "js/pocket-starling-logical-edit-shadow.js", "js/pocket-starling-publication-shadow.js",
  "js/pocket-starling-remote-open-shadow.js", "js/pocket-starling-remote-edit-shadow.js", "js/pocket-starling-remote-save-shadow.js",
  "js/pocket-starling-semantic-authority-shadow.js",
], plain = (value) => JSON.parse(JSON.stringify(value)), context = (syncedPocketId = "p134") => ({ syncedPocketId }),
  head = (revision, sealRef) => ({ schema: HEAD, revision, sealRef }), ids = (prefix) => (kind, index) => `${prefix}-${kind}-${index}`;

function runtime() {
  const c = { crypto: webcrypto, TextEncoder, TextDecoder, Uint8Array, ArrayBuffer, URL, Date, Math, JSON, Map, Set, WeakMap, WeakSet, Object, Array, String, Number, Boolean, Promise, Error,
    btoa: (value) => Buffer.from(value, "binary").toString("base64"), atob: (value) => Buffer.from(value, "base64").toString("binary"),
    localStorage: { getItem() {}, setItem() {}, removeItem() {} }, document: { body: { classList: { add() {}, remove() {}, toggle() {} } }, getElementById() {}, addEventListener() {} },
    navigator: { clipboard: {} }, location: { href: "https://example.test" }, indexedDB: null, open() {}, close() {}, setTimeout, clearTimeout, requestAnimationFrame() { return 1; }, cancelAnimationFrame() {} };
  c.window = c; c.globalThis = c; vm.createContext(c);
  for (const file of SCRIPTS) vm.runInContext(fs.readFileSync(path.join(ROOT, file), "utf8"), c, { filename: file });
  return c;
}

function graph(descendants = 2) {
  const nodes = [
    { id: "source", parentId: "root", order: 0, label: "Source" }, { id: "sibling", parentId: "root", order: 1, label: "Sibling" },
    { id: "retained", parentId: "root", order: 2, label: "Literal current retained" }, { id: "first", parentId: "source", order: 0, label: "First" },
    { id: "branch", parentId: "source", order: 1, label: "Branch" }, { id: "last", parentId: "source", order: 2, label: "Last" },
    { id: "retained-old", parentId: "root", order: 3, label: "Already retained" }, { id: "retained-old-child", parentId: "retained-old", order: 0, label: "Retained child" },
    ...Array.from({ length: descendants }, (_, index) => ({ id: `desc-${String(index).padStart(4, "0")}`, parentId: index === 0 ? "branch" : `desc-${String(index - 1).padStart(4, "0")}`, order: 0, label: `Descendant ${index}` })),
  ], nodeIds = nodes.map((node) => node.id), parents = Object.fromEntries(nodes.map((node) => [node.id, node.parentId])),
    children = { root: ["source", "sibling", "retained"], source: ["first", "branch", "last"], "": ["retained-old"], "retained-old": ["retained-old-child"] };
  for (let index = 0; index < descendants; index += 1) {
    const nodeId = `desc-${String(index).padStart(4, "0")}`;
    if (index === 0) children.branch = [nodeId];
    else children[`desc-${String(index - 1).padStart(4, "0")}`] = [nodeId];
  }
  parents["retained-old"] = "";
  return { nodes, relation: { nodeIds, parents, children } };
}

function initialState(c, input) {
  const encoded = c.PocketStarlingBridgeShadow.encode({ schema: "portal.mtt.web.v1", writtenAt: "2026-09-01T00:00:00.000Z", nodes: input.nodes, tombstones: [], rootExtras: {}, dataExtras: {} }, { capacity: 4 }),
    base = encoded.ok && c.PocketStarlingRootShadow.build(encoded.bridge), structural = c.PocketStarlingPlacementShadow.build(input.relation, { capacity: 4 });
  assert.equal(encoded.ok, true, JSON.stringify(encoded)); assert.equal(base.ok, true, JSON.stringify(base)); assert.equal(structural.ok, true, JSON.stringify(structural));
  const witness = c.PocketStarlingRootShadow.diagnosticRootFor({ capacity: base.state.capacity, content: base.state.content, placements: structural.model.placements, children: structural.model.children, preservation: base.state.preservation });
  assert.equal(witness.ok, true, JSON.stringify(witness));
  return { schema: c.PocketStarlingRootShadow.SCHEMA, capacity: base.state.capacity, content: base.state.content, structural: structural.model, preservation: base.state.preservation, root: witness.root };
}

function remote() { return { objects: new Map(), head: head(0, null), calls: [], mode: "normal" }; }
function service(c, r) {
  return c.PocketSyncRemoteClient.createObjectHeadService({ transport: { async request(route, body) {
    r.calls.push([route, plain(body)]); const common = { apiVersion: 1, ok: true, operationId: body.operationId, syncedPocketId: body.syncedPocketId };
    if (route === "putOpaqueObject") { const created = !r.objects.has(body.storageRef); r.objects.set(body.storageRef, body.record); return { status: 200, body: { ...common, storageRef: body.storageRef, created } }; }
    if (route === "objectPresence") return { status: 200, body: { ...common, rows: body.storageRefs.map((storageRef) => ({ storageRef, present: r.objects.has(storageRef) })) } };
    if (route === "compareAndSetShadowHead") {
      if (r.head.revision !== body.expectedHead.revision || r.head.sealRef !== body.expectedHead.sealRef) return { status: 409, body: { ...common, ok: false, reason: "head-conflict" } };
      const next = head(body.expectedHead.revision + 1, body.candidateSealStorageRef);
      if (r.mode === "apply") { r.head = next; throw new Error("lost response"); }
      if (r.mode === "before") throw new Error("lost response");
      r.head = next; return { status: 200, body: { ...common, head: next } };
    }
    if (route === "readShadowHead") return { status: 200, body: { ...common, head: r.head } };
    if (route === "getOpaqueObject") { const record = r.objects.get(body.storageRef); return { status: 200, body: { ...common, storageRef: body.storageRef, present: !!record, record: record || null } }; }
    throw new Error(route);
  } } });
}

async function setup(descendants = 2) {
  const writer = runtime(), state = initialState(writer, graph(descendants)), stager = writer.PocketStarlingObjectSealShadow.createStager(), logical = writer.PocketStarlingObjectSealShadow.stageCandidate(stager, state, { previousSealRef: null });
  assert.equal(logical.ok, true, JSON.stringify(logical));
  const semantic = await semanticBase(writer, { acceptedSealRef: logical.stage.sealRef, resolveLogical: (ref) => stager.store.get(ref), syncedPocketId: "p134" }),
    stage = await writer.PocketStarlingStorageShadow.stageCandidate({ sealRef: logical.stage.sealRef, resolveLogical: (ref) => stager.store.get(ref), masterKey: semantic.masterKey, context: context(), semanticAuthority: semantic.semanticAuthority, semanticValidityProof: semantic.semanticValidityProof }),
    r = remote(), publisher = writer.PocketStarlingPublicationShadow.createPublisher({ objectHeadService: service(writer, r), operationIdFactory: ids("genesis") });
  assert.equal((await publisher.publishCandidate({ stage, expectedHead: head(0, null) })).outcome, "committed");
  return { r, semantic, descendants };
}

async function open(fixture, prefix) {
  const c = runtime(), reopened = await c.PocketSyncCrypto.openMasterKeyBundle(fixture.semantic.envelope.record, fixture.semantic.envelope.wrappingKey, fixture.semantic.envelope.envelopeContext, [], { semanticAuthority: true }),
    opened = await c.PocketStarlingRemoteOpenShadow.createRemoteOpener({ objectHeadService: service(c, fixture.r), operationIdFactory: ids(prefix) }).openRemote({ masterKey: reopened.masterKey, context: context(), semanticAuthority: reopened.semanticAuthority });
  assert.equal(opened.outcome, "opened", JSON.stringify(opened));
  return { c, opened, reopened };
}

async function transaction(opened, fixture, prefix, supplied = context()) {
  return opened.c.PocketStarlingRemoteSaveShadow.createTransaction({ opened: opened.opened, masterKey: opened.reopened.masterKey, context: supplied, semanticAuthority: opened.reopened.semanticAuthority, objectHeadService: service(opened.c, fixture.r), operationIdFactory: ids(prefix) });
}

function cas(calls, start) { return calls.slice(start).filter(([route]) => route === "compareAndSetShadowHead"); }
function writes(calls) { return calls.some(([route]) => ["putOpaqueObject", "objectPresence", "compareAndSetShadowHead"].includes(route)); }
function forbiddenDuringPrepare(calls) { return calls.some(([route]) => ["putOpaqueObject", "objectPresence", "compareAndSetShadowHead", "readShadowHead"].includes(route)); }

test("P134 prepares a genuine bounded Delete through semantic encrypted storage without publication", async () => {
  const f = await setup(), o = await open(f, "prepare"), editor = await o.c.PocketStarlingRemoteEditShadow.createEditor({ opened: o.opened, masterKey: o.reopened.masterKey, context: context(), semanticAuthority: o.reopened.semanticAuthority }), before = f.r.calls.length,
    prepared = await editor.prepareDelete({ nodeId: "branch", fromIndex: 1 }), calls = f.r.calls.slice(before);
  assert.deepEqual(Object.keys(editor), ["preparePayloadEdit", "prepareMove", "prepareReorder", "prepareDelete"]); assert.equal(Object.isFrozen(editor), true);
  assert.deepEqual(Object.keys(prepared), ["outcome", "expectedHead", "stage", "binding"]); assert.equal(Object.isFrozen(prepared), true); assert.equal(prepared.outcome, "prepared");
  assert.equal(forbiddenDuringPrepare(calls), false); assert.ok(calls.filter(([route]) => route === "getOpaqueObject").length < 80); assert.ok(prepared.stage.newRecords.length < 150);
  assert.equal(prepared.binding.expectedSealStorageRef, o.opened.head.sealRef); assert.equal(prepared.binding.candidateSealStorageRef, prepared.stage.sealStorageRef);
  const entries = new Map(f.r.objects); for (const entry of prepared.stage.newRecords) entries.set(entry.storageRef, entry.record);
  const resolver = await o.c.PocketStarlingStorageShadow.createResolver({ acceptedSealStorageRef: prepared.stage.sealStorageRef, acceptedBaseComplete: true, masterKey: o.reopened.masterKey, context: context(), resolveStorage: (ref) => entries.get(ref) }), accepted = await resolver.openAccepted();
  assert.equal((await resolver.readPlacement(accepted.handle, "branch")).parentId, ""); assert.equal((await resolver.readPlacement(accepted.handle, "desc-0001")).parentId, "desc-0000");
});

test("P134 commits Delete once, reopens retained truth, and terminalises the full save surface", async () => {
  const f = await setup(), o = await open(f, "commit"), real = o.c.PocketStarlingRemoteEditShadow; let captured;
  o.c.PocketStarlingRemoteEditShadow = Object.freeze({ createEditor: async (input) => { const editor = await real.createEditor(input); return Object.freeze({ preparePayloadEdit: editor.preparePayloadEdit, prepareMove: editor.prepareMove, prepareReorder: editor.prepareReorder, prepareDelete: async (value) => { const result = await editor.prepareDelete(value); if (result.outcome === "prepared") captured = result; return result; } }); } });
  const supplied = context(), mutable = { outcome: "opened", head: { ...o.opened.head }, session: o.opened.session }, original = plain(o.opened.head), t = await o.c.PocketStarlingRemoteSaveShadow.createTransaction({ opened: mutable, masterKey: o.reopened.masterKey, context: supplied, semanticAuthority: o.reopened.semanticAuthority, objectHeadService: service(o.c, f.r), operationIdFactory: ids("commit") }), before = f.r.calls.length;
  mutable.head.sealRef = "redirected"; supplied.syncedPocketId = "redirected";
  const result = await t.saveDelete({ nodeId: "branch", fromIndex: 1 });
  assert.deepEqual(Object.keys(t), ["savePayload", "saveMove", "saveReorder", "saveDelete", "reconcileAmbiguous"]); assert.equal(Object.isFrozen(t), true); assert.equal(result.outcome, "committed"); assert.ok(captured);
  assert.equal(cas(f.r.calls, before).length, 1); assert.deepEqual(cas(f.r.calls, before)[0][1].expectedHead, original); assert.equal(cas(f.r.calls, before)[0][1].candidateSealStorageRef, captured.stage.sealStorageRef); assert.equal(f.r.calls.slice(before).some(([route]) => route === "readShadowHead"), false);
  const fresh = await open(f, "commit-fresh"); assert.equal((await fresh.opened.session.readPlacement("branch")).parentId, ""); assert.equal((await fresh.opened.session.readPlacement("desc-0001")).parentId, "desc-0000"); assert.equal((await fresh.opened.session.readPlacement("sibling")).parentId, "root");
  const base = await fresh.c.PocketStarlingLogicalEditShadow.createBase({ acceptedSealRef: fresh.opened.session.acceptedSealRef, resolveLogical: fresh.opened.session.resolveLogical, syncedPocketId: "p134", semanticAuthority: fresh.reopened.semanticAuthority, semanticBaseProof: fresh.opened.session.semanticBaseProof });
  assert.equal((await fresh.c.PocketStarlingLogicalEditShadow.editPayload(base.base, "branch", { label: "blocked" })).reason, "retained-node-not-current");
  const after = f.r.calls.length; for (const call of [() => t.savePayload({ nodeId: "sibling", payload: {} }), () => t.saveMove({ nodeId: "sibling", fromIndex: 0, newParentId: "source", toIndex: 0 }), () => t.saveReorder({ nodeId: "sibling", fromIndex: 0, toIndex: 1 }), () => t.saveDelete({ nodeId: "sibling", fromIndex: 0 }), () => t.reconcileAmbiguous()]) await assert.rejects(call(), (error) => error.code === "remote-save-state-invalid");
  assert.equal(f.r.calls.length, after);
});

test("P134 Delete failures stay ready, stale conflict stays one-CAS, and ambiguity is explicit-only", async () => {
  const f = await setup(), a = await open(f, "a"), b = await open(f, "b"), ready = await transaction(a, f, "ready"), before = f.r.calls.length;
  for (const value of [{ nodeId: "branch", fromIndex: 0 }, { nodeId: "retained-old", fromIndex: 0 }, { nodeId: "missing", fromIndex: 1 }]) {
    const result = await ready.saveDelete(value); assert.equal(result.ok, false, JSON.stringify(result));
  }
  await assert.rejects(ready.saveDelete({ nodeId: "branch", fromIndex: 1, stage: "injected" }), (error) => error.code === "remote-save-input-invalid"); assert.equal(writes(f.r.calls.slice(before)), false);
  assert.equal((await ready.saveDelete({ nodeId: "branch", fromIndex: 1 })).outcome, "committed");
  const conflictFixture = await setup(), staleOpen = await open(conflictFixture, "stale"), winnerOpen = await open(conflictFixture, "winner"), stale = await transaction(staleOpen, conflictFixture, "stale"), winner = await transaction(winnerOpen, conflictFixture, "winner");
  await winner.savePayload({ nodeId: "sibling", payload: { label: "winner" } }); const conflictBefore = conflictFixture.r.calls.length, conflict = await stale.saveDelete({ nodeId: "branch", fromIndex: 1 });
  assert.deepEqual(plain(conflict), { outcome: "conflict", reason: "head-conflict" }); assert.equal(cas(conflictFixture.r.calls, conflictBefore).length, 1); assert.equal(conflictFixture.r.calls.slice(conflictBefore).some(([route]) => route === "readShadowHead"), false);
  const ambiguousFixture = await setup(), ambiguousOpen = await open(ambiguousFixture, "ambiguous"), ambiguous = await transaction(ambiguousOpen, ambiguousFixture, "ambiguous"), ambiguousBefore = ambiguousFixture.r.calls.length;
  ambiguousFixture.r.mode = "apply"; assert.deepEqual(plain(await ambiguous.saveDelete({ nodeId: "branch", fromIndex: 1 })), { outcome: "ambiguous" }); assert.equal(cas(ambiguousFixture.r.calls, ambiguousBefore).length, 1); assert.equal(ambiguousFixture.r.calls.slice(ambiguousBefore).some(([route]) => route === "readShadowHead"), false);
  ambiguousFixture.r.mode = "normal"; assert.deepEqual(plain(await ambiguous.reconcileAmbiguous()), { outcome: "committed", examined: 1 }); assert.equal(cas(ambiguousFixture.r.calls, ambiguousBefore).length, 1);
  const beforeFixture = await setup(), beforeOpen = await open(beforeFixture, "before"), beforeTx = await transaction(beforeOpen, beforeFixture, "before");
  beforeFixture.r.mode = "before"; await beforeTx.saveDelete({ nodeId: "branch", fromIndex: 1 }); beforeFixture.r.mode = "normal"; assert.deepEqual(plain(await beforeTx.reconcileAmbiguous()), { outcome: "not-committed", examined: 0 });
});

test("P134 keeps remote Delete bounded for a two-thousand-descendant branch", async () => {
  const f = await setup(2000), o = await open(f, "large"), t = await transaction(o, f, "large"), before = f.r.calls.length, result = await t.saveDelete({ nodeId: "branch", fromIndex: 1 }), attempt = f.r.calls.slice(before);
  assert.equal(result.outcome, "committed"); assert.ok(attempt.filter(([route]) => route === "getOpaqueObject").length < 100); assert.ok(attempt.filter(([route]) => route === "putOpaqueObject").length < 200); assert.ok(attempt.filter(([route]) => route === "objectPresence").length < 200); assert.equal(cas(f.r.calls, before).length, 1);
  const fresh = await open(f, "large-fresh"); assert.equal((await fresh.opened.session.readPlacement("branch")).parentId, ""); assert.equal((await fresh.opened.session.readPlacement("desc-1999")).parentId, "desc-1998");
});

test("P134 remains dormant in production", () => {
  const manifest = createProductionReleaseManifest({ browserRoot: ROOT, serviceRoot: "/pocket-sync/v1" });
  for (const file of ["js/pocket-starling-remote-edit-shadow.js", "js/pocket-starling-remote-save-shadow.js"])
    assert.equal(manifest.some((entry) => entry.path === `/${file}`), false);
});
