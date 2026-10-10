"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const fixtures = require("./helpers/p032-remote-fixtures.js");

const ROOT = path.resolve(__dirname, "..");
const SCHEMA = "pocket.sync.owner-session.v1";
const ACCOUNT = "account-a";
const POCKET = "pocket-a";
const TAG_A = "a".repeat(64);
const TAG_B = "b".repeat(64);
const NOW = Date.parse("2030-01-01T00:00:00.000Z");
const FUTURE = "2040-01-01T00:00:00.000Z";
const CREDENTIAL = fixtures.nativeAuthenticationCredential();
const CREDENTIAL_ID = CREDENTIAL.toJSON().id;
const B64 = (input) => Buffer.from(input).toString("base64url");
const PRF_INPUT = B64(Uint8Array.from({ length: 32 }, (_, i) => i + 1));
const CHALLENGE = B64(Uint8Array.from({ length: 32 }, (_, i) => i + 40));
const plain = (v) => JSON.parse(JSON.stringify(v));

function deferred() {
  let resolve;
  const promise = new Promise(done => { resolve = done; });
  return { promise, resolve };
}

function production() {
  const context = {
    Object, Array, Number, String, Boolean, JSON, Date, Error, TypeError, Promise,
    Set, Map, Uint8Array, ArrayBuffer, TextEncoder, TextDecoder,
    atob(v) { return Buffer.from(v, "base64").toString("binary"); },
    btoa(v) { return Buffer.from(v, "binary").toString("base64"); },
  };
  let localId = 1, kind = "detached", failInstall = false;
  context.capturePocketFileSaveSession = () => ({
    id: localId, ownerKind: kind, handle: null, storagePrivacy: "synthetic",
    vaultSessionId: "", pipSession: false, detachedDeviceChanges: false,
  });
  context.isPocketFileSaveSessionCurrent = s => s?.id === localId && s.ownerKind === kind;
  context.capturePocketFileOwnerForAdoption = () => ({ id: localId, kind });
  context.restorePocketFileOwnerAfterFailedAdoption = value => {
    kind = value.kind; localId = value.id; return true;
  };
  context.setPocketFileSession = (_file, _name, opts) => {
    if (failInstall) throw new Error("synthetic local install failure");
    kind = opts.ownerKind;
    localId++;
  };
  context.window = context;
  context.globalThis = context;
  vm.createContext(context);
  for (const name of [
    "js/pocket-sync-security-contract.js",
    "js/pocket-sync-account-client.js",
    "js/pocket-sync-remote-client.js",
    "js/pocket-sync-owner-controller.js",
    "js/pocket-owner-save-boundary.js",
    "js/pocket-sync-additional-device.js",
    "js/pocket-sync-owner-continuity-guard.js",
  ]) {
    vm.runInContext(fs.readFileSync(path.join(ROOT, name), "utf8"), context, { filename: name });
  }
  return { context, local: () => ({ kind, id: localId }),
    changeLocal() { localId++; },
    setKind(next) { kind = next; localId++; },
    failInstall(value) { failInstall = value; },
  };
}

