"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { createRequire } = require("node:module");

const ROOT = path.resolve(__dirname, "..");
const P180 = path.join(__dirname, "p180-main-save-cutover.test.js");

function plain(value) {
  return value === undefined ? undefined : JSON.parse(JSON.stringify(value));
}

function source(file) {
  return fs.readFileSync(path.join(ROOT, file), "utf8");
}

function loadP180Helpers() {
  let code = fs.readFileSync(P180, "utf8");
  const testDeclaration = 'const test = require("node:test");';
  assert.ok(code.includes(testDeclaration), "P180 test declaration changed");
  code = code.replace(testDeclaration, "const test = () => {};");
  code += "\nmodule.exports = { loadP176Harness, loadRealMainSaveSurface };\n";
  const moduleRecord = { exports: {} };
  new Function("require", "module", "exports", "__filename", "__dirname", code)(
    createRequire(P180), moduleRecord, moduleRecord.exports, P180, __dirname
  );
  return moduleRecord.exports;
}

function installFixture(context) {
  const timestamp = "2044-01-01T00:00:00.000Z";
  context.__p360Nodes = [
    { id: "a", parentId: "root", order: 1001, label: "A", details: "A content", updatedAt: timestamp, source: "manual" },
    {
      id: "b", parentId: "root", order: 1002, label: "B", details: "Before\n  child",
      editor: { schema: "pocket.nodeEditor.v2", text: "Before\n  child" },
      updatedAt: timestamp, source: "manual",
    },
    { id: "b-child", parentId: "b", order: 1001, label: "B child", details: "descendant", updatedAt: timestamp, source: "manual" },
    { id: "c", parentId: "root", order: 1003, label: "C", details: "C content", updatedAt: timestamp, source: "manual" },
    { id: "unrelated", parentId: "root", order: 1004, label: "Unrelated", details: "unrelated content", updatedAt: timestamp, source: "manual" },
  ];
  context.__p360Tombstones = [{ id: "gone", retained: { p360: true } }];
  context.__p360RootExtras = { p360Root: { retained: true } };
  context.__p360DataExtras = { p360Data: { retained: true } };
  vm.runInContext(
    "state.nodes=__p360Nodes;state.tombstones=__p360Tombstones;state.rootExtras=__p360RootExtras;state.dataExtras=__p360DataExtras;state.ops=[];state.operationHighWater=0;state.operationDocumentAnchor=null;state.activeSaveOperationCeiling=0;state.source={schema:'portal.export.v1',fileName:'p360-disposable.json',writtenAt:''};",
    context
  );
  context.__p360State = vm.runInContext("state", context);
  return timestamp;
}

function state(context) {
  return context.__p360State;
}

function orderedIds(context, parentId = "root") {
  return plain(state(context).nodes)
    .filter((node) => (node.parentId || "root") === parentId)
    .sort((left, right) => Number(left.order) - Number(right.order))
    .map((node) => node.id);
}

function childIds(document, parentId = "root") {
  return plain(document.nodes.filter((node) => (node.parentId || "root") === parentId)
    .sort((left, right) => Number(left.order) - Number(right.order)).map((node) => node.id));
}

function contentById(document) {
  return plain(document.nodes.map(({ order, ...node }) => node).sort((left, right) => left.id.localeCompare(right.id)));
}

function normalised(context, payload) {
  context.__p360Payload = payload;
  const parsed = vm.runInContext("normaliseInput(__p360Payload)", context);
  const dataExtras = vm.runInContext("normaliseRootExtras(__p360Payload.data)||{}", context);
  return {
    schema: parsed.schema,
    writtenAt: parsed.writtenAt,
    nodes: parsed.nodes,
    tombstones: parsed.tombstones,
    rootExtras: parsed.rootExtras || {},
    dataExtras,
  };
}

