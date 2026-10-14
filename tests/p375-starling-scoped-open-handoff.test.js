"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const ROOT = path.resolve(__dirname, "..");
const source = (file) => fs.readFileSync(path.join(ROOT, file), "utf8");
const plain = (value) => JSON.parse(JSON.stringify(value));

// Reuse the accepted P124 genuine publication, encryption and remote fixture
// builders without registering or executing the separate P124 test suite.
function p124Fixture() {
  const filename = path.join(__dirname, "p124-starling-remote-open.test.js");
  const original = fs.readFileSync(filename, "utf8");
  const declaration = 'const test = require("node:test"),';
  assert.ok(original.includes(declaration), "accepted P124 fixture layout");
  const sandbox = { exports: {} };
  new Function("require", "module", "exports", "__filename", "__dirname",
    original.replace(declaration, "const test = () => {},")
    + "\nmodule.exports = { runtime, logicalStage, logicalConfirm, keyFor, physicalStage,"
    + " remoteState, publishGenuine, serviceFor, keyBundles };\n")(
      require, sandbox, sandbox.exports, filename, __dirname);
  return sandbox.exports;
}
const fixture = p124Fixture();

async function genuineNestedSource() {
  const c = fixture.runtime();
  for (const file of [
    "js/pocket-starling-materialize-shadow.js",
    "js/pocket-sync-additional-device.js",
  ]) vm.runInContext(source(file), c, { filename: file });
  const outline = {
    schema: "portal.mtt.web.v1",
    writtenAt: "2026-10-14T00:00:00.000Z",
    nodes: [
      { id: "parent", parentId: "root", order: 0, label: "Parent" },
      { id: "sibling", parentId: "root", order: 1, label: "Sibling" },
      { id: "deep", parentId: "parent", order: 0, label: "Not yet reached" },
      { id: "deeper", parentId: "deep", order: 0, label: "Still unreached" },
    ],
    tombstones: [], rootExtras: {}, dataExtras: {},
  };
  const encoded = c.PocketStarlingBridgeShadow.encode(outline, { capacity: 4 });
  assert.equal(encoded.ok, true, JSON.stringify(encoded));
  const built = c.PocketStarlingRootShadow.build(encoded.bridge);
  assert.equal(built.ok, true, JSON.stringify(built));
  const stager = c.PocketStarlingObjectSealShadow.createStager();
  const logical = fixture.logicalStage(c, stager, built.state);
  const key = await fixture.keyFor(c);
  const physical = await fixture.physicalStage(c, stager, logical, key);
  fixture.logicalConfirm(c, stager, logical);
  const stage = { state: built.state, stager, logical, key, physical };
  const remote = fixture.remoteState();
  await fixture.publishGenuine(c, stage, remote);
  return { c, stage, remote, outline };
}

