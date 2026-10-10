"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const ROOT = path.resolve(__dirname, "..");
const GUARD = "js/pocket-sync-owner-continuity-guard.js";
const SCHEMA = "pocket.sync.owner-session.v1";
const FUTURE = "2040-01-01T00:00:00.000Z";
const TAG_A = "a".repeat(64);
const TAG_B = "b".repeat(64);
const SENSITIVE = "credential-and-raw-session-must-not-appear";

const read = (p) => fs.readFileSync(path.join(ROOT, p), "utf8");
const plain = (v) => JSON.parse(JSON.stringify(v));
function deferred() {
  let resolve;
  const promise = new Promise(done => { resolve = done; });
  return { resolve, promise };
}

function makeHarness(options = {}) {
  let localId = 1, kind = "json", generation = 0, current = null;
  let nowValue = Date.parse("2032-01-01T00:00:00.000Z");
  let serial = 0, reads = 0, installCalls = 0, delay = null, rejectRead = false;
  let installMode = options.installMode || "success";
  let server = {
    accountId: "account-a",
    syncedPocketId: "pocket-a",
    sessionTag: TAG_A,
    expiresAt: FUTURE,
    status: "ready",
  };
  const context = {
    Object, Array, Number, String, Boolean, JSON, Date, Error, Promise,
    Set, Uint8Array, ArrayBuffer, TextEncoder, TextDecoder,
    atob(value) { return Buffer.from(value, "base64").toString("binary"); },
    btoa(value) { return Buffer.from(value, "binary").toString("base64"); },
    setPocketFileSession(_handle, _name, config = {}) {
      kind = config.ownerKind || "json";
      localId++;
    },
    capturePocketFileSaveSession() {
      return { id: localId, ownerKind: kind, handle: null,
        storagePrivacy: kind === "synced" ? "synced" : "normal",
        vaultSessionId: "", pipSession: false, detachedDeviceChanges: false };
    },
    isPocketFileSaveSessionCurrent(value) {
      return value?.id === localId && value.ownerKind === kind
        && value.storagePrivacy === (kind === "synced" ? "synced" : "normal");
    },
    capturePocketFileOwnerForAdoption() { return { kind, localId }; },
    restorePocketFileOwnerAfterFailedAdoption(value) {
      kind = value.kind; localId = value.localId; return true;
    },
  };
  context.window = context;
  context.globalThis = context;
  vm.createContext(context);
  for (const file of [
    "js/pocket-sync-security-contract.js",
    "js/pocket-sync-account-client.js",
    "js/pocket-sync-remote-client.js",
    "js/pocket-owner-save-boundary.js",
    GUARD,
  ]) vm.runInContext(read(file), context, { filename: file });

  const controller = {
    captureSyncedOwnerSaveSession() { return current; },
    isSyncedOwnerSaveSessionCurrent(session) {
      return current !== null && session?.token === current.token
        && session.generation === current.generation
        && session.syncedPocketId === current.syncedPocketId;
    },
    async saveSyncedOwner() { return { ok: true, reason: "synthetic-save" }; },
    releaseSyncedOwner() { current = null; generation++; return true; },
    install(id = "pocket-a") {
      generation++;
      current = Object.freeze({
        generation, syncedPocketId: id,
        token: Object.freeze({ generation }),
      });
    },
  };

  const boundary = context.PocketOwnerSaveBoundary;
  const remoteContract = context.PocketSyncRemoteClient;
  const service = {
    async readSyncedPocket(request) {
      reads++;
      if (request.ownerContinuity !== undefined) {
        assert.deepEqual(plain(request), {
          apiVersion: 1, operationId: request.operationId, ownerContinuity: SCHEMA,
        });
      } else {
        assert.equal(Object.hasOwn(request, "ownerContinuity"), false);
      }
      assert.match(request.operationId, /^p355c-op-[0-9]+$/);
      if (rejectRead) throw new Error(SENSITIVE);
      if (delay) {
        const gate = delay;
        delay = null;
        await gate.promise;
      }
      return {
        apiVersion: 1, ok: true, operationId: request.operationId,
        status: server.status,
        syncedPocketId: server.status === "ready" ? server.syncedPocketId : null,
        ...(request.ownerContinuity === SCHEMA && server.status === "ready" ? {
          ownerContinuity: {
            schema: SCHEMA, accountId: server.accountId,
            sessionTag: server.sessionTag, expiresAt: server.expiresAt,
          },
        } : {}),
      };
    },
  };
  const installed = async () => {
    installCalls++;
    if (installMode === "fail") return false;
    controller.install(server.syncedPocketId);
    if (installMode === "partial") return true;
    return boundary.installSyncedOwnerForSave(controller);
  };
  // Synthetic trusted ceremony fixture for the P355c race contract; P355e
  // exercises the actual additional-device opener separately.
  const composition = context.PocketSyncOwnerContinuityGuard.createDormantCompletedDeviceOpener({
    additionalDeviceApi: {
      createAdditionalDeviceOpener(config) {
        return { async openExisting(deps) {
          await config.accountClient.authenticatePasskey({ apiVersion: 1, operationId: "p355c-auth" });
          const found = await config.discoveryService.readSyncedPocket({
            apiVersion: 1, operationId: "p355c-op-0",
          });
          if (found.status !== "ready") return { ok: false };
          return deps.adoptCompletedOpenedPocket({ syncedPocketId: found.syncedPocketId });
        } };
      },
    },
    openerConfiguration: {
      accountClient: { async authenticatePasskey() {
        return { ok: true, accountAuthenticated: true, contentUnlocked: false,
          accountId: "account-a", credentialId: "credential-a", bootstrap: false };
      } },
      discoveryService: service,
    },
    dependencies: {
      captureTarget: () => ({ ownerKind: "json", continuityId: "synthetic" }),
      isTargetCurrent: () => true,
      validatePayload: () => true,
      adoptOpenedPocket: installed,
    },
    controller, boundary, remoteContract,
    nextOperationId() { serial++; return "p355c-op-" + serial; },
    now() { return nowValue; },
  });
  const guard = Object.freeze({
    installWithContinuity: () => composition.openExisting(),
    revalidate: () => composition.revalidate(),
  });
  return {
    guard, controller, boundary, context,
    state(value) { server = { ...server, ...value }; },
    setMode(value) { installMode = value; },
    setNow(value) { nowValue = value; },
    throwRemote(value) { rejectRead = value; },
    deferNextRead(value) { delay = value; },
    changeLocal() { context.setPocketFileSession(null, "Synthetic", { ownerKind: kind }); },
    changeController(id = "pocket-a") { controller.install(id); },
    installWithoutGuard() {
      controller.install();
      assert.equal(boundary.installSyncedOwnerForSave(controller), true);
    },
    swapBoundaryOwner() {
      const replacement = { ...controller,
        captureSyncedOwnerSaveSession: () =>
          ({ token: {}, generation: 77, syncedPocketId: "pocket-a" }),
        isSyncedOwnerSaveSessionCurrent: () => true,
      };
      return boundary.installSyncedOwnerForSave(replacement);
    },
    get readCount() { return reads; },
    get installCalls() { return installCalls; },
  };
}

