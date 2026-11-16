"use strict";

const assert = require("node:assert/strict");
const { once } = require("node:events");
const fs = require("node:fs");
const https = require("node:https");
const path = require("node:path");
const test = require("node:test");
const { Pool } = require("pg");
const { chromium } = require("playwright-core");
const { POLICY, ROUTES } = require("../../../sync-service/pocket-sync-http-adapter.js");
const { createProductionIntegrationHandler } = require("../../../sync-service/pocket-sync-production-server.js");
const { createUnavailableRecoveryProofVerifier } = require("../../../sync-service/pocket-sync-server-config.js");
const { createSyncServerApplication } = require("../../../sync-service/pocket-sync-server-runtime.js");

const ROOT = path.resolve(__dirname, "../../..");
const SERVICE_ROOT = "/pocket-sync/v1";
const SEED = ["alpha", "beta", "restore"].map((id) => ({
  id, label: `Research ${id}`, details: `Synthetic notes for ${id}`, children: [],
}));

async function openBrowser(browser, origin) {
  const context = await browser.newContext({ ignoreHTTPSErrors: true });
  await context.route("**/*", (route) => new URL(route.request().url()).origin === origin
    ? route.continue() : route.abort());
  const page = await context.newPage();
  const cdp = await context.newCDPSession(page);
  await cdp.send("WebAuthn.enable");
  const { authenticatorId } = await cdp.send("WebAuthn.addVirtualAuthenticator", {
    options: {
      protocol: "ctap2", ctap2Version: "ctap2_1", transport: "internal",
      hasResidentKey: true, hasUserVerification: true, hasPrf: true,
      automaticPresenceSimulation: true, isUserVerified: true,
    },
  });
  const responses = [];
  page.on("response", (response) => {
    const url = new URL(response.url());
    if (url.origin === origin && url.pathname.startsWith(SERVICE_ROOT + "/")) {
      responses.push({ route: url.pathname.slice(SERVICE_ROOT.length), response });
    }
  });
  assert.equal((await page.goto(origin)).status(), 200);
  assert.equal(await page.evaluate(() => Boolean(window.isSecureContext
    && window.PocketSyncActiveIntegration
    && window.PocketStarlingRealTruthAdmission)), true);
  return { context, page, cdp, authenticatorId, responses };
}

async function activate(page) {
  return page.evaluate(async (nodes) => {
    const directory = await navigator.storage.getDirectory();
    const source = await directory.getFileHandle("p383-source.json", { create: true });
    const writer = await source.createWritable();
    await writer.write(JSON.stringify({ schema: "portal.export.v1", mainThoughtTree: nodes }));
    await writer.close();
    if (!await loadFromFileHandle(source, { permissionAlreadyGranted: true })) {
      throw new Error("Synthetic source file could not be opened");
    }
    // Simulate choosing a destination. The real application writes the recovery
    // package through Chromium's origin-private filesystem. Never export it.
    window.showSaveFilePicker = () => directory.getFileHandle("p383-recovery.json", { create: true });
    const nativeCreate = navigator.credentials.create;
    let prf = null;
    navigator.credentials.create = async function (options) {
      const credential = await nativeCreate.call(this, options);
      const output = credential?.getClientExtensionResults().prf?.results?.first;
      if (output) {
        prf = { id: credential.id, salt: Array.from(new Uint8Array(options.publicKey.extensions.prf.eval.first)),
          output: Array.from(new Uint8Array(output)) };
      }
      return credential;
    };
    try {
      const result = await PocketSyncActiveIntegration.activate();
      return { ok: result.ok, reason: result.reason, pocket: result.owner?.syncedPocketId, prf };
    } finally {
      navigator.credentials.create = nativeCreate;
    }
  }, SEED);
}

async function openWithSyncedFixturePasskey(reader, writer, prf) {
  const { credentials } = await writer.cdp.send("WebAuthn.getCredentials", {
    authenticatorId: writer.authenticatorId,
  });
  assert.equal(credentials.length, 1);
  assert.equal(credentials[0].rpId, "localhost");
  try {
    await reader.cdp.send("WebAuthn.addCredential", {
      authenticatorId: reader.authenticatorId, credential: credentials[0],
    });
  } catch {
    throw new Error("Disposable CDP passkey import failed");
  }
  return reader.page.evaluate(async ({ id, salt, output }) => {
    const nativeGet = navigator.credentials.get;
    let prfTransfers = 0;
    navigator.credentials.get = async function (options) {
      const credential = await nativeGet.call(this, options);
      const input = options.publicKey.extensions?.prf?.eval?.first;
      if (!input || credential?.getClientExtensionResults().prf?.results?.first) return credential;
      const requested = Array.from(new Uint8Array(input));
      if (credential?.id !== id || requested.length !== salt.length
          || !requested.every((value, index) => value === salt[index])) {
        throw new Error("Disposable PRF transfer scope mismatch");
      }
      // CDP clones the test signing credential without its authenticator PRF
      // state. Simulate only that passkey-sync output, after the native get.
      Object.defineProperty(credential, "getClientExtensionResults", {
        value: () => ({ prf: { results: { first: Uint8Array.from(output).buffer } } }),
      });
      prfTransfers += 1;
      return credential;
    };
    try {
      const result = await PocketSyncActiveIntegration.openExisting();
      return { ok: result.ok, reason: result.reason, prfTransfers };
    } finally {
      navigator.credentials.get = nativeGet;
      output.fill(0);
    }
  }, prf);
}

