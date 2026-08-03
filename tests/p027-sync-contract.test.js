"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { InMemorySyncAdapter } = require("./helpers/p027-in-memory-sync-adapter.js");

const REPO_ROOT = path.resolve(__dirname, "..");
const CONTRACT_SOURCE = "js/pocket-sync-contract.js";
const PLAINTEXT_SENTINEL = "P027-READABLE-NODE-NAME-DO-NOT-SEND";

function source(relativePath) {
  return fs.readFileSync(path.join(REPO_ROOT, relativePath), "utf8");
}

function loadContract() {
  const context = {
    Object,
    Array,
    Number,
    String,
    Boolean,
    Promise,
    TypeError,
  };
  context.window = context;
  context.globalThis = context;
  vm.createContext(context);
  vm.runInContext(source(CONTRACT_SOURCE), context, { filename: CONTRACT_SOURCE });
  assert.ok(context.PocketSyncContract, "production sync contract must load");
  return context.PocketSyncContract;
}

function containsReference(value, target, seen = new Set()) {
  if (value === target) return true;
  if (!value || typeof value !== "object" || seen.has(value)) return false;
  seen.add(value);
  return Object.values(value).some((child) => containsReference(child, target, seen));
}

function makeHarness(options = {}) {
  const adapter = options.adapter || new InMemorySyncAdapter({
    available: options.remoteAvailable !== false,
    failWrite: options.remoteWriteFails === true,
  });
  const events = [];
  const sourceHandle = Object.freeze({ kind: "synthetic-source-handle" });
  const secretKey = Object.freeze({ kind: "synthetic-content-key" });
  const sourceSession = Object.freeze({
    id: 7,
    ownerKind: options.ownerKind || "json",
    handle: sourceHandle,
    displayName: options.displayName || "disposable-pocket.json",
  });
  const calls = {
    sourceSave: [],
    freeze: [],
    seal: [],
    device: [],
    adopt: [],
  };
  let current = options.current !== false;
  let sealedSequence = 0;

  const dependencies = {
    captureSourceSession() {
      events.push("source-validation");
      return options.noSource === true ? null : sourceSession;
    },
    isSourceSessionCurrent(session) {
      return current && session === sourceSession;
    },
    hasUnsavedSourceChanges() {
      return options.dirty === true;
    },
    async saveLocalSource(session) {
      events.push("source-save");
      calls.sourceSave.push(session);
      if (options.staleAfterSourceSave === true) current = false;
      if (options.sourceSaveCancelled === true) return { ok: false, cancelled: true };
      return { ok: options.sourceSaveFails !== true };
    },
    async freezePayload(session) {
      events.push("payload-freeze");
      calls.freeze.push(session);
      if (options.freezeFails === true) throw new Error("synthetic freeze failure");
      return {
        schema: "portal.export.v1",
        mainThoughtTree: [{ label: PLAINTEXT_SENTINEL }],
      };
    },
    async sealPayload(payload, metadata) {
      events.push("local-seal");
      calls.seal.push({ payload, metadata });
      if (options.sealFails === true) throw new Error("synthetic seal failure");
      sealedSequence += 1;
      return {
        encryptedRecord: Object.freeze({
          kind: "opaque-p027-test-record",
          body: `sealed-${sealedSequence}`,
        }),
        secretKey,
      };
    },
    async writeEncryptedDeviceRecord(record) {
      events.push("device-persistence");
      calls.device.push(record);
      return { ok: options.deviceWriteFails !== true, deviceRecordId: "device-record-1" };
    },
    async readRemoteState(request) {
      events.push("remote-read");
      const result = await adapter.readRemoteState(request);
      if (options.interveneAfterRead === true && result.ok === true) {
        adapter.intervene(request.syncedPocketId, { body: "other-device" });
      }
      return result;
    },
    async conditionalWriteRemote(request) {
      events.push("remote-write");
      return adapter.conditionalWriteRemote(request);
    },
    async adoptSyncedOwner(owner) {
      events.push("synced-owner-adoption");
      calls.adopt.push(owner);
      return options.adoptionFails === true ? { ok: false } : { ok: true };
    },
  };

  return {
    adapter,
    events,
    sourceHandle,
    secretKey,
    sourceSession,
    calls,
    dependencies,
    setCurrent(value) { current = value === true; },
  };
}

