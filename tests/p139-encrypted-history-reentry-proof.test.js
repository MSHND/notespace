"use strict";

// Disposable encrypted, restart-bound P139/P111/P124 read-only continuity proof.
// It deliberately does NOT authorise Undo: historical Head acceptance and the
// human transaction-to-thought binding are not persisted by these existing APIs.
const test = require("node:test"), assert = require("node:assert/strict");
const fs = require("node:fs"), path = require("node:path"), vm = require("node:vm");
const { webcrypto } = require("node:crypto");
const { semanticBase } = require("./helpers/starling-semantic-test.js");
const ROOT = path.resolve(__dirname, ".."), POCKET_ID = "disposable-reentry-only";
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
  const c = runtime();
  const baseText = "invoice", stamp = "2026-10-25T00:00:00.000Z";
  const nodes = [
    { id: "N", parentId: "root", order: 0, label: "Parent",
      details: baseText, editor: { schema: "pocket.nodeEditor.v2", text: baseText }, updatedAt: stamp },
    { id: "C", parentId: "N", order: 0, label: "Independent child" },
    { id: "S", parentId: "root", order: 1, label: "Independent sibling" },
  ];
  const encoded = c.PocketStarlingBridgeShadow.encode({
    schema: "portal.mtt.web.v1", writtenAt: stamp, nodes,
    tombstones: [], rootExtras: {}, dataExtras: {},
  }, { capacity: 4 });
  assert.equal(encoded.ok, true, JSON.stringify(encoded));
  const built = c.PocketStarlingRootShadow.build(encoded.bridge);
  assert.equal(built.ok, true, JSON.stringify(built));
  const stager = c.PocketStarlingObjectSealShadow.createStager();
  const staged = c.PocketStarlingObjectSealShadow.stageCandidate(stager, built.state,
    { previousSealRef: null });
  assert.equal(staged.ok, true, JSON.stringify(staged));
  const semantic = await semanticBase(c, {
    acceptedSealRef: staged.stage.sealRef,
    resolveLogical: ref => stager.store.get(ref),
    syncedPocketId: POCKET_ID,
  });
  const physical = await c.PocketStarlingStorageShadow.stageCandidate({
    sealRef: staged.stage.sealRef, resolveLogical: ref => stager.store.get(ref),
    masterKey: semantic.masterKey, context: context(),
    semanticAuthority: semantic.semanticAuthority,
    semanticValidityProof: semantic.semanticValidityProof,
  });
  const store = remote();
  const accepted = await publisher(c, store, "initial").publishCandidate({
    stage: physical, expectedHead: initialHead(),
  });
  assert.equal(accepted.outcome, "committed");
  return { store, envelope: semantic.envelope, initialSeal: physical.sealStorageRef };
}

async function fresh(f, store, prefix, id = POCKET_ID) {
  const c = runtime();
  const credentials = await c.PocketSyncCrypto.openMasterKeyBundle(
    f.envelope.record, f.envelope.wrappingKey, f.envelope.envelopeContext,
    [], { semanticAuthority: true });
  const opened = await c.PocketStarlingRemoteOpenShadow.createRemoteOpener({
    objectHeadService: service(c, store), operationIdFactory: ids(prefix),
  }).openRemote({ masterKey: credentials.masterKey,
    context: context(id), semanticAuthority: credentials.semanticAuthority });
  assert.equal(opened.outcome, "opened");
  return { c, credentials, opened };
}
async function edit(f, nodeId, mutate, prefix) {
  const a = await fresh(f, f.store, prefix + "-open");
  const prior = await a.opened.session.readContent(nodeId);
  assert.equal(prior.ok, true, JSON.stringify(prior));
  const payload = copy(prior.payload); mutate(payload);
  const editor = await a.c.PocketStarlingRemoteEditShadow.createEditor({
    opened: a.opened, masterKey: a.credentials.masterKey, context: context(),
    semanticAuthority: a.credentials.semanticAuthority,
  });
  const prepared = await editor.preparePayloadEdit({ nodeId, payload });
  assert.equal(prepared.outcome, "prepared", JSON.stringify(prepared));
  const committed = await publisher(a.c, f.store, prefix + "-publish").publishCandidate({
    stage: prepared.stage, expectedHead: prepared.expectedHead,
  });
  assert.equal(committed.outcome, "committed");
  return copy(f.store.head);
}

