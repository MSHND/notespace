"use strict";

// P139 historical Head acceptance/intent boundary proof. TEST ONLY, disposable.
// Harness derived from independently reviewed Proof 2, not a production Undo planner.
// It deliberately refuses to confer human intent or historical CAS authority.
const test = require("node:test"), assert = require("node:assert/strict");
const fs = require("node:fs"), path = require("node:path"), vm = require("node:vm");
const { webcrypto } = require("node:crypto");
const { semanticBase } = require("./helpers/starling-semantic-test.js");
const ROOT = path.resolve(__dirname, ".."), POCKET_ID = "disposable-structural-reentry-proof2";
const HEAD = "pocket.starling.head.v1";
const SCRIPTS = [
  "js/pocket-state.js", "js/pocket-data.js", "js/pocket-outline-persistence-policy.js",
  "js/pocket-node-content.js", "js/pocket-editor-metadata.js", "js/pocket-pe-import-preserve.js",
  "js/pocket-storage.js", "js/pocket-import.js", "js/pocket-starling-shadow.js",
  "js/pocket-starling-sequence-shadow.js", "js/pocket-starling-placement-shadow.js",
  "js/pocket-starling-bridge-shadow.js", "js/pocket-starling-root-shadow.js",
  "js/pocket-starling-object-seal-shadow.js", "js/pocket-sync-crypto.js",
  "js/pocket-starling-crypto-shadow.js", "js/pocket-starling-storage-shadow.js",
  "js/pocket-starling-head-shadow.js", "js/pocket-sync-remote-client.js",
  "js/pocket-starling-logical-edit-shadow.js", "js/pocket-starling-publication-shadow.js",
  "js/pocket-starling-remote-open-shadow.js", "js/pocket-starling-remote-edit-shadow.js",
  "js/pocket-starling-materialize-shadow.js",
  "js/pocket-starling-semantic-authority-shadow.js",
];
const copy = (x) => JSON.parse(JSON.stringify(x));
const context = (id = POCKET_ID) => ({ syncedPocketId: id });
const initialHead = () => ({ schema: HEAD, revision: 0, sealRef: null });
const ids = (prefix) => (kind, index) => prefix + "-" + kind + "-" + index;

function runtime() {
  const c = { crypto: webcrypto, TextEncoder, TextDecoder, Uint8Array, ArrayBuffer,
    URL, Date, Math, JSON, Map, Set, WeakMap, WeakSet, Object, Array, String, Number,
    Boolean, Promise, Error, btoa: x => Buffer.from(x, "binary").toString("base64"),
    atob: x => Buffer.from(x, "base64").toString("binary"),
    localStorage: { getItem() {}, setItem() {}, removeItem() {} },
    document: { body: { classList: { add() {}, remove() {}, toggle() {} } }, getElementById() {},
      addEventListener() {} }, navigator: { clipboard: {} },
    location: { href: "https://example.test" }, indexedDB: null,
    open() {}, close() {}, setTimeout, clearTimeout,
    requestAnimationFrame() { return 1; }, cancelAnimationFrame() {} };
  c.window = c; c.globalThis = c; vm.createContext(c);
  for (const file of SCRIPTS)
    vm.runInContext(fs.readFileSync(path.join(ROOT, file), "utf8"), c, { filename: file });
  return c;
}

