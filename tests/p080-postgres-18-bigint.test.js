"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const { verifyPocketSyncSchema } = require("../sync-service/pocket-sync-postgres-schema.js");

const UNQUOTED_BOUNDS = "CHECK (store_version>0 AND store_version<=9007199254740991)";
const POSTGRES_18_BOUNDS = "CHECK (((store_version > '0'::bigint) AND (store_version <= '9007199254740991'::bigint)))";

function validColumns() {
  return [
    { table_name: "pocket_sync_records", column_name: "collection", data_type: "text", is_nullable: "NO" },
    { table_name: "pocket_sync_records", column_name: "record_key", data_type: "text", is_nullable: "NO" },
    { table_name: "pocket_sync_records", column_name: "store_version", data_type: "bigint", is_nullable: "NO" },
    { table_name: "pocket_sync_records", column_name: "record", data_type: "jsonb", is_nullable: "NO" },
    { table_name: "pocket_sync_schema", column_name: "schema_name", data_type: "text", is_nullable: "NO" },
    { table_name: "pocket_sync_schema", column_name: "schema_version", data_type: "integer", is_nullable: "NO" },
    { table_name: "pocket_sync_objects", column_name: "synced_pocket_id", data_type: "text", is_nullable: "NO" },
    { table_name: "pocket_sync_objects", column_name: "storage_ref", data_type: "text", is_nullable: "NO" },
    { table_name: "pocket_sync_objects", column_name: "record", data_type: "jsonb", is_nullable: "NO" },
    { table_name: "pocket_sync_heads", column_name: "synced_pocket_id", data_type: "text", is_nullable: "NO" },
    { table_name: "pocket_sync_heads", column_name: "revision", data_type: "bigint", is_nullable: "NO" },
    { table_name: "pocket_sync_heads", column_name: "seal_storage_ref", data_type: "text", is_nullable: "YES" },
  ];
}

function validConstraints(bounds = UNQUOTED_BOUNDS) {
  return [
    { relation: "public.pocket_sync_records", contype: "p", definition: "PRIMARY KEY (collection, record_key)" },
    { relation: "public.pocket_sync_records", contype: "c", definition: "CHECK (length(record_key)>0)" },
    { relation: "public.pocket_sync_records", contype: "c", definition: bounds },
    { relation: "public.pocket_sync_records", contype: "c", definition: "CHECK (collection IN ('accounts','credentials','sessions','ceremonies','pockets','operations','keySets','envelopes','recoveryLocators','recoveryCeremonies','keyOperations'))" },
    { relation: "public.pocket_sync_records", contype: "c", definition: "CHECK (jsonb_typeof(record)='object')" },
    { relation: "public.pocket_sync_records", contype: "c", definition: "CHECK (jsonb_typeof(record->'storeVersion')='number' AND record->>'storeVersion' ~ '^[1-9][0-9]*$' AND (record->>'storeVersion')::NUMERIC=store_version)" },
    { relation: "public.pocket_sync_schema", contype: "p", definition: "PRIMARY KEY (schema_name)" },
    { relation: "public.pocket_sync_objects", contype: "p", definition: "PRIMARY KEY (synced_pocket_id, storage_ref)" },
    { relation: "public.pocket_sync_objects", contype: "c", definition: "CHECK (length(synced_pocket_id)>0)" },
    { relation: "public.pocket_sync_objects", contype: "c", definition: "CHECK (length(storage_ref)>0)" },
    { relation: "public.pocket_sync_objects", contype: "c", definition: "CHECK (jsonb_typeof(record)='object')" },
    { relation: "public.pocket_sync_heads", contype: "p", definition: "PRIMARY KEY (synced_pocket_id)" },
    { relation: "public.pocket_sync_heads", contype: "c", definition: "CHECK (length(synced_pocket_id)>0)" },
    { relation: "public.pocket_sync_heads", contype: "c", definition: "CHECK (revision>=0 AND revision<=9007199254740991)" },
    { relation: "public.pocket_sync_heads", contype: "c", definition: "CHECK ((revision=0 AND seal_storage_ref IS NULL) OR (revision>0 AND seal_storage_ref IS NOT NULL AND length(seal_storage_ref)>0))" },
  ];
}

function schemaPool(constraints) {
  return {
    async query(sql) {
      if (sql.includes("information_schema.columns")) return { rows: validColumns(), rowCount: 12 };
      if (sql.includes("FROM pg_constraint")) return { rows: constraints, rowCount: constraints.length };
      if (sql.includes("SELECT schema_name,schema_version")) return { rows: [
        { schema_name: "pocket-sync-store", schema_version: 1 },
        { schema_name: "pocket-sync-object-head-store", schema_version: 1 },
      ], rowCount: 2 };
      throw new Error("unexpected query");
    },
  };
}

async function rejectsComponent(constraints, component) {
  await assert.rejects(verifyPocketSyncSchema(schemaPool(constraints)), (error) =>
    error?.code === "sync-server-schema-invalid" && error?.component === component
  );
}

test("P080 accepts both legacy and PostgreSQL 18 BIGINT bounds definitions", async () => {
  await assert.doesNotReject(verifyPocketSyncSchema(schemaPool(validConstraints(UNQUOTED_BOUNDS))));
  await assert.doesNotReject(verifyPocketSyncSchema(schemaPool(validConstraints(POSTGRES_18_BOUNDS))));
});

test("P080 retains exact store_version bound operators and values", async (t) => {
  const cases = [
    "CHECK (store_version >= '0'::bigint AND store_version <= '9007199254740991'::bigint)",
    "CHECK (store_version > '1'::bigint AND store_version <= '9007199254740991'::bigint)",
    "CHECK (store_version <= '9007199254740991'::bigint)",
    "CHECK (store_version > '0'::bigint AND store_version < '9007199254740991'::bigint)",
    "CHECK (store_version > '0'::bigint AND store_version <= '9007199254740992'::bigint)",
    "CHECK (store_version > '0'::bigint)",
  ];
  for (const definition of cases) await t.test(definition, async () => {
    await rejectsComponent(validConstraints(definition), "store-version-bounds-check");
  });
});

test("P080 does not apply typed-integer handling to unrelated verifier checks", async (t) => {
  await t.test("collection allow-list", async () => {
    const constraints = validConstraints();
    constraints.find((row) => row.definition.includes("collection IN"))
      .definition = "CHECK (collection IN ('0'::bigint))";
    await rejectsComponent(constraints, "collection-check");
  });
  await t.test("record key", async () => {
    const constraints = validConstraints();
    constraints.find((row) => row.definition.includes("length(record_key)"))
      .definition = "CHECK (length(record_key)>'0'::bigint)";
    await rejectsComponent(constraints, "record-key-check");
  });
  await t.test("record JSON object", async () => {
    const constraints = validConstraints();
    constraints.find((row) => row.definition.includes("jsonb_typeof(record)='object'"))
      .definition = "CHECK (jsonb_typeof(record)='0'::bigint)";
    await rejectsComponent(constraints, "record-json-object-check");
  });
  await t.test("record version regex", async () => {
    const constraints = validConstraints();
    constraints.find((row) => row.definition.includes("storeVersion") && row.definition.includes("NUMERIC"))
      .definition = "CHECK (jsonb_typeof(record->'storeVersion')='number' AND record->>'storeVersion' ~ '1'::bigint AND (record->>'storeVersion')::NUMERIC=store_version)";
    await rejectsComponent(constraints, "record-store-version-pattern");
  });
});
