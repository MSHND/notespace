"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { createRequire } = require("node:module");

const P190 = path.join(__dirname, "p190-starling-save-observability-and-reentry.test.js");
const plain = (value) => value === undefined ? undefined : JSON.parse(JSON.stringify(value));

function loadP190Helpers() {
  let code = fs.readFileSync(P190, "utf8");
  const declaration = 'const test = require("node:test");';
  assert.ok(code.includes(declaration), "P190 harness test declaration changed");
  code = code.replace(declaration, "const test = () => {};");
  code += "\nmodule.exports = { readyPostReentry };\n";
  const localRequire = createRequire(P190);
  const moduleRecord = { exports: {} };
  new Function("require", "module", "exports", "__filename", "__dirname", code)(
    localRequire, moduleRecord, moduleRecord.exports, P190, __dirname
  );
  return moduleRecord.exports;
}

test("P190b controlled post-reentry semantic mismatch is rejected by unchanged P172 before publication or CAS and stays dirty", { timeout: 30000 }, async () => {
  const { readyPostReentry } = loadP190Helpers();
  const { h, helpers } = await readyPostReentry();

  h.context.moveNodeWithinSiblings("beta", 1);
  assert.deepEqual(helpers.rootOrder(h.context), ["Alpha", "Beta", "Restore Me"]);
  assert.equal(h.context.__p180State.ops.length, 1);

  const originalPreparation = h.context.currentPocketStarlingOwnerSavePreparation;
  assert.equal(typeof originalPreparation, "function");
  h.context.currentPocketStarlingOwnerSavePreparation = (payload) => {
    const preparation = originalPreparation(payload);
    if (!preparation) return preparation;
    const changed = plain(preparation);
    const reorder = changed.operations.find((operation) => operation?.type === "reorder");
    assert.ok(reorder, "controlled mismatch requires the one captured reorder");
    reorder.input.toIndex = reorder.input.fromIndex + 1;
    return changed;
  };

  const observedRemoteEdit = h.context.PocketStarlingRemoteEditShadow;
  let admissionReason = null;
  h.context.PocketStarlingRemoteEditShadow = Object.freeze({
    ...observedRemoteEdit,
    async createEditor(input) {
      const editor = await observedRemoteEdit.createEditor(input);
      if (!editor || typeof editor.prepareWorkingSet !== "function") return editor;
      return Object.freeze({
        ...editor,
        async prepareWorkingSet(...args) {
          const result = await editor.prepareWorkingSet(...args);
          admissionReason = result?.reason === "semantic-equivalence-mismatch"
            ? "semantic-equivalence-mismatch" : null;
          return result;
        },
      });
    },
  });

  const wholeBefore = h.routeCount("/pockets/content/conditional-upload");
  const presenceBefore = h.routeCount("/pockets/objects/presence");
  const putBefore = h.routeCount("/pockets/objects/put");
  const casBefore = h.routeCount("/pockets/head/compare-and-set");

  const saved = await h.context.exportTree({ returnDetails: true, downloadFallback: false });
  assert.equal(saved.ok, false, JSON.stringify(saved));
  assert.equal(saved.reason, "starling-save-unsettled");
  assert.equal(admissionReason, "semantic-equivalence-mismatch");
  assert.equal(h.context.__p180State.ops.length, 1, "semantic rejection must preserve truthful dirty state");
  assert.equal(h.context.hasPocketUnsavedChanges(), true);
  assert.equal(h.routeCount("/pockets/content/conditional-upload"), wholeBefore, "semantic rejection must not revive whole-record R");
  assert.equal(h.routeCount("/pockets/objects/presence"), presenceBefore, "semantic rejection must precede publication presence proof");
  assert.equal(h.routeCount("/pockets/objects/put"), putBefore, "semantic rejection must precede object publication");
  assert.equal(h.routeCount("/pockets/head/compare-and-set"), casBefore, "semantic rejection must precede Head CAS");

  const remote = await h.readRemoteState();
  assert.equal(remote.revision, 1);
  assert.equal(remote.head.revision, 2);
  const diagnostic = h.context.PocketStarlingSaveDiagnostic.getLatest();
  assert.deepEqual(plain(diagnostic), {
    outcome: "failed",
    highestStage: "captured",
    failureCode: "starling-save-unsettled",
    elapsedMs: diagnostic.elapsedMs,
  });
});
