"use strict";

const COLLECTIONS = Object.freeze([
  "accounts",
  "credentials",
  "sessions",
  "ceremonies",
  "pockets",
  "operations",
  "keySets",
  "envelopes",
  "recoveryLocators",
  "recoveryCeremonies",
  "keyOperations",
]);

const TABLE = "pocket_sync_records";
const SQL = Object.freeze({
  beginReadOnly: "BEGIN READ ONLY",
  beginReadWrite: "BEGIN",
  commit: "COMMIT",
  rollback: "ROLLBACK",
  get: `SELECT store_version, record FROM ${TABLE} WHERE collection = $1 AND record_key = $2`,
  insert: `INSERT INTO ${TABLE} (collection, record_key, store_version, record) VALUES ($1, $2, $3, $4::jsonb)`,
  replace: `UPDATE ${TABLE} SET store_version = $4, record = $5::jsonb WHERE collection = $1 AND record_key = $2 AND store_version = $3`,
  remove: `DELETE FROM ${TABLE} WHERE collection = $1 AND record_key = $2 AND store_version = $3`,
});

function isObject(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function isReference(value) {
  return !!value && (typeof value === "object" || typeof value === "function");
}

function storeError(code) {
  const error = new Error(`Pocket Sync PostgreSQL store ${code}.`);
  error.code = code;
  return error;
}

function validateCollection(collection) {
  if (!COLLECTIONS.includes(collection)) throw storeError("store-collection-invalid");
  return collection;
}

function validateKey(key) {
  if (typeof key !== "string" || key.length < 1) throw storeError("store-key-invalid");
  return key;
}

function validateStoreVersion(value) {
  if (!Number.isSafeInteger(value) || value < 1) throw storeError("store-version-invalid");
  return value;
}

function validateJson(value, seen) {
  if (value === null || typeof value === "string" || typeof value === "boolean") return;
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw storeError("store-record-invalid");
    return;
  }
  if (!value || typeof value !== "object" || seen.has(value)) throw storeError("store-record-invalid");
  if (Array.isArray(value)) {
    seen.add(value);
    value.forEach((item) => validateJson(item, seen));
    seen.delete(value);
    return;
  }
  if (!isObject(value)) throw storeError("store-record-invalid");
  seen.add(value);
  Object.keys(value).forEach((key) => validateJson(value[key], seen));
  seen.delete(value);
}

function serialiseRecord(record) {
  if (!isObject(record)) throw storeError("store-record-invalid");
  validateStoreVersion(record.storeVersion);
  validateJson(record, new Set());
  let json;
  try {
    json = JSON.stringify(record);
  } catch (_error) {
    throw storeError("store-record-invalid");
  }
  if (typeof json !== "string") throw storeError("store-record-invalid");
  try {
    const copy = JSON.parse(json);
    if (!isObject(copy) || copy.storeVersion !== record.storeVersion) throw storeError("store-record-invalid");
    return { json, record: copy };
  } catch (error) {
    if (error && error.code === "store-record-invalid") throw error;
    throw storeError("store-record-invalid");
  }
}

function parseStoreVersion(value) {
  if (Number.isSafeInteger(value) && value > 0) return value;
  if (typeof value === "string" && /^[1-9][0-9]*$/.test(value)) {
    const number = Number(value);
    if (Number.isSafeInteger(number) && String(number) === value) return number;
  }
  throw storeError("store-state-invalid");
}

function readStoredRecord(row) {
  if (!isObject(row) || !isObject(row.record)) throw storeError("store-state-invalid");
  const version = parseStoreVersion(row.store_version);
  let serialised;
  try {
    serialised = serialiseRecord(row.record);
  } catch (_error) {
    throw storeError("store-state-invalid");
  }
  if (serialised.record.storeVersion !== version) throw storeError("store-state-invalid");
  return serialised.record;
}

function databaseError(error) {
  if (error && error.code === "23505") return storeError("store-duplicate");
  return storeError("store-storage-failed");
}

function validatePool(options) {
  if (!isObject(options)
      || Object.keys(options).length !== 1
      || Object.keys(options)[0] !== "pool"
      || !isReference(options.pool)
      || typeof options.pool.connect !== "function") {
    throw storeError("store-options-invalid");
  }
  return options.pool;
}

