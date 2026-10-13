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
  const timestamp = "2044-01-01T00:00:00.000Z";
  context.__p180BaselineNodes = Array.from({ length: count }, (_unused, index) => ({
    id: `p364-${String(index).padStart(4, "0")}`,
    parentId: "root",
    order: index,
    label: `P364 node ${index}`,
    details: `offline baseline ${index}`,
    updatedAt: timestamp,
    source: "manual",
  }));
  vm.runInContext(
    "state.nodes=__p180BaselineNodes;state.tombstones=[];state.rootExtras={};state.dataExtras={};"
      + "state.ops=[];state.operationHighWater=0;state.operationDocumentAnchor=null;"
      + "state.activeSaveOperationCeiling=0;",
    context
  );
  context.__p180State = vm.runInContext("state", context);
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
  context.PocketStarlingLogicalEditShadow = Object.freeze({
    ...baseLogical,
    async compose(...args) {
      const result = await elapsedAsync(measures, "p139ComposeMs", () => baseLogical.compose(...args));
      if (result?.candidate?.newLogicalRefs) counts.composedRefs = result.candidate.newLogicalRefs.length;
      return result;
    },
  });
  context.PocketStarlingStorageShadow = Object.freeze({
    ...baseStorage,
    async stageCandidate(...args) {
      const result = await elapsedAsync(measures, "changedObjectStageMs", () => baseStorage.stageCandidate(...args));
      if (result?.newRecords) counts.stagedRecords = result.newRecords.length;
      return result;
    },
  });
  context.PocketStarlingDurablePublication = Object.freeze({
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
  context.PocketStarlingObjectSealShadow = Object.freeze({
    ...baseSeal,
    canonical(value) {
      if (value?.schema === "portal.mtt.web.v1" && Array.isArray(value.nodes)) {
        counts.canonicalCalls += 1;
        return elapsed(measures, "fullCanonicalMs", () => baseSeal.canonical(value));
      }
      return baseSeal.canonical(value);
    },
  });
  return { measures, counts };
}

function issueMoves(context, start, amount) {
  for (let index = start; index < start + amount; index += 1) {
    context.moveNodeWithinSiblings(`p364-${String(index).padStart(4, "0")}`, -1);
  }
  assert.equal(context.__p180State.ops.length, amount, `D=${amount} is retained before Save`);
}

async function saveCase(h, count, d, start) {
  issueMoves(h.context, start, d);
  const observed = observeSave(h.context);
  const requestsBefore = h.requests.length;
  const wholeBefore = h.routeCount("/pockets/content/conditional-upload");
  const totalStarted = performance.now();
  const saved = await h.context.exportTree({ returnDetails: true, downloadFallback: false });
  const totalMs = performance.now() - totalStarted;
  const requests = h.requests.slice(requestsBefore);
  assert.equal(saved.ok, true, JSON.stringify(saved));
  assert.equal(h.context.__p180State.ops.length, 0, `D=${d} is accepted`);
  assert.equal(h.routeCount("/pockets/content/conditional-upload"), wholeBefore, "no whole-record fallback");
  const remote = await h.readRemoteState();
  assert.equal(remote.authority.currentMode, "starling");
  assert.equal(remote.head.revision, d === 1 ? 3 : 4);
  return {
    N: count,
    D: d,
    userMutations: d,
    operationRecords: d,
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
  const d1 = await saveCase(h, count, 1, 10);
  const d10 = await saveCase(h, count, 10, 20);
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

test("P364 measures accepted offline Open/re-entry and ordinary Save scaling without changing production", { timeout: 300000 }, async () => {
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