function syncedState(overrides = {}) {
  return {
    ownerKind: "synced",
    syncedPocketId: "synced-pocket-027",
    confirmedRemoteRevision: 0,
    pendingEncryptedRecord: null,
    ...overrides,
  };
}

test("P027 centralises the exact human copy without technical language", () => {
  const contract = loadContract();
  assert.deepEqual(
    JSON.parse(JSON.stringify(contract.COPY.turnOnSync)),
    {
      title: "Turn on sync",
      body: "Keep your Pocket available on your other devices. Your synced data will be protected so only you can read it.",
    },
  );
  assert.deepEqual(
    JSON.parse(JSON.stringify(contract.COPY.syncReady)),
    {
      title: "Sync is ready",
      body: "Your Pocket is protected and available on your devices.",
    },
  );
  assert.deepEqual(
    JSON.parse(JSON.stringify(contract.COPY.status)),
    {
      synced: "Saved · Synced",
      pending: "Saved on this device · Sync pending",
      conflict: "Pocket found newer changes from another device.",
    },
  );
  const ordinaryCopy = JSON.stringify(contract.COPY);
  for (const technicalTerm of [
    "ciphertext",
    "envelope",
    "compare-and-swap",
    "revision token",
    "key derivation",
    "remote head",
    "truth owner",
  ]) {
    assert.doesNotMatch(ordinaryCopy.toLowerCase(), new RegExp(technicalTerm));
  }
});

test("P027 plain JSON transparency uses the supplied displayed filename", () => {
  const contract = loadContract();
  const notice = contract.plainJsonNotice("Murray's disposable Pocket.json");
  assert.equal(notice.title, "Your original file will stay where it is");
  assert.equal(
    notice.body,
    "Murray's disposable Pocket.json is readable and will not be changed or deleted. After sync is working, you can decide whether to keep or remove it.",
  );
  assert.throws(() => contract.plainJsonNotice(""), /displayed filename/i);
});

test("P027 activation rejects unsupported and stale local owners", async (t) => {
  const contract = loadContract();
  for (const scenario of [
    { name: "no owner", options: { noSource: true }, reason: "unsupported-source-owner" },
    { name: "none owner", options: { ownerKind: "none" }, reason: "unsupported-source-owner" },
    { name: "detached owner", options: { ownerKind: "detached" }, reason: "unsupported-source-owner" },
    { name: "stale owner", options: { current: false }, reason: "source-session-changed" },
  ]) {
    await t.test(scenario.name, async () => {
      const harness = makeHarness(scenario.options);
      const result = await contract.activate(harness.dependencies, {
        syncedPocketId: "synced-pocket-027",
      });
      assert.equal(result.ok, false);
      assert.equal(result.reason, scenario.reason);
      assert.equal(result.sourceOwnerPreserved, true);
      assert.equal(harness.calls.adopt.length, 0);
      assert.equal(harness.adapter.calls.length, 0);
    });
  }
});

