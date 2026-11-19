"use strict";
// P394-A fictional Chromium + disposable PG: an authenticated owner adoption
// must be distinguished from failed protected-stage verification. Research only.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const Module = require("node:module");
const filename = path.join(__dirname, "p383-authenticated-open-save-readback.test.js");
let source = fs.readFileSync(filename, "utf8");
function replaceOnce(a, b) {
  assert.equal(source.split(a).length, 2, "P394 fixture drift: " + a.slice(0, 70));
  source = source.replace(a, b);
}
replaceOnce("P383 Chromium Open, Starling Save, PostgreSQL acceptance and fresh Chromium readback",
  "P394 authenticated adopted owner held after stage verification failure");
replaceOnce("return { ok: result.ok, reason: result.reason, prfTransfers };",
  "return { ok: result.ok, reason: result.reason, adopted: result.adopted, editingLocked: result.editingLocked, sourceOwnerPreserved: result.sourceOwnerPreserved, stageUnverified: result.stageUnverified, prfTransfers };");
replaceOnce("  const b = await openBrowser(browser, origin);", [
  "  const b = await openBrowser(browser, origin);",
  "  await b.page.evaluate(() => { window.PocketH1ResearchAppPath = { enabled: true }; });",
].join("\n"));
replaceOnce("  assert.equal(reopened.ok, true,", "  assert.equal(reopened.ok, false,");
replaceOnce("  assert.ok(successful(b.responses, ROUTES.finishAuthentication));", [
  "  assert.equal(reopened.adopted, true, 'Actual owner was adopted');",
  "  assert.equal(reopened.sourceOwnerPreserved, false);",
  "  assert.equal(reopened.editingLocked, true);",
  "  assert.equal(reopened.stageUnverified, true);",
  "  assert.equal(reopened.reason, 'h1-research-stage-adopted-locked');",
  "  const bSafety = await b.page.evaluate(async () => ({",
  "    kind: capturePocketFileSaveSession().ownerKind,",
  "    installed: PocketOwnerSaveBoundary.hasSyncedOwner(),",
  "    held: PocketH1ResearchOpenGate.blocksEdit(),",
  "    concealed: PocketH1ResearchOpenGate.blocksView(),",
  "    editable: canModifyPocket(), visible: canShowPocketTree(),",
  "    saved: (await exportTree({ returnDetails: true, downloadFallback: false })).reason,",
  "    edit: requirePocketFileForChanges(),",
  "  }));",
  "  assert.deepEqual(bSafety, { kind: 'synced', installed: true,",
  "    held: true, concealed: true, editable: false, visible: false,",
  "    saved: 'h1-research-open-held', edit: false });",
  "  assert.equal(await b.page.locator('[data-node-id=alpha]').count(), 0);",
  "  assert.equal(b.responses.filter(({route}) => route === ROUTES.compareAndSetShadowHead).length, 0);",
  "  assert.deepEqual(await sqlState(sql, activated.pocket), h3);",
  "",
  "  // Real adapter performs its installation, then a fictional fault is injected.",
  "  const c = await openBrowser(browser, origin);",
  "  await c.page.addScriptTag({ path: path.join(ROOT, 'js/pocket-h1-auth-stage-research.js') });",
  "  await c.page.evaluate(() => {",
  "    const native = window.PocketH1AuthStageResearch;",
  "    window.PocketH1ResearchAppPath = { enabled: true, uiSaveEnabled: true };",
  "    window.PocketH1AuthStageResearch = Object.freeze({ ...native,",
  "      async install(options) { await native.install(options); throw new Error('fictional post-install failure'); },",
  "    });",
  "  });",
  "  const cOpened = await openWithSyncedFixturePasskey(c, a, prf);",
  "  assert.equal(cOpened.adopted, true);",
  "  assert.equal(cOpened.editingLocked, true);",
  "  const cSafety = await c.page.evaluate(async () => ({",
  "    owner: capturePocketFileSaveSession().ownerKind,",
  "    modify: canModifyPocket(), show: canShowPocketTree(),",
  "    save: (await exportTree({ returnDetails: true, downloadFallback: false })).reason,",
  "    review: document.getElementById('h1AuthStageReview') !== null,",
  "    status: document.getElementById('h1AuthStageStatus') !== null,",
  "  }));",
  "  assert.deepEqual(cSafety, { owner: 'synced', modify: false, show: false,",
  "    save: 'h1-research-open-held', review: false, status: false });",
  "  await c.page.evaluate(() => document.getElementById('btnExportTree').click());",
  "  await c.page.waitForTimeout(200);",
  "  assert.equal(c.responses.filter(({route}) => route === ROUTES.compareAndSetShadowHead).length, 0);",
  "  assert.deepEqual(await sqlState(sql, activated.pocket), h3);",
  "",
  "  // Fresh inspection denies entitlement, modelling a revocation race.",
  "  const d = await openBrowser(browser, origin);",
  "  await d.page.addScriptTag({ path: path.join(ROOT, 'js/pocket-h1-auth-stage-research.js') });",
  "  await d.page.evaluate(() => {",
  "    const native = window.PocketH1AuthStageResearch;",
  "    window.PocketH1ResearchAppPath = { enabled: true };",
  "    window.PocketH1AuthStageResearch = Object.freeze({ ...native,",
  "      async inspect() { throw new Error('fictional revoked at fresh check'); },",
  "    });",
  "  });",
  "  const dOpened = await openWithSyncedFixturePasskey(d, a, prf);",
  "  assert.equal(dOpened.adopted, true);",
  "  assert.equal(dOpened.editingLocked, true);",
  "  assert.equal(await d.page.evaluate(() => canModifyPocket()), false);",
  "  assert.equal((await d.page.evaluate(() => exportTree({ returnDetails: true,",
  "    downloadFallback: false }))).reason, 'h1-research-open-held');",
  "",
  "  // No research flag must preserve ordinary authenticated Open.",
  "  const e = await openBrowser(browser, origin);",
  "  const eOpened = await openWithSyncedFixturePasskey(e, a, prf);",
  "  assert.equal(eOpened.ok, true, 'Opt-out normal Open');",
  "  assert.equal(await e.page.evaluate(() => canModifyPocket()), true);",
  "  assert.equal(await e.page.evaluate(() => canShowPocketTree()), true);",
  "  assert.equal(await e.page.locator('[data-node-id=alpha]').count() > 0, true);",
  "  assert.deepEqual(await sqlState(sql, activated.pocket), h3);",
  "  console.info('P394_LOCK=' + JSON.stringify({ missing: 'adopted-locked',",
  "    postInstall: 'adopted-locked', revokedInspect: 'adopted-locked',",
  "    optOut: 'ready', unauthorisedHeadCas: 0, fictional: true }));",
  "  return;",
  "  assert.ok(successful(b.responses, ROUTES.finishAuthentication));",
].join("\n"));
const runner = new Module(filename, module);
runner.filename = filename;
runner.paths = module.paths;
runner._compile(source, filename);
