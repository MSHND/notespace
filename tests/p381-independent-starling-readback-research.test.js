"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { createRequire } = require("node:module");

function replaceFixtureLine(source, line, replacement) {
  assert.equal(source.split(line).length, 2, `Expected one fixture seam: ${line}`);
  return source.replace(line, () => replacement);
}

// Reuse the existing VM fixtures without changing their checked-in assertions.
function loadFixture(name, transform, exports) {
  const file = path.join(__dirname, name);
  const source = fs.readFileSync(file, "utf8");
  const code = transform(replaceFixtureLine(source,
    '\nconst test = require("node:test");\n', "\nconst test = () => {};\n"));
  const moduleRecord = { exports: {} };
  new Function("require", "module", "__filename", "__dirname",
    `${code}\nmodule.exports = { ${exports} };`)(
    createRequire(file), moduleRecord, file, __dirname
  );
  return moduleRecord.exports;
}

function plain(value) {
  return JSON.parse(JSON.stringify(value));
}

function nodeContents(context) {
  return plain(vm.runInContext("state.nodes", context))
    .sort((left, right) => left.order - right.order)
    .map(({ id, parentId, label, details }) => ({ id, parentId, label, details }));
}

function requestsTo(requests, endpoint) {
  return requests.filter(({ url }) => url.endsWith(endpoint));
}

test("P381 research: separately authenticated VM reopens the accepted Starling reorder", async () => {
  const { loadProduction } = loadFixture("p052-additional-device.test.js", (source) => {
    const index = fs.readFileSync(path.join(__dirname, "../index.html"), "utf8");
    const scripts = [...index.matchAll(/<script src="([^"]+)"/g)].map((match) => match[1]);
    const metadataIndex = scripts.indexOf("js/pocket-editor-metadata.js");
    assert.equal(scripts[metadataIndex - 1], "js/pocket-node-content.js");
    const metadata = '"js/pocket-editor-metadata.js"';
    return replaceFixtureLine(source, metadata, `"js/pocket-node-content.js", ${metadata}`);
  }, "loadProduction");
  assert.ok(loadProduction({ browserPersistence: true }).PocketNodeContent,
    "P052's browser VM must load the same metadata dependency as the app");

  const { readyPostReentry, loadP180Helpers } = loadFixture(
    "p190-starling-save-observability-and-reentry.test.js",
    (source) => {
      // P190 already enables fixture authentication. Share only the synthetic
      // Sync backend so the second VM has its own cookies, state and IndexedDB.
      const seam = "  code = code.replace(p190Verifier,";
      return replaceFixtureLine(source, seam,
        '  code = code.replace("const service = createService(options);",\n'
        + '    "const service = options.service || createService(options);");\n' + seam);
    },
    "readyPostReentry, loadP180Helpers"
  );
  const { h: writer } = await readyPostReentry();
  const before = nodeContents(writer.context);
  assert.deepEqual(before.map(({ id }) => id), ["beta", "alpha", "restore"]);
  const h2 = await writer.readRemoteState();
  const start = writer.requests.length;

  writer.context.moveNodeWithinSiblings("beta", 1);
  const sequence = writer.context.getPocketHighestOperationSequence();
  assert.deepEqual(plain(writer.context.freezePocketStarlingOwnerWorkingSetThrough(sequence)), {
    ceiling: sequence,
    operations: [{ type: "reorder", input: { nodeId: "beta", fromIndex: 0, toIndex: 2 } }],
  });
  const expected = [before[1], before[0], before[2]];
  assert.deepEqual(nodeContents(writer.context), expected);
  const saved = await writer.context.exportTree({ returnDetails: true, downloadFallback: false });
  assert.equal(saved.ok, true, JSON.stringify(saved));
  assert.equal(writer.context.hasPocketUnsavedChanges(), false);
  const writes = writer.requests.slice(start);
  assert.equal(requestsTo(writes, "/pockets/content/conditional-upload").length, 0);
  const commits = requestsTo(writes, "/pockets/head/compare-and-set");
  assert.deepEqual(commits.map(({ status }) => status), [200]);
  const commit = JSON.parse(commits[0].body);
  assert.deepEqual(commit.expectedHead, plain(h2.head));
  assert.equal(commit.syncedPocketId, h2.syncedPocketId);

  const helpers = loadP180Helpers();
  const reader = helpers.loadP176Harness().productionHarness({ service: writer.service });
  helpers.loadRealMainSaveSurface(reader.context);
  reader.context.setPocketFileSession(null, "", { ownerKind: "none" });
  vm.runInContext("state.nodes = [];", reader.context);
  assert.deepEqual(nodeContents(reader.context), []);
  assert.notEqual(reader.idb, writer.idb);
  assert.equal(reader.context.PocketOwnerSaveBoundary.hasSyncedOwner(), false);
  const opened = await reader.context.PocketSyncActiveIntegration.openExisting();
  assert.equal(opened.ok, true, JSON.stringify(opened));
  assert.ok(requestsTo(reader.requests, "/account/passkeys/authentication/finish")
    .some(({ status }) => status === 200));
  assert.ok(requestsTo(reader.requests, "/pockets/objects/get").length > 0);
  assert.deepEqual(nodeContents(reader.context), expected);
  const h3 = await reader.readRemoteState();
  assert.equal(h3.syncedPocketId, h2.syncedPocketId);
  assert.equal(h3.authority.currentMode, "starling");
  assert.equal(h3.revision, h2.revision);
  assert.equal(h3.head.revision, h2.head.revision + 1);
  assert.equal(h3.head.sealRef, commit.candidateSealStorageRef);
  assert.equal(requestsTo(reader.requests, "/pockets/head/compare-and-set").length, 0);

  console.info(JSON.stringify({
    pocket: h3.syncedPocketId, editSequence: sequence, commitOperationId: commit.operationId,
    beforeHead: h2.head, reopenedHead: h3.head, rollbackRevision: h3.revision,
    order: expected.map(({ id }) => id),
  }));
});
