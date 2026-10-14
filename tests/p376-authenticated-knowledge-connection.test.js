"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const ROOT = path.resolve(__dirname, "..");
const source = (f) => fs.readFileSync(path.join(ROOT, f), "utf8");
const plain = (v) => JSON.parse(JSON.stringify(v));

// Reuse accepted P375 -> P124/P368 fixtures without registering the prior
// test suites. This exercises the ACTUAL additional-device callback.
function fixture() {
  const file = path.join(__dirname, "p375-starling-scoped-open-handoff.test.js");
  const original = fs.readFileSync(file, "utf8");
  const declaration = 'const test = require("node:test");';
  assert.ok(original.includes(declaration), "accepted P375 fixture");
  const module = { exports: {} };
  new Function("require", "module", "exports", "__filename", "__dirname",
    original.replace(declaration, "const test = () => {};")
      + "\nmodule.exports = { rig, noObserverAuthorityEffects };\n")(
        require, module, module.exports, file, __dirname);
  return module.exports;
}
const { rig, noObserverAuthorityEffects } = fixture();
const fail = (reason) => ({ ok: false, scope: "incomplete", parentId: "root", reason });

function install(c) {
  vm.runInContext(source("js/pocket-progressive-open-state.js"), c);
  vm.runInContext(source("js/pocket-progressive-open-connection.js"), c);
  assert.equal(typeof c.PocketProgressiveOpenConnection?.createSession, "function");
  return c.PocketProgressiveOpenConnection;
}
function newSession(c, guard = () => true) {
  return c.PocketProgressiveOpenConnection.createSession({ isAttemptCurrent: guard });
}
function checkRoot(session, seal) {
  const root = session.inspect("root");
  assert.equal(root.scope, "incomplete");
  assert.equal(root.acceptedSealRef, seal);
  assert.equal(root.childrenState, "ready");
  assert.deepEqual(plain(root.childIds), ["parent", "sibling"]);
  const parent = session.inspect("parent"), sibling = session.inspect("sibling");
  assert.equal(parent.childrenState, "unresolved");
  assert.equal(sibling.childrenState, "unresolved");
  assert.equal(parent.childIds, null);
  assert.equal(sibling.childIds, null);
  assert.equal(session.inspect("deep"), null);
  assert.equal(session.inspect("deeper"), null);
}
function assertUnchanged(r) {
  noObserverAuthorityEffects(r);
  assert.strictEqual(r.mainState.nodes, r.mainTruth.nodesRef);
  assert.equal(JSON.stringify(r.mainState.nodes), r.mainTruth.nodes);
}

test("P376 real P124 -> P368 -> P375 -> P370 reaches ordered root before whole materialisation", async () => {
  const r = await rig(), connect = install(r.c);
  const session = connect.createSession({ isAttemptCurrent: () => true });
  assert.deepEqual(Object.keys(session).sort(), [
    "currentSource", "inspect", "onScopedStarlingReader", "requestChildren", "retire",
  ]);
  assert.equal(session.inspect("root"), null);
  let reached = 0, rootBeforeFull = false;
  r.onHook(async (reader, source, isCurrent) => {
    assert.strictEqual(reader, r.callbackReader);
    assert.strictEqual(r.readerInputs[0], r.sessions[0]);
    assert.equal(r.materialized, 0);
    await session.onScopedStarlingReader(reader, source, isCurrent);
    reached += 1;
    checkRoot(session, reader.acceptedSealRef);
    const retained = session.currentSource();
    assert.equal(retained.scope, undefined);
    assert.equal(retained.syncedPocketId, "p124");
    assert.equal(retained.authorityRevision, 7);
    assert.equal(retained.headRevision, 1);
    assert.equal(retained.headSealStorageRef, r.remote.head.sealRef);
    assert.equal(retained.acceptedSealRef, reader.acceptedSealRef);
    assert.notEqual(retained.headSealStorageRef, retained.acceptedSealRef);
    assert.ok(Object.isFrozen(retained));
    assert.deepEqual(Object.keys(retained).sort(), [
      "acceptedSealRef", "authorityRevision", "headRevision",
      "headSealStorageRef", "syncedPocketId",
    ]);
    assert.equal(Object.hasOwn(session, "reader"), false);
    assert.equal(Object.hasOwn(session, "knowledge"), false);
    assert.equal(Object.hasOwn(session, "masterKey"), false);
    assert.equal(Object.hasOwn(session, "adoptOpenedPocket"), false);
    assert.equal(r.materialized, 0);
    rootBeforeFull = true;
    r.timeline.push("p376-root-current");
    assertUnchanged(r);
  });
  const open = await r.opener().openExisting(r.dependencies);
  assert.equal(open.ok, true, JSON.stringify(open));
  assert.equal(reached, 1);
  assert.equal(rootBeforeFull, true);
  assert.equal(r.readerBuilds, 1);
  assert.equal(r.materialized, 1);
  assert.equal(r.adopted, 1);
  assert.ok(r.timeline.indexOf("p376-root-current") < r.timeline.indexOf("full-materialize"));
  assert.ok(r.timeline.indexOf("full-materialize") < r.timeline.indexOf("adopt"));
  assert.equal(r.remoteCalls.filter(x => x[0] === "readShadowHead").length, 1);
  assert.equal(r.remoteCalls.some(x => ["putOpaqueObject", "compareAndSetShadowHead"].includes(x[0])), false);
  assert.equal(JSON.stringify(r.mainState.nodes), r.mainTruth.nodes);
  console.log("P376_REAL_CHAIN " + JSON.stringify({
    rootIds: ["parent", "sibling"], descendantState: "unresolved",
    materialisationsBeforeRoot: 0, materialisationsAfter: r.materialized,
  }));
});

