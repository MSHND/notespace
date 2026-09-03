"use strict";

const RECORD_COLUMNS = Object.freeze([
  ["collection", "text"], ["record_key", "text"], ["store_version", "bigint"], ["record", "jsonb"],
]);
const SCHEMA_COLUMNS = Object.freeze([["schema_name", "text"], ["schema_version", "integer"]]);
const OBJECT_COLUMNS = Object.freeze([
  ["synced_pocket_id", "text", "NO"], ["storage_ref", "text", "NO"], ["record", "jsonb", "NO"],
]);
const HEAD_COLUMNS = Object.freeze([
  ["synced_pocket_id", "text", "NO"], ["revision", "bigint", "NO"], ["seal_storage_ref", "text", "YES"],
]);
const COLLECTIONS = Object.freeze([
  "accounts", "credentials", "sessions", "ceremonies", "pockets", "operations",
  "keySets", "envelopes", "recoveryLocators", "recoveryCeremonies", "keyOperations",
  "persistenceAuthorities",
]);
const SCHEMA_COMPONENTS = Object.freeze([
  "columns-catalog", "columns-contract", "constraints-catalog", "records-primary-key",
  "metadata-identity", "collection-check", "record-key-check", "store-version-bounds-check",
  "record-json-object-check", "record-store-version-check", "schema-version-query",
  "record-store-version-json-type", "record-store-version-extract",
  "record-store-version-pattern", "record-store-version-equality", "schema-version-value",
  "object-columns-contract", "head-columns-contract", "objects-primary-key",
  "objects-synced-pocket-id-check", "objects-storage-ref-check", "objects-record-json-object-check",
  "heads-primary-key", "heads-synced-pocket-id-check", "heads-revision-bounds-check",
  "heads-revision-seal-check", "heads-seal-storage-ref-nullability", "object-head-schema-version-value",
  "unknown",
]);

function safeSchemaComponent(error) {
  try { return SCHEMA_COMPONENTS.includes(error?.component) ? error.component : "unknown"; }
  catch (_error) { return "unknown"; }
}

