"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const serviceModule = require("../sync-service/pocket-sync-service-core.js");
const storeModule = require("../sync-service/pocket-sync-postgres-store.js");
const { ELIGIBLE_COLLECTIONS, MAX_DELETIONS, removeExpiredEphemeralRecords } = require("../sync-service/pocket-sync-expired-record-retention.js");
const { retentionDiagnostic } = require("../sync-service/pocket-sync-expired-record-retention-command.js");

const ROOT = path.resolve(__dirname, "..");
const BEFORE = "2026-09-09T00:00:00.000Z";
const CUTOFF = "2026-09-09T01:00:00.000Z";
const AFTER = "2026-09-09T02:00:00.000Z";
const copy = (value) => value === undefined ? undefined : JSON.parse(JSON.stringify(value));
const source = (relative) => fs.readFileSync(path.join(ROOT, relative), "utf8");
const bytes = (seed) => Buffer.alloc(32, seed % 255 || 1).toString("base64url");

function registrationOptions(accountId, challenge, prf, seed = 1) {
  return {
    rp: { id: "sync.pocket.example", name: "Pocket" },
    user: { id: bytes(seed + 100), name: accountId, displayName: accountId },
    challenge,
    pubKeyCredParams: [{ type: "public-key", alg: -7 }],
    authenticatorSelection: { residentKey: "required", userVerification: "required" },
    attestation: "none",
    extensions: { prf: { eval: { first: prf } } },
  };
}

function sessionRecord(key, expiresAt, seed = 1) {
  return { kind: "pocket.sync.service-session", schemaVersion: 1, storeVersion: 1,
    sessionId: key, accountId: `account_${seed}`, credentialId: `credential_${seed}`,
    status: "active", createdAt: "2026-09-08T00:00:00.000Z", expiresAt, replacedBy: null };
}

function ceremonyRecord(key, expiresAt, seed = 1) {
  const accountId = `account_c_${seed}`, ceremonyId = `ceremony_${seed}`;
  const challenge = bytes(seed + 1), prf = bytes(seed + 2);
  const publicKeyCreationOptions = registrationOptions(accountId, challenge, prf, seed);
  return { kind: "pocket.sync.service-ceremony", schemaVersion: 1, storeVersion: 1,
    ceremonyType: "registration", mode: "account-bound", operationId: key, ceremonyId,
    requestDigest: "a".repeat(64), accountId, priorSessionId: null, deviceId: `device_${seed}`,
    challenge, prfEvaluationInput: prf, expiresAt,
    beginBody: { apiVersion: 1, ok: true, operationId: key, ceremonyId, expiresAt,
      prfEvaluationInput: prf, publicKeyCreationOptions }, finishDigest: null, completedResult: null };
}

function recoveryCeremonyRecord(key, expiresAt, seed = 1) {
  const accountId = `account_r_${seed}`, challenge = bytes(seed + 11), prf = bytes(seed + 12);
  return { kind: "pocket.sync.service-recovery-ceremony", schemaVersion: 1, storeVersion: 1,
    operationId: key, recoveryCeremonyId: `recovery_${seed}`, requestDigest: "b".repeat(64),
    accountId, syncedPocketId: `pocket_${seed}`, deviceId: `device_r_${seed}`, challenge,
    recoveryVersion: 1, keySetVersion: 1, prfEvaluationInput: prf,
    publicKeyCreationOptions: registrationOptions(accountId, challenge, prf, seed + 20), expiresAt,
    finishDigest: null, completedCredentialId: null, completedSessionId: null, completedKeySetVersion: null };
}

const mapKey = (collection, key) => `${collection}\u0000${key}`;
function nativeError() { const error = new Error("database secret should never escape"); error.code = "XX001"; return error; }