async function materialiseAccepted(context) {
  const ownerSession = context.PocketOwnerSaveBoundary.captureOwnerSaveSession();
  const syncedPocketId = ownerSession?.controllerSession?.syncedPocketId;
  assert.ok(syncedPocketId, "P360 requires the actual synced owner session");
  const storeApi = context.PocketSyncDeviceStore;
  const deviceStore = storeApi.createStore(storeApi.createIndexedDbDriver(context.indexedDB));
  await deviceStore.open();
  const deviceRecord = await deviceStore.readPocket(syncedPocketId);
  assert.ok(deviceRecord?.deviceEnvelope?.record, "P360 requires the actual owner device record");
  const bundle = await context.PocketSyncCrypto.openMasterKeyBundle(
    deviceRecord.deviceEnvelope.record,
    deviceRecord.deviceWrappingKey,
    deviceRecord.deviceEnvelope.context,
    [],
    { semanticAuthority: true },
  );
  const transport = context.PocketSyncRemoteClient.createBrowserJsonTransport({ serviceRoot: "/pocket-sync/v1" });
  const objectHeadService = context.PocketSyncRemoteClient.createObjectHeadService({ transport });
  let ordinal = 0;
  const opened = await context.PocketStarlingRemoteOpenShadow.createRemoteOpener({
    objectHeadService,
    operationIdFactory(kind, index) {
      ordinal += 1;
      return `p360-materialise-${kind}-${index}-${ordinal}`;
    },
  }).openRemote({
    masterKey: bundle.masterKey,
    context: { syncedPocketId },
    semanticAuthority: bundle.semanticAuthority,
  });
  assert.equal(opened.outcome, "opened", JSON.stringify(opened));
  const materialised = await context.PocketStarlingMaterializeShadow.materializeAccepted(opened.session);
  assert.equal(materialised.ok, true, JSON.stringify(materialised));
  return plain(materialised.document);
}

function loadRealPeSurface(context) {
  for (const file of [
    "js/pocket-node-popout-target.js",
    "js/pocket-node-popout-model.js",
    "js/pocket-node-popout-editor.js",
  ]) vm.runInContext(source(file), context, { filename: file });
}

function installPeSourceIdentity(context) {
  const identity = Object.freeze({
    fileSessionId: 1,
    sourceFileName: "p360-disposable.json",
    sourceOwnerKind: "synced",
    sourcePipSession: false,
    sourceVaultSessionId: "",
  });

  context.capturePocketEditorSourceIdentity = () => ({ ...identity });
  context.isPocketEditorSourceIdentityCurrent = (candidate) => (
    candidate?.fileSessionId === identity.fileSessionId
    && candidate?.sourceFileName === identity.sourceFileName
    && candidate?.sourceOwnerKind === identity.sourceOwnerKind
    && candidate?.sourcePipSession === identity.sourcePipSession
    && candidate?.sourceVaultSessionId === identity.sourceVaultSessionId
  );
}

function assertStructuralOnly(operations, expected) {
  assert.deepEqual(plain(operations), [expected]);
  assert.equal(operations.some((operation) => operation.type === "payload"), false);
}

