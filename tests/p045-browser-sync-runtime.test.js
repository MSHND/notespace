"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { webcrypto } = require("node:crypto");

const { createServiceCore } = require("../sync-service/pocket-sync-service-core.js");
const { createMemoryServiceStore } = require("./helpers/p034-memory-service-store.js");
const fixtures = require("./helpers/p032-remote-fixtures.js");

const ROOT = path.resolve(__dirname, "..");
const ORIGIN = "https://sync.pocket.example";
const NOW = Date.parse("2040-01-01T00:00:00.000Z");
const READABLE = "P045-READABLE-POCKET-MUST-STAY-LOCAL";

function source(file) {
  return fs.readFileSync(path.join(ROOT, file), "utf8");
}

function plain(value) {
  return JSON.parse(JSON.stringify(value));
}

function bytes(length, seed = 1) {
  return Uint8Array.from({ length }, (_value, index) => (seed + index) & 255);
}

function b64(length, seed = 1) {
  return Buffer.from(bytes(length, seed)).toString("base64url");
}

function createIndexedDb() {
  const records = new Map();
  const observations = { opens: 0, transactions: 0 };
  let storeCreated = false;
  const store = {
    keyPath: "syncedPocketId",
    autoIncrement: false,
    indexNames: [],
    get(key) {
      const request = {};
      queueMicrotask(() => { request.result = records.get(key); request.onsuccess?.(); });
      return request;
    },
    getAll() {
      const request = {};
      queueMicrotask(() => { request.result = [...records.values()]; request.onsuccess?.(); });
      return request;
    },
    add(value) {
      if (records.has(value.syncedPocketId)) throw new Error("duplicate");
      const request = {};
      queueMicrotask(() => { records.set(value.syncedPocketId, value); request.onsuccess?.(); });
      return request;
    },
    put(value) {
      const request = {};
      queueMicrotask(() => { records.set(value.syncedPocketId, value); request.onsuccess?.(); });
      return request;
    },
  };
  const database = {
    version: 1,
    get objectStoreNames() { return storeCreated ? ["pockets"] : []; },
    createObjectStore(name, options) {
      if (name !== "pockets" || options?.keyPath !== "syncedPocketId") throw new Error("schema invalid");
      storeCreated = true;
      return store;
    },
    transaction() {
      observations.transactions += 1;
      const transaction = {
        error: null,
        objectStore: () => store,
        abort() { queueMicrotask(() => transaction.onabort?.()); },
      };
      setImmediate(() => transaction.oncomplete?.());
      return transaction;
    },
    close() {},
    onversionchange: null,
  };
  return {
    observations,
    indexedDB: {
      open(name, version) {
        observations.opens += 1;
        if (name !== "pocket.sync.device.v1" || version !== 1) throw new Error("database invalid");
        const request = { result: database, transaction: { abort() {} } };
        queueMicrotask(() => {
          if (!storeCreated) request.onupgradeneeded?.({ oldVersion: 0 });
          request.onsuccess?.();
        });
        return request;
      },
    },
  };
}

function loadRuntime(context) {
  context.window = context;
  context.globalThis = context;
  vm.createContext(context);
  for (const file of [
    "js/pocket-sync-security-contract.js",
    "js/pocket-device-changes.js",
    "js/pocket-sync-crypto.js",
    "js/pocket-sync-device-store.js",
    "js/pocket-sync-account-client.js",
    "js/pocket-sync-remote-client.js",
    "js/pocket-sync-activation.js",
    "js/pocket-sync-owner-controller.js",
    "js/pocket-owner-save-boundary.js",
    "js/pocket-sync-activation-owner-bridge.js",
    "js/pocket-sync-browser-runtime.js",
  ]) vm.runInContext(source(file), context, { filename: file });
  return context.PocketSyncBrowserRuntime;
}