function createPostgresStore(options) {
  const pool = validatePool(options);

  async function transact(mode, callback) {
    if (!['readonly', 'readwrite'].includes(mode) || typeof callback !== "function") {
      throw storeError("store-transaction-invalid");
    }

    let client;
    let began = false;
    let committed = false;
    let completed = false;
    let primaryError = null;
    const operations = new Set();

    function assertActive() {
      if (completed) throw storeError("store-transaction-expired");
    }

    async function query(sql, values) {
      try {
        const result = await client.query(sql, values);
        if (!isReference(result)
            || !Array.isArray(result.rows)
            || (result.rowCount !== null && !Number.isSafeInteger(result.rowCount))) {
          throw storeError("store-storage-failed");
        }
        return result;
      } catch (error) {
        if (error && error.code === "store-storage-failed") throw error;
        throw databaseError(error);
      }
    }

    function track(operation) {
      const pending = Promise.resolve(operation);
      operations.add(pending);
      pending.then(
        () => { operations.delete(pending); },
        () => { operations.delete(pending); }
      );
      return pending;
    }

    function start(factory) {
      try { return track(factory()); }
      catch (error) { return track(Promise.reject(error)); }
    }

    async function settleOperations() {
      // A transaction callback may accidentally omit await.  Do not commit until
      // every façade operation it started has settled successfully.
      while (operations.size > 0) await Promise.all([...operations]);
    }

    const transaction = Object.freeze({
      get(collection, key) {
        return start(() => {
          assertActive();
          return query(SQL.get, [validateCollection(collection), validateKey(key)]).then((result) => {
          if (result.rowCount === 0) return null;
          if (result.rowCount !== 1 || result.rows.length !== 1) throw storeError("store-state-invalid");
          return readStoredRecord(result.rows[0]);
          });
        });
      },
      insert(collection, key, record) {
        return start(() => {
          assertActive();
          if (mode !== "readwrite") throw storeError("store-readonly-write");
          const value = serialiseRecord(record);
          return query(SQL.insert, [validateCollection(collection), validateKey(key), value.record.storeVersion, value.json]).then((result) => {
          if (result.rowCount !== 1) throw storeError("store-storage-failed");
          });
        });
      },
      replace(collection, key, expectedStoreVersion, record) {
        return start(() => {
          assertActive();
          if (mode !== "readwrite") throw storeError("store-readonly-write");
          const value = serialiseRecord(record);
          return query(SQL.replace, [
          validateCollection(collection), validateKey(key), validateStoreVersion(expectedStoreVersion), value.record.storeVersion, value.json,
          ]).then((result) => {
          if (result.rowCount === 0) throw storeError("store-version-conflict");
          if (result.rowCount !== 1) throw storeError("store-storage-failed");
          });
        });
      },
      remove(collection, key, expectedStoreVersion) {
        return start(() => {
          assertActive();
          if (mode !== "readwrite") throw storeError("store-readonly-write");
          return query(SQL.remove, [
          validateCollection(collection), validateKey(key), validateStoreVersion(expectedStoreVersion),
          ]).then((result) => {
          if (result.rowCount === 0) throw storeError("store-version-conflict");
          if (result.rowCount !== 1) throw storeError("store-storage-failed");
          });
        });
      },
    });

    try {
      try {
        client = await pool.connect();
      } catch (error) {
        throw databaseError(error);
      }
      if (!isReference(client) || typeof client.query !== "function" || typeof client.release !== "function") {
        throw storeError("store-storage-failed");
      }
      await query(mode === "readonly" ? SQL.beginReadOnly : SQL.beginReadWrite);
      began = true;
      const result = await callback(transaction);
      await settleOperations();
      completed = true;
      await query(SQL.commit);
      committed = true;
      return result;
    } catch (error) {
      primaryError = error;
      await Promise.allSettled([...operations]);
      completed = true;
      if (began && !committed) {
        try {
          await query(SQL.rollback);
        } catch (_rollbackError) {}
      }
      throw error;
    } finally {
      completed = true;
      if (client && typeof client.release === "function") {
        try {
          client.release();
        } catch (_releaseError) {
          if (!primaryError) throw storeError("store-storage-failed");
        }
      }
    }
  }

  return Object.freeze({ transact });
}

module.exports = Object.freeze({
  COLLECTIONS,
  createPostgresStore,
});
