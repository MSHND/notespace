"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { createRequire } = require("node:module");

const ROOT = path.resolve(__dirname, "..");
const HARNESS_TEST = path.join(__dirname, "device-changes-resolution.test.js");
const IO_PATH = "js/pocket-io-browser.js";

function plain(value) {
  return value === undefined ? undefined : JSON.parse(JSON.stringify(value));
}

function loadBrowserHarness() {
  let code = fs.readFileSync(HARNESS_TEST, "utf8");
  const testDeclaration = 'const test = require("node:test");';
  assert.ok(code.includes(testDeclaration), "integration harness test import changed");
  code = code.replace(testDeclaration, "const test = () => {};");
  code += "\nmodule.exports = { createIntegrationContext, node };\n";
  const localRequire = createRequire(HARNESS_TEST);
  const moduleRecord = { exports: {} };
  const execute = new Function("require", "module", "exports", "__filename", "__dirname", code);
  execute(localRequire, moduleRecord, moduleRecord.exports, HARNESS_TEST, __dirname);
  return moduleRecord.exports;
}

function stateOf(context) {
  return vm.runInContext("state", context);
}

function syntheticHandle(name, initialText = "") {
  let content = String(initialText);
  const calls = { createWritable: 0, write: 0, close: 0 };
  return {
    kind: "file",
    name,
    calls,
    async queryPermission() { return "granted"; },
    async requestPermission() { return "granted"; },
    async isSameEntry(other) { return this === other; },
    async getFile() {
      return {
        name: this.name,
        async text() { return content; },
      };
    },
    async createWritable() {
      calls.createWritable += 1;
      let pending = "";
      return {
        async write(value) {
          calls.write += 1;
          pending = String(value);
        },
        async close() {
          calls.close += 1;
          content = pending;
        },
        async abort() {},
      };
    },
    read() { return content; },
  };
}

function payload(nodes, writtenAt = "2026-09-25T00:00:00.000Z") {
  const safeNodes = plain(nodes);
  return {
    schema: "portal.export.v1",
    exportedAt: writtenAt,
    writtenAt,
    mainThoughtTree: safeNodes,
    mainThoughtTreeTombstones: [],
    data: {
      mainThoughtTree: safeNodes,
      mainThoughtTreeTombstones: [],
    },
  };
}

function labelsUnder(nodes, parentId) {
  return nodes
    .filter((entry) => entry.parentId === parentId)
    .sort((left, right) => left.order - right.order)
    .map((entry) => entry.label);
}