test("P355c is dormant, exports only a constructor and no arbitrary witness setter", () => {
  assert.doesNotMatch(read("index.html"), /pocket-sync-owner-continuity-guard\.js/);
  assert.doesNotMatch(read("sw.js"), /pocket-sync-owner-continuity-guard\.js/);
  const source = read(GUARD);
  assert.doesNotMatch(source, /localStorage|sessionStorage|indexedDB|document\.cookie|console\./);
  assert.doesNotMatch(source, /exportTree|download|saveAs|rawSessionId|document\.cookie/);
  const h = makeHarness();
  assert.deepEqual(Object.keys(h.context.PocketSyncOwnerContinuityGuard),
    ["createDormantGuard", "createDormantCompletedDeviceOpener"]);
  assert.deepEqual(Object.keys(h.guard), ["installWithContinuity", "revalidate"]);
  assert.equal(Object.isFrozen(h.guard), true);
  assert.equal(Object.hasOwn(h.guard, "bind"), false);
  assert.equal(Object.hasOwn(h.guard, "authoriseExport"), false);
});

test("P355c binds only across a new two-owner installation and revalidates the same session", async () => {
  const h = makeHarness();
  assert.deepEqual(plain(await h.guard.revalidate()),
    { ok: false, reason: "owner-continuity-unavailable" });
  assert.equal(h.readCount, 0);
  assert.deepEqual(plain(await h.guard.installWithContinuity()), { ok: true });
  assert.equal(h.readCount, 3);
  assert.equal(h.installCalls, 1);
  assert.equal(h.boundary.hasSyncedOwner(), true);
  assert.deepEqual(plain(await h.guard.revalidate()),
    { ok: true, reason: "owner-continuity-current" });
  assert.equal(h.readCount, 4);
  assert.equal(JSON.stringify(h.guard).includes(TAG_A), false);
  assert.equal(JSON.stringify(h.guard).includes(SENSITIVE), false);
  assert.equal(Object.hasOwn(h.guard, "ownerContinuity"), false);
});

