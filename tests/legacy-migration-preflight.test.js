"use strict";

const assert = require("node:assert/strict");
const { spawnSync } = require("node:child_process");
const { createHash } = require("node:crypto");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");
const { preflightLegacyMigration } = require("../tools/pocket-legacy-migration-preflight.js");

const TIME = "2026-01-10T00:00:00.000Z";
const EDITED = "2026-01-10T00:00:01.000Z";
const capsule = { details: "An invented source body.", editor: { paragraphs: ["Original wording."] } };
const editor = { schema: "pocket.nodeEditor.v1", mode: "outline",
  outline: [{ id: "line", text: "A separate editor line", depth: 0, order: 1, collapsed: false }] };
const deleted = { id: "removed", deletedAt: TIME };

function node(id, parentId, order) {
  return { id, parentId, label: "Repeated wording", order, source: "manual", updatedAt: TIME };
}

function document(nodes = [node("parent", "root", 1000),
  { ...node("first", "parent", 1000), details: "Separate notes", editor,
    peMigrationLegacySourcePreserved: capsule },
  node("second", "parent", 1001)], tombstones = [deleted]) {
  const guard = { schema: "pocket.guard.v1", instanceId: "fictional-instance",
    sourceFileName: "fixture.json", sourceWrittenAt: TIME, backupWrittenAt: TIME };
  return { schema: "portal.export.v1", writtenAt: TIME, exportedAt: TIME, pocketGuard: guard,
    migrationNote: "Invented fixture", mainThoughtTree: nodes, mainThoughtTreeTombstones: tombstones,
    data: { pocketGuard: structuredClone(guard), mainThoughtTree: structuredClone(nodes),
      mainThoughtTreeTombstones: structuredClone(tombstones) } };
}

function inspect(payload) {
  return preflightLegacyMigration(JSON.stringify(payload));
}

test("migration preflight refuses each known loss with a content-free diagnosis", () => {
  const cases = [
    [{ label: "A".repeat(220) + " meaningful tail" }, "label-would-change"],
    ...[8050, 125000].map(length => [
      { peMigrationLegacySourcePreserved: { body: "R".repeat(length) } }, "source-capsule-would-change",
    ]),
    [{ extra: "S".repeat(1201) }, "node-metadata-would-change"],
    [{ details: "N".repeat(4001) }, "body-would-change"],
  ];
  for (const [change, reason] of cases) {
    assert.deepEqual(inspect(document([{ ...node("first", "root", 1000), ...change }])),
      { ok: false, reason, nodeIndex: 0 });
  }
  const oversizedRoot = { ...document(), extra: { text: "R".repeat(12000) } };
  assert.equal(inspect(oversizedRoot).reason, "envelope-would-change");
  const nested = document();
  nested.data.metadata = { note: "Would be dropped from this envelope" };
  assert.equal(inspect(nested).reason, "envelope-would-change");
});

test("migration preflight rejects ambiguous JSON, broken structure and conflicting tombstones", () => {
  assert.equal(preflightLegacyMigration("{").reason, "invalid-json");
  assert.equal(preflightLegacyMigration('{"value":1,"val\\u0075e":2}').reason, "duplicate-json-key");
  assert.equal(preflightLegacyMigration('{"value":9007199254740993}').reason, "unsupported-json-value");
  assert.equal(preflightLegacyMigration('{"value":1.00000000000000001}').reason, "unsupported-json-value");
  assert.equal(preflightLegacyMigration('{"value":1e-400}').reason, "unsupported-json-value");
  const equivalentNumber = JSON.stringify({ ...document(), factor: 0.125 })
    .replace('"factor":0.125', '"factor":1.250e-1');
  assert.deepEqual(preflightLegacyMigration(equivalentNumber), { ok: true, nodes: 3, tombstones: 1 });
  for (const [input, reason] of [
    [document([node("one", "root", 1000), node("one", "root", 1001)]), "duplicate-node-id"],
    [document([node("one", "gone", 1000)]), "orphan-node"],
    [document([node("one", "two", 1000), node("two", "one", 1000)]), "parent-cycle"],
    [document([node("removed", "root", 1000)]), "live-tombstone-id"],
    [document(undefined, [deleted, deleted]), "duplicate-tombstone-id"],
    [document(undefined, [null]), "invalid-tombstone"],
  ]) assert.equal(inspect(input).reason, reason);
  const diverged = document();
  diverged.data.mainThoughtTree[0].updatedAt = EDITED;
  assert.equal(inspect(diverged).reason, "mirror-mismatch");
  const guard = document();
  guard.data.pocketGuard.instanceId = "other";
  assert.equal(inspect(guard).reason, "mirror-mismatch");
  const missing = document();
  delete missing.data.mainThoughtTreeTombstones;
  assert.equal(inspect(missing).reason, "invalid-envelope");
});

