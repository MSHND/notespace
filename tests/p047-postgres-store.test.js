"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const { COLLECTIONS, createPostgresStore } = require("../sync-service/pocket-sync-postgres-store.js");
const { createServiceCore } = require("../sync-service/pocket-sync-service-core.js");

const ROOT = path.resolve(__dirname, "..");
const ORIGIN = "https://sync.pocket.example";

function source(file) {
  return fs.readFileSync(path.join(ROOT, file), "utf8");
}

function copy(value) {
  return value === undefined ? undefined : JSON.parse(JSON.stringify(value));
}

function record(storeVersion, extra = {}) {
  return { storeVersion, kind: "opaque", ...extra };
}

function mapKey(collection, key) {
  return `${collection}\u0000${key}`;
}

function nativeError(code, message = "native database detail") {
  const error = new Error(message);
  error.code = code;
  return error;
}

function createControlledPool(seed = []) {
  const rows = new Map();
  const queries = [];
  const clients = [];
  let failCommit = null;
  let failRollback = null;

  seed.forEach(({ collection, key, storeVersion, value }) => {
    rows.set(mapKey(collection, key), { store_version: storeVersion, record: copy(value) });
  });

  function makeClient() {
    let released = false;
    let began = false;
    const mutations = [];
    const client = {
      async query(sql, values = []) {
        queries.push({ client, sql, values: copy(values) });
        if (sql === "BEGIN" || sql === "BEGIN READ ONLY") {
          began = true;
          return { rows: [], rowCount: null };
        }
        if (sql === "COMMIT") {
          if (failCommit) throw failCommit;
          began = false;
          return { rows: [], rowCount: null };
        }
        if (sql === "ROLLBACK") {
          if (failRollback) throw failRollback;
          for (let index = mutations.length - 1; index >= 0; index -= 1) {
            const mutation = mutations[index];
            const current = rows.get(mutation.key);
            if (JSON.stringify(current) === JSON.stringify(mutation.after)) {
              if (mutation.before === undefined) rows.delete(mutation.key);
              else rows.set(mutation.key, copy(mutation.before));
            }
          }
          began = false;
          return { rows: [], rowCount: null };
        }
        if (!began) throw nativeError("25P01");
        if (sql.startsWith("SELECT store_version, record")) {
          const current = rows.get(mapKey(values[0], values[1]));
          return current
            ? { rows: [copy(current)], rowCount: 1 }
            : { rows: [], rowCount: 0 };
        }
        if (sql.startsWith("INSERT INTO pocket_sync_records")) {
          const key = mapKey(values[0], values[1]);
          if (rows.has(key)) throw nativeError("23505", "duplicate secret record");
          const after = { store_version: values[2], record: JSON.parse(values[3]) };
          mutations.push({ key, before: undefined, after: copy(after) });
          rows.set(key, after);
          return { rows: [], rowCount: 1 };
        }
        if (sql.startsWith("UPDATE pocket_sync_records")) {
          const key = mapKey(values[0], values[1]);
          const before = rows.get(key);
          if (!before || String(before.store_version) !== String(values[2])) return { rows: [], rowCount: 0 };
          const after = { store_version: values[3], record: JSON.parse(values[4]) };
          mutations.push({ key, before: copy(before), after: copy(after) });
          rows.set(key, after);
          return { rows: [], rowCount: 1 };
        }
        if (sql.startsWith("DELETE FROM pocket_sync_records")) {
          const key = mapKey(values[0], values[1]);
          const before = rows.get(key);
          if (!before || String(before.store_version) !== String(values[2])) return { rows: [], rowCount: 0 };
          mutations.push({ key, before: copy(before), after: undefined });
          rows.delete(key);
          return { rows: [], rowCount: 1 };
        }
        throw nativeError("42601", "unexpected query");
      },
      release() { released = true; },
      get released() { return released; },
    };
    clients.push(client);
    return client;
  }

  return {
    pool: { async connect() { return makeClient(); } },
    queries,
    clients,
    row(collection, key) { return copy(rows.get(mapKey(collection, key)) || null); },
    setCommitFailure(error) { failCommit = error; },
    setRollbackFailure(error) { failRollback = error; },
  };
}

