"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const {
  safeProjectDocumentsSchemaComponent,
  verifyPocketProjectDocumentsSchema,
} = require("../sync-service/pocket-project-documents-postgres-schema.js");

const migrationPath = path.join(__dirname, "..", "sync-service", "migrations", "004-pocket-project-documents.sql");
const migratorPath = path.join(__dirname, "..", "sync-service", "pocket-sync-db-migrate.js");

function validRows() {
  return {
    columns: [
      { table_name: "pocket_project_documents", column_name: "name", data_type: "text", is_nullable: "NO" },
      { table_name: "pocket_project_documents", column_name: "content", data_type: "text", is_nullable: "NO" },
      { table_name: "pocket_project_documents", column_name: "revision", data_type: "bigint", is_nullable: "NO" },
      { table_name: "pocket_project_documents", column_name: "updated_at", data_type: "timestamp with time zone", is_nullable: "NO" },
    ],
    constraints: [
      { contype: "p", definition: "PRIMARY KEY (name)" },
      { contype: "c", definition: "CHECK (((char_length(name) >= 1) AND (char_length(name) <= 120) AND (name ~ '^[a-z][a-z0-9]*(?:[.-][a-z0-9]+)*$'::text)))" },
      { contype: "c", definition: "CHECK ((octet_length(content) <= 2097152))" },
      { contype: "c", definition: "CHECK (((revision >= 1) AND (revision <= '9007199254740991'::bigint)))" },
    ],
    version: [{ schema_name: "pocket-project-documents", schema_version: 1 }],
  };
}

function poolFor(rows) {
  return {
    async query(sql) {
      if (sql.includes("information_schema.columns")) return { rows: rows.columns };
      if (sql.includes("pg_constraint")) return { rows: rows.constraints };
      if (sql.includes("pocket_sync_schema")) return { rows: rows.version };
      throw new Error("unexpected query");
    },
  };
}

test("P349 migration creates only the bounded project-document schema contract", () => {
  const sql = fs.readFileSync(migrationPath, "utf8");
  assert.match(sql, /CREATE TABLE IF NOT EXISTS public\.pocket_project_documents/);
  assert.match(sql, /name TEXT PRIMARY KEY/);
  assert.match(sql, /content TEXT NOT NULL/);
  assert.match(sql, /revision BIGINT NOT NULL CHECK \(revision >= 1 AND revision <= 9007199254740991\)/);
  assert.match(sql, /updated_at TIMESTAMPTZ NOT NULL/);
  assert.match(sql, /octet_length\(content\) <= 2097152/);
  assert.match(sql, /pocket-project-documents/);
  assert.doesNotMatch(sql, /INSERT INTO public\.pocket_project_documents/i);
  assert.doesNotMatch(sql, /pocket_sync_records|pocket_sync_objects|pocket_sync_heads/i);
});

test("P349 project-document schema verifier accepts the exact schema", async () => {
  assert.equal(await verifyPocketProjectDocumentsSchema(poolFor(validRows())), true);
});

test("P349 project-document schema verifier fails closed on a missing bounded constraint", async () => {
  const rows = validRows();
  rows.constraints = rows.constraints.filter((row) => !row.definition.includes("octet_length"));
  await assert.rejects(
    () => verifyPocketProjectDocumentsSchema(poolFor(rows)),
    (error) => error?.code === "project-documents-schema-invalid"
      && safeProjectDocumentsSchemaComponent(error) === "documents-content-bytes-check"
  );
});

test("P349 existing migration owner explicitly includes and verifies migration 004", () => {
  const source = fs.readFileSync(migratorPath, "utf8");
  assert.match(source, /\["004", "pocket", "project", "documents\.sql"\]/);
  assert.match(source, /verifyPocketProjectDocumentsSchema/);
  assert.match(source, /project-documents-schema-verify/);
});
