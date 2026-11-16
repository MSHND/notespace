"use strict";

/*
 * P384 | Synthetic-only private research, no real Pocket JSON/credentials.
 * Demonstrate existing portal.export.v1 normalisation limits before attempting
 * to import the 2,893-unit private local candidate. This is a NEGATIVE witness.
 * Do not use this passing test to claim a lossless importer is implemented.
 */
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const ROOT = path.resolve(__dirname, "..");

function runActualNormaliser(document) {
  const context = vm.createContext({ window: {}, console });
  for (const file of ["js/pocket-data.js", "js/pocket-import.js"]) {
    vm.runInContext(fs.readFileSync(path.join(ROOT, file), "utf8"), context, { filename: file });
  }
  context.testDocument = document;
  return JSON.parse(JSON.stringify(vm.runInContext("normaliseInput(testDocument)", context)));
}

const LEGACY_GUARD = Object.freeze({
  schema: "pocket.guard.v1", instanceId: "synthetic-only",
  sourceFileName: "fictional.json", sourceWrittenAt: "2026-11-16T00:00:00Z",
  backupWrittenAt: "2026-11-16T00:00:00Z",
});

function inputWith(label, legacySource) {
  const node = {
    id: "synthetic-1", parentId: "root", label, order: 0,
    updatedAt: "2026-11-16T00:00:00Z", source: "manual",
    peMigrationLegacySourcePreserved: { body: legacySource },
    peMigrationTrace: { sourceKind: "synthetic", exactLine: 1 },
  };
  const tombstones = [{ id: "synthetic-deleted", deletedAt: "2026-11-14T00:00:00Z" }];
  return {
    schema: "portal.export.v1", pocketGuard: LEGACY_GUARD,
    mainThoughtTree: [node], mainThoughtTreeTombstones: tombstones,
    data: { pocketGuard: LEGACY_GUARD,
      mainThoughtTree: [JSON.parse(JSON.stringify(node))],
      mainThoughtTreeTombstones: tombstones },
  };
}

test("P384 NEGATIVE: actual legacy normaliser shortens long unit labels", () => {
  const originalLabel = "A".repeat(220) + " UNIQUE SOURCE TAIL THAT MUST SURVIVE";
  const doc = inputWith(originalLabel, "safe short provenance");
  const output = runActualNormaliser(doc);
  assert.equal(output.nodes.length, 1);
  assert.equal(output.nodes[0].label.length, 220);
  assert.notEqual(output.nodes[0].label, originalLabel,
    "Expected known current loss: source-normalised label loses its tail");
  assert.equal(output.tombstones.length, 1);
  assert.equal(output.rootExtras.pocketGuard.instanceId, "synthetic-only");
  console.info("P384_NEGATIVE_LABEL_LIMIT=220");
});

test("P384 NEGATIVE: actual normaliser silently drops oversized source-provenance object", () => {
  const doc = inputWith("Synthetic preserved title", "R".repeat(8050));
  const output = runActualNormaliser(doc);
  assert.equal(output.nodes.length, 1);
  assert.ok(Object.hasOwn(doc.mainThoughtTree[0], "peMigrationLegacySourcePreserved"));
  assert.equal(Object.hasOwn(output.nodes[0], "peMigrationLegacySourcePreserved"), false,
    "Expected known current loss: >8000 char provenance object is omitted");
  assert.equal(output.nodes[0].label, doc.mainThoughtTree[0].label);
  assert.equal(output.nodes[0].peMigrationTrace.exactLine, 1);
  assert.equal(output.tombstones[0].id, "synthetic-deleted");
  console.info("P384_NEGATIVE_PROVENANCE_LIMIT=8000");
});

test("P384 CONTROL: ordinary compact source retains identity, guard, metadata and tombstone", () => {
  const doc = inputWith("Short synthetic label", "small legal source capsule");
  const output = runActualNormaliser(doc);
  assert.equal(output.nodes.length, 1);
  assert.equal(output.nodes[0].id, doc.mainThoughtTree[0].id);
  assert.equal(output.nodes[0].label, doc.mainThoughtTree[0].label);
  assert.deepEqual(output.nodes[0].peMigrationLegacySourcePreserved,
    doc.mainThoughtTree[0].peMigrationLegacySourcePreserved);
  assert.deepEqual(output.tombstones, doc.mainThoughtTreeTombstones);
  assert.deepEqual(output.rootExtras.pocketGuard, LEGACY_GUARD);
  assert.equal(output.dataExtras, null,
    "portal.export.v1 top-level normalisation does not use independent nested data extras");
  console.info("P384_BOUNDARY=synthetic-normalisation-only-NOT-private-file-import-NOT-Core");
});