test("P376 one reached-parent scoped read stays local, preserves unrelated truth and caches ready result", async () => {
  const r = await rig();
  install(r.c);
  const session = newSession(r.c);
  r.onHook(async (reader, source, guard) => {
    await session.onScopedStarlingReader(reader, source, guard);
    const sibling = plain(session.inspect("sibling"));
    const parent = session.inspect("parent");
    assert.equal(parent.childrenState, "unresolved");
    const before = r.remoteCalls.filter(x => x[0] === "getOpaqueObject").length;
    const read = await session.requestChildren("parent");
    assert.equal(read.ok, true);
    assert.deepEqual(plain(read.childIds), ["deep"]);
    assert.equal(session.inspect("parent").childrenState, "ready");
    assert.equal(session.inspect("deep").childrenState, "unresolved");
    assert.equal(session.inspect("deeper"), null);
    assert.deepEqual(plain(session.inspect("sibling")), sibling,
      "unrelated reached sibling unchanged");
    const after = r.remoteCalls.filter(x => x[0] === "getOpaqueObject").length;
    assert.ok(after >= before);
    const repeat = await session.requestChildren("parent");
    assert.equal(repeat.ok, true);
    assert.deepEqual(plain(repeat.childIds), ["deep"]);
    assert.equal(r.remoteCalls.filter(x => x[0] === "getOpaqueObject").length, after,
      "ready request does not repeat physical reads");
    assert.equal(r.materialized, 0);
    assertUnchanged(r);
    console.log("P376_SCOPED_PARENT " + JSON.stringify({
      parent: "parent", reachedChildren: ["deep"],
      siblingUnchanged: true, fullMaterialisations: r.materialized,
      physicalGetsBefore: before, physicalGetsAfter: after, repeatedReadyGets: 0,
    }));
  });
  assert.equal((await r.opener().openExisting(r.dependencies)).ok, true);
  assert.equal(r.adopted, 1);
});

test("P376 invalid attempt guard, reader/Seal mismatch and missing P370 fail closed", async () => {
  const r = await rig();
  install(r.c);
  assert.throws(() => r.c.PocketProgressiveOpenConnection.createSession({}),
    /caller-owned attempt eligibility/);
  const stale = newSession(r.c, () => false);
  let observerCalls = 0;
  r.onHook(async (reader, source, guard) => {
    observerCalls += 1;
    await stale.onScopedStarlingReader(reader, source, guard);
  });
  const opened = await r.opener().openExisting(r.dependencies);
  assert.equal(opened.ok, false);
  assert.equal(observerCalls, 1);
  assert.equal(stale.currentSource(), null);
  assert.equal(r.materialized, 0);
  assertUnchanged(r);

  const mismatched = newSession(r.c);
  const dummyReader = {
    ok: true, scope: "incomplete", acceptedSealRef: "logical-a",
    readChildren() { throw Error("must not read mismatched source"); },
    readReachedNode() {},
  };
  const identity = { syncedPocketId: "p124", authorityRevision: 7,
    headRevision: 1, headSealStorageRef: "physical", acceptedSealRef: "logical-b" };
  await assert.rejects(mismatched.onScopedStarlingReader(dummyReader, identity, () => true));
  assert.equal(mismatched.inspect("root"), null);

  const n = await rig();
  vm.runInContext(source("js/pocket-progressive-open-connection.js"), n.c);
  const missing = newSession(n.c);
  n.onHook((reader, id, guard) => missing.onScopedStarlingReader(reader, id, guard));
  assert.equal((await n.opener().openExisting(n.dependencies)).ok, false);
  assert.equal(n.readerBuilds, 1);
  assert.equal(n.materialized, 0);
  assert.equal(missing.inspect("root"), null);
  assertUnchanged(n);
});