async function rig({ mode = "starling" } = {}) {
  const { c, stage, remote, outline } = await genuineNestedSource();
  const bundle = fixture.keyBundles.get(stage.key);
  assert.ok(bundle && bundle.record && bundle.semanticAuthority);
  const timeline = [], sessions = [], readerInputs = [], sourceCalls = [];
  const writes = { store: 0, head: 0, cas: 0, recovery: 0, export: 0, save: 0 };
  let targetId = "original";
  let rejectGets = false;
  let rejectP368 = null;
  let corruptInitial = false;
  let authorityRevision = 7;
  let badSemantic = false;
  let materials = 0;
  let readerBuilds = 0;
  let callbackReader = null;
  const serviceCalls = [];
  const remoteService = fixture.serviceFor(c, remote, serviceCalls);
  const objectHeadService = {
    readShadowHead: (args) => remoteService.readShadowHead(args),
    async getOpaqueObject(args) {
      if (rejectGets) throw Error("test: unavailable scoped child object");
      return remoteService.getOpaqueObject(args);
    },
  };
  const originalP124 = c.PocketStarlingRemoteOpenShadow;
  c.PocketStarlingRemoteOpenShadow = Object.freeze({
    createRemoteOpener(args) {
      const realOpener = originalP124.createRemoteOpener(args);
      return Object.freeze({ async openRemote(input) {
        const opened = await realOpener.openRemote(input);
        if (opened.outcome === "opened") {
          timeline.push("p124-authenticated");
          sessions.push(opened.session);
        }
        return opened;
      } });
    },
  });
  const originalP368 = c.PocketStarlingMaterializeShadow;
  c.PocketStarlingMaterializeShadow = Object.freeze({
    async createAcceptedSnapshotReader(session) {
      readerBuilds += 1;
      readerInputs.push(session);
      timeline.push("p368-enter");
      if (rejectP368 === "incompatible") return Object.freeze({
        ok: true, scope: "incomplete",
        acceptedSealRef: "wrong-logical-seal",
        readChildren() {}, readReachedNode() {},
      });
      if (rejectP368 === "failed") return Object.freeze({ ok: false, reason: "invalid-root" });
      const checkedSession = corruptInitial
        ? { ...session, async resolveLogical(ref) {
            return ref === session.acceptedSealRef ? "{" : session.resolveLogical(ref);
          } }
        : session;
      const reader = await originalP368.createAcceptedSnapshotReader(checkedSession);
      timeline.push(reader.ok === true ? "p368-ready" : "p368-rejected");
      return reader;
    },
    async materializeAccepted(session) {
      materials += 1;
      timeline.push("full-materialize");
      return originalP368.materializeAccepted(session);
    },
  });
  const completedRecord = {
    kind: "pocket.sync.device-state",
    schemaVersion: 5,
    syncedPocketId: "p124",
    deviceId: "device-p375",
    storeRevision: 1,
    additionalDeviceDraft: null,
    recoveryDraft: null,
    activationDraft: null,
    deviceWrappingKey: bundle.wrappingKey,
    deviceEnvelope: {
      context: bundle.envelopeContext,
      metadata: {
        syncedPocketId: "p124",
        deviceId: "device-p375",
        kind: "device",
        version: 1,
        envelopeId: bundle.envelopeContext.envelopeId,
        kdf: "none",
      },
      record: bundle.record,
    },
    content: {
      context: { syncedPocketId: "p124", revision: 1, contentType: "portal.export.v1+json" },
      record: {},
    },
    remote: { confirmedRevision: 1, pending: null, conflict: null },
    usage: { masterKeyGeneration: 1, masterKeyContentEncryptions: 0,
      masterKeyContentEncryptionLimit: 2 ** 20 },
  };
  const envelopeService = {
    async listEnvelopes() { return {
      keySetVersion: 1,
      envelopes: [{
        status: "active", envelopeKind: "device",
        envelopeId: bundle.envelopeContext.envelopeId,
        envelopeVersion: 1, deviceId: "device-p375",
        credentialId: null, kdf: "none", kdfSalt: null, derivationVersion: null,
      }],
    }; },
    async downloadEnvelope() { throw Error("completed device must not download PRF"); },
    async addEnvelope() { writes.store += 1; throw Error("completed device must not enrol"); },
  };
  const deviceStore = {
    async open() {},
    async readPocket() { return completedRecord; },
    async createPocket() { writes.store += 1; throw Error("completed device must not create"); },
    async replacePocket() { writes.store += 1; throw Error("completed device must not replace"); },
    async reservePocketEncryptionUsage() { writes.store += 1; throw Error("completed device must not reserve"); },
  };
  let nextId = 0;
  const randomBytes = (length) => {
    const bytes = new Uint8Array(length);
    nextId += 1;
    bytes[0] = nextId & 255;
    bytes[1] = (nextId >> 8) & 255;
    bytes[2] = (nextId >> 16) & 255;
    return bytes;
  };
  const authority = () => ({
    authority: {
      schema: "pocket.sync.persistence-authority.v1",
      currentMode: mode,
      transition: null,
      authorityRevision,
      rollbackRevision: mode === "starling" ? 1 : null,
      adoptionHead: mode === "starling" ? { ...remote.head } : null,
    },
  });
  const contentService = {
    async readRevision() { return { recordPresent: true, revision: 1 }; },
    async downloadEncryptedRecord() {
      return { syncedPocketId: "p124", revision: 1, encryptedRecord: {} };
    },
  };
  let crypto = c.PocketSyncCrypto;
  const config = {
    crypto,
    deviceStore,
    accountClient: { async authenticatePasskey() {
      return { ok: true, accountAuthenticated: true, contentUnlocked: false,
        accountId: "account-p375", credentialId: "credential-p375",
        prf: { status: "unavailable" } };
    } },
    discoveryService: { async readSyncedPocket() {
      return { status: "ready", syncedPocketId: "p124" };
    } },
    contentService,
    envelopeService,
    persistenceAuthorityService: { async read() { return authority(); } },
    objectHeadService,
    randomBytes, now: () => 0,
  };
  const mainState = vm.runInContext("state", c);
  const mainTruth = {
    nodesRef: mainState.nodes,
    nodes: JSON.stringify(mainState.nodes),
    operations: JSON.stringify(mainState.ops ?? []),
    selectedId: mainState.selectedId,
  };
  let adopted = 0, authoritativeNodes = Object.freeze(["previous-current-Pocket"]);
  const dependencies = {
    captureTarget: () => ({ ownerKind: "detached", id: targetId }),
    // Deliberately always true to prove that sameTarget checks the
    // ORIGINAL identity, not merely this generic gate.
    isTargetCurrent: () => true,
    validatePayload: () => true,
    async adoptOpenedPocket(input) {
      timeline.push("adopt");
      adopted += 1;
      assert.equal(input.syncedPocketId, "p124");
      return { ok: true };
    },
  };
  function opener() {
    return c.PocketSyncAdditionalDevice.createAdditionalDeviceOpener(config);
  }
  return {
    c, stage, remote, outline, timeline, sessions, readerInputs, sourceCalls,
    writes, config, dependencies, opener, completedRecord, bundle, contentService,
    get adopted() { return adopted; },
    get authoritativeNodes() { return authoritativeNodes; },
    get mainTruth() { return mainTruth; },
    get mainState() { return mainState; },
    get materialized() { return materials; },
    get readerBuilds() { return readerBuilds; },
    get remoteCalls() { return serviceCalls; },
    setTarget(id) { targetId = id; },
    breakChildGets() { rejectGets = true; },
    rejectReader(type) { rejectP368 = type; },
    corruptInitial() { corruptInitial = true; },
    invalidateSemantic() {
      if (badSemantic) return;
      badSemantic = true;
      const real = c.PocketStarlingSemanticAuthorityShadow;
      c.PocketStarlingSemanticAuthorityShadow = Object.freeze({
        ...real, async authenticate() { throw Error("test: semantic authority invalid"); },
      });
    },
    onHook(fn) {
      dependencies.onScopedStarlingReader = async (reader, identity, isCurrent) => {
        timeline.push("scoped-hook");
        callbackReader = reader;
        sourceCalls.push(identity);
        return fn(reader, identity, isCurrent);
      };
    },
    get callbackReader() { return callbackReader; },
  };
}

