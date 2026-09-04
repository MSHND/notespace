"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { webcrypto } = require("node:crypto");

const ROOT = path.resolve(__dirname, "..");
const MODULE = "js/pocket-starling-real-truth-admission.js";
const source = (file) => fs.readFileSync(path.join(ROOT, file), "utf8");
const HEAD = Object.freeze({ schema: "pocket.starling.head.v1", revision: 1, sealRef: "storage:head-one" });
const WHOLE = Object.freeze({ authorityRevision: 1, currentMode: "whole-record", transition: null,
  rollbackRevision: null, adoptionHead: null });
const STARLING = Object.freeze({ authorityRevision: 3, currentMode: "starling", transition: null,
  rollbackRevision: 1, adoptionHead: HEAD });

function plain(value) { return JSON.parse(JSON.stringify(value)); }
function whole(revision = 1, transition = null) {
  return { authorityRevision: revision, currentMode: "whole-record", transition,
    rollbackRevision: null, adoptionHead: null };
}

function harness(options = {}) {
  const counts = { authority: 0, bootstrap: 0, underlyingSave: 0, freeze: 0 };
  let bootstrapState = options.bootstrapState === undefined ? null : options.bootstrapState;
  const authoritySequence = Array.isArray(options.authorities) ? options.authorities.slice()
    : [options.authority === undefined ? WHOLE : options.authority];
  function nextAuthority() {
    const index = Math.min(counts.authority, authoritySequence.length - 1);
    const value = authoritySequence[index];
    counts.authority += 1;
    if (value instanceof Error) throw value;
    return value;
  }
  const payload = { schema: "portal.export.v1", data: {}, norm: {
    schema: "portal.mtt.web.v1", writtenAt: "2044-01-01T00:00:00.000Z",
    nodes: [], tombstones: [], rootExtras: {}, dataExtras: {},
  } };
  const authorityService = Object.freeze({
    async read() { return { authority: nextAuthority() }; },
    async acquireFence() { throw new Error("unused"); },
    async commitStarlingAdoption() { throw new Error("unused"); },
    async releaseFence() { throw new Error("unused"); },
  });
  const context = {
    Object, Array, String, Number, Boolean, Map, Set, WeakMap, WeakSet, Error, Promise, JSON, Date,
    Uint8Array, TextEncoder, TextDecoder, ArrayBuffer, crypto: webcrypto,
    console: { log() {}, warn() {}, error() {} },
    document: { currentScript: { dataset: { serviceRoot: "/sync" } } },
    normaliseInput(value) { return value.norm; },
    normaliseRootExtras() { return {}; },
    PocketSyncCrypto: { encodeBase64Url(bytes) { return Buffer.from(bytes).toString("base64url"); } },
    PocketSyncRemoteClient: {
      createBrowserJsonTransport() { return {}; },
      createPersistenceAuthorityService() { return authorityService; },
      createObjectHeadService() { return { async readShadowHead() { return { head: HEAD }; } }; },
    },
    PocketStarlingObjectSealShadow: {
      ROOT_SCHEMA: "root-v1", SEAL_SCHEMA: "seal-v1", OBJECT_SCHEMA: "object-v1", SEQUENCE_SCHEMA: "sequence-v2",
      canonical(value) { return { ok: true, bytes: JSON.stringify(value) }; },
      refFor() { return "proof-ref:v1:none:00000000"; },
    },
    PocketStarlingBridgeShadow: {
      encode() { return { ok: true, bridge: { structural: { relation: { children: { root: [] } } } } }; },
    },
    PocketStarlingPlacementShadow: { audit(structural) { return { ok: true, relation: structural.relation }; } },
    PocketStarlingLogicalEditShadow: { async compose() { return { ok: false }; } },
    PocketStarlingRemoteEditShadow: { async createEditor() { return {}; } },
    PocketStarlingDurablePublication: {
      validateDescriptor(value) { return value; }, descriptorFromPrepared(value) { return value; },
      createCoordinator() { return { async attemptHead() {}, async ensureObjects() {}, async reconcile() {} }; },
    },
  };
  const baseController = {
    captureSyncedOwnerSaveSession() { return { syncedPocketId: "pocket", generation: 1 }; },
    isSyncedOwnerSaveSessionCurrent() { return true; },
    async saveSyncedOwner(input) {
      counts.underlyingSave += 1;
      await input.freezePayload();
      return { ok: true, reason: "underlying-saved" };
    },
    async adoptSyncedOwner() { return { ok: true }; }, releaseSyncedOwner() { return true; },
  };
  if (options.bootstrapApi !== false) {
    baseController.getStarlingBootstrapState = () => bootstrapState;
    baseController.bootstrapInitialStarlingBase = async () => {
      counts.bootstrap += 1;
      if (options.bootstrapThrows) throw new Error("secret-provider-error-must-not-escape");
      const result = options.bootstrapResult === undefined
        ? { ok: true, sourceRevision: 1, head: HEAD } : options.bootstrapResult;
      if (result?.ok === true && options.leaveNotReady !== true) {
        bootstrapState = options.readyAfterBootstrap === undefined
          ? { ready: true, generation: 1, sourceRevision: 1, head: HEAD }
          : options.readyAfterBootstrap;
      }
      return result;
    };
  }
  context.PocketSyncOwnerController = Object.freeze({ createSyncedOwnerController() { return baseController; } });
  context.window = context;
  context.globalThis = context;
  vm.createContext(context);
  vm.runInContext(source(MODULE), context, { filename: MODULE });
  const controller = context.PocketSyncOwnerController.createSyncedOwnerController({});
  async function save() {
    return controller.saveSyncedOwner({ async freezePayload() { counts.freeze += 1; return payload; } });
  }
  return { context, controller, counts, payload, save };
}

