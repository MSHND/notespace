"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { createRequire } = require("node:module");

const ROOT = path.resolve(__dirname, "..");
const P176 = path.join(__dirname, "p176-production-composition.test.js");
const MAIN_SAVE_FILES = [
  "js/pocket-starling-owner-working-set-shadow.js",
  "js/pocket-history-status.js",
  "js/pocket-tree-actions.js",
  "js/pocket-io-browser.js",
];

function plain(value) {
  return value === undefined ? undefined : JSON.parse(JSON.stringify(value));
}

function source(file) {
  return fs.readFileSync(path.join(ROOT, file), "utf8");
}

function loadP176Harness() {
  let code = fs.readFileSync(P176, "utf8");
  const testDeclaration = 'const test = require("node:test");';
  assert.ok(code.includes(testDeclaration), "P176 harness test import changed");
  code = code.replace(testDeclaration,
    "const test = () => {};\nconst __p180FetchControl = { rejectFenceOnce: false };");

  const sourceDeclaration = 'const source = (file) => fs.readFileSync(path.join(ROOT, file), "utf8");';
  assert.ok(code.includes(sourceDeclaration), "P176 source helper changed");
  code = code.replace(sourceDeclaration, `const source = (file) => {
    let text = fs.readFileSync(path.join(ROOT, file), "utf8");
    if (file === "js/pocket-starling-owner-successor.js") {
      const adoptionNeedle = "const adoption = await attemptAuthorityAdoption(payload, preparation, authority, durable);";
      if (!text.includes(adoptionNeedle)) throw new Error("P180 adoption observer seam changed");
      text = text.replace(adoptionNeedle,
        adoptionNeedle + "\\n        global.__p180ObservedAdoption = adoption;");
    }
    return text;
  };`);

  const fetchNeedle = [
    "function browserFetch(adapter, observations) {",
    "  let cookie = \"\";",
    "  return async (url, options) => {",
  ].join("\n");
  assert.ok(code.includes(fetchNeedle), "P176 browser transport harness changed");
  code = code.replace(fetchNeedle, `${fetchNeedle}\n    if (__p180FetchControl.rejectFenceOnce\n        && String(url).endsWith(\"/pockets/authority/fence/acquire\")) {\n      __p180FetchControl.rejectFenceOnce = false;\n      observations.push({ url, method: options.method, body: options.body, status: 503, injected: true });\n      return new Response(JSON.stringify({ apiVersion: 1, ok: false, reason: \"injected-unavailable\" }), {\n        status: 503, headers: { \"Content-Type\": \"application/json\" },\n      });\n    }`);
  code += "\nmodule.exports = { productionHarness, activateFresh, fetchControl: __p180FetchControl };\n";

  const localRequire = createRequire(P176);
  const moduleRecord = { exports: {} };
  const execute = new Function("require", "module", "exports", "__filename", "__dirname", code);
  execute(localRequire, moduleRecord, moduleRecord.exports, P176, __dirname);
  return moduleRecord.exports;
}

function installBaselineTree(context) {
  const timestamp = "2044-01-01T00:00:00.000Z";
  context.__p180BaselineNodes = [
    { id: "alpha", parentId: "root", order: 1001, label: "Alpha", details: "alpha", updatedAt: timestamp, source: "manual" },
    { id: "beta", parentId: "root", order: 1002, label: "Beta", details: "beta", updatedAt: timestamp, source: "manual" },
    { id: "restore", parentId: "root", order: 1003, label: "Restore Me", details: "restore", updatedAt: timestamp, source: "manual" },
  ];
  vm.runInContext("state.nodes=__p180BaselineNodes;state.tombstones=[];state.rootExtras={};state.dataExtras={};state.ops=[];state.operationHighWater=0;state.operationDocumentAnchor=null;state.activeSaveOperationCeiling=0;", context);
  context.__p180State = vm.runInContext("state", context);
}

function loadRealMainSaveSurface(context) {
  const preservedOwnerSurface = {
    capturePocketFileSaveSession: context.capturePocketFileSaveSession,
    isPocketFileSaveSessionCurrent: context.isPocketFileSaveSessionCurrent,
    setPocketFileSession: context.setPocketFileSession,
    capturePocketFileOwnerForAdoption: context.capturePocketFileOwnerForAdoption,
    restorePocketFileOwnerAfterFailedAdoption: context.restorePocketFileOwnerAfterFailedAdoption,
  };
  context.HTMLElement = context.HTMLElement || class HTMLElement {};
  context.HTMLInputElement = context.HTMLInputElement || class HTMLInputElement extends context.HTMLElement {};
  context.HTMLTextAreaElement = context.HTMLTextAreaElement || class HTMLTextAreaElement extends context.HTMLElement {};
  context.HTMLButtonElement = context.HTMLButtonElement || class HTMLButtonElement extends context.HTMLElement {};
  context.Blob = context.Blob || Blob;
  for (const file of MAIN_SAVE_FILES) vm.runInContext(source(file), context, { filename: file });
  Object.assign(context, preservedOwnerSurface);
  context.canModifyPocket = () => true;
  context.requirePocketFileForChanges = () => true;
  context.hasPocketUnsavedChanges = () => Array.isArray(context.__p180State.ops) && context.__p180State.ops.length > 0;
  context.hasUnsavedDetailsEditorChanges = () => false;
  context.hasUnsavedInlineTitleDraft = () => false;
  context.isPocketFilePermissionPromptOpen = () => false;
  context.isPocketVaultRecoveryFlowOpen = () => false;
  context.setStatus = () => {};
  context.refreshMeta = () => {};
  context.renderTree = () => {};
  context.refocusTreeNavigation = () => {};
  context.clearLocalSafetySnapshot = () => {};
  context.clearConflictGuard = () => {};
  context.flashSaveChip = () => {};
  context.markVaultSavedNow = () => {};
  context.establishPocketDocumentBaseline = () => {};
  context.persistPipSnapshot = () => {};
}

