"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const ROOT = path.resolve(__dirname, "..");
const MODULE = "js/pocket-starling-owner-bootstrap.js";
const source = fs.readFileSync(path.join(ROOT, MODULE), "utf8");
const HEAD_SCHEMA = "pocket.starling.head.v1";
const SYNCED_POCKET_ID = "p176b-pocket";
const DEVICE_ID = "p176b-device";
const MASTER_KEY = Object.freeze({ kind: "master-key" });
const SEMANTIC_AUTHORITY = Object.freeze({ kind: "semantic-authority" });
const WRITTEN_AT = "2044-01-01T00:00:00.000Z";

function clone(value) {
  return value === undefined ? undefined : JSON.parse(JSON.stringify(value));
}

function head(revision, sealRef) {
  return Object.freeze({ schema: HEAD_SCHEMA, revision, sealRef });
}

function finalDocument() {
  return {
    schema: "portal.mtt.web.v1",
    writtenAt: WRITTEN_AT,
    nodes: [],
    tombstones: [],
    rootExtras: {},
    dataExtras: {},
  };
}

function deviceRecord(storeRevision, stage) {
  return {
    kind: "pocket.sync.device-state",
    schemaVersion: 5,
    storeRevision,
    syncedPocketId: SYNCED_POCKET_ID,
    deviceId: DEVICE_ID,
    deviceWrappingKey: Object.freeze({ kind: "device-wrapping-key" }),
    deviceEnvelope: {
      context: { syncedPocketId: SYNCED_POCKET_ID, envelopeId: "p176b-envelope" },
      metadata: { kind: "device", deviceId: DEVICE_ID },
      record: { ciphertext: "opaque-device-envelope" },
    },
    content: {
      context: { syncedPocketId: SYNCED_POCKET_ID, revision: 1 },
      record: { ciphertext: "opaque-content" },
    },
    remote: { confirmedRevision: 1, pending: null, conflict: null },
    activationDraft: { stage },
  };
}

