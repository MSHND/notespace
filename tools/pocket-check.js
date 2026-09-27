#!/usr/bin/env node
"use strict";

const { spawnSync } = require("node:child_process");

const files = [
  "tests/p272-main-backspace-delete-routing.test.js",
  "tests/p172-real-truth-cutover-admission.test.js",
  "tests/p270-main-save-blank-new-provisional-resolution.test.js",
];

console.log("P272a bounded proof");
console.log("Focused files:");
for (const file of files) console.log(" - " + file);

const result = spawnSync(process.execPath, ["--test", ...files], {
  stdio: "inherit",
  cwd: require("node:path").resolve(__dirname, ".."),
});

if (result.error) {
  console.error(result.error);
  process.exit(1);
}
process.exit(Number.isInteger(result.status) ? result.status : 1);