function code(expected) {
  return (error) => error && error.code === expected;
}

test("P047 exports a frozen narrow provider-neutral production surface", () => {
  const module = require("../sync-service/pocket-sync-postgres-store.js");
  assert.deepEqual(Object.keys(module), ["COLLECTIONS", "createPostgresStore"]);
  assert.equal(Object.isFrozen(module), true);
  assert.equal(Object.isFrozen(COLLECTIONS), true);
  assert.deepEqual(COLLECTIONS, [
    "accounts", "credentials", "sessions", "ceremonies", "pockets", "operations",
    "keySets", "envelopes", "recoveryLocators", "recoveryCeremonies", "keyOperations",
  ]);
  const production = source("sync-service/pocket-sync-postgres-store.js");
  const migration = source("sync-service/migrations/001-pocket-sync-store.sql");
  assert.match(migration, /CREATE TABLE IF NOT EXISTS pocket_sync_records/);
  assert.match(migration, /PRIMARY KEY \(collection, record_key\)/);
  assert.match(migration, /store_version > 0 AND store_version <= 9007199254740991/);
  assert.match(migration, /jsonb_typeof\(record\) = 'object'/);
  assert.match(production, /WHERE collection = \$1 AND record_key = \$2 AND store_version = \$3/);
  assert.doesNotMatch(`${production}\n${migration}`, /\b(?:neon|supabase|aws|rds|digitalocean|amaze|macquarie|render|railway|fly|vercel)\b|process\.env|database_url|console\.|on conflict/i);
  assert.doesNotMatch(source("index.html"), /pocket-sync-postgres-store\.js/);
  assert.doesNotMatch(source("sw.js"), /pocket-sync-postgres-store\.js/);
  assert.throws(() => createPostgresStore({}), code("store-options-invalid"));
});

test("P047 performs detached readonly reads with a real read-only transaction", async () => {
  const controlled = createControlledPool([
    { collection: "accounts", key: "account-key", storeVersion: "1", value: record(1, { accountId: "one" }) },
  ]);
  const store = createPostgresStore({ pool: controlled.pool });
  const found = await store.transact("readonly", async (tx) => tx.get("accounts", "account-key"));
  found.accountId = "changed";
  const absent = await store.transact("readonly", async (tx) => tx.get("accounts", "missing"));
  assert.deepEqual(found.storeVersion, 1);
  assert.equal(absent, null);
  assert.equal(controlled.row("accounts", "account-key").record.accountId, "one");
  assert.deepEqual(controlled.queries.map((entry) => entry.sql), [
    "BEGIN READ ONLY", controlled.queries[1].sql, "COMMIT", "BEGIN READ ONLY", controlled.queries[4].sql, "COMMIT",
  ]);
  assert.equal(controlled.clients.every((client) => client.released), true);
});

test("P047 rejects readonly writes before mutation SQL and expires retained facades", async () => {
  const controlled = createControlledPool();
  const store = createPostgresStore({ pool: controlled.pool });
  let retained;
  await store.transact("readonly", async (tx) => {
    retained = tx;
    await assert.rejects(tx.insert("accounts", "one", record(1)), code("store-readonly-write"));
    await assert.rejects(tx.replace("accounts", "one", 1, record(2)), code("store-readonly-write"));
    await assert.rejects(tx.remove("accounts", "one", 1), code("store-readonly-write"));
  });
  assert.equal(controlled.queries.some((entry) => /^(INSERT|UPDATE|DELETE)/.test(entry.sql)), false);
  const before = controlled.queries.length;
  await assert.rejects(retained.get("accounts", "one"), code("store-transaction-expired"));
  assert.equal(controlled.queries.length, before);
});