function afterRestart(store) {
  // Only encrypted objects and current Head survive. Deliberately discard
  // writer VM, semantic WeakMaps, CAS observations and all transaction IDs.
  return { head: copy(store.head),
    objects: new Map([...store.objects].map(([ref, value]) => [ref, copy(value)])),
    casObservations: [] };
}
// Fault injection ONLY: preserve authentic AES-GCM storage references while
// altering selected plaintext capsule metadata inside the disposable store.
// This is not a valid edit, Head CAS, or history migration.
async function resealCapsuleForFaultInjection(a, store, ref, transform) {
  const existing = store.objects.get(ref);
  assert.ok(existing, "fault injection requires an existing ciphertext record");
  const bytes = await a.c.PocketStarlingCryptoShadow.openObject(
    existing, ref, a.credentials.masterKey, context());
  const changed = transform(copy(JSON.parse(bytes)));
  const canonical = a.c.PocketStarlingStorageShadow.canonicalCapsule(changed);
  const validated = a.c.PocketStarlingStorageShadow.validateCapsuleBytes(canonical);
  assert.equal(validated.logicalKind, "candidate-seal");
  const sealed = await a.c.PocketStarlingCryptoShadow.sealObject(
    canonical, a.credentials.masterKey, context());
  store.objects.set(sealed.ref, copy(sealed.record));
  return { ref: sealed.ref, logicalRef: validated.logicalRef };
}
async function inspectLineage(a, store, id = POCKET_ID) {
  // Check current Head via actual P124 remote-open, then walk predecessor links
  // of opaque attested seals, authenticating each exact logical Seal independently.
  const verifiedOpen = await a.c.PocketStarlingRemoteOpenShadow.createRemoteOpener({
    objectHeadService: service(a.c, store), operationIdFactory: ids("reentry-current"),
  }).openRemote({ masterKey: a.credentials.masterKey,
    context: context(id), semanticAuthority: a.credentials.semanticAuthority });
  if (verifiedOpen.outcome !== "opened") throw new Error("current-head-not-authenticated");
  let ref = verifiedOpen.head.sealRef, count = 0;
  const history = [], seen = new Set();
  while (ref !== null) {
    if (seen.has(ref) || ++count > 16) throw new Error("cyclic-or-excess-history");
    seen.add(ref);
    const encrypted = store.objects.get(ref);
    if (!encrypted) throw new Error("missing-history-object");
    const bytes = await a.c.PocketStarlingCryptoShadow.openObject(encrypted, ref,
      a.credentials.masterKey, context(id));
    const capsule = a.c.PocketStarlingStorageShadow.validateCapsuleBytes(bytes);
    if (capsule.logicalKind !== "candidate-seal" || !capsule.semanticValidity)
      throw new Error("unattested-history-seal");
    const seal = capsule.object;
    const binding = {
      syncedPocketId: id, logicalSealRef: capsule.logicalRef,
      logicalRootRef: seal.rootRef, previousLogicalSealRef: seal.previousSealRef,
      logicalSealSchema: "pocket.starling.candidate-seal.v1",
      logicalRootSchema: "pocket.starling.logical-root.v1",
      logicalObjectSchema: "pocket.starling.logical-object.v1",
      sequenceSchema: "pocket.starling.sequence-page.v2",
      placementGeneration: "pocket.starling.placement-relation.v1",
    };
    const auth = await a.c.PocketStarlingSemanticAuthorityShadow.authenticate({
      authority: a.credentials.semanticAuthority,
      semanticValidity: capsule.semanticValidity, binding,
    });
    if (!auth.ok) throw new Error("unadmitted-history-seal");
    const resolver = await a.c.PocketStarlingStorageShadow.createResolver({
      acceptedSealStorageRef: ref, acceptedBaseComplete: true,
      masterKey: a.credentials.masterKey, context: context(id),
      resolveStorage: storageRef => {
        const record = store.objects.get(storageRef);
        if (!record) throw new Error("missing-history-object");
        return record;
      },
    });
    const opened = await resolver.openAccepted();
    if (!opened.ok) throw new Error("invalid-historical-seal");
    const n = await resolver.readContent(opened.handle, "N");
    const child = await resolver.readContent(opened.handle, "C");
    const sibling = await resolver.readContent(opened.handle, "S");
    const nPlace = await resolver.readPlacement(opened.handle, "N");
    const childPlace = await resolver.readPlacement(opened.handle, "C");
    const siblingPlace = await resolver.readPlacement(opened.handle, "S");
    if (!n.ok || !child.ok || !sibling.ok ||
        !nPlace.ok || !childPlace.ok || !siblingPlace.ok ||
        nPlace.parentId !== "root" || childPlace.parentId !== "N" ||
        siblingPlace.parentId !== "root" ||
        n.nodeId !== "N" || child.nodeId !== "C" || sibling.nodeId !== "S")
      throw new Error("incoherent-accepted-placement");
    history.push({ ref, logicalRef: capsule.logicalRef,
      predecessor: seal.previousSealRef, N: copy(n.payload),
      C: copy(child.payload), S: copy(sibling.payload),
      placements: { N: copy(nPlace), C: copy(childPlace), S: copy(siblingPlace) },
      placementRootRef: opened.handle.root.placementRef,
      childrenRootRef: opened.handle.root.childrenRef });
    if (seal.previousSealRef === null) break;
    const link = capsule.links.find(x => x.logicalRef === seal.previousSealRef);
    if (!link) throw new Error("missing-historical-link");
    ref = link.storageRef;
  }
  return history;
}

