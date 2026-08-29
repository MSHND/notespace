"use strict";

const test = require("node:test"),
  assert = require("node:assert/strict"),
  fs = require("node:fs"),
  path = require("node:path"),
  { createHash } = require("node:crypto"),
  {
    OBJECT_FORMAT,
    OBJECT_VERSION,
    OBJECT_ALGORITHM,
    REFERENCE_DOMAIN,
    REFERENCE_PREFIX,
    HEAD_SCHEMA,
    MAXIMUM_PRESENCE_REFS,
    canonicalEncryptedRecord,
    referenceForRecord,
    createObjectHeadPostgresStore,
  } = require("../sync-service/pocket-sync-object-head-postgres-store.js");

const ROOT = path.resolve(__dirname, "..");

function source(file) {
  return fs.readFileSync(path.join(ROOT, file), "utf8");
}

function copy(value) {
  return value === undefined ? undefined : JSON.parse(JSON.stringify(value));
}

function record(seed = 1) {
  return {
    format: OBJECT_FORMAT,
    version: OBJECT_VERSION,
    algorithm: OBJECT_ALGORITHM,
    nonce: Buffer.alloc(12, seed).toString("base64url"),
    ciphertext: Buffer.alloc(32, seed + 1).toString("base64url"),
  };
}

function object(seed = 1) {
  const value = record(seed);
  return { record: value, storageRef: referenceForRecord(value) };
}

function key(pocket, ref) {
  return `${pocket}\u0000${ref}`;
}

function nativeError(code, message = "native PostgreSQL detail") {
  const error = new Error(message);
  error.code = code;
  return error;
}

function createPool({ objects = [], heads = [], failCommit = null } = {}) {
  const objectRows = new Map(),
    headRows = new Map(),
    queries = [],
    clients = [];
  for (const entry of objects)
    objectRows.set(key(entry.syncedPocketId, entry.storageRef), copy(entry.record));
  for (const entry of heads)
    headRows.set(entry.syncedPocketId, {
      revision: entry.revision,
      seal_storage_ref: entry.seal_storage_ref,
    });

  function makeClient() {
    let active = false,
      released = false;
    const mutations = [];
    function mutate(map, rowKey, next) {
      const before = copy(map.get(rowKey));
      mutations.push({ map, rowKey, before, after: copy(next) });
      if (next === undefined) map.delete(rowKey);
      else map.set(rowKey, copy(next));
    }
    const client = {
      async query(sql, values = []) {
        queries.push({ sql, values: copy(values), client });
        if (sql === "BEGIN" || sql === "BEGIN READ ONLY") {
          active = true;
          return { rows: [], rowCount: null };
        }
        if (sql === "COMMIT") {
          if (failCommit) throw failCommit;
          active = false;
          return { rows: [], rowCount: null };
        }
        if (sql === "ROLLBACK") {
          for (let index = mutations.length - 1; index >= 0; index -= 1) {
            const mutation = mutations[index],
              current = mutation.map.get(mutation.rowKey);
            if (JSON.stringify(current) === JSON.stringify(mutation.after)) {
              if (mutation.before === undefined) mutation.map.delete(mutation.rowKey);
              else mutation.map.set(mutation.rowKey, copy(mutation.before));
            }
          }
          active = false;
          return { rows: [], rowCount: null };
        }
        if (!active) throw nativeError("25P01");
        if (sql.startsWith("SELECT record FROM public.pocket_sync_objects")) {
          const found = objectRows.get(key(values[0], values[1]));
          return found
            ? { rows: [{ record: copy(found) }], rowCount: 1 }
            : { rows: [], rowCount: 0 };
        }
        if (sql.startsWith("INSERT INTO public.pocket_sync_objects")) {
          const rowKey = key(values[0], values[1]),
            found = objectRows.get(rowKey);
          if (found) return { rows: [], rowCount: 0 };
          const next = JSON.parse(values[2]);
          mutate(objectRows, rowKey, next);
          return { rows: [{ record: copy(next) }], rowCount: 1 };
        }
        if (sql.startsWith("SELECT storage_ref FROM public.pocket_sync_objects")) {
          const rows = values[1]
            .filter((storageRef) => objectRows.has(key(values[0], storageRef)))
            .map((storage_ref) => ({ storage_ref }));
          return { rows, rowCount: rows.length };
        }
        if (sql.startsWith("SELECT revision, seal_storage_ref FROM public.pocket_sync_heads")) {
          const found = headRows.get(values[0]);
          return found
            ? { rows: [copy(found)], rowCount: 1 }
            : { rows: [], rowCount: 0 };
        }
        if (sql.startsWith("INSERT INTO public.pocket_sync_heads")) {
          if (headRows.has(values[0])) return { rows: [], rowCount: 0 };
          const next = { revision: 0, seal_storage_ref: null };
          mutate(headRows, values[0], next);
          return { rows: [copy(next)], rowCount: 1 };
        }
        if (sql.startsWith("UPDATE public.pocket_sync_heads")) {
          const current = headRows.get(values[0]);
          if (
            !current ||
            Number(current.revision) !== values[1] ||
            current.seal_storage_ref !== values[2] ||
            Number(current.revision) >= values[4]
          )
            return { rows: [], rowCount: 0 };
          const next = {
            revision: Number(current.revision) + 1,
            seal_storage_ref: values[3],
          };
          mutate(headRows, values[0], next);
          return { rows: [copy(next)], rowCount: 1 };
        }
        throw nativeError("42601", "unexpected SQL");
      },
      release() {
        released = true;
      },
      get released() {
        return released;
      },
    };
    clients.push(client);
    return client;
  }

  return {
    pool: { async connect() { return makeClient(); } },
    queries,
    clients,
    object(pocket, ref) {
      return copy(objectRows.get(key(pocket, ref)) || null);
    },
    head(pocket) {
      return copy(headRows.get(pocket) || null);
    },
  };
}

