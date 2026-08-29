"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const { verifyPocketSyncSchema, safeSchemaComponent } = require("../sync-service/pocket-sync-postgres-schema.js");
const { migrationDiagnostic } = require("../sync-service/pocket-sync-db-migrate.js");

const RECORD_CHECK = "CHECK (jsonb_typeof(record->'storeVersion')='number' AND record->>'storeVersion' ~ '^[1-9][0-9]*$' AND (record->>'storeVersion')::NUMERIC=store_version)";
const SENTINEL = "P081-PROVIDER-CONTROLLED-CONSTRAINT-DETAIL";

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

function validConstraints(recordChecks = [RECORD_CHECK]) {
  return [
    { relation: "public.pocket_sync_records", contype: "p", definition: "PRIMARY KEY (collection, record_key)" },
    { relation: "public.pocket_sync_records", contype: "c", definition: "CHECK (length(record_key)>0)" },
    { relation: "public.pocket_sync_records", contype: "c", definition: "CHECK (store_version>0 AND store_version<=9007199254740991)" },
    { relation: "public.pocket_sync_records", contype: "c", definition: "CHECK (collection IN ('accounts','credentials','sessions','ceremonies','pockets','operations','keySets','envelopes','recoveryLocators','recoveryCeremonies','keyOperations'))" },
    { relation: "public.pocket_sync_records", contype: "c", definition: "CHECK (jsonb_typeof(record)='object')" },
    ...recordChecks.map((definition) => ({ relation: "public.pocket_sync_records", contype: "c", definition })),
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

async function rejectsComponent(recordChecks, component) {
  await assert.rejects(verifyPocketSyncSchema(schemaPool(validConstraints(recordChecks))), (error) =>
    error?.code === "sync-server-schema-invalid" && error?.component === component
  );
}

test("P081 preserves the existing record/storeVersion acceptance predicate", async () => {
  await assert.doesNotReject(verifyPocketSyncSchema(schemaPool(validConstraints())));
});

test("P081 identifies the first missing record/storeVersion clause for one candidate", async (t) => {
  const cases = [
    ["record-store-version-json-type", "CHECK (record->>'storeVersion' ~ '^[1-9][0-9]*$' AND (record->>'storeVersion')::NUMERIC=store_version)"],
    ["record-store-version-extract", "CHECK (jsonb_typeof(record->'storeVersion')='number' AND '^[1-9][0-9]*$' AND opaque=store_version)"],
    ["record-store-version-pattern", "CHECK (jsonb_typeof(record->'storeVersion')='number' AND record->>'storeVersion' AND (record->>'storeVersion')::NUMERIC=store_version)"],
    ["record-store-version-equality", "CHECK (jsonb_typeof(record->'storeVersion')='number' AND record->>'storeVersion' ~ '^[1-9][0-9]*$')"],
  ];
  for (const [component, definition] of cases) await t.test(component, async () => {
    await rejectsComponent([definition], component);
  });
});

test("P081 falls back when the record/storeVersion candidate is ambiguous", async (t) => {
  await t.test("zero candidates", async () => {
    await rejectsComponent([], "record-store-version-check");
  });
  await t.test("multiple candidates", async () => {
    await rejectsComponent([
      "CHECK (record->>'storeVersion' ~ '^[1-9][0-9]*$' AND (record->>'storeVersion')::NUMERIC=store_version)",
      "CHECK (jsonb_typeof(record->'storeVersion')='number' AND '^[1-9][0-9]*$' AND opaque=store_version)",
    ], "record-store-version-check");
  });
});

test("P081 exposes only allow-listed diagnostic components", async () => {
  const constraints = validConstraints([`CHECK (${SENTINEL} storeVersion)`]);
  await assert.rejects(verifyPocketSyncSchema(schemaPool(constraints)), (error) =>
    error?.component === "record-store-version-json-type"
      && !error.message.includes(SENTINEL)
      && !JSON.stringify(error).includes(SENTINEL)
      && migrationDiagnostic({ stage: "schema-verify", component: error.component })
        === "Pocket Sync migration failed: schema-verify/record-store-version-json-type\n"
  );
  assert.equal(safeSchemaComponent({ component: SENTINEL }), "unknown");
  assert.equal(migrationDiagnostic({ stage: "schema-verify", component: SENTINEL }),
    "Pocket Sync migration failed: schema-verify/unknown\n");
});
