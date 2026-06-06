#!/usr/bin/env node
/* Safe, narrow index.html mod tool. */
const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..");
const file = path.join(root, "index.html");
const command = process.argv[2];
const target = process.argv[3];
const dryRun = process.argv.includes("--dry-run");

function die(message) {
  console.error(`error: ${message}`);
  process.exit(1);
}

function readIndex() {
  const text = fs.readFileSync(file, "utf8");
  if (!text.trimEnd().endsWith("</html>")) die("index.html does not end with </html>");
  return text;
}

function writeIndex(text) {
  if (!text.trimEnd().endsWith("</html>")) die("refusing to write truncated index.html");
  if (dryRun) {
    console.log("dry run: no files changed");
    return;
  }
  fs.writeFileSync(file, text, "utf8");
}

function removeScript(src) {
  if (!src) die("missing script src");
  const text = readIndex();
  const line = `  <script src="${src}"></script>`;
  const count = text.split(line).length - 1;
  if (count !== 1) die(`expected exactly one script tag for ${src}, found ${count}`);
  const next = text.replace(line + "\n", "");
  writeIndex(next);
  console.log(`${dryRun ? "would remove" : "removed"} script: ${src}`);
}

if (command === "remove-script") {
  removeScript(target);
} else {
  die("usage: node tools/pocket-mod-index.js remove-script js/file.js [--dry-run]");
}
