"use strict";
// P392 real Chromium/disposable PostgreSQL: normal UI Save button is the
// writer trigger; authenticated application open (not a manual research install)
// has already enrolled the explicit fictional research adapter. Withheld-ACK
// crash must not create a second CAS. This is NOT full product acceptance.

// Real synthetic Chromium/Postgres: allow native Head CAS to COMMIT,
// withhold the browser response and crash before local receipt settlement.
// Reopen with an independent verified passkey, reconcile EXACT candidate seal
// and native operation ID stored in encrypted owner stage, never replay CAS.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const Module = require("node:module");
const filename = path.join(__dirname, "p385-authenticated-stage-bridge.test.js");
let source = fs.readFileSync(filename, "utf8");
function replaceOnce(a, b) {
  assert.equal(source.split(a).length, 2, "P385 fixture changed: "+a.slice(0,70));
  source = source.replace(a, b);
}
replaceOnce("P385 authenticated owner encrypted title staging and fresh process readback",
  "P392 normal Save button and authenticated app Open recover exact accepted CAS");
// P392 uses actual writer authenticated Open: research adapter is preloaded
// before the existing app's normal openExisting, not manually installed after it.
// No real production asset list is modified.
replaceOnce(`  await a.page.addScriptTag({ path: adapter });
  const identity = await a.page.evaluate(() => PocketH1AuthStageResearch.install());`,
  `  // P392 writer research adapter installed by the real authenticated app Open.
  const identity = { scope: null };`);
replaceOnce("  const independent = await a.page.evaluate(async scope => {",
  "  const independent = await a.page.evaluate(async () => {");
replaceOnce('const tx = db.transaction("ledger"), lookup = tx.objectStore("ledger").get(scope);',
  'const tx = db.transaction("ledger"), lookup = tx.objectStore("ledger").getAll();');
replaceOnce("tx.oncomplete = () => resolve(lookup.result);",
  "tx.oncomplete = () => resolve(lookup.result[0]);");