function createRetentionPool(seed, options = {}) {
  let committed = new Map(seed.map(({ collection, key, record }) => [mapKey(collection, key),
    { collection, record_key: key, store_version: record.storeVersion, record: copy(record) }]));
  const queries = [];
  let staleInjected = false;
  function makeClient() {
    let working = null;
    return { async query(sql, values = []) {
      queries.push({ sql, values: copy(values) });
      if (sql === "BEGIN" || sql === "BEGIN READ ONLY") { working = new Map([...committed].map(([k, row]) => [k, copy(row)])); return { rows: [], rowCount: null }; }
      if (sql === "COMMIT") { if (options.failCommit) throw nativeError(); committed = working; working = null; return { rows: [], rowCount: null }; }
      if (sql === "ROLLBACK") { working = null; return { rows: [], rowCount: null }; }
      if (!working) throw nativeError();
      if (sql.includes("SELECT collection, record_key, store_version, record")) {
        if (options.failSelect) throw nativeError();
        const [collections, cutoff, limit] = values;
        const rows = [...working.values()].filter((row) => collections.includes(row.collection)
          && row.record && typeof row.record === "object" && typeof row.record.expiresAt === "string"
          && row.record.expiresAt <= cutoff).sort((a, b) => a.collection.localeCompare(b.collection)
          || a.record_key.localeCompare(b.record_key)).slice(0, limit).map(copy);
        return { rows, rowCount: rows.length };
      }
      if (sql.startsWith("DELETE FROM public.pocket_sync_records")) {
        const key = mapKey(values[0], values[1]);
        if (options.staleBeforeDelete && !staleInjected) { staleInjected = true; const current = working.get(key); if (current) { current.store_version += 1; current.record.storeVersion += 1; } }
        const current = working.get(key);
        if (!current || current.store_version !== values[2]) return { rows: [], rowCount: 0 };
        working.delete(key); return { rows: [], rowCount: 1 };
      }
      throw nativeError();
    }, release() {} };
  }
  return { pool: { async connect() { return makeClient(); } }, queries,
    row(collection, key) { return copy(committed.get(mapKey(collection, key)) || null); },
    count() { return committed.size; } };
}

async function cleanup(seed, options = {}) {
  const controlled = createRetentionPool(seed, options);
  const store = storeModule.createPostgresStore({ pool: controlled.pool });
  const result = await removeExpiredEphemeralRecords({ store, cutoffMilliseconds: Date.parse(CUTOFF) });
  return { controlled, result };
}

test("P195 preserves public surfaces and hides maintenance seams", async () => {
  assert.deepEqual(Object.keys(serviceModule), ["POLICY", "COLLECTIONS", "createServiceCore"]);
  assert.equal(typeof serviceModule.validateStoredRecord, "function");
  assert.equal(Object.prototype.propertyIsEnumerable.call(serviceModule, "validateStoredRecord"), false);
  assert.deepEqual(Object.keys(storeModule), ["COLLECTIONS", "createPostgresStore"]);
  assert.deepEqual(ELIGIBLE_COLLECTIONS, ["sessions", "ceremonies", "recoveryCeremonies"]);
  assert.equal(MAX_DELETIONS, 100);
  const controlled = createRetentionPool([]), store = storeModule.createPostgresStore({ pool: controlled.pool });
  await store.transact("readwrite", async (transaction) => {
    assert.deepEqual(Object.keys(transaction), ["get", "insert", "replace", "remove"]);
    assert.equal(typeof transaction.selectExpiredCandidates, "function");
    assert.equal(Object.prototype.propertyIsEnumerable.call(transaction, "selectExpiredCandidates"), false);
  });
});

test("P195 exact cutoff deletes all three eligible collections only", async () => {
  const future = sessionRecord("future_session", AFTER, 90);
  const unrelated = { storeVersion: 1, expiresAt: BEFORE, opaque: "UNRELATED_SECRET" };
  const seed = [
    { collection: "sessions", key: "expired_session", record: sessionRecord("expired_session", BEFORE, 1) },
    { collection: "ceremonies", key: "equal_ceremony", record: ceremonyRecord("equal_ceremony", CUTOFF, 2) },
    { collection: "recoveryCeremonies", key: "equal_recovery", record: recoveryCeremonyRecord("equal_recovery", CUTOFF, 3) },
    { collection: "sessions", key: "future_session", record: future },
    { collection: "operations", key: "unrelated", record: unrelated },
  ];
  const { controlled, result } = await cleanup(seed);
  assert.deepEqual(result, { deleted: 3, byCollection: { sessions: 1, ceremonies: 1, recoveryCeremonies: 1 } });
  assert.equal(controlled.row("sessions", "expired_session"), null);
  assert.equal(controlled.row("ceremonies", "equal_ceremony"), null);
  assert.equal(controlled.row("recoveryCeremonies", "equal_recovery"), null);
  assert.deepEqual(controlled.row("sessions", "future_session").record, future);
  assert.deepEqual(controlled.row("operations", "unrelated").record, unrelated);
  const selection = controlled.queries.find((entry) => entry.sql.includes("SELECT collection, record_key"));
  assert.deepEqual(selection.values, [ELIGIBLE_COLLECTIONS, CUTOFF, 100]);
  assert.match(selection.sql, /ORDER BY collection ASC, record_key ASC/);
  assert.match(selection.sql, /LIMIT \$3/);
  assert.match(selection.sql, /FOR UPDATE/);
});