function makeHarness(options = {}) {
  const browser = production();
  const ctx = browser.context;
  let serverAccount = options.serverAccount || ACCOUNT;
  let serverPocket = options.serverPocket || POCKET;
  let authenticatedAccount = options.authenticatedAccount || ACCOUNT;
  let serverTag = TAG_A, expiry = FUTURE;
  let serial = 0, attestationCount = 0, authentications = 0;
  let visible = false, adoptionCount = 0, deviceEnrolments = 0;
  let afterRead = null, attestationHook = null, failAuth = false;
  const requests = [];
  const masterKey = Object.freeze({ kind: "nonextractable-synthetic-master-key" });
  const payload = Object.freeze({ schema: "portal.export.v1", notes: ["P355e-only-synthetic"] });
  const record = {
    kind: "pocket.sync.device-state", schemaVersion: 5, syncedPocketId: POCKET,
    storeRevision: 1, deviceId: "device-a", deviceWrappingKey: {},
    deviceEnvelope: {
      context: { syncedPocketId: POCKET, envelopeId: "envelope-a",
        envelopeKind: "device", envelopeVersion: 1 },
      metadata: { syncedPocketId: POCKET, deviceId: "device-a",
        envelopeId: "envelope-a", kind: "device", version: 1, kdf: "none" },
      record: { kind: "sealed-master" },
    },
    activationDraft: null, additionalDeviceDraft: null, recoveryDraft: null,
    remote: { confirmedRevision: 1, pending: null, conflict: null },
    content: { context: { syncedPocketId: POCKET, revision: 1,
      contentType: "portal.export.v1+json" }, record: payload },
    usage: { masterKeyGeneration: 1, masterKeyContentEncryptions: 1,
      masterKeyContentEncryptionLimit: 2 ** 20, deviceWrappingKeyEncryptions: 1 },
  };
  const crypto = {
    FORMAT: { contentType: "portal.export.v1+json" },
    async openMasterKeyBundle() { return { masterKey }; },
    validateNonExtractableAesKey(key) {
      if (key !== masterKey) throw new Error("invalid synthetic master key");
    },
    async openContent(value) { return value; },
    async sealContent(value) { return value; },
    async deriveWrappingKey() { return masterKey; },
    async generateDeviceWrappingKey() { return masterKey; },
    encodeBase64Url(input) { return B64(input); },
  };
  const deviceStore = {
    async open() {},
    async readPocket(id) {
      if (options.noCompletedRecord) return null;
      return id === POCKET ? record : null;
    },
    async createPocket() {},
    async replacePocket() { return record; },
    async reservePocketEncryptionUsage() { return record; },
    async readRecoveryAttempt() { return null; },
  };
  const contentService = {
    async readRevision(input) {
      return { apiVersion: 1, ok: true, operationId: input.operationId,
        syncedPocketId: input.syncedPocketId, revision: 1, recordPresent: true };
    },
    async downloadEncryptedRecord(input) {
      return { apiVersion: 1, ok: true, operationId: input.operationId,
        syncedPocketId: input.syncedPocketId, revision: 1, encryptedRecord: payload };
    },
    async conditionalUpload() { return { status: "committed" }; },
  };
  const envelopeService = {
    async listEnvelopes() {
      return { keySetVersion: 1, envelopes: [{
        status: "active", envelopeKind: "device", envelopeId: "envelope-a",
        envelopeVersion: 1, deviceId: "device-a", credentialId: null,
        kdf: "none", kdfSalt: null, derivationVersion: null,
      }] };
    },
    async downloadEnvelope() { throw new Error("new-device path not in P355e"); },
    async addEnvelope() { deviceEnrolments++; throw new Error("out of scope"); },
  };
  const authRequests = [];
  const accountService = {
    async beginRegistration() { throw new Error("not a registration"); },
    async finishRegistration() { throw new Error("not a registration"); },
    async beginAuthentication(request) {
      authRequests.push(plain(request));
      return {
        apiVersion: 1, ok: true, operationId: request.operationId,
        ceremonyId: "p355e-ceremony-" + authRequests.length,
        expiresAt: FUTURE, prfEvaluationInput: PRF_INPUT,
        publicKeyRequestOptions: {
          challenge: CHALLENGE, timeout: 120000, rpId: "pocket.example",
          allowCredentials: [{ type: "public-key", id: CREDENTIAL_ID, transports: ["internal"] }],
          userVerification: "required", extensions: {
            prf: { eval: { first: PRF_INPUT } },
          },
        },
      };
    },
    async finishAuthentication(request) {
      authentications++;
      if (failAuth) throw new Error("synthetic authentication unavailable");
      return {
        apiVersion: 1, ok: true, operationId: request.operationId,
        ceremonyId: request.ceremonyId, accountId: authenticatedAccount,
        credentialId: request.credential.id, credentialVersion: 1,
        accountPolicyVersion: 1, prfEvaluationInput: PRF_INPUT,
      };
    },
  };
  const accountClient = ctx.PocketSyncAccountClient.createClient({
    accountService,
    webAuthn: { async createCredential() { throw new Error("not a registration"); },
      async getCredential() { return fixtures.nativeAuthenticationCredential(); } },
    now: () => NOW,
  });
  const discoveryService = {
    async readSyncedPocket(request) {
      requests.push(plain(request));
      if (afterRead) await afterRead(request);
      if (request.ownerContinuity === SCHEMA) {
        attestationCount++;
        if (attestationHook) await attestationHook(attestationCount);
      }
      return {
        apiVersion: 1, ok: true, operationId: request.operationId,
        status: "ready", syncedPocketId: serverPocket,
        ...(request.ownerContinuity === SCHEMA ? {
          ownerContinuity: { schema: SCHEMA, accountId: serverAccount,
            sessionTag: serverTag, expiresAt: expiry },
        } : {}),
      };
    },
  };
  const controller = ctx.PocketSyncOwnerController.createSyncedOwnerController({
    crypto, deviceStore, contentService, randomBytes: size => new Uint8Array(size),
  });
  const boundary = ctx.PocketOwnerSaveBoundary;
  const dependencies = {
    captureTarget: () => ({ ownerKind: browser.local().kind,
      continuityId: String(browser.local().id) }),
    isTargetCurrent: () => ["none", "detached", "json", "vault"].includes(browser.local().kind),
    validatePayload: data => data?.schema === "portal.export.v1",
    async adoptOpenedPocket(opened) {
      adoptionCount++;
      if (options.detachedVisible) visible = true;
      if (options.failAdoption) return { ok: false };
      const adopted = await controller.adoptSyncedOwner({
        syncedPocketId: opened.syncedPocketId, masterKey: opened.masterKey,
      });
      if (!adopted.ok) return { ok: false };
      if (options.onlyController) return { ok: true };
      const success = boundary.installSyncedOwnerForSave(controller);
      if (!success) return { ok: false, partialState: "visible-payload-committed-detached" };
      visible = true;
      return { ok: true };
    },
  };
  const openerConfiguration = {
    crypto, deviceStore, accountClient, discoveryService,
    contentService, envelopeService,
    randomBytes(length) { serial++; return Uint8Array.from({ length }, (_, n) => (serial + n) & 255); },
    now: () => NOW,
  };
  const opener = ctx.PocketSyncOwnerContinuityGuard.createDormantCompletedDeviceOpener({
    additionalDeviceApi: ctx.PocketSyncAdditionalDevice,
    openerConfiguration, dependencies, controller, boundary,
    remoteContract: ctx.PocketSyncRemoteClient,
    nextOperationId() { serial++; return "p355e-attestation-" + serial; },
    now: () => NOW,
  });
  return {
    browser, ctx, opener, openerConfiguration, controller, boundary,
    setAccount(value) { serverAccount = value; },
    setPocket(value) { serverPocket = value; },
    setAuthenticatedAccount(value) { authenticatedAccount = value; },
    setTag(value) { serverTag = value; },
    setExpiry(value) { expiry = value; },
    onAttestation(hook) { attestationHook = hook; },
    onDiscovery(hook) { afterRead = hook; },
    failAuth(value) { failAuth = value; },
    get requests() { return requests; },
    get authRequests() { return authRequests; },
    get authentications() { return authentications; },
    get attestationCount() { return attestationCount; },
    get adoptionCount() { return adoptionCount; },
    get visible() { return visible; },
    get deviceEnrolments() { return deviceEnrolments; },
  };
}