test("P355c server-side account, Pocket and session changes fail closed", async () => {
  for (const mutation of [
    { sessionTag: TAG_B },
    { accountId: "account-b" },
    { syncedPocketId: "pocket-b" },
    { expiresAt: "2041-01-01T00:00:00.000Z" },
  ]) {
    const h = makeHarness();
    assert.equal((await h.guard.installWithContinuity()).ok, true);
    h.state(mutation);
    assert.deepEqual(plain(await h.guard.revalidate()),
      { ok: false, reason: "owner-continuity-unavailable" });
    assert.equal((await h.guard.revalidate()).ok, false);
  }
});

test("P355c expiry, malformed witness, absent witness and remote uncertainty fail closed", async () => {
  const cases = [
    { sessionTag: "bad" },
    { accountId: "" },
    { expiresAt: "not-an-ISO-timestamp" },
    { status: "not-configured" },
  ];
  for (const mutation of cases) {
    const h = makeHarness();
    assert.equal((await h.guard.installWithContinuity()).ok, true);
    h.state(mutation);
    assert.equal((await h.guard.revalidate()).ok, false);
  }
  const rejected = makeHarness();
  assert.equal((await rejected.guard.installWithContinuity()).ok, true);
  rejected.throwRemote(true);
  assert.deepEqual(plain(await rejected.guard.revalidate()),
    { ok: false, reason: "owner-continuity-unavailable" });
  assert.equal(JSON.stringify(await rejected.guard.revalidate()).includes(SENSITIVE), false);

  const time = makeHarness();
  assert.equal((await time.guard.installWithContinuity()).ok, true);
  time.setNow(Date.parse(FUTURE));
  const before = time.readCount;
  assert.equal((await time.guard.revalidate()).ok, false);
  assert.equal(time.readCount, before);
});

test("P355c controller replacement, generation and local browser-session changes fail closed", async () => {
  for (const change of [
    h => h.changeController(),
    h => h.changeController("pocket-b"),
    h => h.changeLocal(),
    h => h.swapBoundaryOwner(),
  ]) {
    const h = makeHarness();
    assert.equal((await h.guard.installWithContinuity()).ok, true);
    change(h);
    const readsBefore = h.readCount;
    assert.equal((await h.guard.revalidate()).ok, false);
    assert.equal(h.readCount, readsBefore);
  }
});

test("P355c concurrent replacement invalidates a successful remote result", async () => {
  for (const mutation of [h => h.changeController(), h => h.changeLocal(), h => h.swapBoundaryOwner()]) {
    const h = makeHarness();
    assert.equal((await h.guard.installWithContinuity()).ok, true);
    const gate = deferred();
    h.deferNextRead(gate);
    const checking = h.guard.revalidate();
    await Promise.resolve();
    mutation(h);
    gate.resolve();
    assert.deepEqual(plain(await checking),
      { ok: false, reason: "owner-continuity-unavailable" });
  }
});

test("P355c concurrent session replacement during installation never binds", async () => {
  const h = makeHarness();
  const gate = deferred();
  h.deferNextRead(gate);
  const opening = h.guard.installWithContinuity();
  await Promise.resolve();
  assert.equal((await h.guard.installWithContinuity()).ok, false);
  h.state({ sessionTag: TAG_B });
  gate.resolve();
  // A new, stable server session at the pre-installation read can be bound,
  // but stale evidence from a different current account cannot be.
  h.state({ status: "not-configured" });
  assert.equal((await opening).ok, false);
  assert.equal((await h.guard.revalidate()).ok, false);
});

test("P355c failed/partial installation and old unbound owners cannot gain evidence", async () => {
  for (const installMode of ["fail", "partial"]) {
    const h = makeHarness({ installMode });
    assert.equal((await h.guard.installWithContinuity()).ok, false);
    assert.equal((await h.guard.revalidate()).ok, false);
  }
  const old = makeHarness();
  old.installWithoutGuard();
  assert.equal((await old.guard.revalidate()).ok, false);
  assert.equal(old.readCount, 0);
  // Even a fresh discovery read is not a public retrofit operation.
  assert.deepEqual(Object.keys(old.guard), ["installWithContinuity", "revalidate"]);
});

test("P355c fresh but stale response is not an export or consent authorisation", async () => {
  const h = makeHarness();
  const result = await h.guard.installWithContinuity();
  assert.equal(result.ok, true);
  const once = await h.guard.revalidate();
  assert.deepEqual(plain(once), { ok: true, reason: "owner-continuity-current" });
  assert.equal(Object.hasOwn(once, "permission"), false);
  assert.equal(Object.hasOwn(once, "accountId"), false);
  assert.equal(Object.hasOwn(once, "sessionTag"), false);
  assert.equal(Object.hasOwn(once, "export"), false);
  h.state({ sessionTag: TAG_B });
  assert.equal((await h.guard.revalidate()).ok, false);
  assert.equal(once.ok, true); // historical fact, NOT a reusable authorisation
});