test("P376 malformed root and failed later parent read never become ready-empty truth", async () => {
  const a = await rig();
  install(a.c);
  const old = a.c.PocketStarlingMaterializeShadow;
  a.c.PocketStarlingMaterializeShadow = Object.freeze({
    ...old,
    async createAcceptedSnapshotReader(session) {
      const reader = await old.createAcceptedSnapshotReader(session);
      return Object.freeze({ ...reader,
        async readChildren(parentId) {
          return parentId === "root"
            ? { ok: true, scope: "incomplete", parentId, nodes: null }
            : reader.readChildren(parentId);
        } });
    },
  });
  const s = newSession(a.c);
  a.onHook((reader, source, guard) => s.onScopedStarlingReader(reader, source, guard));
  assert.equal((await a.opener().openExisting(a.dependencies)).ok, false);
  assert.equal(a.materialized, 0);
  assert.equal(s.inspect("root"), null);
  assertUnchanged(a);

  const b = await rig();
  install(b.c);
  const session = newSession(b.c);
  b.onHook(async (reader, source, guard) => {
    await session.onScopedStarlingReader(reader, source, guard);
    b.breakChildGets();
    const result = await session.requestChildren("parent");
    assert.equal(result.ok, false);
    assert.equal(session.inspect("parent").childrenState, "failed");
    assert.equal(session.inspect("parent").childIds, null);
    assert.equal(session.inspect("sibling").childrenState, "unresolved");
    assert.equal(session.inspect("deep"), null);
    assert.equal(session.inspect("root").childrenState, "ready");
    assert.deepEqual(plain(session.inspect("root").childIds), ["parent", "sibling"]);
    assert.equal(b.materialized, 0);
    assertUnchanged(b);
  });
  const laterOpen = await b.opener().openExisting(b.dependencies);
  // The observer did not reject. Existing complete Open still owns its own
  // separate success/failure contract; do not conflate that with scoped failure.
  assert.equal(typeof laterOpen.ok, "boolean");
  assert.equal(b.adopted, laterOpen.ok === true ? 1 : 0);
  assert.equal(b.materialized, 1);
});

test("P376 stale ORIGINAL captured target and rejected callback preserve prior truth", async () => {
  for (const reason of ["captured-target", "callback-rejection"]) {
    const r = await rig();
    install(r.c);
    const session = newSession(r.c);
    r.onHook(async (reader, source, guard) => {
      if (reason === "captured-target") r.setTarget("different-current-target");
      else throw Error("upstream callback rejected before admission");
      await session.onScopedStarlingReader(reader, source, guard);
    });
    const result = await r.opener().openExisting(r.dependencies);
    assert.equal(result.ok, false, reason);
    assert.equal(r.materialized, 0, reason);
    assert.equal(r.adopted, 0, reason);
    assert.equal(session.currentSource(), null);
    assertUnchanged(r);
  }
});

test("P376 explicit retirement during deferred P370 child read blocks late current knowledge", async () => {
  const r = await rig();
  install(r.c);
  const session = newSession(r.c);
  let entered, release;
  const started = new Promise(resolve => { entered = resolve; });
  const gate = new Promise(resolve => { release = resolve; });
  let watched;
  r.onHook(async (reader, source, guard) => {
    const controlled = Object.freeze({
      ...reader,
      readChildren(parentId) {
        if (parentId === "parent") {
          entered();
          return gate.then(() => reader.readChildren(parentId));
        }
        return reader.readChildren(parentId);
      },
    });
    await session.onScopedStarlingReader(controlled, source, guard);
    watched = session.requestChildren("parent");
    await started;
    assert.equal(session.inspect("parent").childrenState, "pending");
    assert.equal(session.retire(), true);
    assert.equal(session.retire(), false);
    assert.equal(session.currentSource(), null);
    assert.equal(session.inspect("root"), null);
    release();
    const settled = await watched;
    assert.equal(settled.ok, false);
    assert.equal(settled.reason, "opening-session-stale");
    assert.equal(session.inspect("deep"), null);
    assert.equal((await session.requestChildren("parent")).ok, false);
    assertUnchanged(r);
  });
  assert.equal((await r.opener().openExisting(r.dependencies)).ok, true);
  assert.equal(r.materialized, 1, "ordinary complete Open unaffected after private retirement");
});

