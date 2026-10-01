"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { webcrypto } = require("node:crypto");
const { CryptoKey } = globalThis;

const ROOT = path.resolve(__dirname, "..");

function source(relativePath) {
  return fs.readFileSync(path.join(ROOT, relativePath), "utf8");
}

function plain(value) {
  return value === undefined ? undefined : JSON.parse(JSON.stringify(value));
}

function clone(value) {
  return structuredClone(value);
}

function b64(length, start = 1) {
  return Buffer.from(Uint8Array.from({ length }, (_unused, index) => (start + index) & 255))
    .toString("base64url");
}

function loadProduction() {
  const context = {
    crypto: webcrypto,
    CryptoKey,
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
    btoa: (value) => Buffer.from(value, "binary").toString("base64"),
    atob: (value) => Buffer.from(value, "base64").toString("binary"),
  };
  context.window = context;
  context.globalThis = context;
  vm.createContext(context);
  for (const file of [
    "js/pocket-sync-security-contract.js",
    "js/pocket-sync-crypto.js",
    "js/pocket-sync-ownerless-activation-draft.js",
    "js/pocket-sync-activation.js",
    "js/pocket-sync-owner-controller.js",
    "js/pocket-sync-additional-device.js",
  ]) vm.runInContext(source(file), context, { filename: file });
  return {
    security: context.PocketSyncSecurityContract,
    crypto: context.PocketSyncCrypto,
    ownerless: context.PocketSyncOwnerlessActivationDraft,
    activation: context.PocketSyncActivation,
    ownerController: context.PocketSyncOwnerController,
    additionalDevice: context.PocketSyncAdditionalDevice,
  };
}

function ids() {
  return {
    deviceEnvelopeId: "p285-device-envelope",
    prfEnvelopeId: "p285-prf-envelope",
    recoveryEnvelopeId: "p285-recovery-envelope",
    registrationOperationId: "p285-registration-operation",
    contentOperationId: "p285-content-operation",
    contentLogicalChangeId: "p285-content-change",
    deviceEnvelopeOperationId: "p285-device-envelope-operation",
    deviceEnvelopeLogicalChangeId: "p285-device-envelope-change",
    prfEnvelopeOperationId: "p285-prf-envelope-operation",
    prfEnvelopeLogicalChangeId: "p285-prf-envelope-change",
    recoveryOperationId: "p285-recovery-operation",
    recoveryLogicalChangeId: "p285-recovery-change",
  };
}

function readiness(overrides = {}) {
  return {
    activationPhase: "pre-adoption",
    targetCurrentOrReplaceable: true,
    canonicalPayloadPreparedLocally: true,
    masterKeyCreatedLocally: true,
    deviceRecordDurable: true,
    accountIdentityAuthenticatedAndPinned: true,
    accountEligibleForFirstCreation: true,
    initialRemoteCommitSucceeded: true,
    recoveryEnvelopeExists: true,
    recoveryCopyStored: true,
    syncedOwnerAdopted: false,
    ...overrides,
  };
}

