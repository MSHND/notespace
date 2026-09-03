"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { createServiceCore } = require("../sync-service/pocket-sync-service-core.js");
const { createMemoryServiceStore } = require("./helpers/p034-memory-service-store.js");

const NOW = Date.parse("2046-01-01T00:00:00.000Z");
const ORIGIN = "https://sync.pocket.example";
const b64 = (n, seed = 1) => Buffer.from(Uint8Array.from({ length: n }, (_, i) => (seed + i) & 255)).toString("base64url");
const encrypted = (seed = 1) => ({ format: "pocket.sync.content.opaque", version: 1,
  algorithm: "AES-GCM-256", nonce: b64(12, seed), ciphertext: b64(32, seed + 20) });
const clone = (value) => JSON.parse(JSON.stringify(value));
const call = (body) => ({ context: { method: "POST", origin: ORIGIN, fetchSite: "same-origin",
  contentType: "application/json", sessionId: "session" }, body });

function seed() {
  return {
    accounts: { account: { kind: "pocket.sync.service-account", schemaVersion: 1, storeVersion: 1,
      accountId: "account", accountPolicyVersion: 1, prfEvaluationInput: b64(32, 2),
      credentialIds: ["credential"], syncedPocketId: "pocket", createdAt: "2045-01-01T00:00:00.000Z" } },
    credentials: { credential: { kind: "pocket.sync.service-credential", schemaVersion: 1, storeVersion: 1,
      credentialId: "credential", accountId: "account", credentialVersion: 1, status: "active",
      publicKey: b64(64, 4), publicKeyAlgorithm: -7, signCount: 0, transports: ["internal"],
      backupEligible: true, backedUp: true, createdAt: "2045-01-01T00:00:00.000Z" } },
    sessions: { session: { kind: "pocket.sync.service-session", schemaVersion: 1, storeVersion: 1,
      sessionId: "session", accountId: "account", credentialId: "credential", status: "active",
      createdAt: "2045-01-01T00:00:00.000Z", expiresAt: "2047-01-01T00:00:00.000Z", replacedBy: null } },
    pockets: { pocket: { kind: "pocket.sync.service-pocket", schemaVersion: 1, storeVersion: 1,
      accountId: "account", syncedPocketId: "pocket", revision: 1, encryptedRecordSize: 32,
      encryptedRecord: encrypted(9), createdAt: "2045-01-01T00:00:00.000Z" } },
    persistenceAuthorities: { pocket: { kind: "pocket.sync.persistence-authority", schemaVersion: 1,
      storeVersion: 1, accountId: "account", syncedPocketId: "pocket", authorityRevision: 1,
      currentMode: "whole-record", transition: null, rollbackRevision: null, adoptionHead: null } },
  };
}

function headDriver() {
  let head = { schema: "pocket.starling.head.v1", revision: 1, sealRef: "seal-one" };
  return {
    store: Object.freeze({
      async putObject() { return { ok: true, created: true }; },
      async getObject() { return null; },
      async presence(_pocket, refs) { return refs.map((storageRef) => ({ storageRef, present: true })); },
      async initialiseHead() { return head; },
      async readHead() { return head; },
      async compareAndSetHead(_pocket, expected, candidate) {
        if (head.revision !== expected.revision || head.sealRef !== expected.sealRef) {
          return { ok: false, reason: "head-conflict", head };
        }
        head = { schema: head.schema, revision: head.revision + 1, sealRef: candidate };
        return { ok: true, head };
      },
    }),
    head: () => clone(head),
  };
}

function core(driver, heads, store = driver.store) {
  return createServiceCore({ store, objectHeadStore: heads.store,
    webAuthnVerifier: Object.freeze({ async verifyRegistration() { throw new Error("unused"); },
      async verifyAuthentication() { throw new Error("unused"); } }),
    recoveryProofVerifier: Object.freeze({ async verifyRecoveryProof() { return { verified: true }; } }),
    randomBytes: (n) => Uint8Array.from({ length: n }, (_, i) => i + 1), now: () => NOW,
    trustedOrigin: ORIGIN, rpId: "sync.pocket.example", rpName: "Pocket", credentialAlgorithms: [-7],
    ceremonyLifetimeMs: 300000, sessionLifetimeMs: 86400000 });
}

function upload(operationId, expectedRevision, attemptKind = "new-change") {
  return { apiVersion: 1, syncedPocketId: "pocket", expectedRevision, operationId,
    logicalChangeId: `${operationId}-change`, attemptKind, encryptedRecord: encrypted(40) };
}

function fence(operationId, expectedAuthorityRevision) {
  return { apiVersion: 1, operationId, syncedPocketId: "pocket",
    expectedAuthorityRevision, transitionId: "transition-one" };
}

function adoption(operationId, expectedAuthorityRevision, rollbackRevision, head) {
  return { apiVersion: 1, operationId, syncedPocketId: "pocket", expectedAuthorityRevision,
    transitionId: "transition-one", rollbackRevision, adoptionHead: head };
}

function cas(operationId, expectedHead, candidateSealStorageRef, expectedAuthorityRevision) {
  const value = { apiVersion: 1, operationId, syncedPocketId: "pocket", expectedHead, candidateSealStorageRef };
  if (expectedAuthorityRevision !== undefined) value.expectedAuthorityRevision = expectedAuthorityRevision;
  return value;
}

