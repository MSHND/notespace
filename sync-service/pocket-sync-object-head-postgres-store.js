"use strict";

const { createHash } = require("node:crypto");

const OBJECT_FORMAT = "pocket.sync.starling-object.opaque";
const OBJECT_VERSION = 1;
const OBJECT_ALGORITHM = "AES-GCM-256";
const REFERENCE_DOMAIN = "pocket.sync.starling-object.reference.v1";
const REFERENCE_PREFIX = `${REFERENCE_DOMAIN}:sha256:`;
const HEAD_SCHEMA = "pocket.starling.head.v1";
const MAXIMUM_PRESENCE_REFS = 512;
const MAX_SAFE_REVISION = Number.MAX_SAFE_INTEGER;
const RECORD_FIELDS = Object.freeze([
  "format",
  "version",
  "algorithm",
  "nonce",
  "ciphertext",
]);
const HEAD_FIELDS = Object.freeze(["schema", "revision", "sealRef"]);
const BASE64URL = /^[A-Za-z0-9_-]+$/;
const REFERENCE = new RegExp(
  `^${REFERENCE_PREFIX.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}[A-Za-z0-9_-]{43}$`,
);
const OBJECT_TABLE = "public.pocket_sync_objects";
const HEAD_TABLE = "public.pocket_sync_heads";
const SQL = Object.freeze({
  beginReadOnly: "BEGIN READ ONLY",
  beginReadWrite: "BEGIN",
  commit: "COMMIT",
  rollback: "ROLLBACK",
  objectGet: `SELECT record FROM ${OBJECT_TABLE} WHERE synced_pocket_id = $1 AND storage_ref = $2`,
  objectPut: `INSERT INTO ${OBJECT_TABLE} (synced_pocket_id, storage_ref, record) VALUES ($1, $2, $3::jsonb) ON CONFLICT (synced_pocket_id, storage_ref) DO NOTHING RETURNING record`,
  objectPresence: `SELECT storage_ref FROM ${OBJECT_TABLE} WHERE synced_pocket_id = $1 AND storage_ref = ANY($2::text[])`,
  headGet: `SELECT revision, seal_storage_ref FROM ${HEAD_TABLE} WHERE synced_pocket_id = $1`,
  headInitialise: `INSERT INTO ${HEAD_TABLE} (synced_pocket_id, revision, seal_storage_ref) VALUES ($1, 0, NULL) ON CONFLICT (synced_pocket_id) DO NOTHING RETURNING revision, seal_storage_ref`,
  headCompareAndSet: `UPDATE ${HEAD_TABLE} SET revision = revision + 1, seal_storage_ref = $4 WHERE synced_pocket_id = $1 AND revision = $2 AND seal_storage_ref IS NOT DISTINCT FROM $3 AND revision < $5 RETURNING revision, seal_storage_ref`,
});

function storeError(code) {
  const error = new Error(`Pocket Sync object and Head store ${code}.`);
  error.code = code;
  return error;
}