test("P355e completes actual enrolled-device Open, verified account client, real controller and save boundary", async () => {
  const h = makeHarness();
  const opened = await h.opener.openExisting();
  assert.deepEqual(plain(opened),
    { ok: true, reason: "synced-pocket-opened", confirmedRemoteRevision: 1 });
  assert.equal(h.authentications, 1);
  assert.equal(h.adoptionCount, 1);
  assert.equal(h.attestationCount, 2);
  assert.equal(h.boundary.hasSyncedOwner(), true);
  assert.equal(h.browser.local().kind, "synced");
  assert.equal(h.controller.captureSyncedOwnerSaveSession().syncedPocketId, POCKET);
  assert.deepEqual(plain(await h.opener.revalidate()),
    { ok: true, reason: "owner-continuity-current" });
  assert.equal(h.attestationCount, 3);
  assert.deepEqual(h.requests.map(x => x.ownerContinuity || "ordinary"),
    ["ordinary", SCHEMA, SCHEMA, SCHEMA]);
  assert.equal(JSON.stringify(h.opener).includes(TAG_A), false);
  assert.equal(JSON.stringify(opened).includes(ACCOUNT), false);
  assert.equal(Object.hasOwn(opened, "export"), false);
});

test("P355e fails binding when authenticated account and attested account disagree", async () => {
  for (const value of ["account-b", "account-c"]) {
    const h = makeHarness({ serverAccount: value });
    const opened = await h.opener.openExisting();
    assert.equal(opened.ok, false);
    assert.equal(h.attestationCount, 1);
    assert.equal(h.adoptionCount, 0);
    assert.equal(h.boundary.hasSyncedOwner(), false);
    assert.equal((await h.opener.revalidate()).ok, false);
  }
});

