"use strict";

// Disposable encrypted, restart-bound P139/P111/P124 read-only continuity proof.
// It deliberately does NOT authorise Undo: historical Head acceptance and the
// human transaction-to-thought binding are not persisted by these existing APIs.
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

test("Proof 2 recovers encrypted structural lineage after restart, prepares a noncommitting inverse hypothesis, but refuses Undo authority", { timeout: 120000 }, async () => {
  const f = await createDisposable();
  const genesis = copy(f.store.head);
  const moved = await commit(f, "move", {
    nodeId: "C", fromIndex: 0, newParentId: "B", toIndex: 1,
  }, "move-C");
  await commit(f, "payload", {
    nodeId: "C", payload: { label: "C edited AFTER move", note: "keep-me" },
  }, "edit-C");
  await commit(f, "payload", {
    nodeId: "B", payload: { label: "B edited independently" },
  }, "edit-B");
  assert.equal(f.store.casObservations.length, 4);
  const persisted = afterRestart(f.store);
  assert.deepEqual(persisted.casObservations, []);
  // The fresh reader receives NO operation witness, transaction ID, CAS log or editor state.
  const freshReader = await fresh(f, persisted, "proof2-fresh-runtime");
  const history = await inspectHistory(freshReader, persisted);
  assert.equal(history.length, 4);
  assert.equal(history[0].physicalRef, persisted.head.sealRef);
  assert.equal(history[1].physicalRef !== moved.sealRef, true);
  assert.equal(history[2].physicalRef, moved.sealRef);
  assert.equal(history[3].physicalRef, genesis.sealRef);
  assert.equal(node(history[3], "C").parentId, "A");
  assert.deepEqual(siblings(history[3], "C"), ["C", "D"]);
  assert.equal(node(history[2], "C").parentId, "B");
  assert.deepEqual(siblings(history[2], "C"), ["F", "C"]);
  assert.equal(history[2].contentRoot, history[3].contentRoot);
  assert.equal(history[2].preservationRoot, history[3].preservationRoot);
  assert.equal(node(history[0], "C").label, "C edited AFTER move");
  assert.equal(node(history[0], "C").note, "keep-me");
  assert.equal(node(history[0], "B").label, "B edited independently");
  assert.equal(node(history[0], "G").parentId, "C");

  assert.deepEqual(hypothesise(history, null, persisted.head.sealRef),
    deny("missing-authenticated-action-identity"));
  const untrustedHint = moved.sealRef; // ONLY from pre-restart caller, not retained intent
  const hypothesis = hypothesise(history, untrustedHint, persisted.head.sealRef);
  assert.equal(hypothesis.ok, true);
  assert.equal(hypothesis.authority, "UNPROVEN");
  assert.equal(hypothesis.intent, "UNPROVEN");
  assert.equal(hypothesis.historicalHeadCAS, "UNPROVEN");
  assert.equal(hypothesis.operation, null);

  // P139 can still PREPARE the inverse from the freshly authenticated current Head.
  // No publishCandidate/CAS: it is NOT authorised as the user's Undo.
  const prepared = await prepareFrom(freshReader, {
    nodeId: "C", fromIndex: hypothesis.currentIndex,
    newParentId: hypothesis.originalParentId, toIndex: hypothesis.originalIndex,
  }, "move");
  assert.equal(prepared.outcome, "prepared", JSON.stringify(prepared));
  assert.equal(prepared.expectedHead.sealRef, persisted.head.sealRef);
  assert.notEqual(prepared.stage.sealStorageRef, persisted.head.sealRef);
  assert.deepEqual(persisted.head, f.store.head);
  const reopened = await fresh(f, persisted, "proof2-no-publish");
  const originalStillMoved = await reopened.opened.session.readPlacement("C");
  assert.equal(originalStillMoved.parentId, "B");
  const c = await reopened.opened.session.readContent("C");
  const b = await reopened.opened.session.readContent("B");
  assert.equal(c.payload.note, "keep-me");
  assert.equal(b.payload.label, "B edited independently");

  // COUNTERFACTUAL ONLY: In a separate cloned disposable store, explicitly
  // publish the *manual structural move* prepared above. This establishes
  // composition behaviour, not historical Undo authority: the production
  // planner returns operation:null and the original accepted Head is untouched.
  const fork = afterRestart(persisted);
  const exercise = await publisher(freshReader.c, fork, "proof2-counterfactual").publishCandidate({
    stage: prepared.stage, expectedHead: prepared.expectedHead,
  });
  assert.equal(exercise.outcome, "committed");
  const forkReader = await fresh(f, fork, "proof2-counterfactual-open");
  const forkC = await forkReader.opened.session.readPlacement("C");
  assert.equal(forkC.parentId, "A");
  const forkProjection = await forkReader.c.PocketStarlingMaterializeShadow.materializeAccepted(
    forkReader.opened.session);
  assert.equal(forkProjection.ok, true, JSON.stringify(forkProjection));
  const forkState = { nodes: copy(forkProjection.document.nodes) };
  assert.deepEqual(siblings(forkState, "C"), ["C", "D"]);
  assert.equal(node(forkState, "C").note, "keep-me");
  assert.equal(node(forkState, "B").label, "B edited independently");
  assert.equal(node(forkState, "G").parentId, "C");
  assert.equal(node(forkState, "E").parentId, "root");
  assert.notEqual(fork.head.sealRef, persisted.head.sealRef);
  assert.equal(fork.casObservations.length, 1);
  assert.deepEqual(persisted.head, f.store.head);
});