function code(expected) {
  return (error) => error && error.code === expected;
}

test("P117 adds only a dormant immutable-object and Head schema beside P047", () => {
  const migration = source("sync-service/migrations/002-pocket-sync-object-head-store.sql"),
    previous = source("sync-service/migrations/001-pocket-sync-store.sql"),
    runner = source("sync-service/pocket-sync-db-migrate.js"),
    production = [
      source("sync-service/pocket-sync-service-core.js"),
      source("sync-service/pocket-sync-http-adapter.js"),
      source("index.html"),
    ].join("\n"),
    module = source("sync-service/pocket-sync-object-head-postgres-store.js");
  assert.match(migration, /CREATE TABLE IF NOT EXISTS public\.pocket_sync_objects/);
  assert.match(migration, /PRIMARY KEY \(synced_pocket_id, storage_ref\)/);
  assert.match(migration, /CREATE TABLE IF NOT EXISTS public\.pocket_sync_heads/);
  assert.match(migration, /synced_pocket_id TEXT PRIMARY KEY/);
  assert.match(migration, /revision >= 0 AND revision <= 9007199254740991/);
  assert.match(migration, /revision = 0 AND seal_storage_ref IS NULL/);
  assert.match(migration, /'pocket-sync-object-head-store', 1/);
  assert.doesNotMatch(migration, /pocket_sync_records|ALTER TABLE|FOREIGN KEY|manifest|logical_ref|node_id|DELETE|UPDATE/i);
  assert.match(previous, /pocket_sync_records/);
  assert.equal(runner.includes("002-pocket-sync-object-head-store.sql"), false);
  assert.equal(production.includes("pocket-sync-object-head-postgres-store"), false);
  assert.doesNotMatch(module, /UPDATE public\.pocket_sync_objects|DELETE FROM public\.pocket_sync_objects|listAll|deleteObject|removeObject/);
  assert.equal(Object.isFrozen(MAXIMUM_PRESENCE_REFS), true);
  assert.equal(MAXIMUM_PRESENCE_REFS, 512);
});

