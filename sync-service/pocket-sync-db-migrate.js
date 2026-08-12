"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { Pool } = require("pg");
const { readDatabaseConnection } = require("./pocket-sync-server-config.js");

const MIGRATION_PATH = path.join(__dirname, "migrations", "001-pocket-sync-store.sql");

function migrationError() {
  const error = new Error("Pocket Sync migration failed.");
  error.code = "sync-server-migration-failed";
  return error;
}

async function applyLocalMigration(connectionString) {
  if (typeof connectionString !== "string" || connectionString.length < 1
      || connectionString !== connectionString.trim()) {
    throw migrationError();
  }
  let sql;
  try { sql = fs.readFileSync(MIGRATION_PATH, "utf8"); } catch (_error) { throw migrationError(); }
  if (typeof sql !== "string" || sql.length < 1) throw migrationError();
  const pool = new Pool({ connectionString });
  if (!pool || typeof pool.query !== "function" || typeof pool.end !== "function") throw migrationError();
  try {
    await pool.query(sql);
  } catch (_error) {
    throw migrationError();
  } finally {
    try { await pool.end(); } catch (_error) {}
  }
}

async function runMigration() {
  const connectionString = readDatabaseConnection({ environment: process.env });
  await applyLocalMigration(connectionString);
}

if (require.main === module) {
  runMigration().catch(() => { process.exitCode = 1; });
}

module.exports = Object.freeze({ applyLocalMigration });