// The caller MUST supply an EXTERNAL, UNTRUSTED physical-seal hint. It is not
// discovered from retained edit provenance. Matching a signed history record
// cannot authenticate which human action the caller intended to undo.
function readOnlyPreview(history, untrustedExternalSealHint) {
  const refuse = (reason) => ({ ok: false, reason, operation: null });
  if (typeof untrustedExternalSealHint !== "string" || !untrustedExternalSealHint)
    return refuse("invalid-untrusted-edit-hint");
  const index = history.findIndex(x => x.ref === untrustedExternalSealHint);
  if (index < 0 || index + 1 >= history.length)
    return refuse("not-in-current-sealed-ancestry");
  const after = history[index], before = history[index + 1];
  const original = before.N.editor?.text, edited = after.N.editor?.text;
  if (typeof original !== "string" || typeof edited !== "string" || original === edited)
    return refuse("no-text-inverse");
  if (after.N.editor?.schema !== "pocket.nodeEditor.v2" ||
      before.N.editor?.schema !== "pocket.nodeEditor.v2" ||
      Object.keys(after.N.editor).sort().join(",") !== "schema,text" ||
      Object.keys(before.N.editor).sort().join(",") !== "schema,text" ||
      after.N.details !== edited || before.N.details !== original)
    return refuse("unsupported-details-projection");
  // An original edit is N-only if every other fixture thought and ALL structural
  // placement / child-order roots are untouched. Preserve existing node identity.
  const nonText = p => {
    const { editor, details, updatedAt, ...remaining } = p;
    return remaining;
  };
  if (JSON.stringify(nonText(after.N)) !== JSON.stringify(nonText(before.N)) ||
      JSON.stringify(after.C) !== JSON.stringify(before.C) ||
      JSON.stringify(after.S) !== JSON.stringify(before.S) ||
      JSON.stringify(after.placements) !== JSON.stringify(before.placements) ||
      after.placementRootRef !== before.placementRootRef ||
      after.childrenRootRef !== before.childrenRootRef)
    return refuse("unexplained-forward-mutation");
  for (let i = 0; i < index; i++) {
    if (JSON.stringify(history[i].N) !== JSON.stringify(history[i + 1].N) ||
        JSON.stringify(history[i].placements.N) !==
        JSON.stringify(history[i + 1].placements.N))
      return refuse("intervening-target-change-including-aba");
  }
  // NON-EXECUTABLE preview: the hint is not an authenticated human transaction;
  // neither every historical Head CAS nor Undo authority is proved after restart.
  return { ok: true, scope: "read-only-hypothesis",
    selectorEvidence: "external-untrusted-hint",
    latestSeal: history[0].ref, proposedThoughtId: "N", proposedText: original,
    unchangedIndependentChild: copy(history[0].C),
    historicallyCommitted: "unproved", humanTransactionIdentity: "unproved",
    authorisedUndo: false, operation: null };
}

