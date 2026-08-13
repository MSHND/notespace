"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const ROOT = path.resolve(__dirname, "..");
const BOUNDARY = "js/pocket-owner-save-boundary.js";
const SENTINEL = "P043-READABLE-POCKET-MUST-NOT-REACH-REMOTE";

function source(file) {
  return fs.readFileSync(path.join(ROOT, file), "utf8");
}

function deferred() {
  let resolve;
  const promise = new Promise((done) => { resolve = done; });
  return { promise, resolve };
}

function createContext() {
  let sessionId = 1;
  let ownerKind = "json";
  const calls = { file: [], vault: [], set: [] };
  const context = {
    Object,
    Promise,
    setPocketFileSession(_handle, _name, options = {}) {
      ownerKind = options.ownerKind || "json";
      sessionId += 1;
      calls.set.push(ownerKind);
    },
    capturePocketFileSaveSession() {
      return { id: sessionId, ownerKind, handle: ownerKind === "json" ? { name: "pocket.json" } : null };
    },
    isPocketFileSaveSessionCurrent(session) {
      return !!session && session.id === sessionId && session.ownerKind === ownerKind;
    },
    isPocketEditorSourceIdentityCurrent(identity) {
      return !!identity && identity.id === sessionId;
    },
    async writeTruthFile(payload) {
      calls.file.push(payload);
      return { ok: true, target: "opened-file" };
    },
    PocketVaultBrowserIo: {
      async writeActiveVaultPayload(payload) {
        calls.vault.push(payload);
        return { ok: true, target: "vault" };
      },
    },
    __calls: calls,
    __setOwner(next) { ownerKind = next; sessionId += 1; },
  };
  context.window = context;
  context.globalThis = context;
  vm.createContext(context);
  vm.runInContext(source(BOUNDARY), context, { filename: BOUNDARY });
  return context;
}

function fakeSyncedController(options = {}) {
  let generation = 1;
  let active = true;
  let saves = 0;
  const controller = {
    captureSyncedOwnerSaveSession() {
      return active ? { generation } : null;
    },
    isSyncedOwnerSaveSessionCurrent(session) {
      return active && !!session && session.generation === generation;
    },
    async saveSyncedOwner({ freezePayload }) {
      saves += 1;
      const payload = await freezePayload();
      if (typeof options.onPayload === "function") options.onPayload(payload);
      if (options.gate) await options.gate.promise;
      return options.result || { ok: true, reason: "saved", confirmedRemoteRevision: 4 };
    },
    releaseSyncedOwner() {
      active = false;
      generation += 1;
      return true;
    },
    get saves() { return saves; },
  };
  return controller;
}

test("P043 routes explicit JSON and Vault owners without cross-owner fallback", async () => {
  const context = createContext();
  let freezes = 0;
  const jsonSession = context.capturePocketFileSaveSession();
  const json = await context.PocketOwnerSaveBoundary.save({
    expectedSession: jsonSession,
    async freezePayload() { freezes += 1; return { sentinel: SENTINEL, owner: "json" }; },
  });
  assert.equal(json.ok, true);
  assert.equal(json.ownerKind, "json");
  assert.equal(freezes, 1);
  assert.equal(Object.hasOwn(json, "payload"), false);
  assert.deepEqual(context.__calls.file, [{ sentinel: SENTINEL, owner: "json" }]);
  assert.equal(context.__calls.vault.length, 0);

  context.__setOwner("vault");
  const vaultSession = context.capturePocketFileSaveSession();
  const vault = await context.PocketOwnerSaveBoundary.save({
    expectedSession: vaultSession,
    freezePayload: async () => ({ sentinel: SENTINEL, owner: "vault" }),
  });
  assert.equal(vault.ok, true);
  assert.equal(vault.ownerKind, "vault");
  assert.deepEqual(context.__calls.vault, [{ sentinel: SENTINEL, owner: "vault" }]);
  assert.equal(context.__calls.file.length, 1);

  context.PocketVaultBrowserIo.writeActiveVaultPayload = async () => ({ ok: false, reason: "vault-write-failed" });
  const failed = await context.PocketOwnerSaveBoundary.save({
    expectedSession: context.capturePocketFileSaveSession(),
    freezePayload: async () => ({ sentinel: SENTINEL }),
  });
  assert.equal(failed.ok, false);
  assert.equal(failed.reason, "vault-write-failed");
  assert.equal(context.__calls.file.length, 1);
});

test("P043 delegates synced Save exactly once to the injected P042 controller", async () => {
  const context = createContext();
  let observed = null;
  const controller = fakeSyncedController({ onPayload(payload) { observed = payload; } });
  assert.equal(context.PocketOwnerSaveBoundary.hasSyncedOwner(), false);
  assert.equal(context.PocketOwnerSaveBoundary.installSyncedOwnerForSave(controller), true);
  assert.equal(context.capturePocketFileSaveSession().ownerKind, "synced");
  assert.equal(context.__calls.file.length, 0);
  assert.equal(context.__calls.vault.length, 0);
  let freezes = 0;
  const result = await context.PocketOwnerSaveBoundary.save({
    expectedSession: context.capturePocketFileSaveSession(),
    async freezePayload() { freezes += 1; return { sentinel: SENTINEL }; },
  });
  assert.equal(result.ok, true);
  assert.equal(result.target, "synced");
  assert.equal(controller.saves, 1);
  assert.equal(freezes, 1);
  assert.deepEqual(observed, { sentinel: SENTINEL });
  assert.equal(context.__calls.file.length, 0);
  assert.equal(context.__calls.vault.length, 0);
});

