"use strict";

const RECORD_COLUMNS = Object.freeze([
  ["collection", "text"], ["record_key", "text"], ["store_version", "bigint"], ["record", "jsonb"],
]);
const SCHEMA_COLUMNS = Object.freeze([["schema_name", "text"], ["schema_version", "integer"]]);
const COLLECTIONS = Object.freeze([
  "accounts", "credentials", "sessions", "ceremonies", "pockets", "operations",
  "keySets", "envelopes", "recoveryLocators", "recoveryCeremonies", "keyOperations",
]);

function schemaError() {
  const error = new Error("Pocket Sync PostgreSQL schema is invalid.");
  error.code = "sync-server-schema-invalid";
  return error;
}

function normalise(value) {
  return String(value).toLowerCase().replace(/[\s()]/g, "").replace(/::[a-z0-9_]+/g, "");
}

function quotedValues(definition) {
  return Array.from(String(definition).matchAll(/'([^']*)'/g), (match) => match[1]);
}

function sameValues(actual, expected) {
  return actual.length === expected.length
    && actual.every((value) => expected.includes(value));
}

async function query(pool, text, values) {
  try {
    const result = await pool.query(text, values);
    if (!result || !Array.isArray(result.rows)) throw schemaError();
    return result;
  } catch (_error) { throw schemaError(); }
}

function hasColumn(rows, table, name, type) {
  return rows.some((row) => row.table_name === table && row.column_name === name
    && row.data_type === type && row.is_nullable === "NO");
}

function hasExactIdentity(rows, type, definition) {
  return rows.some((row) => row.contype === type && normalise(row.definition) === definition);
}

function hasCheck(rows, predicate) {
  return rows.some((row) => row.contype === "c" && predicate(row.definition, normalise(row.definition)));
}

async function verifyPocketSyncSchema(pool) {
  if (!pool || typeof pool.query !== "function") throw schemaError();
  const columns = await query(pool,
    "SELECT table_name,column_name,data_type,is_nullable FROM information_schema.columns WHERE table_schema='public' AND table_name IN ('pocket_sync_records','pocket_sync_schema')");
  if (RECORD_COLUMNS.some(([name, type]) => !hasColumn(columns.rows, "pocket_sync_records", name, type))
      || SCHEMA_COLUMNS.some(([name, type]) => !hasColumn(columns.rows, "pocket_sync_schema", name, type))) {
    throw schemaError();
  }

  const constraints = await query(pool,
    "SELECT n.nspname || '.' || r.relname AS relation, c.contype, pg_get_constraintdef(c.oid) AS definition FROM pg_constraint c JOIN pg_class r ON r.oid=c.conrelid JOIN pg_namespace n ON n.oid=r.relnamespace WHERE c.conrelid IN ('public.pocket_sync_records'::regclass,'public.pocket_sync_schema'::regclass)");
  const records = constraints.rows.filter((row) => row.relation === "public.pocket_sync_records");
  const metadata = constraints.rows.filter((row) => row.relation === "public.pocket_sync_schema");
  if (!hasExactIdentity(records, "p", "primarykeycollection,record_key")
      || !(hasExactIdentity(metadata, "p", "primarykeyschema_name")
        || hasExactIdentity(metadata, "u", "uniqueschema_name"))) {
    throw schemaError();
  }
  const collectionCheck = records.some((row) => row.contype === "c"
    && normalise(row.definition).includes("collection")
    && sameValues(quotedValues(row.definition), COLLECTIONS));
  const requiredChecks = [
    (definition) => normalise(definition).includes("lengthrecord_key>0"),
    (definition) => {
      const value = normalise(definition);
      return value.includes("store_version>0") && value.includes("store_version<=9007199254740991");
    },
    (definition) => normalise(definition).includes("jsonb_typeofrecord='object'"),
    (definition) => {
      const value = normalise(definition);
      return value.includes("jsonb_typeofrecord->'storeversion'='number'")
        && value.includes("record->>'storeversion'")
        && value.includes("'^[1-9][0-9]*$'")
        && value.includes("=store_version");
    },
  ];
  if (!collectionCheck || requiredChecks.some((predicate) => !hasCheck(records, predicate))) {
    throw schemaError();
  }

  const version = await query(pool,
    "SELECT schema_version FROM public.pocket_sync_schema WHERE schema_name=$1", ["pocket-sync-store"]);
  if (version.rowCount !== 1 || version.rows[0]?.schema_version !== 1) throw schemaError();
  return true;
}

module.exports = Object.freeze({ verifyPocketSyncSchema });
