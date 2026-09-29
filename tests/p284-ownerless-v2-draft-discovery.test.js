"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { webcrypto } = require("node:crypto");
const { CryptoKey } = globalThis;
const {
  createSharedDeviceStoreState,
  createMemoryDeviceStoreDriver,
} = require("./helpers/p030-memory-device-store-driver.js");

const ROOT = path.resolve(__dirname, "..");
const OWNERLESS = "js/pocket-sync-ownerless-activation-draft.js";
const DEVICE_STORE = "js/pocket-sync-device-store.js";
const ACTIVATION = "js/pocket-sync-activation.js";

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
    OWNERLESS,
    DEVICE_STORE,
    ACTIVATION,
  ]) vm.runInContext(source(file), context, { filename: file });
  return {
    context,
    security: context.PocketSyncSecurityContract,
    crypto: context.PocketSyncCrypto,
    ownerless: context.PocketSyncOwnerlessActivationDraft,
    deviceStore: context.PocketSyncDeviceStore,
    activation: context.PocketSyncActivation,
  };
}

async function localMaterial(apis, syncedPocketId = "pocket-p284", deviceId = "device-p284") {
  const deviceWrappingKey = await apis.crypto.generateDeviceWrappingKey();
  const deviceContext = {
    syncedPocketId,
    envelopeId: "device-envelope-p284",
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
  const contentRecord = await apis.crypto.sealContent(
    { kind: "p284-synthetic", thoughts: ["encrypted"] },
    bundle.masterKey,
    contentContext
  );
  return {
    deviceWrappingKey,
    opaqueEnvelope: bundle.envelopes[0].record,
    content: { context: contentContext, record: contentRecord },
  };
}

function ids() {
  return {
    deviceEnvelopeId: "device-envelope-p284",
    prfEnvelopeId: "prf-envelope-p284",
    recoveryEnvelopeId: "recovery-envelope-p284",
    registrationOperationId: "registration-operation-p284",
    contentOperationId: "content-operation-p284",
    contentLogicalChangeId: "content-change-p284",
    deviceEnvelopeOperationId: "device-envelope-operation-p284",
    deviceEnvelopeLogicalChangeId: "device-envelope-change-p284",
    prfEnvelopeOperationId: "prf-envelope-operation-p284",
    prfEnvelopeLogicalChangeId: "prf-envelope-change-p284",
    recoveryOperationId: "recovery-operation-p284",
    recoveryLogicalChangeId: "recovery-change-p284",
  };
}

async function ownerlessDraft(apis, overrides = {}) {
  const syncedPocketId = overrides.syncedPocketId || "pocket-p284";
  const deviceId = overrides.deviceId || "device-p284";
  const material = overrides.material || await localMaterial(apis, syncedPocketId, deviceId);
  const value = {
    kind: "pocket.sync.activation-draft",
    schemaVersion: 2,
    activationMode: "ownerless-first-create",
    accountPath: "existing-unbound",
    activationId: overrides.activationId || "activation-p284",
    stage: "account-ready",
    syncedPocketId,
    deviceId,
    ids: ids(),
    content: material.content,
    deviceEnvelope: {
      envelopeId: "device-envelope-p284",
      envelopeKind: "device",
      envelopeVersion: 1,
      deviceId,
      credentialId: null,
      kdf: "none",
      kdfSalt: null,
      derivationVersion: null,
      encryptedEnvelope: material.opaqueEnvelope,
    },
    prfEnvelope: null,
    prfStatus: "pending",
    recoveryEnvelope: {
      envelopeId: "recovery-envelope-p284",
      envelopeKind: "recovery",
      envelopeVersion: 1,
      deviceId: null,
      credentialId: null,
      kdf: "HKDF-SHA-256",
      kdfSalt: b64(32, 21),
      derivationVersion: 1,
      encryptedEnvelope: material.opaqueEnvelope,
    },
    recoveryVerifier: {
      version: 1,
      algorithm: "Ed25519",
      publicKeyFormat: "spki",
      publicKey: b64(64, 31),
    },
    recoveryAuthorisation: {
      version: 1,
      algorithm: "Ed25519",
      privateKeyFormat: "pkcs8",
      privateKey: b64(64, 41),
    },
    recoveryRoot: b64(32, 51),
    recoveryPackage: null,
    registrationContinuation: null,
    account: {
      accountId: "account-p284",
      credentialId: "credential-p284",
      credentialVersion: 1,
      accountPolicyVersion: 1,
      prfEvaluationInput: b64(32, 61),
    },
    confirmedRemoteRevision: 0,
    keySetVersion: 0,
    recoveryVersion: 0,
    accountLocator: null,
    pendingOperation: null,
    recoveryCopyStored: false,
    adopted: false,
    createdAt: "2030-01-01T00:00:00.000Z",
    updatedAt: "2030-01-01T00:00:01.000Z",
  };
  return Object.assign(value, overrides, { material: undefined });
}

function withoutUndefined(value) {
  const copy = {};
  for (const [key, child] of Object.entries(value)) {
    if (child !== undefined) copy[key] = child;
  }
  return copy;
}

function ownerlessConfig(apis) {
  return { securityContract: apis.security, crypto: apis.crypto };
}

function toV1(v2) {
  const value = clone(v2);
  delete value.activationMode;
  delete value.accountPath;
  value.schemaVersion = 1;
  value.stage = "device-staged";
  value.sourceOwnerKind = "json";
  value.sourceContinuityId = "json:source-p284";
  value.sourceSaved = true;
  value.account = null;
  value.pendingOperation = "account-registration";
  value.registrationContinuation = null;
  value.confirmedRemoteRevision = 0;
  value.keySetVersion = 0;
  value.recoveryVersion = 0;
  value.accountLocator = null;
  value.prfStatus = "pending";
  value.prfEnvelope = null;
  value.recoveryCopyStored = false;
  value.adopted = false;
  return value;
}

function registrationContinuation(draft) {
  return {
    apiVersion: 1,
    operationId: draft.ids.registrationOperationId,
    ceremonyId: "ceremony-p284",
    deviceId: draft.deviceId,
    prfEvaluationInput: b64(32, 71),
    credential: { id: "credential-registration-p284" },
  };
}

async function storedRecordWithDraft(apis, draft) {
  const material = await localMaterial(apis, draft.syncedPocketId, draft.deviceId);
  const draftContext = {
    syncedPocketId: draft.syncedPocketId,
    revision: 1,
    contentType: apis.crypto.FORMAT.contentType,
  };
  return {
    kind: "pocket.sync.device-state",
    schemaVersion: 5,
    storeRevision: 1,
    syncedPocketId: draft.syncedPocketId,
    deviceId: draft.deviceId,
    deviceWrappingKey: material.deviceWrappingKey,
    deviceEnvelope: {
      context: {
        syncedPocketId: draft.syncedPocketId,
        envelopeId: "stored-device-envelope-p284",
        envelopeKind: "device",
        envelopeVersion: 1,
      },
      metadata: {
        contractVersion: 1,
        syncedPocketId: draft.syncedPocketId,
        envelopeId: "stored-device-envelope-p284",
        kind: "device",
        version: 1,
        deviceId: draft.deviceId,
        createdAt: "2030-01-01T00:00:00.000Z",
        kdf: "none",
      },
      record: (await apis.crypto.createMasterKeyBundle([{
        context: {
          syncedPocketId: draft.syncedPocketId,
          envelopeId: "stored-device-envelope-p284",
          envelopeKind: "device",
          envelopeVersion: 1,
        },
        wrappingKey: material.deviceWrappingKey,
      }])).envelopes[0].record,
    },
    content: material.content,
    remote: {
      confirmedRevision: 0,
      pending: {
        expectedRevision: 0,
        operationId: "stored-content-operation-p284",
        logicalChangeId: "stored-content-change-p284",
        attemptKind: "new-change",
      },
      conflict: null,
    },
    usage: {
      masterKeyGeneration: 1,
      masterKeyContentEncryptions: 1,
      masterKeyContentEncryptionLimit: 2 ** 20,
      deviceWrappingKeyEncryptions: 1,
    },
    activationDraft: {
      context: draftContext,
      record: await apis.crypto.sealContent(draft, material.deviceWrappingKey, draftContext),
    },
    recoveryDraft: null,
    additionalDeviceDraft: null,
  };
}

async function openStore(apis, records = []) {
  const shared = createSharedDeviceStoreState();
  for (const record of records) shared.records.set(record.syncedPocketId, record);
  const store = apis.deviceStore.createStore(createMemoryDeviceStoreDriver(shared));
  await store.open();
  return { store, shared };
}

test("P284 freezes one exact ownerless activation-v2 identity and field contract", async () => {
  const apis = loadProduction();
  assert.deepEqual(plain(apis.ownerless.POLICY), {
    kind: "pocket.sync.activation-draft",
    schemaVersion: 2,
    activationMode: "ownerless-first-create",
    fields: [
      "kind", "schemaVersion", "activationMode", "accountPath", "activationId",
      "stage", "syncedPocketId", "deviceId", "ids", "content", "deviceEnvelope",
      "prfEnvelope", "prfStatus", "recoveryEnvelope", "recoveryVerifier",
      "recoveryAuthorisation", "recoveryRoot", "recoveryPackage",
      "registrationContinuation", "account", "confirmedRemoteRevision",
      "keySetVersion", "recoveryVersion", "accountLocator", "pendingOperation",
      "recoveryCopyStored", "adopted", "createdAt", "updatedAt",
    ],
    identifierFields: [
      "deviceEnvelopeId", "prfEnvelopeId", "recoveryEnvelopeId",
      "registrationOperationId", "contentOperationId", "contentLogicalChangeId",
      "deviceEnvelopeOperationId", "deviceEnvelopeLogicalChangeId",
      "prfEnvelopeOperationId", "prfEnvelopeLogicalChangeId",
      "recoveryOperationId", "recoveryLogicalChangeId",
    ],
    stages: {
      "source-ready": 0,
      "local-material-ready": 1,
      "device-staged": 2,
      "account-ready": 3,
      "content-committed": 4,
      "device-envelope-committed": 5,
      "prf-envelope-committed": 6,
      "prf-envelope-skipped": 6,
      "recovery-initialised": 7,
      "recovery-copy-pending": 8,
      "ready-for-adoption": 9,
      adopted: 10,
    },
    accountPaths: ["existing-unbound", "new-account"],
    pendingOperations: [
      null, "account-registration", "account-registration-finish",
      "content-upload", "content-conflict", "device-envelope", "device-envelope-conflict",
      "prf-envelope", "prf-envelope-conflict", "recovery-initialisation", "recovery-conflict",
    ],
  });
  const draft = withoutUndefined(await ownerlessDraft(apis));
  const checked = apis.ownerless.validate(draft, ownerlessConfig(apis));
  assert.deepEqual(plain(checked), plain(draft));
  assert.equal(Object.isFrozen(checked), true);
  assert.equal("sourceOwnerKind" in checked, false);
  assert.equal("sourceContinuityId" in checked, false);
  assert.equal("sourceSaved" in checked, false);
});

test("P284 preserves exact v1 semantics and v1 refuses ownerless/v2 lookalikes", async () => {
  const apis = loadProduction();
  const v2 = withoutUndefined(await ownerlessDraft(apis));
  const v1 = toV1(v2);
  const classifier = apis.activation.createStrandedActivationClassifier({
    securityContract: apis.security,
    crypto: apis.crypto,
  });
  assert.equal(classifier.classify(v1, {
    syncedPocketId: v1.syncedPocketId,
    deviceId: v1.deviceId,
  }), "exact-stranded");
  assert.equal(classifier.classify({ ...v1, sourceOwnerKind: "none" }, {
    syncedPocketId: v1.syncedPocketId,
    deviceId: v1.deviceId,
  }), "invalid");
  assert.equal(classifier.classify({ ...v1, activationMode: "ownerless-first-create" }, {
    syncedPocketId: v1.syncedPocketId,
    deviceId: v1.deviceId,
  }), "invalid");
});

test("P284 ownerless v2 fails closed on field, identity, stage, source-lookalike and raw-PRF drift", async () => {
  const apis = loadProduction();
  const config = ownerlessConfig(apis);
  const valid = withoutUndefined(await ownerlessDraft(apis));
  const invalid = [
    (() => { const v = clone(valid); delete v.updatedAt; return v; })(),
    { ...valid, schemaVersion: 1 },
    { ...valid, activationMode: "source-handover" },
    { ...valid, accountPath: "other" },
    { ...valid, stage: "account-registered" },
    { ...valid, sourceOwnerKind: "json" },
    { ...valid, account: { ...valid.account, outputBytes: [1, 2, 3] } },
    { ...valid, account: null },
  ];
  for (const value of invalid) {
    assert.throws(() => apis.ownerless.validate(value, config),
      (error) => error.code === "ownerless-activation-state-invalid");
  }
});

test("P284 enforces existing-unbound vs new-account registration continuation semantics", async () => {
  const apis = loadProduction();
  const config = ownerlessConfig(apis);
  const existing = withoutUndefined(await ownerlessDraft(apis));
  assert.throws(() => apis.ownerless.validate({
    ...existing,
    pendingOperation: "account-registration-finish",
    registrationContinuation: registrationContinuation(existing),
  }, config), (error) => error.code === "ownerless-activation-state-invalid");

  const newAccountBase = withoutUndefined(await ownerlessDraft(apis, {
    accountPath: "new-account",
    stage: "device-staged",
    account: null,
    pendingOperation: "account-registration-finish",
  }));
  const newAccount = {
    ...newAccountBase,
    registrationContinuation: registrationContinuation(newAccountBase),
  };
  assert.equal(apis.ownerless.validate(newAccount, config).accountPath, "new-account");

  assert.throws(() => apis.ownerless.validate({
    ...newAccount,
    stage: "account-ready",
    account: existing.account,
  }, config), (error) => error.code === "ownerless-activation-state-invalid");
});

test("P284 keeps remote, recovery, adoption and account-locator meaning fail-closed", async () => {
  const apis = loadProduction();
  const config = ownerlessConfig(apis);
  const valid = withoutUndefined(await ownerlessDraft(apis));
  assert.throws(() => apis.ownerless.validate({
    ...valid,
    stage: "content-committed",
    confirmedRemoteRevision: 0,
  }, config), (error) => error.code === "ownerless-activation-state-invalid");
  assert.throws(() => apis.ownerless.validate({
    ...valid,
    adopted: true,
  }, config), (error) => error.code === "ownerless-activation-state-invalid");

  const recovery = {
    ...valid,
    stage: "recovery-initialised",
    confirmedRemoteRevision: 1,
    keySetVersion: 2,
    recoveryVersion: 1,
    accountLocator: "recovery-locator-p284",
  };
  assert.equal(apis.ownerless.validate(recovery, config).accountLocator, "recovery-locator-p284");
  assert.throws(() => apis.ownerless.validate({
    ...recovery,
    accountLocator: recovery.account.accountId,
  }, config), (error) => error.code === "ownerless-activation-state-invalid");
});

test("P284 device-store finder proves none, exact match, v1 ignored and ambiguity without secrets", async () => {
  const apis = loadProduction();
  const empty = await openStore(apis);
  assert.deepEqual(plain(await empty.store.findOwnerlessActivation()), { state: "none" });

  const v2a = withoutUndefined(await ownerlessDraft(apis, {
    syncedPocketId: "pocket-p284-a",
    deviceId: "device-p284-a",
    activationId: "activation-p284-a",
  }));
  const v1 = toV1(withoutUndefined(await ownerlessDraft(apis, {
    syncedPocketId: "pocket-p284-v1",
    deviceId: "device-p284-v1",
    activationId: "activation-p284-v1",
  })));
  const ignored = await openStore(apis, [await storedRecordWithDraft(apis, v1)]);
  assert.deepEqual(plain(await ignored.store.findOwnerlessActivation()), { state: "none" });

  const one = await openStore(apis, [await storedRecordWithDraft(apis, v2a)]);
  const oneResult = await one.store.findOwnerlessActivation();
  assert.deepEqual(plain(oneResult), { state: "match", activationId: "activation-p284-a" });
  assert.deepEqual(Object.keys(oneResult), ["state", "activationId"]);
  assert.equal(JSON.stringify(oneResult).includes("account"), false);
  assert.equal(JSON.stringify(oneResult).includes("prf"), false);
  assert.equal(JSON.stringify(oneResult).includes("recovery"), false);

  const v2b = withoutUndefined(await ownerlessDraft(apis, {
    syncedPocketId: "pocket-p284-b",
    deviceId: "device-p284-b",
    activationId: "activation-p284-b",
  }));
  const ambiguous = await openStore(apis, [
    await storedRecordWithDraft(apis, v2a),
    await storedRecordWithDraft(apis, v2b),
  ]);
  assert.deepEqual(plain(await ambiguous.store.findOwnerlessActivation()), { state: "ambiguous" });
});

test("P284 ownerless finder fails closed on undecryptable or malformed relevant activation material", async () => {
  const apis = loadProduction();
  const v2 = withoutUndefined(await ownerlessDraft(apis, {
    syncedPocketId: "pocket-p284-corrupt",
    deviceId: "device-p284-corrupt",
    activationId: "activation-p284-corrupt",
  }));
  const corruptedRecord = await storedRecordWithDraft(apis, v2);
  const encryptedDraft = corruptedRecord.activationDraft.record;
  corruptedRecord.activationDraft.record = {
    ...encryptedDraft,
    ciphertext: encryptedDraft.ciphertext.replace(
      /^./,
      (character) => character === "A" ? "B" : "A"
    ),
  };
  const corrupted = await openStore(apis, [corruptedRecord]);
  await assert.rejects(corrupted.store.findOwnerlessActivation(),
    (error) => error.code === "ownerless-activation-draft-invalid");

  const malformed = { ...v2, activationMode: "other" };
  const malformedStore = await openStore(apis, [await storedRecordWithDraft(apis, malformed)]);
  await assert.rejects(malformedStore.store.findOwnerlessActivation(),
    (error) => error.code === "ownerless-activation-draft-invalid");
});

test("P284 leaves ownerless v2 dormant below production activation/runtime/UI composition", () => {
  assert.doesNotMatch(source("index.html"), /pocket-sync-ownerless-activation-draft\.js/);
  assert.doesNotMatch(source("sw.js"), /pocket-sync-ownerless-activation-draft\.js/);
  assert.doesNotMatch(source("js/pocket-sync-browser-runtime.js"),
    /PocketSyncOwnerlessActivationDraft|findOwnerlessActivation/);
  assert.doesNotMatch(source(ACTIVATION),
    /PocketSyncOwnerlessActivationDraft|findOwnerlessActivation|ownerless-first-create/);
  assert.match(source(ACTIVATION), /draft\.schemaVersion !== 1/);
  assert.match(source(DEVICE_STORE), /findOwnerlessActivation/);
});
