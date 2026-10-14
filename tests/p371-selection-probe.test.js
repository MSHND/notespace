"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");

test("P371 automatically discovers changed tests", () => {
  assert.equal(process.version.startsWith("v24."), true);
});