function contents(page) {
  return page.evaluate(() => state.nodes.slice().sort((a, b) => a.order - b.order)
    .map(({ id, parentId, label, details }) => ({ id, parentId, label, details })));
}

function deviceId(page, pocket) {
  return page.evaluate(async (id) => {
    await PocketSyncDeviceStore.open();
    return (await PocketSyncDeviceStore.readStoredRecord(id))?.deviceId ?? null;
  }, pocket);
}

async function sqlState(pool, pocket) {
  const { rows } = await pool.query(`
    SELECT h.revision AS head, h.seal_storage_ref AS seal, p.record->>'revision' AS rollback
    FROM public.pocket_sync_heads h
    JOIN public.pocket_sync_records p ON p.collection = 'pockets' AND p.record_key = h.synced_pocket_id
    WHERE h.synced_pocket_id = $1`, [pocket]);
  assert.equal(rows.length, 1);
  return { revision: Number(rows[0].head), seal: rows[0].seal, rollback: Number(rows[0].rollback) };
}

async function moveAndSave(page, direction) {
  const edit = await page.evaluate((delta) => {
    moveNodeWithinSiblings("beta", delta);
    const sequence = getPocketHighestOperationSequence();
    return { dirty: hasPocketUnsavedChanges(), ...freezePocketStarlingOwnerWorkingSetThrough(sequence) };
  }, direction);
  assert.equal(edit.dirty, true);
  assert.deepEqual(edit.operations, [{ type: "reorder", input: {
    nodeId: "beta", fromIndex: direction < 0 ? 1 : 0, toIndex: direction < 0 ? 0 : 2,
  } }]);
  const saved = await page.evaluate(async () => {
    const result = await exportTree({ returnDetails: true, downloadFallback: false });
    return { ok: result.ok, reason: result.reason, dirty: hasPocketUnsavedChanges(),
      phase: PocketStarlingSaveDiagnostic.getLatest()?.highestStage };
  });
  assert.deepEqual(saved, { ok: true, reason: "synced-save", dirty: false, phase: "accepted" });
  return edit.ceiling;
}

function successful(entries, route) {
  return entries.some((entry) => entry.route === route && entry.response.status() === 200);
}

