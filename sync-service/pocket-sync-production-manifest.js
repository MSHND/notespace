"use strict";

const path = require("node:path");
const { createProductionReleaseManifest } = require("./pocket-sync-production-server.js");

function main() {
  const manifest = createProductionReleaseManifest({
    browserRoot: path.resolve(__dirname, ".."),
    serviceRoot: process.env.POCKET_SYNC_SERVICE_ROOT || "/pocket-sync/v1",
  });
  process.stdout.write(`${JSON.stringify(Object.freeze({ version: 1, assets: manifest }))}\n`);
}

try { main(); } catch (_error) { process.exitCode = 1; }