test("P195 has one deterministic 100-record ceiling across the mixed batch", async () => {
  const seed = [];
  for (let index = 0; index < 40; index += 1) {
    const suffix = String(index).padStart(2, "0");
    seed.push({ collection: "ceremonies", key: `ceremony_${suffix}`, record: ceremonyRecord(`ceremony_${suffix}`, BEFORE, index + 1) });
    seed.push({ collection: "recoveryCeremonies", key: `recovery_${suffix}`, record: recoveryCeremonyRecord(`recovery_${suffix}`, BEFORE, index + 50) });
    seed.push({ collection: "sessions", key: `session_${suffix}`, record: sessionRecord(`session_${suffix}`, BEFORE, index + 100) });
  }
  const { controlled, result } = await cleanup(seed);
  assert.deepEqual(result, { deleted: 100, byCollection: { sessions: 20, ceremonies: 40, recoveryCeremonies: 40 } });
  assert.equal(controlled.count(), 20);
});

test("P195 malformed eligible state fails closed and stays durable", async () => {
  const malformed = { storeVersion: 1, kind: "not-a-session", expiresAt: BEFORE };
  const controlled = createRetentionPool([{ collection: "sessions", key: "malformed_session", record: malformed }]);
  const store = storeModule.createPostgresStore({ pool: controlled.pool });
  await assert.rejects(removeExpiredEphemeralRecords({ store, cutoffMilliseconds: Date.parse(CUTOFF) }),
    (error) => error && error.code === "retention-state-invalid");
  assert.deepEqual(controlled.row("sessions", "malformed_session").record, malformed);
});

test("P195 stale store-version authority cannot delete", async () => {
  const record = sessionRecord("stale_session", BEFORE, 8);
  const controlled = createRetentionPool([{ collection: "sessions", key: "stale_session", record }], { staleBeforeDelete: true });
  const store = storeModule.createPostgresStore({ pool: controlled.pool });
  await assert.rejects(removeExpiredEphemeralRecords({ store, cutoffMilliseconds: Date.parse(CUTOFF) }),
    (error) => error && error.code === "retention-failed");
  assert.deepEqual(controlled.row("sessions", "stale_session").record, record);
});

test("P195 query and commit failures are truthful and atomic", async (t) => {
  for (const option of ["failSelect", "failCommit"]) await t.test(option, async () => {
    const record = sessionRecord(`${option}_session`, BEFORE, 9);
    const controlled = createRetentionPool([{ collection: "sessions", key: `${option}_session`, record }], { [option]: true });
    const store = storeModule.createPostgresStore({ pool: controlled.pool });
    await assert.rejects(removeExpiredEphemeralRecords({ store, cutoffMilliseconds: Date.parse(CUTOFF) }),
      (error) => error && error.code === "retention-failed");
    assert.deepEqual(controlled.row("sessions", `${option}_session`).record, record);
  });
});

test("P195 result and command diagnostic are secret-free", async () => {
  const secret = sessionRecord("SECRET_SESSION_ID", BEFORE, 10);
  secret.accountId = "SECRET_ACCOUNT"; secret.credentialId = "SECRET_CREDENTIAL";
  const { result } = await cleanup([{ collection: "sessions", key: "SECRET_SESSION_ID", record: secret }]);
  assert.equal(JSON.stringify(result).includes("SECRET"), false);
  assert.deepEqual(Object.keys(result), ["deleted", "byCollection"]);
  assert.equal(retentionDiagnostic(), "Pocket Sync expired-record retention failed.\n");
});

test("P195 maintenance is explicit and inert during production startup/migration/browser activity", () => {
  const packageJson = JSON.parse(source("package.json"));
  assert.equal(packageJson.scripts["sync:retention:expired"], "node sync-service/pocket-sync-expired-record-retention-command.js");
  const commandName = "pocket-sync-expired-record-retention-command.js";
  for (const file of ["sync-service/pocket-sync-production-server.js", "sync-service/pocket-sync-server-runtime.js",
    "sync-service/pocket-sync-db-migrate.js", "index.html", "sw.js"]) assert.equal(source(file).includes(commandName), false, file);
  const command = source(`sync-service/${commandName}`);
  assert.match(command, /if \(require\.main === module\)/);
  assert.doesNotMatch(command, /setInterval|setTimeout|cron|schedule/i);
});

test("P195 leaves accepted session and ceremony expiry semantics unchanged", () => {
  const core = source("sync-service/pocket-sync-service-core.js");
  assert.match(core, /Date\.parse\(session\.expiresAt\) <= atMilliseconds/);
  assert.match(core, /service-session-expired/);
  assert.match(core, /Date\.parse\(ceremony\.expiresAt\) <= atMilliseconds/);
  assert.match(core, /service-ceremony-expired/);
  assert.match(core, /Date\.parse\(existing\.expiresAt\) <= at/);
});
