"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const Module = require("node:module");
const filename = path.join(__dirname, "p383-authenticated-open-save-readback.test.js");
const profile = fs.mkdtempSync(path.join(os.tmpdir(), "pocket-p385-"));
const contexts = [];
let source = fs.readFileSync(filename, "utf8");
source = source.replace("const { chromium } = require(\"playwright-core\");",
  "const { chromium } = require(\"playwright-core\");\nconst contexts = globalThis.__p385.contexts;");
globalThis.__p385 = { profile, contexts };
source = source.replace(/browser = await chromium.launch\(\{[\s\S]*?\n  \}\);/, `
  browser = {
    async newContext(options) {
      const context = await chromium.launchPersistentContext(globalThis.__p385.profile, {
        ...options, executablePath: process.env.CHROME_BIN, headless: true,
        args: ["--disable-dev-shm-usage"],
      });
      contexts.push(context);
      return context;
    },
    async close() {
      for (const context of contexts) await context.close().catch(() => {});
      fs.rmSync(globalThis.__p385.profile, { recursive: true, force: true });
    },
  };`);
source = source.replace("P383 Chromium Open, Starling Save, PostgreSQL acceptance and fresh Chromium readback",
  "P385 authenticated owner encrypted title staging and fresh process readback");
const anchor = "  const saveStart = a.responses.length;";
assert.equal(source.split(anchor).length, 2);
source = source.replace(anchor, `
  const adapter = path.join(ROOT, "js/pocket-h1-auth-stage-research.js");
  await a.page.addScriptTag({ path: adapter });
  const identity = await a.page.evaluate(() => PocketH1AuthStageResearch.install());
  await a.page.locator('[data-node-id="alpha"]').first().click();
  await a.page.keyboard.press("F2");
  const input = a.page.locator('input.labelEdit[data-edit-id="alpha"]');
  await input.fill("Fictional first draft");
  await a.page.evaluate(() => PocketH1AuthStageResearch.flush());
  const first = await a.page.evaluate(() => PocketH1AuthStageResearch.inspect());
  assert.equal(first.value.draft.text, "Fictional first draft");
  await input.fill("Fictional final title");
  await a.page.evaluate(() => PocketH1AuthStageResearch.flush());
  const second = await a.page.evaluate(() => PocketH1AuthStageResearch.inspect());
  assert.ok(second.value.draft.version > first.value.draft.version);
  assert.equal(second.value.stages.length, 0);
  await input.press("Enter");
  await a.page.evaluate(() => PocketH1AuthStageResearch.flush());
  const pending = await a.page.evaluate(() => PocketH1AuthStageResearch.inspect());
  assert.equal(pending.value.draft, null);
  assert.equal(pending.value.stages.length, 1);
  assert.equal(pending.value.stages[0].draft.text, "Fictional final title");
  assert.equal(pending.value.stages[0].baseHead.sealRef, h2.seal);
  assert.equal(await a.page.locator("#h1AuthStageStatus").textContent(), "Pending offsite work needs review.");
  assert.equal((await a.page.evaluate(() => exportTree())).reason, "h1-stage-research-held");
  assert.deepEqual(await sqlState(sql, activated.pocket), h2);
  const independent = await a.page.evaluate(async scope => {
    const record = await PocketSyncDeviceStore.readPocket(
      PocketOwnerSaveBoundary.captureOwnerSaveSession().controllerSession.syncedPocketId);
    const db = await new Promise((resolve, reject) => {
      const opening = indexedDB.open("pocket.h1.auth-stage.research.v1");
      opening.onsuccess = () => resolve(opening.result); opening.onerror = () => reject(opening.error);
    });
    const row = await new Promise((resolve, reject) => {
      const tx = db.transaction("ledger"), lookup = tx.objectStore("ledger").get(scope);
      tx.oncomplete = () => resolve(lookup.result); tx.onerror = () => reject(tx.error);
    });
    db.close();
    const value = await PocketSyncCrypto.openContent(row.record, record.deviceWrappingKey, row.context);
    return { fields: Object.keys(row), value, nonextractable: !record.deviceWrappingKey.extractable };
  }, identity.scope);
  assert.equal(independent.nonextractable, true);
  assert.deepEqual(independent.fields.sort(), ["context", "record"]);
  assert.deepEqual(independent.value, pending.value);
  const savedCredentials = await a.cdp.send("WebAuthn.getCredentials", { authenticatorId: a.authenticatorId });
  await a.cdp.send("Browser.crash").catch(() => {});
  const reopened = await openBrowser(browser, origin);
  await reopened.page.addScriptTag({ path: adapter });
  assert.equal(await reopened.page.evaluate(async () => {
    try { await PocketH1AuthStageResearch.install(); return true; } catch { return false; }
  }), false);
  assert.equal(await reopened.page.locator("#h1AuthStageStatus").count(), 0);
  const signed = await openWithSyncedFixturePasskey(reopened,
    { cdp: { send: async () => savedCredentials }, authenticatorId: "synthetic-transfer" }, prf);
  assert.equal(signed.ok, true);
  await reopened.page.evaluate(() => PocketH1AuthStageResearch.install());
  const recovered = await reopened.page.evaluate(() => PocketH1AuthStageResearch.inspect());
  assert.deepEqual(recovered, pending);
  assert.equal((await contents(reopened.page)).find(row => row.id === "alpha").label, "Research alpha");
  assert.equal((await reopened.page.evaluate(() => exportTree())).reason, "h1-stage-research-held");
  assert.deepEqual(await sqlState(sql, activated.pocket), h2);
  console.info("P385_STAGE_WITNESS=" + JSON.stringify({
    verdict: "AUTHENTICATED ENCRYPTED STAGING PROVED (synthetic)",
    stageCount: recovered.value.stages.length, revision: recovered.revision,
    head: h2, keyExported: false, crash: "Browser.crash", remoteSaveAttempted: false,
  }));
  return;
` + anchor);
const runner = new Module(filename, module);
runner.filename = filename;
runner.paths = module.paths;
runner._compile(source, filename);