test("Proof 2 denies unknown intent, stale Head, tampering, orphan candidates and post-move ABA without publishing", { timeout: 120000 }, async () => {
  const f = await createDisposable();
  const moved = await commit(f, "move", {
    nodeId: "C", fromIndex: 0, newParentId: "B", toIndex: 1,
  }, "target");
  await commit(f, "payload", {
    nodeId: "B", payload: { label: "independent later edit" },
  }, "later");
  const persisted = afterRestart(f.store);
  const a = await fresh(f, persisted, "proof2-negative");
  const history = await inspectHistory(a, persisted);
  assert.equal(hypothesise(history, "fabricated-transaction-id", persisted.head.sealRef).reason,
    "unknown-or-orphaned-selector");
  assert.equal(hypothesise(history, moved.sealRef, "old-stale-head").reason, "stale-head");
  assert.deepEqual(hypothesise(history, "", persisted.head.sealRef),
    deny("missing-authenticated-action-identity"));
  const absent = afterRestart(persisted);
  absent.objects.delete(moved.sealRef);
  await assert.rejects(inspectHistory(a, absent), /missing-historical-ciphertext/);
  const corrupted = afterRestart(persisted);
  const physical = corrupted.objects.get(moved.sealRef);
  corrupted.objects.set(moved.sealRef, { ...physical, ciphertext: "AAAA" });
  await assert.rejects(inspectHistory(a, corrupted));

  // Wrong Pocket binding and a foreign key both fail against actual P124
  // encrypted, semantic-validated Open; no mere fixture boolean assertion.
  await assert.rejects(
    a.c.PocketStarlingRemoteOpenShadow.createRemoteOpener({
      objectHeadService: service(a.c, persisted),
      operationIdFactory: ids("proof2-cross-pocket"),
    }).openRemote({
      masterKey: a.credentials.masterKey,
      context: context("a-foreign-pocket"),
      semanticAuthority: a.credentials.semanticAuthority,
    })
  );
  const alien = await a.c.PocketSyncCrypto.createMasterKeyBundle([{
    context: { syncedPocketId: POCKET_ID, envelopeId: "alien",
      envelopeKind: "device", envelopeVersion: 1 },
    wrappingKey: await a.c.PocketSyncCrypto.generateDeviceWrappingKey(),
  }], { semanticAuthority: true });
  await assert.rejects(
    a.c.PocketStarlingRemoteOpenShadow.createRemoteOpener({
      objectHeadService: service(a.c, persisted),
      operationIdFactory: ids("proof2-wrong-key"),
    }).openRemote({
      masterKey: alien.masterKey, context: context(),
      semanticAuthority: alien.semanticAuthority,
    })
  );
  assert.equal(
    hypothesise(history, history[history.length - 1].physicalRef, persisted.head.sealRef).reason,
    "selector-is-not-target-move");

  // An orphan prepared by the SAME P127 composer is not in accepted ancestry.
  const orphan = await prepareFrom(a, { nodeId: "C", fromIndex: 1,
    newParentId: "A", toIndex: 0 }, "move");
  assert.equal(orphan.outcome, "prepared");
  assert.equal(hypothesise(history, orphan.stage.sealStorageRef, persisted.head.sealRef).reason,
    "unknown-or-orphaned-selector");

  // Actual CAS accepted changes, not fabricated snapshots: move C back, then away again.
  await commit(f, "move", { nodeId: "C", fromIndex: 1,
    newParentId: "A", toIndex: 0 }, "aba-one");
  await commit(f, "move", { nodeId: "C", fromIndex: 0,
    newParentId: "B", toIndex: 1 }, "aba-two");
  const postABA = afterRestart(f.store);
  const b = await fresh(f, postABA, "proof2-aba");
  const later = await inspectHistory(b, postABA);
  assert.equal(hypothesise(later, moved.sealRef, postABA.head.sealRef).reason,
    "intervening-target-change-including-aba");
  assert.equal(node(later[0], "C").parentId, "B");
  assert.deepEqual(postABA.casObservations, []);
});
