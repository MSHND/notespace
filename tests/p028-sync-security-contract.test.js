"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const REPO_ROOT = path.resolve(__dirname, "..");
const CONTRACT_SOURCE = "js/pocket-sync-security-contract.js";
const PLAINTEXT_SENTINEL = "P028-READABLE-NODE-NAME-DO-NOT-SEND";

function source(relativePath) {
  return fs.readFileSync(path.join(REPO_ROOT, relativePath), "utf8");
}

function loadProductionContract(relativePath, globalName) {
  const context = { Object, Array, Number, String, Boolean, TypeError };
  context.window = context;
  context.globalThis = context;
  vm.createContext(context);
  vm.runInContext(source(relativePath), context, { filename: relativePath });
  assert.ok(context[globalName], `${globalName} production contract must load`);
  return context[globalName];
}

function loadContract() {
  return loadProductionContract(CONTRACT_SOURCE, "PocketSyncSecurityContract");
}

function validPrf(overrides = {}) {
  return Object.assign({
    passkeyAuthenticated: true,
    extensionSupported: true,
    outputPresent: true,
    outputValid: true,
    outputBits: 256,
    envelopePresent: true,
    materialValid: true,
  }, overrides);
}

function validPath(overrides = {}) {
  return Object.assign({ available: true, envelopePresent: true, materialValid: true }, overrides);
}

function activation(overrides = {}) {
  return Object.assign({
    sourceSaved: true,
    sourceSessionCurrent: true,
    masterKeyCreatedLocally: true,
    deviceRecordDurable: true,
    initialRemoteCommitSucceeded: true,
    accountCredentialRegistered: true,
    recoveryEnvelopeExists: true,
    recoveryCopyStored: true,
    syncedOwnerAdopted: true,
  }, overrides);
}

function opaqueRecord(overrides = {}) {
  return Object.assign({
    format: "pocket.sync.content.opaque",
    version: 1,
    algorithm: "AES-GCM-256",
    nonce: "AAAAAAAAAAAAAAAA",
    ciphertext: "AAAAAAAAAAAAAAAAAAAAAA",
  }, overrides);
}

function writeRequest(overrides = {}) {
  return Object.assign({
    syncedPocketId: "pocket-opaque-1",
    expectedRevision: 7,
    operationId: "operation-opaque-1",
    logicalChangeId: "change-opaque-1",
    attemptKind: "new-change",
    encryptedRecord: opaqueRecord(),
  }, overrides);
}

test("P028 security contract remains inert when P045 loads it as a browser foundation", () => {
  const contractSource = source(CONTRACT_SOURCE);
  assert.doesNotThrow(() => new vm.Script(contractSource));
  assert.match(source("index.html"), /pocket-sync-security-contract\.js/);
  assert.doesNotMatch(source("sw.js"), /pocket-sync-security-contract\.js/);
  assert.doesNotMatch(source("js/pocket-sync-contract.js"), /PocketSyncSecurityContract/);
});

test("security, remote API, account and key versions are explicit", () => {
  const contract = loadContract();
  assert.equal(contract.SECURITY_CONTRACT_VERSION, 1);
  assert.equal(contract.REMOTE_API_CONTRACT_VERSION, 1);
  assert.equal(contract.MASTER_KEY_BITS, 256);
  assert.equal(contract.RECOVERY_ROOT_BITS, 256);
  assert.equal(contract.ACCOUNT_MODEL.ordinarySyncedPocketLimit, 1);
  assert.equal(contract.ACCOUNT_MODEL.schemaUsesSyncedPocketIds, true);
  assert.equal(contract.ACCOUNT_MODEL.schemaCanRepresentMultiplePocketIds, true);
});

test("P027 Turn on sync, original-file and Save copy remains exact", () => {
  const contract = loadProductionContract("js/pocket-sync-contract.js", "PocketSyncContract");
  assert.deepEqual(JSON.parse(JSON.stringify(contract.COPY)), {
    turnOnSync: {
      title: "Turn on sync",
      body: "Keep your Pocket available on your other devices. Your synced data will be protected so only you can read it.",
    },
    syncReady: {
      title: "Sync is ready",
      body: "Your Pocket is protected and available on your devices.",
    },
    status: {
      synced: "Saved · Synced",
      pending: "Saved on this device · Sync pending",
      conflict: "Pocket found newer changes from another device.",
    },
  });
  assert.deepEqual(JSON.parse(JSON.stringify(contract.plainJsonNotice("disposable-pocket.json"))), {
    title: "Your original file will stay where it is",
    body: "disposable-pocket.json is readable and will not be changed or deleted. After sync is working, you can decide whether to keep or remove it.",
  });
});

