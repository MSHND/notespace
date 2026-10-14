"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const ROOT = path.resolve(__dirname, "..");
const source = (file) => fs.readFileSync(path.join(ROOT, file), "utf8");
const plain = (value) => JSON.parse(JSON.stringify(value));

// Accepted fixture readers do NOT register their other tests.
function accepted(file, exports) {
  const filename = path.join(__dirname, file);
  const content = fs.readFileSync(filename, "utf8");
  const declaration = 'const test = require("node:test");';
  assert.ok(content.includes(declaration), file + " fixture shape");
  const m = { exports: {} };
  new Function("require", "module", "exports", "__filename", "__dirname",
    content.replace(declaration, "const test = () => {};")
    + "\nmodule.exports = { " + exports.join(", ") + " };\n")(
      require, m, m.exports, filename, __dirname);
  return m.exports;
}
const { rig, install, newSession, assertUnchanged } = accepted(
  "p376-authenticated-knowledge-connection.test.js",
  ["rig", "install", "newSession", "assertUnchanged"]);
const { harness, instrumentation, entry, row, childGroup, childStatus, ids, snapshotMain } = accepted(
  "p373-progressive-main-presentation.test.js",
  ["harness", "instrumentation", "entry", "row", "childGroup", "childStatus", "ids", "snapshotMain"]);

function bridgeFor(v, knowledgeSession, isAttemptCurrent = () => true, mount = v.mount) {
  vm.runInContext(source("js/pocket-progressive-open-presentation-connection.js"), v.h.context);
  return v.h.context.PocketProgressiveOpenPresentationConnection.createBridge({
    knowledgeSession, mount, createPresentation: v.h.context.createProgressiveMainPresentation,
    isAttemptCurrent,
  });
}
function view() {
  const result = harness();
  result.h.materialise();
  return { ...result, initialMain: snapshotMain(result.h),
    mainNodes: result.h.context.state.nodes, mainTree: result.h.treeRoot,
    originalMainRow: result.h.rowFor("Parent") };
}
function verifyMain(v) {
  assert.equal(snapshotMain(v.h), v.initialMain);
  assert.strictEqual(v.h.context.state.nodes, v.mainNodes);
  assert.strictEqual(v.h.treeRoot, v.mainTree);
  assert.strictEqual(v.h.rowFor("Parent"), v.originalMainRow);
}
function verifyRoot(mount, seal) {
  assert.deepEqual(ids(mount), ["parent", "sibling"]);
  assert.equal(mount.getAttribute("data-pocket-scope"), "incomplete");
  assert.equal(mount.getAttribute("data-accepted-seal-ref"), seal);
  for (const id of ["parent", "sibling"]) {
    const branch = entry(mount, id);
    assert.ok(branch, "known top-level row " + id);
    assert.equal(childStatus(branch).getAttribute("data-children-state"), "unresolved");
    assert.equal(childStatus(branch).textContent, "Children not loaded");
    assert.deepEqual(ids(childGroup(branch)), []);
    const readonly = row(branch);
    assert.equal(readonly.getAttribute("aria-disabled"), "true");
    assert.equal(readonly.tabIndex, -1);
    assert.equal(readonly.listeners.size, 0, "no action, context-menu or copy listeners");
  }
  assert.equal(entry(mount, "deep"), null);
  assert.equal(entry(mount, "deeper"), null);
}
function sourceShape(session) {
  const source = session.currentSource();
  assert.ok(source);
  assert.ok(Object.isFrozen(source));
  assert.deepEqual(Object.keys(source).sort(), [
    "acceptedSealRef", "authorityRevision", "headRevision",
    "headSealStorageRef", "syncedPocketId",
  ]);
  return source;
}