// This in-memory transport is disposable. Its CAS observations are held ONLY by
// the writer and are discarded at restart. They are NOT durable Head receipts.
function remote() { return { objects: new Map(), head: initialHead(), casObservations: [] }; }
function transport(store) {
  return { async request(route, body) {
    const standard = { apiVersion: 1, operationId: body.operationId,
      syncedPocketId: body.syncedPocketId, ok: true };
    if (route === "putOpaqueObject") {
      const created = !store.objects.has(body.storageRef);
      store.objects.set(body.storageRef, copy(body.record));
      return { status: 200, body: { ...standard, storageRef: body.storageRef, created } };
    }
    if (route === "objectPresence")
      return { status: 200, body: { ...standard, rows: body.storageRefs.map(storageRef =>
        ({ storageRef, present: store.objects.has(storageRef) })) } };
    if (route === "getOpaqueObject") {
      const record = store.objects.get(body.storageRef);
      return { status: 200, body: { ...standard, storageRef: body.storageRef,
        present: !!record, record: record || null } };
    }
    if (route === "readShadowHead")
      return { status: 200, body: { ...standard, head: copy(store.head) } };
    if (route === "compareAndSetShadowHead") {
      const expected = body.expectedHead;
      if (store.head.revision !== expected.revision || store.head.sealRef !== expected.sealRef)
        return { status: 409, body: { ...standard, ok: false, reason: "head-conflict" } };
      if (!store.objects.has(body.candidateSealStorageRef))
        return { status: 409, body: { ...standard, ok: false, reason: "candidate-object-missing" } };
      const next = { schema: HEAD, revision: expected.revision + 1,
        sealRef: body.candidateSealStorageRef };
      store.casObservations.push({ expected: copy(expected), next: copy(next) });
      store.head = next;
      return { status: 200, body: { ...standard, head: copy(next) } };
    }
    throw new Error("unexpected disposable route: " + route);
  } };
}
const service = (c, store) => c.PocketSyncRemoteClient.createObjectHeadService({
  transport: transport(store),
});
const publisher = (c, store, prefix) =>
  c.PocketStarlingPublicationShadow.createPublisher({
    objectHeadService: service(c, store), operationIdFactory: ids(prefix),
  });


