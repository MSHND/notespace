"use strict";

/*
 * Disposable linked-fractal-text semantic inverse proof.
 *
 * Existing Pocket owners: PocketNodeContent (one canonical v2 text),
 * PocketStarlingLogicalEditShadow (semantic payload edits / successors),
 * PocketStarlingSemanticAuthorityShadow (admission),
 * PocketStarlingPlacementShadow (relationships) and Root/ObjectSeal (projections).
 *
 * Transaction witnesses and reference occurrence below are TEST-LOCAL fixtures,
 * not an adopted schema, not a second runtime journal and not an editor.
 * Never loads real Pocket, Save, Sync, Render, PE or snapshot Undo.
 */
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { webcrypto, createHash } = require("node:crypto");
const { execFileSync } = require("node:child_process");
const { semanticBase } = require("./helpers/starling-semantic-test.js");

const ROOT = path.resolve(__dirname, "..");
const ACCEPTED = "3787022fb91ccf3e17b6611bb967cf604e763737";
const SELF = "tests/pocket-linked-fractal-text-undo-proof.test.js";
const POCKET = "disposable-linked-text-pocket";
const OWNER = "disposable-owner";
const BEFORE = "Check @Blackwoods before processing the invoice.";
const AFTER = "Check @Blackwoods before processing the payment.";
const SCRIPTS = [
  "js/pocket-state.js", "js/pocket-data.js", "js/pocket-outline-persistence-policy.js",
  "js/pocket-node-content.js", "js/pocket-editor-metadata.js", "js/pocket-pe-import-preserve.js",
  "js/pocket-storage.js", "js/pocket-import.js", "js/pocket-starling-shadow.js",
  "js/pocket-starling-sequence-shadow.js", "js/pocket-starling-placement-shadow.js",
  "js/pocket-starling-bridge-shadow.js", "js/pocket-starling-root-shadow.js",
  "js/pocket-starling-object-seal-shadow.js", "js/pocket-sync-crypto.js",
  "js/pocket-starling-logical-edit-shadow.js", "js/pocket-starling-semantic-authority-shadow.js",
];
const plain = (v) => JSON.parse(JSON.stringify(v));
const sha = (v) => createHash("sha256").update(JSON.stringify(v)).digest("hex");
const git = (...args) => execFileSync("git", args, { cwd: ROOT, encoding: "utf8" }).trim();

function runtime() {
  const c = {
    crypto: webcrypto, TextEncoder, TextDecoder, Uint8Array, ArrayBuffer,
    URL, Date, Math, JSON, Map, Set, WeakMap, WeakSet, Object, Array,
    String, Number, Boolean, Promise, Error,
    btoa: (v) => Buffer.from(v, "binary").toString("base64"),
    atob: (v) => Buffer.from(v, "base64").toString("binary"),
    console: { log() {}, info() {}, warn() {}, error() {} },
    localStorage: { getItem() {}, setItem() {}, removeItem() {} },
    document: { body: { classList: { add() {}, remove() {}, toggle() {} } },
      getElementById() {}, addEventListener() {} },
    navigator: { clipboard: {} }, location: { href: "https://example.test" },
    indexedDB: null, open() {}, close() {}, setTimeout() { return 1; },
    clearTimeout() {}, requestAnimationFrame() { return 1; }, cancelAnimationFrame() {},
  };
  c.window = c; c.globalThis = c;
  vm.createContext(c);
  for (const file of SCRIPTS) {
    vm.runInContext(fs.readFileSync(path.join(ROOT, file), "utf8"), c, { filename: file });
  }
  return c;
}

function canonical(c, text) {
  const x = c.PocketNodeContent.prepareCanonical(text);
  assert.equal(x.ok, true);
  assert.ok(x.editor);
  return { editor: x.editor, details: x.details };
}