test("Encrypted re-entry v1: accepted Head opens after restart; historical HMAC chain supports only a read-only scoped hypothesis", async () => {
  const f = await createDisposable();
  const editedHead = await edit(f, "N", p => {
    p.editor.text = "payment"; p.details = "payment";
    p.updatedAt = "2026-10-25T00:10:00.000Z";
  }, "target");
  const beforeChild = copy(f.store.head);
  await edit(f, "C", p => { p.label = "Child changed after target"; }, "child");
  assert.equal(f.store.casObservations.length, 3);
  assert.equal(beforeChild.sealRef, editedHead.sealRef);
  // The persisted test store has exactly P111 ciphertext envelopes and Head:
  for (const record of f.store.objects.values()) {
    assert.deepEqual(Object.keys(record).sort(),
      ["format", "version", "algorithm", "nonce", "ciphertext"].sort());
    assert.equal(JSON.stringify(record).includes("Child changed after target"), false);
    assert.equal(JSON.stringify(record).includes("payment"), false);
  }
  const persisted = afterRestart(f.store);
  assert.deepEqual(persisted.casObservations, []);
  const a = await fresh(f, persisted, "fresh-runtime");
  const lineage = await inspectLineage(a, persisted);
  assert.equal(lineage.length, 3);
  assert.equal(lineage[0].C.label, "Child changed after target");
  assert.equal(lineage[1].C.label, lineage[2].C.label);
  assert.equal(lineage[0].N.editor.text, "payment");
  assert.equal(lineage[2].N.editor.text, "invoice");
  // The writer supplied this hint from BEFORE restart. It is deliberately not
  // presented as recovered transaction identity or automatically discovered Undo.
  const externalUntrustedEditHint = editedHead.sealRef;
  const hypothesis = readOnlyPreview(lineage, externalUntrustedEditHint);
  assert.equal(hypothesis.ok, true);
  assert.equal(hypothesis.selectorEvidence, "external-untrusted-hint");
  assert.deepEqual(readOnlyPreview(lineage, "unrelated-candidate"),
    { ok: false, reason: "not-in-current-sealed-ancestry", operation: null });
  assert.deepEqual(readOnlyPreview(lineage, lineage[0].ref),
    { ok: false, reason: "no-text-inverse", operation: null });
  assert.equal(hypothesis.proposedText, "invoice");
  assert.equal(hypothesis.unchangedIndependentChild.label, "Child changed after target");
  assert.equal(hypothesis.authorisedUndo, false);
  assert.equal(hypothesis.historicallyCommitted, "unproved");
  assert.equal(hypothesis.humanTransactionIdentity, "unproved");
  assert.equal(hypothesis.operation, null);
});

