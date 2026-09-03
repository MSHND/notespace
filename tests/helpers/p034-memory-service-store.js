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
  "persistenceAuthorities",
]);
const FAILURE_POINTS = Object.freeze([
  "before-first-read",
  "after-reads-before-staged-write",
  "after-staged-writes-before-commit",
  "during-commit",
]);

function isObject(value) {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function clone(value) {
  if (Array.isArray(value)) return value.map(clone);
  if (isObject(value)) {
    const copy = {};
    Object.keys(value).forEach((field) => {
      copy[field] = clone(value[field]);
    });
    return copy;
  }
  return value;
}

function storeError(code) {
  const error = new Error(`P034 memory service store ${code}.`);
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

function emptyCollections() {
  return Object.fromEntries(COLLECTIONS.map((collection) => [collection, new Map()]));
}

function copyCollections(input) {
  const result = emptyCollections();
  COLLECTIONS.forEach((collection) => {
    input[collection].forEach((record, key) => {
      result[collection].set(key, clone(record));
    });
  });
  return result;
}

function seedCollections(seed) {
  const result = emptyCollections();
  if (seed === undefined) return result;
  if (!isObject(seed) || Object.keys(seed).some((field) => !COLLECTIONS.includes(field))) {
    throw storeError("store-seed-invalid");
  }
  COLLECTIONS.forEach((collection) => {
    const values = seed[collection] || {};
    if (!isObject(values)) throw storeError("store-seed-invalid");
    Object.keys(values).forEach((key) => {
      result[collection].set(key, clone(values[key]));
    });
  });
  return result;
}

function snapshotCollections(collections) {
  const result = {};
  COLLECTIONS.forEach((collection) => {
    result[collection] = {};
    [...collections[collection].keys()].sort().forEach((key) => {
      result[collection][key] = clone(collections[collection].get(key));
    });
  });
  return result;
}

function createMemoryServiceStore(options = {}) {
  if (!isObject(options)
      || Object.keys(options).some((field) => !["seed"].includes(field))) {
    throw storeError("store-options-invalid");
  }
  const backing = {
    collections: seedCollections(options.seed),
    queue: Promise.resolve(),
    authorityLocks: new Map(),
  };
  let failurePoint = null;
  const counters = {
    transactions: 0,
    readonly: 0,
    readwrite: 0,
    commits: 0,
    rollbacks: 0,
  };

  function failAt(point) {
    if (point !== null && !FAILURE_POINTS.includes(point)) {
      throw storeError("store-failure-point-invalid");
    }
    failurePoint = point;
  }

  function trigger(point) {
    if (failurePoint !== point) return;
    failurePoint = null;
    throw storeError("store-injected-failure");
  }

  async function transact(mode, callback) {
    if (!['readonly', 'readwrite'].includes(mode) || typeof callback !== "function") {
      throw storeError("store-transaction-invalid");
    }
    const execute = async () => {
      counters.transactions += 1;
      counters[mode] += 1;
      const working = copyCollections(backing.collections);
      let reads = 0;
      let writes = 0;
      let firstWriteChecked = false;

      function checkWrite() {
        if (mode !== "readwrite") throw storeError("store-readonly-write");
        if (!firstWriteChecked) {
          firstWriteChecked = true;
          if (reads > 0) trigger("after-reads-before-staged-write");
        }
      }

      const transaction = Object.freeze({
        async get(collection, key) {
          validateCollection(collection);
          validateKey(key);
          if (reads === 0) trigger("before-first-read");
          reads += 1;
          return working[collection].has(key)
            ? clone(working[collection].get(key))
            : null;
        },
        async insert(collection, key, record) {
          validateCollection(collection);
          validateKey(key);
          checkWrite();
          if (working[collection].has(key)) throw storeError("store-duplicate");
          working[collection].set(key, clone(record));
          writes += 1;
        },
        async replace(collection, key, expectedStoreVersion, record) {
          validateCollection(collection);
          validateKey(key);
          checkWrite();
          const current = working[collection].get(key);
          if (!current || current.storeVersion !== expectedStoreVersion) {
            throw storeError("store-version-conflict");
          }
          working[collection].set(key, clone(record));
          writes += 1;
        },
        async remove(collection, key, expectedStoreVersion) {
          validateCollection(collection);
          validateKey(key);
          checkWrite();
          const current = working[collection].get(key);
          if (!current || current.storeVersion !== expectedStoreVersion) {
            throw storeError("store-version-conflict");
          }
          working[collection].delete(key);
          writes += 1;
        },
      });

      try {
        const result = await callback(transaction);
        if (mode === "readwrite") {
          if (writes > 0) trigger("after-staged-writes-before-commit");
          trigger("during-commit");
          backing.collections = working;
          counters.commits += 1;
        }
        return result;
      } catch (error) {
        if (mode === "readwrite") counters.rollbacks += 1;
        throw error;
      }
    };

    const current = backing.queue.then(execute, execute);
    backing.queue = current.then(() => undefined, () => undefined);
    return current;
  }

  async function withPocketAuthorityLock(syncedPocketId, callback) {
    const pocket = validateKey(syncedPocketId);
    if (pocket.length > 160 || pocket !== pocket.trim() || typeof callback !== "function") {
      throw storeError("store-key-invalid");
    }
    const prior = backing.authorityLocks.get(pocket) || Promise.resolve();
    let releaseTurn;
    const turn = new Promise((resolve) => { releaseTurn = resolve; });
    const tail = prior.then(() => turn, () => turn);
    backing.authorityLocks.set(pocket, tail);
    await prior.catch(() => {});
    try { return await callback(); }
    finally {
      releaseTurn();
      tail.finally(() => {
        if (backing.authorityLocks.get(pocket) === tail) backing.authorityLocks.delete(pocket);
      }).catch(() => {});
    }
  }

  Object.defineProperty(transact, "withPocketAuthorityLock", { value: withPocketAuthorityLock });
  const store = Object.freeze({ transact });

  return Object.freeze({
    store,
    snapshot() {
      return snapshotCollections(backing.collections);
    },
    failAt,
    clearFailure() {
      failurePoint = null;
    },
    counters() {
      return Object.freeze({ ...counters });
    },
    unsafeReplaceForTest(collection, key, record) {
      validateCollection(collection);
      validateKey(key);
      backing.collections[collection].set(key, clone(record));
    },
  });
}

module.exports = Object.freeze({
  COLLECTIONS,
  FAILURE_POINTS,
  createMemoryServiceStore,
});
