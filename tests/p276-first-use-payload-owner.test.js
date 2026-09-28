"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const ROOT = path.resolve(__dirname, "..");
const FIRST_USE_PATH = "js/pocket-first-use-document.js";
const IO_PATH = "js/pocket-io-browser.js";
const INDEX_PATH = "index.html";
const SW_PATH = "sw.js";
const WRITTEN_AT = "2026-09-28T05:28:00.000Z";

function source(relativePath) {
  return fs.readFileSync(path.join(ROOT, relativePath), "utf8");
}

function plain(value) {
  return value === undefined ? undefined : JSON.parse(JSON.stringify(value));
}

function firstUseHarness() {
  let nextId = 0;
  const idCalls = [];
  const context = {
    Object,
    Array,
    Error,
    makeId(prefix) {
      idCalls.push(prefix);
      nextId += 1;
      return `${prefix}_canonical_${nextId}`;
    },
    nowIso() { return "2026-09-28T00:00:00.000Z"; },
  };
  context.window = context;
  context.globalThis = context;
  vm.createContext(context);
  vm.runInContext(source(FIRST_USE_PATH), context, { filename: FIRST_USE_PATH });
  return { context, idCalls };
}

function functionSection(text, startMarker, endMarker) {
  const start = text.indexOf(startMarker);
  const end = text.indexOf(endMarker, start + startMarker.length);
  assert.ok(start >= 0, `missing ${startMarker}`);
  assert.ok(end > start, `missing ${endMarker}`);
  return text.slice(start, end);
}

test("P276 shared first-use owner reproduces the exact canonical fresh starter", () => {
  const { context, idCalls } = firstUseHarness();
  assert.deepEqual(Object.keys(context.PocketFirstUseDocument), ["buildFreshPayload"]);

  const payload = context.PocketFirstUseDocument.buildFreshPayload(WRITTEN_AT);
  const nodes = plain(payload.mainThoughtTree);
  const byLabel = new Map(nodes.map((node) => [node.label, node]));

  assert.equal(payload.schema, "portal.export.v1");
  assert.equal(payload.exportedAt, WRITTEN_AT);
  assert.equal(payload.writtenAt, WRITTEN_AT);
  assert.strictEqual(payload.mainThoughtTree, payload.data.mainThoughtTree);
  assert.deepEqual(plain(payload.data.mainThoughtTree), nodes);
  assert.deepEqual(plain(payload.mainThoughtTreeTombstones), []);
  assert.deepEqual(plain(payload.data.mainThoughtTreeTombstones), []);

  assert.deepEqual(nodes.map((node) => node.label), [
    "Things on my mind",
    "Something I want to think about",
    "Something I don’t want to forget",
    "Things I might do",
    "Copy",
    "How Copy works",
    "Put things here you want to reuse",
    "Type what you remember to find one",
    "Pocket looks in the title and notes",
    "Press Enter to copy it",
    "If it has notes, Pocket copies the notes; otherwise it copies the title",
    "A few ideas",
    "Email sign-offs",
    "Addresses and contact details",
    "Replies you send often",
  ]);

  assert.deepEqual(idCalls, Array(15).fill("node"));
  assert.equal(new Set(nodes.map((node) => node.id)).size, 15);
  assert.deepEqual(nodes.map((node) => node.id), [
    "node_canonical_1", "node_canonical_7", "node_canonical_8", "node_canonical_9",
    "node_canonical_2", "node_canonical_3", "node_canonical_10", "node_canonical_4",
    "node_canonical_11", "node_canonical_5", "node_canonical_12", "node_canonical_6",
    "node_canonical_13", "node_canonical_14", "node_canonical_15",
  ]);

  const mind = byLabel.get("Things on my mind");
  const copy = byLabel.get("Copy");
  const how = byLabel.get("How Copy works");
  const type = byLabel.get("Type what you remember to find one");
  const press = byLabel.get("Press Enter to copy it");
  const ideas = byLabel.get("A few ideas");
  assert.deepEqual(nodes.map((node) => node.parentId), [
    "root", mind.id, mind.id, "root", "root", copy.id, how.id, how.id,
    type.id, how.id, press.id, copy.id, ideas.id, ideas.id, ideas.id,
  ]);
  assert.deepEqual(nodes.map((node) => node.order), [
    1001, 1001, 1002, 1002, 1003, 1001, 1001, 1002,
    1001, 1003, 1001, 1002, 1001, 1002, 1003,
  ]);
  assert.equal(copy.copyContext, true);
  for (const node of nodes) {
    assert.equal(node.source, "manual");
    assert.equal(node.updatedAt, WRITTEN_AT);
    assert.equal(Object.hasOwn(node, "details"), false);
  }
});

test("P276 browser-file New keeps recovery local and delegates only its genuine-fresh fallback", () => {
  const io = source(IO_PATH);
  assert.doesNotMatch(io, /function buildFirstUsePocketNodes\s*\(/);
  assert.doesNotMatch(io, /function buildEmptyPocketPayload\s*\(/);
  assert.doesNotMatch(io, /Things on my mind|How Copy works|Replies you send often/);

  const payloadOwner = functionSection(io, "function payloadForNewPocketFile()", "async function createNewPocketFile()");
  assert.match(payloadOwner, /readLocalSafetySnapshot/);
  assert.match(payloadOwner, /recovery\?\.parsed\?\.payload/);
  assert.match(payloadOwner, /safeJsonClone\(recoveredPayload, 5000000\) \|\| recoveredPayload/);
  assert.match(payloadOwner, /window\.PocketFirstUseDocument\.buildFreshPayload\(nowIso\(\)\)/);

  const createOwner = io.slice(io.indexOf("async function createNewPocketFile()"));
  assert.match(createOwner, /const payload = payloadForNewPocketFile\(\);/);
  assert.doesNotMatch(createOwner, /PocketFirstUseDocument\.buildFreshPayload/);

  const firstUse = source(FIRST_USE_PATH);
  assert.doesNotMatch(firstUse, /readLocalSafetySnapshot|showSaveFilePicker|showOpenFilePicker/);
  assert.doesNotMatch(firstUse, /PocketSync|passkey|Recovery Copy|accountId|syncedPocketId/);
  assert.doesNotMatch(firstUse, /navigator|userAgent|platform/);

  const index = source(INDEX_PATH);
  const storageAt = index.indexOf('src="js/pocket-storage.js"');
  const firstUseAt = index.indexOf('src="js/pocket-first-use-document.js"');
  const ioAt = index.indexOf('src="js/pocket-io-browser.js"');
  assert.ok(storageAt >= 0 && firstUseAt > storageAt && ioAt > firstUseAt);

  const sw = source(SW_PATH);
  assert.equal((sw.match(/\.\/js\/pocket-first-use-document\.js/g) || []).length, 1);
});
