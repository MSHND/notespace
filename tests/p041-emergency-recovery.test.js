"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { webcrypto } = require("node:crypto");

const { createServiceCore } = require("../sync-service/pocket-sync-service-core.js");
const { createRecoveryProofVerifier } = require("../sync-service/pocket-sync-recovery-proof-verifier.js");
const { createMemoryServiceStore } = require("./helpers/p034-memory-service-store.js");
const {
  createSharedDeviceStoreState,
  createMemoryDeviceStoreDriver,
} = require("./helpers/p030-memory-device-store-driver.js");
const fixtures = require("./helpers/p032-remote-fixtures.js");

const ROOT = path.resolve(__dirname, "..");
const MODULE = "js/pocket-sync-emergency-recovery.js";
const ORIGIN = "https://sync.pocket.example";
const NOW = Date.parse("2041-01-01T00:00:00.000Z");
const PAYLOAD = Object.freeze({
  schema: "portal.export.v1",
  nodes: Object.freeze([{ id: "thought-one", label: "P041 readable recovery thought" }]),
});

function source(file) {
  return fs.readFileSync(path.join(ROOT, file), "utf8");
}

function plain(value) {
  return JSON.parse(JSON.stringify(value));
}

function bytes(length, seed = 1) {
  return Uint8Array.from({ length }, (_value, index) => (seed + index) & 255);
}

function b64(length, seed = 1) {
  return Buffer.from(bytes(length, seed)).toString("base64url");
}

function registrationCredential(seed) {
  const native = fixtures.nativeRegistrationCredential();
  const id = b64(32, seed);
  return {
    getClientExtensionResults() { return native.getClientExtensionResults(); },
    toJSON() {
      const value = native.toJSON();
      value.id = id;
      value.rawId = id;
      return value;
    },
  };
}

function loadProduction(extra = {}) {
  const context = Object.assign({
    crypto: webcrypto,
    CryptoKey: globalThis.CryptoKey,
    TextEncoder,
    TextDecoder,
    Uint8Array,
    ArrayBuffer,
    Object,
    Array,
    Number,
    String,
    Boolean,
    JSON,
    Date,
    Error,
    TypeError,
    Promise,
    Set,
    atob(value) { return Buffer.from(value, "base64").toString("binary"); },
    btoa(value) { return Buffer.from(value, "binary").toString("base64"); },
  }, extra);
  context.window = context;
  context.globalThis = context;
  vm.createContext(context);
  for (const file of [
    "js/pocket-sync-security-contract.js",
    "js/pocket-sync-crypto.js",
    "js/pocket-sync-device-store.js",
    "js/pocket-sync-account-client.js",
    "js/pocket-sync-remote-client.js",
    "js/pocket-sync-activation.js",
    MODULE,
  ]) vm.runInContext(source(file), context, { filename: file });
  return {
    context,
    security: context.PocketSyncSecurityContract,
    crypto: context.PocketSyncCrypto,
    deviceStore: context.PocketSyncDeviceStore,
    account: context.PocketSyncAccountClient,
    remote: context.PocketSyncRemoteClient,
    activation: context.PocketSyncActivation,
    recovery: context.PocketSyncEmergencyRecovery,
  };
}