function fixture(c) {
  const reference = { id: "L", kind: "reference-occurrence", targetId: "T",
    token: "@Blackwoods", start: 6, end: 17 };
  const nodes = [
    { id: "N", parentId: "root", order: 0, label: "Thought N",
      ...canonical(c, BEFORE), references: [reference] },
    { id: "C", parentId: "N", order: 0, label: "Nested C",
      ...canonical(c, "Review the coding.") },
    { id: "T", parentId: "root", order: 1, label: "Blackwoods",
      ...canonical(c, "Supplier target.") },
    { id: "U", parentId: "root", order: 2, label: "Unrelated U",
      ...canonical(c, "Do not modify me.") },
  ];
  // L is an occurrence WITHIN the existing thought; not a synthetic tree line.
  const encoded = c.PocketStarlingBridgeShadow.encode({
    schema: "portal.mtt.web.v1", writtenAt: "2026-10-24T00:00:00.000Z",
    nodes, tombstones: [], rootExtras: {}, dataExtras: {},
  }, { capacity: 4 });
  assert.equal(encoded.ok, true, JSON.stringify(encoded));
  const built = c.PocketStarlingRootShadow.build(encoded.bridge);
  assert.equal(built.ok, true, JSON.stringify(built));
  const stager = c.PocketStarlingObjectSealShadow.createStager();
  const staged = c.PocketStarlingObjectSealShadow.stageCandidate(
    stager, built.state, { previousSealRef: null });
  assert.equal(staged.ok, true, JSON.stringify(staged));
  const accepted = c.PocketStarlingObjectSealShadow.auditCandidateSeal(
    staged.stage.sealRef, (ref) => stager.store.get(ref));
  assert.equal(accepted.ok, true, JSON.stringify(accepted));
  return { sealRef: staged.stage.sealRef, resolveLogical: (ref) => stager.store.get(ref) };
}

async function open(c, state) {
  const authority = await semanticBase(c, {
    acceptedSealRef: state.sealRef,
    resolveLogical: state.resolveLogical, syncedPocketId: POCKET,
  });
  const next = await c.PocketStarlingLogicalEditShadow.createBase({
    acceptedSealRef: state.sealRef, resolveLogical: state.resolveLogical, ...authority,
  });
  assert.equal(next.ok, true, JSON.stringify(next));
  return { ...state, base: next.base, ...authority, syncedPocketId: POCKET };
}

async function successor(c, current, candidate) {
  const semantic = c.PocketStarlingSemanticAuthorityShadow;
  const api = c.PocketStarlingLogicalEditShadow;
  const issued = await semantic.issueSuccessor({
    authority: current.semanticAuthority,
    semanticBaseProof: current.semanticBaseProof, candidate,
  });
  assert.equal(issued.ok, true, JSON.stringify(issued));
  const binding = api.semanticTransitionBinding(
    candidate, current.semanticAuthority, current.semanticBaseProof);
  assert.ok(binding);
  const validity = semantic.attestationForStage({
    authority: current.semanticAuthority, proof: issued.proof, binding,
  });
  assert.ok(validity);
  const authenticated = await semantic.authenticate({
    authority: current.semanticAuthority, semanticValidity: validity, binding,
  });
  assert.equal(authenticated.ok, true, JSON.stringify(authenticated));
  const resolveLogical = (ref) => candidate.resolveLogical(ref) ?? current.resolveLogical(ref);
  const next = await api.createBase({
    acceptedSealRef: candidate.sealRef, resolveLogical,
    syncedPocketId: POCKET, semanticAuthority: current.semanticAuthority,
    semanticBaseProof: authenticated.semanticBaseProof,
  });
  assert.equal(next.ok, true, JSON.stringify(next));
  return { ...current, sealRef: candidate.sealRef, resolveLogical,
    base: next.base, semanticBaseProof: authenticated.semanticBaseProof };
}

function snapshot(c, current) {
  const audited = c.PocketStarlingObjectSealShadow.auditCandidateSeal(
    current.sealRef, current.resolveLogical);
  assert.equal(audited.ok, true, JSON.stringify(audited));
  return audited.candidate;
}

function record(c, state, id) {
  const payload = c.PocketStarlingRootShadow.getContent(snapshot(c, state), id);
  assert.equal(payload.nodeId, id);
  return plain(payload.payload);
}

function text(c, payload) {
  const read = c.PocketNodeContent.readNode(payload);
  assert.equal(read.kind, "v2");
  assert.equal(read.readOnly, false);
  return read.text;
}

function reference(payload) {
  assert.equal(payload.references.length, 1);
  return plain(payload.references[0]);
}

function view(c, state, expanded) {
  // Recompute both projections from the SAME sealed semantic state, not caches.
  const audited = snapshot(c, state);
  const relation = c.PocketStarlingPlacementShadow.materialise(audited.structural);
  assert.equal(relation.ok, true, JSON.stringify(relation));
  const n = c.PocketStarlingRootShadow.getContent(audited, "N").payload;
  const result = { thoughtId: "N", text: text(c, n), link: reference(n),
    childIds: plain(relation.relation.children.N), targetId: "T" };
  if (expanded) result.children = result.childIds.map((id) => ({
    id, text: text(c, c.PocketStarlingRootShadow.getContent(audited, id).payload),
  }));
  return { result, relation: plain(relation.relation) };
}

