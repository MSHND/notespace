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
const OPENING_PATH = "js/pocket-file-opening.js";


function source(relativePath) {
  return fs.readFileSync(path.join(ROOT, relativePath), "utf8");
}

function plain(value) {
  return value === undefined ? undefined : JSON.parse(JSON.stringify(value));
}

function loadBrowserHarness() {
  let code = fs.readFileSync(HARNESS_TEST, "utf8");
  const testDeclaration = 'const test = require("node:test");';
  assert.ok(code.includes(testDeclaration), "P255 harness test import changed");
  code = code.replace(testDeclaration, "const test = () => {};");
  code += "\nmodule.exports = { createIntegrationContext, resetIntegrationState, node };\n";
  const localRequire = createRequire(HARNESS_TEST);
  const moduleRecord = { exports: {} };
  const execute = new Function("require", "module", "exports", "__filename", "__dirname", code);
  execute(localRequire, moduleRecord, moduleRecord.exports, HARNESS_TEST, __dirname);
  return moduleRecord.exports;
}

function stateOf(context) {
  return vm.runInContext("state", context);
}

function payload(nodes, writtenAt = "2026-09-22T00:00:00.000Z") {
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

function syntheticHandle(name, initialText = "") {
  let content = String(initialText);
  const calls = {
    getFile: 0,
    createWritable: 0,
    write: 0,
    close: 0,
    abort: 0,
  };
  const handle = {
    kind: "file",
    name,
    calls,
    async queryPermission() { return "granted"; },
    async requestPermission() { return "granted"; },
    async isSameEntry(other) { return this === other; },
    async getFile() {
      calls.getFile += 1;
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
        async abort() {
          calls.abort += 1;
        },
      };
    },
    read() { return content; },
  };
  return handle;
}

function captureSavePickerOptions(context) {
  const original = context.showSaveFilePicker;
  const captured = [];
  context.showSaveFilePicker = async function showSaveFilePicker(options) {
    captured.push(plain(options));
    return original.call(this, options);
  };
  return captured;
}

function starterNodes(context) {
  return plain(stateOf(context).nodes);
}

test("P255 New owns the .pocket picker contract and valid semantic-name handle adoption", async () => {
  const { createIntegrationContext } = loadBrowserHarness();
  const handle = syntheticHandle("Holiday planning.pocket");
  const context = createIntegrationContext({ pickSaveHandle: () => handle });
  const pickerCalls = captureSavePickerOptions(context);

  assert.equal(await context.createNewPocketFile(), true);
  assert.equal(pickerCalls.length, 1);
  assert.deepEqual(pickerCalls[0], {
    suggestedName: "Pocket.pocket",
    types: [{
      description: "Pocket file",
      accept: { "application/json": [".pocket"] },
    }],
    excludeAcceptAllOption: true,
  });

  assert.equal(handle.calls.createWritable, 1);
  assert.equal(handle.calls.write, 1);
  assert.equal(handle.calls.close, 1);
  const session = context.capturePocketFileSaveSession();
  assert.equal(session.handle, handle);
  assert.equal(session.ownerKind, "json");
  assert.equal(session.displayName, "Holiday planning.pocket");
  assert.equal(session.writable, true);
  assert.equal(stateOf(context).source.fileName, "Holiday planning.pocket");
  assert.equal(stateOf(context).ops.length, 0, "New establishes a saved baseline rather than dirtying the document");
});

test("P255 extensionless returned handle is rejected before write/adoption and keeps current session unchanged", async () => {
  const { createIntegrationContext, node } = loadBrowserHarness();
  const existingPayload = payload([node("existing", { label: "Existing truth" })]);
  const existing = syntheticHandle("Existing.json", JSON.stringify(existingPayload));
  const invalid = syntheticHandle("Holiday planning");
  const context = createIntegrationContext({ pickSaveHandle: () => invalid });

  assert.equal(await context.loadFromFileHandle(existing, { displayName: existing.name }), true);
  const beforeSession = context.capturePocketFileSaveSession();
  const beforeNodes = plain(stateOf(context).nodes);
  const beforeSource = plain(stateOf(context).source);
  const pickerCalls = captureSavePickerOptions(context);

  assert.equal(await context.createNewPocketFile(), false);
  assert.equal(pickerCalls.length, 1);
  assert.equal(invalid.calls.createWritable, 0);
  assert.equal(invalid.calls.write, 0);

  const afterSession = context.capturePocketFileSaveSession();
  assert.equal(afterSession.id, beforeSession.id);
  assert.equal(afterSession.handle, beforeSession.handle);
  assert.equal(afterSession.displayName, beforeSession.displayName);
  assert.deepEqual(plain(stateOf(context).nodes), beforeNodes);
  assert.deepEqual(plain(stateOf(context).source), beforeSource);

  const lastStatus = context.__surfaceCalls.statuses.at(-1);
  assert.equal(lastStatus.message, "Pocket could not create a valid Pocket file here. Try New again.");
  assert.doesNotMatch(lastStatus.message, /add (?:an? )?extension|type .*\.pocket|add .*\.pocket/i);
});

test("P255 returned .POCKET suffix is accepted case-insensitively", async () => {
  const { createIntegrationContext } = loadBrowserHarness();
  const handle = syntheticHandle("Caps.POCKET");
  const context = createIntegrationContext({ pickSaveHandle: () => handle });

  assert.equal(await context.createNewPocketFile(), true);
  assert.equal(handle.calls.write, 1);
  assert.equal(context.capturePocketFileSaveSession().displayName, "Caps.POCKET");
});

