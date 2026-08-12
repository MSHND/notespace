"use strict";

const fs = require("node:fs");
const { createLocalServerConfig } = require("./pocket-sync-server-config.js");
const { createSyncServerRuntime } = require("./pocket-sync-server-runtime.js");

async function startLocalServer() {
  const config = createLocalServerConfig({ environment: process.env, readFile: fs.readFileSync });
  const runtime = createSyncServerRuntime(config.runtime);
  await runtime.listen(config.listen);
  let stopping = false;
  const stop = async () => {
    if (stopping) return;
    stopping = true;
    try { await runtime.close(); } catch (_error) { process.exitCode = 1; }
  };
  process.once("SIGINT", stop);
  process.once("SIGTERM", stop);
  return runtime;
}

if (require.main === module) {
  startLocalServer().catch(() => { process.exitCode = 1; });
}

module.exports = Object.freeze({ startLocalServer });