async function createActivatedHarness(options = {}) {
  const production = loadProduction();
  const serviceDriver = createMemoryServiceStore();
  let serviceRandom = 0;
  const verifierCalls = { registration: 0, recovery: 0 };
  const core = createServiceCore({
    store: serviceDriver.store,
    webAuthnVerifier: Object.freeze({
      async verifyRegistration(input) {
        verifierCalls.registration += 1;
        return {
          credentialId: input.credential.id,
          publicKey: b64(64, 201),
          publicKeyAlgorithm: -7,
          signCount: 0,
          transports: ["internal"],
          backupEligible: true,
          backedUp: false,
        };
      },
      async verifyAuthentication(input) {
        return {
          credentialId: input.credential.id,
          signCount: input.storedCredential.signCount + 1,
          backedUp: true,
        };
      },
    }),
    recoveryProofVerifier: Object.freeze({
      async verifyRecoveryProof(input) {
        verifierCalls.recovery += 1;
        return createRecoveryProofVerifier().verifyRecoveryProof(input);
      },
    }),
    randomBytes(length) {
      serviceRandom += 1;
      return bytes(length, serviceRandom * 13);
    },
    now: () => NOW,
    trustedOrigin: ORIGIN,
    rpId: "sync.pocket.example",
    rpName: "Pocket",
    credentialAlgorithms: Object.freeze([-7]),
    ceremonyLifetimeMs: 300000,
    sessionLifetimeMs: 2592000000,
  });

  let sessionId = null;
  let ambiguousRoute = null;
  let conflictingRoute = null;
  let recoveryState = null;
  let beginObservedStaging = false;
  const remoteCalls = [];
  const transport = Object.freeze({
    async request(route, body) {
      remoteCalls.push({ route, body: plain(body) });
      if (route === "beginRecovery" && recoveryState !== null && !beginObservedStaging) {
        const staged = Array.from(recoveryState.records.values())[0];
        assert.notEqual(staged, undefined);
        assert.equal(staged.kind, "pocket.sync.recovery-staging");
        assert.equal(staged.recoveryDraft.record.format, "pocket.sync.content.opaque");
        beginObservedStaging = true;
      }
      if (conflictingRoute === route) {
        conflictingRoute = null;
        return { status: 409, body: {
          apiVersion: 1,
          ok: false,
          status: "conflict",
          wrote: false,
          conflict: true,
          operationId: body.operationId,
          actualKeySetVersion: body.expectedKeySetVersion + 1,
          ...(route === "rotateRecovery"
            ? { actualRecoveryVersion: body.expectedRecoveryVersion + 1 } : {}),
        } };
      }
      const result = await core[route]({
        context: {
          method: "POST",
          origin: ORIGIN,
          fetchSite: "same-origin",
          contentType: "application/json",
          sessionId,
        },
        body: plain(body),
      });
      if (ambiguousRoute === route) {
        ambiguousRoute = null;
        const error = new Error("synthetic network ambiguity");
        error.retryable = true;
        throw error;
      }
      if (result.session?.action === "set") sessionId = result.session.sessionId;
      return { status: result.status, body: result.body };
    },
  });

  const accountService = production.remote.createAccountService({ transport, now: () => NOW });
  const activationAccountClient = production.account.createClient({
    accountService,
    webAuthn: Object.freeze({
      async createCredential() { return registrationCredential(11); },
      async getCredential() { throw new Error("not used"); },
    }),
    now: () => NOW,
  });
  const contentService = production.remote.createContentService({ transport });
  const envelopeService = production.remote.createEnvelopeService({ transport });
  const recoveryService = production.remote.createRecoveryService({ transport, now: () => NOW });

  const activationState = createSharedDeviceStoreState();
  const activationStore = production.deviceStore.createStore(
    createMemoryDeviceStoreDriver(activationState)
  );
  let activationRandom = 0;
  const activationOrchestrator = production.activation.createActivationOrchestrator({
    securityContract: production.security,
    crypto: production.crypto,
    deviceStore: activationStore,
    accountClient: activationAccountClient,
    contentService,
    envelopeService,
    recoveryService,
    randomBytes(length) {
      activationRandom += 1;
      return bytes(length, activationRandom * 7);
    },
    now: () => NOW,
  });
  const originalPackages = [];
  const activationSource = Object.freeze({ ownerKind: "json", continuityId: "p041-source" });
  const activationDependencies = Object.freeze({
    captureSourceSession() { return activationSource; },
    isSourceSessionCurrent(value) { return value === activationSource; },
    hasUnsavedSourceChanges() { return false; },
    async saveLocalSource() { return { ok: true }; },
    async freezePayload() { return plain(PAYLOAD); },
    async prepareRecoveryCopyDestination() {
      return { ok: true, destination: Object.freeze({ kind: "initial-copy" }) };
    },
    async buildRecoveryPackage(input) {
      return production.security.buildRecoveryPackage({
        ...plain(input), checksum: "P041-INITIAL-CHECKSUM",
      });
    },
    async writeRecoveryCopy({ recoveryPackage }) {
      originalPackages.push(plain(recoveryPackage));
      return { ok: true };
    },
    async adoptSyncedOwner() { return { ok: true }; },
  });
  const activationResult = await activationOrchestrator.activate(activationDependencies, {
    syncedPocketId: options.syncedPocketId || "pocket-p041",
    deviceId: "device-p041-original",
  });
  assert.equal(activationResult.ok, true, JSON.stringify(activationResult));
  assert.equal(originalPackages.length, 1);

  sessionId = null;
  recoveryState = createSharedDeviceStoreState();
  const recoveryStore = production.deviceStore.createStore(
    createMemoryDeviceStoreDriver(recoveryState)
  );
  const nativeBrowserAdapter = production.account.createBrowserWebAuthnAdapter({
    PublicKeyCredential: Object.freeze({
      parseCreationOptionsFromJSON(value) { return value; },
    }),
    navigator: Object.freeze({ credentials: Object.freeze({
      async create() { return registrationCredential(91); },
    }) }),
  });
  let webAuthnCreates = 0;
  const webAuthn = Object.freeze({
    async createCredential(optionsInput) {
      webAuthnCreates += 1;
      return nativeBrowserAdapter.createCredential(optionsInput);
    },
  });
  let recoveryRandom = 0;
  const recoveryConfig = {
    securityContract: production.security,
    crypto: production.crypto,
    deviceStore: recoveryStore,
    accountContract: production.account,
    contentService,
    envelopeService,
    recoveryService,
    webAuthn,
    randomBytes(length) {
      recoveryRandom += 1;
      return bytes(length, recoveryRandom * 19);
    },
    now: () => NOW,
  };
  const recoveryOrchestrator = production.recovery.createRecoveryOrchestrator(recoveryConfig);
  const replacementPackages = [];
  let targetCurrent = true;
  let replacementCopyFails = options.replacementCopyFails === true;
  let payloadValid = options.payloadValid !== false;
  const target = Object.freeze({ ownerKind: options.ownerKind || "none", continuityId: "p041-empty" });
  const recoveryEvents = [];
  const recoveryDependencies = Object.freeze({
    captureRecoveryTarget() { recoveryEvents.push("capture-target"); return target; },
    isRecoveryTargetCurrent(value) { return targetCurrent && value === target; },
    async readRecoveryPackage() {
      recoveryEvents.push("read-package");
      return options.packageOverride || plain(originalPackages[0]);
    },
    async prepareReplacementRecoveryCopyDestination() {
      recoveryEvents.push("prepare-replacement-copy");
      if (options.deferDestination) return { ok: false, deferred: true };
      return { ok: true, destination: Object.freeze({ kind: "replacement-copy" }) };
    },
    async buildRecoveryPackage(input) {
      recoveryEvents.push("build-replacement-package");
      return production.security.buildRecoveryPackage({
        ...plain(input), checksum: "P041-REPLACEMENT-CHECKSUM",
      });
    },
    async writeReplacementRecoveryCopy({ recoveryPackage }) {
      recoveryEvents.push("write-replacement-copy");
      replacementPackages.push(plain(recoveryPackage));
      return replacementCopyFails ? { ok: false } : { ok: true };
    },
    async validateRecoveredPayload(payload) {
      recoveryEvents.push("validate-payload");
      return payloadValid && JSON.stringify(payload) === JSON.stringify(PAYLOAD)
        ? { ok: true } : { ok: false };
    },
  });

  return {
    ...production,
    core,
    serviceDriver,
    transport,
    remoteCalls,
    verifierCalls,
    contentService,
    envelopeService,
    recoveryService,
    originalPackage: originalPackages[0],
    activationState,
    recoveryState,
    recoveryStore,
    recoveryConfig,
    recoveryOrchestrator,
    recoveryDependencies,
    replacementPackages,
    recoveryEvents,
    get webAuthnCreates() { return webAuthnCreates; },
    get beginObservedStaging() { return beginObservedStaging; },
    setSession(value) { sessionId = value; },
    makeAmbiguous(route) { ambiguousRoute = route; },
    makeConflict(route) { conflictingRoute = route; },
    allowReplacementCopy() { replacementCopyFails = false; },
    invalidateTarget() { targetCurrent = false; },
    validatePayload(value) { payloadValid = value; },
  };
}