test("P027 dirty activation saves the local source first and stops safely on failure", async (t) => {
  const contract = loadContract();
  for (const scenario of [
    { name: "failed Save", options: { dirty: true, sourceSaveFails: true }, reason: "source-save-failed" },
    { name: "cancelled Save", options: { dirty: true, sourceSaveCancelled: true }, reason: "source-save-cancelled" },
    { name: "session changes during Save", options: { dirty: true, staleAfterSourceSave: true }, reason: "source-session-changed" },
  ]) {
    await t.test(scenario.name, async () => {
      const harness = makeHarness(scenario.options);
      const result = await contract.activate(harness.dependencies, {
        syncedPocketId: "synced-pocket-027",
      });
      assert.equal(result.reason, scenario.reason);
      assert.deepEqual(harness.events, ["source-validation", "source-save"]);
      assert.equal(harness.calls.sourceSave.length, 1);
      assert.equal(harness.calls.freeze.length, 0);
      assert.equal(harness.calls.device.length, 0);
      assert.equal(harness.adapter.calls.length, 0);
      assert.equal(harness.calls.adopt.length, 0);
      assert.equal(result.sourceOwnerPreserved, true);
    });
  }
});

test("P027 initial activation follows the locked order and adopts exactly once after remote success", async () => {
  const contract = loadContract();
  const harness = makeHarness({ dirty: true });
  const result = await contract.activate(harness.dependencies, {
    syncedPocketId: "synced-pocket-027",
    expectedRemoteRevision: 0,
  });

  assert.equal(result.ok, true);
  assert.equal(result.reason, "activated");
  assert.equal(result.adopted, true);
  assert.equal(result.status, "Saved · Synced");
  assert.equal(result.confirmedRemoteRevision, 1);
  assert.deepEqual(harness.events, [
    "source-validation",
    "source-save",
    "payload-freeze",
    "local-seal",
    "device-persistence",
    "remote-read",
    "remote-write",
    "synced-owner-adoption",
  ]);
  assert.equal(harness.calls.adopt.length, 1);
  assert.deepEqual(
    JSON.parse(JSON.stringify(harness.calls.adopt[0])),
    {
      ownerKind: "synced",
      syncedPocketId: "synced-pocket-027",
      confirmedRemoteRevision: 1,
      syncPending: false,
    },
  );
});

test("P027 activation failures never adopt or replace the local JSON or Vault owner", async (t) => {
  const contract = loadContract();
  const scenarios = [
    { name: "freeze", options: { freezeFails: true }, reason: "payload-freeze-failed" },
    { name: "seal", options: { sealFails: true }, reason: "local-seal-failed" },
    { name: "device", options: { deviceWriteFails: true }, reason: "device-save-failed" },
    { name: "remote unavailable", options: { remoteAvailable: false }, reason: "initial-remote-unavailable" },
    { name: "remote write", options: { remoteWriteFails: true }, reason: "initial-remote-write-failed" },
    { name: "adoption", options: { adoptionFails: true }, reason: "synced-owner-adoption-failed" },
  ];
  for (const ownerKind of ["json", "vault"]) {
    for (const scenario of scenarios) {
      await t.test(`${ownerKind}: ${scenario.name}`, async () => {
        const harness = makeHarness({ ownerKind, ...scenario.options });
        const result = await contract.activate(harness.dependencies, {
          syncedPocketId: "synced-pocket-027",
        });
        assert.equal(result.ok, false);
        assert.equal(result.reason, scenario.reason);
        assert.equal(result.sourceOwnerPreserved, true);
        assert.equal(harness.calls.adopt.length, scenario.name === "adoption" ? 1 : 0);
      });
    }
  }
});

test("P027 activation refuses a non-empty remote and never overwrites it", async () => {
  const contract = loadContract();
  const adapter = new InMemorySyncAdapter();
  adapter.seed("synced-pocket-027", 1, { body: "existing-remote-record" });
  const harness = makeHarness({ adapter });
  const result = await contract.activate(harness.dependencies, {
    syncedPocketId: "synced-pocket-027",
    expectedRemoteRevision: 0,
  });

  assert.equal(result.ok, false);
  assert.equal(result.reason, "newer-remote");
  assert.equal(result.conflict, true);
  assert.equal(result.sourceOwnerPreserved, true);
  assert.equal(result.status, "Pocket found newer changes from another device.");
  assert.equal(adapter.calls.filter((call) => call.type === "write").length, 0);
  assert.equal(adapter.records.get("synced-pocket-027").encryptedRecord.body, "existing-remote-record");
  assert.equal(harness.calls.adopt.length, 0);
});

