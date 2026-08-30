"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const Module = require("node:module");
const { verifyPocketSyncSchema } = require("../sync-service/pocket-sync-postgres-schema.js");

const ROOT = path.resolve(__dirname, "..");
const MIGRATION_MODULE = require.resolve("../sync-service/pocket-sync-db-migrate.js");
const FIRST_MIGRATION = path.join(ROOT, "sync-service/migrations/001-pocket-sync-store.sql");
const SECOND_MIGRATION = path.join(ROOT, "sync-service/migrations/002-pocket-sync-object-head-store.sql");

function copy(value) {
  return structuredClone(value);
}

function validFixture() {
  return {
    columns: [
      ["pocket_sync_records", "collection", "text", "NO"],
      ["pocket_sync_records", "record_key", "text", "NO"],
      ["pocket_sync_records", "store_version", "bigint", "NO"],
      ["pocket_sync_records", "record", "jsonb", "NO"],
      ["pocket_sync_schema", "schema_name", "text", "NO"],
      ["pocket_sync_schema", "schema_version", "integer", "NO"],
      ["pocket_sync_objects", "synced_pocket_id", "text", "NO"],
      ["pocket_sync_objects", "storage_ref", "text", "NO"],
      ["pocket_sync_objects", "record", "jsonb", "NO"],
      ["pocket_sync_heads", "synced_pocket_id", "text", "NO"],
      ["pocket_sync_heads", "revision", "bigint", "NO"],
      ["pocket_sync_heads", "seal_storage_ref", "text", "YES"],
    ].map(([table_name, column_name, data_type, is_nullable]) => ({
      table_name, column_name, data_type, is_nullable,
    })),
    constraints: [
      ["pocket_sync_records", "p", "PRIMARY KEY (collection, record_key)"],
      ["pocket_sync_records", "c", "CHECK (length(record_key)>0)"],
      ["pocket_sync_records", "c", "CHECK (store_version>0 AND store_version<=9007199254740991)"],
      ["pocket_sync_records", "c", "CHECK (collection IN ('accounts','credentials','sessions','ceremonies','pockets','operations','keySets','envelopes','recoveryLocators','recoveryCeremonies','keyOperations'))"],
      ["pocket_sync_records", "c", "CHECK (jsonb_typeof(record)='object')"],
      ["pocket_sync_records", "c", "CHECK (jsonb_typeof(record->'storeVersion')='number' AND record->>'storeVersion' ~ '^[1-9][0-9]*$' AND (record->>'storeVersion')::NUMERIC=store_version)"],
      ["pocket_sync_schema", "p", "PRIMARY KEY (schema_name)"],
      ["pocket_sync_objects", "p", "PRIMARY KEY (synced_pocket_id, storage_ref)"],
      ["pocket_sync_objects", "c", "CHECK (length(synced_pocket_id)>0)"],
      ["pocket_sync_objects", "c", "CHECK (length(storage_ref)>0)"],
      ["pocket_sync_objects", "c", "CHECK (jsonb_typeof(record)='object')"],
      ["pocket_sync_heads", "p", "PRIMARY KEY (synced_pocket_id)"],
      ["pocket_sync_heads", "c", "CHECK (length(synced_pocket_id)>0)"],
      ["pocket_sync_heads", "c", "CHECK (revision>=0 AND revision<=9007199254740991)"],
      ["pocket_sync_heads", "c", "CHECK ((revision=0 AND seal_storage_ref IS NULL) OR (revision>0 AND seal_storage_ref IS NOT NULL AND length(seal_storage_ref)>0))"],
    ].map(([table, contype, definition]) => ({ relation: `public.${table}`, contype, definition })),
    versions: [
      { schema_name: "pocket-sync-store", schema_version: 1 },
      { schema_name: "pocket-sync-object-head-store", schema_version: 1 },
    ],
  };
}

function schemaPool(fixture) {
  return {
    async query(sql) {
      if (sql.includes("information_schema.columns")) return { rows: fixture.columns, rowCount: fixture.columns.length };
      if (sql.includes("FROM pg_constraint")) return { rows: fixture.constraints, rowCount: fixture.constraints.length };
      if (sql.includes("FROM public.pocket_sync_schema")) return { rows: fixture.versions, rowCount: fixture.versions.length };
      throw new Error("unexpected query");
    },
  };
}

