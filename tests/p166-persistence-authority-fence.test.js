"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { createServiceCore } = require("../sync-service/pocket-sync-service-core.js");
const { createPostgresStore } = require("../sync-service/pocket-sync-postgres-store.js");
const { createMemoryServiceStore } = require("./helpers/p034-memory-service-store.js");

const ROOT = path.resolve(__dirname, "..");
const NOW = Date.parse("2044-01-01T00:00:00.000Z");
const ORIGIN = "https://sync.pocket.example";
const b64 = (n, seed = 1) => Buffer.from(Uint8Array.from({ length: n }, (_, i) => (seed + i) & 255)).toString("base64url");
const plain = (v) => JSON.parse(JSON.stringify(v));
const encrypted = (seed = 1) => ({ format: "pocket.sync.content.opaque", version: 1,
  algorithm: "AES-GCM-256", nonce: b64(12, seed), ciphertext: b64(32, seed + 30) });
const context = (sessionId = "session") => ({ method: "POST", origin: ORIGIN,
  fetchSite: "same-origin", contentType: "application/json", sessionId });
const call = (body, sessionId = "session") => ({ context: context(sessionId), body });

function seed() {
  return {
    accounts: { account: { kind: "pocket.sync.service-account", schemaVersion: 1, storeVersion: 1,
      accountId: "account", accountPolicyVersion: 1, prfEvaluationInput: b64(32, 2),
      credentialIds: ["credential"], syncedPocketId: "pocket", createdAt: "2043-01-01T00:00:00.000Z" } },
    credentials: { credential: { kind: "pocket.sync.service-credential", schemaVersion: 1, storeVersion: 1,
      credentialId: "credential", accountId: "account", credentialVersion: 1, status: "active",
      publicKey: b64(64, 4), publicKeyAlgorithm: -7, signCount: 0, transports: ["internal"],
      backupEligible: true, backedUp: true, createdAt: "2043-01-01T00:00:00.000Z" } },
    sessions: { session: { kind: "pocket.sync.service-session", schemaVersion: 1, storeVersion: 1,
      sessionId: "session", accountId: "account", credentialId: "credential", status: "active",
      createdAt: "2043-01-01T00:00:00.000Z", expiresAt: "2045-01-01T00:00:00.000Z", replacedBy: null } },
    pockets: { pocket: { kind: "pocket.sync.service-pocket", schemaVersion: 1, storeVersion: 1,
      accountId: "account", syncedPocketId: "pocket", revision: 1,
      encryptedRecordSize: 32, encryptedRecord: encrypted(8), createdAt: "2043-01-01T00:00:00.000Z" } },
    persistenceAuthorities: { pocket: { kind: "pocket.sync.persistence-authority", schemaVersion: 1,
      storeVersion: 1, accountId: "account", syncedPocketId: "pocket", authorityRevision: 1,
      currentMode: "whole-record", transition: null, rollbackRevision: null, adoptionHead: null } },
  };
}

function headStore() {
  let head = { schema: "pocket.starling.head.v1", revision: 1, sealRef: "seal-one" };
  return Object.freeze({
    async putObject() { return { ok: true, created: true }; },
    async getObject() { return null; },
    async presence(_pocket, refs) { return refs.map((storageRef) => ({ storageRef, present: true })); },
    async initialiseHead() { return head; },
    async readHead() { return head; },
    async compareAndSetHead(_pocket, expected, candidate) {
      if (head.revision !== expected.revision || head.sealRef !== expected.sealRef) return { ok: false, reason: "head-conflict" };
      head = { schema: head.schema, revision: head.revision + 1, sealRef: candidate };
      return { ok: true, head };
    },
  });
}

function coreWithStore(store, objectHeadStore = headStore()) {
  return createServiceCore({ store, objectHeadStore,
    webAuthnVerifier: Object.freeze({ async verifyRegistration() { throw new Error("unused"); }, async verifyAuthentication() { throw new Error("unused"); } }),
    recoveryProofVerifier: Object.freeze({ async verifyRecoveryProof() { return { verified: true }; } }),
    randomBytes: (n) => Uint8Array.from({ length: n }, (_, i) => i + 1), now: () => NOW,
    trustedOrigin: ORIGIN, rpId: "sync.pocket.example", rpName: "Pocket", credentialAlgorithms: [-7],
    ceremonyLifetimeMs: 300000, sessionLifetimeMs: 86400000 });
}

function upload(operationId, expectedRevision, seed = 20) {
  return { apiVersion: 1, syncedPocketId: "pocket", expectedRevision, operationId,
    logicalChangeId: `${operationId}-change`, attemptKind: "new-change", encryptedRecord: encrypted(seed) };
}
function fence(operationId, expectedAuthorityRevision, transitionId = "transition-one") {
  return { apiVersion: 1, operationId, syncedPocketId: "pocket", expectedAuthorityRevision, transitionId };
}
function cas(operationId, revision = 1, sealRef = "seal-one", candidate = "seal-two") {
  return { apiVersion: 1, operationId, syncedPocketId: "pocket",
    expectedHead: { schema: "pocket.starling.head.v1", revision, sealRef }, candidateSealStorageRef: candidate };
}