async function fixture(apis, stage = "ready-for-adoption") {
  const syncedPocketId = "pocket-p285";
  const deviceId = "device-p285";
  const deviceEnvelopeId = "p285-device-envelope";
  const deviceWrappingKey = await apis.crypto.generateDeviceWrappingKey();
  const deviceContext = {
    syncedPocketId,
    envelopeId: deviceEnvelopeId,
    envelopeKind: "device",
    envelopeVersion: 1,
  };
  const bundle = await apis.crypto.createMasterKeyBundle([
    { context: deviceContext, wrappingKey: deviceWrappingKey },
  ]);
  const contentContext = {
    syncedPocketId,
    revision: 1,
    contentType: apis.crypto.FORMAT.contentType,
  };
  const payload = { schema: "portal.export.v1", notes: ["P285 synthetic"] };
  const contentRecord = await apis.crypto.sealContent(payload, bundle.masterKey, contentContext);
  const opaqueEnvelope = bundle.envelopes[0].record;
  const adopted = stage === "adopted";
  const draft = {
    kind: "pocket.sync.activation-draft",
    schemaVersion: 2,
    activationMode: "ownerless-first-create",
    accountPath: "existing-unbound",
    activationId: "activation-p285",
    stage,
    syncedPocketId,
    deviceId,
    ids: ids(),
    content: { context: contentContext, record: contentRecord },
    deviceEnvelope: {
      envelopeId: deviceEnvelopeId,
      envelopeKind: "device",
      envelopeVersion: 1,
      deviceId,
      credentialId: null,
      kdf: "none",
      kdfSalt: null,
      derivationVersion: null,
      encryptedEnvelope: opaqueEnvelope,
    },
    prfEnvelope: null,
    prfStatus: "skipped",
    recoveryEnvelope: {
      envelopeId: "p285-recovery-envelope",
      envelopeKind: "recovery",
      envelopeVersion: 1,
      deviceId: null,
      credentialId: null,
      kdf: "HKDF-SHA-256",
      kdfSalt: b64(32, 31),
      derivationVersion: 1,
      encryptedEnvelope: opaqueEnvelope,
    },
    recoveryVerifier: {
      version: 1,
      algorithm: "Ed25519",
      publicKeyFormat: "spki",
      publicKey: b64(64, 51),
    },
    recoveryAuthorisation: null,
    recoveryRoot: null,
    recoveryPackage: null,
    registrationContinuation: null,
    account: {
      accountId: "account-p285",
      credentialId: "credential-p285",
      credentialVersion: 1,
      accountPolicyVersion: 1,
      prfEvaluationInput: b64(32, 81),
    },
    confirmedRemoteRevision: 1,
    keySetVersion: 2,
    recoveryVersion: 1,
    accountLocator: "recovery-locator-p285",
    pendingOperation: null,
    recoveryCopyStored: true,
    adopted,
    createdAt: "2031-01-01T00:00:00.000Z",
    updatedAt: "2031-01-01T00:00:01.000Z",
  };
  const activationContext = {
    syncedPocketId,
    revision: 1,
    contentType: apis.crypto.FORMAT.contentType,
  };
  const activationDraft = {
    context: activationContext,
    record: await apis.crypto.sealContent(draft, deviceWrappingKey, activationContext),
  };
  const record = {
    kind: "pocket.sync.device-state",
    schemaVersion: 5,
    storeRevision: 1,
    syncedPocketId,
    deviceId,
    deviceWrappingKey,
    deviceEnvelope: {
      context: deviceContext,
      metadata: {
        contractVersion: 1,
        syncedPocketId,
        envelopeId: deviceEnvelopeId,
        kind: "device",
        version: 1,
        deviceId,
        createdAt: "2031-01-01T00:00:00.000Z",
        kdf: "none",
      },
      record: opaqueEnvelope,
    },
    content: { context: contentContext, record: contentRecord },
    remote: { confirmedRevision: 1, pending: null, conflict: null },
    usage: {
      masterKeyGeneration: 1,
      masterKeyContentEncryptions: 1,
      masterKeyContentEncryptionLimit: 2 ** 20,
      deviceWrappingKeyEncryptions: 1,
    },
    activationDraft,
    recoveryDraft: null,
    additionalDeviceDraft: null,
  };
  return { draft, record, payload, masterKey: bundle.masterKey };
}

function ownerlessConfig(apis) {
  return { securityContract: apis.security, crypto: apis.crypto };
}

test("P285 adds truthful ownerless readiness without changing v1 readiness semantics", () => {
  const apis = loadProduction();
  const v1 = apis.security.validateActivationReadiness({
    activationPhase: "pre-adoption",
    sourceSaved: true,
    sourceSessionCurrent: true,
    masterKeyCreatedLocally: true,
    deviceRecordDurable: true,
    initialRemoteCommitSucceeded: true,
    accountCredentialRegistered: true,
    recoveryEnvelopeExists: true,
    recoveryCopyStored: true,
    syncedOwnerAdopted: false,
  });
  assert.deepEqual(plain(v1), { ok: true, ready: true });

  assert.deepEqual(
    plain(apis.security.validateOwnerlessActivationReadiness(readiness())),
    { ok: true, ready: true }
  );
  const falseTarget = apis.security.validateOwnerlessActivationReadiness(
    readiness({ targetCurrentOrReplaceable: false })
  );
  assert.equal(falseTarget.ok, false);
  assert.deepEqual(plain(falseTarget.missing), ["targetCurrentOrReplaceable"]);

  const sourceLie = readiness();
  delete sourceLie.canonicalPayloadPreparedLocally;
  sourceLie.sourceSaved = true;
  assert.equal(apis.security.validateOwnerlessActivationReadiness(sourceLie).ok, false);

  const registrationLie = readiness();
  delete registrationLie.accountIdentityAuthenticatedAndPinned;
  registrationLie.accountCredentialRegistered = true;
  assert.equal(apis.security.validateOwnerlessActivationReadiness(registrationLie).ok, false);
});