function noObserverAuthorityEffects(r) {
  assert.equal(r.adopted, 0);
  assert.deepEqual(plain(r.authoritativeNodes), ["previous-current-Pocket"]);
  assert.strictEqual(r.mainState.nodes, r.mainTruth.nodesRef);
  assert.equal(JSON.stringify(r.mainState.nodes), r.mainTruth.nodes);
  assert.equal(JSON.stringify(r.mainState.ops ?? []), r.mainTruth.operations);
  assert.equal(r.mainState.selectedId, r.mainTruth.selectedId);
  assert.equal(r.writes.store, 0);
  assert.equal(r.writes.head, 0);
  assert.equal(r.writes.cas, 0);
  assert.equal(r.writes.recovery, 0);
  assert.equal(r.writes.export, 0);
  assert.equal(r.writes.save, 0);
  assert.equal(r.remoteCalls.some(([route]) =>
    ["putOpaqueObject", "compareAndSetShadowHead", "initialiseShadowHead"].includes(route)), false);
}

test("P375 real additional-device P124 → exact session P368 → scoped root BEFORE full materialisation", async () => {
  const r = await rig();
  let root, identity, guard;
  r.onHook(async (reader, source, isCurrent) => {
    assert.equal(r.readerInputs.length, 1);
    assert.strictEqual(r.readerInputs[0], r.sessions[0],
      "the exact authenticated P124 session must reach real P368");
    assert.equal(reader.ok, true);
    assert.equal(reader.scope, "incomplete");
    assert.equal(reader.acceptedSealRef, r.sessions[0].acceptedSealRef);
    assert.equal(source.acceptedSealRef, reader.acceptedSealRef);
    assert.equal(source.syncedPocketId, "p124");
    assert.equal(source.authorityRevision, 7);
    assert.equal(source.headRevision, 1);
    assert.equal(source.headSealStorageRef, r.remote.head.sealRef);
    assert.notEqual(source.headSealStorageRef, source.acceptedSealRef,
      "physical Head Seal and logical Seal are distinct");
    assert.deepEqual(Object.keys(source).sort(), [
      "acceptedSealRef", "authorityRevision", "headRevision",
      "headSealStorageRef", "syncedPocketId",
    ]);
    assert.equal(Object.isFrozen(source), true);
    for (const secret of ["masterKey", "prf", "credential", "accountClient", "payload",
      "adoptOpenedPocket", "installSyncedOwnerForSave"]) {
      assert.equal(Object.hasOwn(source, secret), false);
      assert.equal(Object.hasOwn(reader, secret), false);
    }
    assert.equal(isCurrent(), true);
    assert.equal(Object.isFrozen(isCurrent), true);
    assert.equal(r.materialized, 0);
    const discovered = await reader.readChildren("root");
    assert.equal(discovered.ok, true, JSON.stringify(discovered));
    assert.equal(discovered.scope, "incomplete");
    assert.deepEqual(plain(discovered.nodes.map(x => x.id)), ["parent", "sibling"]);
    assert.equal((await reader.readReachedNode("deep")).ok, false,
      "unreached descendants must not become known leaves");
    assert.equal(r.materialized, 0, "scoped root must precede any full materialisation");
    r.timeline.push("root-validated");
    root = discovered;
    identity = source;
    guard = isCurrent;
    noObserverAuthorityEffects(r);
  });
  const result = await r.opener().openExisting(r.dependencies);
  assert.equal(result.ok, true, JSON.stringify(result));
  assert.equal(r.readerBuilds, 1);
  assert.equal(r.sourceCalls.length, 1);
  assert.equal(r.materialized, 1);
  assert.equal(r.adopted, 1);
  assert.equal(root.nodes.length, 2);
  assert.ok(identity && guard());
  assert.deepEqual(r.timeline.slice(0, 5), [
    "p124-authenticated", "p368-enter", "p368-ready", "scoped-hook", "root-validated",
  ]);
  assert.ok(r.timeline.indexOf("root-validated") < r.timeline.indexOf("full-materialize"));
  assert.ok(r.timeline.indexOf("full-materialize") < r.timeline.indexOf("adopt"));
  assert.deepEqual(plain(r.authoritativeNodes), ["previous-current-Pocket"]);
  assert.equal(r.remoteCalls.some(([route]) => route === "compareAndSetShadowHead"), false);
  assert.equal(r.remoteCalls.filter(([route]) => route === "readShadowHead").length, 1,
    "observer must reuse the already selected Head");
  assert.strictEqual(r.mainState.nodes, r.mainTruth.nodesRef);
  assert.equal(JSON.stringify(r.mainState.nodes), r.mainTruth.nodes);
  console.log("P375_ROOT_BEFORE_MATERIALISATION " + JSON.stringify({
    source: identity.acceptedSealRef, rootIds: plain(root.nodes.map(x => x.id)),
    rootBeforeFull: true, fullMaterialisationsAfterHook: 1,
  }));
});