test("P047 keeps insert insert-only and binds hostile values as PostgreSQL parameters", async () => {
  const hostileKey = "record'); DROP TABLE pocket_sync_records; --";
  const hostileRecord = record(1, { opaque: "'); SELECT secret; --" });
  const controlled = createControlledPool();
  const store = createPostgresStore({ pool: controlled.pool });
  await store.transact("readwrite", async (tx) => tx.insert("accounts", hostileKey, hostileRecord));
  const insert = controlled.queries.find((entry) => entry.sql.startsWith("INSERT"));
  assert.ok(insert);
  assert.equal(insert.sql.includes(hostileKey), false);
  assert.deepEqual(insert.values.slice(0, 3), ["accounts", hostileKey, 1]);
  assert.equal(JSON.parse(insert.values[3]).opaque, hostileRecord.opaque);
  await assert.rejects(
    store.transact("readwrite", async (tx) => tx.insert("accounts", hostileKey, record(2))),
    code("store-duplicate")
  );
  assert.equal(controlled.row("accounts", hostileKey).record.storeVersion, 1);
  const queriesBefore = controlled.queries.length;
  await assert.rejects(store.transact("readonly", async (tx) => tx.get("unknown", hostileKey)), code("store-collection-invalid"));
  assert.equal(controlled.queries.slice(queriesBefore).some((entry) => entry.sql.startsWith("SELECT")), false);
});

test("P047 implements conditional replace and remove in one SQL mutation each", async () => {
  const controlled = createControlledPool([
    { collection: "accounts", key: "one", storeVersion: "1", value: record(1) },
  ]);
  const store = createPostgresStore({ pool: controlled.pool });
  await store.transact("readwrite", async (tx) => tx.replace("accounts", "one", 1, record(2, { changed: true })));
  assert.equal(controlled.row("accounts", "one").record.storeVersion, 2);
  await assert.rejects(store.transact("readwrite", async (tx) => tx.replace("accounts", "one", 1, record(3))), code("store-version-conflict"));
  await assert.rejects(store.transact("readwrite", async (tx) => tx.replace("accounts", "missing", 1, record(1))), code("store-version-conflict"));
  assert.equal(controlled.row("accounts", "one").record.storeVersion, 2);
  await store.transact("readwrite", async (tx) => tx.remove("accounts", "one", 2));
  assert.equal(controlled.row("accounts", "one"), null);
  await assert.rejects(store.transact("readwrite", async (tx) => tx.remove("accounts", "one", 2)), code("store-version-conflict"));
  const mutations = controlled.queries.filter((entry) => /^(UPDATE|DELETE)/.test(entry.sql));
  assert.equal(mutations.every((entry) => entry.sql.includes("store_version = $3")), true);
});

test("P047 fails closed for malformed durable rows and non-JSON writes", async () => {
  const malformed = [
    { key: "not-object", storeVersion: "1", value: null },
    { key: "bad-column", storeVersion: "0", value: record(1) },
    { key: "version-mismatch", storeVersion: "1", value: record(2) },
  ];
  const controlled = createControlledPool(malformed.map(({ key, storeVersion, value }) => ({ collection: "accounts", key, storeVersion, value })));
  const store = createPostgresStore({ pool: controlled.pool });
  for (const { key } of malformed) {
    await assert.rejects(store.transact("readonly", async (tx) => tx.get("accounts", key)), (error) => /^store-(state|record)-invalid$/.test(error && error.code));
  }
  await assert.rejects(store.transact("readwrite", async (tx) => tx.insert("accounts", "bad", record(1, { absent: undefined }))), code("store-record-invalid"));
  await assert.rejects(store.transact("readwrite", async (tx) => tx.insert("accounts", "big", { storeVersion: 1, value: 1n })), code("store-record-invalid"));
  await assert.rejects(store.transact("readwrite", async (tx) => tx.insert("accounts", "nan", { storeVersion: 1, value: NaN })), code("store-record-invalid"));
});