function harness(storeOverride = null) {
  const driver = createMemoryServiceStore({ seed: seed() });
  const store = storeOverride ? storeOverride(driver.store) : driver.store;
  return { driver, core: coreWithStore(store) };
}

test("P166 authority is shared server metadata, fences both mutation families, and release restores admission", async () => {
  const h = harness();
  const before = h.driver.snapshot().pockets.pocket;
  const read = await h.core.readPersistenceAuthority(call({ apiVersion: 1, operationId: "read-one", syncedPocketId: "pocket" }));
  assert.equal(read.body.authority.authorityRevision, 1);
  assert.equal(read.body.authority.currentMode, "whole-record");
  assert.equal(read.body.authority.transition, null);

  const saved = await h.core.conditionalUpload(call(upload("save-one", 1)));
  assert.equal(saved.status, 200);
  const mirrored = await h.core.compareAndSetShadowHead(call(cas("cas-one")));
  assert.equal(mirrored.status, 200);

  const acquired = await h.core.acquirePersistenceAuthorityFence(call(fence("fence-one", 1)));
  assert.equal(acquired.status, 200);
  assert.equal(acquired.body.authority.authorityRevision, 2);
  assert.deepEqual(plain(acquired.body.authority.transition), { transitionId: "transition-one", expectedAuthorityRevision: 1 });

  await assert.rejects(h.core.conditionalUpload(call(upload("blocked-save", 2))),
    (error) => error?.code === "service-persistence-authority-transition-active" && error.status === 409);
  await assert.rejects(h.core.compareAndSetShadowHead(call(cas("blocked-cas", 2, "seal-two", "seal-three"))),
    (error) => error?.code === "service-persistence-authority-transition-active" && error.status === 409);

  const during = h.driver.snapshot();
  assert.deepEqual(during.pockets.pocket.encryptedRecord, saved.body.revision === 2 ? encrypted(20) : before.encryptedRecord);
  const replay = await h.core.acquirePersistenceAuthorityFence(call(fence("fence-replay", 1)));
  assert.equal(replay.status, 200);
  assert.equal(replay.body.replayed, true);
  const stale = await h.core.acquirePersistenceAuthorityFence(call(fence("fence-stale", 1, "other-transition")));
  assert.equal(stale.status, 409);
  assert.equal(stale.body.reason, "authority-conflict");

  const released = await h.core.releasePersistenceAuthorityFence(call(fence("release-one", 2)));
  assert.equal(released.status, 200);
  assert.equal(released.body.authority.authorityRevision, 3);
  assert.equal(released.body.authority.transition, null);
  const savedAgain = await h.core.conditionalUpload(call(upload("save-two", 2, 40)));
  assert.equal(savedAgain.status, 200);
  assert.equal(savedAgain.body.revision, 3);
});

test("P166 exact operation replay stays truthful while a transition fence blocks only new mutations", async () => {
  const h = harness();
  const first = await h.core.conditionalUpload(call(upload("same-save", 1)));
  assert.equal(first.status, 200);
  await h.core.acquirePersistenceAuthorityFence(call(fence("fence", 1)));
  const retry = upload("same-save", 1);
  retry.attemptKind = "idempotent-retry";
  const replay = await h.core.conditionalUpload(call(retry));
  assert.equal(replay.status, 200);
  assert.equal(replay.body.replayed, true);
  await assert.rejects(h.core.conditionalUpload(call(upload("new-save", 2))),
    (error) => error?.code === "service-persistence-authority-transition-active");
});

function controlledFirstLock(baseStore) {
  let firstEnteredResolve;
  let releaseFirstResolve;
  const firstEntered = new Promise((resolve) => { firstEnteredResolve = resolve; });
  const releaseFirst = new Promise((resolve) => { releaseFirstResolve = resolve; });
  let calls = 0;
  const transact = async (...args) => baseStore.transact(...args);
  Object.defineProperty(transact, "withPocketAuthorityLock", { value(pocket, callback) {
    calls += 1;
    const ordinal = calls;
    return baseStore.transact.withPocketAuthorityLock(pocket, async () => {
      if (ordinal === 1) { firstEnteredResolve(); await releaseFirst; }
      return callback();
    });
  } });
  return {
    store: Object.freeze({ transact }),
    firstEntered,
    release: () => releaseFirstResolve(),
  };
}

