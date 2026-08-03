"use strict";

function clone(value) {
  return structuredClone(value);
}

function driverError(code) {
  const error = new Error(`P030 memory driver ${code}.`);
  error.code = code;
  return error;
}

function createSharedDeviceStoreState() {
  return {
    records: new Map(),
    configuration: null,
    writeTail: Promise.resolve(),
  };
}

function createMemoryDeviceStoreDriver(sharedState = createSharedDeviceStoreState()) {
  let opened = false;
  let failurePoint = "";
  let commitGate = null;

  function failAt(point) {
    failurePoint = String(point || "");
  }

  function trigger(point) {
    if (failurePoint !== point) return;
    failurePoint = "";
    throw driverError(`injected-${point}`);
  }

  function holdCommit() {
    if (commitGate) throw driverError("commit-already-held");
    let release;
    const promise = new Promise((resolve) => {
      release = resolve;
    });
    commitGate = { promise, release };
    return () => {
      const gate = commitGate;
      commitGate = null;
      gate?.release();
    };
  }

  async function open(configuration) {
    const proposed = clone(configuration);
    if (sharedState.configuration === null) {
      sharedState.configuration = proposed;
    } else if (JSON.stringify(sharedState.configuration) !== JSON.stringify(proposed)) {
      throw driverError("configuration-mismatch");
    }
    opened = true;
    return true;
  }

  async function execute(mode, work) {
    if (!opened) throw driverError("not-open");
    if (!["readonly", "readwrite"].includes(mode)) throw driverError("invalid-mode");

    let releaseWriter = null;
    const priorWriter = sharedState.writeTail;
    if (mode === "readwrite") {
      sharedState.writeTail = new Promise((resolve) => {
        releaseWriter = resolve;
      });
    }
    await priorWriter;

    const staged = new Map();
    for (const [key, value] of sharedState.records.entries()) staged.set(key, clone(value));
    const boundary = Object.freeze({
      async get(key) {
        trigger("before-read");
        return staged.has(key) ? clone(staged.get(key)) : undefined;
      },
      async getAll() {
        trigger("before-read");
        return Array.from(staged.values(), (value) => clone(value));
      },
      async add(value) {
        if (mode !== "readwrite") throw driverError("readonly-write");
        const key = value && value.syncedPocketId;
        if (staged.has(key)) throw driverError("duplicate-key");
        staged.set(key, clone(value));
        return key;
      },
      async put(value) {
        if (mode !== "readwrite") throw driverError("readonly-write");
        const key = value && value.syncedPocketId;
        staged.set(key, clone(value));
        return key;
      },
      checkpoint(point) {
        trigger(point);
      },
    });

    try {
      const result = await work(boundary);
      if (commitGate) await commitGate.promise;
      trigger("during-commit");
      if (mode === "readwrite") {
        const committed = new Map();
        for (const [key, value] of staged.entries()) committed.set(key, clone(value));
        sharedState.records = committed;
      }
      return result;
    } finally {
      if (releaseWriter) releaseWriter();
    }
  }

  function close() {
    opened = false;
    return true;
  }

  return Object.freeze({
    open,
    transaction: execute,
    close,
    failAt,
    holdCommit,
    sharedState,
  });
}

module.exports = {
  createSharedDeviceStoreState,
  createMemoryDeviceStoreDriver,
};