function createHarness(options = {}) {
  let ownerKind = options.ownerKind || "json";
  let sessionId = 5;
  let freezeCalls = 0;
  let saveCalls = 0;
  let passkeyCalls = 0;
  let pickerCalls = 0;
  let copyFails = options.copyFails === true;
  let detailsDirty = typeof options.detailsDraft === "string";
  let inlineDirty = typeof options.inlineDraft === "string";
  let detailsCommitCalls = 0;
  let inlineCommitCalls = 0;
  const writes = [];
  const savedPayloads = [];
  const frozenPayloads = [];
  const idb = createIndexedDb();
  const context = {
    crypto: webcrypto,
    CryptoKey: globalThis.CryptoKey,
    TextEncoder, TextDecoder, Uint8Array, ArrayBuffer, Object, Array, Number, String,
    Boolean, JSON, Date, Error, TypeError, Promise, Set,
    atob(value) { return Buffer.from(value, "base64").toString("binary"); },
    btoa(value) { return Buffer.from(value, "binary").toString("base64"); },
    state: {
      ops: options.dirty ? [{ sequence: 1 }] : [],
      nodes: [{ id: "one", label: "Original title", parentId: "root" }],
      inlineEdit: options.inlineDraft ? { id: "one", isNew: false, originalLabel: "Original title" } : {},
    },
    capturePocketFileSaveSession() {
      return { id: sessionId, handle: { local: true }, ownerKind, vaultSessionId: "", pipSession: false, detachedDeviceChanges: false };
    },
    isPocketFileSaveSessionCurrent(value) {
      return !!value && value.id === sessionId && value.ownerKind === ownerKind;
    },
    hasUnsavedDetailsEditorChanges() { return detailsDirty; },
    hasUnsavedInlineTitleDraft() { return inlineDirty; },
    hasPocketUnsavedChanges() {
      return context.state.ops.length > 0 || detailsDirty || inlineDirty || ownerKind === "detached";
    },
    saveDetailsEditor() {
      detailsCommitCalls += 1;
      if (options.detailsCommitFails) return;
      context.state.nodes[0].details = options.detailsDraft;
      detailsDirty = false;
      context.state.ops.push({ sequence: context.state.ops.length + 1, type: "details_edit" });
      if (options.editorChangesOwner) sessionId += 1;
    },
    captureActiveInlineEditForOwnerSwitch() {
      return inlineDirty
        ? { ok: true, active: true, id: "one", rawValue: options.inlineDraft }
        : { ok: true, active: false };
    },
    commitActiveInlineEditForOwnerSwitch(captured, commitOptions = {}) {
      inlineCommitCalls += 1;
      if (options.inlineCommitFails || !captured?.ok || commitOptions.isCurrent?.() !== true) {
        return { ok: false, reason: "commit-failed" };
      }
      context.state.nodes[0].label = captured.rawValue;
      context.state.inlineEdit = {};
      inlineDirty = false;
      context.state.ops.push({ sequence: context.state.ops.length + 1, type: "rename" });
      if (options.editorChangesOwner) sessionId += 1;
      return { ok: true, changed: true, kind: "rename" };
    },
    isPocketEditorSourceIdentityCurrent() { return false; },
    setPocketFileSession(_handle, _name, setup = {}) {
      ownerKind = setup.ownerKind || "json";
      sessionId += 1;
    },
    async exportTree() {
      saveCalls += 1;
      if (options.saveResult) return options.saveResult;
      savedPayloads.push(plain({ nodes: context.state.nodes }));
      context.state.ops = [];
      if (options.saveChangesOwner === true) {
        ownerKind = "json";
        sessionId += 1;
      }
      return { ok: true };
    },
    buildPocketPayload() {
      freezeCalls += 1;
      const payload = { schema: "portal.export.v1", nodes: plain(context.state.nodes) };
      frozenPayloads.push(payload);
      return payload;
    },
  };
  const api = loadRuntime(context);
  const serviceDriver = createMemoryServiceStore();
  let serviceRandom = 0;
  const core = createServiceCore({
    store: serviceDriver.store,
    webAuthnVerifier: {
      async verifyRegistration(input) {
        return { credentialId: input.credential.id, publicKey: b64(64, 210), publicKeyAlgorithm: -7,
          signCount: 0, transports: ["internal"], backupEligible: true, backedUp: false };
      },
      async verifyAuthentication() { throw new Error("not used"); },
    },
    recoveryProofVerifier: { async verifyRecoveryProof() { return { verified: true }; } },
    randomBytes(length) { serviceRandom += 1; return bytes(length, serviceRandom * 11); },
    now: () => NOW, trustedOrigin: ORIGIN, rpId: "sync.pocket.example", rpName: "Pocket",
    credentialAlgorithms: [-7], ceremonyLifetimeMs: 300000, sessionLifetimeMs: 2592000000,
  });
  let remoteSession = null;
  const remoteCalls = [];
  const transport = {
    async request(route, body) {
      remoteCalls.push({ route, body: plain(body) });
      const result = await core[route]({
        context: { method: "POST", origin: ORIGIN, fetchSite: "same-origin", contentType: "application/json", sessionId: remoteSession },
        body: plain(body),
      });
      if (result.session?.action === "set") remoteSession = result.session.sessionId;
      return { status: result.status, body: result.body };
    },
  };
  const remote = context.PocketSyncRemoteClient;
  const environment = {
    crypto: webcrypto,
    indexedDB: idb.indexedDB,
    now: () => NOW,
    navigator: options.passkeyUnavailable ? {} : { credentials: {
      async create() {
        passkeyCalls += 1;
        if (options.passkeyError) throw options.passkeyError;
        return fixtures.nativeRegistrationCredential();
      },
      async get() { throw new Error("not used"); },
    } },
    async showSaveFilePicker() {
      pickerCalls += 1;
      if (options.cancelPicker) throw Object.assign(new Error("cancelled"), { name: "AbortError" });
      return {
        async createWritable() {
          return {
            async write(value) { writes.push(value); },
            async close() { if (copyFails) throw new Error("copy failed"); },
            async abort() {},
          };
        },
      };
    },
  };
  const runtime = api.createRuntime({
    accountService: remote.createAccountService({ transport, now: () => NOW }),
    contentService: remote.createContentService({ transport }),
    envelopeService: remote.createEnvelopeService({ transport }),
    recoveryService: remote.createRecoveryService({ transport, now: () => NOW }),
    environment,
  });
  return {
    context, runtime, idb, remoteCalls, writes, savedPayloads, frozenPayloads,
    get ownerKind() { return ownerKind; }, get freezeCalls() { return freezeCalls; },
    get saveCalls() { return saveCalls; }, get passkeyCalls() { return passkeyCalls; }, get pickerCalls() { return pickerCalls; },
    get detailsCommitCalls() { return detailsCommitCalls; }, get inlineCommitCalls() { return inlineCommitCalls; },
    allowCopy() { copyFails = false; },
  };
}

