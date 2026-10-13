"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { performance } = require("node:perf_hooks");
const { createRequire } = require("node:module");

const ROOT = path.resolve(__dirname, "..");
const P190 = path.join(__dirname, "p190-starling-save-observability-and-reentry.test.js");
const SIZES = Object.freeze([100, 500, 2000]);
const REPEATS = 3;
const ROUTES = Object.freeze({
  head: "/pockets/head/read",
  get: "/pockets/objects/get",
  put: "/pockets/objects/put",
  presence: "/pockets/objects/presence",
  cas: "/pockets/head/compare-and-set",
});

function plain(value) {
  return value === undefined ? undefined : JSON.parse(JSON.stringify(value));
}

function elapsed(measures, key, work) {
  const started = performance.now();
  try { return work(); }
  finally { measures[key] = (measures[key] || 0) + (performance.now() - started); }
}

async function elapsedAsync(measures, key, work) {
  const started = performance.now();
  try { return await work(); }
  finally { measures[key] = (measures[key] || 0) + (performance.now() - started); }
}

function median(values) {
  const sorted = values.slice().sort((left, right) => left - right);
  return sorted[Math.floor(sorted.length / 2)];
}

function rounded(value) { return Number(value.toFixed(3)); }

function routeCounts(entries) {
  return Object.fromEntries(Object.entries(ROUTES).map(([name, suffix]) => [name,
    entries.filter((entry) => entry.url.endsWith(suffix)).length]));
}

function loadP190Helpers() {
  let code = fs.readFileSync(P190, "utf8");
  const declaration = 'const test = require("node:test");';
  assert.ok(code.includes(declaration), "P364 P190 harness declaration changed");
  code = code.replace(declaration, "const test = () => {};");
  code += "\nmodule.exports = { loadP180Helpers };\n";
  const localRequire = createRequire(P190);
  const moduleRecord = { exports: {} };
  new Function("require", "module", "exports", "__filename", "__dirname", code)(
    localRequire, moduleRecord, moduleRecord.exports, P190, __dirname
  );
  return moduleRecord.exports;
}

function installScaleTree(context, count) {
  context.__p180BaselineNodes = Array.from({ length: count }, (_unused, index) => scaleNode(index));
  vm.runInContext(
    "state.nodes=__p180BaselineNodes;state.tombstones=[];state.rootExtras={};state.dataExtras={};"
      + "state.ops=[];state.operationHighWater=0;state.operationDocumentAnchor=null;"
      + "state.activeSaveOperationCeiling=0;",
    context
  );
  context.__p180State = vm.runInContext("state", context);
}

function scaleNode(index, order = index) {
  const timestamp = "2044-01-01T00:00:00.000Z";
  return {
    id: `p364-${String(index).padStart(4, "0")}`,
    parentId: "root",
    order,
    label: `P364 node ${index}`,
    details: `offline baseline ${index}`,
    updatedAt: timestamp,
    source: "manual",
  };
}

function expectedNodes(expectedOrder) {
  return expectedOrder.map((id, order) => scaleNode(Number(id.slice("p364-".length)), order));
}

function moveExpectedLeft(expectedOrder, id) {
  const index = expectedOrder.indexOf(id);
  assert.ok(index > 0, `expected movable node ${id}`);
  [expectedOrder[index - 1], expectedOrder[index]] = [expectedOrder[index], expectedOrder[index - 1]];
}