async function rejects(fixture, component) {
  await assert.rejects(verifyPocketSyncSchema(schemaPool(fixture)), (error) =>
    error?.code === "sync-server-schema-invalid" && error.component === component
  );
}

function loadMigration(dependencies) {
  const originalLoad = Module._load;
  const cached = require.cache[MIGRATION_MODULE];
  Module._load = function patchedLoad(name, parent, isMain) {
    if (name === "pg") return { Pool: dependencies.Pool };
    if (name === "./pocket-sync-server-config.js") return { readDatabaseConnection: () => "postgres://test-only" };
    if (name === "./pocket-sync-postgres-schema.js") {
      return { verifyPocketSyncSchema: dependencies.verifyPocketSyncSchema, safeSchemaComponent: () => "unknown" };
    }
    return originalLoad.call(this, name, parent, isMain);
  };
  delete require.cache[MIGRATION_MODULE];
  try { return require(MIGRATION_MODULE); }
  finally {
    Module._load = originalLoad;
    if (cached) require.cache[MIGRATION_MODULE] = cached;
    else delete require.cache[MIGRATION_MODULE];
  }
}

function migrationDependencies({ failAt = null } = {}) {
  const calls = [];
  let ended = 0;
  class Pool {
    async query(sql) {
      calls.push(sql);
      if (failAt === calls.length) throw new Error("provider detail");
      return { rows: [], rowCount: 0 };
    }
    async end() { ended += 1; }
  }
  return {
    Pool,
    calls,
    ended: () => ended,
    async verifyPocketSyncSchema() { calls.push("verify"); return true; },
  };
}

test("P118 runs the two fixed additive migrations in order before verification", async () => {
  const dependencies = migrationDependencies();
  const { applyLocalMigration } = loadMigration(dependencies);
  await assert.doesNotReject(applyLocalMigration("postgres://test-only"));
  assert.deepEqual(dependencies.calls, [
    fs.readFileSync(FIRST_MIGRATION, "utf8"),
    fs.readFileSync(SECOND_MIGRATION, "utf8"),
    "verify",
  ]);
  assert.equal(dependencies.ended(), 1);
});

test("P118 keeps migration read and apply failures safe and closes pools", async (t) => {
  await t.test("second migration read", async () => {
    const dependencies = migrationDependencies();
    const originalRead = fs.readFileSync;
    const { applyLocalMigration } = loadMigration(dependencies);
    fs.readFileSync = function failSecondMigration(filename, ...rest) {
      if (filename === SECOND_MIGRATION) throw new Error("provider detail");
      return originalRead.call(this, filename, ...rest);
    };
    try {
      await assert.rejects(applyLocalMigration("postgres://test-only"), (error) => error.stage === "migration-file");
    } finally { fs.readFileSync = originalRead; }
    assert.equal(dependencies.ended(), 0);
  });
  for (const failAt of [1, 2]) await t.test(`apply ${failAt}`, async () => {
    const dependencies = migrationDependencies({ failAt });
    const { applyLocalMigration } = loadMigration(dependencies);
    await assert.rejects(applyLocalMigration("postgres://test-only"), (error) => error.stage === "migration-apply");
    assert.equal(dependencies.ended(), 1);
    assert.deepEqual(dependencies.calls, failAt === 1
      ? [fs.readFileSync(FIRST_MIGRATION, "utf8")]
      : [fs.readFileSync(FIRST_MIGRATION, "utf8"), fs.readFileSync(SECOND_MIGRATION, "utf8")]);
  });
});

test("P118 migration files are additive and create neither object nor Head rows", () => {
  const first = fs.readFileSync(FIRST_MIGRATION, "utf8");
  const second = fs.readFileSync(SECOND_MIGRATION, "utf8");
  assert.match(first, /CREATE TABLE IF NOT EXISTS/);
  assert.match(second, /CREATE TABLE IF NOT EXISTS public\.pocket_sync_objects/);
  assert.match(second, /CREATE TABLE IF NOT EXISTS public\.pocket_sync_heads/);
  assert.match(second, /ON CONFLICT \(schema_name\) DO NOTHING/);
  assert.doesNotMatch(second, /INSERT INTO public\.pocket_sync_(objects|heads)|UPDATE public\.pocket_sync_|DELETE FROM public\.pocket_sync_/i);
});

test("P118 accepts a complete combined legacy, object and Head catalogue", async () => {
  await assert.doesNotReject(verifyPocketSyncSchema(schemaPool(validFixture())));
});

