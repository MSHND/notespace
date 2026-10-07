"use strict";

const MAX_SAFE_REVISION = 9007199254740991;
const MAX_CONTENT_BYTES = 2097152;
const MAX_NAME_LENGTH = 120;
const NAME_PATTERN = /^[a-z][a-z0-9]*(?:[.-][a-z0-9]+)*$/;
const TABLE = "public.pocket_project_documents";

const SQL = Object.freeze({
  list: `SELECT name, revision, updated_at FROM ${TABLE} ORDER BY name ASC`,
  read: `SELECT name, content, revision, updated_at FROM ${TABLE} WHERE name=$1`,
  create: `INSERT INTO ${TABLE} (name, content, revision, updated_at)
    VALUES ($1, $2, 1, clock_timestamp())
    RETURNING name, content, revision, updated_at`,
  update: `UPDATE ${TABLE}
    SET content=$3, revision=revision+1, updated_at=clock_timestamp()
    WHERE name=$1 AND revision=$2 AND revision < 9007199254740991
    RETURNING name, content, revision, updated_at`,
  currentRevision: `SELECT revision FROM ${TABLE} WHERE name=$1`,
});

function projectDocumentsStoreError(code) {
  const error = new Error(`Pocket project documents store ${code}.`);
  error.code = code;
  return error;
}

function isReference(value) {
  return !!value && (typeof value === "object" || typeof value === "function");
}

function validateName(value) {
  if (typeof value !== "string" || value.length < 1 || value.length > MAX_NAME_LENGTH
      || value !== value.trim() || !NAME_PATTERN.test(value)) {
    throw projectDocumentsStoreError("project-document-name-invalid");
  }
  return value;
}

function validateContent(value) {
  if (typeof value !== "string" || Buffer.byteLength(value, "utf8") > MAX_CONTENT_BYTES) {
    throw projectDocumentsStoreError("project-document-content-invalid");
  }
  return value;
}

function validateRevision(value) {
  if (!Number.isSafeInteger(value) || value < 1 || value > MAX_SAFE_REVISION) {
    throw projectDocumentsStoreError("project-document-revision-invalid");
  }
  return value;
}

function timestamp(value) {
  if (value instanceof Date && Number.isFinite(value.getTime())) return value.toISOString();
  if (typeof value === "string") {
    const milliseconds = Date.parse(value);
    if (Number.isFinite(milliseconds)) return new Date(milliseconds).toISOString();
  }
  throw projectDocumentsStoreError("project-document-state-invalid");
}

function readRevision(value) {
  if (Number.isSafeInteger(value) && value >= 1 && value <= MAX_SAFE_REVISION) return value;
  if (typeof value === "string" && /^[1-9][0-9]*$/.test(value)) {
    const parsed = Number(value);
    if (Number.isSafeInteger(parsed) && parsed <= MAX_SAFE_REVISION && String(parsed) === value) return parsed;
  }
  throw projectDocumentsStoreError("project-document-state-invalid");
}

function documentRow(row, includeContent) {
  if (!row || typeof row !== "object" || Array.isArray(row)
      || typeof row.name !== "string" || !NAME_PATTERN.test(row.name)
      || (includeContent && typeof row.content !== "string")) {
    throw projectDocumentsStoreError("project-document-state-invalid");
  }
  const result = {
    name: row.name,
    revision: readRevision(row.revision),
    updatedAt: timestamp(row.updated_at),
  };
  if (includeContent) {
    validateContent(row.content);
    result.content = row.content;
  }
  return Object.freeze(result);
}

function validatePool(options) {
  if (!options || typeof options !== "object" || Array.isArray(options)
      || Object.keys(options).length !== 1 || !Object.hasOwn(options, "pool")
      || !isReference(options.pool) || typeof options.pool.query !== "function") {
    throw projectDocumentsStoreError("project-document-store-options-invalid");
  }
  return options.pool;
}

function databaseFailure(error) {
  if (error && error.code === "23505") return projectDocumentsStoreError("project-document-already-exists");
  if (error && typeof error.code === "string" && error.code.startsWith("project-document-")) return error;
  return projectDocumentsStoreError("project-document-storage-failed");
}

async function query(pool, sql, values) {
  try {
    const result = await pool.query(sql, values);
    if (!result || !Array.isArray(result.rows)
        || (result.rowCount !== null && !Number.isSafeInteger(result.rowCount))) {
      throw projectDocumentsStoreError("project-document-storage-failed");
    }
    return result;
  } catch (error) {
    throw databaseFailure(error);
  }
}

function createProjectDocumentsPostgresStore(options) {
  const pool = validatePool(options);

  async function list() {
    const result = await query(pool, SQL.list);
    return Object.freeze(result.rows.map((row) => documentRow(row, false)));
  }

  async function read(nameInput) {
    const name = validateName(nameInput);
    const result = await query(pool, SQL.read, [name]);
    if (result.rows.length === 0) return Object.freeze({ ok: false, reason: "not-found" });
    if (result.rows.length !== 1) throw projectDocumentsStoreError("project-document-state-invalid");
    return Object.freeze({ ok: true, document: documentRow(result.rows[0], true) });
  }

  async function create(nameInput, contentInput) {
    const name = validateName(nameInput);
    const content = validateContent(contentInput);
    try {
      const result = await query(pool, SQL.create, [name, content]);
      if (result.rows.length !== 1) throw projectDocumentsStoreError("project-document-state-invalid");
      return Object.freeze({ ok: true, document: documentRow(result.rows[0], true) });
    } catch (error) {
      if (error?.code === "project-document-already-exists") {
        return Object.freeze({ ok: false, reason: "already-exists" });
      }
      throw error;
    }
  }

  async function update(nameInput, expectedRevisionInput, contentInput) {
    const name = validateName(nameInput);
    const expectedRevision = validateRevision(expectedRevisionInput);
    const content = validateContent(contentInput);
    const result = await query(pool, SQL.update, [name, expectedRevision, content]);
    if (result.rows.length === 1) {
      return Object.freeze({ ok: true, document: documentRow(result.rows[0], true) });
    }
    if (result.rows.length !== 0) throw projectDocumentsStoreError("project-document-state-invalid");

    const current = await query(pool, SQL.currentRevision, [name]);
    if (current.rows.length === 0) return Object.freeze({ ok: false, reason: "not-found" });
    if (current.rows.length !== 1) throw projectDocumentsStoreError("project-document-state-invalid");
    return Object.freeze({
      ok: false,
      reason: "revision-conflict",
      currentRevision: readRevision(current.rows[0].revision),
    });
  }

  return Object.freeze({ list, read, create, update });
}

module.exports = Object.freeze({
  MAX_CONTENT_BYTES,
  MAX_NAME_LENGTH,
  MAX_SAFE_REVISION,
  NAME_PATTERN,
  SQL,
  createProjectDocumentsPostgresStore,
  projectDocumentsStoreError,
  validateContent,
  validateName,
  validateRevision,
});