test("P375 absent optional hook retains ordinary complete Open without constructing P368", async () => {
  const r = await rig();
  r.rejectReader("failed");
  const result = await r.opener().openExisting(r.dependencies);
  assert.equal(result.ok, true, JSON.stringify(result));
  assert.equal(r.readerBuilds, 0);
  assert.equal(r.sourceCalls.length, 0);
  assert.equal(r.materialized, 1);
  assert.equal(r.adopted, 1);
  assert.equal(r.remoteCalls.some(([route]) => route === "compareAndSetShadowHead"), false);
});

test("P375 missing accepted Seal and invalid semantic authority never deliver a reader", async () => {
  for (const cause of ["missing-seal", "semantic-authority"]) {
    const r = await rig();
    if (cause === "missing-seal") r.remote.objects.delete(r.remote.head.sealRef);
    else r.invalidateSemantic();
    let hooks = 0;
    r.onHook(async () => { hooks += 1; });
    const result = await r.opener().openExisting(r.dependencies);
    assert.equal(result.ok, false, cause);
    assert.equal(hooks, 0, cause);
    assert.equal(r.readerBuilds, 0, cause);
    assert.equal(r.materialized, 0, cause);
    noObserverAuthorityEffects(r);
  }
});

test("P375 malformed initial structure and incompatible P368 identity fail before hook", async () => {
  for (const cause of ["noncanonical", "failed", "incompatible"]) {
    const r = await rig();
    if (cause === "noncanonical") r.corruptInitial();
    else r.rejectReader(cause);
    let delivered = 0;
    r.onHook(() => { delivered += 1; });
    const result = await r.opener().openExisting(r.dependencies);
    assert.equal(result.ok, false, cause);
    assert.equal(delivered, 0, cause);
    assert.equal(r.readerBuilds, 1, cause);
    assert.equal(r.materialized, 0, cause);
    noObserverAuthorityEffects(r);
  }
});

