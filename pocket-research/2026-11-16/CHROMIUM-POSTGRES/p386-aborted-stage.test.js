"use strict";

// P386 negative: an aborted IndexedDB write must never become durable Pending.
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
  "P386 injected failure blocks false durable staging");
replaceOnce('  await input.fill("Fictional final title");', [
  '  await a.page.evaluate(() => {',
  '    const original = IDBObjectStore.prototype.put;',
  '    IDBObjectStore.prototype.put = function (...args) {',
  '      if (this.name === "ledger") {',
  '        IDBObjectStore.prototype.put = original;',
  '        throw new DOMException("P386 disposable aborted ledger write", "AbortError");',
  '      }',
  '      return original.apply(this, args);',
  '    };',
  '  });',
  '  await input.fill("Fictional final title");',
  '  await a.page.evaluate(() => PocketH1AuthStageResearch.flush());',
  '  const failed = await a.page.evaluate(() => PocketH1AuthStageResearch.inspect());',
  '  assert.equal(failed.value.stages.length, 0);',
  '  assert.equal(failed.value.draft.text, "Fictional first draft");',
  '  assert.equal(await a.page.locator("#h1AuthStageStatus").textContent(),',
  '    "Writing protection could not be verified. Editing is paused.");',
  '  assert.equal((await a.page.evaluate(() => exportTree())).reason, "h1-stage-research-held");',
  '  assert.deepEqual(await sqlState(sql, activated.pocket), h2);',
  '  console.info("P386_ABORT=" + JSON.stringify({',
  '    verdict: "FAILED STAGE HELD", stageCount: 0, acceptedRemoteHead: h2.revision,',
  '    protectionClaimed: false, remoteSaveAttempted: false',
  '  }));',
  '  return;',
].join("\n"));
const runner = new Module(filename, module);
runner.filename = filename;
runner.paths = module.paths;
runner._compile(source, filename);