async function verifyAcceptedRemoteTruth(h, count, expectedOrder, expectedHeadRevision) {
  const baseMaterialize = h.context.PocketStarlingMaterializeShadow;
  const documents = [];
  h.context.PocketStarlingMaterializeShadow = Object.freeze({
    ...baseMaterialize,
    async materializeAccepted(...args) {
      const result = await baseMaterialize.materializeAccepted(...args);
      if (result?.ok === true) documents.push(plain(result.document));
      return result;
    },
  });
  try {
    assert.equal(h.context.PocketOwnerSaveBoundary.retireSyncedOwner(), true,
      "verification reads through a fresh accepted remote owner");
    h.context.setPocketFileSession(null, "", { ownerKind: "none" });
    vm.runInContext(
      "state.nodes=[];state.tombstones=[];state.rootExtras={};state.dataExtras={};"
        + "state.ops=[];state.operationHighWater=0;state.operationDocumentAnchor=null;"
        + "state.activeSaveOperationCeiling=0;",
      h.context
    );
    const reopened = await h.context.PocketSyncActiveIntegration.openExisting();
    assert.equal(reopened.ok, true, JSON.stringify(reopened));
  } finally {
    h.context.PocketStarlingMaterializeShadow = baseMaterialize;
  }
  const expected = expectedNodes(expectedOrder);
  assert.ok(documents.length >= 1, "fresh remote re-entry materialises accepted truth");
  for (const document of documents) {
    assert.equal(document.nodes.length, count, "no accepted nodes missing or added");
    assert.equal(new Set(document.nodes.map((node) => node.id)).size, count,
      "accepted node identities are unique");
    assert.deepEqual(document.nodes.map((node) => node.id), expectedOrder,
      "accepted root sibling order matches the declared workload");
    assert.ok(document.nodes.every((node) => node.parentId === "root"),
      "accepted parent relationships remain root-owned");
    assert.deepEqual(document.nodes, expected,
      "accepted node identity, order and unchanged content match the independent witness");
  }
  assert.equal(h.context.__p180State.nodes.length, count, "fresh re-entry projects every accepted node");
  assert.equal(h.context.__p180State.ops.length, 0, "verification re-entry has no local dirty operation");
  const remote = await h.readRemoteState();
  assert.equal(remote.authority.currentMode, "starling");
  assert.equal(remote.head.revision, expectedHeadRevision, "accepted Head progression");
  return { materializations: documents.length, headRevision: remote.head.revision };
}

async function readyPostReentry(count) {
  const helpers = loadP190Helpers().loadP180Helpers();
  const p176 = helpers.loadP176Harness();
  const h = p176.productionHarness();
  installScaleTree(h.context, count);
  await p176.activateFresh(h);
  helpers.loadRealMainSaveSurface(h.context);

  h.context.moveNodeWithinSiblings("p364-0001", -1);
  assert.equal(h.context.__p180State.ops.length, 1, "one migration operation");
  const migrated = await h.context.exportTree({ returnDetails: true, downloadFallback: false });
  assert.equal(migrated.ok, true, JSON.stringify(migrated));
  assert.equal((await h.readRemoteState()).head.revision, 2, "migration reaches H2");
  assert.equal(h.context.__p180State.ops.length, 0, "migration consumes its operation");

  assert.equal(h.context.PocketOwnerSaveBoundary.retireSyncedOwner(), true);
  h.context.setPocketFileSession(null, "", { ownerKind: "none" });
  vm.runInContext(
    "state.nodes=[];state.tombstones=[];state.rootExtras={};state.dataExtras={};"
      + "state.ops=[];state.operationHighWater=0;state.operationDocumentAnchor=null;"
      + "state.activeSaveOperationCeiling=0;",
    h.context
  );
  return { h, helpers };
}

function observeOpenAndReentry(context) {
  const measures = {}, counts = { logicalResolves: 0, contentReads: 0, placementReads: 0,
    materializedNodes: null, materializeCalls: 0 };
  const baseOpen = context.PocketStarlingRemoteOpenShadow;
  const baseMaterialize = context.PocketStarlingMaterializeShadow;
  context.PocketStarlingRemoteOpenShadow = Object.freeze({
    ...baseOpen,
    createRemoteOpener(...args) {
      const opener = baseOpen.createRemoteOpener(...args);
      return Object.freeze({
        ...opener,
        async openRemote(...openArgs) {
          const opened = await elapsedAsync(measures, "remoteOpenMs", () => opener.openRemote(...openArgs));
          if (opened?.outcome !== "opened") return opened;
          const session = opened.session;
          return Object.freeze({ ...opened, session: Object.freeze({ ...session,
            async resolveLogical(...resolveArgs) {
              counts.logicalResolves += 1;
              return session.resolveLogical(...resolveArgs);
            },
            async readContent(...readArgs) {
              counts.contentReads += 1;
              return session.readContent(...readArgs);
            },
            async readPlacement(...readArgs) {
              counts.placementReads += 1;
              return session.readPlacement(...readArgs);
            },
          }) });
        },
      });
    },
  });
  context.PocketStarlingMaterializeShadow = Object.freeze({
    ...baseMaterialize,
    async materializeAccepted(...args) {
      counts.materializeCalls += 1;
      const result = await elapsedAsync(measures, "materializeMs", () => baseMaterialize.materializeAccepted(...args));
      if (result?.ok === true) counts.materializedNodes = result.document.nodes.length;
      return result;
    },
  });
  return { measures, counts };
}