test("P383 Chromium Open, Starling Save, PostgreSQL acceptance and fresh Chromium readback", { timeout: 150000 }, async (t) => {
  const db = new URL(process.env.POCKET_SYNC_DATABASE_URL);
  assert.ok(["localhost", "127.0.0.1"].includes(db.hostname)
    && ["/pocket_p382_research", "/pocket_p383_research"].includes(db.pathname),
  "Use an isolated loopback research database");
  const sql = new Pool({ connectionString: db.href });
  const server = https.createServer({
    cert: fs.readFileSync(process.env.POCKET_P382_CERT), key: fs.readFileSync(process.env.POCKET_P382_KEY),
  });
  let application, browser, prf;
  t.after(async () => {
    prf?.output.fill(0);
    try { await browser?.close(); } finally {
      if (server.listening) await new Promise((resolve) => server.close(resolve));
      try { await application?.close(); } finally { await sql.end(); }
    }
  });
  const { rows: [version] } = await sql.query("SELECT version()");
  assert.match(version.version, /^PostgreSQL 18\./);
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const origin = `https://localhost:${server.address().port}`;
  application = createSyncServerApplication({
    trustedOrigin: origin, rpId: "localhost", rpName: "Pocket P383 research",
    serviceRoot: SERVICE_ROOT, postgres: { connectionString: db.href }, credentialAlgorithms: [-7],
    ceremonyLifetimeMs: 300000, sessionLifetimeMs: 2592000000,
    recoveryProofVerifier: createUnavailableRecoveryProofVerifier(),
  });
  await application.preflight();
  // The production asset composition loads Starling. The P382 local handler
  // intentionally exercises only the earlier browser/server load checkpoint.
  server.on("request", createProductionIntegrationHandler({
    application, browserRoot: ROOT, serviceRoot: SERVICE_ROOT,
  }));
  browser = await chromium.launch({
    executablePath: process.env.CHROME_BIN, headless: true, args: ["--disable-dev-shm-usage"],
  });

  const a = await openBrowser(browser, origin);
  const activated = await activate(a.page);
  prf = activated.prf;
  assert.equal(activated.ok, true, `Activation: ${activated.reason}`);
  assert.ok(prf?.salt.length === 32 && prf.output.length === 32, "Native registration PRF is required");
  assert.ok(successful(a.responses, ROUTES.finishRegistration));
  await moveAndSave(a.page, -1);
  const h2 = await sqlState(sql, activated.pocket);
  assert.equal(h2.revision, 2);
  assert.equal(h2.rollback, 1);

  await a.page.reload();
  const openStart = a.responses.length;
  const opened = await a.page.evaluate(() => PocketSyncActiveIntegration.openExisting());
  assert.equal(opened.ok, true, `Writer Open: ${opened.reason}`);
  assert.ok(successful(a.responses.slice(openStart), ROUTES.finishAuthentication));
  const before = await contents(a.page);
  assert.deepEqual(before.map(({ id }) => id), ["beta", "alpha", "restore"]);
  const expected = [before[1], before[0], before[2]];
  const aDevice = await deviceId(a.page, activated.pocket);
  assert.ok(aDevice);

  const saveStart = a.responses.length;
  const sequence = await moveAndSave(a.page, 1);
  const writes = a.responses.slice(saveStart);
  assert.equal(writes.filter(({ route }) => route === ROUTES.conditionalUpload).length, 0);
  const casIndex = writes.findIndex(({ route }) => route === ROUTES.compareAndSetShadowHead);
  assert.equal(writes.filter(({ route }) => route === ROUTES.compareAndSetShadowHead).length, 1);
  const cas = writes[casIndex].response;
  assert.equal(cas.status(), 200);
  const sent = cas.request().postDataJSON();
  const accepted = await cas.json();
  assert.equal(accepted.operationId, sent.operationId);
  assert.equal(sent.syncedPocketId, activated.pocket);
  assert.equal(sent.expectedHead.revision, h2.revision);
  assert.equal(sent.expectedHead.sealRef, h2.seal);
  const h3 = await sqlState(sql, activated.pocket);
  assert.deepEqual(h3, { revision: 3, seal: sent.candidateSealStorageRef, rollback: 1 });
  assert.equal(accepted.head.sealRef, h3.seal);
  assert.ok(successful(writes.slice(casIndex + 1), ROUTES.readShadowHead));
  assert.ok(successful(writes.slice(casIndex + 1), ROUTES.getOpaqueObject));
  assert.deepEqual(await contents(a.page), expected);

  const b = await openBrowser(browser, origin);
  assert.equal((await b.context.cookies(origin)).length, 0);
  assert.equal(await deviceId(b.page, activated.pocket), null);
  assert.deepEqual(await contents(b.page), []);
  const reopened = await openWithSyncedFixturePasskey(b, a, prf);
  assert.equal(reopened.ok, true, `Reader Open: ${reopened.reason}`);
  assert.ok(successful(b.responses, ROUTES.finishAuthentication));
  const session = async ({ context }) => (await context.cookies(origin))
    .find(({ name }) => name === POLICY.sessionCookieName);
  const [aSession, bSession] = await Promise.all([session(a), session(b)]);
  assert.ok(aSession?.httpOnly && bSession?.httpOnly && aSession.value !== bSession.value,
    "Each browser must hold its own verified session");
  const bDevice = await deviceId(b.page, activated.pocket);
  assert.ok(bDevice && bDevice !== aDevice);
  const bHead = await b.page.evaluate(() => PocketOwnerSaveBoundary.captureOwnerSaveSession()
    .controller.getStarlingBootstrapState().head);
  assert.equal(bHead.sealRef, h3.seal);
  assert.equal(bHead.revision, h3.revision);
  assert.ok(successful(b.responses, ROUTES.getOpaqueObject));
  assert.deepEqual(await contents(b.page), expected);
  assert.equal(b.responses.filter(({ route }) => [
    ROUTES.compareAndSetShadowHead, ROUTES.conditionalUpload,
  ].includes(route)).length, 0);
  assert.deepEqual(await sqlState(sql, activated.pocket), h3);

  console.info("P383_WITNESS=" + JSON.stringify({
    node: process.version, chromium: await browser.version(), postgres: version.version.split(" ", 2).join(" "),
    pocket: activated.pocket, sequence, operationId: accepted.operationId, h2, h3,
    before: before.map(({ id }) => id), after: expected.map(({ id }) => id),
    cas: 1, wholeRecordWrites: 0, distinctSessions: true, distinctDeviceRecords: true,
    passkey: "CDP virtual authenticator, native browser assertions and real server verification",
    prfTransfers: reopened.prfTransfers, recoveryFile: "picker simulated, origin-private write",
  }));
});