function anchor() {
  return { start: 40, removed: "invoice", inserted: "payment" };
}

function event(props) {
  const body = { kind: "edit-text", ...props };
  return { ...body, digest: sha(body) };
}

// The proof witness is held only in this test. It is NOT a second Pocket journal.
// The accepted editor does not yet persist independent before-text inverse evidence.
function planInverse(c, current, history, eventId, revisions, permission) {
  const refuse = (reason) => Object.freeze({ ok: false, reason });
  if (!permission || permission.pocketId !== POCKET
      || permission.ownerId !== OWNER || permission.canEdit !== true)
    return refuse("unauthorised-resource");
  const matches = history.filter((item) => item.txId === eventId);
  if (matches.length !== 1) return refuse("absent-or-ambiguous-history");
  const op = matches[0];
  if (op.sourcePocketId !== permission.pocketId || op.ownerId !== permission.ownerId
      || op.nodeId !== "N" || op.kind !== "edit-text")
    return refuse("unauthorised-resource");
  const { digest, ...fields } = op;
  if (sha(fields) !== digest) return refuse("corrupt-history");
  if (!Number.isSafeInteger(op.baseRevision) || op.afterRevision !== op.baseRevision + 1
      || !Number.isSafeInteger(revisions.N) || revisions.N !== op.afterRevision
      || history.some((x) => x !== op && x.nodeId === "N" && x.globalRevision > op.globalRevision))
    return refuse("conflicting-newer-text");
  const a = op.anchor;
  if (!a || !Number.isSafeInteger(a.start) || a.start < 0
      || a.removed !== "invoice" || a.inserted !== "payment"
      || typeof op.beforeText !== "string" || typeof op.afterText !== "string"
      || op.beforeText.slice(a.start, a.start + a.removed.length) !== a.removed
      || op.afterText.slice(a.start, a.start + a.inserted.length) !== a.inserted
      || op.beforeText.indexOf(a.removed) !== a.start
      || op.beforeText.lastIndexOf(a.removed) !== a.start
      || op.afterText.indexOf(a.inserted) !== a.start
      || op.afterText.lastIndexOf(a.inserted) !== a.start
      || op.beforeText.slice(0, a.start) !== op.afterText.slice(0, a.start)
      || op.beforeText.slice(a.start + a.removed.length) !== op.afterText.slice(a.start + a.inserted.length))
    return refuse("ambiguous-anchor");
  const n = record(c, current, "N");
  if (text(c, n) !== op.afterText) return refuse("conflicting-newer-text");
  const next = c.PocketNodeContent.prepareCanonical(op.beforeText);
  if (!next.ok || !next.editor) return refuse("invalid-inverse-content");
  const payload = { ...n, editor: next.editor, details: next.details };
  return Object.freeze({ ok: true, operation: Object.freeze({
    type: "payload", input: Object.freeze({ nodeId: "N", payload }),
  }), inverseOf: op.txId });
}

function contentRef(c, state, id) {
  const root = JSON.parse(state.resolveLogical(
    JSON.parse(state.resolveLogical(state.sealRef)).rootRef));
  let ref = root.contentRef;
  for (const key of id) {
    const trie = JSON.parse(state.resolveLogical(ref));
    const next = trie.children.find((e) => e.key === key);
    assert.ok(next, id);
    ref = next.ref;
  }
  const trie = JSON.parse(state.resolveLogical(ref));
  assert.equal(trie.hasValue, true);
  return trie.valueRef;
}