replaceOnce("  }, identity.scope);", "  });");
replaceOnce("  const savedCredentials = await a.cdp.send", [
  "  {",
  "  const adapterLoaded = path.join(ROOT, 'js/pocket-h1-auth-stage-research.js');",
  '  const savedCredentials = await a.cdp.send("WebAuthn.getCredentials",',
  '    { authenticatorId: a.authenticatorId });',
  "  let notify;",
  "  const acceptedWait = new Promise(resolve => { notify = resolve; });",
  '  await a.page.exposeFunction("__p389NativeCasAccepted", value => { notify(value); });',
  "  await a.page.evaluate(() => { window.__p389HoldCas = true; });",
  "  // Real Save control click, not a direct call to acceptPending().",
  "  const pendingSave = a.page.locator('#btnExportTree').click().catch(() => null);",
  "  const attempted = await Promise.race([acceptedWait,",
  '    new Promise((_, reject) => setTimeout(() => reject(new Error("No real native CAS")), 45000))]);',
  "  assert.equal(attempted.status, 200);",
  "  assert.equal(attempted.response.operationId, attempted.request.operationId);",
  "  assert.equal(attempted.request.expectedHead.revision, h2.revision);",
  "  assert.equal(attempted.request.expectedHead.sealRef, h2.seal);",
  "  const h3 = await sqlState(sql, activated.pocket);",
  "  assert.equal(h3.revision, h2.revision + 1);",
  "  assert.equal(h3.seal, attempted.request.candidateSealStorageRef);",
  "  // PostgreSQL accepted H3 while Chromium has NOT received the 200.",
  "  // Crash NOW, before native result or local accepted receipt settlement.",
  '  await a.cdp.send("Browser.crash").catch(() => {});',
  "  await Promise.race([pendingSave, new Promise(resolve => setTimeout(resolve, 1200))]);",
  "  const reopenedBrowser = await openBrowser(browser, origin);",
  '  await reopenedBrowser.page.addScriptTag({ path: adapterLoaded });',
  "  assert.equal(await reopenedBrowser.page.evaluate(async () => {",
  "    try { await PocketH1AuthStageResearch.install(); return true; }",
  "    catch { return false; }",
  "  }), false);",
  '  assert.equal(await reopenedBrowser.page.locator("#h1AuthStageStatus").count(), 0);',
  "  await reopenedBrowser.page.evaluate(() => { window.PocketH1ResearchAppPath = { enabled: true }; });",
  "  const signed = await openWithSyncedFixturePasskey(reopenedBrowser,",
  '    { cdp: { send: async () => savedCredentials }, authenticatorId: "synthetic-transfer" }, prf);',
  '  assert.equal(signed.ok, true, "Reopened authoritative owner");',
  "  // No manual adapter.install() after this actual authenticated application Open.",
  "  const auto = await reopenedBrowser.page.evaluate(async () => {",
  "    const verified = await PocketH1AuthStageResearch.inspect();",
  "    const receipt = verified.value.acceptedReceipts?.at(-1);",
  "    return { pending: verified.value.stages.length, autoReconciliation: receipt",
  "      ? { ok: true, stageId: receipt.stageId, nativeOperationId: receipt.nativeOperationId,",
  "          superseded: false, acceptedHead: receipt.acceptedHead }",
  "      : { ok: false, reason: \"not-reconciled-by-app-open\" } };",
  "  });",
  '  assert.equal(auto.autoReconciliation?.ok, true, "Open auto recovery: "+auto.autoReconciliation?.reason);',
  "  assert.equal(auto.pending, 0);",
  "  const reconciled = auto.autoReconciliation;",
  "  assert.equal(reconciled.nativeOperationId, attempted.request.operationId);",
  "  assert.equal(reconciled.superseded, false);",
  "  assert.equal(reconciled.acceptedHead.sealRef, h3.seal);",
  "  const stored = await reopenedBrowser.page.evaluate(() => PocketH1AuthStageResearch.inspect());",
  "  assert.equal(stored.value.stages.length, 0);",
  "  assert.equal(stored.value.acceptedReceipts.length, 1);",
  "  assert.equal(stored.value.acceptedReceipts[0].nativeOperationId, attempted.request.operationId);",
  "  assert.equal(stored.value.acceptedReceipts[0].candidateSealStorageRef, h3.seal);",
  "  assert.equal(stored.value.acceptedReceipts[0].stageId, pending.value.stages[0].id);",
  "  assert.deepEqual(stored.value.acceptedReceipts[0].operation, pending.value.stages[0].operation);",
  '  assert.equal(await reopenedBrowser.page.locator("#h1AuthStageStatus").textContent(), "Saved.");',
  "  assert.equal(reopenedBrowser.responses.filter(({ route }) =>",
  "    route === ROUTES.compareAndSetShadowHead).length, 0);",
  "  assert.deepEqual(await sqlState(sql, activated.pocket), h3);",
  "  const independent = await chromium.launch({ executablePath: process.env.CHROME_BIN,",
  '    headless: true, args: ["--disable-dev-shm-usage"] });',
  "  t.after(async () => independent.close().catch(() => {}));",
  "  const b = await openBrowser(independent, origin);",
  '  const newestCredentials = await reopenedBrowser.cdp.send("WebAuthn.getCredentials",',
  "    { authenticatorId: reopenedBrowser.authenticatorId });",
  "  const opened = await openWithSyncedFixturePasskey(b,",
  '    { cdp: { send: async () => newestCredentials }, authenticatorId: "synthetic-transfer" }, prf);',
  '  assert.equal(opened.ok, true, "Second independent verified Open: "+opened.reason);',
  "  const visible = await contents(b.page);",
  "  assert.deepEqual(visible.map(node => node.id), ['beta','alpha','restore']);",
  '  assert.equal(visible.find(node => node.id === "alpha").label, "Fictional final title");',
  '  assert.equal(visible.find(node => node.id === "alpha").details, "Synthetic notes for alpha");',
  "  assert.equal(b.responses.filter(({ route }) =>",
  "    route === ROUTES.compareAndSetShadowHead).length, 0);",
  "  assert.deepEqual(await sqlState(sql, activated.pocket), h3);",
  "  // Independent B returns a lawful native edit, C authenticates and reads it.",
  "  const bSaveStart = b.responses.length;",
  "  await moveAndSave(b.page, 1);",
  "  const h4 = await sqlState(sql, activated.pocket);",
  "  assert.equal(h4.revision, h3.revision + 1);",
  "  assert.equal(b.responses.slice(bSaveStart).filter(({ route }) =>",
  "    route === ROUTES.compareAndSetShadowHead).length, 1);",
  "  assert.deepEqual((await contents(b.page)).map(row => row.id), ['alpha','beta','restore']);",
  "  const c = await openBrowser(independent, origin);",
  "  const bCredentials = await b.cdp.send('WebAuthn.getCredentials',",
  "    { authenticatorId: b.authenticatorId });",
  "  const returned = await openWithSyncedFixturePasskey(c,",
  "    { cdp: { send: async () => bCredentials }, authenticatorId: 'synthetic-transfer' }, prf);",
  "  assert.equal(returned.ok, true, 'Return edit independently read: ' + returned.reason);",
  "  const returnedNodes = await contents(c.page);",
  "  assert.deepEqual(returnedNodes.map(row => row.id), ['alpha','beta','restore']);",
  "  assert.equal(returnedNodes.find(row => row.id === 'alpha').label, 'Fictional final title');",
  "  assert.deepEqual(await sqlState(sql, activated.pocket), h4);",
  "  assert.equal(c.responses.filter(({route}) => route === ROUTES.compareAndSetShadowHead).length,0);",
  '  console.info("P392_UI_SAVE_LOST_ACK=" + JSON.stringify({',
  "    stageId: reconciled.stageId, nativeOperationId: reconciled.nativeOperationId,",
  "    acceptedHead: h3.revision, previousHead: h2.revision,",
  '    serverAcceptedBeforeCrash: true, browserAcknowledgementDelivered: false,',
  "    exactCandidateSeal: h3.seal, independentlyAuthenticatedReadback: true,",
  "    replayCAS: 0, encryptedReceipt: true",
  "  }));",
  "  return;",
  "  }",
  "  const savedCredentials = await a.cdp.send",
].join("\n"));
// Inject this change into the INNER P385 fixture's P383 expansion, not
// into the outer P389 file. That guarantees the browser fetch wrapper is
// installed before the actual app/transport scripts capture window.fetch.
replaceOnce("const runner = new Module(filename, module);", "source = source.replace(\"  const page = await context.newPage();\", \"  await context.addInitScript({ content: \\\"(() => {\\\\n  const native = window.fetch.bind(window);\\\\n  window.fetch = async (input, options) => {\\\\n    const response = await native(input, options);\\\\n    const target = typeof input === 'string' ? input : input?.url;\\\\n    if (window.__p389HoldCas && typeof target === 'string'\\\\n      && target.includes('/pockets/head/compare-and-set')) {\\\\n      const request = JSON.parse(options.body);\\\\n      const acceptedResponse = await response.clone().json();\\\\n      await window.__p389NativeCasAccepted({ request, response: acceptedResponse, status: response.status });\\\\n      return new Promise(() => {});\\\\n    }\\\\n    return response;\\\\n  };\\\\n})();\\\" });\\n  const page = await context.newPage();\");\nconst runner = new Module(filename, module);");
replaceOnce("const runner = new Module(filename, module);\nrunner.filename = filename;", "source = source.replace(\"  const opened = await a.page.evaluate(() => PocketSyncActiveIntegration.openExisting());\", \"  await a.page.addScriptTag({ path: path.join(ROOT, \\\"js/pocket-h1-auth-stage-research.js\\\") });\\n  await a.page.evaluate(() => { window.PocketH1ResearchAppPath = { enabled: true, uiSaveEnabled: true }; });\\n  const opened = await a.page.evaluate(() => PocketSyncActiveIntegration.openExisting());\");\nconst runner = new Module(filename, module);\nrunner.filename = filename;");
const runner = new Module(filename, module);
runner.filename = filename;
runner.paths = module.paths;
runner._compile(source, filename);
