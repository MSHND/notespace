/* P164 encrypted owner-private Starling mirror/reentry state.

This store persists only an already-encrypted owner state envelope. It is kept
separate from the whole-record Synced device store so migration evidence can
survive reload without becoming Save authority or changing the live record
schema.
*/
(function initialisePocketStarlingOwnerState(global) {
  "use strict";

  const CONFIG = Object.freeze({
    databaseName: "pocket.starling.owner-state.v1",
    databaseVersion: 1,
    objectStoreName: "owners",
    keyPath: "syncedPocketId",
  });
  const FORMAT = Object.freeze({
    kind: "pocket.starling.owner-private-state",
    schemaVersion: 1,
  });
  const FIELDS = Object.freeze([
    "kind", "schemaVersion", "revision", "syncedPocketId", "deviceId", "encrypted",
  ]);
  const ENCRYPTED_FIELDS = Object.freeze(["context", "record"]);

  function fail(code) {
    const error = new Error(`Pocket Starling owner state ${code}.`);
    error.code = code;
    return error;
  }

  function exact(value, fields, code) {
    if (!value || typeof value !== "object" || Array.isArray(value)
        || Object.keys(value).length !== fields.length
        || !fields.every((field) => Object.prototype.hasOwnProperty.call(value, field))) {
      throw fail(code);
    }
    return value;
  }

  function identifier(value, code) {
    if (typeof value !== "string" || value.length < 1 || value.length > 160
        || value !== value.trim()) throw fail(code);
    return value;
  }

  function positiveInteger(value, code) {
    if (!Number.isSafeInteger(value) || value < 1) throw fail(code);
    return value;
  }

  function cryptoContract() {
    const crypto = global.PocketSyncCrypto;
    if (!crypto || typeof crypto.validateContentContext !== "function"
        || typeof crypto.validateContentRecord !== "function") {
      throw fail("crypto-contract-unavailable");
    }
    return crypto;
  }

  function freeze(value) {
    if (Array.isArray(value)) return Object.freeze(value.map(freeze));
    if (value && typeof value === "object") {
      const copy = {};
      for (const key of Object.keys(value)) copy[key] = freeze(value[key]);
      return Object.freeze(copy);
    }
    return value;
  }

  function validateRecord(input) {
    const value = exact(input, FIELDS, "record-invalid");
    if (value.kind !== FORMAT.kind || value.schemaVersion !== FORMAT.schemaVersion) {
      throw fail("record-schema-invalid");
    }
    const revision = positiveInteger(value.revision, "record-revision-invalid");
    const syncedPocketId = identifier(value.syncedPocketId, "record-identity-invalid");
    const deviceId = identifier(value.deviceId, "record-identity-invalid");
    const encryptedInput = exact(value.encrypted, ENCRYPTED_FIELDS, "record-encrypted-invalid");
    let context;
    let record;
    try {
      context = cryptoContract().validateContentContext(encryptedInput.context);
      record = cryptoContract().validateContentRecord(encryptedInput.record);
    } catch (_error) {
      throw fail("record-encrypted-invalid");
    }
    if (context.syncedPocketId !== syncedPocketId || context.revision !== revision) {
      throw fail("record-encrypted-identity-invalid");
    }
    return freeze({
      kind: FORMAT.kind,
      schemaVersion: FORMAT.schemaVersion,
      revision,
      syncedPocketId,
      deviceId,
      encrypted: { context, record },
    });
  }

  function validateDriver(driver) {
    if (!driver || typeof driver.open !== "function"
        || typeof driver.transaction !== "function" || typeof driver.close !== "function") {
      throw fail("driver-invalid");
    }
    return driver;
  }

  function createStore(driverInput) {
    const driver = validateDriver(driverInput);
    let opened = false;

    function requireOpen() {
      if (!opened) throw fail("not-open");
    }

    async function openStore() {
      await driver.open(CONFIG);
      opened = true;
      return true;
    }

    async function read(syncedPocketIdInput) {
      requireOpen();
      const syncedPocketId = identifier(syncedPocketIdInput, "record-identity-invalid");
      return driver.transaction("readonly", async (transaction) => {
        const found = await transaction.get(syncedPocketId);
        transaction.checkpoint("after-read");
        return found === undefined ? null : validateRecord(found);
      });
    }

    async function write(input) {
      requireOpen();
      if (!input || typeof input !== "object" || Array.isArray(input)
          || Object.keys(input).length !== 2
          || !Object.prototype.hasOwnProperty.call(input, "expectedRevision")
          || !Object.prototype.hasOwnProperty.call(input, "record")) {
        throw fail("write-input-invalid");
      }
      const expectedRevision = input.expectedRevision === null
        ? null : positiveInteger(input.expectedRevision, "record-revision-invalid");
      const next = validateRecord(input.record);
      return driver.transaction("readwrite", async (transaction) => {
        const found = await transaction.get(next.syncedPocketId);
        transaction.checkpoint("after-read");
        if (found === undefined) {
          if (expectedRevision !== null || next.revision !== 1) throw fail("revision-conflict");
          transaction.checkpoint("before-write");
          await transaction.add(next);
          transaction.checkpoint("after-write");
          return next;
        }
        const current = validateRecord(found);
        if (expectedRevision === null || current.revision !== expectedRevision
            || expectedRevision >= Number.MAX_SAFE_INTEGER
            || next.revision !== expectedRevision + 1
            || next.syncedPocketId !== current.syncedPocketId
            || next.deviceId !== current.deviceId) {
          throw fail("revision-conflict");
        }
        transaction.checkpoint("before-write");
        await transaction.put(next);
        transaction.checkpoint("after-write");
        return next;
      });
    }

    function closeStore() {
      driver.close();
      opened = false;
      return true;
    }

    return Object.freeze({ open: openStore, read, write, close: closeStore });
  }

  function createIndexedDbDriver(indexedDbInput = global.indexedDB) {
    let database = null;

    function request(store, method, value) {
      return new Promise((resolve, reject) => {
        let pending;
        try { pending = store[method](value); }
        catch (_error) { reject(fail("request-failed")); return; }
        pending.onsuccess = () => resolve(pending.result);
        pending.onerror = () => reject(fail("request-failed"));
      });
    }

    async function openDriver(config) {
      if (database) return true;
      if (!indexedDbInput || typeof indexedDbInput.open !== "function") throw fail("indexeddb-unavailable");
      return new Promise((resolve, reject) => {
        let pending;
        try { pending = indexedDbInput.open(config.databaseName, config.databaseVersion); }
        catch (_error) { reject(fail("open-failed")); return; }
        pending.onupgradeneeded = (event) => {
          try {
            const db = pending.result;
            if (event.oldVersion !== 0 || Array.from(db.objectStoreNames || []).length !== 0) {
              pending.transaction.abort();
              return;
            }
            db.createObjectStore(config.objectStoreName, { keyPath: config.keyPath });
          } catch (_error) {
            try { pending.transaction.abort(); } catch (_abortError) {}
          }
        };
        pending.onerror = () => reject(fail("open-failed"));
        pending.onblocked = () => reject(fail("open-blocked"));
        pending.onsuccess = () => {
          const db = pending.result;
          const names = Array.from(db.objectStoreNames || []);
          if (db.version !== config.databaseVersion || names.length !== 1
              || names[0] !== config.objectStoreName) {
            try { db.close(); } catch (_error) {}
            reject(fail("database-shape-invalid"));
            return;
          }
          database = db;
          db.onversionchange = () => {
            try { db.close(); } catch (_error) {}
            if (database === db) database = null;
          };
          resolve(true);
        };
      });
    }

    async function transactionDriver(mode, work) {
      if (!database) throw fail("not-open");
      if (!["readonly", "readwrite"].includes(mode) || typeof work !== "function") {
        throw fail("transaction-invalid");
      }
      return new Promise((resolve, reject) => {
        let tx;
        let store;
        try {
          tx = database.transaction(CONFIG.objectStoreName, mode);
          store = tx.objectStore(CONFIG.objectStoreName);
        } catch (_error) { reject(fail("transaction-failed")); return; }
        let result;
        let finished = false;
        let operationError = null;
        tx.oncomplete = () => finished ? resolve(result) : reject(fail("transaction-failed"));
        tx.onabort = () => reject(operationError || fail("transaction-failed"));
        tx.onerror = () => {};
        const boundary = Object.freeze({
          get: (key) => request(store, "get", key),
          add: (value) => request(store, "add", value),
          put: (value) => request(store, "put", value),
          checkpoint: () => {},
        });
        Promise.resolve().then(() => work(boundary)).then((value) => {
          result = value;
          finished = true;
        }).catch((error) => {
          operationError = error && typeof error.code === "string" ? error : fail("transaction-failed");
          try { tx.abort(); } catch (_error) { reject(operationError); }
        });
      });
    }

    function closeDriver() {
      if (database) {
        try { database.close(); } catch (_error) {}
        database = null;
      }
      return true;
    }

    return Object.freeze({ open: openDriver, transaction: transactionDriver, close: closeDriver });
  }

  let defaultStore = null;
  function getDefaultStore() {
    if (!defaultStore) defaultStore = createStore(createIndexedDbDriver());
    return defaultStore;
  }

  global.PocketStarlingOwnerState = Object.freeze({
    CONFIG,
    FORMAT,
    validateRecord,
    createStore,
    createIndexedDbDriver,
    open: () => getDefaultStore().open(),
    read: (syncedPocketId) => getDefaultStore().read(syncedPocketId),
    write: (input) => getDefaultStore().write(input),
    close: () => getDefaultStore().close(),
  });
})(typeof window !== "undefined" ? window : globalThis);