async function prepared() {
  const c = runtime();
  const api = c.PocketStarlingLogicalEditShadow;
  const genesis = await open(c, fixture(c));
  const n0 = record(c, genesis, "N");
  const n1 = c.PocketNodeContent.prepareCanonical(AFTER);
  assert.equal(n1.ok, true);
  const change = await api.editPayload(genesis.base, "N", {
    ...n0, editor: n1.editor, details: n1.details,
  });
  assert.equal(change.ok, true, JSON.stringify(change));
  const afterN = await successor(c, genesis, change.candidate);
  const nEvent = event({
    txId: "op-N-text", nodeId: "N", sourcePocketId: POCKET, ownerId: OWNER,
    baseRevision: 1, afterRevision: 2, globalRevision: 1,
    beforeText: BEFORE, afterText: AFTER, anchor: anchor(),
  });

  const c0 = record(c, afterN, "C");
  const c1text = "Review the coding and notify AP.";
  const c1 = c.PocketNodeContent.prepareCanonical(c1text);
  const independent = await api.editPayload(afterN.base, "C", {
    ...c0, editor: c1.editor, details: c1.details,
  });
  assert.equal(independent.ok, true, JSON.stringify(independent));
  const afterC = await successor(c, afterN, independent.candidate);
  const cEvent = event({
    txId: "op-C-text", nodeId: "C", sourcePocketId: POCKET, ownerId: OWNER,
    baseRevision: 1, afterRevision: 2, globalRevision: 2,
    beforeText: text(c, c0), afterText: c1text, anchor: null,
  });
  const history = [nEvent, cEvent], revisions = { N: 2, C: 2, T: 1, U: 1 };
  const permission = { pocketId: POCKET, ownerId: OWNER, canEdit: true };
  return { c, api, genesis, afterN, afterC, history, revisions, permission, c1text };
}

test("Linked-fractal proof is source-locked and changes only this disposable test", () => {
  assert.equal(git("merge-base", "HEAD", "origin/main"), ACCEPTED);
  assert.deepEqual(git("diff", "--name-only", ACCEPTED, "HEAD").split("\n"), [SELF]);
  for (const file of SCRIPTS) {
    const actual = fs.readFileSync(path.join(ROOT, file));
    const accepted = execFileSync("git", ["show", ACCEPTED + ":" + file], { cwd: ROOT });
    assert.deepEqual(actual, accepted, "unchanged accepted source: " + file);
  }
});

test("N edit, independent C edit, scoped N inverse and matching depth projections", async () => {
  const h = await prepared();
  const { c, api, genesis, afterN, afterC, history, revisions, permission } = h;
  assert.equal(text(c, record(c, genesis, "N")), BEFORE);
  assert.equal(text(c, record(c, afterN, "N")), AFTER);
  assert.equal(text(c, record(c, afterC, "C")), h.c1text);
  const beforeUndoLink = reference(record(c, afterC, "N"));
  assert.deepEqual(beforeUndoLink, {
    id: "L", kind: "reference-occurrence", targetId: "T",
    token: "@Blackwoods", start: 6, end: 17,
  });
  assert.equal(AFTER.slice(beforeUndoLink.start, beforeUndoLink.end), beforeUndoLink.token);

  const planned = planInverse(c, afterC, history, "op-N-text", revisions, permission);
  assert.equal(planned.ok, true, planned.reason);
  assert.deepEqual(Object.keys(planned.operation), ["type", "input"]);
  assert.equal(planned.operation.input.nodeId, "N");
  // Inverse is applied through the EXISTING semantic edit owner, never a snapshot.
  const undo = await api.compose(afterC.base, [planned.operation]);
  assert.equal(undo.ok, true, JSON.stringify(undo));
  const afterUndo = await successor(c, afterC, undo.candidate);
  const inverseEvent = event({
    txId: "op-inverse-N", nodeId: "N", sourcePocketId: POCKET, ownerId: OWNER,
    baseRevision: 2, afterRevision: 3, globalRevision: 3,
    beforeText: AFTER, afterText: BEFORE, anchor: null, inverseOf: planned.inverseOf,
  });
  const fullHistory = [...history, inverseEvent];
  assert.equal(fullHistory.length, 3);
  assert.equal(fullHistory[0].txId, "op-N-text");
  assert.equal(fullHistory[2].inverseOf, fullHistory[0].txId);
  assert.equal(text(c, record(c, afterUndo, "N")), BEFORE);
  assert.equal(text(c, record(c, afterUndo, "C")), h.c1text);
  assert.deepEqual(reference(record(c, afterUndo, "N")), beforeUndoLink);
  for (const id of ["T", "U"]) {
    assert.deepEqual(record(c, afterUndo, id), record(c, genesis, id));
    assert.equal(contentRef(c, afterUndo, id), contentRef(c, genesis, id));
  }
  assert.equal(contentRef(c, afterUndo, "C"), contentRef(c, afterC, "C"));

  const initialRoot = JSON.parse(genesis.resolveLogical(
    JSON.parse(genesis.resolveLogical(genesis.sealRef)).rootRef));
  const finalRoot = JSON.parse(afterUndo.resolveLogical(
    JSON.parse(afterUndo.resolveLogical(afterUndo.sealRef)).rootRef));
  for (const field of ["placementRef", "childrenRef", "preservationRef"]) {
    assert.equal(finalRoot[field], initialRoot[field], field);
  }
  const collapsed = view(c, afterUndo, false);
  const expanded = view(c, afterUndo, true);
  assert.equal(collapsed.result.text, expanded.result.text);
  assert.equal(collapsed.result.text, BEFORE);
  assert.deepEqual(collapsed.result.link, expanded.result.link);
  assert.deepEqual(collapsed.relation, expanded.relation);
  assert.deepEqual(expanded.result.childIds, ["C"]);
  assert.deepEqual(expanded.result.children, [{ id: "C", text: h.c1text }]);
  assert.equal(expanded.relation.parents.C, "N");
  assert.deepEqual(expanded.relation.children.root, ["N", "T", "U"]);
  assert.deepEqual(Object.keys(record(c, afterUndo, "N")).filter((k) => k === "editor"), ["editor"]);
  assert.equal(undo.candidate.resolveLogical(genesis.sealRef), undefined);
});