test("P027 activation never leaks source handles, readable content or keys across device and remote boundaries", async () => {
  const contract = loadContract();
  const harness = makeHarness();
  const result = await contract.activate(harness.dependencies, {
    syncedPocketId: "synced-pocket-027",
  });
  assert.equal(result.ok, true);

  const boundaryArguments = [
    ...harness.calls.device,
    ...harness.adapter.calls.map((call) => call.request),
    ...harness.calls.adopt,
  ];
  for (const argument of boundaryArguments) {
    assert.equal(containsReference(argument, harness.sourceHandle), false);
  }
  const remoteArguments = JSON.stringify(harness.adapter.calls);
  assert.equal(remoteArguments.includes(PLAINTEXT_SENTINEL), false);
  assert.equal(containsReference(harness.adapter.calls, harness.secretKey), false);
  assert.equal(remoteArguments.includes("disposable-pocket.json"), false);
});

test("P027 synced Save is device-first and returns full success with an advanced revision", async () => {
  const contract = loadContract();
  const harness = makeHarness();
  const result = await contract.save(harness.dependencies, syncedState(), { hasNewChanges: true });

  assert.equal(result.ok, true);
  assert.equal(result.locallySaved, true);
  assert.equal(result.remotelySynced, true);
  assert.equal(result.syncPending, false);
  assert.equal(result.confirmedRemoteRevision, 1);
  assert.equal(result.pendingEncryptedRecord, null);
  assert.equal(result.status, "Saved · Synced");
  assert.deepEqual(harness.events, [
    "payload-freeze",
    "local-seal",
    "device-persistence",
    "remote-read",
    "remote-write",
  ]);
});

test("P027 device persistence failure leaves content dirty and never touches remote state", async () => {
  const contract = loadContract();
  const harness = makeHarness({ deviceWriteFails: true });
  const result = await contract.save(harness.dependencies, syncedState(), { hasNewChanges: true });

  assert.equal(result.ok, false);
  assert.equal(result.reason, "device-save-failed");
  assert.equal(result.locallySaved, false);
  assert.equal(result.remainsDirty, true);
  assert.equal(result.confirmedRemoteRevision, 0);
  assert.equal(harness.adapter.calls.length, 0);
  assert.deepEqual(harness.events, ["payload-freeze", "local-seal", "device-persistence"]);
});

test("P027 unavailable or failed remote leaves a locally safe pending record", async (t) => {
  const contract = loadContract();
  for (const scenario of [
    { name: "unavailable", options: { remoteAvailable: false } },
    { name: "write failure", options: { remoteWriteFails: true } },
  ]) {
    await t.test(scenario.name, async () => {
      const harness = makeHarness(scenario.options);
      const result = await contract.save(harness.dependencies, syncedState(), { hasNewChanges: true });
      assert.equal(result.ok, true);
      assert.equal(result.locallySaved, true);
      assert.equal(result.remotelySynced, false);
      assert.equal(result.syncPending, true);
      assert.equal(result.confirmedRemoteRevision, 0);
      assert.ok(result.pendingEncryptedRecord);
      assert.equal(result.status, "Saved on this device · Sync pending");
      assert.equal(harness.events.indexOf("device-persistence") < harness.events.indexOf("remote-read"), true);
    });
  }
});