test("P375 failed later scoped child read stays a scoped failure, and rejected observer blocks full Open", async () => {
  const r = await rig();
  let delivered = 0, scopedFailure;
  r.onHook(async (reader) => {
    delivered += 1;
    assert.equal(reader.ok, true, "initial accepted Seal was validated");
    r.breakChildGets();
    scopedFailure = await reader.readChildren("root");
    assert.equal(scopedFailure.ok, false);
    assert.equal(r.materialized, 0);
    throw Error("scoped child failure must fail the opted-in handoff");
  });
  const result = await r.opener().openExisting(r.dependencies);
  assert.equal(result.ok, false);
  assert.equal(delivered, 1, "valid reader was already supplied");
  assert.ok(scopedFailure && scopedFailure.ok === false);
  assert.equal(r.materialized, 0);
  noObserverAuthorityEffects(r);
});

test("P375 hook exception/rejection stop the selected opening before materialisation or adoption", async () => {
  for (const kind of ["exception", "rejection"]) {
    const r = await rig();
    r.onHook(() => {
      if (kind === "exception") throw Error("observer exception");
      return Promise.reject(Error("observer rejected"));
    });
    const result = await r.opener().openExisting(r.dependencies);
    assert.equal(result.ok, false, kind);
    assert.equal(r.readerBuilds, 1, kind);
    assert.equal(r.materialized, 0, kind);
    noObserverAuthorityEffects(r);
  }
});

test("P375 original captured target changing during P368 setup prevents callback even if generic guard is true", async () => {
  const r = await rig();
  let hooks = 0;
  const previous = r.c.PocketStarlingMaterializeShadow;
  r.c.PocketStarlingMaterializeShadow = Object.freeze({
    ...previous,
    async createAcceptedSnapshotReader(session) {
      const result = await previous.createAcceptedSnapshotReader(session);
      r.setTarget("replacement");
      return result;
    },
  });
  r.onHook(async () => { hooks += 1; });
  const result = await r.opener().openExisting(r.dependencies);
  assert.equal(result.ok, false);
  assert.equal(hooks, 0);
  assert.equal(r.readerBuilds, 1);
  assert.equal(r.materialized, 0);
  noObserverAuthorityEffects(r);
});

test("P375 delayed observer invalidates the ORIGINAL captured target, not merely current-target eligibility", async () => {
  const r = await rig();
  let started, release;
  const entered = new Promise(resolve => { started = resolve; });
  const pending = new Promise(resolve => { release = resolve; });
  let guard;
  r.onHook(async (_reader, _source, isCurrent) => {
    guard = isCurrent;
    started();
    await pending;
  });
  const opening = r.opener().openExisting(r.dependencies);
  await entered;
  assert.equal(guard(), true);
  r.setTarget("new-current-Pocket");
  assert.equal(guard(), false, "captured target invalidated");
  release();
  const result = await opening;
  assert.equal(result.ok, false);
  assert.equal(r.readerBuilds, 1);
  assert.equal(r.materialized, 0);
  noObserverAuthorityEffects(r);
});

test("P375 whole-record mode never invents a Starling reader or invokes the observer", async () => {
  const r = await rig({ mode: "whole-record" });
  r.config.crypto = Object.freeze({
    ...r.c.PocketSyncCrypto,
    async openContent() { return { schema: "portal.export.v1", source: "whole-record" }; },
  });
  let hooks = 0;
  r.onHook(async () => { hooks += 1; });
  const result = await r.opener().openExisting(r.dependencies);
  assert.equal(result.ok, true, JSON.stringify(result));
  assert.equal(hooks, 0);
  assert.equal(r.readerBuilds, 0);
  assert.equal(r.materialized, 0);
  assert.equal(r.adopted, 1);
});