test("master-key policy requires local generation, authenticated encryption and nonce uniqueness", () => {
  const policy = loadContract().MASTER_KEY_POLICY;
  assert.deepEqual(JSON.parse(JSON.stringify(policy)), {
    generatedLocally: true,
    bits: 256,
    authenticatedEncryptionRequired: true,
    freshNoncePerEncryption: true,
    nonceReuseForbidden: true,
    multipleIndependentEnvelopes: true,
    envelopeRevocationReencryptsContent: false,
    rawBytesLifetime: "minimum practical",
    bestEffortClearTemporaryBytes: true,
    perfectJavaScriptZeroisationClaimed: false,
  });
});

test("envelope kinds and unlock priority are exact and ordered", () => {
  const contract = loadContract();
  assert.deepEqual([...contract.ENVELOPE_KINDS], ["device", "passkey-prf", "device-transfer", "recovery"]);
  assert.deepEqual([...contract.UNLOCK_PRIORITY], ["device", "passkey-prf", "device-transfer", "recovery", "unavailable"]);
});

test("unlock selection follows device, PRF, transfer, recovery, unavailable priority", () => {
  const contract = loadContract();
  assert.equal(contract.selectUnlockPath({
    device: validPath(), passkeyPrf: validPrf(), deviceTransfer: validPath(), recovery: validPath(),
  }).path, "device");
  assert.equal(contract.selectUnlockPath({
    passkeyPrf: validPrf(), deviceTransfer: validPath(), recovery: validPath(),
  }).path, "passkey-prf");
  assert.equal(contract.selectUnlockPath({
    passkeyPrf: validPrf({ extensionSupported: false }), deviceTransfer: validPath(), recovery: validPath(),
  }).path, "device-transfer");
  assert.equal(contract.selectUnlockPath({ recovery: validPath() }).path, "recovery");
  assert.equal(contract.selectUnlockPath({}).path, "unavailable");
});

test("passkey authentication alone never unlocks content", () => {
  const contract = loadContract();
  const result = contract.selectUnlockPath({
    passkeyPrf: { passkeyAuthenticated: true, extensionSupported: false },
  });
  assert.equal(result.ok, false);
  assert.equal(result.path, "unavailable");
  assert.equal(contract.PASSKEY_PRF_POLICY.passkeyIsContentKey, false);
  assert.equal(contract.PASSKEY_PRF_POLICY.soleRecoveryMethod, false);
  assert.equal(contract.PASSKEY_PRF_POLICY.accountAuthenticationUnlocksContent, false);
  assert.equal(contract.PASSKEY_PRF_POLICY.evaluationInputBytes, 32);
  assert.equal(contract.ACCOUNT_AUTHENTICATION_POLICY.passkeysOnly, true);
  assert.equal(contract.ACCOUNT_AUTHENTICATION_POLICY.accountAuthenticationImpliesContentUnlock, false);
  assert.equal(contract.ACCOUNT_AUTHENTICATION_POLICY.contentUnlockRequiresApprovedEnvelope, true);
});

test("public PRF evaluation input is canonical base64url and exactly 32 bytes", () => {
  const contract = loadContract();
  const input = "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";
  assert.equal(contract.PRF_EVALUATION_INPUT_BYTES, 32);
  assert.equal(contract.validatePublicPrfEvaluationInput(input).ok, true);
  assert.equal(contract.validatePublicPrfEvaluationInput(`${input}=`).ok, false);
  assert.equal(contract.validatePublicPrfEvaluationInput("AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA").ok, false);
});

test("PRF availability requires actual valid ceremony output", () => {
  const contract = loadContract();
  assert.equal(contract.validatePrfCeremonyResult(validPrf()).ok, true);
  assert.equal(contract.validatePrfCeremonyResult(validPrf({ outputPresent: false })).reason, "prf-output-unavailable");
  assert.equal(contract.validatePrfCeremonyResult(validPrf({ outputValid: false })).reason, "prf-output-invalid");
  assert.equal(contract.validatePrfCeremonyResult(validPrf({ outputBits: 128 })).reason, "prf-output-invalid");
});