test("P027 newer remote state is retained without overwrite or automatic merge", async () => {
  const contract = loadContract();
  const adapter = new InMemorySyncAdapter();
  adapter.seed("synced-pocket-027", 2, { body: "newer-other-device-record" });
  const harness = makeHarness({ adapter });
  const result = await contract.save(harness.dependencies, syncedState({
    confirmedRemoteRevision: 1,
  }), { hasNewChanges: true });

  assert.equal(result.ok, false);
  assert.equal(result.reason, "newer-remote");
  assert.equal(result.locallySaved, true);
  assert.equal(result.syncPending, true);
  assert.equal(result.conflict, true);
  assert.equal(result.confirmedRemoteRevision, 1);
  assert.equal(result.actualRemoteRevision, 2);
  assert.equal(result.status, "Pocket found newer changes from another device.");
  assert.equal(adapter.calls.filter((call) => call.type === "write").length, 0);
  assert.equal(adapter.records.get("synced-pocket-027").encryptedRecord.body, "newer-other-device-record");
  assert.equal(harness.events.includes("merge"), false);
});

test("P027 conditional write detects an intervening device write", async () => {
  const contract = loadContract();
  const adapter = new InMemorySyncAdapter();
  adapter.seed("synced-pocket-027", 1, { body: "confirmed-record" });
  const harness = makeHarness({ adapter, interveneAfterRead: true });
  const result = await contract.save(harness.dependencies, syncedState({
    confirmedRemoteRevision: 1,
  }), { hasNewChanges: true });

  assert.equal(result.reason, "newer-remote");
  assert.equal(result.conflict, true);
  assert.equal(result.actualRemoteRevision, 2);
  assert.equal(adapter.calls.filter((call) => call.type === "write").length, 1);
  assert.equal(adapter.records.get("synced-pocket-027").revision, 2);
  assert.equal(adapter.records.get("synced-pocket-027").encryptedRecord.body, "other-device");
});

test("P027 explicit Save retries pending sync with no new edits and clears pending on success", async () => {
  const contract = loadContract();
  const adapter = new InMemorySyncAdapter({ available: false });
  const firstHarness = makeHarness({ adapter });
  const pending = await contract.save(firstHarness.dependencies, syncedState(), { hasNewChanges: true });
  assert.equal(pending.syncPending, true);
  const pendingRecord = pending.pendingEncryptedRecord;

  adapter.available = true;
  adapter.calls.length = 0;
  const retryHarness = makeHarness({ adapter });
  const retried = await contract.retryPending(retryHarness.dependencies, syncedState({
    confirmedRemoteRevision: pending.confirmedRemoteRevision,
    pendingEncryptedRecord: pendingRecord,
  }));

  assert.equal(retried.ok, true);
  assert.equal(retried.reason, "synced");
  assert.equal(retried.syncPending, false);
  assert.equal(retried.pendingEncryptedRecord, null);
  assert.equal(retried.confirmedRemoteRevision, 1);
  assert.equal(retried.status, "Saved · Synced");
  assert.equal(retryHarness.calls.freeze.length, 0);
  assert.equal(retryHarness.calls.seal.length, 0);
  assert.strictEqual(retryHarness.calls.device[0].encryptedRecord, pendingRecord);
  assert.deepEqual(retryHarness.events, ["device-persistence", "remote-read", "remote-write"]);
});

test("P027 remains unloaded, deterministic and free of production side effects", () => {
  const contractSource = source(CONTRACT_SOURCE);
  const indexSource = source("index.html");
  const ioSource = source("js/pocket-io-browser.js");
  const serviceWorkerSource = source("sw.js");

  assert.doesNotMatch(indexSource, /pocket-sync-contract\.js/);
  assert.doesNotMatch(serviceWorkerSource, /pocket-sync-contract\.js/);
  assert.doesNotMatch(ioSource, /\["none", "json", "vault", "detached", "synced"\]/);
  assert.doesNotMatch(contractSource, /\bdocument\s*\./);
  assert.doesNotMatch(contractSource, /\blocalStorage\b|\bindexedDB\b/);
  assert.doesNotMatch(contractSource, /\bfetch\s*\(|XMLHttpRequest|WebSocket/);
  assert.doesNotMatch(contractSource, /setTimeout|setInterval|requestAnimationFrame/);
  assert.doesNotMatch(contractSource, /BroadcastChannel|ServiceWorker|SharedWorker/);
});