function createMeasuredRecovery(harness, options = {}) {
  const writes = [];
  const events = [];
  const policy = { maximumEncryptionsPerKey: harness.crypto.POLICY.maximumEncryptionsPerKey };
  let downloaded = false;
  let deviceEnvelopeEncryptions = 0;
  let deviceDraftEncryptionsAfterDownload = 0;
  let failOrdinaryDraftSeal = options.failOrdinaryDraftSealOnce === true;
  let failDeviceEnvelope = options.failDeviceEnvelopeOnce === true;
  let failPromotion = options.failPromotionOnce === true;

  async function capture(input) {
    const draft = await harness.crypto.openContent(
      input.recoveryDraft.record, input.deviceWrappingKey, input.recoveryDraft.context
    );
    writes.push({
      stage: draft.stage,
      storeRevision: input.storeRevision,
      usage: input.usage.deviceWrappingKeyEncryptions,
    });
  }

  const deviceStore = Object.freeze({
    ...harness.recoveryStore,
    async createRecoveryStaging(input) {
      await capture(input);
      return harness.recoveryStore.createRecoveryStaging(input);
    },
    async replaceRecoveryStaging(syncedPocketId, expectedRevision, input) {
      await capture(input);
      return harness.recoveryStore.replaceRecoveryStaging(syncedPocketId, expectedRevision, input);
    },
    async reserveRecoveryStagingEncryptionUsage(syncedPocketId, revision, usage, increment) {
      events.push(`reserve:${increment}`);
      if (downloaded && typeof options.capacityOffset === "number"
          && usage + increment >= policy.maximumEncryptionsPerKey) {
        const error = new Error("capacity");
        error.code = "device-usage-limit-reached";
        throw error;
      }
      return harness.recoveryStore.reserveRecoveryStagingEncryptionUsage(
        syncedPocketId, revision, usage, increment
      );
    },
    async promoteRecoveryStaging(syncedPocketId, expectedRevision, input) {
      await capture(input);
      if (failPromotion) {
        failPromotion = false;
        throw new Error("synthetic promotion failure");
      }
      return harness.recoveryStore.promoteRecoveryStaging(syncedPocketId, expectedRevision, input);
    },
  });
  const crypto = Object.freeze({
    ...harness.crypto,
    POLICY: policy,
    async sealContent(...input) {
      events.push("seal-draft");
      if (downloaded) deviceDraftEncryptionsAfterDownload += 1;
      if (failOrdinaryDraftSeal && events.at(-2) === "reserve:1") {
        failOrdinaryDraftSeal = false;
        throw new Error("synthetic recovery draft seal failure");
      }
      return harness.crypto.sealContent(...input);
    },
    async openMasterKeyBundle(record, wrappingKey, context, plans) {
      if (Array.isArray(plans) && plans.length === 1
          && plans[0]?.context?.envelopeKind === "device") {
        deviceEnvelopeEncryptions += 1;
        events.push("seal-device-envelope");
        if (failDeviceEnvelope) {
          failDeviceEnvelope = false;
          throw new Error("synthetic device envelope failure");
        }
      }
      return harness.crypto.openMasterKeyBundle(record, wrappingKey, context, plans);
    },
  });
  const contentService = Object.freeze({
    ...harness.contentService,
    async downloadEncryptedRecord(input) {
      const result = await harness.contentService.downloadEncryptedRecord(input);
      downloaded = true;
      if (typeof options.capacityOffset === "number") {
        const current = Array.from(harness.recoveryState.records.values())[0];
        policy.maximumEncryptionsPerKey = current.usage.deviceWrappingKeyEncryptions
          + options.capacityOffset;
      }
      return result;
    },
  });
  return Object.freeze({
    writes,
    events,
    get deviceEnvelopeEncryptions() { return deviceEnvelopeEncryptions; },
    get deviceDraftEncryptionsAfterDownload() { return deviceDraftEncryptionsAfterDownload; },
    create() {
      return harness.recovery.createRecoveryOrchestrator({
        ...harness.recoveryConfig, crypto, deviceStore, contentService,
      });
    },
  });
}

test("P041 is one dormant inert exact recovery boundary", () => {
  let reads = 0;
  const context = { Object, Array, Number, String, Boolean, JSON, Error, Promise };
  for (const field of ["crypto", "indexedDB", "localStorage", "sessionStorage", "fetch",
    "navigator", "document", "Date", "setTimeout", "setInterval", "Worker"]) {
    Object.defineProperty(context, field, {
      get() { reads += 1; throw new Error(field); },
    });
  }
  context.window = context;
  context.globalThis = context;
  vm.createContext(context);
  assert.doesNotThrow(() => vm.runInContext(source(MODULE), context, { filename: MODULE }));
  assert.equal(reads, 0);
  assert.deepEqual(Object.keys(context.PocketSyncEmergencyRecovery), [
    "POLICY", "createRecoveryOrchestrator",
  ]);
  assert.equal(Object.isFrozen(context.PocketSyncEmergencyRecovery), true);
  assert.equal(Object.isFrozen(context.PocketSyncEmergencyRecovery.POLICY), true);
  assert.doesNotMatch(source("index.html"), /pocket-sync-emergency-recovery\.js/);
  assert.doesNotMatch(source("sw.js"), /pocket-sync-emergency-recovery\.js/);
  assert.doesNotMatch(source("js/pocket-sync-contract.js"), /PocketSyncEmergencyRecovery/);
});

