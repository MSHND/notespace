"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const ROOT = path.resolve(__dirname, "..");
const CURRENT_CODEC_SCRIPTS = [
  "js/pocket-state.js",
  "js/pocket-data.js",
  "js/pocket-outline-persistence-policy.js",
  "js/pocket-editor-metadata.js",
  "js/pocket-pe-import-preserve.js",
  "js/pocket-storage.js",
  "js/pocket-import.js",
];
const SHADOW = "js/pocket-starling-shadow.js";

function source(file) {
  return fs.readFileSync(path.join(ROOT, file), "utf8");
}

function plain(value) {
  return JSON.parse(JSON.stringify(value));
}

function run(context, file) {
  vm.runInContext(source(file), context, { filename: file });
}

function createContext() {
  const context = {
    URL,
    Date,
    Math,
    JSON,
    Map,
    Set,
    Object,
    Array,
    String,
    Number,
    Boolean,
    Promise,
    console: { log() {}, info() {}, warn() {}, error() {} },
    localStorage: { getItem() { return null; }, setItem() {}, removeItem() {} },
    document: {
      body: { classList: { add() {}, remove() {}, toggle() {} } },
      getElementById() { return null; },
      addEventListener() {},
    },
    navigator: { clipboard: {} },
    location: { href: "https://example.test/index.html" },
    indexedDB: null,
    open() { return null; },
    close() {},
    setTimeout() { return 1; },
    clearTimeout() {},
    requestAnimationFrame(callback) { if (typeof callback === "function") callback(); return 1; },
    cancelAnimationFrame() {},
  };
  context.window = context;
  context.globalThis = context;
  vm.createContext(context);
  CURRENT_CODEC_SCRIPTS.forEach((file) => run(context, file));
  run(context, SHADOW);
  return context;
}

function normalise(context, raw) {
  context.__p106Raw = plain(raw);
  return vm.runInContext("normaliseInput(__p106Raw)", context);
}

function canonical(context, norm, writtenAt) {
  context.__p106Norm = norm;
  context.__p106WrittenAt = writtenAt;
  return vm.runInContext("buildCanonicalPocketPayload(__p106Norm, { writtenAt: __p106WrittenAt })", context);
}

function representativePortalInput() {
  return {
    schema: "portal.mtt.web.v1",
    writtenAt: "2026-08-28T00:00:00.000Z",
    rootMarker: { release: "P106", values: [1, true, null] },
    data: {
      dataMarker: { nested: "kept" },
      mainThoughtTreeTombstones: [{ id: "gone", deletedAt: "2026-08-27T00:00:00.000Z" }],
      mainThoughtTree: [
        {
          id: "root-a",
          parentId: "root",
          label: "Root A",
          order: 1000,
          updatedAt: "2026-08-28T00:00:00.000Z",
          source: "manual",
          details: "Root details",
          urgent: true,
          task: { status: "in_progress", tags: ["P106"] },
          customNode: { keeps: ["all", "fields"] },
          editor: {
            schema: "pocket.nodeEditor.v1",
            mode: "outline",
            outline: [
              { id: "row-a", text: "First row", depth: 0, collapsed: false },
              { id: "row-b", text: "Child row", depth: 1, collapsed: true },
            ],
          },
        },
        {
          id: "child-a",
          parentId: "root-a",
          label: "Child A",
          order: 1010,
          updatedAt: "2026-08-28T00:01:00.000Z",
          source: "import",
          profile: { keywords: ["shadow"] },
        },
        {
          id: "opaque-editor",
          parentId: "root",
          label: "Opaque editor",
          order: 1020,
          updatedAt: "2026-08-28T00:02:00.000Z",
          source: "manual",
          editor: { schema: "future.editor.v9", opaque: { preserve: [1, 2, 3] } },
        },
      ],
    },
  };
}

function findById(records, nodeId) {
  return records.find((record) => record.nodeId === nodeId);
}

test("P106a round-trips a current canonical portal.export.v1 payload exactly", () => {
  const context = createContext();
  const fixedWrittenAt = "2026-08-28T12:00:00.000Z";
  const representativeNorm = normalise(context, representativePortalInput());
  const canonicalInput = canonical(context, representativeNorm, fixedWrittenAt);
  assert.equal(canonicalInput.schema, "portal.export.v1");
  assert.equal(canonicalInput.writtenAt, fixedWrittenAt);
  assert.equal(canonicalInput.exportedAt, fixedWrittenAt);
  assert.deepEqual(plain(canonicalInput.mainThoughtTree), plain(canonicalInput.data.mainThoughtTree));
  assert.deepEqual(plain(canonicalInput.mainThoughtTreeTombstones), plain(canonicalInput.data.mainThoughtTreeTombstones));

  const norm = normalise(context, canonicalInput);
  const encoded = context.PocketStarlingShadow.encode(norm);
  assert.equal(encoded.ok, true);
  const decoded = context.PocketStarlingShadow.decode(encoded.shadow);
  assert.equal(decoded.ok, true);
  assert.deepEqual(plain(decoded.norm), plain(norm));

  assert.deepEqual(
    plain(canonical(context, norm, fixedWrittenAt)),
    plain(canonical(context, decoded.norm, fixedWrittenAt)),
  );
  assert.equal(source("index.html").includes(SHADOW), false, "shadow module must remain dormant");
});

