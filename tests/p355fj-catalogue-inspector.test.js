"use strict";
/* P355fj: synthetic/disposable PostgreSQL 18 only. Never connect to Render. */
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { execFileSync, spawnSync } = require("node:child_process");
const { Client } = require("pg");
const { runInspector } = require("../tools/p355fj-catalogue-inspector.js");

const ROOT = path.join(__dirname, "..");
const URL = process.env.P355FJ_DISPOSABLE_POSTGRES_URL;
if (!URL || !/127\.0\.0\.1|localhost/.test(URL) || !URL.endsWith("/pocket_postgres")) {
  throw new Error("P355fj tests require a disposable LOCAL postgres URL");
}
const environment = Object.freeze({ POCKET_SYNC_DATABASE_URL: URL });

async function expectedFailure(options, expected) {
  try {
    await runInspector({ environment, ...options });
    assert.fail("expected a closed failure");
  } catch (error) {
    assert.equal(error.safeCode, expected);
    assert.equal(error.message, "P355fj catalogue inspection failed");
    assert(!JSON.stringify(error).includes("synthetic-private"));
  }
}

function instrument(change = () => {}) {
  const tally = { made: 0, connect: 0, end: 0, rollback: 0, begin: 0, calls: [], configs: [] };
  class InstrumentedClient extends Client {
    async connect() {
      tally.connect++;
      return super.connect();
    }
    async query(sql, ...args) {
      tally.calls.push(String(sql));
      if (sql === "BEGIN TRANSACTION READ ONLY") tally.begin++;
      if (sql === "ROLLBACK") tally.rollback++;
      return change.call(this, sql, () => super.query(sql, ...args));
    }
    async end() {
      tally.end++;
      return super.end();
    }
  }
  return {
    tally,
    makeClient(config) {
      tally.made++;
      tally.configs.push({
        hasConnectionString: typeof config.connectionString === "string",
        options: config.options,
        connectionTimeoutMillis: config.connectionTimeoutMillis,
        query_timeout: config.query_timeout,
      });
      return new InstrumentedClient(config);
    },
  };
}

test("P355fj accepted actual runner creates synthetic PostgreSQL 18 structures and secret fixtures", async () => {
  assert.equal(fs.existsSync(path.join(ROOT, "sync-service/pocket-sync-db-migrate.js")), true);
  execFileSync(process.execPath, ["sync-service/pocket-sync-db-migrate.js"], {
    cwd: ROOT, stdio: "pipe", env: { ...process.env, POCKET_SYNC_DATABASE_URL: URL },
  });
  const client = new Client({ connectionString: URL });
  try {
    await client.connect();
    const v = await client.query("SHOW server_version_num");
    assert.equal(Math.floor(Number(v.rows[0].server_version_num)/10000), 18);
    await client.query(
      "INSERT INTO public.pocket_sync_records(collection,record_key,store_version,record) " +
      "VALUES('pockets','synthetic-only',1," +
      "'{\"kind\":\"synthetic\",\"schemaVersion\":1,\"storeVersion\":1," +
      "\"accountId\":\"synthetic-account\",\"secret\":\"synthetic-private-content\"}'::jsonb) " +
      "ON CONFLICT(collection,record_key) DO NOTHING");
    await client.query(
      "INSERT INTO public.pocket_project_documents(name,content,revision,updated_at) " +
      "VALUES('synthetic.fixture','synthetic-private-document',1,now()) " +
      "ON CONFLICT(name) DO NOTHING");
  } finally {
    await client.end();
  }
});