test("factory, dependency, option, target and package boundaries fail before effects", async () => {
  const harness = await createActivatedHarness({ deferDestination: true });
  assert.deepEqual(Object.keys(harness.recoveryOrchestrator), ["recover", "resume"]);
  assert.equal(Object.isFrozen(harness.recoveryOrchestrator), true);
  assert.throws(
    () => harness.recovery.createRecoveryOrchestrator({ ...harness.recoveryConfig, extra: true }),
    (error) => error.code === "recovery-factory-invalid"
  );
  const invalid = await harness.recoveryOrchestrator.recover(
    harness.recoveryDependencies, { deviceId: "device", extra: true }
  );
  assert.equal(invalid.reason, "invalid-recovery-input");

  for (const ownerKind of ["json", "vault", "synced"]) {
    const unsupported = await harness.recoveryOrchestrator.recover(Object.freeze({
      ...harness.recoveryDependencies,
      captureRecoveryTarget() { return { ownerKind, continuityId: "active" }; },
    }), { deviceId: "device-p041-new" });
    assert.equal(unsupported.reason, "unsupported-recovery-target");
  }
  assert.equal(harness.recoveryEvents.includes("read-package"), false);

  const deferred = await harness.recoveryOrchestrator.recover(
    harness.recoveryDependencies, { deviceId: "device-p041-new" }
  );
  assert.equal(deferred.reason, "replacement-copy-destination-deferred");
  assert.equal(harness.recoveryState.records.size, 0);
  assert.equal(harness.webAuthnCreates, 0);
  assert.equal(harness.remoteCalls.filter((call) => call.route === "beginRecovery").length, 0);
});

test("actual P028-P040 modules recover, rotate and stage one safe new device", async () => {
  const harness = await createActivatedHarness();
  const oldPackage = plain(harness.originalPackage);
  const callsBeforeRecovery = harness.remoteCalls.length;
  const result = await harness.recoveryOrchestrator.recover(harness.recoveryDependencies, {
    deviceId: "device-p041-recovered",
  });
  assert.equal(result.ok, true, JSON.stringify({ result,
    calls: harness.remoteCalls.slice(callsBeforeRecovery).map((call) => call.route) }));
  assert.equal(result.reason, "recovery-ready");
  assert.equal(result.adopted, false);
  assert.equal(result.readyForAdoption, true);
  assert.equal(result.replacementRecoveryCopyStored, true);
  assert.equal(harness.webAuthnCreates, 1);
  assert.equal(harness.verifierCalls.recovery, 1);
  assert.equal(harness.beginObservedStaging, true);
  assert.deepEqual(harness.remoteCalls.slice(callsBeforeRecovery).map((call) => call.route), [
    "beginRecovery", "finishRecovery", "readRevision", "downloadEncryptedRecord",
    "addEnvelope", "rotateRecovery",
  ]);

  const snapshot = harness.serviceDriver.snapshot();
  assert.equal(Object.keys(snapshot.credentials).length, 2);
  assert.equal(Object.keys(snapshot.sessions).length, 2);
  assert.equal(Object.keys(snapshot.keyOperations).length, 5);
  const keySet = Object.values(snapshot.keySets)[0];
  assert.equal(keySet.recoveryStatus, "ready");
  assert.equal(keySet.recoveryVersion, 2);
  assert.equal(keySet.envelopeIds.length, 5);
  const revokedRecoveryEnvelopes = Object.values(snapshot.envelopes).filter(
    (envelope) => envelope.envelopeKind === "recovery" && envelope.status === "revoked"
  );
  assert.equal(revokedRecoveryEnvelopes.length, 1);
  assert.equal(revokedRecoveryEnvelopes[0].encryptedEnvelope, null);
  const oldLocator = snapshot.recoveryLocators[oldPackage.accountLocator];
  assert.equal(oldLocator.status, "revoked");
  assert.equal(harness.replacementPackages.length, 1);
  assert.notEqual(harness.replacementPackages[0].accountLocator, oldPackage.accountLocator);
  assert.notEqual(harness.replacementPackages[0].rootMaterial, oldPackage.rootMaterial);

  harness.setSession(null);
  await assert.rejects(harness.recoveryService.beginRecovery({
    apiVersion: 1,
    operationId: "old-locator-rejected-p041",
    accountLocator: oldPackage.accountLocator,
    deviceId: "device-p041-locator-check",
  }), (error) => error.code === "service-recovery-unavailable");
  const newAuthority = await harness.recoveryService.beginRecovery({
    apiVersion: 1,
    operationId: "new-locator-accepted-p041",
    accountLocator: harness.replacementPackages[0].accountLocator,
    deviceId: "device-p041-locator-check",
  });
  assert.equal(newAuthority.recoveryVersion, 2);

  const finalRecord = await harness.recoveryStore.readPocket(oldPackage.syncedPocketId);
  assert.equal(finalRecord.kind, "pocket.sync.device-state");
  assert.equal(finalRecord.schemaVersion, 4);
  assert.equal(finalRecord.remote.confirmedRevision, 1);
  assert.equal(finalRecord.remote.pending, null);
  assert.equal(finalRecord.remote.conflict, null);
  assert.equal(finalRecord.activationDraft, null);
  assert.notEqual(finalRecord.recoveryDraft, null);
  const found = await harness.recoveryStore.readRecoveryAttempt(result.recoveryAttemptId);
  assert.equal(found.draft.stage, "ready-for-adoption");
  assert.equal(found.draft.oldRecoveryPackage, null);
  assert.equal(found.draft.replacementRecoveryRoot, null);
  assert.equal(found.draft.replacementRecoveryPackage, null);
  assert.equal(found.draft.replacementRecoveryEnvelope, null);
  assert.equal(found.draft.finishRequest, null);
  assert.equal(found.draft.finishResponse, null);
  assert.equal(found.draft.replacementRecoveryCopyStored, true);

  const reopened = await harness.crypto.openMasterKeyBundle(
    finalRecord.deviceEnvelope.record,
    finalRecord.deviceWrappingKey,
    finalRecord.deviceEnvelope.context,
    []
  );
  const recoveredPayload = await harness.crypto.openContent(
    finalRecord.content.record,
    reopened.masterKey,
    finalRecord.content.context
  );
  assert.deepEqual(plain(recoveredPayload), plain(PAYLOAD));

  const rawLocal = JSON.stringify(Array.from(harness.recoveryState.records.values()));
  assert.doesNotMatch(rawLocal, /P041 readable recovery thought/);
  assert.doesNotMatch(rawLocal, new RegExp(oldPackage.rootMaterial));
  assert.doesNotMatch(rawLocal, /rootMaterial|accountLocator|recovery-authorisation-proof/);
  const remoteText = JSON.stringify(harness.serviceDriver.snapshot());
  assert.doesNotMatch(remoteText, /P041 readable recovery thought|rootMaterial|pocket-recovery-package/);
  const resultText = JSON.stringify(result);
  assert.doesNotMatch(resultText, /root|proof|package|locator|credential|ciphertext|envelope/i);

  const remoteCount = harness.remoteCalls.length;
  const eventCount = harness.recoveryEvents.length;
  const replay = await harness.recoveryOrchestrator.resume(harness.recoveryDependencies, {
    recoveryAttemptId: result.recoveryAttemptId,
  });
  assert.deepEqual(plain(replay), plain(result));
  assert.equal(harness.remoteCalls.length, remoteCount);
  assert.equal(harness.recoveryEvents.length, eventCount);
  assert.equal(harness.webAuthnCreates, 1);
  assert.equal(harness.verifierCalls.recovery, 1);
});

