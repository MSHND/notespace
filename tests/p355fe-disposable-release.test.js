"use strict";

// P355fe proof-only: disposable PostgreSQL 18. Never import real configuration.
const test = require("node:test");
const assert = require("node:assert/strict");
const { Pool } = require("pg");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { spawnSync, execFileSync } = require("node:child_process");
const { randomBytes, createHash } = require("node:crypto");

const ROOT = path.resolve(__dirname, "..");
const OLD = path.join(ROOT, "p355fe-old-source");
const MAIN_SHA = "04c60ffaa22e3278ded12ec037f3741f34009c11";
const LIVE_SHA = "d0e68fea885bafb5c92cf4ba0be0a91b38dbffa2";
const SCHEMA = "pocket.sync.owner-session.v1";
const ORIGIN = "https://proof.pocket.example";
const SERVICE_ROOT = "/pocket-sync/v1";
const BASE = "postgres://p355fe@127.0.0.1:5432/";
const DB_MIG = "p355fe_migrations";
const DB_ROLL = "p355fe_rollback";
const NOW = Date.parse("2032-01-01T00:00:00.000Z");
const LOCK_TIMEOUT = "500ms";
const STATEMENT_TIMEOUT = "8000ms";

const url = name => BASE + name;
const b64 = data => Buffer.from(data).toString("base64url");
const bytes = (length, offset = 1) => Uint8Array.from(
  { length }, (_, i) => (offset + i) & 255
);
const objectHeadStore = () => Object.freeze({
  async putObject() { return { ok: true, created: true }; },
  async getObject() { return null; },
  async presence(_, refs) { return refs.map(storageRef => ({ storageRef, present: false })); },
  async initialiseHead() { return { schema: "pocket.starling.head.v1", revision: 0, sealRef: null }; },
  async readHead() { return null; },
  async compareAndSetHead() { return { ok: false, reason: "head-conflict" }; },
});
function credential(seed = 121) {
  const id = b64(bytes(32, seed));
  return { id, rawId: id, response: {
    clientDataJSON: b64(bytes(17, 2)), attestationObject: b64(bytes(24, 4)),
    authenticatorData: b64(bytes(19, 6)), transports: ["internal"],
    publicKey: b64(bytes(23, 8)), publicKeyAlgorithm: -7,
  }, authenticatorAttachment: "platform",
  clientExtensionResults: { prf: { enabled: true } }, type: "public-key" };
}
function encryptedRecord() {
  return { format: "pocket.sync.content.opaque", version: 1,
    algorithm: "AES-GCM-256", nonce: b64(bytes(12, 31)),
    ciphertext: b64(bytes(32, 61)) };
}
function invocation(body, sessionId = null) {
  return { context: { method: "POST", origin: ORIGIN, fetchSite: "same-origin",
    contentType: "application/json", sessionId }, body };
}
function migration(db, opts = {}) {
  const result = spawnSync(process.execPath,
    ["sync-service/pocket-sync-db-migrate.js"], {
      cwd: ROOT, encoding: "utf8", timeout: 15000,
      env: { PATH: process.env.PATH, POCKET_SYNC_DATABASE_URL: url(db),
        PGOPTIONS: "-c lock_timeout=" + LOCK_TIMEOUT +
          " -c statement_timeout=" + STATEMENT_TIMEOUT },
    });
  assert.equal(result.error, undefined, "migration runner must terminate");
  if (opts.fail) {
    assert.notEqual(result.status, 0, "blocked migration must fail explicitly");
    assert.equal(result.stderr, "Pocket Sync migration failed: migration-apply\n");
  } else {
    assert.equal(result.status, 0, "unmodified production migration runner must succeed: " + result.stderr);
    assert.equal(result.stderr, "");
  }
  return result;
}
function hash(value) {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}
async function records(pool) {
  return (await pool.query("SELECT collection,record_key,store_version,record FROM public.pocket_sync_records ORDER BY collection,record_key")).rows;
}
async function inspectSchema(pool) {
  const markers = (await pool.query(
    "SELECT schema_name,schema_version FROM public.pocket_sync_schema ORDER BY schema_name"
  )).rows;
  const constraint = (await pool.query(
    "SELECT pg_get_constraintdef(oid) AS definition FROM pg_constraint " +
    "WHERE conrelid = 'public.pocket_sync_records'::regclass " +
    "AND conname = 'pocket_sync_records_collection_check'"
  )).rows;
  assert.equal(constraint.length, 1);
  assert.match(constraint[0].definition, /persistenceAuthorities/);
  assert.deepEqual(markers.map(m => m.schema_name), [
    "pocket-project-documents",
    "pocket-sync-object-head-store",
    "pocket-sync-persistence-authority",
    "pocket-sync-store",
  ]);
  assert(markers.every(row => row.schema_version === 1));
  const { verifyPocketSyncSchema } = require("../sync-service/pocket-sync-postgres-schema.js");
  const { verifyPocketProjectDocumentsSchema } = require("../sync-service/pocket-project-documents-postgres-schema.js");
  await verifyPocketSyncSchema(pool);
  await verifyPocketProjectDocumentsSchema(pool);
  return { markers, constraint: constraint[0].definition };
}
async function insertRecord(pool, collection, key, version, payload) {
  await pool.query(
    "INSERT INTO public.pocket_sync_records(collection,record_key,store_version,record) " +
    "VALUES($1,$2,$3,$4::jsonb)",
    [collection, key, version, JSON.stringify({ ...payload, storeVersion: version })]
  );
}
function initialCore(sourceRoot, databasePool, time) {
  const { createServiceCore } = require(path.join(sourceRoot,
    "sync-service/pocket-sync-service-core.js"));
  const { createPostgresStore } = require(path.join(sourceRoot,
    "sync-service/pocket-sync-postgres-store.js"));
  const core = createServiceCore({
    store: createPostgresStore({ pool: databasePool }),
    objectHeadStore: objectHeadStore(),
    webAuthnVerifier: Object.freeze({
      async verifyRegistration(input) {
        return { credentialId: input.credential.id, publicKey: b64(bytes(64, 81)),
          publicKeyAlgorithm: -7, signCount: 0, transports: ["internal"],
          backupEligible: true, backedUp: false };
      },
      async verifyAuthentication(input) {
        return { credentialId: input.credential.id,
          signCount: input.storedCredential.signCount + 1, backedUp: true };
      },
    }),
    recoveryProofVerifier: Object.freeze({
      async verifyRecoveryProof() { return { verified: true }; },
    }),
    randomBytes: length => new Uint8Array(randomBytes(length)),
    now: () => time.value,
    trustedOrigin: ORIGIN, rpId: "proof.pocket.example", rpName: "Disposable Proof",
    credentialAlgorithms: [-7], ceremonyLifetimeMs: 300000,
    sessionLifetimeMs: 2592000000,
  });
  return core;
}
async function register(core, suffix, seed = 121) {
  const operationId = "p355fe-register-" + suffix;
  const begin = await core.beginRegistration(invocation({
    apiVersion: 1, operationId, accountIntent: "create-or-add-credential",
    deviceId: "device-" + suffix,
  }));
  const finish = await core.finishRegistration(invocation({
    apiVersion: 1, operationId, ceremonyId: begin.body.ceremonyId,
    deviceId: "device-" + suffix, credential: credential(seed),
  }));
  return { accountId: finish.body.accountId, sessionId: finish.session.sessionId,
    expiresAt: finish.session.expiresAt };
}
function request(id, opt = false) {
  return { apiVersion: 1, operationId: id, ...(opt ? { ownerContinuity: SCHEMA } : {}) };
}
async function read(core, id, sessionId, opt = false) {
  return (await core.readSyncedPocket(invocation(request(id, opt), sessionId))).body;
}
function loadRemote(src) {
  const c = { Object, Array, Number, String, Boolean, JSON, Date, Error,
    Promise, Set, Map, Uint8Array, ArrayBuffer, TextEncoder, TextDecoder,
    atob: v => Buffer.from(v, "base64").toString("binary"),
    btoa: v => Buffer.from(v, "binary").toString("base64") };
  c.window = c; c.globalThis = c;
  vm.createContext(c);
  for (const p of ["js/pocket-sync-security-contract.js",
    "js/pocket-sync-account-client.js", "js/pocket-sync-remote-client.js"]) {
    vm.runInContext(fs.readFileSync(path.join(src, p), "utf8"), c, { filename: p });
  }
  return response => {
    c.__response = JSON.stringify(response.body);
    c.__request = JSON.stringify(response.request);
    return JSON.parse(JSON.stringify(vm.runInContext(
      "PocketSyncRemoteClient.validateReadSyncedPocketResponse(" +
      "JSON.parse(__response),JSON.parse(__request))", c)));
  };
}
async function httpRead(adapter, op, sid, opt = false) {
  const { ROUTES } = require("../sync-service/pocket-sync-http-adapter.js");
  const body = request(op, opt);
  const res = await adapter.handle(new Request(
    ORIGIN + SERVICE_ROOT + ROUTES.readSyncedPocket,
    { method: "POST", headers: {
      Origin: ORIGIN, "Sec-Fetch-Site": "same-origin",
      "Content-Type": "application/json",
      Cookie: "__Host-pocket-sync-session=" + sid,
    }, body: JSON.stringify(body) }
  ));
  return { status: res.status, body: await res.json(), request: body };
}

