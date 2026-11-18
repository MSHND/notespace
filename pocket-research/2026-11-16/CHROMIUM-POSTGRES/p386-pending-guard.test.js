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
replaceOnce("  assert.deepEqual(recovered, pending);", [
  "  assert.deepEqual(recovered, pending);",
  '  const resumedReview = await resumedBrowser.page.locator("#h1AuthStageReview").innerText();',
  "  assert.match(resumedReview, /Current title: Research alpha/);",
  "  assert.match(resumedReview, /Pending title: Fictional final title/);",
  '  assert.equal(await resumedBrowser.page.locator("#h1AuthStageReview").getAttribute("aria-label"),',
  '    "Pending change, read only");',
].join("\n"));
const runner = new Module(filename, module);
runner.filename = filename;
runner.paths = module.paths;
runner._compile(source, filename);