test("P049c counts every device-key encryption in recovery staging and promotion", async () => {
  const harness = await createActivatedHarness();
  const measured = createMeasuredRecovery(harness);
  const result = await measured.create().recover(harness.recoveryDependencies, {
    deviceId: "device-p049c-counted",
  });
  assert.equal(result.ok, true, JSON.stringify(result));
  const contentReady = measured.writes.findIndex((write) => write.stage === "content-ready");
  assert.ok(contentReady > 0);
  assert.equal(measured.writes[contentReady].usage - measured.writes[contentReady - 1].usage, 2);
  assert.equal(measured.deviceEnvelopeEncryptions, 1);
  assert.equal(measured.deviceDraftEncryptionsAfterDownload > 0, true);
  const finalRecord = await harness.recoveryStore.readPocket(harness.originalPackage.syncedPocketId);
  assert.equal(finalRecord.usage.deviceWrappingKeyEncryptions, measured.writes.at(-1).usage);
  assert.equal(measured.writes[0].usage, 1);
  const reserveTwo = measured.events.indexOf("reserve:2");
  const deviceEnvelopeSeal = measured.events.indexOf("seal-device-envelope");
  assert.ok(reserveTwo >= 0 && reserveTwo < deviceEnvelopeSeal);
  assert.ok(measured.events.indexOf("reserve:1") < measured.events.lastIndexOf("seal-draft"));
});

test("P049c reserves device-key capacity for the envelope plus recovery-draft transition", async (t) => {
  await t.test("ceiling-minus-one fails before either new AES-GCM operation", async () => {
    const harness = await createActivatedHarness();
    const measured = createMeasuredRecovery(harness, { capacityOffset: 1 });
    const result = await measured.create().recover(harness.recoveryDependencies, {
      deviceId: "device-p049c-no-capacity",
    });
    assert.equal(result.ok, false);
    assert.equal(measured.deviceEnvelopeEncryptions, 0);
    assert.equal(measured.deviceDraftEncryptionsAfterDownload, 0);
  });

  await t.test("capacity for two encryptions reaches the strict stored-counter bound", async () => {
    const harness = await createActivatedHarness();
    const measured = createMeasuredRecovery(harness, { capacityOffset: 3 });
    await measured.create().recover(harness.recoveryDependencies, {
      deviceId: "device-p049c-two-capacity",
    });
    const contentReady = measured.writes.findIndex((write) => write.stage === "content-ready");
    assert.ok(contentReady > 0);
    assert.equal(measured.writes[contentReady].usage - measured.writes[contentReady - 1].usage, 2);
    assert.equal(measured.deviceEnvelopeEncryptions, 1);
    assert.equal(measured.deviceDraftEncryptionsAfterDownload, 1);
  });
});

test("P049e leaves recovery reservations spent after ordinary, +2 and promotion failures", async (t) => {
  await t.test("ordinary draft seal failure", async () => {
    const harness = await createActivatedHarness();
    const measured = createMeasuredRecovery(harness, { failOrdinaryDraftSealOnce: true });
    const first = await measured.create().recover(harness.recoveryDependencies, {
      deviceId: "device-p049e-ordinary",
    });
    assert.equal(first.reason, "recovery-state-invalid");
    const spent = await harness.recoveryStore.readRecoveryAttempt(first.recoveryAttemptId);
    assert.equal(spent.record.storeRevision, 1);
    assert.equal(spent.record.usage.deviceWrappingKeyEncryptions, 2);
    await harness.crypto.openContent(
      spent.record.recoveryDraft.record, spent.record.deviceWrappingKey, spent.record.recoveryDraft.context
    );
    const resumed = await measured.create().resume(harness.recoveryDependencies, {
      recoveryAttemptId: first.recoveryAttemptId,
    });
    assert.equal(resumed.ok, true, JSON.stringify(resumed));
    assert.equal((await harness.recoveryStore.readPocket(harness.originalPackage.syncedPocketId))
      .usage.deviceWrappingKeyEncryptions >= 3, true);
  });

  await t.test("+2 device-envelope failure", async () => {
    const harness = await createActivatedHarness();
    const measured = createMeasuredRecovery(harness, { failDeviceEnvelopeOnce: true });
    const first = await measured.create().recover(harness.recoveryDependencies, {
      deviceId: "device-p049e-plus-two",
    });
    assert.equal(first.reason, "recovery-envelope-open-failed");
    const before = measured.writes.at(-1);
    const spent = await harness.recoveryStore.readRecoveryAttempt(first.recoveryAttemptId);
    assert.equal(spent.record.storeRevision, before.storeRevision);
    assert.equal(spent.record.usage.deviceWrappingKeyEncryptions, before.usage + 2);
    const resumed = await measured.create().resume(harness.recoveryDependencies, {
      recoveryAttemptId: first.recoveryAttemptId,
    });
    assert.equal(resumed.ok, true, JSON.stringify(resumed));
    assert.equal(measured.events.filter((event) => event === "reserve:2").length, 2);
  });

  await t.test("promotion failure", async () => {
    const harness = await createActivatedHarness();
    const measured = createMeasuredRecovery(harness, { failPromotionOnce: true });
    const first = await measured.create().recover(harness.recoveryDependencies, {
      deviceId: "device-p049e-promotion",
    });
    assert.equal(first.reason, "device-finalisation-failed");
    const spent = await harness.recoveryStore.readRecoveryAttempt(first.recoveryAttemptId);
    const usageBeforeResume = spent.record.usage.deviceWrappingKeyEncryptions;
    const resumed = await measured.create().resume(harness.recoveryDependencies, {
      recoveryAttemptId: first.recoveryAttemptId,
    });
    assert.equal(resumed.ok, true, JSON.stringify(resumed));
    assert.equal((await harness.recoveryStore.readPocket(harness.originalPackage.syncedPocketId))
      .usage.deviceWrappingKeyEncryptions > usageBeforeResume, true);
  });
});