test("P117 validates opaque P111 records and immutable object binding exactly", async () => {
  const first = object(1),
    second = object(2),
    controlled = createPool(),
    store = createObjectHeadPostgresStore({ pool: controlled.pool });
  const expected = REFERENCE_PREFIX + createHash("sha256")
    .update(JSON.stringify([
      REFERENCE_DOMAIN,
      first.record.format,
      first.record.version,
      first.record.algorithm,
      first.record.nonce,
      first.record.ciphertext,
    ]), "utf8")
    .digest("base64url");
  assert.equal(referenceForRecord(first.record), expected);
  assert.equal(canonicalEncryptedRecord(first.record), JSON.stringify([
    REFERENCE_DOMAIN,
    OBJECT_FORMAT,
    OBJECT_VERSION,
    OBJECT_ALGORITHM,
    first.record.nonce,
    first.record.ciphertext,
  ]));
  assert.deepEqual(await store.putObject("pocket-a", first.storageRef, first.record), {
    ok: true,
    created: true,
  });
  const found = await store.getObject("pocket-a", first.storageRef);
  assert.deepEqual(found, first.record);
  assert.equal(Object.isFrozen(found), true);
  assert.deepEqual(await store.putObject("pocket-a", first.storageRef, first.record), {
    ok: true,
    created: false,
  });
  assert.equal(
    controlled.queries.filter((entry) => entry.sql.startsWith("UPDATE public.pocket_sync_objects")).length,
    0,
  );
  assert.equal(await store.getObject("pocket-a", second.storageRef), null);
  await assert.rejects(
    store.putObject("pocket-a", first.storageRef, second.record),
    code("object-head-store-binding-mismatch"),
  );
  for (const bad of [
    { ...first.record, unexpected: true },
    { ...first.record, nonce: "a" },
    { ...first.record, ciphertext: Buffer.alloc(15).toString("base64url") },
    { ...first.record, format: "plaintext" },
  ])
    await assert.rejects(
      store.putObject("pocket-a", first.storageRef, bad),
      code("object-head-store-record-invalid"),
    );
  for (const id of ["", " x", "x ", "x".repeat(161)])
    await assert.rejects(store.getObject(id, first.storageRef), code("object-head-store-pocket-id-invalid"));
  await assert.rejects(
    store.getObject("pocket-a", "proof-ref:v1:candidate-seal:00000000"),
    code("object-head-store-ref-invalid"),
  );
});

test("P117 preserves object scope, exact bounded presence and corrupt-row failure", async () => {
  const first = object(3),
    second = object(4),
    corrupt = object(5),
    controlled = createPool({
      objects: [{
        syncedPocketId: "pocket-corrupt",
        storageRef: first.storageRef,
        record: corrupt.record,
      }],
    }),
    store = createObjectHeadPostgresStore({ pool: controlled.pool });
  await store.putObject("pocket-one", first.storageRef, first.record);
  await store.putObject("pocket-two", first.storageRef, first.record);
  await store.putObject("pocket-one", second.storageRef, second.record);
  assert.deepEqual(
    await store.presence("pocket-one", [second.storageRef, first.storageRef]),
    [
      { storageRef: second.storageRef, present: true },
      { storageRef: first.storageRef, present: true },
    ],
  );
  assert.deepEqual(
    await store.presence("pocket-two", [second.storageRef, first.storageRef]),
    [
      { storageRef: second.storageRef, present: false },
      { storageRef: first.storageRef, present: true },
    ],
  );
  await assert.rejects(
    store.presence("pocket-one", [first.storageRef, first.storageRef]),
    code("object-head-store-presence-invalid"),
  );
  await assert.rejects(
    store.presence("pocket-one", ["proof-ref:v1:candidate-seal:00000000"]),
    code("object-head-store-ref-invalid"),
  );
  await assert.rejects(
    store.presence("pocket-one", Array.from({ length: MAXIMUM_PRESENCE_REFS + 1 }, () => first.storageRef)),
    code("object-head-store-presence-limit"),
  );
  await assert.rejects(
    store.getObject("pocket-corrupt", first.storageRef),
    code("object-head-store-state-invalid"),
  );
  await assert.rejects(
    store.putObject("pocket-corrupt", first.storageRef, first.record),
    code("object-head-store-state-invalid"),
  );
  assert.deepEqual(controlled.object("pocket-corrupt", first.storageRef), corrupt.record);
});