test("P377 genuine P124 -> P368 -> P375 -> P376/P370 -> P377 -> real P373 DOM before materialisation", async () => {
  const r = await rig();
  install(r.c);
  const session = newSession(r.c);
  const v = view(), b = bridgeFor(v, session, () => true, v.mount);
  assert.deepEqual(Object.keys(b).sort(), ["attachCurrent", "dispose", "refresh"]);
  assert.equal(v.mount.childNodes.length, 0, "dormant factory does not touch the DOM");
  assert.equal(b.attachCurrent().ok, false, "no P376 admitted root yet");
  let presented = 0, logicalSeal;
  r.onHook(async (reader, identity, targetCurrent) => {
    assert.equal(r.materialized, 0);
    assert.strictEqual(r.readerInputs[0], r.sessions[0]);
    assert.strictEqual(reader, r.callbackReader);
    await session.onScopedStarlingReader(reader, identity, targetCurrent);
    const pinned = sourceShape(session);
    assert.equal(pinned.acceptedSealRef, reader.acceptedSealRef);
    assert.equal(pinned.headSealStorageRef, r.remote.head.sealRef);
    assert.notEqual(pinned.headSealStorageRef, pinned.acceptedSealRef);
    logicalSeal = pinned.acceptedSealRef;
    const root = session.inspect("root");
    assert.equal(root.childrenState, "ready");
    assert.equal(root.scope, "incomplete");
    assert.deepEqual(plain(root.childIds), ["parent", "sibling"]);
    assert.equal(session.inspect("deep"), null);
    const paint = b.attachCurrent();
    assert.equal(paint.ok, true, JSON.stringify(paint));
    assert.equal(paint.alreadyAttached, false);
    verifyRoot(v.mount, logicalSeal);
    verifyMain(v);
    assertUnchanged(r);
    assert.equal(r.materialized, 0, "real DOM projected before full materialisation");
    r.timeline.push("p377-real-mounted");
    presented += 1;
  });
  assert.equal((await r.opener().openExisting(r.dependencies)).ok, true);
  assert.equal(presented, 1, "bypassing the new P377 bridge fails this witness");
  assert.equal(r.readerBuilds, 1);
  assert.equal(r.materialized, 1);
  assert.equal(r.adopted, 1);
  assert.ok(r.timeline.indexOf("p124-authenticated") < r.timeline.indexOf("p368-enter"));
  assert.ok(r.timeline.indexOf("p368-enter") < r.timeline.indexOf("scoped-hook"));
  assert.ok(r.timeline.indexOf("scoped-hook") < r.timeline.indexOf("p377-real-mounted"));
  assert.ok(r.timeline.indexOf("p377-real-mounted") < r.timeline.indexOf("full-materialize"));
  assert.ok(r.timeline.indexOf("full-materialize") < r.timeline.indexOf("adopt"));
  verifyRoot(v.mount, logicalSeal);
  verifyMain(v);
  assert.equal(r.remoteCalls.some(x=>["compareAndSetShadowHead","putOpaqueObject"].includes(x[0])), false);
  console.log("P377_REAL_CHAIN " + JSON.stringify({
    rootIds: ids(v.mount), scope: "incomplete", materialisationsBeforePaint: 0,
    realP373: true, separateMount: v.mount !== v.mainTree,
  }));
});

test("P377 parent-scoped refresh after explicit P376 read retains branch/row/focus/scroll and bounded DOM work", async () => {
  const r = await rig(); install(r.c);
  const session = newSession(r.c), v = view(), b = bridgeFor(v, session);
  r.onHook(async (reader, source, targetCurrent) => {
    await session.onScopedStarlingReader(reader, source, targetCurrent);
    assert.equal(b.attachCurrent().ok, true);
    const parent = entry(v.mount, "parent"), sibling = entry(v.mount, "sibling");
    const parentRow = row(parent), siblingRow = row(sibling);
    const unrelatedGroup = childGroup(sibling);
    const mainRow = v.originalMainRow;
    mainRow.focus();
    v.mount.scrollTop = 61;
    const focus = v.h.document.activeElement;
    const read = await session.requestChildren("parent");
    assert.equal(read.ok, true);
    assert.deepEqual(plain(read.childIds), ["deep"]);
    assert.equal(r.materialized, 0);
    const measure = instrumentation(v.h);
    measure.begin();
    const projection = b.refresh("parent");
    const counts = measure.end();
    assert.equal(projection.ok, true);
    assert.equal(projection.childrenState, "ready");
    assert.equal(projection.parentId, "parent");
    assert.deepEqual(ids(childGroup(parent)), ["deep"]);
    assert.equal(childStatus(entry(childGroup(parent), "deep")).getAttribute("data-children-state"), "unresolved");
    assert.equal(session.inspect("deeper"), null);
    assert.strictEqual(entry(v.mount, "parent"), parent);
    assert.strictEqual(entry(v.mount, "sibling"), sibling);
    assert.strictEqual(row(parent), parentRow);
    assert.strictEqual(row(sibling), siblingRow);
    assert.strictEqual(childGroup(sibling), unrelatedGroup);
    assert.deepEqual(ids(childGroup(sibling)), []);
    assert.strictEqual(v.h.document.activeElement, focus);
    assert.equal(v.mount.scrollTop, 61);
    assert.equal(counts.create, 5, "one new child branch, no full tree rebuild");
    assert.equal(counts.remove, 0);
    assert.equal(counts.queries, 0);
    assert.equal(counts.fullRender, 0);
    assert.equal(counts.focus, 0);
    verifyMain(v);
    assertUnchanged(r);
    console.log("P377_PARENT_LOCAL " + JSON.stringify({
      childIds: ids(childGroup(parent)), create: counts.create,
      remove: counts.remove, queries: counts.queries, fullRender: counts.fullRender,
      focusChanges: counts.focus, siblingIdentityPreserved: true,
      scrollTop: v.mount.scrollTop, fullMaterialisations: r.materialized,
    }));
  });
  assert.equal((await r.opener().openExisting(r.dependencies)).ok, true);
});