test("P118 requires the object and Head table contracts", async (t) => {
  const cases = [
    ["object column", "object-columns-contract", (fixture) => { fixture.columns.pop(); fixture.columns.splice(6, 1); }],
    ["object composite primary key", "objects-primary-key", (fixture) => {
      fixture.constraints.find((row) => row.relation === "public.pocket_sync_objects" && row.contype === "p").definition = "PRIMARY KEY (storage_ref, synced_pocket_id)";
    }],
    ["object pocket identifier", "objects-synced-pocket-id-check", (fixture) => {
      fixture.constraints.find((row) => row.definition.includes("length(synced_pocket_id)>0") && row.relation.endsWith("objects")).definition = "CHECK (length(synced_pocket_id)>=0)";
    }],
    ["object storage reference", "objects-storage-ref-check", (fixture) => {
      fixture.constraints.find((row) => row.definition.includes("length(storage_ref)>0")).definition = "CHECK (length(storage_ref)>=0)";
    }],
    ["object record", "objects-record-json-object-check", (fixture) => {
      fixture.constraints.find((row) => row.relation.endsWith("objects") && row.definition.includes("jsonb_typeof")).definition = "CHECK (jsonb_typeof(record)='array')";
    }],
    ["Head nullable seal", "heads-seal-storage-ref-nullability", (fixture) => {
      fixture.columns.find((row) => row.table_name === "pocket_sync_heads" && row.column_name === "seal_storage_ref").is_nullable = "NO";
    }],
    ["Head primary key", "heads-primary-key", (fixture) => {
      fixture.constraints.find((row) => row.relation.endsWith("heads") && row.contype === "p").definition = "PRIMARY KEY (revision)";
    }],
    ["Head pocket identifier", "heads-synced-pocket-id-check", (fixture) => {
      fixture.constraints.find((row) => row.relation.endsWith("heads") && row.definition.includes("length(synced_pocket_id)>0")).definition = "CHECK (length(synced_pocket_id)>=0)";
    }],
    ["Head revision bounds", "heads-revision-bounds-check", (fixture) => {
      fixture.constraints.find((row) => row.relation.endsWith("heads") && row.definition.includes("revision>=0")).definition = "CHECK (revision>0 AND revision<=9007199254740991)";
    }],
    ["Head revision/seal pairing", "heads-revision-seal-check", (fixture) => {
      fixture.constraints.find((row) => row.relation.endsWith("heads") && row.definition.includes("seal_storage_ref IS NULL")).definition = "CHECK (revision>=0)";
    }],
  ];
  for (const [name, component, mutate] of cases) await t.test(name, async () => {
    const fixture = copy(validFixture());
    mutate(fixture);
    await rejects(fixture, component);
  });
});

test("P118 requires both version-one metadata rows and preserves bigint normalisation", async (t) => {
  for (const [name, component, mutate] of [
    ["missing object Head row", "object-head-schema-version-value", (fixture) => { fixture.versions.pop(); }],
    ["duplicate object Head row", "object-head-schema-version-value", (fixture) => { fixture.versions.push(copy(fixture.versions[1])); }],
    ["wrong object Head version", "object-head-schema-version-value", (fixture) => { fixture.versions[1].schema_version = 2; }],
    ["missing legacy row", "schema-version-value", (fixture) => { fixture.versions.shift(); }],
    ["legacy primary key", "records-primary-key", (fixture) => {
      fixture.constraints.find((row) => row.relation.endsWith("records") && row.contype === "p").definition = "PRIMARY KEY (record_key, collection)";
    }],
  ]) await t.test(name, async () => {
    const fixture = copy(validFixture());
    mutate(fixture);
    await rejects(fixture, component);
  });
  const fixture = validFixture();
  fixture.constraints.find((row) => row.relation.endsWith("heads") && row.definition.includes("revision>=0")).definition = "CHECK (((revision >= '0'::bigint) AND (revision <= '9007199254740991'::bigint)))";
  await assert.doesNotReject(verifyPocketSyncSchema(schemaPool(fixture)));
});

test("P118 keeps object/Head browser adoption dormant", () => {
  const browser = [
    "js/pocket-sync-owner-controller.js", "index.html", "sw.js",
  ].map((file) => fs.readFileSync(path.join(ROOT, file), "utf8")).join("\n");
  assert.doesNotMatch(browser, /pocket-sync-object-head-postgres-store|object.?head|\/objects|\/heads/i);
});