test("P376 later failed selection retires earlier root; same Seal cannot act as attempt identity", async () => {
  const r = await rig();
  install(r.c);
  const session = newSession(r.c);
  let rootSource;
  r.onHook(async (reader, source, guard) => {
    await session.onScopedStarlingReader(reader, source, guard);
    rootSource = session.currentSource();
  });
  assert.equal((await r.opener().openExisting(r.dependencies)).ok, true);
  checkRoot(session, rootSource.acceptedSealRef);
  const newerReader = {
    ok: true, scope: "incomplete", acceptedSealRef: rootSource.acceptedSealRef,
    readReachedNode() { return fail("not-reached"); },
    async readChildren() { return fail("later-source-unavailable"); },
  };
  await assert.rejects(session.onScopedStarlingReader(newerReader, rootSource, () => true));
  assert.equal(session.currentSource(), null);
  assert.equal(session.inspect("root"), null);
  assert.equal((await session.requestChildren("root")).ok, false);
});

test("P376 two real new-device Starling selections produce separate current P370 roots", async () => {
  const r = await rig();
  install(r.c);
  const session = newSession(r.c);
  const actualP370 = r.c.PocketProgressiveOpenState;
  let ownerCreations = 0, ownerRetirements = 0;
  r.c.PocketProgressiveOpenState = Object.freeze({
    createKnowledgeOwner(reader) {
      const owner = actualP370.createKnowledgeOwner(reader);
      ownerCreations += 1;
      return Object.freeze({ ...owner,
        retire() { ownerRetirements += 1; return owner.retire(); },
      });
    },
  });
  let provisional = null, localWrites = 0, serverEnvelopeWrites = 0;
  r.config.deviceStore = {
    async open() {},
    async readPocket() { return provisional; },
    async createPocket(record) { localWrites += 1; provisional = record; },
    async replacePocket(_id, _rev, record) { localWrites += 1; provisional = record; },
    async reservePocketEncryptionUsage() { throw Error("not needed"); },
  };
  r.config.accountClient = { async authenticatePasskey() {
    return { ok: true, accountAuthenticated: true, contentUnlocked: false,
      accountId: "account-p376", credentialId: "credential-p376",
      prf: { status: "available", outputBytes: new Uint8Array(32) } };
  } };
  const prf = { envelopeId: "prf-p376", envelopeKind: "passkey-prf",
    envelopeVersion: 1, deviceId: null, credentialId: "credential-p376",
    kdf: "HKDF-SHA-256", kdfSalt: "salt-p376", derivationVersion: 1 };
  r.config.envelopeService = {
    async listEnvelopes() { return { keySetVersion: 1,
      envelopes: [{ ...prf, status: "active" }] }; },
    async downloadEnvelope() { return { keySetVersion: 1,
      envelope: { ...prf, encryptedEnvelope: { fixture: "protected" } } }; },
    async addEnvelope() { serverEnvelopeWrites += 1;
      return { status: "committed", keySetVersion: 2,
        masterKeyGeneration: 1, masterKeyContentEncryptionLimit: 2 ** 20 }; },
  };
  r.config.crypto = Object.freeze({
    ...r.c.PocketSyncCrypto,
    async deriveWrappingKey() { return r.bundle.wrappingKey; },
    async openMasterKeyBundle(_record, _key, _context, recipients = []) {
      return { masterKey: r.stage.key, semanticAuthority: r.bundle.semanticAuthority,
        envelopes: recipients.map(() => ({ record: r.bundle.record })) };
    },
  });
  let count = 0, oldRoot;
  r.onHook(async (reader, source, guard) => {
    count += 1;
    if (count === 2) {
      const next = session.onScopedStarlingReader(reader, source, guard);
      assert.equal(session.inspect("root"), null,
        "earlier P370 root retired before next root is admitted");
      assert.equal(ownerRetirements, 1,
        "old genuine P370 owner retired at next selection");
      await next;
    } else {
      await session.onScopedStarlingReader(reader, source, guard);
      oldRoot = session.inspect("root");
    }
    checkRoot(session, source.acceptedSealRef);
    assert.equal(r.materialized, count - 1,
      "each root reaches knowledge before that selection's full materialisation");
  });
  const opened = await r.opener().openExisting(r.dependencies);
  assert.equal(opened.ok, true, JSON.stringify(opened));
  assert.equal(count, 2);
  assert.equal(r.readerBuilds, 2);
  assert.equal(ownerCreations, 2);
  assert.equal(ownerRetirements, 1);
  assert.equal(r.materialized, 2);
  assert.equal(r.adopted, 1);
  assert.equal(localWrites, 2);
  assert.equal(serverEnvelopeWrites, 1);
  assert.ok(oldRoot && session.inspect("root") !== oldRoot);
  assert.equal(r.remoteCalls.some(x=>["compareAndSetShadowHead","putOpaqueObject"].includes(x[0])),false);
  assert.equal(JSON.stringify(r.mainState.nodes), r.mainTruth.nodes);
});