test("P377 SAME exact source attachment neither remounts nor mutates any row", async () => {
  const r = await rig(); install(r.c);
  const session = newSession(r.c), v = view(), b = bridgeFor(v, session);
  r.onHook(async (reader, source, targetCurrent) => {
    await session.onScopedStarlingReader(reader, source, targetCurrent);
    const pinned = session.currentSource();
    assert.equal(b.attachCurrent().ok, true);
    assert.strictEqual(session.currentSource(), pinned, "P376 retains exact frozen object");
    const parent = entry(v.mount, "parent"), sibling = entry(v.mount, "sibling");
    v.originalMainRow.focus(); v.mount.scrollTop = 79;
    const focus = v.h.document.activeElement, measure = instrumentation(v.h);
    measure.begin();
    const repeat = b.attachCurrent();
    const work = measure.end();
    assert.equal(repeat.ok, true);
    assert.equal(repeat.alreadyAttached, true);
    assert.deepEqual(work, { create: 0, append: 0, remove: 0,
      attributes: 0, text: 0, queries: 0, focus: 0, fullRender: 0 });
    assert.strictEqual(entry(v.mount, "parent"), parent);
    assert.strictEqual(entry(v.mount, "sibling"), sibling);
    assert.strictEqual(v.h.document.activeElement, focus);
    assert.equal(v.mount.scrollTop, 79);
    verifyMain(v);
  });
  assert.equal((await r.opener().openExisting(r.dependencies)).ok, true);
});

test("P377 before-ready, incorrect root/Seal, missing guard and failed real P373 projection fail closed", async () => {
  const r = await rig(); install(r.c);
  const session = newSession(r.c), v = view(), b = bridgeFor(v, session);
  assert.equal(b.attachCurrent().ok, false);
  assert.equal(v.mount.childNodes.length, 0);
  assert.throws(() => v.h.context.PocketProgressiveOpenPresentationConnection.createBridge({
    knowledgeSession: session, mount: v.mount,
    createPresentation: v.h.context.createProgressiveMainPresentation,
  }), /attempt guard/);
  assert.equal(bridgeFor(view(), session, () => false).attachCurrent().ok, false);
  const pinned = Object.freeze({ acceptedSealRef: "correct" });
  const badKnowledge = {
    currentSource: () => pinned,
    inspect: () => ({ scope: "incomplete", id: "root", reached: true,
      node: null, childrenState: "ready", childIds: [], acceptedSealRef: "wrong" }),
  };
  const wrong = bridgeFor(v, badKnowledge);
  assert.equal(wrong.attachCurrent().ok, false);
  assert.equal(v.mount.childNodes.length, 0);
  // Exercise a REAL P373 mounting failure with the actual authenticated root.
  r.onHook(async (reader, source, targetCurrent) => {
    await session.onScopedStarlingReader(reader, source, targetCurrent);
    const create = v.h.document.createElement;
    v.h.document.createElement = () => { throw Error("DOM unavailable during projection"); };
    try {
      const result = b.attachCurrent();
      assert.equal(result.ok, false);
      assert.equal(result.reason, "root-projection-failed");
      assert.equal(v.mount.childNodes.length, 0);
      assert.equal(session.inspect("root").childrenState, "ready");
      verifyMain(v);
    } finally { v.h.document.createElement = create; }
  });
  assert.equal((await r.opener().openExisting(r.dependencies)).ok, true);
});