function isObject(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function exact(value, fields) {
  return isObject(value)
    && Object.keys(value).length === fields.length
    && fields.every((field) => Object.prototype.hasOwnProperty.call(value, field));
}

function frozenRecord(record) {
  return Object.freeze({
    format: record.format,
    version: record.version,
    algorithm: record.algorithm,
    nonce: record.nonce,
    ciphertext: record.ciphertext,
  });
}

function validateSyncedPocketId(value) {
  if (
    typeof value !== "string" ||
    value.length < 1 ||
    value.length > 160 ||
    value !== value.trim()
  )
    throw storeError("object-head-store-pocket-id-invalid");
  return value;
}

function decodeBase64url(value, code) {
  if (
    typeof value !== "string" ||
    value.length < 1 ||
    !BASE64URL.test(value) ||
    value.length % 4 === 1
  )
    throw storeError(code);
  let bytes;
  try {
    bytes = Buffer.from(value, "base64url");
  } catch (_error) {
    throw storeError(code);
  }
  if (bytes.length === 0 || bytes.toString("base64url") !== value)
    throw storeError(code);
  return bytes;
}

function validateStorageRef(value) {
  if (typeof value !== "string" || !REFERENCE.test(value))
    throw storeError("object-head-store-ref-invalid");
  const digest = value.slice(REFERENCE_PREFIX.length),
    bytes = decodeBase64url(digest, "object-head-store-ref-invalid");
  if (bytes.length !== 32) throw storeError("object-head-store-ref-invalid");
  return value;
}

function validateRecord(value, code = "object-head-store-record-invalid") {
  if (
    !exact(value, RECORD_FIELDS) ||
    value.format !== OBJECT_FORMAT ||
    value.version !== OBJECT_VERSION ||
    value.algorithm !== OBJECT_ALGORITHM
  )
    throw storeError(code);
  const nonce = decodeBase64url(value.nonce, code),
    ciphertext = decodeBase64url(value.ciphertext, code);
  if (nonce.length !== 12 || ciphertext.length < 16) throw storeError(code);
  return frozenRecord(value);
}

function canonicalEncryptedRecord(record) {
  return JSON.stringify([
    REFERENCE_DOMAIN,
    record.format,
    record.version,
    record.algorithm,
    record.nonce,
    record.ciphertext,
  ]);
}

function referenceForRecord(record) {
  const valid = validateRecord(record),
    digest = createHash("sha256")
      .update(canonicalEncryptedRecord(valid), "utf8")
      .digest("base64url");
  return REFERENCE_PREFIX + digest;
}

function validateBinding(storageRef, record, state = false) {
  const validRef = validateStorageRef(storageRef),
    validRecord = validateRecord(
      record,
      state ? "object-head-store-state-invalid" : "object-head-store-record-invalid",
    );
  if (referenceForRecord(validRecord) !== validRef)
    throw storeError(
      state ? "object-head-store-state-invalid" : "object-head-store-binding-mismatch",
    );
  return validRecord;
}

function headSnapshot(revision, sealRef, state = false) {
  if (!Number.isSafeInteger(revision) || revision < 0)
    throw storeError(state ? "object-head-store-state-invalid" : "object-head-store-head-invalid");
  if (
    (revision === 0 && sealRef !== null) ||
    (revision > 0 && (typeof sealRef !== "string" || sealRef.length === 0))
  )
    throw storeError(state ? "object-head-store-state-invalid" : "object-head-store-head-invalid");
  if (sealRef !== null) {
    try {
      validateStorageRef(sealRef);
    } catch (_error) {
      throw storeError(state ? "object-head-store-state-invalid" : "object-head-store-head-invalid");
    }
  }
  return Object.freeze({ schema: HEAD_SCHEMA, revision, sealRef });
}

function validateHead(value) {
  if (!exact(value, HEAD_FIELDS) || value.schema !== HEAD_SCHEMA)
    throw storeError("object-head-store-head-invalid");
  return headSnapshot(value.revision, value.sealRef);
}

function databaseError(error) {
  if (error && typeof error.code === "string" && error.code.startsWith("object-head-store-"))
    return error;
  return storeError("object-head-store-storage-failed");
}

function validatePool(options) {
  if (
    !exact(options, ["pool"]) ||
    !options.pool ||
    typeof options.pool.connect !== "function"
  )
    throw storeError("object-head-store-options-invalid");
  return options.pool;
}

function readResult(result) {
  if (
    !result ||
    !Array.isArray(result.rows) ||
    (result.rowCount !== null && !Number.isSafeInteger(result.rowCount))
  )
    throw storeError("object-head-store-storage-failed");
  return result;
}

function storedObject(row, storageRef) {
  if (!exact(row, ["record"]))
    throw storeError("object-head-store-state-invalid");
  return validateBinding(storageRef, row.record, true);
}

function storedHead(row) {
  if (!exact(row, ["revision", "seal_storage_ref"]))
    throw storeError("object-head-store-state-invalid");
  let revision = row.revision;
  if (typeof revision === "string" && /^(0|[1-9][0-9]*)$/.test(revision))
    revision = Number(revision);
  return headSnapshot(revision, row.seal_storage_ref, true);
}

function sameHead(left, right) {
  return left.revision === right.revision && left.sealRef === right.sealRef;
}

function createObjectHeadPostgresStore(options) {
  const pool = validatePool(options);

  async function transaction(mode, callback) {
    let client = null,
      began = false,
      committed = false;
    async function query(sql, values) {
      try {
        return readResult(await client.query(sql, values));
      } catch (error) {
        throw databaseError(error);
      }
    }
    try {
      try {
        client = await pool.connect();
      } catch (error) {
        throw databaseError(error);
      }
      if (!client || typeof client.query !== "function" || typeof client.release !== "function")
        throw storeError("object-head-store-storage-failed");
      await query(mode === "readonly" ? SQL.beginReadOnly : SQL.beginReadWrite);
      began = true;
      const value = await callback(query);
      await query(SQL.commit);
      committed = true;
      return value;
    } catch (error) {
      if (began && !committed) {
        try {
          await client.query(SQL.rollback);
        } catch (_rollbackError) {}
      }
      throw databaseError(error);
    } finally {
      if (client) {
        try {
          client.release();
        } catch (_error) {}
      }
    }
  }

  async function findObject(query, syncedPocketId, storageRef) {
    const result = await query(SQL.objectGet, [syncedPocketId, storageRef]);
    if (result.rowCount === 0) return null;
    if (result.rowCount !== 1 || result.rows.length !== 1)
      throw storeError("object-head-store-state-invalid");
    return storedObject(result.rows[0], storageRef);
  }

  async function findHead(query, syncedPocketId) {
    const result = await query(SQL.headGet, [syncedPocketId]);
    if (result.rowCount === 0) return null;
    if (result.rowCount !== 1 || result.rows.length !== 1)
      throw storeError("object-head-store-state-invalid");
    return storedHead(result.rows[0]);
  }

  async function putObject(syncedPocketId, storageRef, record) {
    const pocket = validateSyncedPocketId(syncedPocketId),
      ref = validateStorageRef(storageRef),
      validRecord = validateBinding(ref, record),
      serialised = JSON.stringify(validRecord);
    return transaction("readwrite", async (query) => {
      const inserted = await query(SQL.objectPut, [pocket, ref, serialised]);
      if (inserted.rowCount === 1 && inserted.rows.length === 1) {
        if (JSON.stringify(storedObject(inserted.rows[0], ref)) !== serialised)
          throw storeError("object-head-store-state-invalid");
        return Object.freeze({ ok: true, created: true });
      }
      if (inserted.rowCount !== 0 || inserted.rows.length !== 0)
        throw storeError("object-head-store-storage-failed");
      const existing = await findObject(query, pocket, ref);
      if (!existing || JSON.stringify(existing) !== serialised)
        throw storeError("object-head-store-binding-mismatch");
      return Object.freeze({ ok: true, created: false });
    });
  }

  async function getObject(syncedPocketId, storageRef) {
    const pocket = validateSyncedPocketId(syncedPocketId),
      ref = validateStorageRef(storageRef);
    return transaction("readonly", (query) => findObject(query, pocket, ref));
  }

  async function presence(syncedPocketId, storageRefs) {
    const pocket = validateSyncedPocketId(syncedPocketId);
    if (!Array.isArray(storageRefs) || storageRefs.length > MAXIMUM_PRESENCE_REFS)
      throw storeError("object-head-store-presence-limit");
    const refs = storageRefs.map((ref) => validateStorageRef(ref));
    if (new Set(refs).size !== refs.length)
      throw storeError("object-head-store-presence-invalid");
    return transaction("readonly", async (query) => {
      const result = await query(SQL.objectPresence, [pocket, refs]);
      if (result.rows.some((row) => !exact(row, ["storage_ref"]) || !refs.includes(row.storage_ref)))
        throw storeError("object-head-store-state-invalid");
      const found = new Set(result.rows.map((row) => row.storage_ref));
      return Object.freeze(refs.map((storageRef) => Object.freeze({
        storageRef,
        present: found.has(storageRef),
      })));
    });
  }

  async function initialiseHead(syncedPocketId) {
    const pocket = validateSyncedPocketId(syncedPocketId);
    return transaction("readwrite", async (query) => {
      const inserted = await query(SQL.headInitialise, [pocket]);
      if (inserted.rowCount === 1 && inserted.rows.length === 1)
        return storedHead(inserted.rows[0]);
      if (inserted.rowCount !== 0 || inserted.rows.length !== 0)
        throw storeError("object-head-store-storage-failed");
      const existing = await findHead(query, pocket);
      if (!existing) throw storeError("object-head-store-state-invalid");
      return existing;
    });
  }

  async function readHead(syncedPocketId) {
    const pocket = validateSyncedPocketId(syncedPocketId);
    return transaction("readonly", (query) => findHead(query, pocket));
  }

  async function compareAndSetHead(syncedPocketId, expectedHead, candidateSealStorageRef) {
    const pocket = validateSyncedPocketId(syncedPocketId),
      expected = validateHead(expectedHead),
      candidateRef = validateStorageRef(candidateSealStorageRef);
    return transaction("readwrite", async (query) => {
      const current = await findHead(query, pocket);
      if (!current || !sameHead(current, expected))
        return Object.freeze({ ok: false, reason: "head-conflict" });
      if (current.revision === MAX_SAFE_REVISION)
        return Object.freeze({ ok: false, reason: "head-revision-exhausted" });
      if (!(await findObject(query, pocket, candidateRef)))
        return Object.freeze({ ok: false, reason: "candidate-object-missing" });
      const updated = await query(SQL.headCompareAndSet, [
        pocket,
        expected.revision,
        expected.sealRef,
        candidateRef,
        MAX_SAFE_REVISION,
      ]);
      if (updated.rowCount === 0 && updated.rows.length === 0)
        return Object.freeze({ ok: false, reason: "head-conflict" });
      if (updated.rowCount !== 1 || updated.rows.length !== 1)
        throw storeError("object-head-store-storage-failed");
      return Object.freeze({ ok: true, head: storedHead(updated.rows[0]) });
    });
  }

  return Object.freeze({
    putObject,
    getObject,
    presence,
    initialiseHead,
    readHead,
    compareAndSetHead,
  });
}

module.exports = Object.freeze({
  OBJECT_FORMAT,
  OBJECT_VERSION,
  OBJECT_ALGORITHM,
  REFERENCE_DOMAIN,
  REFERENCE_PREFIX,
  HEAD_SCHEMA,
  MAXIMUM_PRESENCE_REFS,
  canonicalEncryptedRecord,
  referenceForRecord,
  createObjectHeadPostgresStore,
});