test("P045 loading and runtime construction are inert", () => {
  let indexedDbCalls = 0;
  let credentialCalls = 0;
  let pickerCalls = 0;
  const context = {
    Object, Array, Number, String, Boolean, JSON, Error, Promise,
    window: null, globalThis: null,
    indexedDB: { open() { indexedDbCalls += 1; } },
    navigator: { credentials: { create() { credentialCalls += 1; } } },
    showSaveFilePicker() { pickerCalls += 1; },
  };
  context.window = context;
  context.globalThis = context;
  vm.createContext(context);
  assert.doesNotThrow(() => vm.runInContext(source("js/pocket-sync-browser-runtime.js"), context));
  assert.equal(indexedDbCalls, 0);
  assert.equal(credentialCalls, 0);
  assert.equal(pickerCalls, 0);
  assert.deepEqual(Object.keys(context.PocketSyncBrowserRuntime), ["createRuntime"]);
  assert.equal(Object.isFrozen(context.PocketSyncBrowserRuntime), true);
  assert.match(source("index.html"), /js\/pocket-sync-browser-runtime\.js/);
  assert.match(source("index.html"), /id="cmdSync"[^>]*hidden disabled/);
});

test("P045 explicitly composes browser activation, encrypted remote state and the live synced owner", async () => {
  const harness = createHarness({ dirty: true });
  const result = await harness.runtime.activate();
  assert.equal(result.ok, true, JSON.stringify({ result, opens: harness.idb.observations.opens,
    transactions: harness.idb.observations.transactions, owner: harness.ownerKind,
    remote: harness.remoteCalls.map((call) => call.route) }));
  assert.equal(harness.pickerCalls, 1);
  assert.equal(harness.saveCalls, 1);
  assert.ok(harness.freezeCalls > 1);
  assert.equal(harness.passkeyCalls, 1);
  assert.equal(harness.idb.observations.opens, 1);
  assert.equal(harness.ownerKind, "synced");
  assert.equal(harness.writes.length, 1);
  assert.equal(harness.writes[0].includes(READABLE), false);
  assert.equal(harness.writes[0].includes("masterKey"), false);
  assert.equal(harness.remoteCalls.some((call) => JSON.stringify(call.body).includes(READABLE)), false);
  const saved = await harness.context.PocketOwnerSaveBoundary.save({
    expectedSession: harness.context.capturePocketFileSaveSession(),
    freezePayload: async () => ({ schema: "portal.export.v1", nodes: [{ id: "two", label: READABLE }] }),
  });
  assert.equal(saved.ok, true, JSON.stringify(saved));
  assert.equal(saved.confirmedRemoteRevision, 2);
});