test("P377 invalidated caller attempt and retired P376 deny later DOM changes without erasing painted content", async () => {
  const r = await rig(); install(r.c);
  const session = newSession(r.c), v = view();
  let attemptCurrent = true;
  const b = bridgeFor(v, session, () => attemptCurrent);
  r.onHook(async (reader, source, targetCurrent) => {
    await session.onScopedStarlingReader(reader, source, targetCurrent);
    assert.equal(b.attachCurrent().ok, true);
    const parent = entry(v.mount, "parent");
    const measure = instrumentation(v.h);
    attemptCurrent = false;
    measure.begin();
    assert.equal(b.refresh("parent").ok, false);
    assert.equal(b.attachCurrent().ok, false);
    const staleWork = measure.end();
    assert.deepEqual(staleWork, { create: 0, append: 0, remove: 0,
      attributes: 0, text: 0, queries: 0, focus: 0, fullRender: 0 });
    assert.strictEqual(entry(v.mount, "parent"), parent,
      "P373 does not clear painted DOM on invalidation");
    attemptCurrent = true;
    assert.equal(session.retire(), true);
    assert.equal(b.refresh("parent").ok, false);
    assert.equal(b.attachCurrent().ok, false);
    assert.strictEqual(entry(v.mount, "parent"), parent);
    assert.equal(b.dispose(), true);
    assert.equal(b.dispose(), false);
    assert.equal(b.refresh("parent").ok, false);
    assert.strictEqual(entry(v.mount, "parent"), parent);
    verifyMain(v);
  });
  assert.equal((await r.opener().openExisting(r.dependencies)).ok, true);
});

test("P377 SAME-SEAL later P376 generation replaces DOM; old model cannot repaint", async () => {
  const r = await rig(); install(r.c);
  const session = newSession(r.c), v = view(), b = bridgeFor(v, session);
  r.onHook(async (reader, source, targetCurrent) => {
    await session.onScopedStarlingReader(reader, source, targetCurrent);
    const beforeSource = sourceShape(session);
    assert.equal(b.attachCurrent().ok, true);
    const beforeRow = row(entry(v.mount, "parent")), beforeBranch = entry(v.mount, "parent");
    await session.onScopedStarlingReader(reader, source, targetCurrent);
    const afterSource = sourceShape(session);
    assert.notStrictEqual(afterSource, beforeSource,
      "P376's same-Seal selection still creates a new frozen source object");
    assert.equal(afterSource.acceptedSealRef, beforeSource.acceptedSealRef);
    assert.equal(b.refresh("parent").ok, false, "previous P373 generation is stale");
    const projection = b.attachCurrent();
    assert.equal(projection.ok, true);
    assert.equal(projection.alreadyAttached, false);
    assert.notStrictEqual(entry(v.mount, "parent"), beforeBranch);
    assert.notStrictEqual(row(entry(v.mount, "parent")), beforeRow);
    verifyRoot(v.mount, afterSource.acceptedSealRef);
    verifyMain(v);
  });
  assert.equal((await r.opener().openExisting(r.dependencies)).ok, true);
});

test("P377 previous bridge cannot disturb another bridge's new mount owner, including late disposal", async () => {
  const r = await rig(); install(r.c);
  const session = newSession(r.c), v = view();
  const old = bridgeFor(v, session);
  const newer = bridgeFor(v, session);
  r.onHook(async (reader, source, targetCurrent) => {
    await session.onScopedStarlingReader(reader, source, targetCurrent);
    assert.equal(old.attachCurrent().ok, true);
    const oldRow = entry(v.mount, "parent");
    assert.equal(newer.attachCurrent().ok, true);
    const latest = entry(v.mount, "parent");
    assert.notStrictEqual(latest, oldRow);
    const measure = instrumentation(v.h);
    measure.begin();
    assert.equal(old.refresh("root").ok, false);
    const cannotSteal = old.attachCurrent();
    assert.equal(cannotSteal.ok, false, "lost P373 token must not be silently reacquired");
    assert.equal(old.dispose(), true);
    assert.equal(old.dispose(), false);
    const work = measure.end();
    assert.deepEqual(work, { create: 0, append: 0, remove: 0,
      attributes: 0, text: 0, queries: 0, focus: 0, fullRender: 0 });
    assert.strictEqual(entry(v.mount, "parent"), latest);
    assert.equal(newer.refresh("root").ok, true);
    verifyMain(v);
  });
  assert.equal((await r.opener().openExisting(r.dependencies)).ok, true);
});