test("a fully invented 2,894-node export and 902 deletion records fit the guard", () => {
  const nodes = Array.from({ length: 2894 }, (_, index) => node(`unit-${index}`, "root", index));
  const tombstones = Array.from({ length: 902 }, (_, index) => ({ ...deleted, id: `gone-${index}` }));
  assert.deepEqual(inspect(document(nodes, tombstones)), { ok: true, nodes: 2894, tombstones: 902 });
});

async function loadBrowserHarness() {
  const filename = path.join(__dirname, "device-changes-resolution.test.js");
  const script = await fs.readFile(filename, "utf8");
  const withoutTests = script.replace('const test = require("node:test");', "const test = () => {};");
  assert.notEqual(script, withoutTests);
  return new Function("require", "__dirname", withoutTests + "\nreturn createIntegrationContext;")(require, __dirname);
}

function fileHandle(filename) {
  const name = path.basename(filename);
  return {
    name,
    async queryPermission() { return "granted"; },
    async getFile() {
      const bytes = await fs.readFile(filename);
      return new File([bytes], name, { lastModified: (await fs.stat(filename)).mtimeMs });
    },
    async createWritable() {
      let pending;
      return {
        async write(text) { pending = text; },
        async close() { await fs.writeFile(filename, pending); },
      };
    },
  };
}

test("a supported guarded copy opens, saves an edit, and reopens via Pocket's local file functions", async t => {
  const createContext = await loadBrowserHarness();
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "pocket-migration-test-"));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const original = path.join(directory, "original.json");
  const workingCopy = path.join(directory, "fixture.json");
  const before = document();
  const source = JSON.stringify(before);
  assert.deepEqual(preflightLegacyMigration(source), { ok: true, nodes: 3, tombstones: 1 });
  await fs.writeFile(original, source);
  await fs.copyFile(original, workingCopy);
  const cli = spawnSync(process.execPath, [path.join(__dirname, "../tools/pocket-legacy-migration-preflight.js"),
    original], { encoding: "utf8" });
  assert.equal(cli.status, 0, cli.stderr);
  assert.deepEqual(JSON.parse(cli.stdout), { ok: true, nodes: 3, tombstones: 1 });
  const handle = fileHandle(workingCopy);
  const writer = createContext();
  assert.equal(await writer.loadFromFileHandle(handle), true);
  const working = vm.runInContext("state", writer);
  working.nodes[0].details = "One synthetic edit";
  working.nodes[0].updatedAt = EDITED;
  working.ops.push({ type: "details" });
  assert.equal((await writer.exportTree({ returnDetails: true, downloadFallback: false })).ok, true);

  const savedText = await fs.readFile(workingCopy, "utf8");
  assert.equal(preflightLegacyMigration(savedText).ok, true);
  const saved = JSON.parse(savedText);
  const fresh = createContext();
  assert.equal(await fresh.loadFromFileHandle(fileHandle(workingCopy)), true);
  const reopened = JSON.parse(JSON.stringify(vm.runInContext("state.nodes", fresh)));
  before.mainThoughtTree[0].details = "One synthetic edit";
  before.mainThoughtTree[0].updatedAt = EDITED;
  assert.deepEqual(reopened, before.mainThoughtTree);
  assert.equal(vm.runInContext("JSON.stringify(state.tombstones)", fresh), JSON.stringify([deleted]));
  assert.deepEqual(saved.data.mainThoughtTree, reopened);
  assert.deepEqual(saved.data.pocketGuard, saved.pocketGuard);
  assert.deepEqual(saved.mainThoughtTreeTombstones, [deleted]);
  assert.deepEqual(saved.data.mainThoughtTreeTombstones, [deleted]);
  assert.equal(saved.migrationNote, before.migrationNote);
  const hash = value => createHash("sha256").update(value).digest("hex");
  assert.equal(hash(await fs.readFile(original)), hash(source));
});