test("P166 in-flight whole-record mutation and fence acquisition serialize in both directions", async () => {
  {
    const base = createMemoryServiceStore({ seed: seed() });
    const controlled = controlledFirstLock(base.store);
    const core = coreWithStore(controlled.store);
    const savePromise = core.conditionalUpload(call(upload("racing-save", 1)));
    await controlled.firstEntered;
    let fenceSettled = false;
    const fencePromise = core.acquirePersistenceAuthorityFence(call(fence("racing-fence", 1))).then((v) => { fenceSettled = true; return v; });
    await Promise.resolve();
    assert.equal(fenceSettled, false);
    controlled.release();
    const [saveResult, fenceResult] = await Promise.all([savePromise, fencePromise]);
    assert.equal(saveResult.status, 200);
    assert.equal(fenceResult.status, 200);
    assert.equal(base.snapshot().pockets.pocket.revision, 2);
    assert.notEqual(base.snapshot().persistenceAuthorities.pocket.transition, null);
  }
  {
    const base = createMemoryServiceStore({ seed: seed() });
    const controlled = controlledFirstLock(base.store);
    const core = coreWithStore(controlled.store);
    const fencePromise = core.acquirePersistenceAuthorityFence(call(fence("racing-fence-first", 1)));
    await controlled.firstEntered;
    let saveSettled = false;
    const savePromise = core.conditionalUpload(call(upload("racing-save-second", 1))).then(
      (v) => { saveSettled = true; return v; },
      (error) => { saveSettled = true; throw error; }
    );
    await Promise.resolve();
    assert.equal(saveSettled, false);
    controlled.release();
    const fenced = await fencePromise;
    assert.equal(fenced.status, 200);
    await assert.rejects(savePromise, (error) => error?.code === "service-persistence-authority-transition-active");
    assert.equal(base.snapshot().pockets.pocket.revision, 1);
  }
});

test("P166 in-flight Head CAS and fence acquisition serialize in both directions", async () => {
  {
    const base = createMemoryServiceStore({ seed: seed() });
    const controlled = controlledFirstLock(base.store);
    const objectHeadStore = headStore();
    const core = coreWithStore(controlled.store, objectHeadStore);
    const casPromise = core.compareAndSetShadowHead(call(cas("racing-cas-first")));
    await controlled.firstEntered;
    let fenceSettled = false;
    const fencePromise = core.acquirePersistenceAuthorityFence(call(fence("racing-fence-after-cas", 1)))
      .then((value) => { fenceSettled = true; return value; });
    await Promise.resolve();
    assert.equal(fenceSettled, false);
    controlled.release();
    const [casResult, fenceResult] = await Promise.all([casPromise, fencePromise]);
    assert.equal(casResult.status, 200);
    assert.deepEqual(plain(casResult.body.head), {
      schema: "pocket.starling.head.v1", revision: 2, sealRef: "seal-two",
    });
    assert.equal(fenceResult.status, 200);
    assert.notEqual(base.snapshot().persistenceAuthorities.pocket.transition, null);
  }
  {
    const base = createMemoryServiceStore({ seed: seed() });
    const controlled = controlledFirstLock(base.store);
    const objectHeadStore = headStore();
    const core = coreWithStore(controlled.store, objectHeadStore);
    const fencePromise = core.acquirePersistenceAuthorityFence(call(fence("racing-fence-first-head", 1)));
    await controlled.firstEntered;
    let casSettled = false;
    const casPromise = core.compareAndSetShadowHead(call(cas("racing-cas-after-fence"))).then(
      (value) => { casSettled = true; return value; },
      (error) => { casSettled = true; throw error; }
    );
    await Promise.resolve();
    assert.equal(casSettled, false);
    controlled.release();
    const fenced = await fencePromise;
    assert.equal(fenced.status, 200);
    await assert.rejects(casPromise,
      (error) => error?.code === "service-persistence-authority-transition-active" && error.status === 409);
    assert.deepEqual(plain(await objectHeadStore.readHead("pocket")), {
      schema: "pocket.starling.head.v1", revision: 1, sealRef: "seal-one",
    });
  }
});

test("P166 PostgreSQL store takes and releases the shared advisory lock around the whole callback", async () => {
  const events = [];
  const client = { async query(sql, values) {
    if (sql.includes("pg_advisory_lock")) { events.push(["lock", values[0]]); return { rows: [{ locked: null }], rowCount: 1 }; }
    if (sql.includes("pg_advisory_unlock")) { events.push(["unlock", values[0]]); return { rows: [{ unlocked: true }], rowCount: 1 }; }
    throw new Error(sql);
  }, release() { events.push(["release"]); } };
  const store = createPostgresStore({ pool: { async connect() { events.push(["connect"]); return client; } } });
  const result = await store.transact.withPocketAuthorityLock("pocket", async () => { events.push(["callback"]); return 17; });
  assert.equal(result, 17);
  assert.deepEqual(events.map((entry) => entry[0]), ["connect", "lock", "callback", "unlock", "release"]);
});

test("P166 migration backfills operational authority metadata without rewriting encrypted Pocket content", () => {
  const sql = fs.readFileSync(path.join(ROOT, "sync-service/migrations/003-pocket-sync-persistence-authority.sql"), "utf8");
  assert.match(sql, /persistenceAuthorities/);
  assert.match(sql, /WHERE collection = 'pockets'/);
  assert.doesNotMatch(sql, /UPDATE\s+public\.pocket_sync_records[\s\S]*encryptedRecord/i);
  assert.doesNotMatch(sql, /currentMode['\"]?\s*[,=]\s*['\"]starling/i);
});