test("P047 rolls back callback and commit failures, releases every client, and hides native errors", async () => {
  const callbackPool = createControlledPool();
  const callbackStore = createPostgresStore({ pool: callbackPool.pool });
  const callbackError = new Error("safe callback failure");
  await assert.rejects(callbackStore.transact("readwrite", async (tx) => {
    await tx.insert("accounts", "one", record(1));
    throw callbackError;
  }), (error) => error === callbackError);
  assert.equal(callbackPool.row("accounts", "one"), null);
  assert.equal(callbackPool.queries.at(-1).sql, "ROLLBACK");
  assert.equal(callbackPool.queries.some((entry) => entry.sql === "COMMIT"), false);
  assert.equal(callbackPool.clients[0].released, true);

  const commitPool = createControlledPool();
  commitPool.setCommitFailure(nativeError("08006", "postgres://secret-host/password"));
  const commitStore = createPostgresStore({ pool: commitPool.pool });
  let commitError;
  await assert.rejects(commitStore.transact("readwrite", async (tx) => tx.insert("accounts", "one", record(1))), (error) => {
    commitError = error;
    return error && error.code === "store-storage-failed";
  });
  assert.equal(commitError.message.includes("secret-host"), false);
  assert.equal(commitPool.clients[0].released, true);
  assert.equal(commitPool.queries.filter((entry) => entry.sql === "COMMIT").length, 1);
  assert.equal(commitPool.queries.filter((entry) => entry.sql === "ROLLBACK").length, 1);

  const rollbackPool = createControlledPool();
  rollbackPool.setRollbackFailure(nativeError("08006", "rollback secret"));
  const rollbackStore = createPostgresStore({ pool: rollbackPool.pool });
  await assert.rejects(rollbackStore.transact("readwrite", async () => { throw callbackError; }), (error) => error === callbackError);
  assert.equal(rollbackPool.clients[0].released, true);
});

test("P047 uses PostgreSQL conditional semantics so concurrent equal-version CAS operations cannot both succeed", async () => {
  const controlled = createControlledPool([
    { collection: "accounts", key: "one", storeVersion: "1", value: record(1) },
  ]);
  const store = createPostgresStore({ pool: controlled.pool });
  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  const first = store.transact("readwrite", async (tx) => { await gate; await tx.replace("accounts", "one", 1, record(2, { writer: "one" })); });
  const second = store.transact("readwrite", async (tx) => { await gate; await tx.replace("accounts", "one", 1, record(2, { writer: "two" })); });
  release();
  const outcomes = await Promise.allSettled([first, second]);
  assert.equal(outcomes.filter((outcome) => outcome.status === "fulfilled").length, 1);
  assert.equal(outcomes.filter((outcome) => outcome.status === "rejected" && outcome.reason.code === "store-version-conflict").length, 1);
  assert.equal(controlled.row("accounts", "one").record.storeVersion, 2);
});

test("P047 real store façade is compatible with the unchanged service core", async () => {
  const controlled = createControlledPool();
  const core = createServiceCore({
    store: createPostgresStore({ pool: controlled.pool }),
    webAuthnVerifier: Object.freeze({ async verifyRegistration() { return {}; }, async verifyAuthentication() { return {}; } }),
    recoveryProofVerifier: Object.freeze({ async verifyRecoveryProof() { return { verified: true }; } }),
    randomBytes(length) { return Uint8Array.from({ length }, (_value, index) => index + 1); },
    now: () => Date.parse("2032-01-01T00:00:00.000Z"),
    trustedOrigin: ORIGIN,
    rpId: "sync.pocket.example",
    rpName: "Pocket",
    credentialAlgorithms: [-7],
    ceremonyLifetimeMs: 300000,
    sessionLifetimeMs: 2592000000,
  });
  const result = await core.beginRegistration({
    context: { method: "POST", origin: ORIGIN, fetchSite: "same-origin", contentType: "application/json", sessionId: null },
    body: { apiVersion: 1, operationId: "register-operation", accountIntent: "create-or-add-credential", deviceId: "device-opaque" },
  });
  assert.equal(result.status, 200);
  assert.ok(controlled.row("ceremonies", "register-operation"));
  assert.equal(controlled.queries.some((entry) => entry.sql.startsWith("SELECT store_version, record")), true);
  assert.equal(controlled.queries.some((entry) => entry.sql.startsWith("INSERT INTO pocket_sync_records")), true);
});