test("P355e correct Pocket with wrong account, or correct account with wrong attested Pocket, never binds", async () => {
  const mismatch = makeHarness();
  mismatch.onAttestation(() => mismatch.setPocket("pocket-other"));
  assert.equal((await mismatch.opener.openExisting()).ok, false);
  assert.equal(mismatch.adoptionCount, 0);
  const wrongDiscovery = makeHarness({ serverPocket: "pocket-other" });
  assert.equal((await wrongDiscovery.opener.openExisting()).ok, false);
  assert.equal(wrongDiscovery.attestationCount, 0);
});

test("P355e current same-account session before initial attestation may bind, between witnesses may not", async () => {
  const before = makeHarness();
  before.onAttestation((n) => { if (n === 1) before.setTag(TAG_B); });
  assert.equal((await before.opener.openExisting()).ok, true);
  assert.equal((await before.opener.revalidate()).ok, true);

  const between = makeHarness();
  between.onAttestation((n) => { if (n === 2) between.setTag(TAG_B); });
  assert.equal((await between.opener.openExisting()).ok, false);
  assert.equal(between.attestationCount, 2);
  assert.equal(between.boundary.hasSyncedOwner(), true);
  assert.equal((await between.opener.revalidate()).ok, false);
});

test("P355e session replacement after binding fails fresh revalidation; unrelated device is unaffected", async () => {
  const a = makeHarness(), b = makeHarness();
  a.setTag(TAG_A);
  b.setTag(TAG_B);
  assert.equal((await a.opener.openExisting()).ok, true);
  assert.equal((await b.opener.openExisting()).ok, true);
  assert.equal((await b.opener.revalidate()).ok, true);
  a.setTag(TAG_B);
  assert.equal((await a.opener.revalidate()).ok, false);
  assert.equal((await b.opener.revalidate()).ok, true);
});

test("P355e failed authentication, cancelled Open and stale target do not issue continuity requests", async () => {
  const failed = makeHarness();
  failed.failAuth(true);
  assert.equal((await failed.opener.openExisting()).ok, false);
  assert.equal(failed.adoptionCount, 0);
  assert.equal(failed.attestationCount, 0);

  const stale = makeHarness();
  stale.browser.setKind("synced");
  assert.equal((await stale.opener.openExisting()).ok, false);
  assert.equal(stale.authentications, 0);

  const interrupted = makeHarness();
  interrupted.onDiscovery(request => {
    if (request.ownerContinuity === undefined) interrupted.browser.changeLocal();
  });
  assert.equal((await interrupted.opener.openExisting()).ok, false);
  assert.equal(interrupted.adoptionCount, 0);
  assert.equal(interrupted.attestationCount, 0);
});

test("P355e partial visible content or controller without save boundary never creates binding", async () => {
  const partial = makeHarness({ detachedVisible: true, onlyController: true });
  const result = await partial.opener.openExisting();
  assert.equal(result.ok, false);
  assert.equal(partial.visible, true);
  assert.equal(partial.boundary.hasSyncedOwner(), false);
  assert.equal((await partial.opener.revalidate()).ok, false);

  const failedBoundary = makeHarness({ detachedVisible: true });
  failedBoundary.browser.failInstall(true);
  assert.equal((await failedBoundary.opener.openExisting()).ok, false);
  assert.equal(failedBoundary.visible, true);
  assert.equal(failedBoundary.boundary.hasSyncedOwner(), false);
  assert.equal((await failedBoundary.opener.revalidate()).ok, false);

  const noAdopt = makeHarness({ failAdoption: true });
  assert.equal((await noAdopt.opener.openExisting()).ok, false);
  assert.equal(noAdopt.boundary.hasSyncedOwner(), false);
});

test("P355e stale local owner during asynchronous attestation or revalidation fails", async () => {
  const awaitingFirst = makeHarness();
  const gate = deferred();
  awaitingFirst.onAttestation(async n => {
    if (n === 1) await gate.promise;
  });
  const opening = awaitingFirst.opener.openExisting();
  await Promise.resolve();
  awaitingFirst.browser.changeLocal();
  gate.resolve();
  assert.equal((await opening).ok, false);
  assert.equal(awaitingFirst.boundary.hasSyncedOwner(), false);

  const awaitingFinal = makeHarness();
  awaitingFinal.onAttestation(n => {
    if (n === 2) awaitingFinal.browser.changeLocal();
  });
  assert.equal((await awaitingFinal.opener.openExisting()).ok, false);
  assert.equal((await awaitingFinal.opener.revalidate()).ok, false);

  const after = makeHarness();
  assert.equal((await after.opener.openExisting()).ok, true);
  after.onAttestation(n => { if (n === 3) after.browser.changeLocal(); });
  assert.equal((await after.opener.revalidate()).ok, false);
});