test("P355fj success uses exactly one Client, one read-only transaction, six fixed SELECTs and closes", async () => {
  const probe = instrument(function(_sql, next) { return next(); });
  const report = await runInspector({ environment, makeClient: probe.makeClient });
  assert.equal(report.status, "complete");
  assert.equal(report.targetMatched, true);
  assert.equal(report.postgresMajor, 18);
  assert.equal(report.readOnlyVerified, true);
  assert.equal(report.timeoutsVerified, true);
  assert.deepEqual(Object.keys(report.catalogue), [
    "tables","constraints","schemaMarkers","tableEstimates","aggregateLocks","aggregateTransactions"
  ]);
  assert.equal(probe.tally.made, 1);
  assert.equal(probe.tally.connect, 1);
  assert.equal(probe.tally.begin, 1);
  assert.equal(probe.tally.rollback, 1);
  assert.equal(probe.tally.end, 1);
  assert.equal(probe.tally.calls.filter(s => /^\s*(WITH|SELECT)\b/i.test(s)).length, 7);
  assert.equal(probe.tally.configs[0].connectionTimeoutMillis, 5000);
  assert.equal(probe.tally.configs[0].query_timeout, 4000);
  for (const [name, num] of [
    ["statement_timeout",3000],["lock_timeout",250],
    ["idle_in_transaction_session_timeout",60000],["transaction_timeout",120000]
  ]) assert(probe.tally.configs[0].options.includes(name + "=" + num));
  assert(probe.tally.configs[0].options.includes("default_transaction_read_only=on"));
  const markers = report.catalogue.schemaMarkers;
  assert(markers.some(x => x.schema_name==="pocket-sync-store" && x.schema_version===1));
  assert(markers.some(x => x.schema_name==="pocket-sync-object-head-store"));
  assert(markers.some(x => x.schema_name==="pocket-sync-persistence-authority"));
  assert(markers.some(x => x.schema_name==="pocket-project-documents"));
  assert(report.catalogue.constraints.some(x =>
    x.constraint_name==="pocket_sync_records_collection_check" && x.validated===true &&
    x.definition.includes("persistenceAuthorities")));
  assert(report.catalogue.tables.some(x =>
    x.table_name==="pocket_project_documents" && x.table_exists===true &&
    x.column_name==="content" && x.data_type==="text"));
  const serialized = JSON.stringify(report);
  assert(!serialized.includes("synthetic-private"));
  assert(!serialized.includes("synthetic-account"));
  assert(!serialized.includes("synthetic-only"));
  assert(!serialized.includes(URL));
  for (const item of report.catalogue.tableEstimates) {
    assert.equal(typeof item.total_bytes,"string");
  }
});

test("P355fj wrong database fails, with one transaction rollback and close", async () => {
  const bad = environment.POCKET_SYNC_DATABASE_URL.replace(/\/pocket_postgres$/, "/postgres");
  const probe = instrument(function(_sql, next) { return next(); });
  await expectedFailure({environment:{POCKET_SYNC_DATABASE_URL:bad},makeClient:probe.makeClient},
    "wrong-database");
  assert.equal(probe.tally.made,1);
  assert.equal(probe.tally.rollback,1);
  assert.equal(probe.tally.end,1);
});

test("P355fj wrong PostgreSQL major is rejected (synthetically altered catalogue result)", async () => {
  const probe = instrument(async function(sql, next) {
    const r = await next();
    if (sql.startsWith("SELECT current_database()")) {
      r.rows[0].server_version_num = "170000";
    }
    return r;
  });
  await expectedFailure({makeClient:probe.makeClient},"wrong-postgres-version");
  assert.equal(probe.tally.rollback,1);
  assert.equal(probe.tally.end,1);
});

test("P355fj rejected SET LOCAL fails closed, and cleanup executes", async () => {
  const probe = instrument(function(sql, next) {
    if (sql.startsWith("SET LOCAL lock_timeout"))
      throw new Error("synthetic-private SQL and connection credential details");
    return next();
  });
  await expectedFailure({makeClient:probe.makeClient},"inspection-failed");
  assert.equal(probe.tally.rollback,1);
  assert.equal(probe.tally.end,1);
  assert.equal(probe.tally.calls.some(x=>x.includes("FROM public.pocket_sync_schema")),false);
});

test("P355fj mismatched effective timeout fails before catalogue inspection", async () => {
  const probe = instrument(async function(sql, next) {
    const r = await next();
    if(sql.startsWith("SELECT current_database()")) r.rows[0].lock_timeout="0";
    return r;
  });
  await expectedFailure({makeClient:probe.makeClient},"timeout-not-enforced");
  assert.equal(probe.tally.rollback,1);
  assert.equal(probe.tally.end,1);
});

test("P355fj permission/query failure after partial catalogue work never returns success", async () => {
  const probe = instrument(function(sql, next) {
    if(sql.includes("FROM pg_catalog.pg_stat_activity")) {
      throw new Error("synthetic-private-credentials should never reach output");
    }
    return next();
  });
  await expectedFailure({makeClient:probe.makeClient},"inspection-failed");
  assert(probe.tally.calls.some(x=>x.includes("FROM public.pocket_sync_schema")));
  assert.equal(probe.tally.rollback,1);
  assert.equal(probe.tally.end,1);
});