test("P117 keeps missing Head distinct, initialises genesis, and advances only for an existing object", async () => {
  const candidate = object(6),
    abandoned = object(7),
    controlled = createPool(),
    store = createObjectHeadPostgresStore({ pool: controlled.pool });
  assert.equal(await store.readHead("pocket-head"), null);
  const genesis = await store.initialiseHead("pocket-head");
  assert.deepEqual(genesis, { schema: HEAD_SCHEMA, revision: 0, sealRef: null });
  assert.equal(Object.isFrozen(genesis), true);
  assert.deepEqual(await store.compareAndSetHead("pocket-head", genesis, candidate.storageRef), {
    ok: false,
    reason: "candidate-object-missing",
  });
  await store.putObject("pocket-head", candidate.storageRef, candidate.record);
  await store.putObject("pocket-head", abandoned.storageRef, abandoned.record);
  assert.deepEqual(await store.readHead("pocket-head"), genesis);
  const advanced = await store.compareAndSetHead("pocket-head", genesis, candidate.storageRef);
  assert.equal(advanced.ok, true);
  assert.deepEqual(advanced.head, {
    schema: HEAD_SCHEMA,
    revision: 1,
    sealRef: candidate.storageRef,
  });
  assert.equal(Object.isFrozen(advanced.head), true);
  assert.deepEqual(Object.keys(advanced.head), ["schema", "revision", "sealRef"]);
  assert.deepEqual(await store.initialiseHead("pocket-head"), advanced.head);
  assert.deepEqual(await store.readHead("pocket-head"), advanced.head);
  assert.equal(await store.getObject("pocket-head", abandoned.storageRef) !== null, true);
  const wrongRevision = await store.compareAndSetHead(
    "pocket-head",
    genesis,
    candidate.storageRef,
  );
  assert.deepEqual(wrongRevision, { ok: false, reason: "head-conflict" });
  const wrongSeal = await store.compareAndSetHead(
    "pocket-head",
    { schema: HEAD_SCHEMA, revision: 1, sealRef: abandoned.storageRef },
    candidate.storageRef,
  );
  assert.deepEqual(wrongSeal, { ok: false, reason: "head-conflict" });
  await assert.rejects(
    store.compareAndSetHead(
      "pocket-head",
      { ...advanced.head, unexpected: true },
      candidate.storageRef,
    ),
    code("object-head-store-head-invalid"),
  );
  await assert.rejects(
    store.compareAndSetHead("pocket-head", advanced.head, "proof-ref:v1:candidate-seal:00000000"),
    code("object-head-store-ref-invalid"),
  );
});

test("P117 maps Head races, exhausted revisions, corrupt state and transaction failure safely", async () => {
  const first = object(8),
    second = object(9),
    exhausted = object(10),
    controlled = createPool(),
    store = createObjectHeadPostgresStore({ pool: controlled.pool });
  await store.initialiseHead("pocket-race");
  await store.putObject("pocket-race", first.storageRef, first.record);
  await store.putObject("pocket-race", second.storageRef, second.record);
  const base = await store.readHead("pocket-race"),
    outcomes = await Promise.all([
      store.compareAndSetHead("pocket-race", base, first.storageRef),
      store.compareAndSetHead("pocket-race", base, second.storageRef),
    ]);
  assert.equal(outcomes.filter((outcome) => outcome.ok).length, 1);
  assert.equal(
    outcomes.filter((outcome) => !outcome.ok && outcome.reason === "head-conflict").length,
    1,
  );

  const maxControlled = createPool({
      objects: [{ syncedPocketId: "pocket-max", storageRef: exhausted.storageRef, record: exhausted.record }],
      heads: [{ syncedPocketId: "pocket-max", revision: Number.MAX_SAFE_INTEGER, seal_storage_ref: exhausted.storageRef }],
    }),
    maxStore = createObjectHeadPostgresStore({ pool: maxControlled.pool }),
    maxHead = await maxStore.readHead("pocket-max");
  assert.deepEqual(
    await maxStore.compareAndSetHead("pocket-max", maxHead, exhausted.storageRef),
    { ok: false, reason: "head-revision-exhausted" },
  );

  const corruptControlled = createPool({
      heads: [{ syncedPocketId: "pocket-bad", revision: 1, seal_storage_ref: null }],
    }),
    corruptStore = createObjectHeadPostgresStore({ pool: corruptControlled.pool });
  await assert.rejects(corruptStore.readHead("pocket-bad"), code("object-head-store-state-invalid"));

  const failure = object(11),
    failingControlled = createPool({ failCommit: nativeError("08006", "postgres://secret") }),
    failingStore = createObjectHeadPostgresStore({ pool: failingControlled.pool });
  let failureError;
  await assert.rejects(
    failingStore.putObject("pocket-failure", failure.storageRef, failure.record),
    (error) => {
      failureError = error;
      return error && error.code === "object-head-store-storage-failed";
    },
  );
  assert.equal(failureError.message.includes("postgres://secret"), false);
  assert.equal(failingControlled.object("pocket-failure", failure.storageRef), null);
  assert.equal(failingControlled.clients.every((client) => client.released), true);
  assert.equal(failingControlled.queries.some((entry) => entry.sql === "ROLLBACK"), true);
});