test("P285 canonical v2 classifiers expose only safe completion identity and fail closed", async () => {
  const apis = loadProduction();
  const ready = await fixture(apis, "ready-for-adoption");
  const adopted = await fixture(apis, "adopted");
  const config = ownerlessConfig(apis);

  assert.deepEqual(plain(apis.ownerless.classifyReadyForAdoption(ready.draft, config)), {
    state: "ready-for-adoption",
    activationId: "activation-p285",
    syncedPocketId: "pocket-p285",
    deviceId: "device-p285",
  });
  assert.equal(apis.ownerless.classifyAdopted(ready.draft, config), null);
  assert.deepEqual(plain(apis.ownerless.classifyAdopted(adopted.draft, config)), {
    state: "adopted",
    activationId: "activation-p285",
    syncedPocketId: "pocket-p285",
    deviceId: "device-p285",
  });
  const publicText = JSON.stringify(apis.ownerless.classifyAdopted(adopted.draft, config));
  assert.doesNotMatch(publicText, /account|prf|content|recovery/i);

  const invalid = [
    { ...ready.draft, schemaVersion: 1 },
    { ...ready.draft, activationMode: "source-handover" },
    { ...ready.draft, accountPath: "other" },
    { ...ready.draft, stage: "source-ready" },
    { ...ready.draft, sourceSaved: true },
    { ...ready.draft, account: { ...ready.draft.account, outputBytes: [1] } },
    { ...ready.draft, account: null },
    { ...ready.draft, pendingOperation: "content-upload" },
    { ...ready.draft, recoveryCopyStored: false },
    { ...ready.draft, confirmedRemoteRevision: 0 },
    { ...ready.draft, keySetVersion: 1 },
    { ...ready.draft, recoveryVersion: 0 },
  ];
  for (const candidate of invalid) {
    assert.throws(
      () => apis.ownerless.classifyReadyForAdoption(candidate, config),
      (error) => error.code === "ownerless-activation-completion-invalid"
    );
  }
});

test("P285 owner-controller accepts exact ready v2 only through canonical classifier and ownerless readiness", async () => {
  const apis = loadProduction();
  const ready = await fixture(apis, "ready-for-adoption");
  let found = { record: ready.record, draft: ready.draft };
  const controller = apis.ownerController.createSyncedOwnerController({
    crypto: apis.crypto,
    deviceStore: {
      async readPocket() { return ready.record; },
      async readRecoveryAttempt() { return null; },
      async readActivation() { return found; },
      async replacePocket(_id, _revision, value) { return value; },
      async reservePocketEncryptionUsage() { return ready.record; },
    },
    contentService: { async conditionalUpload() { throw new Error("not expected"); } },
    randomBytes(length) { return new Uint8Array(length); },
  });
  const request = {
    ownerKind: "synced",
    activationId: ready.draft.activationId,
    syncedPocketId: ready.draft.syncedPocketId,
    deviceId: ready.draft.deviceId,
    confirmedRemoteRevision: 1,
    syncPending: false,
    ownerlessReadiness: readiness(),
  };
  const accepted = await controller.adoptReadyActivation(request);
  assert.equal(accepted.ok, true);

  controller.releaseSyncedOwner();
  const falseReadiness = await controller.adoptReadyActivation({
    ...request,
    ownerlessReadiness: readiness({ accountEligibleForFirstCreation: false }),
  });
  assert.equal(falseReadiness.reason, "activation-not-eligible");

  const adopted = await fixture(apis, "adopted");
  found = { record: adopted.record, draft: adopted.draft };
  const completed = await controller.adoptReadyActivation(request);
  assert.equal(completed.reason, "activation-not-eligible");

  found = { record: ready.record, draft: { ...ready.draft, sourceSaved: true } };
  const sourceLookalike = await controller.adoptReadyActivation(request);
  assert.equal(sourceLookalike.reason, "activation-not-eligible");
});

