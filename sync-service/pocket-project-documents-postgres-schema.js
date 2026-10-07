"use strict";

const DOCUMENT_COLUMNS = Object.freeze([
  ["name", "text", "NO"],
  ["content", "text", "NO"],
  ["revision", "bigint", "NO"],
  ["updated_at", "timestamp with time zone", "NO"],
]);

const SCHEMA_COMPONENTS = Object.freeze([
  "columns-catalog",
  "columns-contract",
  "constraints-catalog",
  "documents-primary-key",
  "documents-name-check",
  "documents-content-bytes-check",
  "documents-revision-bounds-check",
  "schema-version-query",
  "schema-version-value",
  "unknown",
]);

function safeProjectDocumentsSchemaComponent(error) {
  try { return SCHEMA_COMPONENTS.includes(error?.component) ? error.component : "unknown"; }
  catch (_error) { return "unknown"; }
}

function schemaError(component = "unknown") {
  const error = new Error("Pocket project documents PostgreSQL schema is invalid.");
  error.code = "project-documents-schema-invalid";
  Object.defineProperty(error, "component", {
    enumerable: false,
    value: SCHEMA_COMPONENTS.includes(component) ? component : "unknown",
  });
  return error;
}

function normalise(value) {
  return String(value).toLowerCase().replace(/::[a-z0-9_]+/g, "").replace(/[\s()]/g, "");
}

function normaliseBigintBounds(value) {
  return normalise(String(value).replace(/'([+-]?\d+)'\s*::\s*bigint\b/gi, "$1"));
}

async function query(pool, text, values, component) {
  try {
    const result = await pool.query(text, values);
    if (!result || !Array.isArray(result.rows)) throw schemaError(component);
    return result;
  } catch (_error) { throw schemaError(component); }
}

function hasColumn(rows, name, type, nullable) {
  return rows.some((row) => row.table_name === "pocket_project_documents"
    && row.column_name === name && row.data_type === type && row.is_nullable === nullable);
}

function hasExactIdentity(rows, type, definition) {
  return rows.some((row) => row.contype === type && normalise(row.definition) === definition);
}

function hasCheck(rows, predicate) {
  return rows.some((row) => row.contype === "c" && predicate(row.definition, normalise(row.definition)));
}

async function verifyPocketProjectDocumentsSchema(pool) {
  if (!pool || typeof pool.query !== "function") throw schemaError("columns-catalog");

  const columns = await query(pool,
    "SELECT table_name,column_name,data_type,is_nullable FROM information_schema.columns WHERE table_schema='public' AND table_name='pocket_project_documents'",
    undefined, "columns-catalog");
  if (DOCUMENT_COLUMNS.some(([name, type, nullable]) => !hasColumn(columns.rows, name, type, nullable))) {
    throw schemaError("columns-contract");
  }

  const constraints = await query(pool,
    "SELECT c.contype, pg_get_constraintdef(c.oid) AS definition FROM pg_constraint c WHERE c.conrelid='public.pocket_project_documents'::regclass",
    undefined, "constraints-catalog");
  if (!hasExactIdentity(constraints.rows, "p", "primarykeyname")) {
    throw schemaError("documents-primary-key");
  }
  if (!hasCheck(constraints.rows, (definition, value) => (
    value.includes("char_lengthname>=1")
    && value.includes("char_lengthname<=120")
    && definition.includes("^[a-z][a-z0-9]*(?:[.-][a-z0-9]+)*$")
  ))) {
    throw schemaError("documents-name-check");
  }
  if (!hasCheck(constraints.rows, (_definition, value) => value.includes("octet_lengthcontent<=2097152"))) {
    throw schemaError("documents-content-bytes-check");
  }
  if (!hasCheck(constraints.rows, (definition) => {
    const value = normaliseBigintBounds(definition);
    return value.includes("revision>=1") && value.includes("revision<=9007199254740991");
  })) {
    throw schemaError("documents-revision-bounds-check");
  }

  const version = await query(pool,
    "SELECT schema_name,schema_version FROM public.pocket_sync_schema WHERE schema_name=$1",
    ["pocket-project-documents"], "schema-version-query");
  if (version.rows.length !== 1 || version.rows[0]?.schema_name !== "pocket-project-documents"
      || version.rows[0]?.schema_version !== 1) {
    throw schemaError("schema-version-value");
  }

  return true;
}

module.exports = Object.freeze({
  safeProjectDocumentsSchemaComponent,
  verifyPocketProjectDocumentsSchema,
});