for (const reason of [
  "bootstrap-unavailable",
  "bootstrap-source-authentication-failed",
  "bootstrap-source-stale",
  "bootstrap-equivalence-failed",
]) {
  test(`P176 propagates bounded P162 ${reason} without underlying Save`, async () => {
    const h = harness({ bootstrapResult: { ok: false, reason } });
    const result = await h.save();
    assert.deepEqual(plain(result), { ok: false, reason: "starling-cutover-bootstrap-failed", bootstrapReason: reason });
    assert.equal(h.counts.bootstrap, 1);
    assert.equal(h.counts.underlyingSave, 0);
    assert.equal(h.counts.freeze, 1);
  });
}

test("P176 collapses arbitrary bootstrap failure text to one bounded value", async () => {
  const h = harness({ bootstrapResult: { ok: false, reason: "DATABASE_URL=do-not-echo" } });
  const result = await h.save();
  assert.deepEqual(plain(result), { ok: false, reason: "starling-cutover-bootstrap-failed",
    bootstrapReason: "bootstrap-failure-unclassified" });
  assert.equal(JSON.stringify(result).includes("DATABASE_URL"), false);
  assert.equal(h.counts.underlyingSave, 0);
});

test("P176 classifies bootstrap throw without leaking thrown text", async () => {
  const h = harness({ bootstrapThrows: true });
  const result = await h.save();
  assert.deepEqual(plain(result), { ok: false, reason: "starling-cutover-bootstrap-threw" });
  assert.equal(JSON.stringify(result).includes("provider"), false);
  assert.equal(h.counts.bootstrap, 1);
  assert.equal(h.counts.underlyingSave, 0);
});

test("P176 refuses ok bootstrap whose current readiness state is absent or invalid", async () => {
  for (const readyAfterBootstrap of [null, { ready: true, sourceRevision: 0, head: HEAD },
    { ready: true, sourceRevision: 1, head: null }]) {
    const h = harness({ readyAfterBootstrap });
    const result = await h.save();
    assert.deepEqual(plain(result), { ok: false, reason: "starling-cutover-bootstrap-not-ready" });
    assert.equal(h.counts.underlyingSave, 0);
  }
});

test("P176 refuses missing bootstrap API before handing a whole-record Save down", async () => {
  const h = harness({ bootstrapApi: false });
  const result = await h.save();
  assert.deepEqual(plain(result), { ok: false, reason: "starling-cutover-bootstrap-failed",
    bootstrapReason: "bootstrap-unavailable" });
  assert.equal(h.counts.bootstrap, 0);
  assert.equal(h.counts.underlyingSave, 0);
});

test("P176 refuses unavailable or invalid initial shared authority before bootstrap", async () => {
  for (const authority of [null, new Error("read failed"), { authorityRevision: 0, currentMode: "whole-record" }]) {
    const h = harness({ authority });
    const result = await h.save();
    assert.deepEqual(plain(result), { ok: false, reason: "starling-cutover-authority-unavailable" });
    assert.equal(h.counts.bootstrap, 0);
    assert.equal(h.counts.underlyingSave, 0);
  }
});

test("P176 re-proves the whole-record authority epoch after bootstrap", async () => {
  for (const second of [whole(2), whole(2, { transitionId: "other", expectedAuthorityRevision: 1 }), STARLING]) {
    const h = harness({ authorities: [whole(1), second] });
    const result = await h.save();
    assert.deepEqual(plain(result), { ok: false, reason: "starling-cutover-authority-changed" });
    assert.equal(h.counts.bootstrap, 1);
    assert.equal(h.counts.underlyingSave, 0);
  }
});

test("P176 refuses unavailable authority re-proof after successful bootstrap", async () => {
  const h = harness({ authorities: [whole(1), null] });
  const result = await h.save();
  assert.deepEqual(plain(result), { ok: false, reason: "starling-cutover-authority-unavailable" });
  assert.equal(h.counts.bootstrap, 1);
  assert.equal(h.counts.underlyingSave, 0);
});

test("P176 reuses a current accepted P162 base, re-proves authority and freezes once", async () => {
  const h = harness({ bootstrapState: { ready: true, generation: 1, sourceRevision: 1, head: HEAD },
    authorities: [whole(1), whole(1), whole(1)] });
  const result = await h.save();
  assert.equal(result.ok, true, JSON.stringify(result));
  assert.equal(h.counts.bootstrap, 0);
  assert.equal(h.counts.underlyingSave, 1);
  assert.equal(h.counts.freeze, 1);
  assert.ok(h.counts.authority >= 2);
});

test("P176 preserves already-Starling ordinary Save without P162 bootstrap", async () => {
  const h = harness({ authority: STARLING });
  const result = await h.save();
  assert.equal(result.ok, true, JSON.stringify(result));
  assert.equal(h.counts.bootstrap, 0);
  assert.equal(h.counts.underlyingSave, 1);
  assert.equal(h.counts.freeze, 1);
});

test("P176 refuses an initially transitioning whole-record authority", async () => {
  const h = harness({ authority: whole(2, { transitionId: "active", expectedAuthorityRevision: 1 }) });
  const result = await h.save();
  assert.deepEqual(plain(result), { ok: false, reason: "starling-cutover-authority-changed" });
  assert.equal(h.counts.bootstrap, 0);
  assert.equal(h.counts.underlyingSave, 0);
});
