"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { Pool } = require("pg");
const { readDatabaseConnection } = require("./pocket-sync-server-config.js");
const { verifyPocketSyncSchema, safeSchemaComponent } = require("./pocket-sync-postgres-schema.js");

const MIGRATION_PATH = path.join(__dirname, "migrations", "001-pocket-sync-store.sql");
const MIGRATION_STAGES = Object.freeze([
  "configuration", "migration-file", "migration-apply", "schema-verify", "unknown",
]);

function migrationError(stage = "unknown", component = "unknown") {
  const error = new Error("Pocket Sync migration failed.");
  error.code = "sync-server-migration-failed";
  const safe = MIGRATION_STAGES.includes(stage) ? stage : "unknown";
  Object.defineProperty(error, "stage", {
    enumerable: false,
    value: safe,
  });
  if (safe === "schema-verify") Object.defineProperty(error, "component", {
    enumerable: false,
    value: safeSchemaComponent({ component }),
  });
  return error;
}

function safeStage(error) {
  try { return MIGRATION_STAGES.includes(error?.stage) ? error.stage : "unknown"; }
  catch (_error) { return "unknown"; }
}

function migrationDiagnostic(error) {
  const stage = safeStage(error);
  const component = stage === "schema-verify" ? `/${safeSchemaComponent(error)}` : "";
  return `Pocket Sync migration failed: ${stage}${component}\n`;
}

async function applyLocalMigration(connectionString) {
  if (typeof connectionString !== "string" || connectionString.length < 1
      || connectionString !== connectionString.trim()) {
    throw migrationError("configuration");
  }
  let sql;
  try { sql = fs.readFileSync(MIGRATION_PATH, "utf8"); } catch (_error) { throw migrationError("migration-file"); }
  if (typeof sql !== "string" || sql.length < 1) throw migrationError("migration-file");
  let pool;
  try {
    pool = new Pool({ connectionString });
    if (!pool || typeof pool.query !== "function" || typeof pool.end !== "function") throw migrationError("migration-apply");
  } catch (_error) {
    throw migrationError("migration-apply");
  }
  try {
    try {
      await pool.query(sql);
    } catch (_error) {
      throw migrationError("migration-apply");
    }
    try {
      await verifyPocketSyncSchema(pool);
    } catch (error) {
      throw migrationError("schema-verify", safeSchemaComponent(error));
    }
  } finally {
    try { await pool.end(); } catch (_error) {}
  }
}

async function runMigration() {
  let connectionString;
  try { connectionString = readDatabaseConnection({ environment: process.env }); }
  catch (_error) { throw migrationError("configuration"); }
  try { await applyLocalMigration(connectionString); }
  catch (error) {
    const stage = safeStage(error);
    throw migrationError(stage, stage === "schema-verify" ? safeSchemaComponent(error) : "unknown");
  }
}

if (require.main === module) {
  runMigration().catch((error) => {
    process.stderr.write(migrationDiagnostic(error));
    process.exitCode = 1;
  });
}

module.exports = Object.freeze({ applyLocalMigration, migrationDiagnostic, runMigration });