function rootOrder(context) {
  return plain(context.__p180State.nodes)
    .filter((node) => (node.parentId || "root") === "root")
    .sort((left, right) => Number(left.order) - Number(right.order))
    .map((node) => node.label);
}

function compactRoutes(entries) {
  return entries.map((entry) => ({ url: entry.url, method: entry.method, status: entry.status, injected: entry.injected === true }));
}

async function realMainMigration(options = {}) {
  const harness = loadP176Harness();
  const h = harness.productionHarness();
  installBaselineTree(h.context);
  await harness.activateFresh(h);
  assert.equal(h.routeCount("/pockets/content/conditional-upload"), 1);
  assert.equal(h.context.PocketOwnerSaveBoundary.captureOwnerSaveSession().controller.getStarlingBootstrapState(), null);
  loadRealMainSaveSurface(h.context);
  h.context.moveNodeWithinSiblings("beta", -1);
  assert.deepEqual(rootOrder(h.context), ["Beta", "Alpha", "Restore Me"]);
  assert.equal(h.context.__p180State.ops.length, 1);
  const ceiling = h.context.getPocketHighestOperationSequence();
  const working = h.context.freezePocketStarlingOwnerWorkingSetThrough(ceiling);
  assert.deepEqual(plain(working?.operations?.map((operation) => operation.type)), ["payload", "reorder"]);

  h.context.__p180ObservedAdoption = undefined;
  const wholeUploadsBefore = h.routeCount("/pockets/content/conditional-upload");
  const requestStart = h.requests.length;
  if (options.rejectFenceOnce) harness.fetchControl.rejectFenceOnce = true;
  const saved = await h.context.exportTree({ returnDetails: true, downloadFallback: false });
  const remote = await h.readRemoteState();
  const controller = h.context.PocketOwnerSaveBoundary.captureOwnerSaveSession().controller;
  const diagnostic = {
    saved: plain(saved), remote: plain(remote),
    adoptionReached: h.context.__p180ObservedAdoption !== undefined,
    adoption: plain(h.context.__p180ObservedAdoption),
    bootstrap: plain(controller.getStarlingBootstrapState?.() || null),
    syncedOwnerState: plain(controller.getSyncedOwnerState?.() || null),
    guard: h.context.PocketStarlingRealTruthAdmission.isStarlingUndoGuardActive(),
    wholeUploadsBefore, wholeUploadsAfter: h.routeCount("/pockets/content/conditional-upload"),
    routes: compactRoutes(h.requests.slice(requestStart)),
  };
  return { h, saved, remote, wholeUploadsBefore, diagnostic };
}

test("P180 real Main migration never falls back to whole-record R2", async () => {
  const { h, saved, remote, wholeUploadsBefore, diagnostic } = await realMainMigration();
  const evidence = JSON.stringify(diagnostic);
  assert.equal(saved.ok, true, evidence);
  assert.equal(h.routeCount("/pockets/content/conditional-upload"), wholeUploadsBefore,
    `real Main migration Save must not create R=2: ${evidence}`);
  assert.equal(remote.revision, 1, evidence);
  assert.equal(remote.authority.currentMode, "starling", evidence);
  assert.equal(remote.head.revision, 2, evidence);
  assert.equal(h.context.__p180State.ops.length, 0, evidence);
});

test("P180 post-H1 adoption failure fails closed instead of whole-record R2", async () => {
  const { h, saved, remote, wholeUploadsBefore, diagnostic } = await realMainMigration({ rejectFenceOnce: true });
  const evidence = JSON.stringify(diagnostic);
  assert.equal(saved.ok, false, evidence);
  assert.equal(h.routeCount("/pockets/content/conditional-upload"), wholeUploadsBefore, evidence);
  assert.equal(remote.revision, 1, evidence);
  assert.equal(remote.authority.currentMode, "whole-record", evidence);
  assert.equal(remote.head.revision, 1, evidence);
  assert.equal(h.context.__p180State.ops.length, 1, evidence);
});