test("ambiguous finish resumes the exact continuation without another proof or credential", async () => {
  const harness = await createActivatedHarness();
  harness.makeAmbiguous("finishRecovery");
  const first = await harness.recoveryOrchestrator.recover(harness.recoveryDependencies, {
    deviceId: "device-p041-finish-replay",
  });
  assert.equal(first.reason, "recovery-finish-unavailable");
  assert.equal(first.resumable, true);
  assert.equal(harness.webAuthnCreates, 1);
  assert.equal(harness.verifierCalls.recovery, 1);
  const found = await harness.recoveryStore.readRecoveryAttempt(first.recoveryAttemptId);
  assert.equal(found.draft.stage, "finish-pending");
  const finishRequest = JSON.stringify(found.draft.finishRequest);

  const resumed = await harness.recoveryOrchestrator.resume(harness.recoveryDependencies, {
    recoveryAttemptId: first.recoveryAttemptId,
  });
  assert.equal(resumed.ok, true, JSON.stringify(resumed));
  assert.equal(harness.webAuthnCreates, 1);
  assert.equal(harness.verifierCalls.recovery, 1);
  const finishes = harness.remoteCalls.filter((call) => call.route === "finishRecovery");
  assert.equal(finishes.length, 2);
  assert.equal(JSON.stringify(finishes[0].body), finishRequest);
  assert.equal(JSON.stringify(finishes[1].body), finishRequest);
  assert.equal(Object.keys(harness.serviceDriver.snapshot().credentials).length, 2);
  assert.equal(Object.keys(harness.serviceDriver.snapshot().sessions).length, 2);
});

test("device-envelope and rotation ambiguity use exact explicit idempotent retry", async (t) => {
  for (const route of ["addEnvelope", "rotateRecovery"]) await t.test(route, async () => {
    const harness = await createActivatedHarness({ syncedPocketId: `pocket-p041-${route}` });
    const callCount = harness.remoteCalls.length;
    harness.makeAmbiguous(route);
    const first = await harness.recoveryOrchestrator.recover(harness.recoveryDependencies, {
      deviceId: `device-p041-${route}`,
    });
    assert.equal(first.resumable, true);
    const resumed = await harness.recoveryOrchestrator.resume(harness.recoveryDependencies, {
      recoveryAttemptId: first.recoveryAttemptId,
    });
    assert.equal(resumed.ok, true, JSON.stringify(resumed));
    const calls = harness.remoteCalls.slice(callCount).filter((call) => call.route === route);
    assert.equal(calls.length, 2);
    assert.equal(calls[0].body.attemptKind, "new-change");
    assert.equal(calls[1].body.attemptKind, "idempotent-retry");
    assert.equal(calls[0].body.operationId, calls[1].body.operationId);
    if (route === "rotateRecovery") {
      assert.equal(calls[0].body.recoveryEnvelope.envelopeVersion, 2);
      assert.equal(calls[0].body.recoveryVerifier.version, 1);
      assert.equal(calls[0].body.recoveryVerifier.algorithm, "Ed25519");
      assert.equal(calls[0].body.recoveryVerifier.publicKeyFormat, "spki");
    }
  });
});

test("replacement-copy failure resumes locally with the exact package and no remote repetition", async () => {
  const harness = await createActivatedHarness({ replacementCopyFails: true });
  const first = await harness.recoveryOrchestrator.recover(harness.recoveryDependencies, {
    deviceId: "device-p041-copy-resume",
  });
  assert.equal(first.reason, "replacement-recovery-copy-not-stored");
  assert.equal(first.remotelyCommitted, true);
  assert.equal(first.replacementRecoveryCopyRequired, true);
  const remoteCount = harness.remoteCalls.length;
  const firstPackage = JSON.stringify(harness.replacementPackages[0]);
  const found = await harness.recoveryStore.readRecoveryAttempt(first.recoveryAttemptId);
  assert.equal(found.draft.stage, "replacement-copy-pending");
  assert.equal(JSON.stringify(found.draft.replacementRecoveryPackage), firstPackage);
  assert.doesNotMatch(JSON.stringify(Array.from(harness.recoveryState.records.values())),
    new RegExp(found.draft.replacementRecoveryRoot));

  harness.allowReplacementCopy();
  const resumed = await harness.recoveryOrchestrator.resume(harness.recoveryDependencies, {
    recoveryAttemptId: first.recoveryAttemptId,
  });
  assert.equal(resumed.ok, true, JSON.stringify(resumed));
  assert.equal(harness.remoteCalls.length, remoteCount);
  assert.equal(JSON.stringify(harness.replacementPackages[1]), firstPackage);
  const ready = await harness.recoveryStore.readRecoveryAttempt(first.recoveryAttemptId);
  assert.equal(ready.draft.replacementRecoveryRoot, null);
  assert.equal(ready.draft.replacementRecoveryPackage, null);
});

