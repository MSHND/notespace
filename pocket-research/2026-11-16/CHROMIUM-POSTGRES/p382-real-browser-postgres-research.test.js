"use strict";

/*
 * P382 | Research-only, disposable browser + PostgreSQL integration.
 * No production credentials, real user data or hosted service writes.
 * This is not automatically a complete cross-device or Stage 1 Gate 1 PASS.
 */
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const https = require("node:https");
const { once } = require("node:events");
const { randomBytes } = require("node:crypto");
const { Pool } = require("pg");
const { chromium } = require("playwright-core");
const {
  OBJECT_FORMAT, OBJECT_VERSION, OBJECT_ALGORITHM,
  referenceForRecord, createObjectHeadPostgresStore,
} = require("../../../sync-service/pocket-sync-object-head-postgres-store.js");
const { createSyncServerApplication } = require("../../../sync-service/pocket-sync-server-runtime.js");
const { createUnavailableRecoveryProofVerifier } = require("../../../sync-service/pocket-sync-server-config.js");
const { createLocalIntegrationHandler } = require("../../../sync-service/pocket-sync-local-integration-server.js");

const ROOT = path.resolve(__dirname, "../../..");
const ORIGIN = "https://localhost:8443";
const POCKET_ID = "p382-research-" + randomBytes(9).toString("hex");
const db = process.env.POCKET_SYNC_DATABASE_URL;
const CERT = process.env.POCKET_P382_CERT;
const KEY = process.env.POCKET_P382_KEY;
const CHROME = process.env.CHROME_BIN;

test("P382 real Chromium loads Pocket against an isolated PostgreSQL-backed Sync server and durable Head CAS", { timeout: 180000 }, async () => {
  const databaseHost = db ? new URL(db).hostname : null;
  assert.ok(["localhost", "127.0.0.1"].includes(databaseHost),
    "Only a loopback disposable PostgreSQL DSN is allowed");
  assert.ok(CERT && KEY && CHROME, "Research TLS and Chromium configuration are required");

  const pool1 = new Pool({ connectionString: db });
  const pool2 = new Pool({ connectionString: db });
  let browser = null, server = null, application = null;
  try {
    const serverInfo = await pool1.query("SELECT current_setting('server_version_num') AS version");
    const version = Number(serverInfo.rows[0].version);
    assert.ok(version >= 180000, "P382 requires real PostgreSQL 18 or newer");

    // Use the real PostgreSQL object/Head store twice, with separate connections.
    const writer = createObjectHeadPostgresStore({ pool: pool1 });
    const reader = createObjectHeadPostgresStore({ pool: pool2 });
    const initial = await writer.initialiseHead(POCKET_ID);
    assert.equal(initial.revision, 0);
    const object = {
      format: OBJECT_FORMAT,
      version: OBJECT_VERSION,
      algorithm: OBJECT_ALGORITHM,
      nonce: randomBytes(12).toString("base64url"),
      ciphertext: randomBytes(48).toString("base64url"),
    };
    const ref = referenceForRecord(object);
    assert.equal((await writer.putObject(POCKET_ID, ref, object)).ok, true);
    const accepted = await writer.compareAndSetHead(POCKET_ID, initial, ref);
    assert.equal(accepted.ok, true);
    assert.equal(accepted.head.revision, 1);
    const reloaded = await reader.readHead(POCKET_ID);
    assert.deepEqual(reloaded, accepted.head);
    assert.deepEqual(await reader.getObject(POCKET_ID, ref), object);
    const persisted = await pool2.query(
      "SELECT revision,seal_storage_ref FROM public.pocket_sync_heads WHERE synced_pocket_id=$1", [POCKET_ID]
    );
    assert.equal(Number(persisted.rows[0].revision), 1);
    assert.equal(persisted.rows[0].seal_storage_ref, ref);

    // Actual repo HTTP adapter, core, WebAuthn verifier, PostgreSQL stores, HTTPS host and SPA assets.
    application = createSyncServerApplication({
      trustedOrigin: ORIGIN,
      rpId: "localhost",
      rpName: "Pocket P382 disposable browser",
      serviceRoot: "/pocket-sync/v1",
      postgres: { connectionString: db },
      credentialAlgorithms: [-7, -257],
      ceremonyLifetimeMs: 300000,
      sessionLifetimeMs: 2592000000,
      recoveryProofVerifier: createUnavailableRecoveryProofVerifier(),
    });
    await application.preflight();
    const handler = createLocalIntegrationHandler({
      application, browserRoot: ROOT, serviceRoot: "/pocket-sync/v1",
    });
    server = https.createServer({ key: fs.readFileSync(KEY), cert: fs.readFileSync(CERT) }, handler);
    server.listen(8443, "127.0.0.1");
    await once(server, "listening");

    browser = await chromium.launch({
      executablePath: CHROME,
      headless: true,
      args: ["--no-sandbox", "--disable-dev-shm-usage", "--ignore-certificate-errors"],
    });
    const context = await browser.newContext({ ignoreHTTPSErrors: true });
    const page = await context.newPage();
    const networkResponses = [];
    page.on("response", (res) => {
      if (res.url().startsWith(ORIGIN)) networkResponses.push({ url: res.url(), status: res.status() });
    });
    const response = await page.goto(ORIGIN + "/", { waitUntil: "load", timeout: 35000 });
    assert.equal(response.status(), 200);
    await page.waitForFunction(() => typeof window.PocketSyncLocalIntegration?.create === "function", { timeout: 25000 });
    const browserFacts = await page.evaluate(() => ({
      secureContext: window.isSecureContext,
      hasWebAuthn: typeof navigator.credentials?.create === "function",
      hasSyncIntegration: typeof window.PocketSyncActiveIntegration?.activate === "function",
      hasMainSave: typeof window.exportTree === "function",
      hasNodeContent: !!window.PocketNodeContent,
      title: document.title,
      scriptCount: document.scripts.length,
    }));
    assert.equal(browserFacts.secureContext, true);
    assert.equal(browserFacts.hasWebAuthn, true);
    assert.equal(browserFacts.hasSyncIntegration, true);
    assert.equal(browserFacts.hasMainSave, true);
    assert.equal(browserFacts.hasNodeContent, true);
    assert.ok(networkResponses.filter((x) => x.status === 200).length >= 6,
      "Chromium must fetch the real Pocket HTML and JS assets, not synthetic DOM");

    // Browser passkey availability is exercised without registering a real credential.
    // Actual browser Open/Edit/Save against PostgreSQL remains a separate acceptance target.
    console.info("P382_ENVIRONMENT=" + JSON.stringify({
      chromium: await browser.version(),
      postgresVersion: serverInfo.rows[0].version,
      browserFacts, successfulBrowserAssets: networkResponses.filter(x => x.status === 200).length,
      sqlHead: reloaded.revision, independentPgReload: true,
      authenticatedBrowserEditSaveReadback: "NOT_EXECUTED",
      productionDomain: "NOT_TOUCHED",
    }));
  } finally {
    if (browser) await browser.close();
    if (server) await new Promise(resolve => server.close(resolve));
    if (application) await application.close();
    await pool1.end();
    await pool2.end();
  }
});