test("invalid PRF material fails closed instead of falling through to recovery", () => {
  const result = loadContract().selectUnlockPath({
    passkeyPrf: validPrf({ outputValid: false }),
    recovery: validPath(),
  });
  assert.equal(result.reason, "prf-output-invalid");
  assert.equal(result.failedPath, "passkey-prf");
});

test("missing or invalid envelope material returns a structured failure", () => {
  const contract = loadContract();
  const missing = contract.selectUnlockPath({ device: validPath({ envelopePresent: false }), recovery: validPath() });
  assert.equal(missing.reason, "device-envelope-missing");
  assert.equal(missing.failedPath, "device");
  const invalid = contract.selectUnlockPath({ passkeyPrf: validPrf({ materialValid: false }), recovery: validPath() });
  assert.equal(invalid.reason, "passkey-prf-material-invalid");
  assert.equal(invalid.failedPath, "passkey-prf");
});

test("recovery derivations use stable distinct domain labels", () => {
  const labels = loadContract().RECOVERY_DERIVATION_LABELS;
  assert.equal(labels.accountAuthorisation, "pocket.sync.recovery.account-authorisation.v1");
  assert.equal(labels.masterKeyWrapping, "pocket.sync.recovery.master-key-wrapping.v1");
  assert.notEqual(labels.accountAuthorisation, labels.masterKeyWrapping);
});

test("locked recovery copy is exact", () => {
  assert.deepEqual(JSON.parse(JSON.stringify(loadContract().RECOVERY_COPY)), {
    title: "Save your recovery copy",
    body: "This lets you get back into your Pocket if your devices or sign-in are unavailable. Keep it somewhere safe.",
    primary: "Save recovery copy",
    secondary: "I’ll do this later",
  });
});

test("recovery readiness is mandatory rather than a warning", () => {
  const contract = loadContract();
  const ready = contract.validateRecoveryReadiness({
    rootBits: 256, recoveryEnvelopeExists: true, recoveryCopyStored: true, packageLocalOnly: true,
  });
  assert.equal(ready.ready, true);
  const later = contract.validateRecoveryReadiness({
    rootBits: 256, recoveryEnvelopeExists: true, recoveryCopyStored: false, packageLocalOnly: true,
  });
  assert.equal(later.ready, false);
  assert.deepEqual([...later.missing], ["recoveryCopyStored"]);
  assert.equal(contract.validateActivationReadiness(activation({ recoveryCopyStored: false })).ready, false);
});

test("activation is ready only after every locked condition succeeds", () => {
  const contract = loadContract();
  assert.equal(contract.validateActivationReadiness(activation()).ready, true);
  for (const requirement of contract.ACTIVATION_REQUIREMENTS) {
    const result = contract.validateActivationReadiness(activation({ [requirement]: false }));
    assert.equal(result.ready, false, requirement);
    assert.ok([...result.missing].includes(requirement), requirement);
  }
});

test("trusted-device metadata excludes raw keys, source ownership and readable recovery state", () => {
  const contract = loadContract();
  const input = {
    syncedPocketId: "pocket-opaque-1",
    deviceId: "device-opaque-1",
    deviceEnvelopeId: "envelope-opaque-1",
    confirmedRemoteRevision: 3,
    conflict: false,
    envelopeVersion: 1,
    migrationVersion: 1,
  };
  assert.equal(contract.buildTrustedDeviceMetadata(input).ok, true);
  for (const forbidden of ["rawMasterKey", "rawRecoveryRoot", "truthFileHandle", "vaultFileHandle", "browserRecoveryPayload", "plaintextPocket"]) {
    assert.equal(contract.buildTrustedDeviceMetadata(Object.assign({}, input, { [forbidden]: PLAINTEXT_SENTINEL })).ok, false, forbidden);
  }
  assert.ok(contract.DEVICE_STORE_BOUNDARY.forbidden.includes("source ownership token"));
  assert.match(contract.DEVICE_STORE_BOUNDARY.limitation, /cannot prove integrity/);
});

test("remote-safe metadata accepts only the explicit opaque allowlist", () => {
  const contract = loadContract();
  const input = {
    accountId: "account-opaque-1",
    syncedPocketId: "pocket-opaque-1",
    revision: 4,
    encryptedRecordSize: 4096,
    envelopeKinds: ["device", "recovery"],
  };
  const result = contract.buildRemoteSafeMetadata(input);
  assert.equal(result.ok, true);
  assert.equal(result.value.contractVersion, 1);
  for (const forbidden of [
    "nodeTitle",
    "nodeText",
    "notes",
    "outline",
    "rawJsonPayload",
    "historicalFilename",
    "sourceHandle",
    "filesystemPath",
    "vaultHandle",
    "masterKey",
    "prfOutput",
    "recoveryRoot",
    "recoveryWrapValue",
    "browserRecoveryPayload",
  ]) {
    assert.equal(contract.buildRemoteSafeMetadata(Object.assign({}, input, { [forbidden]: PLAINTEXT_SENTINEL })).ok, false, forbidden);
  }
});

