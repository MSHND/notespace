#!/usr/bin/env node
/* Safe, narrow index.html mod tool. */
const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..");
const file = path.join(root, "index.html");
const command = process.argv[2];
const target = process.argv[3];
const insert = process.argv[4];
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

function scriptLine(src) {
  return `  <script src="${src}"></script>`;
}

function countOccurrences(text, needle) {
  return text.split(needle).length - 1;
}

function removeScript(src) {
  if (!src) die("missing script src");
  const text = readIndex();
  const line = scriptLine(src);
  const count = countOccurrences(text, line);
  if (count !== 1) die(`expected exactly one script tag for ${src}, found ${count}`);
  const next = text.replace(line + "\n", "");
  writeIndex(next);
  console.log(`${dryRun ? "would remove" : "removed"} script: ${src}`);
}

function insertScriptAfter(anchorSrc, insertSrc) {
  if (!anchorSrc) die("missing anchor script src");
  if (!insertSrc) die("missing script src to insert");
  const text = readIndex();
  const anchorLine = scriptLine(anchorSrc);
  const insertLine = scriptLine(insertSrc);
  const anchorCount = countOccurrences(text, anchorLine);
  const insertCount = countOccurrences(text, insertLine);
  if (insertCount !== 0) die(`script tag already present for ${insertSrc}`);
  if (anchorCount !== 1) die(`expected exactly one anchor script tag for ${anchorSrc}, found ${anchorCount}`);
  const next = text.replace(anchorLine + "\n", `${anchorLine}\n${insertLine}\n`);
  writeIndex(next);
  console.log(`${dryRun ? "would insert" : "inserted"} script: ${insertSrc} after ${anchorSrc}`);
}

if (command === "remove-script") {
  removeScript(target);
} else if (command === "insert-script-after") {
  insertScriptAfter(target, insert);
} else {
  die("usage: node tools/pocket-mod-index.js remove-script js/file.js [--dry-run]\n       node tools/pocket-mod-index.js insert-script-after js/anchor.js js/file.js [--dry-run]");
}