test("P255/P257g genuine starter preserves old roots and uses ordinary nested Copy guidance", async () => {
  const { createIntegrationContext } = loadBrowserHarness();
  const handle = syntheticHandle("Starter.pocket");
  const context = createIntegrationContext({ pickSaveHandle: () => handle });

  assert.equal(await context.createNewPocketFile(), true);
  const nodes = starterNodes(context);
  const byLabel = new Map(nodes.map((entry) => [entry.label, entry]));
  const roots = nodes
    .filter((entry) => entry.parentId === "root")
    .sort((left, right) => left.order - right.order);

  assert.deepEqual(roots.map((entry) => entry.label), [
    "Things on my mind",
    "Things I might do",
    "Copy",
  ]);

  const copyRoot = byLabel.get("Copy");
  const how = byLabel.get("How Copy works");
  const put = byLabel.get("Put things here you want to reuse");
  const type = byLabel.get("Type what you remember to find one");
  const looks = byLabel.get("Pocket looks in the title and notes");
  const press = byLabel.get("Press Enter to copy it");
  const notes = byLabel.get("If it has notes, Pocket copies the notes; otherwise it copies the title");
  const ideas = byLabel.get("A few ideas");
  const email = byLabel.get("Email sign-offs");
  const addresses = byLabel.get("Addresses and contact details");
  const replies = byLabel.get("Replies you send often");

  assert.equal(copyRoot.copyContext, true);
  assert.notEqual(copyRoot.id, "m1");
  assert.equal(how.parentId, copyRoot.id);
  assert.equal(ideas.parentId, copyRoot.id);
  assert.equal(put.parentId, how.id);
  assert.equal(type.parentId, how.id);
  assert.equal(press.parentId, how.id);
  assert.equal(looks.parentId, type.id);
  assert.equal(notes.parentId, press.id);
  assert.equal(email.parentId, ideas.id);
  assert.equal(addresses.parentId, ideas.id);
  assert.equal(replies.parentId, ideas.id);
  assert.deepEqual(
    [how, ideas].map((entry) => entry.order),
    [1001, 1002]
  );
  assert.deepEqual(
    [put, type, press].map((entry) => entry.order),
    [1001, 1002, 1003]
  );
  assert.deepEqual(
    [email, addresses, replies].map((entry) => entry.order),
    [1001, 1002, 1003]
  );
  assert.equal(nodes.some((entry) => entry.label === "Instructions — right-click and Edit to view"), false);
  assert.equal(nodes.some((entry) => Object.prototype.hasOwnProperty.call(entry, "details")), false);

  assert.equal(
    context.isCopyContextMarkerNode({ ...copyRoot, label: "Renamed context" }),
    true,
    "explicit copyContext must be sufficient without the Copy label fallback"
  );
  for (const entry of [put, looks, notes, email, addresses, replies]) {
    assert.equal(context.isUnderCopyTemplates(entry.id), true, entry.label);
    assert.deepEqual(plain(context.copyContextPayloadForNode(entry)), {
      text: entry.label,
      kind: "label",
      preserveLines: false,
      max: 220,
    });
  }

  assert.equal(stateOf(context).ops.length, 0, "fresh starter must remain a saved baseline");
  const written = JSON.parse(handle.read());
  assert.equal(written.mainThoughtTree.filter((entry) => entry.label === "Copy").length, 1);
  assert.equal(
    written.mainThoughtTree.some((entry) => entry.label === "Instructions — right-click and Edit to view"),
    false
  );
});

test("P255 recovery-derived New payload is preserved without injecting starter Copy nodes", async () => {
  const { createIntegrationContext, node } = loadBrowserHarness();
  const recoveredPayload = payload([
    node("recovered", {
      label: "Recovered only",
      details: "Recovered body",
      order: 1001,
    }),
  ]);
  const handle = syntheticHandle("Recovered.pocket");
  const context = createIntegrationContext({ pickSaveHandle: () => handle });

  context.readLocalSafetySnapshot = () => ({ parsed: { payload: recoveredPayload } });

  assert.equal(await context.createNewPocketFile(), true);
  const nodes = starterNodes(context);
  assert.deepEqual(nodes.map((entry) => entry.label), ["Recovered only"]);
  assert.equal(nodes.some((entry) => entry.label === "Copy"), false);
  assert.equal(nodes.some((entry) => entry.label === "How Copy works"), false);
  assert.equal(nodes.some((entry) => entry.label === "A few ideas"), false);
  assert.equal(nodes.some((entry) => entry.label === "Instructions — right-click and Edit to view"), false);

  const written = JSON.parse(handle.read());
  assert.deepEqual(written.mainThoughtTree.map((entry) => entry.label), ["Recovered only"]);
});

test("P255 keeps existing .json/.pocket/.vault opening compatibility and JSON-only generic save owner unchanged", () => {
  const opening = source(OPENING_PATH);
  const io = source(IO_PATH);

  assert.match(opening, /accept:\s*\{\s*"application\/json":\s*\["\.json", "\.pocket", "\.vault"\]\s*\}/);
  assert.match(io, /function jsonFilePickerOptions\(\)[\s\S]*?\["\.json"\][\s\S]*?function newPocketFilePickerOptions/);
  assert.match(io, /function newPocketFilePickerOptions\(\)[\s\S]*?suggestedName:\s*"Pocket\.pocket"[\s\S]*?\["\.pocket"\][\s\S]*?excludeAcceptAllOption:\s*true/);

  const writeTruthSection = io.slice(
    io.indexOf("async function writeTruthFile"),
    io.indexOf("function buildFirstUsePocketNodes")
  );
  assert.match(writeTruthSection, /jsonFilePickerOptions\(\)/);
  assert.doesNotMatch(writeTruthSection, /newPocketFilePickerOptions\(\)/);
});