function schemaError(component = "unknown") {
  const error = new Error("Pocket Sync PostgreSQL schema is invalid.");
  error.code = "sync-server-schema-invalid";
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

function quotedValues(definition) {
  return Array.from(String(definition).matchAll(/'([^']*)'/g), (match) => match[1]);
}

function sameValues(actual, expected) {
  return actual.length === expected.length
    && actual.every((value) => expected.includes(value));
}

async function query(pool, text, values, component) {
  try {
    const result = await pool.query(text, values);
    if (!result || !Array.isArray(result.rows)) throw schemaError(component);
    return result;
  } catch (_error) { throw schemaError(component); }
}

function hasColumn(rows, table, name, type, nullable = "NO") {
  return rows.some((row) => row.table_name === table && row.column_name === name
    && row.data_type === type && row.is_nullable === nullable);
}

function hasExactIdentity(rows, type, definition) {
  return rows.some((row) => row.contype === type && normalise(row.definition) === definition);
}

function hasCheck(rows, predicate) {
  return rows.some((row) => row.contype === "c" && predicate(row.definition, normalise(row.definition)));
}

function recordStoreVersionComponent(records) {
  const candidates = records.filter((row) => row.contype === "c"
    && normalise(row.definition).includes("storeversion"));
  if (candidates.length !== 1) return "record-store-version-check";
  const value = normalise(candidates[0].definition);
  const clauses = [
    ["record-store-version-json-type", "jsonb_typeofrecord->'storeversion'='number'"],
    ["record-store-version-extract", "record->>'storeversion'"],
    ["record-store-version-pattern", "'^[1-9][0-9]*$'"],
    ["record-store-version-equality", "=store_version"],
  ];
  return clauses.find(([, fragment]) => !value.includes(fragment))?.[0] || "record-store-version-check";
}

async function verifyPocketSyncSchema(pool) {
  if (!pool || typeof pool.query !== "function") throw schemaError("columns-catalog");
  const columns = await query(pool,
    "SELECT table_name,column_name,data_type,is_nullable FROM information_schema.columns WHERE table_schema='public' AND table_name IN ('pocket_sync_records','pocket_sync_schema','pocket_sync_objects','pocket_sync_heads')",
    undefined, "columns-catalog");
  if (RECORD_COLUMNS.some(([name, type]) => !hasColumn(columns.rows, "pocket_sync_records", name, type))
      || SCHEMA_COLUMNS.some(([name, type]) => !hasColumn(columns.rows, "pocket_sync_schema", name, type))) {
    throw schemaError("columns-contract");
  }
  if (OBJECT_COLUMNS.some(([name, type, nullable]) => !hasColumn(columns.rows, "pocket_sync_objects", name, type, nullable))) {
    throw schemaError("object-columns-contract");
  }
  if (HEAD_COLUMNS.slice(0, 2).some(([name, type, nullable]) => !hasColumn(columns.rows, "pocket_sync_heads", name, type, nullable))) {
    throw schemaError("head-columns-contract");
  }
  if (!hasColumn(columns.rows, "pocket_sync_heads", "seal_storage_ref", "text", "YES")) {
    throw schemaError("heads-seal-storage-ref-nullability");
  }

  const constraints = await query(pool,
    "SELECT n.nspname || '.' || r.relname AS relation, c.contype, pg_get_constraintdef(c.oid) AS definition FROM pg_constraint c JOIN pg_class r ON r.oid=c.conrelid JOIN pg_namespace n ON n.oid=r.relnamespace WHERE c.conrelid IN ('public.pocket_sync_records'::regclass,'public.pocket_sync_schema'::regclass,'public.pocket_sync_objects'::regclass,'public.pocket_sync_heads'::regclass)",
    undefined, "constraints-catalog");
  const records = constraints.rows.filter((row) => row.relation === "public.pocket_sync_records");
  const metadata = constraints.rows.filter((row) => row.relation === "public.pocket_sync_schema");
  const objects = constraints.rows.filter((row) => row.relation === "public.pocket_sync_objects");
  const heads = constraints.rows.filter((row) => row.relation === "public.pocket_sync_heads");
  if (!hasExactIdentity(records, "p", "primarykeycollection,record_key")) throw schemaError("records-primary-key");
  if (!(hasExactIdentity(metadata, "p", "primarykeyschema_name")
      || hasExactIdentity(metadata, "u", "uniqueschema_name"))) throw schemaError("metadata-identity");
  const collectionCheck = records.some((row) => row.contype === "c"
    && normalise(row.definition).includes("collection")
    && sameValues(quotedValues(row.definition), COLLECTIONS));
  if (!collectionCheck) throw schemaError("collection-check");
  if (!hasCheck(records, (definition) => normalise(definition).includes("lengthrecord_key>0"))) {
    throw schemaError("record-key-check");
  }
  if (!hasCheck(records, (definition) => {
    const value = normaliseBigintBounds(definition);
    return value.includes("store_version>0") && value.includes("store_version<=9007199254740991");
  })) throw schemaError("store-version-bounds-check");
  if (!hasCheck(records, (definition) => normalise(definition).includes("jsonb_typeofrecord='object'"))) {
    throw schemaError("record-json-object-check");
  }
  if (!hasCheck(records, (definition) => {
    const value = normalise(definition);
    return value.includes("jsonb_typeofrecord->'storeversion'='number'")
      && value.includes("record->>'storeversion'")
      && value.includes("'^[1-9][0-9]*$'")
      && value.includes("=store_version");
  })) throw schemaError(recordStoreVersionComponent(records));

  if (!hasExactIdentity(objects, "p", "primarykeysynced_pocket_id,storage_ref")) {
    throw schemaError("objects-primary-key");
  }
  if (!hasCheck(objects, (_definition, value) => value.includes("lengthsynced_pocket_id>0"))) {
    throw schemaError("objects-synced-pocket-id-check");
  }
  if (!hasCheck(objects, (_definition, value) => value.includes("lengthstorage_ref>0"))) {
    throw schemaError("objects-storage-ref-check");
  }
  if (!hasCheck(objects, (_definition, value) => value.includes("jsonb_typeofrecord='object'"))) {
    throw schemaError("objects-record-json-object-check");
  }

  if (!hasExactIdentity(heads, "p", "primarykeysynced_pocket_id")) throw schemaError("heads-primary-key");
  if (!hasCheck(heads, (_definition, value) => value.includes("lengthsynced_pocket_id>0"))) {
    throw schemaError("heads-synced-pocket-id-check");
  }
  if (!hasCheck(heads, (definition) => {
    const value = normaliseBigintBounds(definition);
    return value.includes("revision>=0") && value.includes("revision<=9007199254740991");
  })) throw schemaError("heads-revision-bounds-check");
  if (!hasCheck(heads, (_definition, value) => value.includes("revision=0andseal_storage_refisnull")
      && value.includes("revision>0andseal_storage_refisnotnull")
      && value.includes("lengthseal_storage_ref>0") && value.includes("or"))) {
    throw schemaError("heads-revision-seal-check");
  }

  const version = await query(pool,
    "SELECT schema_name,schema_version FROM public.pocket_sync_schema WHERE schema_name IN ($1,$2,$3)",
    ["pocket-sync-store", "pocket-sync-object-head-store", "pocket-sync-persistence-authority"], "schema-version-query");
  const legacyVersions = version.rows.filter((row) => row?.schema_name === "pocket-sync-store");
  const objectHeadVersions = version.rows.filter((row) => row?.schema_name === "pocket-sync-object-head-store");
  const authorityVersions = version.rows.filter((row) => row?.schema_name === "pocket-sync-persistence-authority");
  if (legacyVersions.length !== 1 || legacyVersions[0]?.schema_version !== 1) {
    throw schemaError("schema-version-value");
  }
  if (objectHeadVersions.length !== 1 || objectHeadVersions[0]?.schema_version !== 1) {
    throw schemaError("object-head-schema-version-value");
  }
  if (authorityVersions.length !== 1 || authorityVersions[0]?.schema_version !== 1) {
    throw schemaError("schema-version-value");
  }
  return true;
}

module.exports = Object.freeze({ verifyPocketSyncSchema, safeSchemaComponent });
