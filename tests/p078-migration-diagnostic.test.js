"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const Module = require("node:module");
const { spawnSync } = require("node:child_process");

const ROOT = path.resolve(__dirname, "..");
const MIGRATION_PATH = require.resolve("../sync-service/pocket-sync-db-migrate.js");
const SENTINEL = "P078-SENTINEL-POSTGRES-ERROR-AND-CONNECTION";
const SENTINEL_CONNECTION = ` postgres://${SENTINEL}@db.invalid/pocket`;

function loadMigration(dependencies) {
  const originalLoad = Module._load;
  const cached = require.cache[MIGRATION_PATH];
  Module._load = function patchedLoad(name, parent, isMain) {
    if (name === "pg") return { Pool: dependencies.Pool };
    if (name === "./pocket-sync-server-config.js") {
      return { readDatabaseConnection: dependencies.readDatabaseConnection };
    }
    if (name === "./pocket-sync-postgres-schema.js") {
      return { verifyPocketSyncSchema: dependencies.verifyPocketSyncSchema };
    }
    return originalLoad.call(this, name, parent, isMain);
  };
  delete require.cache[MIGRATION_PATH];
  try { return require(MIGRATION_PATH); }
  finally {
    Module._load = originalLoad;
    if (cached) require.cache[MIGRATION_PATH] = cached;
    else delete require.cache[MIGRATION_PATH];
  }
}

function successfulDependencies() {
  let ended = 0;
  class Pool {
    async query() { return { rows: [], rowCount: 0 }; }
    async end() { ended += 1; }
  }
  return {
    Pool,
    ended() { return ended; },
    readDatabaseConnection() { return "postgres://test-only"; },
    async verifyPocketSyncSchema() { return true; },
  };
}

test("P078 migration maps configuration, SQL and schema failures to safe stages", async (t) => {
  await t.test("configuration", async () => {
    const dependencies = successfulDependencies();
    const { applyLocalMigration, migrationDiagnostic } = loadMigration(dependencies);
    await assert.rejects(applyLocalMigration(` ${SENTINEL}`), (error) =>
      error?.code === "sync-server-migration-failed" && error.stage === "configuration"
        && migrationDiagnostic(error) === "Pocket Sync migration failed: configuration\n"
    );
  });

  await t.test("migration apply", async () => {
    const dependencies = successfulDependencies();
    dependencies.Pool.prototype.query = async () => { throw new Error(SENTINEL); };
    const { applyLocalMigration, migrationDiagnostic } = loadMigration(dependencies);
    await assert.rejects(applyLocalMigration("postgres://test-only"), (error) =>
      error?.code === "sync-server-migration-failed" && error.stage === "migration-apply"
        && migrationDiagnostic(error) === "Pocket Sync migration failed: migration-apply\n"
    );
    assert.equal(dependencies.ended(), 1);
  });

  await t.test("schema verification", async () => {
    const dependencies = successfulDependencies();
    dependencies.verifyPocketSyncSchema = async () => { throw new Error(SENTINEL); };
    const { applyLocalMigration, migrationDiagnostic } = loadMigration(dependencies);
    await assert.rejects(applyLocalMigration("postgres://test-only"), (error) =>
      error?.code === "sync-server-migration-failed" && error.stage === "schema-verify"
        && migrationDiagnostic(error) === "Pocket Sync migration failed: schema-verify\n"
    );
    assert.equal(dependencies.ended(), 1);
  });
});

test("P078 migration file and unknown failures remain constant-safe", async (t) => {
  const dependencies = successfulDependencies();
  const originalRead = fs.readFileSync;
  const { applyLocalMigration, migrationDiagnostic } = loadMigration(dependencies);
  fs.readFileSync = function failMigrationRead(filename, ...rest) {
    if (filename === path.join(ROOT, "sync-service", "migrations", "001-pocket-sync-store.sql")) {
      throw new Error(SENTINEL);
    }
    return originalRead.call(this, filename, ...rest);
  };
  try {
    await assert.rejects(applyLocalMigration("postgres://test-only"), (error) =>
      error?.stage === "migration-file" && migrationDiagnostic(error) === "Pocket Sync migration failed: migration-file\n"
    );
  } finally {
    fs.readFileSync = originalRead;
  }
  assert.equal(migrationDiagnostic(new Error(SENTINEL)), "Pocket Sync migration failed: unknown\n");
  assert.doesNotMatch(migrationDiagnostic(new Error(SENTINEL)), new RegExp(SENTINEL));
  void t;
});

test("P078 CLI emits one safe line without configuration or provider-controlled text", () => {
  const result = spawnSync(process.execPath, [MIGRATION_PATH], {
    cwd: ROOT,
    encoding: "utf8",
    env: { PATH: process.env.PATH, POCKET_SYNC_DATABASE_URL: SENTINEL_CONNECTION },
  });
  assert.equal(result.status, 1);
  assert.equal(result.stdout, "");
  assert.equal(result.stderr, "Pocket Sync migration failed: configuration\n");
  assert.doesNotMatch(result.stderr, new RegExp(SENTINEL));
});

test("P078 successful migration behaviour remains unchanged", async () => {
  const dependencies = successfulDependencies();
  const { applyLocalMigration } = loadMigration(dependencies);
  await assert.doesNotReject(applyLocalMigration("postgres://test-only"));
  assert.equal(dependencies.ended(), 1);
});