test("P257g genuine fresh New creates the exact human nested Copy starter as ordinary nodes", async () => {
  const { createIntegrationContext } = loadBrowserHarness();
  const handle = syntheticHandle("P257g.pocket");
  const context = createIntegrationContext({ pickSaveHandle: () => handle });

  assert.equal(await context.createNewPocketFile(), true);

  const nodes = plain(stateOf(context).nodes);
  const byLabel = new Map(nodes.map((entry) => [entry.label, entry]));
  const roots = nodes
    .filter((entry) => entry.parentId === "root")
    .sort((left, right) => left.order - right.order);

  assert.deepEqual(roots.map((entry) => entry.label), [
    "Things on my mind",
    "Things I might do",
    "Copy",
  ]);
  assert.equal(roots.filter((entry) => entry.label === "Copy").length, 1);
  assert.equal(nodes.some((entry) => entry.label === "Instructions — right-click and Edit to view"), false);

  const copy = byLabel.get("Copy");
  const how = byLabel.get("How Copy works");
  const type = byLabel.get("Type what you remember to find one");
  const press = byLabel.get("Press Enter to copy it");
  const ideas = byLabel.get("A few ideas");

  assert.equal(copy.copyContext, true);
  assert.deepEqual(labelsUnder(nodes, copy.id), [
    "How Copy works",
    "A few ideas",
  ]);
  assert.deepEqual(labelsUnder(nodes, how.id), [
    "Put things here you want to reuse",
    "Type what you remember to find one",
    "Press Enter to copy it",
  ]);
  assert.deepEqual(labelsUnder(nodes, type.id), [
    "Pocket looks in the title and notes",
  ]);
  assert.deepEqual(labelsUnder(nodes, press.id), [
    "If it has notes, Pocket copies the notes; otherwise it copies the title",
  ]);
  assert.deepEqual(labelsUnder(nodes, ideas.id), [
    "Email sign-offs",
    "Addresses and contact details",
    "Replies you send often",
  ]);

  assert.equal(labelsUnder(nodes, how.id).length, 3, "How Copy works is an ordinary branch");
  assert.equal(labelsUnder(nodes, ideas.id).length, 3, "A few ideas is an ordinary branch");
  assert.equal(nodes.some((entry) => Object.prototype.hasOwnProperty.call(entry, "details")), false);

  const leaves = [
    "Put things here you want to reuse",
    "Pocket looks in the title and notes",
    "If it has notes, Pocket copies the notes; otherwise it copies the title",
    "Email sign-offs",
    "Addresses and contact details",
    "Replies you send often",
  ];
  for (const label of leaves) {
    const entry = byLabel.get(label);
    assert.ok(entry, label);
    assert.equal(context.isUnderCopyTemplates(entry.id), true, label);
    assert.deepEqual(plain(context.copyContextPayloadForNode(entry)), {
      text: label,
      kind: "label",
      preserveLines: false,
      max: 220,
    });
  }

  assert.equal(stateOf(context).ops.length, 0, "fresh New must start as a saved baseline");
  assert.equal(handle.calls.createWritable, 1);
  assert.equal(handle.calls.write, 1);
  assert.equal(handle.calls.close, 1);

  const written = JSON.parse(handle.read());
  assert.deepEqual(written.mainThoughtTree, nodes);
});

test("P257g recovery-derived New remains recovery truth without any starter teaching tree", async () => {
  const { createIntegrationContext, node } = loadBrowserHarness();
  const recovered = payload([
    node("recovered", {
      label: "Recovered only",
      details: "Recovered body",
      order: 1001,
    }),
  ]);
  const handle = syntheticHandle("Recovered.pocket");
  const context = createIntegrationContext({ pickSaveHandle: () => handle });
  context.readLocalSafetySnapshot = () => ({ parsed: { payload: recovered } });

  assert.equal(await context.createNewPocketFile(), true);
  assert.deepEqual(plain(stateOf(context).nodes).map((entry) => entry.label), ["Recovered only"]);

  const written = JSON.parse(handle.read());
  assert.deepEqual(written.mainThoughtTree.map((entry) => entry.label), ["Recovered only"]);
  assert.equal(written.mainThoughtTree.some((entry) => entry.label === "Copy"), false);
  assert.equal(written.mainThoughtTree.some((entry) => entry.label === "How Copy works"), false);
  assert.equal(written.mainThoughtTree.some((entry) => entry.label === "A few ideas"), false);
});

test("P257g keeps the P255 .pocket picker contract unchanged", () => {
  const io = fs.readFileSync(path.join(ROOT, IO_PATH), "utf8");
  const start = io.indexOf("function newPocketFilePickerOptions()");
  const end = io.indexOf("\nfunction ", start + 20);
  assert.ok(start >= 0 && end > start);
  const options = io.slice(start, end);

  assert.match(options, /suggestedName:\s*"Pocket\.pocket"/);
  assert.match(options, /description:\s*"Pocket file"/);
  assert.match(options, /"application\/json":\s*\["\.pocket"\]/);
  assert.match(options, /excludeAcceptAllOption:\s*true/);

  const createStart = io.indexOf("async function createNewPocketFile()");
  const createSource = io.slice(createStart);
  assert.match(createSource, /showSaveFilePicker\(newPocketFilePickerOptions\(\)\)/);
  assert.match(createSource, /\/\\\.pocket\$\/i\.test\(pickedName\)/);
});