async function createDisposable() {
  const c = runtime(), stamp = "2026-10-25T00:00:00.000Z";
  const nodes = [
    { id: "A", parentId: "root", order: 0, label: "Original parent" },
    { id: "B", parentId: "root", order: 1, label: "Destination parent" },
    { id: "E", parentId: "root", order: 2, label: "Other independent root" },
    { id: "C", parentId: "A", order: 0, label: "Moved thought" },
    { id: "D", parentId: "A", order: 1, label: "Original sibling" },
    { id: "F", parentId: "B", order: 0, label: "Destination sibling" },
    { id: "G", parentId: "C", order: 0, label: "Descendant retains identity" },
  ];
  const encoded = c.PocketStarlingBridgeShadow.encode({
    schema: "portal.mtt.web.v1", writtenAt: stamp, nodes,
    tombstones: [], rootExtras: {}, dataExtras: {},
  }, { capacity: 4 });
  assert.equal(encoded.ok, true, JSON.stringify(encoded));
  const built = c.PocketStarlingRootShadow.build(encoded.bridge);
  assert.equal(built.ok, true, JSON.stringify(built));
  // One canonical P109 stager for genesis; no alternate persistence truth.
  const stager = c.PocketStarlingObjectSealShadow.createStager();
  const accepted = c.PocketStarlingObjectSealShadow.stageCandidate(stager, built.state,
    { previousSealRef: null });
  assert.equal(accepted.ok, true, JSON.stringify(accepted));
  const semantic = await semanticBase(c, {
    acceptedSealRef: accepted.stage.sealRef,
    resolveLogical: ref => stager.store.get(ref), syncedPocketId: POCKET_ID,
  });
  const physical = await c.PocketStarlingStorageShadow.stageCandidate({
    sealRef: accepted.stage.sealRef, resolveLogical: ref => stager.store.get(ref),
    masterKey: semantic.masterKey, context: context(),
    semanticAuthority: semantic.semanticAuthority,
    semanticValidityProof: semantic.semanticValidityProof,
  });
  const store = remote();
  const published = await publisher(c, store, "proof2-genesis").publishCandidate({
    stage: physical, expectedHead: initialHead(),
  });
  assert.equal(published.outcome, "committed");
  return { store, envelope: semantic.envelope, initialRef: physical.sealStorageRef };
}
async function fresh(f, store, prefix, pocketId = POCKET_ID) {
  const c = runtime();
  const credentials = await c.PocketSyncCrypto.openMasterKeyBundle(
    f.envelope.record, f.envelope.wrappingKey, f.envelope.envelopeContext,
    [], { semanticAuthority: true });
  const opened = await c.PocketStarlingRemoteOpenShadow.createRemoteOpener({
    objectHeadService: service(c, store), operationIdFactory: ids(prefix),
  }).openRemote({
    masterKey: credentials.masterKey, context: context(pocketId),
    semanticAuthority: credentials.semanticAuthority,
  });
  assert.equal(opened.outcome, "opened");
  return { c, credentials, opened };
}
async function prepareFrom(a, input, kind) {
  const editor = await a.c.PocketStarlingRemoteEditShadow.createEditor({
    opened: a.opened, masterKey: a.credentials.masterKey,
    context: context(), semanticAuthority: a.credentials.semanticAuthority,
  });
  if (kind === "move") return editor.prepareMove(input);
  if (kind === "reorder") return editor.prepareReorder(input);
  if (kind === "delete") return editor.prepareDelete(input);
  if (kind === "payload") return editor.preparePayloadEdit(input);
  throw new Error("invalid-probe-kind");
}
async function commit(f, kind, input, label) {
  const a = await fresh(f, f.store, label + "-open");
  const prepared = await prepareFrom(a, input, kind);
  assert.equal(prepared.outcome, "prepared", JSON.stringify(prepared));
  const committed = await publisher(a.c, f.store, label + "-publish").publishCandidate({
    stage: prepared.stage, expectedHead: prepared.expectedHead,
  });
  assert.equal(committed.outcome, "committed", JSON.stringify(committed));
  return copy(f.store.head);
}
function afterRestart(store) {
  // Only existing opaque P111 ciphertext objects + the current accepted Head
  // are durable. No test-local intentions, writer WeakMaps, or CAS logs survive.
  return { head: copy(store.head),
    objects: new Map([...store.objects].map(([ref, record]) => [ref, copy(record)])),
    casObservations: [] };
}
async function inspectHistory(a, store, pocketId = POCKET_ID) {
  const current = await a.c.PocketStarlingRemoteOpenShadow.createRemoteOpener({
    objectHeadService: service(a.c, store),
    operationIdFactory: ids("fresh-history-current"),
  }).openRemote({ masterKey: a.credentials.masterKey,
    context: context(pocketId), semanticAuthority: a.credentials.semanticAuthority });
  if (current.outcome !== "opened" || current.head.sealRef !== store.head.sealRef)
    throw new Error("current-head-unverified");
  const history = [], seen = new Set();
  let ref = current.head.sealRef;
  while (ref !== null) {
    if (seen.has(ref) || history.length >= 16) throw new Error("historical-cycle");
    seen.add(ref);
    const encrypted = store.objects.get(ref);
    if (!encrypted) throw new Error("missing-historical-ciphertext");
    const canonical = await a.c.PocketStarlingCryptoShadow.openObject(
      encrypted, ref, a.credentials.masterKey, context(pocketId));
    const capsule = a.c.PocketStarlingStorageShadow.validateCapsuleBytes(canonical);
    if (capsule.logicalKind !== "candidate-seal" || !capsule.semanticValidity)
      throw new Error("unattested-historical-seal");
    const seal = capsule.object;
    const binding = {
      syncedPocketId: pocketId, logicalSealRef: capsule.logicalRef,
      logicalRootRef: seal.rootRef, previousLogicalSealRef: seal.previousSealRef,
      logicalSealSchema: "pocket.starling.candidate-seal.v1",
      logicalRootSchema: "pocket.starling.logical-root.v1",
      logicalObjectSchema: "pocket.starling.logical-object.v1",
      sequenceSchema: "pocket.starling.sequence-page.v2",
      placementGeneration: "pocket.starling.placement-relation.v1",
    };
    const auth = await a.c.PocketStarlingSemanticAuthorityShadow.authenticate({
      authority: a.credentials.semanticAuthority, semanticValidity: capsule.semanticValidity,
      binding,
    });
    if (!auth.ok) throw new Error("unadmitted-historical-seal");
    const resolver = await a.c.PocketStarlingStorageShadow.createResolver({
      acceptedSealStorageRef: ref, acceptedBaseComplete: true,
      masterKey: a.credentials.masterKey, context: context(pocketId),
      resolveStorage(storageRef) {
        const record = store.objects.get(storageRef);
        if (!record) throw new Error("missing-historical-ciphertext");
        return record;
      },
    });
    const opened = await resolver.openAccepted();
    if (!opened.ok) throw new Error("invalid-history-structure");
    const session = {
      acceptedSealRef: resolver.acceptedSealRef,
      resolveLogical: logicalRef => resolver.resolveLogical(logicalRef),
      readContent: id => resolver.readContent(opened.handle, id),
      readPlacement: id => resolver.readPlacement(opened.handle, id),
    };
    const read = await a.c.PocketStarlingMaterializeShadow.materializeAccepted(session);
    if (!read.ok) throw new Error("invalid-history-projection-" + read.reason);
    history.push({
      physicalRef: ref, logicalRef: capsule.logicalRef,
      predecessor: seal.previousSealRef,
      contentRoot: opened.handle.root.contentRef,
      placementRoot: opened.handle.root.placementRef,
      childrenRoot: opened.handle.root.childrenRef,
      preservationRoot: opened.handle.root.preservationRef,
      nodes: copy(read.document.nodes),
    });
    if (seal.previousSealRef === null) break;
    const link = capsule.links.find(x => x.logicalRef === seal.previousSealRef);
    if (!link) throw new Error("missing-historical-link");
    ref = link.storageRef;
  }
  return history;
}
function node(historyState, id) {
  return historyState?.nodes.find(n => n.id === id) || null;
}
function siblings(state, id) {
  const target = node(state, id);
  return target ? state.nodes.filter(n => n.parentId === target.parentId)
    .sort((a, b) => a.order - b.order).map(n => n.id) : null;
}
const deny = reason => Object.freeze({ ok: false, reason, operation: null });