test("P376 caller attempt invalidation during deferred child read prevents stale outward success", async () => {
  const r = await rig();
  install(r.c);
  let attemptCurrent = true, start, release;
  const entered = new Promise(resolve => { start = resolve; });
  const gate = new Promise(resolve => { release = resolve; });
  const session = newSession(r.c, () => attemptCurrent);
  r.onHook(async (reader, source, guard) => {
    await session.onScopedStarlingReader(Object.freeze({
      ...reader,
      readChildren(parentId) {
        if (parentId === "parent") {
          start();
          return gate.then(() => reader.readChildren(parentId));
        }
        return reader.readChildren(parentId);
      },
    }), source, guard);
    const running = session.requestChildren("parent");
    await entered;
    assert.equal(session.inspect("parent").childrenState, "pending");
    attemptCurrent = false;
    assert.equal(session.currentSource(), null,
      "invalid attempt must retire its current model");
    release();
    const outcome = await running;
    assert.equal(outcome.ok, false);
    assert.equal(outcome.reason, "opening-session-stale");
    assert.equal(session.inspect("deep"), null);
    assertUnchanged(r);
  });
  assert.equal((await r.opener().openExisting(r.dependencies)).ok, true);
  assert.equal(r.adopted, 1);
});

test("P376 no composition leaves P375 dormant and whole-record mode without P370", async () => {
  const a = await rig();
  install(a.c);
  assert.equal(a.dependencies.onScopedStarlingReader, undefined);
  assert.equal((await a.opener().openExisting(a.dependencies)).ok, true);
  assert.equal(a.readerBuilds, 0);
  assert.equal(a.materialized, 1);
  assert.equal(a.adopted, 1);
  const b = await rig({ mode: "whole-record" });
  install(b.c);
  b.config.crypto = Object.freeze({
    ...b.c.PocketSyncCrypto,
    async openContent() { return { schema: "portal.export.v1", source: "whole-record" }; },
  });
  const session = newSession(b.c);
  let hooks = 0;
  b.onHook(async (reader, source, guard) => {
    hooks += 1;
    await session.onScopedStarlingReader(reader, source, guard);
  });
  assert.equal((await b.opener().openExisting(b.dependencies)).ok, true);
  assert.equal(hooks, 0);
  assert.equal(b.readerBuilds, 0);
  assert.equal(session.currentSource(), null);
  assert.equal(b.materialized, 0);
  assert.equal(b.adopted, 1);
  for (const file of ["index.html", "js/pocket-sync-browser-runtime.js",
    "js/pocket-sync-local-integration.js", "sync-service/pocket-sync-production-server.js"]) {
    assert.doesNotMatch(source(file), /PocketProgressiveOpenConnection|pocket-progressive-open-connection\.js/);
  }
  assert.doesNotMatch(source("js/pocket-sync-additional-device.js"), /PocketProgressiveOpenConnection/);
  assert.doesNotMatch(source("js/pocket-progressive-open-connection.js"),
    /(?:state\.nodes\s*=|renderTree\s*\(|snapshot\s*\(|saveCurrentContext\s*\(|fetch\s*\()/);
});