test("P045 stops before crypto, IndexedDB, passkey or remote work when recovery destination is cancelled", async () => {
  const harness = createHarness({ cancelPicker: true });
  const result = await harness.runtime.activate();
  assert.equal(result.reason, "recovery-copy-destination-deferred");
  assert.equal(harness.ownerKind, "json");
  assert.equal(harness.idb.observations.opens, 0);
  assert.equal(harness.passkeyCalls, 0);
  assert.equal(harness.remoteCalls.length, 0);
});

test("P045 preserves source ownership when its one dirty-source Save does not confirm", async () => {
  const harness = createHarness({ dirty: true, saveResult: { ok: false, reason: "cancelled" } });
  const result = await harness.runtime.activate();
  assert.equal(result.reason, "source-save-cancelled");
  assert.equal(harness.saveCalls, 1);
  assert.equal(harness.pickerCalls, 0);
  assert.equal(harness.idb.observations.opens, 0);
  assert.equal(harness.ownerKind, "json");
});

test("P045 detects source replacement during its explicit dirty-source Save", async () => {
  const harness = createHarness({ dirty: true, saveChangesOwner: true });
  const result = await harness.runtime.activate();
  assert.equal(result.reason, "source-session-changed");
  assert.equal(harness.saveCalls, 1);
  assert.equal(harness.pickerCalls, 0);
  assert.equal(harness.idb.observations.opens, 0);
  assert.equal(harness.remoteCalls.length, 0);
});

test("P045a commits a live details draft before local Save and the one activation freeze", async () => {
  const details = "P045A-DETAILS-MUST-REACH-THE-SOURCE-AND-CIPHERTEXT";
  const harness = createHarness({ detailsDraft: details });
  const result = await harness.runtime.activate();
  assert.equal(result.ok, true, JSON.stringify(result));
  assert.equal(harness.detailsCommitCalls, 1);
  assert.equal(harness.saveCalls, 1);
  assert.ok(harness.freezeCalls > 1);
  assert.equal(harness.savedPayloads[0].nodes[0].details, details);
  assert.equal(harness.frozenPayloads.some((payload) => payload.nodes[0].details === details), true);
  assert.equal(harness.remoteCalls.some((call) => JSON.stringify(call.body).includes(details)), false);
  assert.equal(harness.ownerKind, "synced");
});

test("P045a commits a live inline-title draft before local Save and the one activation freeze", async () => {
  const title = "P045A title retained before activation";
  const harness = createHarness({ inlineDraft: title });
  const result = await harness.runtime.activate();
  assert.equal(result.ok, true, JSON.stringify(result));
  assert.equal(harness.inlineCommitCalls, 1);
  assert.equal(harness.saveCalls, 1);
  assert.ok(harness.freezeCalls > 1);
  assert.equal(harness.savedPayloads[0].nodes[0].label, title);
  assert.equal(harness.frozenPayloads.some((payload) => payload.nodes[0].label === title), true);
  assert.equal(harness.remoteCalls.some((call) => JSON.stringify(call.body).includes(title)), false);
  assert.equal(harness.ownerKind, "synced");
});

test("P045a stops safely when an editor draft cannot commit or its source changes", async () => {
  for (const options of [
    { detailsDraft: "Retain details", detailsCommitFails: true, expected: "editor-draft-commit-failed" },
    { inlineDraft: "Retain title", inlineCommitFails: true, expected: "editor-draft-commit-failed" },
    { detailsDraft: "Stale details", editorChangesOwner: true, expected: "source-session-changed" },
  ]) {
    const harness = createHarness(options);
    const result = await harness.runtime.activate();
    assert.equal(result.reason, options.expected);
    assert.equal(harness.ownerKind, "json");
    assert.equal(harness.pickerCalls, 0);
    assert.equal(harness.idb.observations.opens, 0);
    assert.equal(harness.passkeyCalls, 0);
    assert.equal(harness.remoteCalls.length, 0);
  }
});

