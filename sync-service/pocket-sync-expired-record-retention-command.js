"use strict";

const { Pool } = require("pg");
const { readDatabaseConnection } = require("./pocket-sync-server-config.js");
const { createPostgresStore } = require("./pocket-sync-postgres-store.js");
const { removeExpiredEphemeralRecords } = require("./pocket-sync-expired-record-retention.js");

function commandError() {
  const error = new Error("Pocket Sync expired-record retention command failed.");
  error.code = "sync-retention-failed";
  return error;
}

function retentionDiagnostic() {
  return "Pocket Sync expired-record retention failed.\n";
}

async function runExpiredEphemeralRetention() {
  let pool = null;
  try {
    const connectionString = readDatabaseConnection({ environment: process.env });
    pool = new Pool({ connectionString });
    if (!pool || typeof pool.connect !== "function" || typeof pool.end !== "function") {
      throw commandError();
    }
    const store = createPostgresStore({ pool });
    const result = await removeExpiredEphemeralRecords({
      store,
      cutoffMilliseconds: Date.now(),
    });
    await pool.end();
    pool = null;
    return result;
  } catch (_error) {
    if (pool && typeof pool.end === "function") {
      try { await pool.end(); } catch (_closeError) {}
    }
    throw commandError();
  }
}

if (require.main === module) {
  runExpiredEphemeralRetention().then((result) => {
    process.stdout.write(`${JSON.stringify(result)}\n`);
  }).catch(() => {
    process.stderr.write(retentionDiagnostic());
    process.exitCode = 1;
  });
}

module.exports = Object.freeze({ runExpiredEphemeralRetention, retentionDiagnostic });
