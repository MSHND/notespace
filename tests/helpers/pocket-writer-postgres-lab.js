"use strict";

const { execFileSync, spawnSync } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");
const { Pool } = require("pg");
const { INSTALL_SQL } = require("../../tools/pocket-writer-format-admission.js");

function postgresBin() {
  const distro = "/usr/lib/postgresql";
  const versioned = fs.existsSync(distro)
    ? fs.readdirSync(distro).sort((a, b) => Number(b) - Number(a)).map(v => path.join(distro, v, "bin")) : [];
  const configured = spawnSync("pg_config", ["--bindir"], { encoding: "utf8" }).stdout?.trim();
  const paths = [configured, "/Applications/Postgres.app/Contents/Versions/latest/bin", ...versioned];
  const bin = paths.find(dir => dir && ["initdb", "pg_ctl"].every(name => fs.existsSync(path.join(dir, name))));
  if (!bin) throw new Error("Disposable PostgreSQL binaries unavailable");
  return bin;
}

async function setupPostgres(t) {
  const bin = postgresBin();
  const dir = fs.mkdtempSync("/tmp/pocket-writer-pg-");
  const data = path.join(dir, "data"), log = path.join(dir, "server.log");
  const port = 55432, pools = new Set();
  const appUser = "pocket_writer_app";
  let running = false;
  const run = (name, args) => execFileSync(path.join(bin, name), args, { timeout: 15000, encoding: "utf8" });
  const start = () => {
    try {
      run("pg_ctl", ["-w", "-t", "10", "-D", data, "-l", log, "-o",
        "-c listen_addresses='' -c unix_socket_directories=" + dir + " -c unix_socket_permissions=0700 -p " + port,
        "start"]);
      running = true;
    } catch (error) {
      throw new Error(fs.existsSync(log) ? fs.readFileSync(log, "utf8").trim() : error.message, { cause: error });
    }
  };
  const stop = (mode = "fast") => {
    if (!running) return;
    run("pg_ctl", ["-w", "-t", "10", "-D", data, "-m", mode, "stop"]);
    running = false;
  };
  const poolFor = user => {
    const pool = new Pool({ host: dir, port, user, database: "postgres", max: 12,
      connectionTimeoutMillis: 5000, statement_timeout: 5000 });
    pools.add(pool);
    return pool;
  };
  const close = async () => {
    await Promise.all([...pools].map(pool => pool.end()));
    pools.clear();
  };
  t.after(async () => {
    await close();
    stop();
    fs.rmSync(dir, { recursive: true, force: true });
  });
  run("initdb", ["-D", data, "--auth=trust", "--no-locale", "--encoding=UTF8", "--username=pocket_writer_lab"]);
  start();

  const administrator = () => poolFor("pocket_writer_lab");
  const admin = administrator();
  for (const file of ["001-pocket-sync-store.sql", "002-pocket-sync-object-head-store.sql",
    "003-pocket-sync-persistence-authority.sql"]) {
    await admin.query(fs.readFileSync(path.join(__dirname, "../../sync-service/migrations", file), "utf8"));
  }
  await admin.query(INSTALL_SQL);
  await admin.query([
    "CREATE ROLE pocket_writer_app LOGIN",
    "GRANT SELECT, INSERT ON public.pocket_sync_objects TO pocket_writer_app",
    "GRANT SELECT, INSERT (synced_pocket_id, revision, seal_storage_ref), UPDATE (revision, seal_storage_ref) ON public.pocket_sync_heads TO pocket_writer_app",
    "GRANT SELECT, INSERT, UPDATE, DELETE ON public.pocket_sync_records TO pocket_writer_app",
  ].join(";"));
  const version = (await admin.query("SHOW server_version")).rows[0].server_version;
  t.diagnostic("Disposable PostgreSQL " + version);
  return {
    admin: administrator,
    app: () => poolFor(appUser),
    async restart() { await close(); stop("immediate"); start(); },
  };
}

// The hook runs just before the real store changes or commits the Head row.
// Every other query still reaches the regular PostgreSQL client.
function instrumentHeadPool(pool, hooks) {
  return {
    async connect() {
      const client = await pool.connect();
      let writingHead = false, destroyed = false;
      const onError = () => { destroyed = true; };
      client.on("error", onError);
      return {
        async query(sql, values) {
          const writing = sql.startsWith("UPDATE public.pocket_sync_heads SET revision");
          if (writing) await hooks.beforeUpdate?.();
          if (sql === "COMMIT" && writingHead && hooks.beforeCommit) {
            await hooks.beforeCommit(client.processID);
            destroyed = true;
            throw new Error("Synthetic backend termination before COMMIT");
          }
          const result = await client.query(sql, values);
          if (writing && result.rowCount === 1) writingHead = true;
          return result;
        },
        release(discard) {
          client.removeListener("error", onError);
          client.release(discard || destroyed);
        },
      };
    },
  };
}

module.exports = { setupPostgres, instrumentHeadPool };