test("P355fj unexpected result fields fail before publishing any partial output", async () => {
  const probe = instrument(async function(sql, next) {
    const r = await next();
    if(sql.includes("WITH expected(table_name)")) {
      r.rows[0].record="synthetic-private-document";
    }
    return r;
  });
  await expectedFailure({makeClient:probe.makeClient},"unexpected-result-shape");
  assert.equal(probe.tally.rollback,1);
  assert.equal(probe.tally.end,1);
});

test("P355fj changed session identity is rejected without a second connection", async () => {
  const probe = instrument(async function(sql, next) {
    const r = await next();
    if(sql.includes("FROM public.pocket_sync_schema")) this.processID++;
    return r;
  });
  await expectedFailure({makeClient:probe.makeClient},"changed-session");
  assert.equal(probe.tally.made,1);
  assert.equal(probe.tally.connect,1);
  assert.equal(probe.tally.rollback,1);
  assert.equal(probe.tally.end,1);
});

test("P355fj no arbitrary SQL, URL command argument, or user-selected table is accepted", async () => {
  for(const arg of [
    {sql:"DROP TABLE public.pocket_sync_records"},
    {table:"pocket_sync_records"},
    {query:"SELECT * FROM public.pocket_sync_records"},
    {connectionString:URL}
  ]) {
    await assert.rejects(runInspector({environment,...arg}),err=>err.safeCode==="unsupported-arguments");
  }
  const src = fs.readFileSync(path.join(ROOT,"tools/p355fj-catalogue-inspector.js"),"utf8");
  assert(!src.includes("pocket_sync_records.record"));
  assert(!/SELECT\s+\*/i.test(src));
  assert(!/require\(.+pocket-sync-(?:service|browser)/.test(src));
});

test("P355fj real PostgreSQL contention is bounded by server lock_timeout", async () => {
  const holder = new Client({connectionString:URL});
  await holder.connect();
  await holder.query("BEGIN");
  await holder.query("LOCK TABLE public.pocket_sync_schema IN ACCESS EXCLUSIVE MODE");
  const probe = instrument(function(_sql,next) { return next(); });
  const started = Date.now();
  try {
    await expectedFailure({makeClient:probe.makeClient},"inspection-failed");
    const elapsed=Date.now()-started;
    assert(elapsed>=150 && elapsed<3000, "server lock failure should be bounded");
    assert.equal(probe.tally.made,1);
    assert.equal(probe.tally.rollback,1);
    assert.equal(probe.tally.end,1);
    process.stdout.write("P355fj disposable contention elapsed_ms="+elapsed+"\n");
  } finally {
    await holder.query("ROLLBACK");
    await holder.end();
  }
});

test("P355fj read-only transactions prevent synthetic SQL writes", async () => {
  const client = new Client({connectionString:URL,options:
    "-c statement_timeout=3000 -c lock_timeout=250 -c default_transaction_read_only=on"});
  await client.connect();
  try {
    await client.query("BEGIN TRANSACTION READ ONLY");
    await assert.rejects(
      client.query("INSERT INTO public.pocket_sync_schema(schema_name,schema_version) "+
        "VALUES('synthetic-prohibited-write',1)"),
      err=>err.code==="25006");
    await client.query("ROLLBACK");
    const check = await client.query(
      "SELECT 1 FROM public.pocket_sync_schema WHERE schema_name='synthetic-prohibited-write'");
    assert.equal(check.rowCount,0);
  } finally {
    await client.end();
  }
});

test("P355fj separate connections retain their own default settings", async () => {
  const independent = new Client({ connectionString:URL });
  await independent.connect();
  try {
    const r = await independent.query("SELECT current_setting('statement_timeout') AS timeout");
    assert.equal(r.rows[0].timeout,"0");
  } finally { await independent.end(); }
});

test("P355fj CLI failure output is bounded; never echoes a connection string", () => {
  const wrong = URL.replace(/\/pocket_postgres$/, "/postgres");
  const p = spawnSync(process.execPath, ["tools/p355fj-catalogue-inspector.js"], {
    cwd:ROOT,encoding:"utf8",
    env:{...process.env,POCKET_SYNC_DATABASE_URL:wrong},
    timeout:15000,
  });
  assert.equal(p.status,1);
  assert.equal(p.stdout,"");
  assert.match(p.stderr,/P355fj inspector FAILED \[wrong-database\]/);
  assert(!p.stderr.includes(wrong));
  assert(!p.stderr.includes("synthetic-private"));
  assert(!p.stderr.includes(" at "));
});