function createHarness({ mutateDuringBootstrap = false } = {}) {
  let stored = deviceRecord(1, "ready-for-adoption");
  let active = false;
  let generation = 0;
  let token = null;
  let remoteHead = null;
  const counts = { readPocket: 0, init: 0, cas: 0, stage: 0 };
  const payload = { schema: "portal.export.v1", data: {} };

  const baseController = {
    canAdoptSyncedOwner: async () => ({ ok: true }),
    async adoptSyncedOwner() { return { ok: false, reason: "not-used" }; },
    async adoptReadyActivation() {
      generation += 1;
      token = Object.freeze({ generation });
      active = true;
      return { ok: true, owner: { syncedPocketId: SYNCED_POCKET_ID } };
    },
    async adoptReadyRecovery() { return { ok: false, reason: "not-used" }; },
    releaseSyncedOwner() { active = false; token = null; generation += 1; return true; },
    captureSyncedOwnerSaveSession() {
      return active ? Object.freeze({ token, generation, syncedPocketId: SYNCED_POCKET_ID }) : null;
    },
    isSyncedOwnerSaveSessionCurrent(session) {
      return !!active && !!session && session.token === token
        && session.generation === generation && session.syncedPocketId === SYNCED_POCKET_ID;
    },
    getSyncedOwnerState() {
      return active ? Object.freeze({
        syncedPocketId: SYNCED_POCKET_ID,
        confirmedRemoteRevision: 1,
        knownRemoteRevision: 1,
        pending: false,
        generation,
      }) : null;
    },
    async saveSyncedOwner() { return { ok: false, reason: "not-used" }; },
  };

  const context = {
    Object, Array, String, Number, Boolean, Map, Set, WeakMap, WeakSet,
    Error, Promise, JSON, Date, Uint8Array,
    console: { log() {}, info() {}, warn() {}, error() {} },
    document: { currentScript: null },
    PocketSyncOwnerController: Object.freeze({
      createSyncedOwnerController() { return baseController; },
    }),
    PocketSyncCrypto: Object.freeze({ encodeBase64Url() { return "unused"; } }),
    PocketStarlingBridgeShadow: Object.freeze({
      encode() {
        return { ok: true, bridge: { structural: { relation: { children: { root: [] } } } } };
      },
    }),
    PocketStarlingRootShadow: Object.freeze({
      build() { return { ok: true, state: Object.freeze({}) }; },
    }),
    PocketStarlingPlacementShadow: Object.freeze({
      audit() { return { ok: true, relation: { children: { root: [] } } }; },
    }),
    PocketStarlingObjectSealShadow: Object.freeze({
      createStager() { return { store: new Map() }; },
      stageCandidate() { return { ok: true, stage: { sealRef: "logical-seal" } }; },
      auditCandidateSeal() { return { ok: true }; },
      semanticAuditProvenance() { return Object.freeze({}); },
      canonical(value) { return { ok: true, bytes: JSON.stringify(value) }; },
    }),
    PocketStarlingSemanticAuthorityShadow: Object.freeze({
      async issueInitial() { return { ok: true, proof: Object.freeze({}) }; },
    }),
    PocketStarlingStorageShadow: Object.freeze({
      async stageCandidate() {
        counts.stage += 1;
        if (mutateDuringBootstrap) stored = deviceRecord(3, "adopted-mutated");
        return { sealStorageRef: "storage:genesis" };
      },
    }),
    PocketStarlingHeadShadow: Object.freeze({
      validHead(value) { return value; },
      OUTCOME: Object.freeze({ COMMITTED: "committed", CONFLICT: "conflict" }),
    }),
    PocketStarlingPublicationShadow: Object.freeze({
      createPublisher({ objectHeadService }) {
        return Object.freeze({
          async publishCandidate({ stage, expectedHead }) {
            await objectHeadService.putOpaqueObject({ storageRef: stage.sealStorageRef, record: {} });
            const response = await objectHeadService.compareAndSetShadowHead({
              expectedHead,
              candidateSealStorageRef: stage.sealStorageRef,
            });
            return { outcome: "committed", head: response.head };
          },
        });
      },
      createReconciler() {
        return Object.freeze({ async reconcileAmbiguousPublication() { return { outcome: "not-committed" }; } });
      },
    }),
    PocketStarlingRemoteOpenShadow: Object.freeze({
      createRemoteOpener() {
        return Object.freeze({
          async openRemote() {
            return {
              outcome: "opened",
              head: remoteHead,
              session: {
                acceptedSealRef: "storage:genesis",
                async resolveLogical() { return JSON.stringify({ previousSealRef: null }); },
              },
            };
          },
        });
      },
    }),
    PocketStarlingMaterializeShadow: Object.freeze({
      async materializeAccepted() { return { ok: true, document: finalDocument() }; },
    }),
  };
  context.window = context;
  context.globalThis = context;
  vm.createContext(context);
  vm.runInContext(source, context, { filename: MODULE });

  const crypto = Object.freeze({
    validateNonExtractableAesKey(value) {
      if (value !== MASTER_KEY) throw new Error("wrong key");
      return value;
    },
    async openMasterKeyBundle(_record, _wrappingKey, _context, _extras, options) {
      return options?.semanticAuthority
        ? { masterKey: MASTER_KEY, semanticAuthority: SEMANTIC_AUTHORITY }
        : { masterKey: MASTER_KEY };
    },
    async openContent() { return payload; },
  });

  const deviceStore = Object.freeze({
    async readPocket(syncedPocketId) {
      counts.readPocket += 1;
      assert.equal(syncedPocketId, SYNCED_POCKET_ID);
      return stored;
    },
  });

  const objectHeadService = Object.freeze({
    async putOpaqueObject() { return { created: true }; },
    async getOpaqueObject() { return { present: true, record: {} }; },
    async objectPresence() { return { rows: [] }; },
    async initialiseShadowHead() {
      counts.init += 1;
      if (remoteHead === null) remoteHead = head(0, null);
      return { head: remoteHead };
    },
    async readShadowHead() { return { head: remoteHead }; },
    async compareAndSetShadowHead({ expectedHead, candidateSealStorageRef }) {
      counts.cas += 1;
      assert.equal(remoteHead.revision, expectedHead.revision);
      assert.equal(remoteHead.sealRef, expectedHead.sealRef);
      remoteHead = head(1, candidateSealStorageRef);
      return { head: remoteHead };
    },
  });

  const controller = context.PocketSyncOwnerController.createSyncedOwnerController({
    crypto,
    deviceStore,
    contentService: Object.freeze({ async conditionalUpload() { throw new Error("not-used"); } }),
    randomBytes(length) { return new Uint8Array(length); },
    starlingBootstrap: {
      objectHeadService,
      operationIdFactory: (kind, index) => `p176b-${kind}-${index}`,
      normaliseInput() {
        return {
          schema: "portal.mtt.web.v1", writtenAt: WRITTEN_AT,
          nodes: [], tombstones: [], rootExtras: {},
        };
      },
      normaliseRootExtras() { return {}; },
    },
  });

  return {
    controller,
    counts,
    finaliseActivation() { stored = deviceRecord(2, "adopted"); },
    stored() { return stored; },
    remoteHead() { return remoteHead; },
  };
}