test("Encrypted re-entry v1: missing objects, tampered HMAC, wrong Pocket/key, orphan candidates and ABA fail closed", async () => {
  const f = await createDisposable();
  const after = await edit(f, "N", p => {
    p.editor.text = "payment"; p.details = "payment";
    p.updatedAt = "2026-10-25T00:10:00.000Z";
  }, "edit");
  await edit(f, "C", p => { p.label = "Later child"; }, "later-child");
  const persisted = afterRestart(f.store);
  const a = await fresh(f, persisted, "fresh-negative");
  const baseline = await inspectLineage(a, persisted);
  assert.equal(readOnlyPreview(baseline, after.sealRef).ok, true);
  for (const [kind, patch] of [
    ["additional-child-edit", h => { h[1].C.label = "Unexpected original child mutation"; }],
    ["additional-sibling-edit", h => { h[1].S.label = "Unexpected original sibling mutation"; }],
    ["target-non-text-edit", h => { h[1].N.label = "Unexpected original label mutation"; }],
    ["target-reparent", h => { h[1].placements.N.parentId = "S"; }],
    ["child-order-changed", h => { h[1].childrenRootRef = "fake-unverified-order"; }],
  ]) {
    const changed = copy(baseline);
    patch(changed);
    assert.deepEqual(readOnlyPreview(changed, after.sealRef),
      { ok: false, reason: "unexplained-forward-mutation", operation: null }, kind);
  }
  const absent = afterRestart(persisted);
  absent.objects.delete(after.sealRef);
  await assert.rejects(inspectLineage(a, absent), /missing-history-object/);
  const capsule = a.c.PocketStarlingStorageShadow.validateCapsuleBytes(
    await a.c.PocketStarlingCryptoShadow.openObject(
      persisted.objects.get(after.sealRef), after.sealRef,
      a.credentials.masterKey, context()));
  const binding = { syncedPocketId: POCKET_ID, logicalSealRef: capsule.logicalRef,
    logicalRootRef: capsule.object.rootRef,
    previousLogicalSealRef: capsule.object.previousSealRef,
    logicalSealSchema: "pocket.starling.candidate-seal.v1",
    logicalRootSchema: "pocket.starling.logical-root.v1",
    logicalObjectSchema: "pocket.starling.logical-object.v1",
    sequenceSchema: "pocket.starling.sequence-page.v2",
    placementGeneration: "pocket.starling.placement-relation.v1" };
  const badHmac = { ...capsule.semanticValidity, tag: "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" };
  assert.equal((await a.c.PocketStarlingSemanticAuthorityShadow.authenticate({
    authority: a.credentials.semanticAuthority, semanticValidity: badHmac, binding,
  })).ok, false);
  // End-to-end historical-HMAC rejection, NOT just a direct verifier call.
  // Re-seal the edited historical capsule using existing P111 AES-GCM, giving
  // its altered semanticValidity a correct NEW encrypted storage ref. Then
  // re-seal the descendant/current capsule with an updated predecessor link.
  // Its *own* semantic HMAC is unchanged and valid (logical Seal unchanged),
  // so P124 current-Head open must succeed before P139 historical auth rejects.
  // This is a disposable fault-injected, synthetic Head, NOT a committed CAS.
  const corrupted = afterRestart(persisted);
  const historicalFault = await resealCapsuleForFaultInjection(a, corrupted,
    after.sealRef, c => ({ ...c, semanticValidity: badHmac }));
  const currentFault = await resealCapsuleForFaultInjection(a, corrupted,
    corrupted.head.sealRef, c => ({
      ...c,
      links: c.links.map(link => link.logicalRef === historicalFault.logicalRef
        ? { ...link, storageRef: historicalFault.ref } : link),
    }));
  assert.notEqual(currentFault.ref, persisted.head.sealRef);
  corrupted.head.sealRef = currentFault.ref; // explicit fault injection ONLY
  const faultReader = await fresh(f, corrupted, "hmac-fault-current-valid");
  await assert.rejects(inspectLineage(faultReader, corrupted),
    /unadmitted-history-seal/);
  const wrongPocket = await a.c.PocketStarlingSemanticAuthorityShadow.authenticate({
    authority: a.credentials.semanticAuthority, semanticValidity: capsule.semanticValidity,
    binding: { ...binding, syncedPocketId: "foreign-pocket" },
  });
  assert.equal(wrongPocket.ok, false);
  await assert.rejects(inspectLineage(a, persisted, "foreign-pocket"));
  const alien = await a.c.PocketSyncCrypto.createMasterKeyBundle([{
    context: { syncedPocketId: POCKET_ID, envelopeId: "alien",
      envelopeKind: "device", envelopeVersion: 1 },
    wrappingKey: await a.c.PocketSyncCrypto.generateDeviceWrappingKey(),
  }], { semanticAuthority: true });
  const lost = { ...a, credentials: { ...a.credentials,
    masterKey: alien.masterKey, semanticAuthority: alien.semanticAuthority } };
  await assert.rejects(inspectLineage(lost, persisted));
  // Crash just before CAS: all candidate ciphertext present; Head never moves.
  const freshCurrent = await fresh(f, f.store, "orphan-current");
  const current = await freshCurrent.opened.session.readContent("N");
  const editor = await freshCurrent.c.PocketStarlingRemoteEditShadow.createEditor({
    opened: freshCurrent.opened, masterKey: freshCurrent.credentials.masterKey,
    context: context(), semanticAuthority: freshCurrent.credentials.semanticAuthority,
  });
  const orphanPayload = copy(current.payload);
  orphanPayload.label = "Prepared but never committed";
  const candidate = await editor.preparePayloadEdit({ nodeId: "N", payload: orphanPayload });
  assert.equal(candidate.outcome, "prepared");
  for (const entry of candidate.stage.newRecords)
    f.store.objects.set(entry.storageRef, copy(entry.record));
  const oldHead = copy(f.store.head);
  const restarted = afterRestart(f.store);
  assert.deepEqual(copy(restarted.head), oldHead);
  const r = await fresh(f, restarted, "after-orphan");
  const ancestry = await inspectLineage(r, restarted);
  const uncommitted = readOnlyPreview(ancestry, candidate.stage.sealStorageRef);
  assert.deepEqual(uncommitted, { ok: false, reason: "not-in-current-sealed-ancestry", operation: null });
  // ABA: target changes twice after accepted edit, then exactly equals edited text.
  await edit(f, "N", p => { p.editor.text = "changed-again"; p.details = "changed-again"; }, "aba-one");
  await edit(f, "N", p => { p.editor.text = "payment"; p.details = "payment";
    p.updatedAt = "2026-10-25T00:10:00.000Z"; }, "aba-two");
  const newer = afterRestart(f.store), b = await fresh(f, newer, "aba-restart");
  const history = await inspectLineage(b, newer);
  assert.equal(history[0].N.editor.text, history[2].N.editor.text);
  assert.deepEqual(readOnlyPreview(history, after.sealRef),
    { ok: false, reason: "intervening-target-change-including-aba", operation: null });
});
