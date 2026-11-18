"use strict";

// P388 withheld/failed Head acceptance: keep original immutable staged evidence
// and prevent any blind retry or manufactured Saved.
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
 "P388 denied Head acceptance retains encrypted Pending and truthful uncertainty");
replaceOnce("  const savedCredentials = await a.cdp.send", [
  '  await a.page.route("**" + SERVICE_ROOT + ROUTES.compareAndSetShadowHead,',
  '    route => route.fulfill({ status: 503, contentType: "application/json", body: "{}" }));',
  "  const saveStart = a.responses.length;",
  "  const refused = await a.page.evaluate(() => PocketH1AuthStageResearch.acceptPending());",
  "  assert.equal(refused.ok, false);",
  '  assert.equal(refused.reason, "outcome-unconfirmed");',
  "  const heldStage = await a.page.evaluate(() => PocketH1AuthStageResearch.inspect());",
  "  assert.equal(heldStage.value.stages.length, 1);",
  "  assert.equal(heldStage.value.stages[0].id, pending.value.stages[0].id);",
  '  assert.equal(heldStage.value.stages[0].attempt.kind, "possibly-sent");',
  "  assert.deepEqual(heldStage.value.stages[0].operation, pending.value.stages[0].operation);",
  "  assert.deepEqual(await sqlState(sql, activated.pocket), h2);",
  '  assert.equal(await a.page.locator("#h1AuthStageStatus").textContent(),',
  '    "Save outcome unconfirmed. Editing is paused.");',
  '  assert.equal((await a.page.evaluate(() => exportTree())).reason, "h1-stage-research-held");',
  "  const firstCasCount = a.responses.slice(saveStart).filter(({ route }) =>",
  "    route === ROUTES.compareAndSetShadowHead).length;",
  "  assert.equal(firstCasCount, 1);",
  "  const repeat = await a.page.evaluate(async () => {",
  "    try { return await PocketH1AuthStageResearch.acceptPending(); }",
  '    catch { return { ok: false, reason: "held" }; }',
  "  });",
  "  assert.equal(repeat.ok, false);",
  "  assert.equal(a.responses.slice(saveStart).filter(({ route }) =>",
  "    route === ROUTES.compareAndSetShadowHead).length, firstCasCount);",
  "  console.info('P388_UNKNOWN=' + JSON.stringify({",
  '    verdict: "HOLD", stageCount: heldStage.value.stages.length,',
  "    attempted: true, repeatedCas: false, acceptedHead: h2.revision, savedClaim: false",
  "  }));",
  "  return;",
  "  const savedCredentials = await a.cdp.send",
].join("\n"));
const runner = new Module(filename, module);
runner.filename = filename;
runner.paths = module.paths;
runner._compile(source, filename);