test("content and envelope metadata builders are versioned and reject unknown fields", () => {
  const contract = loadContract();
  const content = contract.buildContentRecordMetadata({
    syncedPocketId: "pocket-opaque-1", revision: 2, encryptedRecordSize: 900,
  });
  assert.equal(content.ok, true);
  assert.equal(content.value.contractVersion, 1);
  const envelope = contract.buildKeyEnvelopeMetadata({
    syncedPocketId: "pocket-opaque-1",
    envelopeId: "envelope-opaque-1",
    kind: "device-transfer",
    version: 1,
    createdAt: "2030-01-01T00:00:00Z",
    kdf: "HKDF-SHA-256",
    kdfSalt: "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
    derivationVersion: 1,
  });
  assert.equal(envelope.ok, true);
  assert.equal(envelope.value.contractVersion, 1);
  assert.equal(contract.buildKeyEnvelopeMetadata(Object.assign({}, envelope.value, { kind: "password" })).ok, false);
  assert.equal(contract.buildContentRecordMetadata({
    syncedPocketId: "pocket-opaque-1", revision: 2, encryptedRecordSize: 900, plaintext: PLAINTEXT_SENTINEL,
  }).ok, false);
});

test("envelope metadata binds device and passkey envelopes to separate identifiers", () => {
  const contract = loadContract();
  const common = {
    syncedPocketId: "pocket-opaque-1",
    envelopeId: "envelope-opaque-1",
    version: 1,
    createdAt: "2030-01-01T00:00:00Z",
  };
  const salt = "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";
  assert.equal(contract.buildKeyEnvelopeMetadata({
    ...common, kind: "device", deviceId: "device-opaque-1", kdf: "none",
  }).ok, true);
  assert.equal(contract.buildKeyEnvelopeMetadata({
    ...common, kind: "device", credentialId: "credential-opaque-1", kdf: "none",
  }).ok, false);
  assert.equal(contract.buildKeyEnvelopeMetadata({
    ...common,
    kind: "passkey-prf",
    credentialId: "credential-opaque-1",
    kdf: "HKDF-SHA-256",
    kdfSalt: salt,
    derivationVersion: 1,
  }).ok, true);
  assert.equal(contract.buildKeyEnvelopeMetadata({
    ...common,
    kind: "passkey-prf",
    deviceId: "device-opaque-1",
    kdf: "HKDF-SHA-256",
    kdfSalt: salt,
    derivationVersion: 1,
  }).ok, false);
  for (const kind of ["device-transfer", "recovery"]) {
    assert.equal(contract.buildKeyEnvelopeMetadata({
      ...common,
      kind,
      deviceId: "device-opaque-1",
      kdf: "HKDF-SHA-256",
      kdfSalt: salt,
      derivationVersion: 1,
    }).ok, false);
    assert.equal(contract.buildKeyEnvelopeMetadata({
      ...common,
      kind,
      credentialId: "credential-opaque-1",
      kdf: "HKDF-SHA-256",
      kdfSalt: salt,
      derivationVersion: 1,
    }).ok, false);
  }
});

test("recovery package is local-only and cannot pass the remote metadata validator", () => {
  const contract = loadContract();
  const result = contract.buildRecoveryPackage({
    packageVersion: 1,
    accountLocator: "account-opaque-1",
    syncedPocketId: "pocket-opaque-1",
    rootMaterial: "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
    rootBits: 256,
    checksum: "checksum-display-value",
    instructions: ["Keep this copy offline.", "Use it only in Pocket recovery."],
  });
  assert.equal(result.ok, true);
  assert.equal(result.value.localOnly, true);
  assert.equal(result.value.remoteUploadAllowed, false);
  assert.equal(contract.buildRemoteSafeMetadata(result.value).ok, false);
});