async function openAdditionalDevice(apis, record) {
  let sequence = 1;
  const opener = apis.additionalDevice.createAdditionalDeviceOpener({
    crypto: apis.crypto,
    deviceStore: {
      async open() {},
      async readPocket() { return record; },
      async createPocket(value) { return value; },
      async replacePocket(_id, _revision, value) { record = value; return value; },
      async reservePocketEncryptionUsage() { return record; },
    },
    accountClient: {
      async authenticatePasskey() {
        return {
          ok: true,
          accountAuthenticated: true,
          contentUnlocked: false,
          accountId: "account-p285",
          credentialId: "credential-p285",
          prf: { status: "not-requested" },
        };
      },
    },
    discoveryService: {
      async readSyncedPocket() {
        return { status: "ready", syncedPocketId: "pocket-p285" };
      },
    },
    contentService: {
      async readRevision() { return { recordPresent: true, revision: 1 }; },
      async downloadEncryptedRecord() {
        return {
          syncedPocketId: "pocket-p285",
          revision: 1,
          encryptedRecord: record.content.record,
        };
      },
    },
    envelopeService: {
      async listEnvelopes() {
        const metadata = record.deviceEnvelope.metadata;
        return {
          keySetVersion: 2,
          envelopes: [{
            envelopeId: metadata.envelopeId,
            envelopeKind: "device",
            envelopeVersion: metadata.version,
            deviceId: metadata.deviceId,
            credentialId: null,
            kdf: "none",
            kdfSalt: null,
            derivationVersion: null,
            status: "active",
          }],
        };
      },
      async downloadEnvelope() { throw new Error("not expected"); },
      async addEnvelope() { throw new Error("not expected"); },
    },
    randomBytes(length) {
      const value = new Uint8Array(length);
      value.fill(sequence++);
      return value;
    },
    now: () => Date.parse("2031-01-01T00:00:00.000Z"),
    strandedActivationClassifier: apis.activation.createStrandedActivationClassifier({
      securityContract: apis.security,
      crypto: apis.crypto,
    }),
  });
  return opener.openExisting({
    captureTarget: () => ({ ownerKind: "none", id: "p285-target" }),
    isTargetCurrent: () => true,
    validatePayload: (payload) => payload?.schema === "portal.export.v1",
    adoptOpenedPocket: async () => true,
  });
}

test("P285 additional-device recognises exact adopted v2, but not unfinished v2 as completed or stranded-v1", async () => {
  const apis = loadProduction();
  const adopted = await fixture(apis, "adopted");
  assert.deepEqual(plain(await openAdditionalDevice(apis, adopted.record)), {
    ok: true,
    reason: "synced-pocket-opened",
    confirmedRemoteRevision: 1,
  });

  const ready = await fixture(apis, "ready-for-adoption");
  const unfinished = await openAdditionalDevice(apis, ready.record);
  assert.equal(unfinished.ok, false);
  assert.equal(unfinished.reason, "additional-device-state-invalid");

  const invalidDraft = clone(adopted.draft);
  invalidDraft.pendingOperation = "content-upload";
  const invalidRecord = clone(adopted.record);
  invalidRecord.deviceWrappingKey = adopted.record.deviceWrappingKey;
  invalidRecord.activationDraft = {
    context: adopted.record.activationDraft.context,
    record: await apis.crypto.sealContent(
      invalidDraft,
      adopted.record.deviceWrappingKey,
      adopted.record.activationDraft.context
    ),
  };
  const invalid = await openAdditionalDevice(apis, invalidRecord);
  assert.equal(invalid.ok, false);
  assert.equal(invalid.reason, "additional-device-state-invalid");
});

test("P285 recognition remains isolated from UI while P301 composes the accepted runtime seam", () => {
  assert.equal((source("index.html").match(/pocket-sync-ownerless-activation-draft\.js/g) || []).length, 1);
  assert.doesNotMatch(source("sw.js"), /pocket-sync-ownerless-activation-draft\.js/);
  assert.match(source("js/pocket-sync-browser-runtime.js"), /startOwnerlessFirstCreate/);
  assert.doesNotMatch(source("js/pocket-sync-browser-runtime.js"),
    /function\\s+(?:activateOwnerless|resumeOwnerless|findOwnerlessActivation)\\s*\\(/);
  assert.match(source("js/pocket-sync-activation.js"),
    /global\.PocketSyncOwnerlessActivationDraft/);
  assert.doesNotMatch(source("js/pocket-sync-activation.js"),
    /findOwnerlessActivation|PocketSyncFirstCreate/);
  assert.match(source("js/pocket-sync-activation.js"), /draft\.schemaVersion !== 1/);
});
