"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { createRequire } = require("node:module");

const P151 = path.join(__dirname, "p151-starling-owner-move-reorder-capture.test.js");

function loadP151Helpers() {
  let code = fs.readFileSync(P151, "utf8");
  const declaration = 'const test = require("node:test"), assert = require("node:assert/strict"), fs = require("node:fs"), path = require("node:path"), vm = require("node:vm"), { webcrypto } = require("node:crypto"), { semanticBase } = require("./helpers/starling-semantic-test.js");';
  assert.ok(code.includes(declaration), "P151 harness declaration changed");
  code = code.replace(declaration,
    'const test = () => {}, assert = require("node:assert/strict"), fs = require("node:fs"), path = require("node:path"), vm = require("node:vm"), { webcrypto } = require("node:crypto"), { semanticBase } = require("./helpers/starling-semantic-test.js");');
  code += "\nmodule.exports = { runtime, captured, movement, siblingIds, composeCapturedThroughP139 };\n";
  const localRequire = createRequire(P151);
  const moduleRecord = { exports: {} };
  new Function("require", "module", "exports", "__filename", "__dirname", code)(
    localRequire, moduleRecord, moduleRecord.exports, P151, __dirname
  );
  return moduleRecord.exports;
}

function node(id, order) {
  return { id, parentId: "root", order, label: id, updatedAt: "2026-09-02T00:00:00.000Z", source: "manual" };
}

test("P190b direct downward sibling move captures the pre-removal destination required by P139 and composes to the visible order", async () => {
  const h = loadP151Helpers();
  const initial = [node("a", 1001), node("b", 1002), node("c", 1003)];
  const context = h.runtime(initial);

  context.moveNodeWithinSiblings("a", 1);
  assert.deepEqual(h.siblingIds(context), ["b", "a", "c"]);
  const sequence = h.movement(context).seq;
  const operations = h.captured(context, sequence);
  assert.equal(operations.length, 2);
  assert.equal(operations[0].type, "payload");
  assert.deepEqual(operations[1], {
    type: "reorder",
    input: { nodeId: "a", fromIndex: 0, toIndex: 2 },
  });

  const composed = await h.composeCapturedThroughP139(initial, operations);
  assert.deepEqual(composed.relation.children.root, ["b", "a", "c"]);
});
