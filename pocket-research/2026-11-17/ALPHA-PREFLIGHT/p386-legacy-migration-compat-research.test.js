"use strict";

/* P386 RESEARCH ONLY. Disposable localhost PostgreSQL, synthetic records.
 * Prove the deployed migration SQL remains identical to current main,
 * that a second execution of the actual migration runner retains existing
 * Project Documents and backfills one authority record without duplication.
 * This does NOT verify Render production backups, restore artifacts, live DB
 * state, production Auth0 tokens, or approval to deploy.
 */
const test = require("node:test");
const assert = require("node:assert/strict");
const { execFileSync } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");
const { Pool } = require("pg");
const { applyLocalMigration } = require("../../../sync-service/pocket-sync-db-migrate.js");

const root = path.resolve(__dirname, "../../..");
const previous = "d0e68fea885bafb5c92cf4ba0be0a91b38dbffa2";
const selectedMigrations = [
  "001-pocket-sync-store.sql",
  "002-pocket-sync-object-head-store.sql",
  "003-pocket-sync-persistence-authority.sql",
  "004-pocket-project-documents.sql",
];

function sameSelectedSql() {
  for (const file of selectedMigrations) {
    const rel = "sync-service/migrations/" + file;
    const old = execFileSync("git", ["show", previous + ":" + rel], {cwd:root});
    const current = fs.readFileSync(path.join(root, rel));
    assert.ok(old.equals(current), "Deployed→new differs at selected migration " + file);
  }
}
test("P386 selected production SQL migrations are byte-identical to the currently deployed build", () => {
  sameSelectedSql();
  const cli = fs.readFileSync(path.join(root, "sync-service/pocket-sync-db-migrate.js"), "utf8");
  assert.ok(cli.includes('"004", "pocket", "project", "documents.sql"'));
  assert.equal(cli.includes('"005", "pocket"'), false,
    "Proposed P349 handover migration must not be silently selected");
  console.info("P386_SELECTED_SQL=001..004 unchanged since deployed October build; proposed 005 excluded");
});

test("P386 running the actual migration twice preserves a pre-existing synthetic document and one backfilled authority", {timeout:120000}, async () => {
  const url = process.env.POCKET_SYNC_DATABASE_URL;
  assert.ok(url && new URL(url).hostname === "127.0.0.1",
    "Only disposable loopback PostgreSQL is permitted");
  const pool = new Pool({connectionString:url});
  try {
    await applyLocalMigration(url);
    const name = "research.p386-synthetic-document";
    const body = "synthetic-only; no private project data";
    const oldRevision = 7;
    const pocketId = "p386-disposable-pocket";
    await pool.query(
      "INSERT INTO public.pocket_project_documents (name,content,revision,updated_at) VALUES ($1,$2,$3,now())",
      [name,body,oldRevision]
    );
    const source = {
      storeVersion:1,accountId:"synthetic-account-only",note:"no real user data",
    };
    await pool.query(
      "INSERT INTO public.pocket_sync_records (collection,record_key,store_version,record) VALUES ($1,$2,$3,$4::jsonb)",
      ["pockets",pocketId,1,JSON.stringify(source)]
    );
    const before = await pool.query(
      "SELECT name,content,revision,updated_at FROM public.pocket_project_documents WHERE name=$1",
      [name]
    );
    assert.equal(before.rows.length,1);
    await applyLocalMigration(url);
    const after = await pool.query(
      "SELECT name,content,revision,updated_at FROM public.pocket_project_documents WHERE name=$1",
      [name]
    );
    assert.deepEqual(after.rows,before.rows,
      "Repeated predeploy migrations must not mutate accepted Project Documents content/revision/timestamp");

    const auth = await pool.query(
      "SELECT store_version,record FROM public.pocket_sync_records WHERE collection='persistenceAuthorities' AND record_key=$1",
      [pocketId]
    );
    assert.equal(auth.rows.length,1);
    assert.equal(Number(auth.rows[0].store_version),1);
    assert.equal(auth.rows[0].record.currentMode,"whole-record");
    assert.equal(auth.rows[0].record.syncedPocketId,pocketId);
    const count = await pool.query(
      "SELECT count(*)::int AS total FROM public.pocket_sync_records WHERE collection='persistenceAuthorities' AND record_key=$1",
      [pocketId]
    );
    assert.equal(count.rows[0].total,1);
    const schema = await pool.query(
      "SELECT schema_name,schema_version FROM public.pocket_sync_schema ORDER BY schema_name"
    );
    assert.equal(schema.rows.length,4);
    assert.ok(schema.rows.every(row=>row.schema_version===1));
    console.info("P386_DISPOSABLE_PG=selected migration rerun preserved document exact bytes/revision/timestamp and one authority record");
  } finally {
    await pool.end();
  }
});