test("target replacement, malformed content and key-set conflicts stop safely", async (t) => {
  await t.test("target changed", async () => {
    const harness = await createActivatedHarness();
    const dependencies = Object.freeze({
      ...harness.recoveryDependencies,
      isRecoveryTargetCurrent(target) {
        return target.ownerKind === "none"
          && !harness.remoteCalls.some((call) => call.route === "beginRecovery");
      },
    });
    const result = await harness.recoveryOrchestrator.recover(dependencies, {
      deviceId: "device-p041-target-change",
    });
    assert.equal(result.reason, "recovery-target-changed");
    assert.equal(result.adopted, false);
    assert.equal(result.locallyDurable, true);
  });

  await t.test("malformed recovered payload", async () => {
    const harness = await createActivatedHarness({ payloadValid: false });
    const callCount = harness.remoteCalls.length;
    const result = await harness.recoveryOrchestrator.recover(harness.recoveryDependencies, {
      deviceId: "device-p041-invalid-content",
    });
    assert.equal(result.reason, "recovered-content-invalid");
    const recoveryCalls = harness.remoteCalls.slice(callCount);
    assert.equal(recoveryCalls.some((call) => call.route === "addEnvelope"), false);
    assert.equal(recoveryCalls.some((call) => call.route === "rotateRecovery"), false);
  });

  for (const route of ["addEnvelope", "rotateRecovery"]) await t.test(`${route} conflict`, async () => {
    const harness = await createActivatedHarness({ syncedPocketId: `pocket-conflict-${route}` });
    harness.makeConflict(route);
    const result = await harness.recoveryOrchestrator.recover(harness.recoveryDependencies, {
      deviceId: `device-conflict-${route}`,
    });
    assert.equal(result.reason, route === "addEnvelope"
      ? "device-envelope-conflict" : "recovery-rotation-conflict");
    assert.equal(result.readyForAdoption, false);
    assert.equal(harness.replacementPackages.length, 0);
  });
});

test("wrong recovery root and changed content revision fail before key mutations", async (t) => {
  await t.test("wrong root", async () => {
    const harness = await createActivatedHarness();
    const callCount = harness.remoteCalls.length;
    const dependencies = Object.freeze({
      ...harness.recoveryDependencies,
      async readRecoveryPackage() {
        return { ...plain(harness.originalPackage), rootMaterial: b64(32, 244) };
      },
    });
    const result = await harness.recoveryOrchestrator.recover(dependencies, {
      deviceId: "device-p041-wrong-root",
    });
    assert.equal(result.reason, "recovery-envelope-open-failed");
    const calls = harness.remoteCalls.slice(callCount);
    assert.deepEqual(calls.map((call) => call.route), ["beginRecovery", "finishRecovery"]);
  });

  await t.test("revision changed", async () => {
    const harness = await createActivatedHarness();
    const contentService = Object.freeze({
      readRevision: harness.contentService.readRevision,
      async downloadEncryptedRecord(input) {
        const downloaded = await harness.contentService.downloadEncryptedRecord(input);
        return Object.freeze({ ...plain(downloaded), revision: downloaded.revision + 1 });
      },
    });
    const orchestrator = harness.recovery.createRecoveryOrchestrator({
      ...harness.recoveryConfig,
      contentService,
    });
    const callCount = harness.remoteCalls.length;
    const result = await orchestrator.recover(harness.recoveryDependencies, {
      deviceId: "device-p041-revision-change",
    });
    assert.equal(result.reason, "remote-content-changed");
    const calls = harness.remoteCalls.slice(callCount);
    assert.equal(calls.some((call) => call.route === "addEnvelope"), false);
    assert.equal(calls.some((call) => call.route === "rotateRecovery"), false);
  });
});

test("malformed packages and existing local Pocket identities fail before remote recovery", async (t) => {
  await t.test("malformed package", async () => {
    const harness = await createActivatedHarness();
    const dependencies = Object.freeze({
      ...harness.recoveryDependencies,
      async readRecoveryPackage() {
        return { ...plain(harness.originalPackage), localOnly: false };
      },
    });
    const callCount = harness.remoteCalls.length;
    const result = await harness.recoveryOrchestrator.recover(dependencies, {
      deviceId: "device-p041-malformed-package",
    });
    assert.equal(result.reason, "recovery-package-invalid");
    assert.equal(harness.recoveryState.records.size, 0);
    assert.equal(harness.remoteCalls.length, callCount);
  });

  await t.test("local identity collision", async () => {
    const harness = await createActivatedHarness();
    await harness.recoveryStore.open();
    const key = await harness.crypto.generateDeviceWrappingKey();
    const context = {
      syncedPocketId: harness.originalPackage.syncedPocketId,
      revision: 1,
      contentType: harness.crypto.FORMAT.contentType,
    };
    const encrypted = await harness.crypto.sealContent({
      recoveryAttemptId: "different-attempt-p041",
    }, key, context);
    await harness.recoveryStore.createRecoveryStaging({
      kind: harness.deviceStore.FORMAT.recoveryStagingKind,
      schemaVersion: harness.deviceStore.FORMAT.recoveryStagingSchemaVersion,
      storeRevision: 1,
      syncedPocketId: context.syncedPocketId,
      deviceId: "existing-device-p041",
      deviceWrappingKey: key,
      recoveryDraft: { context, record: encrypted },
      usage: { deviceWrappingKeyEncryptions: 1 },
    });
    const callCount = harness.remoteCalls.length;
    const result = await harness.recoveryOrchestrator.recover(harness.recoveryDependencies, {
      deviceId: "device-p041-collision",
    });
    assert.equal(result.reason, "device-staging-failed");
    assert.equal(harness.remoteCalls.length, callCount);
    assert.equal(harness.recoveryState.records.size, 1);
  });
});