test("conditional writes require expected revision, identifiers and an opaque encrypted record", () => {
  const result = loadContract().buildConditionalWriteRequest(writeRequest());
  assert.equal(result.ok, true);
  assert.equal(result.value.apiVersion, 1);
  assert.equal(result.value.expectedRevision, 7);
  assert.equal(result.value.operationId, "operation-opaque-1");
  assert.equal(result.value.logicalChangeId, "change-opaque-1");
  assert.equal(result.value.encryptedRecord.format, "pocket.sync.content.opaque");
});

test("readable sentinel content cannot enter remote request metadata or encrypted-record shape", () => {
  const contract = loadContract();
  assert.equal(contract.buildConditionalWriteRequest(writeRequest({ nodeTitle: PLAINTEXT_SENTINEL })).ok, false);
  assert.equal(contract.buildConditionalWriteRequest(writeRequest({
    encryptedRecord: Object.assign(opaqueRecord(), { readablePayload: PLAINTEXT_SENTINEL }),
  })).ok, false);
  const accepted = contract.buildConditionalWriteRequest(writeRequest());
  assert.doesNotMatch(JSON.stringify(accepted), new RegExp(PLAINTEXT_SENTINEL));
});

test("conditional conflict results can never be represented as overwrite success", () => {
  const contract = loadContract();
  const conflict = contract.buildConditionalWriteResult({
    status: "conflict", actualRevision: 9, operationId: "operation-opaque-1",
  });
  assert.equal(conflict.ok, true);
  assert.equal(conflict.value.wrote, false);
  assert.equal(conflict.value.conflict, true);
  assert.equal(conflict.value.actualRevision, 9);
  assert.equal(conflict.value.revision, undefined);
});

test("idempotent retry is distinguishable while retaining the same operation and logical change", () => {
  const contract = loadContract();
  const first = contract.buildConditionalWriteRequest(writeRequest()).value;
  const retry = contract.buildConditionalWriteRequest(writeRequest({ attemptKind: "idempotent-retry" })).value;
  assert.equal(first.operationId, retry.operationId);
  assert.equal(first.logicalChangeId, retry.logicalChangeId);
  assert.deepEqual(JSON.parse(JSON.stringify(first.encryptedRecord)), JSON.parse(JSON.stringify(retry.encryptedRecord)));
  assert.notEqual(first.attemptKind, retry.attemptKind);
  const replay = contract.buildConditionalWriteResult({
    status: "committed", revision: 8, operationId: retry.operationId, replayed: true,
  });
  assert.equal(replay.value.replayed, true);
});

test("successful recovery rotation invalidates old authorisation and requires a new copy", () => {
  const contract = loadContract();
  const result = contract.validateRecoveryRotation({
    recoverySucceeded: true,
    previousVersion: 2,
    nextVersion: 3,
    previousAuthorisationInvalidated: true,
    replacementCopyRequired: true,
  });
  assert.equal(result.ok, true);
  assert.equal(result.previousVersionValid, false);
  assert.equal(result.currentVersion, 3);
  assert.equal(result.replacementCopyRequired, true);
  assert.equal(contract.validateRecoveryRotation({
    recoverySucceeded: true,
    previousVersion: 2,
    nextVersion: 3,
    previousAuthorisationInvalidated: false,
    replacementCopyRequired: true,
  }).ok, false);
});

test("security contract has no DOM, storage, network, endpoint or provider dependency", () => {
  const contractSource = source(CONTRACT_SOURCE);
  for (const forbidden of [
    "document.", "localStorage", "indexedDB", "setTimeout", "setInterval", "serviceWorker",
    "BroadcastChannel", "fetch(", "XMLHttpRequest", "WebSocket", "navigator.credentials",
    "crypto.subtle", "generateKey(", "encrypt(", "https://", "http://", "/api/", "sdk",
    "amazon", "google cloud", "azure",
  ]) {
    assert.equal(contractSource.toLowerCase().includes(forbidden.toLowerCase()), false, forbidden);
  }
});

test("P027 copy and current Vault and recovery production owners are not replaced", () => {
  assert.match(source("js/pocket-sync-contract.js"), /PocketSyncContract/);
  assert.match(source("js/pocket-vault.js"), /PocketVault/);
  assert.match(source("js/pocket-vault-recovery.js"), /PocketVaultRecovery/);
  assert.doesNotMatch(source(CONTRACT_SOURCE), /PocketSyncContract\s*=/);
  assert.doesNotMatch(source(CONTRACT_SOURCE), /PocketVault\s*=/);
  assert.doesNotMatch(source(CONTRACT_SOURCE), /PocketVaultRecovery\s*=/);
});
