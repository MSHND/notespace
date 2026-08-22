"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const { verifyPocketSyncSchema, safeSchemaComponent } = require("../sync-service/pocket-sync-postgres-schema.js");
const { migrationDiagnostic } = require("../sync-service/pocket-sync-db-migrate.js");

const SENTINEL = "P079-SENTINEL-PROVIDER-CATALOG-DETAIL";

function validColumns() {
  return [
    { table_name: "pocket_sync_records", column_name: "collection", data_type: "text", is_nullable: "NO" },
    { table_name: "pocket_sync_records", column_name: "record_key", data_type: "text", is_nullable: "NO" },
    { table_name: "pocket_sync_records", column_name: "store_version", data_type: "bigint", is_nullable: "NO" },
    { table_name: "pocket_sync_records", column_name: "record", data_type: "jsonb", is_nullable: "NO" },
    { table_name: "pocket_sync_schema", column_name: "schema_name", data_type: "text", is_nullable: "NO" },
    { table_name: "pocket_sync_schema", column_name: "schema_version", data_type: "integer", is_nullable: "NO" },
  ];
}

function validConstraints() {
  return [
    { relation: "public.pocket_sync_records", contype: "p", definition: "PRIMARY KEY (collection, record_key)" },
    { relation: "public.pocket_sync_records", contype: "c", definition: "CHECK (length(record_key)>0)" },
    { relation: "public.pocket_sync_records", contype: "c", definition: "CHECK (store_version>0 AND store_version<=9007199254740991)" },
    { relation: "public.pocket_sync_records", contype: "c", definition: "CHECK (collection IN ('accounts','credentials','sessions','ceremonies','pockets','operations','keySets','envelopes','recoveryLocators','recoveryCeremonies','keyOperations'))" },
    { relation: "public.pocket_sync_records", contype: "c", definition: "CHECK (jsonb_typeof(record)='object')" },
    { relation: "public.pocket_sync_records", contype: "c", definition: "CHECK (jsonb_typeof(record->'storeVersion')='number' AND record->>'storeVersion' ~ '^[1-9][0-9]*$' AND (record->>'storeVersion')::NUMERIC=store_version)" },
    { relation: "public.pocket_sync_schema", contype: "p", definition: "PRIMARY KEY (schema_name)" },
  ];
}

function catalogFailurePool(component) {
  return {
    async query(sql) {
      if (component === "columns-catalog" && sql.includes("information_schema.columns")) throw new Error(SENTINEL);
      if (component === "constraints-catalog" && sql.includes("FROM pg_constraint")) throw new Error(SENTINEL);
      if (component === "schema-version-query" && sql.includes("SELECT schema_version")) throw new Error(SENTINEL);
      if (sql.includes("information_schema.columns")) return { rows: validColumns(), rowCount: 6 };
      if (sql.includes("FROM pg_constraint")) return { rows: validConstraints(), rowCount: 7 };
      if (sql.includes("SELECT schema_version")) return { rows: [{ schema_version: 1 }], rowCount: 1 };
      throw new Error(SENTINEL);
    },
  };
}

test("P079 catalog query failures expose only their allow-listed component", async (t) => {
  for (const component of ["columns-catalog", "constraints-catalog", "schema-version-query"]) {
    await t.test(component, async () => {
      await assert.rejects(verifyPocketSyncSchema(catalogFailurePool(component)), (error) =>
        error?.code === "sync-server-schema-invalid" && error?.component === component
          && !error.message.includes(SENTINEL) && !JSON.stringify(error).includes(SENTINEL)
      );
    });
  }
});

test("P079 uses unknown for untrusted components and retains safe schema CLI output", () => {
  assert.equal(safeSchemaComponent({ component: SENTINEL }), "unknown");
  assert.equal(safeSchemaComponent(new Error(SENTINEL)), "unknown");
  assert.equal(migrationDiagnostic({ stage: "schema-verify", component: "columns-contract" }),
    "Pocket Sync migration failed: schema-verify/columns-contract\n");
  const output = migrationDiagnostic({ stage: "schema-verify", component: SENTINEL });
  assert.equal(output, "Pocket Sync migration failed: schema-verify/unknown\n");
  assert.doesNotMatch(output, new RegExp(SENTINEL));
});