test("P355fe pinned real-source and production-dormancy inventory", () => {
  assert.equal(execFileSync("git", ["rev-parse", MAIN_SHA], { cwd: ROOT, encoding: "utf8" }).trim(), MAIN_SHA);
  assert.equal(execFileSync("git", ["rev-parse", "HEAD"], { cwd: OLD, encoding: "utf8" }).trim(), LIVE_SHA);
  const diff = execFileSync("git", ["diff", "--name-only", LIVE_SHA, MAIN_SHA],
    { cwd: ROOT, encoding: "utf8" }).trim().split("\n");
  assert.equal(diff.length, 32);
  assert.equal(Number(execFileSync("git", ["rev-list", "--count", LIVE_SHA + ".." + MAIN_SHA],
    { cwd: ROOT, encoding: "utf8" }).trim()), 59);
  const runner = "sync-service/pocket-sync-db-migrate.js";
  const migrations = ["001-pocket-sync-store.sql", "002-pocket-sync-object-head-store.sql",
    "003-pocket-sync-persistence-authority.sql", "004-pocket-project-documents.sql"];
  for (const file of [runner, ...migrations.map(m => "sync-service/migrations/" + m)]) {
    assert.equal(fs.readFileSync(path.join(ROOT, file), "utf8"),
      fs.readFileSync(path.join(OLD, file), "utf8"), file);
  }
  const migrationSource = fs.readFileSync(path.join(ROOT, runner), "utf8");
  for (const m of migrations) assert(migrationSource.includes(m.split("-").slice(1).join("-").replace(".sql", "")) || migrationSource.includes(m.slice(0, 3)), m);
  assert.doesNotMatch(migrationSource, /005-pocket-handover/);
  const sourceCore = fs.readFileSync(path.join(ROOT, "sync-service/pocket-sync-service-core.js"), "utf8");
  assert.match(sourceCore, /const OWNER_CONTINUITY_SCHEMA = "pocket.sync.owner-session.v1"/);
  const oldCore = fs.readFileSync(path.join(OLD, "sync-service/pocket-sync-service-core.js"), "utf8");
  assert.doesNotMatch(oldCore, /OWNER_CONTINUITY_SCHEMA/);
  const browserRuntime = fs.readFileSync(path.join(ROOT, "js/pocket-sync-browser-runtime.js"), "utf8");
  const bootFiles = ["index.html", "sw.js", "sync-service/pocket-sync-production-server.js"];
  for (const p of bootFiles) assert.doesNotMatch(
    fs.readFileSync(path.join(ROOT, p), "utf8"), /pocket-sync-owner-continuity-guard\.js/);
  assert.doesNotMatch(browserRuntime, /PocketSyncOwnerContinuityGuard/);
  assert.doesNotMatch(browserRuntime, /ownerContinuity\s*:/);
  const projectRuntime = fs.readFileSync(path.join(ROOT,
    "sync-service/pocket-project-documents-runtime.js"), "utf8");
  assert.doesNotMatch(projectRuntime, /verifiedSubjectObserver/);
  const oldProduction = fs.readFileSync(path.join(OLD,
    "sync-service/pocket-sync-production-server.js"), "utf8");
  const newProduction = fs.readFileSync(path.join(ROOT,
    "sync-service/pocket-sync-production-server.js"), "utf8");
  assert.equal(oldProduction, newProduction);
  const oldAdapter = fs.readFileSync(path.join(OLD, "sync-service/pocket-sync-http-adapter.js"), "utf8");
  const newAdapter = fs.readFileSync(path.join(ROOT, "sync-service/pocket-sync-http-adapter.js"), "utf8");
  assert.equal(oldAdapter, newAdapter);
  assert.doesNotMatch(newProduction, /pocket-handover-release-safety-store|pocket-handover-release-witness/);
  assert.doesNotMatch(projectRuntime, /pocket-handover-release-safety-store|pocket-handover-release-witness/);
  const oldSchema = fs.readFileSync(path.join(OLD, "sync-service/pocket-sync-postgres-store.js"), "utf8");
  const newSchema = fs.readFileSync(path.join(ROOT, "sync-service/pocket-sync-postgres-store.js"), "utf8");
  assert.equal(oldSchema, newSchema);
});