test("P045a leaves clean active editor seams on the existing clean-source path", async () => {
  const harness = createHarness();
  const result = await harness.runtime.activate();
  assert.equal(result.ok, true, JSON.stringify(result));
  assert.equal(harness.detailsCommitCalls, 0);
  assert.equal(harness.inlineCommitCalls, 0);
  assert.equal(harness.saveCalls, 0);
});

test("P045 maps browser passkey cancellation safely and does not adopt", async () => {
  const harness = createHarness({ passkeyError: Object.assign(new Error("cancelled"), { name: "NotAllowedError" }) });
  const result = await harness.runtime.activate();
  assert.equal(result.reason, "account-registration-failed");
  assert.equal(result.locallyDurable, true);
  assert.equal(harness.ownerKind, "json");
  assert.equal(harness.passkeyCalls, 1);
  assert.equal(harness.remoteCalls.some((call) => call.route === "finishRegistration"), false);
});

test("P045 keeps unavailable, unsupported and browser-security passkey failures local and unadopted", async () => {
  const cases = [
    { passkeyUnavailable: true },
    { passkeyError: Object.assign(new Error("unsupported"), { name: "NotSupportedError" }) },
    { passkeyError: Object.assign(new Error("security"), { name: "SecurityError" }) },
  ];
  for (const options of cases) {
    const harness = createHarness(options);
    const result = await harness.runtime.activate();
    assert.equal(result.reason, "account-registration-failed");
    assert.equal(result.locallyDurable, true);
    assert.equal(harness.ownerKind, "json");
    assert.equal(harness.remoteCalls.some((call) => call.route === "finishRegistration"), false);
  }
});

test("P045 explicitly resumes an outstanding local recovery copy without duplicate remote work", async () => {
  const harness = createHarness({ copyFails: true });
  const first = await harness.runtime.activate();
  assert.equal(first.reason, "recovery-copy-not-stored");
  assert.equal(harness.ownerKind, "json");
  const remoteCount = harness.remoteCalls.length;
  harness.allowCopy();
  const resumed = await harness.runtime.resume({ activationId: first.activationId });
  assert.equal(resumed.ok, true, JSON.stringify(resumed));
  assert.equal(harness.ownerKind, "synced");
  assert.equal(harness.remoteCalls.length, remoteCount);
  assert.equal(harness.pickerCalls, 2);
});

test("P045a refuses explicit resume when later local work would not be part of the staged payload", async () => {
  const harness = createHarness({ copyFails: true });
  const first = await harness.runtime.activate();
  assert.equal(first.reason, "recovery-copy-not-stored");
  const remoteCount = harness.remoteCalls.length;
  harness.context.state.ops.push({ sequence: 1, type: "later-local-edit" });
  harness.allowCopy();
  const resumed = await harness.runtime.resume({ activationId: first.activationId });
  assert.equal(resumed.reason, "source-has-unsaved-changes");
  assert.equal(harness.ownerKind, "json");
  assert.equal(harness.remoteCalls.length, remoteCount);
});

test("P049a refuses stale activation after the same source session changes and is locally saved", async () => {
  const harness = createHarness({ copyFails: true });
  const first = await harness.runtime.activate();
  assert.equal(first.reason, "recovery-copy-not-stored");
  harness.context.state.nodes[0].label = "P049A-LATER-SAVED-SOURCE-EDIT";
  harness.context.state.ops.push({ sequence: 1, type: "later-local-edit" });
  assert.equal((await harness.context.exportTree()).ok, true);
  harness.allowCopy();
  const resumed = await harness.runtime.resume({ activationId: first.activationId });
  assert.equal(resumed.reason, "source-session-changed");
  assert.equal(harness.ownerKind, "json");
});

test("P045 clean Vault sources skip local Save and unsupported owners fail closed", async () => {
  const vault = createHarness({ ownerKind: "vault" });
  const result = await vault.runtime.activate();
  assert.equal(result.ok, true, JSON.stringify({ result, opens: vault.idb.observations.opens,
    transactions: vault.idb.observations.transactions, remote: vault.remoteCalls.map((call) => call.route) }));
  assert.equal(vault.saveCalls, 0);
  assert.equal(vault.ownerKind, "synced");
  const unsupported = createHarness({ ownerKind: "detached" });
  const failed = await unsupported.runtime.activate();
  assert.equal(failed.reason, "unsupported-source-owner");
  assert.equal(unsupported.pickerCalls, 0);
  assert.equal(unsupported.idb.observations.opens, 0);
});
