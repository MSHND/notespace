"use strict";

// P388 positive. Expands the existing authenticated, source-served P385 fixture
// and admits its real encrypted Pending operation through native Core/Starling
// Save against a disposable PostgreSQL instance. No production credentials.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const Module = require("node:module");
const filename = path.join(__dirname, "p385-authenticated-stage-bridge.test.js");
let source = fs.readFileSync(filename, "utf8");
function replaceOnce(a,b) {
  assert.equal(source.split(a).length, 2, "P385 fixture changed: "+a.slice(0,70));
  source = source.replace(a,b);
}
replaceOnce("P385 authenticated owner encrypted title staging and fresh process readback",
 "P388 verified pending-to-native-offsite acceptance and independent browser readback");
replaceOnce("  const savedCredentials = await a.cdp.send", [
  "  const saveStart = a.responses.length;",
  "  const settled = await a.page.evaluate(() => PocketH1AuthStageResearch.acceptPending());",
  '  assert.equal(settled.ok, true, "Native pending-to-CAS acceptance: "+settled.reason);',
  '  assert.equal(settled.reason, "verified-saved");',
  "  assert.equal(settled.stageId, pending.value.stages[0].id);",
  '  assert.equal(await a.page.locator("#h1AuthStageStatus").textContent(), "Saved.");',
  '  assert.equal(await a.page.locator("#h1AuthStageReview").count(), 0);',
  "  const after = await a.page.evaluate(() => PocketH1AuthStageResearch.inspect());",
  "  assert.equal(after.value.stages.length, 0);",
  "  assert.equal(after.value.acceptedReceipts.length, 1);",
  "  assert.equal(after.value.acceptedReceipts[0].stageId, pending.value.stages[0].id);",
  "  assert.deepEqual(after.value.acceptedReceipts[0].operation, pending.value.stages[0].operation);",
  "  const h3 = await sqlState(sql, activated.pocket);",
  "  assert.equal(h3.revision, h2.revision + 1);",
  "  assert.equal(after.value.acceptedReceipts[0].acceptedHead.revision, h3.revision);",
  "  assert.equal(after.value.acceptedReceipts[0].acceptedHead.sealRef, h3.seal);",
  "  const writes = a.responses.slice(saveStart);",
  "  const casWrites = writes.filter(({ route }) => route === ROUTES.compareAndSetShadowHead);",
  "  assert.equal(casWrites.length, 1);",
  "  const request = casWrites[0].response.request().postDataJSON();",
  "  const reply = await casWrites[0].response.json();",
  "  assert.equal(casWrites[0].response.status(), 200);",
  "  assert.equal(reply.operationId, request.operationId);",
  "  assert.equal(request.expectedHead.revision, h2.revision);",
  "  assert.equal(request.expectedHead.sealRef, h2.seal);",
  "  assert.equal(request.candidateSealStorageRef, h3.seal);",
  "  assert.equal(writes.filter(({ route }) => route === ROUTES.conditionalUpload).length, 0);",
  "  assert.equal(reply.head.sealRef, h3.seal);",
  '  const independentBrowser = await chromium.launch({ executablePath: process.env.CHROME_BIN,',
  '    headless: true, args: ["--disable-dev-shm-usage"] });',
  "  t.after(async () => independentBrowser.close().catch(() => {}));",
  "  const b = await openBrowser(independentBrowser, origin);",
  "  assert.equal((await b.context.cookies(origin)).length, 0);",
  "  assert.equal(await deviceId(b.page, activated.pocket), null);",
  "  const fresh = await openWithSyncedFixturePasskey(b, a, prf);",
  '  assert.equal(fresh.ok, true, "Fresh authenticated independent device Open");',
  "  const nodes = await contents(b.page);",
  "  assert.deepEqual(nodes.map(node => node.id), ['beta', 'alpha', 'restore']);",
  '  assert.equal(nodes.find(node => node.id === "alpha").label, "Fictional final title");',
  '  assert.equal(nodes.find(node => node.id === "alpha").details, "Synthetic notes for alpha");',
  "  assert.deepEqual(await sqlState(sql, activated.pocket), h3);",
  "  const bHead = await b.page.evaluate(() => PocketOwnerSaveBoundary.captureOwnerSaveSession()",
  "    .controller.getStarlingBootstrapState().head);",
  "  assert.equal(bHead.sealRef, h3.seal);",
  "  assert.equal(bHead.revision, h3.revision);",
  "  assert.equal(b.responses.filter(({ route }) => route === ROUTES.compareAndSetShadowHead).length, 0);",
  "  console.info('P388_ACCEPTED=' + JSON.stringify({",
  "    stageId: settled.stageId, revisionBefore: h2.revision, revisionAfter: h3.revision,",
  "    cas: casWrites.length, operationId: reply.operationId, acceptedReceipt: true,",
  "    stageSettled: true, independentAuthorisedDevice: true, wholeRecordUploads: 0",
  "  }));",
  "  return;",
  "  const savedCredentials = await a.cdp.send",
].join("\n"));
const runner = new Module(filename, module);
runner.filename = filename;
runner.paths = module.paths;
runner._compile(source, filename);
