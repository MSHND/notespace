"use strict";

// P386 real Chromium/PostgreSQL fixture with a native Save
// boundary and scoped read-only Pending review after authenticated restart.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const Module = require("node:module");
const filename = path.join(__dirname, "p385-authenticated-stage-bridge.test.js");
let source = fs.readFileSync(filename, "utf8");
function replaceOnce(needle, replacement) {
  assert.equal(source.split(needle).length, 2, "P385 fixture changed: " + needle.slice(0, 45));
  source = source.replace(needle, replacement);
}
replaceOnce("P385 authenticated owner encrypted title staging and fresh process readback",
  "P386 verified Pending review and native Save guard");
replaceOnce("  await a.page.addScriptTag({ path: adapter });", [
  "  await a.page.evaluate(() => { window.__p386NativeExport = exportTree; });",
  "  await a.page.addScriptTag({ path: adapter });",
].join("\n"));
replaceOnce('  const savedCredentials = await a.cdp.send("WebAuthn.getCredentials", { authenticatorId: a.authenticatorId });', [
  "  const nativeHold = await a.page.evaluate(() =>",
  "    window.__p386NativeExport({ returnDetails: true, downloadFallback: false }));",
  "  assert.deepEqual({ ok: nativeHold.ok, reason: nativeHold.reason },",
  '    { ok: false, reason: "h1-stage-research-held" });',
  '  const originalReview = await a.page.locator("#h1AuthStageReview").innerText();',
  "  assert.match(originalReview, /Current title: Research alpha/);",
  "  assert.match(originalReview, /Pending title: Fictional final title/);",
  '  await a.page.keyboard.press("F2");',
  '  assert.equal(await a.page.locator("input.labelEdit").count(), 0);',
  "  assert.equal((await a.page.evaluate(() => PocketH1AuthStageResearch.inspect())).value.stages.length, 1);",
  "  assert.deepEqual(await sqlState(sql, activated.pocket), h2);",
  '  const savedCredentials = await a.cdp.send("WebAuthn.getCredentials", { authenticatorId: a.authenticatorId });',
].join("\n"));
replaceOnce('  await input.press("Enter");', [
  '  await a.page.evaluate(() => {',
  '    const input = document.querySelector("input.labelEdit");',
  '    input.dispatchEvent(new KeyboardEvent("keydown", {',
  '      key: "Enter", bubbles: true, cancelable: true, isComposing: true',
  '    }));',
  '  });',
  '  assert.equal(await a.page.locator("input.labelEdit").count(), 1);',
  '  assert.equal((await a.page.evaluate(() => PocketH1AuthStageResearch.inspect())).value.stages.length, 0);',
  '  await input.press("Enter");',
].join("\n"));
replaceOnce("  assert.deepEqual(recovered, pending);", [
  "  assert.deepEqual(recovered, pending);",
  '  const resumedReview = await resumedBrowser.page.locator("#h1AuthStageReview").innerText();',
  "  assert.match(resumedReview, /Current title: Research alpha/);",
  "  assert.match(resumedReview, /Pending title: Fictional final title/);",
  '  assert.equal(await resumedBrowser.page.locator("#h1AuthStageReview").getAttribute("aria-label"),',
  '    "Pending change, read only");',
].join("\n"));
// P387 extensions to the already-expanded P386/P385/real-P383 browser fixture.
replaceOnce("P386 verified Pending review and native Save guard",
  "P387 repeated completion and second authorised restart");