test("P360 real Main and canonical PE changes share one frozen P160 Save through P172 admission", { timeout: 30000 }, async () => {
  const helpers = loadP180Helpers();
  const p176 = helpers.loadP176Harness();
  const h = p176.productionHarness();
  const originalRevision = installFixture(h.context);

  await p176.activateFresh(h);
  h.context.__p180State = state(h.context);
  helpers.loadRealMainSaveSurface(h.context);
  installPeSourceIdentity(h.context);
  loadRealPeSurface(h.context);

  const b = h.context.nodeMap().get("b");
  assert.ok(b);
  const openedPayload = plain(h.context.PocketNodePopoutModel.buildPayload(b));
  assert.equal(openedPayload.originalUpdatedAt, originalRevision);
  assert.deepEqual(plain(b.editor), { schema: "pocket.nodeEditor.v2", text: "Before\n  child" });
  const preparedPePayload = {
    ...openedPayload,
    text: "After\n  child",
    body: "After\n  child",
  };

  h.context.moveNodeWithinSiblings("b", 1);
  const move = state(h.context).ops.at(-1);
  assert.equal(move.type, "move_down");
  assert.deepEqual(orderedIds(h.context), ["a", "c", "b", "unrelated"]);
  assert.equal(b.parentId, "root");
  assert.equal(h.context.nodeMap().get("b-child").parentId, "b");
  assert.equal(b.updatedAt, originalRevision);
  assertStructuralOnly(h.context.freezePocketStarlingOwnerWorkingSetThrough(move.seq).operations, {
    type: "reorder", input: { nodeId: "b", fromIndex: 1, toIndex: 3 },
  });

  const applied = h.context.PocketNodePopoutEditor.apply(preparedPePayload, { returnDetails: true });
  assert.equal(applied.ok, true, JSON.stringify(applied));
  assert.notEqual(b.updatedAt, originalRevision);
  assert.equal(b.details, "After\n  child");
  assert.deepEqual(plain(b.editor), { schema: "pocket.nodeEditor.v2", text: "After\n  child" });
  assert.deepEqual(orderedIds(h.context), ["a", "c", "b", "unrelated"]);
  assert.equal(h.context.nodeMap().get("b-child").parentId, "b");

  const contentOperation = state(h.context).ops.at(-1);
  const completeJournal = h.context.freezePocketStarlingOwnerWorkingSetThrough(contentOperation.seq).operations;
  assert.deepEqual(plain(completeJournal.map((operation) => operation.type)), ["reorder", "payload"]);
  assert.deepEqual(plain(completeJournal[0]), {
    type: "reorder", input: { nodeId: "b", fromIndex: 1, toIndex: 3 },
  });
  assert.equal(completeJournal[1].input.nodeId, "b");
  assert.deepEqual(plain(completeJournal[1].input.payload.editor), {
    schema: "pocket.nodeEditor.v2", text: "After\n  child",
  });

  const originalBuildPayload = h.context.buildPocketPayload;
  const originalPreparation = h.context.currentPocketStarlingOwnerSavePreparation;
  let frozenPayload = null;
  const preparationPayloads = [];
  const preparations = [];
  let mismatchArmed = false;
  h.context.buildPocketPayload = (...args) => {
    frozenPayload = originalBuildPayload(...args);
    return frozenPayload;
  };
  h.context.currentPocketStarlingOwnerSavePreparation = (payload) => {
    const preparation = originalPreparation(payload);
    if (!preparation) return preparation;
    preparationPayloads.push(payload);
    preparations.push(plain(preparation));
    if (!mismatchArmed) return preparation;
    const altered = plain(preparation);
    const reorder = altered.operations.find((operation) => operation?.type === "reorder");
    assert.ok(reorder, "controlled mismatch needs the actual captured reorder");
    reorder.input.toIndex = 0;
    return altered;
  };

  const originalRemoteEdit = h.context.PocketStarlingRemoteEditShadow;
  const preparedWorkingSets = [];
  h.context.PocketStarlingRemoteEditShadow = Object.freeze({
    ...originalRemoteEdit,
    async createEditor(input) {
      const editor = await originalRemoteEdit.createEditor(input);
      if (!editor || typeof editor.prepareWorkingSet !== "function") return editor;
      return Object.freeze({
        ...editor,
        async prepareWorkingSet(operations, preservationProjection) {
          const result = await editor.prepareWorkingSet(operations, preservationProjection);
          preparedWorkingSets.push({
            operations: plain(operations),
            preservationProjection: plain(preservationProjection),
            outcome: result?.outcome,
            reason: result?.reason || null,
          });
          return result;
        },
      });
    },
  });

  const wholeBefore = h.routeCount("/pockets/content/conditional-upload");
  const saved = await h.context.exportTree({ returnDetails: true, downloadFallback: false });
  assert.equal(saved.ok, true, JSON.stringify(saved));
  assert.ok(frozenPayload, "P160 must freeze the actual outgoing payload");
  assert.ok(preparations.length > 0, "owner successor must resolve P160 preparation");
  assert.equal(preparationPayloads.every((payload) => payload === frozenPayload), true,
    "P160 preparation must be resolved only for the exact frozen payload object");
  const preparation = preparations.at(-1);
  assert.equal(preparation.ceiling, contentOperation.seq);
  assert.deepEqual(preparation.operations, plain(completeJournal));
  assert.deepEqual(preparation.preservationProjection.tombstones, [{ id: "gone", retained: { p360: true } }]);
  assert.deepEqual(preparation.preservationProjection.rootExtras.p360Root, { retained: true });
  assert.equal(preparation.preservationProjection.rootExtras.pocketGuard?.schema, "pocket.guard.v1");
  assert.deepEqual(preparation.preservationProjection.dataExtras.p360Data, { retained: true });
  assert.equal(preparation.preservationProjection.dataExtras.pocketGuard?.schema, "pocket.guard.v1");
  assert.equal(preparedWorkingSets.some((working) => JSON.stringify(working.operations) === JSON.stringify(preparation.operations)
    && JSON.stringify(working.preservationProjection) === JSON.stringify(preparation.preservationProjection)
    && working.outcome === "prepared"), true,
  "the real owner successor must pass P160's preparation to real P139/P172 working-set preparation");
  assert.equal(h.routeCount("/pockets/content/conditional-upload"), wholeBefore,
    "Starling admission must not revive whole-record authoritative Save");

  const frozenIntended = normalised(h.context, frozenPayload);
  const frozenB = frozenIntended.nodes.find((node) => node.id === "b");
  assert.deepEqual(plain(frozenIntended.nodes.filter((node) => node.parentId === "root")
    .sort((left, right) => Number(left.order) - Number(right.order)).map((node) => node.id)),
  ["a", "c", "b", "unrelated"]);
  assert.equal(frozenIntended.nodes.find((node) => node.id === "b-child").parentId, "b");
  assert.deepEqual(plain(frozenB.editor), {
    schema: "pocket.nodeEditor.v2", text: "After\n  child",
  });
  assert.equal(frozenB.updatedAt, b.updatedAt);
  assert.equal(frozenIntended.nodes.find((node) => node.id === "unrelated").details, "unrelated content");
  assert.equal(preparedWorkingSets.some((working) => working.outcome === "prepared"), true,
    "real P172 admitted the P139-composed candidate only after exact semantic equivalence to the frozen payload");
  const acceptedHead = await h.readRemoteState();
  assert.equal(acceptedHead.authority.currentMode, "starling");
  assert.ok(acceptedHead.head, "admission must publish only after the accepted candidate is prepared");
  const materialised = await materialiseAccepted(h.context);
  assert.deepEqual(childIds(materialised), childIds(frozenIntended));
  assert.deepEqual(childIds(materialised, "b"), childIds(frozenIntended, "b"));
  assert.deepEqual(contentById(materialised), contentById(frozenIntended));
  assert.deepEqual(materialised.tombstones, plain(frozenIntended.tombstones));
  assert.deepEqual(materialised.rootExtras, plain(frozenIntended.rootExtras));
  assert.deepEqual(materialised.dataExtras, plain(frozenIntended.dataExtras));
  assert.equal(state(h.context).ops.length, 0, "accepted Save retires only the covered journal");

  h.context.moveNodeWithinSiblings("b", -1);
  assert.deepEqual(orderedIds(h.context), ["a", "b", "c", "unrelated"]);
  assert.equal(state(h.context).ops.length, 1);
  mismatchArmed = true;
  const casBeforeMismatch = h.routeCount("/pockets/head/compare-and-set");
  const presenceBeforeMismatch = h.routeCount("/pockets/objects/presence");
  const putBeforeMismatch = h.routeCount("/pockets/objects/put");
  const mismatch = await h.context.exportTree({ returnDetails: true, downloadFallback: false });
  assert.equal(mismatch.ok, false, JSON.stringify(mismatch));
  assert.equal(mismatch.reason, "starling-save-unsettled");
  assert.equal(preparedWorkingSets.at(-1).reason, "semantic-equivalence-mismatch");
  assert.equal(h.routeCount("/pockets/head/compare-and-set"), casBeforeMismatch,
    "P172 semantic mismatch must reject before authoritative Head CAS");
  assert.equal(h.routeCount("/pockets/objects/presence"), presenceBeforeMismatch,
    "P172 semantic mismatch must reject before publication proof");
  assert.equal(h.routeCount("/pockets/objects/put"), putBeforeMismatch,
    "P172 semantic mismatch must reject before object publication");
  assert.equal(h.routeCount("/pockets/content/conditional-upload"), wholeBefore,
    "P172 semantic mismatch must not fall back to whole-record Save");
  assert.equal(state(h.context).ops.length, 1, "rejected Save must retain truthful local dirtiness");
});