test("Missing, duplicated, corrupted, conflicting and unauthorised inverses refuse without mutation", async (t) => {
  const h = await prepared();
  const { c, api, afterC, history, revisions, permission } = h;
  async function refused(label, change, reason) {
    await t.test(label, async () => {
      const input = { history: history.map(plain), revisions: { ...revisions },
        permission: { ...permission }, current: afterC };
      await change(input);
      const before = JSON.stringify({
        currentSeal: input.current.sealRef, history: input.history,
        revisions: input.revisions, permission: input.permission,
        n: record(c, input.current, "N"), child: record(c, input.current, "C"),
        u: record(c, input.current, "U"),
      });
      const result = planInverse(c, input.current, input.history,
        "op-N-text", input.revisions, input.permission);
      assert.deepEqual(plain(result), { ok: false, reason });
      assert.equal(JSON.stringify({
        currentSeal: input.current.sealRef, history: input.history,
        revisions: input.revisions, permission: input.permission,
        n: record(c, input.current, "N"), child: record(c, input.current, "C"),
        u: record(c, input.current, "U"),
      }), before, "a denied plan must have zero mutation");
      assert.equal("operation" in result, false);
      assert.equal("candidate" in result, false);
    });
  }
  await refused("absent witness", (x) => { x.history = [x.history[1]]; },
    "absent-or-ambiguous-history");
  await refused("duplicate witness", (x) => { x.history.push(plain(x.history[0])); },
    "absent-or-ambiguous-history");
  await refused("corrupted before-text evidence", (x) => { x.history[0].beforeText = "tampered"; },
    "corrupt-history");
  await refused("tampered anchor that recomputes integrity digest", (x) => {
    x.history[0].anchor.start = 0;
    const { digest, ...body } = x.history[0]; x.history[0].digest = sha(body);
  }, "ambiguous-anchor");
  await refused("wrong Pocket", (x) => { x.permission.pocketId = "another-pocket"; },
    "unauthorised-resource");
  await refused("unauthorised writer", (x) => { x.permission.canEdit = false; },
    "unauthorised-resource");
  await refused("witness source mismatch", (x) => {
    x.history[0].sourcePocketId = "another-pocket";
    const { digest, ...body } = x.history[0]; x.history[0].digest = sha(body);
  }, "unauthorised-resource");
  await refused("N revision advanced", (x) => { x.revisions.N += 1; },
    "conflicting-newer-text");
  await refused("newer N transaction despite independent C change", (x) => {
    x.history.push(event({ txId: "later-N", nodeId: "N", sourcePocketId: POCKET,
      ownerId: OWNER, baseRevision: 2, afterRevision: 3, globalRevision: 3,
      beforeText: AFTER, afterText: AFTER + " again", anchor: null }));
  }, "conflicting-newer-text");
  await refused("actual newer N edit", async (x) => {
    const n = record(c, afterC, "N");
    const newer = c.PocketNodeContent.prepareCanonical(AFTER + " again");
    const changed = await api.editPayload(afterC.base, "N", {
      ...n, editor: newer.editor, details: newer.details,
    });
    assert.equal(changed.ok, true, JSON.stringify(changed));
    x.current = await successor(c, afterC, changed.candidate);
  }, "conflicting-newer-text");
});