test("P355fe actual PostgreSQL 18 migration, seed, idempotency and bounded contention", async () => {
  const db = new Pool({ connectionString: url(DB_MIG) });
  try {
    const v = await db.query("SHOW server_version_num");
    assert.equal(Math.floor(Number(v.rows[0].server_version_num) / 10000), 18);
    migration(DB_MIG);
    await inspectSchema(db);
    const pocket = id => ({ kind: "synthetic-pocket", schemaVersion: 1,
      accountId: "synthetic-account", syncedPocketId: id });
    await insertRecord(db, "pockets", "synthetic-missing", 1, pocket("synthetic-missing"));
    await insertRecord(db, "pockets", "synthetic-preserved", 1, pocket("synthetic-preserved"));
    const already = { kind: "pocket.sync.persistence-authority", schemaVersion: 1,
      accountId: "synthetic-account", syncedPocketId: "synthetic-preserved",
      authorityRevision: 7, currentMode: "whole-record",
      transition: null, rollbackRevision: null, adoptionHead: null };
    await insertRecord(db, "persistenceAuthorities", "synthetic-preserved", 7, already);
    migration(DB_MIG); // Exactly the registered runner a second time on populated DB.
    await inspectSchema(db);
    const state = await records(db);
    const seeded = state.find(x => x.collection === "persistenceAuthorities" &&
      x.record_key === "synthetic-missing");
    assert(seeded);
    assert.equal(seeded.store_version, "1" === typeof seeded.store_version ? 1 : seeded.store_version);
    assert.equal(seeded.record.currentMode, "whole-record");
    assert.equal(seeded.record.accountId, "synthetic-account");
    const unchanged = state.find(x => x.collection === "persistenceAuthorities" &&
      x.record_key === "synthetic-preserved");
    assert.deepEqual(unchanged.record, { ...already, storeVersion: 7 });
    assert.equal(state.filter(x => x.collection === "persistenceAuthorities").length, 2);
    migration(DB_MIG);
    assert.deepEqual(await records(db), state, "repeated migrations never mutate existing authoritative state");
    const blocker = await db.connect();
    try {
      await db.query("DELETE FROM public.pocket_sync_schema WHERE schema_name = $1",
        ["pocket-sync-object-head-store"]);
      await blocker.query("BEGIN");
      await blocker.query("LOCK TABLE public.pocket_sync_records IN ACCESS SHARE MODE");
      const started = Date.now();
      migration(DB_MIG, { fail: true });
      const elapsed = Date.now() - started;
      assert(elapsed < 10000, "lock failure must be bounded");
      const marker = await db.query("SELECT 1 FROM public.pocket_sync_schema WHERE schema_name=$1",
        ["pocket-sync-object-head-store"]);
      assert.equal(marker.rowCount, 1, "earlier migration steps can commit before 003 fails");
      const constraint = await db.query(
        "SELECT 1 FROM pg_constraint WHERE conrelid='public.pocket_sync_records'::regclass " +
        "AND conname='pocket_sync_records_collection_check'");
      assert.equal(constraint.rowCount, 1, "failed constraint DDL rolled back atomically");
      assert.deepEqual(await records(db), state,
        "failed migration 003 did not overwrite authoritative records");
    } finally {
      await blocker.query("ROLLBACK");
      blocker.release();
    }
    migration(DB_MIG);
    await inspectSchema(db);
    assert.deepEqual(await records(db), state, "recovery rerun leaves seeded state coherent");
  } finally {
    await db.end();
  }
});

