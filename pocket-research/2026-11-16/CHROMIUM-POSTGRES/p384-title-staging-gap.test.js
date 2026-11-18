"use strict";

// Negative integration witness. Reuse P383's real browser/auth/server/PG setup.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const Module = require("node:module");
const filename = path.join(__dirname, "p383-authenticated-open-save-readback.test.js");
let source = fs.readFileSync(filename, "utf8");
const anchor = "  const saveStart = a.responses.length;";
assert.equal(source.split(anchor).length, 2);
source = source.replace(
  "P383 Chromium Open, Starling Save, PostgreSQL acceptance and fresh Chromium readback",
  "P384 real authenticated title editor has no H1 durable staging integration",
);
source = source.replace(anchor, `
  await a.page.locator('[data-node-id="alpha"]').first().click();
  await a.page.keyboard.press("F2");
  const input = a.page.locator('input.labelEdit[data-edit-id="alpha"]');
  await input.waitFor({ state: "visible" });
  await input.fill("Fictional unfinished title");
  const draft = await a.page.evaluate(async () => ({
    inline: state.inlineEdit.id,
    value: document.querySelector('input.labelEdit')?.value,
    canonicalLabel: state.nodes.find(node => node.id === "alpha").label,
    ledgerLoaded: !!window.PocketH1ResearchInline,
    restartLoaded: !!window.PocketH1Restart,
    databases: (await indexedDB.databases()).map(row => row.name).sort(),
  }));
  assert.equal(draft.inline, "alpha");
  assert.equal(draft.value, "Fictional unfinished title");
  assert.equal(draft.canonicalLabel, "Research alpha");
  assert.equal(draft.ledgerLoaded, false);
  assert.equal(draft.restartLoaded, false);
  assert.deepEqual(await sqlState(sql, activated.pocket), h2);
  await input.fill("Fictional completed title");
  await input.press("Enter");
  const completed = await a.page.evaluate(() => ({
    label: state.nodes.find(node => node.id === "alpha").label,
    dirty: hasPocketUnsavedChanges(),
    operation: freezePocketStarlingOwnerWorkingSetThrough(getPocketHighestOperationSequence()),
  }));
  assert.equal(completed.label, "Fictional completed title");
  assert.equal(completed.dirty, true);
  assert.deepEqual(await sqlState(sql, activated.pocket), h2);
  console.info("P384_STAGING_GAP=" + JSON.stringify({
    verdict: "PARTIAL BLOCKED", draft, completed, head: h2,
    missing: "No H1 editor/ledger/restart adapter on the authenticated application path",
    acceptance: "Prestage and durable Pending not established. Stop before offsite Save.",
  }));
  return;
` + anchor);
const runner = new Module(filename, module);
runner.filename = filename;
runner.paths = module.paths;
runner._compile(source, filename);
