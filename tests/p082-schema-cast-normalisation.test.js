"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const { verifyPocketSyncSchema } = require("../sync-service/pocket-sync-postgres-schema.js");

const SYNTHETIC_RECORD_CHECK = "CHECK (jsonb_typeof(record->'storeVersion')='number' AND record->>'storeVersion' ~ '^[1-9][0-9]*$' AND (record->>'storeVersion')::NUMERIC=store_version)";
const POSTGRES_18_RECORD_CHECK = `CHECK (
  CASE
    WHEN jsonb_typeof(record -> 'storeVersion'::text) = 'number'::text
      AND (record ->> 'storeVersion'::text) ~ '^[1-9][0-9]*$'::text
    THEN (record ->> 'storeVersion'::text)::numeric = store_version
    ELSE FALSE
  END
)`;

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

function validConstraints(recordCheck = SYNTHETIC_RECORD_CHECK) {
  return [
    { relation: "public.pocket_sync_records", contype: "p", definition: "PRIMARY KEY (collection, record_key)" },
    { relation: "public.pocket_sync_records", contype: "c", definition: "CHECK (length(record_key)>0)" },
    { relation: "public.pocket_sync_records", contype: "c", definition: "CHECK (store_version>0 AND store_version<=9007199254740991)" },
    { relation: "public.pocket_sync_records", contype: "c", definition: "CHECK (collection IN ('accounts','credentials','sessions','ceremonies','pockets','operations','keySets','envelopes','recoveryLocators','recoveryCeremonies','keyOperations'))" },
    { relation: "public.pocket_sync_records", contype: "c", definition: "CHECK (jsonb_typeof(record)='object')" },
    { relation: "public.pocket_sync_records", contype: "c", definition: recordCheck },
    { relation: "public.pocket_sync_schema", contype: "p", definition: "PRIMARY KEY (schema_name)" },
  ];
}

function schemaPool(constraints) {
  return {
    async query(sql) {
      if (sql.includes("information_schema.columns")) return { rows: validColumns(), rowCount: 6 };
      if (sql.includes("FROM pg_constraint")) return { rows: constraints, rowCount: constraints.length };
      if (sql.includes("SELECT schema_version")) return { rows: [{ schema_version: 1 }], rowCount: 1 };
      throw new Error("unexpected query");
    },
  };
}

async function rejectsComponent(recordCheck, component) {
  await assert.rejects(verifyPocketSyncSchema(schemaPool(validConstraints(recordCheck))), (error) =>
    error?.code === "sync-server-schema-invalid" && error?.component === component
  );
}

test("P082 accepts PostgreSQL 18 reconstructed record/storeVersion constraints without losing AND record", async () => {
  await assert.doesNotReject(verifyPocketSyncSchema(schemaPool(validConstraints(SYNTHETIC_RECORD_CHECK))));
  await assert.doesNotReject(verifyPocketSyncSchema(schemaPool(validConstraints(POSTGRES_18_RECORD_CHECK))));
});

test("P082 retains strict P081 diagnostics for malformed reconstructed constraints", async (t) => {
  await t.test("wrong extraction", async () => {
    await rejectsComponent(POSTGRES_18_RECORD_CHECK.replaceAll("record ->>", "payload ->>"),
      "record-store-version-extract");
  });
  await t.test("wrong decimal pattern", async () => {
    await rejectsComponent(POSTGRES_18_RECORD_CHECK.replace("'^[1-9][0-9]*$'::text", "'^[0-9]+$'::text"),
      "record-store-version-pattern");
  });
  await t.test("wrong equality", async () => {
    await rejectsComponent(POSTGRES_18_RECORD_CHECK.replace("= store_version", "<> store_version"),
      "record-store-version-equality");
  });
});