const activationOwner = Object.freeze({
  ownerKind: "synced",
  activationId: "p176b-activation",
  syncedPocketId: SYNCED_POCKET_ID,
  deviceId: DEVICE_ID,
  confirmedRemoteRevision: 1,
  syncPending: false,
});

test("P176b fresh activation defers P162 mirror until final adopted device truth", async () => {
  const h = createHarness();
  const adopted = await h.controller.adoptReadyActivation(activationOwner);
  assert.equal(adopted.ok, true, JSON.stringify(adopted));
  assert.equal(h.controller.getStarlingBootstrapState(), null);
  assert.equal(h.counts.readPocket, 0, "P162 must not capture the ready-for-adoption record");

  h.finaliseActivation();
  assert.equal(h.stored().storeRevision, 2);
  assert.equal(h.stored().activationDraft.stage, "adopted");
  assert.equal(h.controller.getStarlingBootstrapState(), null);

  const bootstrapped = await h.controller.bootstrapInitialStarlingBase();
  assert.equal(bootstrapped.ok, true, JSON.stringify(bootstrapped));
  assert.equal(bootstrapped.reason, "ready");
  assert.equal(bootstrapped.sourceRevision, 1);
  assert.equal(h.controller.getStarlingBootstrapState().sourceRevision, 1);
  assert.equal(h.remoteHead().revision, 1);
  assert.equal(h.counts.init, 1);
  assert.equal(h.counts.cas, 1);
  assert.ok(h.counts.readPocket >= 3, "capture and exact source guards must read final durable truth");
});

test("P176b final-record source mutation after lazy capture remains bootstrap-source-stale", async () => {
  const h = createHarness({ mutateDuringBootstrap: true });
  assert.equal((await h.controller.adoptReadyActivation(activationOwner)).ok, true);
  assert.equal(h.counts.readPocket, 0);
  h.finaliseActivation();

  const result = await h.controller.bootstrapInitialStarlingBase();
  assert.equal(result.ok, false);
  assert.equal(result.reason, "bootstrap-source-stale");
  assert.equal(h.controller.getStarlingBootstrapState(), null);
  assert.equal(h.counts.stage, 1);
  assert.equal(h.counts.init, 0, "stale source must be rejected before Head initialisation");
  assert.equal(h.counts.cas, 0, "stale source must not advance Head");
  assert.equal(h.remoteHead(), null);
});