test("P168 handoff is content-neutral and Starling authority is exclusive after E+2", async () => {
  const driver = createMemoryServiceStore({ seed: seed() });
  const heads = headDriver();
  const service = core(driver, heads);

  const saved = await service.conditionalUpload(call(upload("whole-save", 1)));
  assert.equal(saved.status, 200);
  assert.equal(saved.body.revision, 2);
  const rollback = clone(driver.snapshot().pockets.pocket);
  const headAtHandoff = heads.head();

  const fenced = await service.acquirePersistenceAuthorityFence(call(fence("fence", 1)));
  assert.equal(fenced.status, 200);
  assert.equal(fenced.body.authority.authorityRevision, 2);

  const adopted = await service.commitStarlingAuthorityAdoption(call(
    adoption("adopt", 2, 2, headAtHandoff)
  ));
  assert.equal(adopted.status, 200);
  assert.equal(adopted.body.status, "adopted");
  assert.equal(adopted.body.authority.authorityRevision, 3);
  assert.equal(adopted.body.authority.currentMode, "starling");
  assert.equal(adopted.body.authority.rollbackRevision, 2);
  assert.deepEqual(adopted.body.authority.adoptionHead, headAtHandoff);
  assert.deepEqual(driver.snapshot().pockets.pocket, rollback);
  assert.deepEqual(heads.head(), headAtHandoff);

  const replayInput = upload("whole-save", 1, "idempotent-retry");
  const replay = await service.conditionalUpload(call(replayInput));
  assert.equal(replay.status, 200);
  assert.equal(replay.body.replayed, true);
  assert.deepEqual(driver.snapshot().pockets.pocket, rollback);

  await assert.rejects(service.conditionalUpload(call(upload("forbidden-whole", 2))),
    (error) => error?.code === "service-persistence-authority-transition-active" && error.status === 409);

  const legacy = await service.compareAndSetShadowHead(call(cas("legacy-cas", headAtHandoff, "seal-two")));
  assert.equal(legacy.status, 409);
  assert.equal(legacy.body.reason, "authority-conflict");
  assert.deepEqual(heads.head(), headAtHandoff);

  const stale = await service.compareAndSetShadowHead(call(cas("stale-cas", headAtHandoff, "seal-two", 2)));
  assert.equal(stale.status, 409);
  assert.equal(stale.body.reason, "authority-conflict");
  assert.deepEqual(heads.head(), headAtHandoff);

  const authoritative = await service.compareAndSetShadowHead(call(
    cas("authoritative-cas", headAtHandoff, "seal-two", 3)
  ));
  assert.equal(authoritative.status, 200);
  assert.equal(authoritative.body.head.revision, 2);
  assert.equal(authoritative.body.head.sealRef, "seal-two");
  assert.deepEqual(driver.snapshot().pockets.pocket, rollback);
});

test("P168 adoption conflict cannot alter rollback content or Head", async () => {
  const driver = createMemoryServiceStore({ seed: seed() });
  const heads = headDriver();
  const service = core(driver, heads);
  const before = clone(driver.snapshot().pockets.pocket);
  const head = heads.head();
  await service.acquirePersistenceAuthorityFence(call(fence("fence", 1)));
  const conflict = await service.commitStarlingAuthorityAdoption(call(
    adoption("bad-adopt", 2, 1, { ...head, sealRef: "other-seal" })
  ));
  assert.equal(conflict.status, 409);
  assert.equal(conflict.body.reason, "authority-conflict");
  assert.deepEqual(driver.snapshot().pockets.pocket, before);
  assert.deepEqual(heads.head(), head);
  assert.equal(driver.snapshot().persistenceAuthorities.pocket.currentMode, "whole-record");
  assert.notEqual(driver.snapshot().persistenceAuthorities.pocket.transition, null);
});

test("P168 authority read is barriered behind the same per-Pocket lock", async () => {
  const driver = createMemoryServiceStore({ seed: seed() });
  const heads = headDriver();
  let enteredResolve; let releaseResolve;
  const entered = new Promise((resolve) => { enteredResolve = resolve; });
  const release = new Promise((resolve) => { releaseResolve = resolve; });
  let ordinal = 0;
  const transact = async (...args) => driver.store.transact(...args);
  Object.defineProperty(transact, "withPocketAuthorityLock", { value(pocket, callback) {
    ordinal += 1;
    const current = ordinal;
    return driver.store.transact.withPocketAuthorityLock(pocket, async () => {
      if (current === 1) { enteredResolve(); await release; }
      return callback();
    });
  } });
  const service = core(driver, heads, Object.freeze({ transact }));
  const fencePromise = service.acquirePersistenceAuthorityFence(call(fence("fence", 1)));
  await entered;
  let readSettled = false;
  const readPromise = service.readPersistenceAuthority(call({ apiVersion: 1,
    operationId: "read", syncedPocketId: "pocket" })).then((value) => { readSettled = true; return value; });
  await Promise.resolve();
  assert.equal(readSettled, false);
  releaseResolve();
  const [, read] = await Promise.all([fencePromise, readPromise]);
  assert.equal(read.body.authority.authorityRevision, 2);
  assert.notEqual(read.body.authority.transition, null);
});