function observeSave(context) {
  const measures = {}, counts = { canonicalCalls: 0, composedRefs: null, stagedRecords: null };
  const baseLogical = context.PocketStarlingLogicalEditShadow;
  const baseStorage = context.PocketStarlingStorageShadow;
  const baseDurable = context.PocketStarlingDurablePublication;
  const baseSeal = context.PocketStarlingObjectSealShadow;
  const logical = Object.freeze({
    ...baseLogical,
    async compose(...args) {
      const result = await elapsedAsync(measures, "p139ComposeMs", () => baseLogical.compose(...args));
      if (result?.candidate?.newLogicalRefs) counts.composedRefs = result.candidate.newLogicalRefs.length;
      return result;
    },
  });
  const storage = Object.freeze({
    ...baseStorage,
    async stageCandidate(...args) {
      const result = await elapsedAsync(measures, "changedObjectStageMs", () => baseStorage.stageCandidate(...args));
      if (result?.newRecords) counts.stagedRecords = result.newRecords.length;
      return result;
    },
  });
  const durable = Object.freeze({
    ...baseDurable,
    createCoordinator(...args) {
      const coordinator = baseDurable.createCoordinator(...args);
      return Object.freeze({ ...coordinator,
        async ensureObjects(...ensureArgs) {
          return elapsedAsync(measures, "presenceAndPublishMs", () => coordinator.ensureObjects(...ensureArgs));
        },
        async attemptHead(...headArgs) {
          return elapsedAsync(measures, "casMs", () => coordinator.attemptHead(...headArgs));
        },
      });
    },
  });
  const seal = Object.freeze({
    ...baseSeal,
    canonical(value) {
      if (value?.schema === "portal.mtt.web.v1" && Array.isArray(value.nodes)) {
        counts.canonicalCalls += 1;
        return elapsed(measures, "fullCanonicalMs", () => baseSeal.canonical(value));
      }
      return baseSeal.canonical(value);
    },
  });
  context.PocketStarlingLogicalEditShadow = logical;
  context.PocketStarlingStorageShadow = storage;
  context.PocketStarlingDurablePublication = durable;
  context.PocketStarlingObjectSealShadow = seal;
  return {
    measures, counts,
    restore() {
      assert.strictEqual(context.PocketStarlingLogicalEditShadow, logical, "P364 observer remains single-layered");
      assert.strictEqual(context.PocketStarlingStorageShadow, storage, "P364 observer remains single-layered");
      assert.strictEqual(context.PocketStarlingDurablePublication, durable, "P364 observer remains single-layered");
      assert.strictEqual(context.PocketStarlingObjectSealShadow, seal, "P364 observer remains single-layered");
      context.PocketStarlingLogicalEditShadow = baseLogical;
      context.PocketStarlingStorageShadow = baseStorage;
      context.PocketStarlingDurablePublication = baseDurable;
      context.PocketStarlingObjectSealShadow = baseSeal;
      return true;
    },
  };
}

function issueMoves(context, expectedOrder, start, amount) {
  const ids = [];
  for (let index = start; index < start + amount; index += 1) {
    const id = `p364-${String(index).padStart(4, "0")}`;
    context.moveNodeWithinSiblings(id, -1);
    moveExpectedLeft(expectedOrder, id);
    ids.push(id);
  }
  assert.equal(context.__p180State.ops.length, amount, `D=${amount} is retained before Save`);
  return ids;
}

async function saveCase(h, count, d, start, expectedOrder) {
  const mutationIds = issueMoves(h.context, expectedOrder, start, d);
  const observed = observeSave(h.context);
  const requestsBefore = h.requests.length;
  const wholeBefore = h.routeCount("/pockets/content/conditional-upload");
  const totalStarted = performance.now();
  let saved;
  let totalMs;
  try {
    saved = await h.context.exportTree({ returnDetails: true, downloadFallback: false });
    totalMs = performance.now() - totalStarted;
  } finally {
    assert.equal(observed.restore(), true, "P364 restores all timed observer surfaces before verification");
  }
  const requests = h.requests.slice(requestsBefore);
  assert.equal(saved.ok, true, JSON.stringify(saved));
  assert.equal(h.context.__p180State.ops.length, 0, `D=${d} is accepted`);
  assert.equal(h.routeCount("/pockets/content/conditional-upload"), wholeBefore, "no whole-record fallback");
  const expectedHeadRevision = d === 1 ? 3 : 4;
  const truth = await verifyAcceptedRemoteTruth(h, count, expectedOrder, expectedHeadRevision);
  return {
    N: count,
    D: d,
    userMutations: d,
    operationRecords: d,
    workload: d === 1
      ? "sequential series: starts from accepted H2"
      : "sequential series: starts after accepted D=1 at H3",
    mutationIds,
    acceptedTruth: truth,
    logicalObjectsRequested: null,
    bytesResolved: null,
    reusedRefs: null,
    newLogicalRefs: observed.counts.composedRefs,
    objectsEncryptedAndStaged: observed.counts.stagedRecords,
    objectsPublished: routeCounts(requests).put,
    routes: routeCounts(requests),
    stagesMs: {
      freezeAndPreparationMs: null,
      fullIntendedCanonicalisationMs: null,
      ...Object.fromEntries(Object.entries(observed.measures).map(([key, value]) => [key, rounded(value)])),
    },
    totalMs: rounded(totalMs),
    limitations: ["freeze/preparation and P172 full-canonicalisation have no separate public timing seam", "logical-object resolver count is unavailable for the pre-existing accepted session", "byte totals are not exposed by the offline transport"],
  };
}