test("P377 failed later P376 selection cannot claim previous rows as current", async () => {
  const r = await rig(); install(r.c);
  const session = newSession(r.c), v = view(), b = bridgeFor(v, session);
  r.onHook(async (reader, source, targetCurrent) => {
    await session.onScopedStarlingReader(reader, source, targetCurrent);
    assert.equal(b.attachCurrent().ok, true);
    const oldRow = entry(v.mount, "parent");
    const rejectedReader = {
      ok: true, scope: "incomplete", acceptedSealRef: reader.acceptedSealRef,
      readReachedNode() {},
      async readChildren(parentId) { return { ok: false, scope: "incomplete", parentId, reason: "later-invalid" }; },
    };
    await assert.rejects(session.onScopedStarlingReader(rejectedReader, source, targetCurrent));
    assert.equal(session.currentSource(), null);
    const measure = instrumentation(v.h);
    measure.begin();
    assert.equal(b.refresh("root").ok, false);
    assert.equal(b.attachCurrent().ok, false);
    const metrics = measure.end();
    assert.deepEqual(metrics, { create: 0, append: 0, remove: 0,
      attributes: 0, text: 0, queries: 0, focus: 0, fullRender: 0 });
    assert.strictEqual(entry(v.mount, "parent"), oldRow,
      "P373 does not erase obsolete DOM; future preview host must hide it");
    verifyMain(v);
    assertUnchanged(r);
  });
  assert.equal((await r.opener().openExisting(r.dependencies)).ok, true,
    "P375 awaited callback was already successful before the later private selection");
});

test("P377 no composition and legacy whole-record preserve existing Open and production dormancy", async () => {
  const a = await rig(); install(a.c);
  const v = view();
  vm.runInContext(source("js/pocket-progressive-open-presentation-connection.js"), v.h.context);
  assert.equal(a.dependencies.onScopedStarlingReader, undefined);
  assert.equal(v.mount.childNodes.length, 0);
  assert.equal((await a.opener().openExisting(a.dependencies)).ok, true);
  assert.equal(a.readerBuilds, 0);
  assert.equal(a.materialized, 1);
  assert.equal(v.mount.childNodes.length, 0);

  const b = await rig({ mode: "whole-record" }); install(b.c);
  b.config.crypto = Object.freeze({
    ...b.c.PocketSyncCrypto,
    async openContent() { return { schema: "portal.export.v1", source: "whole-record" }; },
  });
  const session = newSession(b.c), bridge = bridgeFor(v, session);
  let callbacks = 0;
  b.onHook((reader, source, targetCurrent) => {
    callbacks += 1;
    return session.onScopedStarlingReader(reader, source, targetCurrent);
  });
  assert.equal((await b.opener().openExisting(b.dependencies)).ok, true);
  assert.equal(callbacks, 0);
  assert.equal(b.readerBuilds, 0);
  assert.equal(bridge.attachCurrent().ok, false);
  assert.equal(v.mount.childNodes.length, 0);
  for (const file of [
    "index.html", "js/pocket-sync-ui.js", "js/pocket-sync-browser-runtime.js",
    "js/pocket-sync-local-integration.js", "js/pocket-sync-additional-device.js",
    "sync-service/pocket-sync-production-server.js",
  ]) {
    assert.doesNotMatch(source(file),
      /PocketProgressiveOpenPresentationConnection|pocket-progressive-open-presentation-connection\.js/);
  }
  assert.doesNotMatch(source("js/pocket-progressive-open-presentation-connection.js"),
    /\b(?:requestChildren|snapshot|saveCurrentContext|adoptOpenedPocket|renderTree|fetch)\s*\(/);
  verifyMain(v);
});