replaceOnce('  await input.press("Enter");\n  await a.page.evaluate(() => PocketH1AuthStageResearch.flush());', [
  '  // Competing synthetic DOM Enter events at the REAL mounted editor.',
  '  // Not a claim of two trusted hardware keypresses.',
  '  await a.page.evaluate(() => {',
  '    const active = document.querySelector("input.labelEdit");',
  '    if (!active) throw new Error("Missing mounted inline editor");',
  '    for (let i = 0; i < 2; i++) active.dispatchEvent(new KeyboardEvent("keydown", {',
  '      key: "Enter", bubbles: true, cancelable: true',
  '    }));',
  '    active.dispatchEvent(new Event("blur"));',
  '  });',
  '  await a.page.evaluate(() => PocketH1AuthStageResearch.flush());',
].join("\n"));
replaceOnce('  console.info("P385_STAGE_WITNESS=" + JSON.stringify({', [
  '  // This is only a synthetic 403 inspection refusal, NOT proof of live revocation.',
  '  await resumedBrowser.page.route("**/pocket-sync/v1/account/synced-pocket/read",',
  '    route => route.fulfill({ status: 403, contentType: "application/json", body: "{}" }));',
  '  const refused = await resumedBrowser.page.evaluate(async () => {',
  '    try { await PocketH1AuthStageResearch.inspect(); return false; }',
  '    catch { return true; }',
  '  });',
  '  assert.equal(refused, true);',
  '  assert.equal(await resumedBrowser.page.locator("#h1AuthStageReview").count(), 0);',
  '  assert.equal(await resumedBrowser.page.locator("#h1AuthStageStatus").count(), 0);',
  '  assert.equal((await resumedBrowser.page.evaluate(() => exportTree())).reason, "h1-stage-research-held");',
  '  assert.equal(await resumedBrowser.page.evaluate(() => PocketH1AuthStageResearch.blocksUnstagedInline()), true);',
  '  await resumedBrowser.page.unroute("**/pocket-sync/v1/account/synced-pocket/read");',
  '  const transferred = await resumedBrowser.cdp.send("WebAuthn.getCredentials",',
  '    { authenticatorId: resumedBrowser.authenticatorId });',
  '  await resumedBrowser.cdp.send("Browser.crash").catch(() => {});',
  '  const secondBrowser = await openBrowser(browser, origin);',
  '  await secondBrowser.page.addScriptTag({ path: adapter });',
  '  assert.equal(await secondBrowser.page.evaluate(async () => {',
  '    try { await PocketH1AuthStageResearch.install(); return true; }',
  '    catch { return false; }',
  '  }), false);',
  '  assert.equal(await secondBrowser.page.locator("#h1AuthStageReview").count(), 0);',
  '  const secondOpen = await openWithSyncedFixturePasskey(secondBrowser,',
  '    { cdp: { send: async () => transferred }, authenticatorId: "synthetic-transfer" }, prf);',
  '  assert.equal(secondOpen.ok, true);',
  '  await secondBrowser.page.evaluate(() => PocketH1AuthStageResearch.install());',
  '  const secondRecovered = await secondBrowser.page.evaluate(() => PocketH1AuthStageResearch.inspect());',
  '  assert.deepEqual(secondRecovered, pending);',
  '  assert.equal(secondRecovered.value.stages.length, 1);',
  '  assert.match(await secondBrowser.page.locator("#h1AuthStageReview").innerText(),',
  '    /Pending title: Fictional final title/);',
  '  assert.deepEqual(await sqlState(sql, activated.pocket), h2);',
  '  const replayCas = [...resumedBrowser.responses, ...secondBrowser.responses]',
  '    .filter(({ route }) => route === ROUTES.compareAndSetShadowHead);',
  '  assert.equal(replayCas.length, 0);',
  '  console.info("P387_REPEAT_RECOVERY=" + JSON.stringify({',
  '    verdict: "BOUNDED PASS", revision: secondRecovered.revision, stageCount: 1,',
  '    denial: "simulated 403 inspection fails closed", repeatedBrowserCrash: true,',
  '    crossAccountRevocationProved: false, newRemoteCAS: replayCas.length',
  '  }));',
  '  console.info("P385_STAGE_WITNESS=" + JSON.stringify({',
].join("\n"));

const runner = new Module(filename, module);
runner.filename = filename;
runner.paths = module.paths;
runner._compile(source, filename);