// This is NOT a production Undo planner. It produces an unauthorised
// structural hypothesis, and it must NEVER emit an executable Undo operation.
// P111 ciphertext + per-Seal semantic HMACs prove the bytes and provenance,
// not the user's action identity or each ancestor's historical server CAS.
function hypothesise(history, selectedAfterRef, observedCurrentRef) {
  if (!Array.isArray(history) || history.length < 3)
    return deny("incomplete-history");
  if (history[0].physicalRef !== observedCurrentRef)
    return deny("stale-head");
  if (typeof selectedAfterRef !== "string" || !selectedAfterRef)
    return deny("missing-authenticated-action-identity");
  const k = history.findIndex(x => x.physicalRef === selectedAfterRef);
  if (k < 0 || k + 1 >= history.length)
    return deny("unknown-or-orphaned-selector");
  const after = history[k], before = history[k + 1];
  if (node(before, "C")?.parentId !== "A" ||
      node(after, "C")?.parentId !== "B")
    return deny("selector-is-not-target-move");
  if (after.contentRoot !== before.contentRoot ||
      after.preservationRoot !== before.preservationRoot ||
      after.placementRoot === before.placementRoot ||
      after.childrenRoot === before.childrenRoot)
    return deny("unexplained-forward-mutation");
  if (siblings(before, "C")?.[0] !== "C" ||
      siblings(after, "C")?.[1] !== "C")
    return deny("unexpected-move-order");
  for (let i = 0; i < k; i++) {
    if (node(history[i], "C")?.parentId !== "B" ||
        JSON.stringify(siblings(history[i], "C")) !==
        JSON.stringify(siblings(after, "C")))
      return deny("intervening-target-change-including-aba");
  }
  if (!node(history[0], "A") || !node(history[0], "C") ||
      node(history[0], "A").parentId !== "root")
    return deny("original-endpoint-unavailable");
  if (JSON.stringify(history[0].nodes.filter(n => n.parentId === "A")
        .sort((a,b)=>a.order-b.order).map(n=>n.id)) !== JSON.stringify(["D"]))
    return deny("original-slot-conflict");
  // Read-only hypothesis: recovered source position, not authenticated action.
  return Object.freeze({
    ok: true, authority: "UNPROVEN", intent: "UNPROVEN",
    historicalHeadCAS: "UNPROVEN",
    originalParentId: "A", originalIndex: 0,
    currentParentId: "B", currentIndex: 1,
    targetNodeId: "C", operation: null,
  });
}