test("P030 recovery staging is strict, encrypted, CAS protected and migrates old records", async () => {
  const production = loadProduction();
  const state = createSharedDeviceStoreState();
  const store = production.deviceStore.createStore(createMemoryDeviceStoreDriver(state));
  await store.open();
  const key = await production.crypto.generateDeviceWrappingKey();
  const context = {
    syncedPocketId: "pocket-p041-staging",
    revision: 1,
    contentType: production.crypto.FORMAT.contentType,
  };
  const encrypted = await production.crypto.sealContent({
    recoveryAttemptId: "attempt-p041-staging", rootMaterial: b64(32, 44),
  }, key, context);
  const record = {
    kind: production.deviceStore.FORMAT.recoveryStagingKind,
    schemaVersion: production.deviceStore.FORMAT.recoveryStagingSchemaVersion,
    storeRevision: 1,
    syncedPocketId: context.syncedPocketId,
    deviceId: "device-p041-staging",
    deviceWrappingKey: key,
    recoveryDraft: { context, record: encrypted },
    usage: { deviceWrappingKeyEncryptions: 1 },
  };
  await store.createRecoveryStaging(record);
  const found = await store.readRecoveryAttempt("attempt-p041-staging");
  assert.equal(found.draft.rootMaterial, b64(32, 44));
  assert.doesNotMatch(JSON.stringify(Array.from(state.records.values())), /rootMaterial/);
  const reservedStaging = await store.reserveRecoveryStagingEncryptionUsage(
    context.syncedPocketId, 1, 1, 2
  );
  assert.equal(reservedStaging.storeRevision, 1);
  assert.equal(reservedStaging.usage.deviceWrappingKeyEncryptions, 3);
  assert.deepEqual(plain(reservedStaging.recoveryDraft), plain(record.recoveryDraft));
  await assert.rejects(store.reserveRecoveryStagingEncryptionUsage(
    context.syncedPocketId, 1, 1, 1
  ), (error) => error.code === "device-usage-reservation-conflict");
  await assert.rejects(store.replaceRecoveryStaging(context.syncedPocketId, 2, {
    ...record, storeRevision: 2,
  }), (error) => error.code === "device-store-revision-conflict");
  assert.throws(() => production.deviceStore.validateRecoveryStagingRecord({
    ...record, plaintext: PAYLOAD,
  }), (error) => error.code === "recovery-staging-invalid");
  const legacyStaging = Object.assign({}, record, { schemaVersion: 1 });
  delete legacyStaging.usage;
  state.records.set(context.syncedPocketId, legacyStaging);
  const migratedStaging = await store.readRecoveryAttempt("attempt-p041-staging");
  assert.equal(migratedStaging.record.schemaVersion, 2);
  assert.equal(migratedStaging.record.usage.deviceWrappingKeyEncryptions, 1);

  const legacy = await (async () => {
    const wrappingKey = await production.crypto.generateDeviceWrappingKey();
    const envelopeContext = {
      syncedPocketId: "pocket-p041-legacy",
      envelopeId: "envelope-p041-legacy",
      envelopeKind: "device",
      envelopeVersion: 1,
    };
    const bundle = await production.crypto.createMasterKeyBundle([
      { context: envelopeContext, wrappingKey },
    ]);
    const contentContext = {
      syncedPocketId: envelopeContext.syncedPocketId,
      revision: 1,
      contentType: production.crypto.FORMAT.contentType,
    };
    return {
      kind: production.deviceStore.FORMAT.recordKind,
      schemaVersion: 2,
      storeRevision: 1,
      syncedPocketId: envelopeContext.syncedPocketId,
      deviceId: "device-p041-legacy",
      deviceWrappingKey: wrappingKey,
      deviceEnvelope: {
        context: envelopeContext,
        metadata: {
          contractVersion: 1,
          syncedPocketId: envelopeContext.syncedPocketId,
          envelopeId: envelopeContext.envelopeId,
          kind: "device",
          version: 1,
          deviceId: "device-p041-legacy",
          createdAt: "2041-01-01T00:00:00.000Z",
          kdf: "none",
        },
        record: bundle.envelopes[0].record,
      },
      content: {
        context: contentContext,
        record: await production.crypto.sealContent(PAYLOAD, bundle.masterKey, contentContext),
      },
      remote: { confirmedRevision: 1, pending: null, conflict: null },
      usage: {
        masterKeyGeneration: 1,
        contentEncryptionsOnDevice: 1,
        envelopeEncryptionsOnDevice: 1,
      },
      activationDraft: null,
    };
  })();
  const migrated = production.deviceStore.migrateRecord(legacy);
  assert.equal(migrated.schemaVersion, 4);
  assert.equal(migrated.recoveryDraft, null);
});

test("asymmetric recovery proof replaces the retired symmetric verifier", async () => {
  const production = loadProduction();
  const keys = await production.crypto.createRecoveryAuthorisationKeyPair();
  assert.equal(keys.recoveryAuthorisation.algorithm, "Ed25519");
  assert.equal(keys.recoveryVerifier.publicKeyFormat, "spki");
  assert.equal(typeof production.crypto.createRecoveryAuthorisationVerifier, "undefined");
  assert.doesNotMatch(source(MODULE), /deriveBits|subtle\.|RECOVERY_AUTHORISATION_LABEL/);
});

test("production recovery source has no owner, Save, storage fallback or background path", () => {
  const text = source(MODULE);
  assert.doesNotMatch(text, /localStorage|sessionStorage|indexedDB|fetch\s*\(|setTimeout|setInterval|Worker|console\./i);
  assert.doesNotMatch(text, /adoptSyncedOwner|writeTruthFile|exportTree|saveLocalSource|document\./i);
  assert.doesNotMatch(source("package.json"), /p041|emergency-recovery/);
});