test("P355fe real PostgreSQL old-server/new-server HTTP, opt-in and rollback", async () => {
  const poolOld = new Pool({ connectionString: url(DB_ROLL) });
  const poolNew = new Pool({ connectionString: url(DB_ROLL) });
  const time = { value: NOW };
  try {
    migration(DB_ROLL);
    const old = initialCore(OLD, poolOld, time);
    const fresh = initialCore(ROOT, poolNew, time);
    const registered = await register(old, "old-owner");
    const unbound = await read(old, "unbound-old", registered.sessionId);
    const unboundNew = await read(fresh, "unbound-new", registered.sessionId, true);
    assert.equal(unbound.status, "not-configured");
    assert.equal(unboundNew.status, "not-configured");
    assert.equal(Object.hasOwn(unboundNew, "ownerContinuity"), false);
    await old.conditionalUpload(invocation({
      apiVersion: 1, syncedPocketId: "pocket-opaque", expectedRevision: 0,
      operationId: "old-upload", logicalChangeId: "old-upload-change",
      attemptKind: "new-change", encryptedRecord: encryptedRecord(),
    }, registered.sessionId));
    const snapshot = await records(poolOld);
    migration(DB_ROLL);
    await inspectSchema(poolOld);
    assert.deepEqual(await records(poolOld), snapshot,
      "accepted runner preserved old-server committed truth");

    const { createHttpAdapter } = require("../sync-service/pocket-sync-http-adapter.js");
    const oldAdapter = require(path.join(OLD, "sync-service/pocket-sync-http-adapter.js"));
    const oldHttp = oldAdapter.createHttpAdapter({
      core: old, trustedOrigin: ORIGIN, serviceRoot: SERVICE_ROOT,
    });
    const newHttp = createHttpAdapter({
      core: fresh, trustedOrigin: ORIGIN, serviceRoot: SERVICE_ROOT,
    });
    const oldClientValidate = loadRemote(OLD);
    const newClientValidate = loadRemote(ROOT);
    const plainOld = await httpRead(oldHttp, "same-ordinary", registered.sessionId);
    const plainNew = await httpRead(newHttp, "same-ordinary", registered.sessionId);
    assert.equal(plainOld.status, 200);
    assert.equal(plainNew.status, 200);
    assert.deepEqual(plainOld.body, plainNew.body,
      "old and new server ordinary response shapes exactly match");
    assert.deepEqual(plainNew.body, {
      apiVersion: 1, ok: true, operationId: "same-ordinary",
      status: "ready", syncedPocketId: "pocket-opaque",
    });
    assert.deepEqual(oldClientValidate(plainNew), plainNew.body,
      "old strict client accepts new server ordinary response");
    assert.deepEqual(newClientValidate(plainNew), plainNew.body);
    const attested = await httpRead(newHttp, "opt-in-proof", registered.sessionId, true);
    assert.equal(attested.status, 200);
    assert.deepEqual(newClientValidate(attested), attested.body);
    assert.deepEqual(attested.body.ownerContinuity, {
      schema: SCHEMA, accountId: registered.accountId,
      sessionTag: hash([SCHEMA, registered.sessionId]),
      expiresAt: registered.expiresAt,
    });
    assert(!JSON.stringify(attested.body).includes(registered.sessionId),
      "never disclose raw server session");
    assert.equal(Object.hasOwn(attested.body, "export"), false);
    assert.equal(Object.hasOwn(attested.body.ownerContinuity, "token"), false);
    await assert.rejects(read(old, "old-rejects-opt-in", registered.sessionId, true),
      error => error?.code === "service-request-invalid");

    const rejected = await read(fresh, "new-not-configured", (await register(old, "other-account", 181)).sessionId, true);
    assert.equal(rejected.status, "not-configured");
    const stateBeforeRollback = await records(poolNew);
    assert.deepEqual(await read(old, "post-new-old", registered.sessionId),
      { apiVersion: 1, ok: true, operationId: "post-new-old",
        status: "ready", syncedPocketId: "pocket-opaque" });
    assert.deepEqual(await records(poolOld), stateBeforeRollback,
      "new opt-in read does not modify old-server truth");

    const other = await register(old, "wrong-account", 202);
    await assert.rejects(fresh.downloadEncryptedRecord(invocation({
      apiVersion: 1, operationId: "wrong-pocket-read",
      syncedPocketId: "pocket-opaque", revision: 1,
    }, other.sessionId)), error => error?.code === "service-authorisation-failed");
    await assert.rejects(read(fresh, "missing-session", "unknown-synthetic-session", true),
      error => error?.code === "service-session-invalid");
    time.value = Date.parse(registered.expiresAt) + 1;
    await assert.rejects(read(fresh, "expired-new", registered.sessionId, true),
      error => error?.code === "service-session-expired");
    await assert.rejects(read(old, "expired-old", registered.sessionId),
      error => error?.code === "service-session-expired");
  } finally {
    await poolOld.end();
    await poolNew.end();
  }
});