// TWO-WORLD INDISTINGUISHABILITY PROOF.
// World A: server accepts genesis -> B(move) -> C(edit).
// World B: server accepts genesis -> D(independent edit) -> C(edit).
// B is only uploaded/attested in World B: it has NEVER been accepted as Head.
// D is only uploaded/attested in World A: it has NEVER been accepted as Head.
// Both histories persist EXACTLY the same encrypted objects and current Head.
// The P120 contract checks expected Head and candidate object presence, not
// the candidate's declared predecessor. This is an adversarial direct P120
// CAS in World B; it is NOT a legitimate P127/P122 client publication.
test("Boundary proof: authenticated unaccepted predecessor is indistinguishable from accepted predecessor after restart", { timeout: 120000 }, async () => {
  const f = await createDisposable();
  const c = runtime();
  const original = copy(f.store.head);
  assert.equal(original.revision, 1);
  const opener = await fresh(f, f.store, "boundary-genesis-reader");

  const B = await prepareFrom(opener, {
    nodeId: "C", fromIndex: 0, newParentId: "B", toIndex: 1,
  }, "move");
  assert.equal(B.outcome, "prepared", JSON.stringify(B));
  assert.deepEqual(copy(B.expectedHead), original);

  const D = await prepareFrom(opener, {
    nodeId: "E", payload: { label: "Unrelated change" },
  }, "payload");
  assert.equal(D.outcome, "prepared", JSON.stringify(D));
  assert.deepEqual(copy(D.expectedHead), original);
  assert.notEqual(B.stage.sealStorageRef, D.stage.sealStorageRef);

  // Upload B without CAS. Real P120 object PUT is deliberately NOT Head acceptance.
  let ordinal = 0;
  const p120 = service(c, f.store);
  async function upload(stage) {
    for (const entry of stage.newRecords) {
      const result = await p120.putOpaqueObject({
        apiVersion: 1, operationId: "boundary-upload-" + (++ordinal),
        syncedPocketId: POCKET_ID,
        storageRef: entry.storageRef, record: entry.record,
      });
      assert.equal(result.ok, true);
    }
  }
  await upload(B.stage);
  await upload(D.stage);
  assert.deepEqual(copy(f.store.head), original);
  assert.equal(f.store.casObservations.length, 1); // Genesis only

  // An adversary with Pocket's valid master/semantic keys can prepare C
  // against the uploaded, valid but never-accepted B, by claiming B as Head
  // to a disposable client opener. This DOES NOT constitute a server CAS.
  const constructed = afterRestart(f.store);
  constructed.head = { schema: HEAD, revision: 2, sealRef: B.stage.sealStorageRef };
  const bReader = await fresh(f, constructed, "boundary-fabricated-reader");
  const C = await prepareFrom(bReader, {
    nodeId: "C", payload: { label: "Changed after move" },
  }, "payload");
  assert.equal(C.outcome, "prepared", JSON.stringify(C));
  assert.equal(C.expectedHead.sealRef, B.stage.sealStorageRef);
  assert.notEqual(C.stage.sealStorageRef, B.stage.sealStorageRef);
  await upload(C.stage);

  const yes = afterRestart(f.store);
  const no = afterRestart(f.store);
  // Both are identical stores before any publication, and all ciphertext
  // is present in BOTH worlds, including the eventually unaccepted candidate.
  assert.deepEqual(copy([...yes.objects]), copy([...no.objects]));

  // World A: ordinary P122 publication, with genuinely accepted B and C.
  const bCommit = await publisher(c, yes, "boundary-legit-B").publishCandidate({
    stage: B.stage, expectedHead: original,
  });
  assert.equal(bCommit.outcome, "committed", JSON.stringify(bCommit));
  const cCommit = await publisher(c, yes, "boundary-legit-C").publishCandidate({
    stage: C.stage, expectedHead: B.expectedHead.revision === original.revision ?
      { schema: HEAD, revision: 2, sealRef: B.stage.sealStorageRef } : B.expectedHead,
  });
  assert.equal(cCommit.outcome, "committed", JSON.stringify(cCommit));

  // World B: accept D via P122 then exploit the actual P120 CAS request
  // boundary to point Head at C, whose predecessor is B rather than D.
  const dCommit = await publisher(c, no, "boundary-unrelated-D").publishCandidate({
    stage: D.stage, expectedHead: original,
  });
  assert.equal(dCommit.outcome, "committed", JSON.stringify(dCommit));
  assert.equal(no.head.sealRef, D.stage.sealStorageRef);
  const adversarialCAS = await service(c, no).compareAndSetShadowHead({
    apiVersion: 1, operationId: "boundary-direct-cas",
    syncedPocketId: POCKET_ID, expectedHead: copy(no.head),
    candidateSealStorageRef: C.stage.sealStorageRef,
  });
  assert.equal(adversarialCAS.ok, true);
  assert.equal(adversarialCAS.head.sealRef, C.stage.sealStorageRef);

  // Writer observations reveal difference, but they ARE NOT retained by the
  // existing object/Head store. The original world accepted B; the second
  // world accepted D. Both current heads have the same revision (3).
  assert.equal(yes.head.revision, 3);
  assert.equal(no.head.revision, 3);
  assert.notEqual(yes.casObservations[1].next.sealRef,
    no.casObservations[1].next.sealRef);
  assert.equal(yes.casObservations[1].next.sealRef, B.stage.sealStorageRef);
  assert.equal(no.casObservations[1].next.sealRef, D.stage.sealStorageRef);

  // Restart discards all transport CAS observations, WeakMaps and ephemeral
  // human-action witnesses. Both persisted worlds are now byte-identical.
  const originalHumanIntent = new Map([["human-intended-move", B.stage.sealStorageRef]]);
  assert.equal(originalHumanIntent.size, 1); // deliberately NOT persisted
  const good = afterRestart(yes), bad = afterRestart(no);
  assert.deepEqual(good.head, bad.head);
  assert.deepEqual(copy([...good.objects]), copy([...bad.objects]));
  assert.deepEqual(good.casObservations, []);
  assert.deepEqual(bad.casObservations, []);

  const freshYes = await fresh(f, good, "boundary-restart-A");
  const freshNo = await fresh(f, bad, "boundary-restart-B");
  const yesHistory = await inspectHistory(freshYes, good);
  const noHistory = await inspectHistory(freshNo, bad);
  assert.deepEqual(yesHistory, noHistory);
  assert.equal(yesHistory.length, 3);
  assert.equal(yesHistory[0].physicalRef, C.stage.sealStorageRef);
  assert.equal(yesHistory[1].physicalRef, B.stage.sealStorageRef);
  assert.equal(yesHistory[2].physicalRef, original.sealRef);
  assert.equal(node(yesHistory[0], "C").parentId, "B");
  assert.equal(node(noHistory[0], "C").parentId, "B");

  // The recovered historical B is valid P111/P139 ciphertext/semantic HMAC,
  // and its structure passes P368. Yet B was never server-accepted in World B.
  // Neither world yields an authenticated original human action identity.
  const purported = hypothesise(yesHistory, B.stage.sealStorageRef, good.head.sealRef);
  const purportedNo = hypothesise(noHistory, B.stage.sealStorageRef, bad.head.sealRef);
  assert.deepEqual(purported, purportedNo);
  assert.equal(purported.operation, null);
  assert.equal(purported.authority, "UNPROVEN");
  assert.equal(purported.intent, "UNPROVEN");
  assert.equal(purported.historicalHeadCAS, "UNPROVEN");
  assert.equal(hypothesise(noHistory, null, bad.head.sealRef).reason,
    "missing-authenticated-action-identity");
});

test("Accepted Postgres Head-CAS contract contains no predecessor or intent binding", () => {
  const file = fs.readFileSync(path.join(ROOT,
    "sync-service/pocket-sync-object-head-postgres-store.js"), "utf8");
  const sql = file.match(/headCompareAndSet:\s*\x60([\s\S]*?)\x60/);
  assert.ok(sql, "real server SQL contract exists");
  assert.ok(sql[1].includes('UPDATE ${HEAD_TABLE} SET revision = revision + 1'));
  assert.match(sql[1], /seal_storage_ref = \$4/);
  assert.match(sql[1], /revision = \$2/);
  assert.match(sql[1], /seal_storage_ref IS NOT DISTINCT FROM \$3/);
  assert.doesNotMatch(sql[1], /predecessor|previous|intent|action|operation_id/i);
  const server = fs.readFileSync(path.join(ROOT,
    "sync-service/pocket-sync-service-core.js"), "utf8");
  assert.match(server, /objectHeadCall\("compareAndSetHead", \[request.syncedPocketId,/);
  assert.match(server, /request.expectedHead, request.candidateSealStorageRef/);
  // This is a contract inspection, NOT live Postgres/auth/session testing.
});
