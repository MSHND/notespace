#!/usr/bin/env node
/* Pocket repo health check. Read-only. */
const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..");
let failures = 0;

function read(rel) {
  const file = path.join(root, rel);
  try { return fs.readFileSync(file, "utf8"); }
  catch (error) { fail(rel, "missing or unreadable"); return ""; }
}

function ok(label, detail = "") {
  console.log(`ok   ${label}${detail ? " - " + detail : ""}`);
}

function fail(label, detail = "") {
  failures += 1;
  console.log(`fail ${label}${detail ? " - " + detail : ""}`);
}

function checkExists(rel) {
  if (fs.existsSync(path.join(root, rel))) ok(rel, "exists");
  else fail(rel, "missing");
}

function checkEnds(rel, ending) {
  const text = read(rel).trimEnd();
  if (!text) return;
  if (text.endsWith(ending)) ok(rel, `ends with ${ending}`);
  else fail(rel, `does not end with ${ending}`);
}

console.log("Pocket check v1");

checkEnds("index.html", "</html>");

const index = read("index.html");
if (index) {
  const scripts = Array.from(index.matchAll(/<script\s+src="([^"]+)"/g)).map(match => match[1]);
  ok("script tags", String(scripts.length));
  if (scripts.includes("js/pocket-enter-preflight.js") && scripts.includes("js/pocket-enter-copy-only.js")) {
    fail("enter handlers", "preflight and copy-only both loaded");
  } else {
    ok("enter handlers", "no duplicate known pair detected");
  }
}

checkEnds("js/pocket-node-editor-route.js", "})(window);");
checkExists("js/boot/pocket-load-manifest.js");
checkExists("js/boot/pocket-boot.js");
checkExists("js/commands/pocket-command-router.js");
checkExists("docs/PIPEWORK_RULE.md");

if (failures) {
  console.log(`Pocket check failed: ${failures}`);
  process.exit(1);
}

console.log("Pocket check passed");