test("P043 preserves P042 non-success results and never acknowledges a replacement owner", async () => {
  for (const reason of ["revision-conflict", "remote-outcome-unknown", "stale-owner-session", "remote-success-local-confirmation-failed"]) {
    const context = createContext();
    const controller = fakeSyncedController({ result: { ok: false, reason } });
    assert.equal(context.PocketOwnerSaveBoundary.installSyncedOwnerForSave(controller), true);
    const result = await context.PocketOwnerSaveBoundary.save({
      expectedSession: context.capturePocketFileSaveSession(),
      freezePayload: async () => ({ sentinel: SENTINEL }),
    });
    assert.equal(result.ok, false, reason);
    assert.equal(result.reason, reason, reason);
  }

  const context = createContext();
  const gate = deferred();
  const controller = fakeSyncedController({ gate });
  assert.equal(context.PocketOwnerSaveBoundary.installSyncedOwnerForSave(controller), true);
  const saving = context.PocketOwnerSaveBoundary.save({
    expectedSession: context.capturePocketFileSaveSession(),
    freezePayload: async () => ({ sentinel: SENTINEL }),
  });
  await Promise.resolve();
  context.PocketOwnerSaveBoundary.retireSyncedOwner();
  context.__setOwner("json");
  gate.resolve();
  const stale = await saving;
  assert.equal(stale.ok, false);
  assert.equal(stale.reason, "stale-owner-session");
  assert.equal(context.capturePocketFileSaveSession().ownerKind, "json");
});

test("P043 invalidates every local and synced save generation across owner changes", async () => {
  const fileToVault = createContext();
  const fileGate = deferred();
  fileToVault.writeTruthFile = async (payload) => {
    fileToVault.__calls.file.push(payload);
    await fileGate.promise;
    return { ok: true, target: "opened-file" };
  };
  const fileSaving = fileToVault.PocketOwnerSaveBoundary.save({
    expectedSession: fileToVault.capturePocketFileSaveSession(),
    freezePayload: async () => ({ sentinel: SENTINEL, owner: "file" }),
  });
  await Promise.resolve();
  fileToVault.__setOwner("vault");
  fileGate.resolve();
  assert.equal((await fileSaving).reason, "stale-owner-session");

  const vaultToFile = createContext();
  vaultToFile.__setOwner("vault");
  const vaultGate = deferred();
  vaultToFile.PocketVaultBrowserIo.writeActiveVaultPayload = async (payload) => {
    vaultToFile.__calls.vault.push(payload);
    await vaultGate.promise;
    return { ok: true, target: "vault" };
  };
  const vaultSaving = vaultToFile.PocketOwnerSaveBoundary.save({
    expectedSession: vaultToFile.capturePocketFileSaveSession(),
    freezePayload: async () => ({ sentinel: SENTINEL, owner: "vault" }),
  });
  await Promise.resolve();
  vaultToFile.__setOwner("json");
  vaultGate.resolve();
  assert.equal((await vaultSaving).reason, "stale-owner-session");

  const localToSync = createContext();
  const localGate = deferred();
  localToSync.writeTruthFile = async (payload) => {
    localToSync.__calls.file.push(payload);
    await localGate.promise;
    return { ok: true, target: "opened-file" };
  };
  const localSaving = localToSync.PocketOwnerSaveBoundary.save({
    expectedSession: localToSync.capturePocketFileSaveSession(),
    freezePayload: async () => ({ sentinel: SENTINEL, owner: "local" }),
  });
  await Promise.resolve();
  assert.equal(localToSync.PocketOwnerSaveBoundary.installSyncedOwnerForSave(fakeSyncedController()), true);
  localGate.resolve();
  assert.equal((await localSaving).reason, "stale-owner-session");

  const sameTargetNewGeneration = createContext();
  const first = fakeSyncedController();
  assert.equal(sameTargetNewGeneration.PocketOwnerSaveBoundary.installSyncedOwnerForSave(first), true);
  const captured = sameTargetNewGeneration.PocketOwnerSaveBoundary.captureOwnerSaveSession();
  assert.equal(sameTargetNewGeneration.PocketOwnerSaveBoundary.installSyncedOwnerForSave(fakeSyncedController()), true);
  assert.equal(sameTargetNewGeneration.PocketOwnerSaveBoundary.isOwnerSaveSessionCurrent(captured), false);
});

test("P043 loads the boundary before P053's inert injected Sync doorway", () => {
  const index = source("index.html");
  const scripts = Array.from(index.matchAll(/<script\s+src="([^"]+)"/g), (match) => match[1]);
  assert.ok(scripts.indexOf("js/pocket-sync-owner-controller.js") >= 0);
  assert.ok(scripts.indexOf("js/pocket-owner-save-boundary.js")
    > scripts.indexOf("js/pocket-sync-owner-controller.js"));
  assert.match(index, /id="cmdSync"[^>]*hidden disabled/);
  assert.ok(scripts.indexOf("js/pocket-sync-ui.js") > scripts.indexOf("js/pocket-owner-save-boundary.js"));
  assert.match(source("js/pocket-io-browser.js"), /const boundary = window\.PocketOwnerSaveBoundary/);
  assert.match(source("js/pocket-node-popout-editor.js"), /exportTree/);
});