test("P106 separates node identity, placement and payload without reinterpreting editors", () => {
  const context = createContext();
  const norm = normalise(context, representativePortalInput());
  const { shadow } = context.PocketStarlingShadow.encode(norm);

  for (const node of norm.nodes) {
    const identity = findById(shadow.identities, node.id);
    const placement = findById(shadow.placements, node.id);
    const payload = findById(shadow.payloads, node.id);
    assert.deepEqual(plain(identity), { nodeId: node.id });
    assert.deepEqual(plain(placement), { nodeId: node.id, parentId: node.parentId, order: node.order });
    assert.equal(Object.hasOwn(payload.value, "id"), false);
    assert.equal(Object.hasOwn(payload.value, "parentId"), false);
    assert.equal(Object.hasOwn(payload.value, "order"), false);
  }
  assert.deepEqual(plain(findById(shadow.payloads, "opaque-editor").value.editor), plain(norm.nodes[2].editor));
  assert.deepEqual(plain(findById(shadow.payloads, "root-a").value.editor), plain(norm.nodes[0].editor));
});

test("P106 local payload edits and subtree-root moves isolate the intended shadow records", () => {
  const context = createContext();
  const before = plain(normalise(context, representativePortalInput()));
  const payloadEdit = plain(before);
  payloadEdit.nodes.find((node) => node.id === "child-a").label = "Child A edited";
  payloadEdit.nodes.find((node) => node.id === "child-a").details = "Only payload changed";
  payloadEdit.nodes.find((node) => node.id === "child-a").updatedAt = "2026-08-28T01:00:00.000Z";

  const beforeShadow = context.PocketStarlingShadow.encode(before).shadow;
  const editedShadow = context.PocketStarlingShadow.encode(payloadEdit).shadow;
  for (const node of before.nodes) {
    const id = node.id;
    assert.deepEqual(plain(findById(editedShadow.placements, id)), plain(findById(beforeShadow.placements, id)));
    if (id === "child-a") assert.notDeepEqual(plain(findById(editedShadow.payloads, id)), plain(findById(beforeShadow.payloads, id)));
    else assert.deepEqual(plain(findById(editedShadow.payloads, id)), plain(findById(beforeShadow.payloads, id)));
    assert.deepEqual(plain(findById(editedShadow.identities, id)), plain(findById(beforeShadow.identities, id)));
  }

  const moved = plain(before);
  const movedRoot = moved.nodes.find((node) => node.id === "root-a");
  movedRoot.parentId = "opaque-editor";
  movedRoot.order = 1030;
  const movedShadow = context.PocketStarlingShadow.encode(moved).shadow;
  for (const node of before.nodes) {
    const id = node.id;
    if (id === "root-a") assert.notDeepEqual(plain(findById(movedShadow.placements, id)), plain(findById(beforeShadow.placements, id)));
    else assert.deepEqual(plain(findById(movedShadow.placements, id)), plain(findById(beforeShadow.placements, id)));
    assert.deepEqual(plain(findById(movedShadow.payloads, id)), plain(findById(beforeShadow.payloads, id)));
    assert.deepEqual(plain(findById(movedShadow.identities, id)), plain(findById(beforeShadow.identities, id)));
  }
});

test("P106 fails closed for malformed membership and JSON-incompatible material", () => {
  const context = createContext();
  const norm = normalise(context, representativePortalInput());
  const encoded = context.PocketStarlingShadow.encode(norm);
  const duplicateInput = plain(norm);
  duplicateInput.nodes.push(plain(duplicateInput.nodes[0]));
  assert.deepEqual(plain(context.PocketStarlingShadow.encode(duplicateInput)), { ok: false, reason: "duplicate-node-id" });

  const missingPlacement = plain(encoded.shadow);
  missingPlacement.placements = missingPlacement.placements.filter((record) => record.nodeId !== "child-a");
  assert.deepEqual(plain(context.PocketStarlingShadow.decode(missingPlacement)), { ok: false, reason: "shadow-membership-mismatch" });

  const missingPayload = plain(encoded.shadow);
  missingPayload.payloads = missingPayload.payloads.filter((record) => record.nodeId !== "child-a");
  assert.deepEqual(plain(context.PocketStarlingShadow.decode(missingPayload)), { ok: false, reason: "shadow-membership-mismatch" });

  const badSequence = plain(encoded.shadow);
  badSequence.nodeSequence.push("child-a");
  assert.deepEqual(plain(context.PocketStarlingShadow.decode(badSequence)), { ok: false, reason: "invalid-node-sequence" });

  const cyclic = plain(norm);
  cyclic.rootExtras = {};
  cyclic.rootExtras.self = cyclic.rootExtras;
  assert.deepEqual(plain(context.PocketStarlingShadow.encode(cyclic)), { ok: false, reason: "json-incompatible-value" });
});

test("P106 produces detached deterministic values in both directions", () => {
  const context = createContext();
  const norm = normalise(context, representativePortalInput());
  const first = context.PocketStarlingShadow.encode(norm);
  const second = context.PocketStarlingShadow.encode(norm);
  assert.deepEqual(plain(first.shadow), plain(second.shadow));

  norm.nodes[0].label = "Mutated after encode";
  norm.rootExtras.rootMarker.release = "changed";
  assert.equal(findById(first.shadow.payloads, "root-a").value.label, "Root A");
  assert.equal(first.shadow.rootExtras.rootMarker.release, "P106");

  const decoded = context.PocketStarlingShadow.decode(first.shadow);
  assert.equal(decoded.ok, true);
  decoded.norm.nodes[0].label = "Mutated after decode";
  decoded.norm.rootExtras.rootMarker.release = "changed again";
  assert.equal(findById(first.shadow.payloads, "root-a").value.label, "Root A");
  assert.equal(first.shadow.rootExtras.rootMarker.release, "P106");
});