async function oneRun(count) {
  const { h } = await readyPostReentry(count);
  const openObserved = observeOpenAndReentry(h.context);
  const reentryRequestStart = h.requests.length;
  const reentryStarted = performance.now();
  const reopened = await h.context.PocketSyncActiveIntegration.openExisting();
  const reentryMs = performance.now() - reentryStarted;
  assert.equal(reopened.ok, true, JSON.stringify(reopened));
  assert.equal(h.context.__p180State.nodes.length, count, "re-entry restores all N nodes");
  assert.equal(openObserved.counts.materializedNodes, count, "accepted materialisation covers all N nodes");
  assert.ok(openObserved.counts.materializeCalls >= 1, "re-entry materialises accepted truth");
  const reentryRequests = h.requests.slice(reentryRequestStart);
  const open = {
    N: count,
    remoteOpenMs: rounded(openObserved.measures.remoteOpenMs || 0),
    materializeMs: rounded(openObserved.measures.materializeMs || 0),
    reentryTotalMs: rounded(reentryMs),
    nodesMaterialized: openObserved.counts.materializedNodes,
    materializeCalls: openObserved.counts.materializeCalls,
    logicalResolvesObserved: openObserved.counts.logicalResolves,
    contentReadsObserved: openObserved.counts.contentReads,
    placementReadsObserved: openObserved.counts.placementReads,
    objectReads: routeCounts(reentryRequests).get,
    bytesResolved: null,
    decryptionsAndValidations: null,
    limitations: ["transport does not expose per-read response-byte totals", "cryptographic validation events are not individually surfaced by this harness"],
  };
  const expectedOrder = Array.from({ length: count }, (_unused, index) => `p364-${String(index).padStart(4, "0")}`);
  moveExpectedLeft(expectedOrder, "p364-0001");
  const d1 = await saveCase(h, count, 1, 10, expectedOrder);
  const d10 = await saveCase(h, count, 10, 20, expectedOrder);
  return { open, saves: [d1, d10] };
}

function medianRow(rows) {
  const base = { ...rows[0] };
  base.totalMs = median(rows.map((row) => row.totalMs));
  base.stagesMs = Object.fromEntries(Object.keys(base.stagesMs).map((key) => {
    const values = rows.map((row) => row.stagesMs[key]).filter((value) => value !== null && value !== undefined);
    return [key, values.length ? median(values) : null];
  }));
  return base;
}

test("P364 measures accepted offline Open/re-entry and ordinary Save scaling without changing production", { timeout: 420000 }, async () => {
  const samples = [];
  for (const count of SIZES) {
    for (let repeat = 0; repeat < REPEATS; repeat += 1) samples.push(await oneRun(count));
  }
  const open = SIZES.map((count) => {
    const rows = samples.filter((sample) => sample.open.N === count).map((sample) => sample.open);
    return {
      ...rows[0],
      remoteOpenMs: median(rows.map((row) => row.remoteOpenMs)),
      materializeMs: median(rows.map((row) => row.materializeMs)),
      reentryTotalMs: median(rows.map((row) => row.reentryTotalMs)),
      objectReads: median(rows.map((row) => row.objectReads)),
    };
  });
  const saves = SIZES.flatMap((count) => [1, 10].map((d) => medianRow(samples
    .filter((sample) => sample.open.N === count)
    .map((sample) => sample.saves.find((row) => row.D === d)))));
  const report = Object.freeze({
    task: "P364", repeats: REPEATS, timing: "Node performance.now() monotonic wall-clock observations; medians only; no thresholds",
    open, saves,
    productionMutation: false,
    network: "offline in-process P176/P190 harness only",
  });
  console.log(`P364_OFFLINE_SCALING_BASELINE ${JSON.stringify(report)}`);
});