test("P355e prior unwitnessed installation cannot be backfilled and repeated completed Open cannot reuse provenance", async () => {
  const h = makeHarness();
  const master = (await h.openerConfiguration.crypto.openMasterKeyBundle()).masterKey;
  const installed = await h.controller.adoptSyncedOwner({ syncedPocketId: POCKET, masterKey: master });
  assert.equal(installed.ok, true);
  assert.equal(h.boundary.installSyncedOwnerForSave(h.controller), true);
  assert.equal((await h.opener.revalidate()).ok, false);
  assert.equal((await h.opener.openExisting()).ok, false);
  assert.equal(h.attestationCount, 0);
});

test("P355e new-device entry shares normal Open doorway but does not gain the completed binding", async () => {
  const h = makeHarness({ noCompletedRecord: true });
  const opened = await h.opener.openExisting();
  assert.equal(opened.ok, false);
  assert.equal(h.adoptionCount, 0);
  assert.equal(h.attestationCount, 0);
  assert.equal((await h.opener.revalidate()).ok, false);
  assert.equal(h.deviceEnrolments, 0);
});

test("P355e account reselection uses only its own ceremony, never a prior result", async () => {
  const h = makeHarness();
  const opened = await h.opener.openExisting({ accountSelection: "choose-another" });
  assert.equal(opened.ok, true);
  assert.equal(h.authRequests[0].accountSelection, "choose-another");
  assert.equal(h.authRequests.length, 1);
  assert.equal((await h.opener.revalidate()).ok, true);
});

test("P355e preserves standard opener: ordinary discovery and successful ordinary ownership no opt-in", async () => {
  const h = makeHarness();
  const ordinary = h.ctx.PocketSyncAdditionalDevice.createAdditionalDeviceOpener(
    h.openerConfiguration
  );
  const deps = {
    captureTarget: () => ({ ownerKind: h.browser.local().kind,
      continuityId: String(h.browser.local().id) }),
    isTargetCurrent: () => ["none", "detached", "json", "vault"].includes(h.browser.local().kind),
    validatePayload: data => data?.schema === "portal.export.v1",
    async adoptOpenedPocket(opened) {
      const adopted = await h.controller.adoptSyncedOwner({
        syncedPocketId: opened.syncedPocketId, masterKey: opened.masterKey,
      });
      if (!adopted.ok) return { ok: false };
      return { ok: h.boundary.installSyncedOwnerForSave(h.controller) };
    },
  };
  assert.equal((await ordinary.openExisting(deps)).ok, true);
  assert.equal(h.requests.length, 1);
  assert.equal(h.requests[0].ownerContinuity, undefined);
  assert.equal((await h.opener.revalidate()).ok, false);
});

test("P355e boot remains dormant; no public identity setter/export permission or persistence", async () => {
  const h = makeHarness();
  for (const file of ["index.html", "sw.js"]) {
    const source = fs.readFileSync(path.join(ROOT, file), "utf8");
    assert.doesNotMatch(source, /pocket-sync-owner-continuity-guard\.js/);
  }
  assert.deepEqual(Object.keys(h.opener), ["openExisting", "revalidate"]);
  assert.equal(Object.hasOwn(h.opener, "setExpectedAccountId"), false);
  assert.equal(Object.hasOwn(h.opener, "bind"), false);
  assert.equal(Object.hasOwn(h.opener, "export"), false);
  assert.equal(JSON.stringify(h.opener).includes(PRF_INPUT), false);
  const legacy = h.ctx.PocketSyncOwnerContinuityGuard.createDormantGuard({
    controller: h.controller, boundary: h.boundary,
    discoveryService: h.openerConfiguration.discoveryService,
    remoteContract: h.ctx.PocketSyncRemoteClient, now: () => NOW,
    nextOperationId: () => "p355e-negative",
    performTrustedInstallation: () => { throw new Error("must never be called"); },
  });
  assert.equal((await legacy.installWithContinuity()).ok, false);
  assert.equal(h.attestationCount, 0);
});