test("P375 new-device path legitimately selects Starling twice without suppressing either observer call", async () => {
  const r = await rig();
  let provisional = null, localWrites = 0, serverEnvelopeWrites = 0, observations = 0;
  r.config.deviceStore = {
    async open() {},
    async readPocket() { return provisional; },
    async createPocket(record) { localWrites += 1; provisional = record; },
    async replacePocket(_id, _revision, record) { localWrites += 1; provisional = record; },
    async reservePocketEncryptionUsage() { throw Error("not needed"); },
  };
  r.config.accountClient = { async authenticatePasskey() {
    return { ok: true, accountAuthenticated: true, contentUnlocked: false,
      accountId: "account-p375", credentialId: "credential-p375",
      prf: { status: "available", outputBytes: new Uint8Array(32) } };
  } };
  const prfMetadata = {
    envelopeId: "prf-p375", envelopeKind: "passkey-prf",
    envelopeVersion: 1, deviceId: null, credentialId: "credential-p375",
    kdf: "HKDF-SHA-256", kdfSalt: "salt-p375", derivationVersion: 1,
  };
  r.config.envelopeService = {
    async listEnvelopes() { return { keySetVersion: 1,
      envelopes: [{ ...prfMetadata, status: "active" }] }; },
    async downloadEnvelope() { return { keySetVersion: 1,
      envelope: { ...prfMetadata, encryptedEnvelope: { fixture: "protected" } } }; },
    async addEnvelope() { serverEnvelopeWrites += 1;
      return { status: "committed", keySetVersion: 2,
        masterKeyGeneration: 1, masterKeyContentEncryptionLimit: 2 ** 20 }; },
  };
  // Only the PRF/enrolment envelope is test-driven; the P124 remote
  // opener, authenticated object reads and P368 validator remain real.
  r.config.crypto = Object.freeze({
    ...r.c.PocketSyncCrypto,
    async deriveWrappingKey() { return r.bundle.wrappingKey; },
    async openMasterKeyBundle(_record, _wrappingKey, _context, recipients = []) {
      return {
        masterKey: r.stage.key,
        semanticAuthority: r.bundle.semanticAuthority,
        envelopes: recipients.map(() => ({ record: r.bundle.record })),
      };
    },
  });
  r.onHook(async (reader, source, guard) => {
    observations += 1;
    assert.equal(guard(), true);
    assert.equal(source.acceptedSealRef, reader.acceptedSealRef);
    const top = await reader.readChildren("root");
    assert.equal(top.ok, true);
    assert.deepEqual(plain(top.nodes.map(x => x.id)), ["parent", "sibling"]);
  });
  const result = await r.opener().openExisting(r.dependencies);
  assert.equal(result.ok, true, JSON.stringify(result));
  assert.equal(observations, 2, "both legitimate Starling selections invoke the hook");
  assert.equal(r.readerBuilds, 2);
  assert.equal(r.materialized, 2);
  assert.equal(r.adopted, 1);
  assert.equal(localWrites, 2, "existing enrolment writes remain owned by the device flow");
  assert.equal(serverEnvelopeWrites, 1);
  assert.equal(r.remoteCalls.some(([route]) => ["compareAndSetShadowHead", "putOpaqueObject"].includes(route)), false);
});

test("P375 dormant hook is absent from ordinary browser composition and authority surfaces", () => {
  const src = source("js/pocket-sync-additional-device.js");
  assert.match(src, /onScopedStarlingReader/);
  assert.match(src, /createAcceptedSnapshotReader\(opened\.session\)/);
  for (const file of [
    "index.html", "js/pocket-sync-browser-runtime.js",
    "js/pocket-sync-local-integration.js",
    "sync-service/pocket-sync-production-server.js",
  ]) assert.doesNotMatch(source(file), /onScopedStarlingReader/);
  assert.doesNotMatch(src, /global\.onScopedStarlingReader\s*=/);
  assert.doesNotMatch(src, /global\.PocketProgressiveOpenState\s*=/);
});
