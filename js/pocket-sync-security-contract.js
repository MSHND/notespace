(function initialisePocketSyncSecurityContract(global) {
  "use strict";

  const SECURITY_CONTRACT_VERSION = 1;
  const REMOTE_API_CONTRACT_VERSION = 1;
  const MASTER_KEY_BITS = 256;
  const RECOVERY_ROOT_BITS = 256;
  const ENVELOPE_KINDS = Object.freeze([
    "device",
    "passkey-prf",
    "device-transfer",
    "recovery",
  ]);
  const UNLOCK_PRIORITY = Object.freeze([
    "device",
    "passkey-prf",
    "device-transfer",
    "recovery",
    "unavailable",
  ]);
  const RECOVERY_DERIVATION_LABELS = Object.freeze({
    accountAuthorisation: "pocket.sync.recovery.account-authorisation.v1",
    masterKeyWrapping: "pocket.sync.recovery.master-key-wrapping.v1",
  });
  const RECOVERY_COPY = Object.freeze({
    title: "Save your recovery copy",
    body: "This lets you get back into your Pocket if your devices or sign-in are unavailable. Keep it somewhere safe.",
    primary: "Save recovery copy",
    secondary: "I’ll do this later",
  });
  const ACCOUNT_MODEL = Object.freeze({
    ordinarySyncedPocketLimit: 1,
    schemaUsesSyncedPocketIds: true,
    schemaCanRepresentMultiplePocketIds: true,
  });
  const MASTER_KEY_POLICY = Object.freeze({
    generatedLocally: true,
    bits: MASTER_KEY_BITS,
    authenticatedEncryptionRequired: true,
    freshNoncePerEncryption: true,
    nonceReuseForbidden: true,
    multipleIndependentEnvelopes: true,
    envelopeRevocationReencryptsContent: false,
    rawBytesLifetime: "minimum practical",
    bestEffortClearTemporaryBytes: true,
    perfectJavaScriptZeroisationClaimed: false,
  });
  const PASSKEY_PRF_POLICY = Object.freeze({
    passkeyAuthenticatesAccount: true,
    passkeyIsContentKey: false,
    extensionIsOptional: true,
    actualCeremonyOutputRequired: true,
    outputUploaded: false,
    soleRecoveryMethod: false,
    domainSeparatedDerivationRequired: true,
  });
  const DEVICE_STORE_BOUNDARY = Object.freeze({
    allowed: Object.freeze([
      "non-extractable Web Crypto device key",
      "device key material wrapped by random local protection",
      "wrapped master-key envelope",
      "synced Pocket ID",
      "latest encrypted content record",
      "confirmed remote revision",
      "pending encrypted sync record",
      "conflict marker",
      "envelope and migration versions",
    ]),
    forbidden: Object.freeze([
      "raw master key",
      "raw recovery root",
      "plaintext Pocket content",
      "Vault password",
      "passkey private key",
      "unlimited-lifetime remote bearer token",
      "truth-file handle",
      "Vault file handle",
      "source ownership token",
      "browser-safety recovery payload",
    ]),
    limitation: "A web client can reduce exposure but cannot prove integrity against a fully compromised browser or device.",
  });

  const ACTIVATION_REQUIREMENTS = Object.freeze([
    "sourceSaved",
    "sourceSessionCurrent",
    "masterKeyCreatedLocally",
    "deviceRecordDurable",
    "initialRemoteCommitSucceeded",
    "accountCredentialRegistered",
    "recoveryEnvelopeExists",
    "recoveryCopyStored",
    "syncedOwnerAdopted",
  ]);
  const REMOTE_METADATA_FIELDS = Object.freeze([
    "contractVersion",
    "accountId",
    "syncedPocketId",
    "deviceId",
    "revision",
    "encryptedRecordSize",
    "envelopeKinds",
    "recoveryVerifierVersion",
    "operationId",
    "updatedAt",
  ]);
  const TRUSTED_DEVICE_FIELDS = Object.freeze([
    "contractVersion",
    "syncedPocketId",
    "deviceId",
    "deviceEnvelopeId",
    "confirmedRemoteRevision",
    "pendingEncryptedRecordId",
    "conflict",
    "envelopeVersion",
    "migrationVersion",
    "updatedAt",
  ]);
  const CONTENT_RECORD_FIELDS = Object.freeze([
    "contractVersion",
    "syncedPocketId",
    "revision",
    "encryptedRecordSize",
    "createdAt",
  ]);
  const ENVELOPE_METADATA_FIELDS = Object.freeze([
    "contractVersion",
    "syncedPocketId",
    "envelopeId",
    "kind",
    "version",
    "deviceId",
    "createdAt",
    "revokedAt",
  ]);

  function frozen(value) {
    if (Array.isArray(value)) {
      return Object.freeze(value.map(frozen));
    }
    if (value && typeof value === "object") {
      const copy = {};
      Object.keys(value).forEach((key) => {
        copy[key] = frozen(value[key]);
      });
      return Object.freeze(copy);
    }
    return value;
  }

  function pass(value) {
    return frozen({ ok: true, value });
  }

  function fail(reason, details) {
    return frozen(Object.assign({ ok: false, reason }, details || {}));
  }

  function isObject(value) {
    return !!value && typeof value === "object" && !Array.isArray(value);
  }

  function hasOnlyFields(value, allowed) {
    return isObject(value) && Object.keys(value).every((key) => allowed.includes(key));
  }

  function nonEmptyString(value) {
    return typeof value === "string" && value.trim().length > 0;
  }

  function revision(value) {
    return Number.isSafeInteger(value) && value >= 0;
  }

  function positiveVersion(value) {
    return Number.isSafeInteger(value) && value >= 1;
  }

  function base64url(value, minimumLength) {
    return typeof value === "string"
      && value.length >= minimumLength
      && /^[A-Za-z0-9_-]+$/.test(value);
  }

  function normaliseMetadata(input, fields) {
    const value = {};
    fields.forEach((field) => {
      if (input[field] !== undefined && input[field] !== null) value[field] = input[field];
    });
    return value;
  }

  function validatePrfCeremonyResult(input) {
    const result = isObject(input) ? input : {};
    if (result.passkeyAuthenticated !== true) {
      return fail("passkey-authentication-unavailable", { available: false });
    }
    if (result.extensionSupported !== true) {
      return fail("prf-extension-unavailable", { available: false });
    }
    if (result.outputPresent !== true) {
      return fail("prf-output-unavailable", { available: false });
    }
    if (result.outputValid !== true
        || !Number.isSafeInteger(result.outputBits)
        || result.outputBits < 256) {
      return fail("prf-output-invalid", { available: true, failedPath: "passkey-prf" });
    }
    return pass(Object.freeze({ available: true, outputBits: result.outputBits }));
  }

  function inspectCandidate(path, input) {
    const candidate = isObject(input) ? input : {};
    if (candidate.available !== true) return null;
    if (candidate.envelopePresent !== true) {
      return fail(`${path}-envelope-missing`, { failedPath: path });
    }
    if (candidate.materialValid !== true) {
      return fail(`${path}-material-invalid`, { failedPath: path });
    }
    return frozen({ ok: true, path });
  }

  function selectUnlockPath(input) {
    const options = isObject(input) ? input : {};
    const device = inspectCandidate("device", options.device);
    if (device) return device;

    const prfResult = validatePrfCeremonyResult(options.passkeyPrf);
    if (prfResult.ok) {
      const prf = inspectCandidate("passkey-prf", {
        available: true,
        envelopePresent: options.passkeyPrf && options.passkeyPrf.envelopePresent,
        materialValid: options.passkeyPrf && options.passkeyPrf.materialValid,
      });
      if (prf) return prf;
    } else if (prfResult.available === true) {
      return prfResult;
    }

    const transfer = inspectCandidate("device-transfer", options.deviceTransfer);
    if (transfer) return transfer;
    const recovery = inspectCandidate("recovery", options.recovery);
    if (recovery) return recovery;
    return frozen({ ok: false, path: "unavailable", reason: "no-unlock-path" });
  }

  function validateRecoveryReadiness(input) {
    const value = isObject(input) ? input : {};
    const missing = [];
    if (!Number.isSafeInteger(value.rootBits) || value.rootBits < RECOVERY_ROOT_BITS) missing.push("recoveryRoot");
    if (value.recoveryEnvelopeExists !== true) missing.push("recoveryEnvelopeExists");
    if (value.recoveryCopyStored !== true) missing.push("recoveryCopyStored");
    if (value.packageLocalOnly !== true) missing.push("packageLocalOnly");
    return missing.length
      ? fail("recovery-incomplete", { ready: false, missing })
      : frozen({ ok: true, ready: true });
  }

  function validateActivationReadiness(input) {
    const value = isObject(input) ? input : {};
    const missing = ACTIVATION_REQUIREMENTS.filter((requirement) => value[requirement] !== true);
    return missing.length
      ? fail("activation-incomplete", { ready: false, missing })
      : frozen({ ok: true, ready: true });
  }

  function buildTrustedDeviceMetadata(input) {
    if (!hasOnlyFields(input, TRUSTED_DEVICE_FIELDS)) return fail("invalid-trusted-device-metadata");
    if ((input.contractVersion !== undefined && input.contractVersion !== SECURITY_CONTRACT_VERSION)
        || !nonEmptyString(input.syncedPocketId)
        || !nonEmptyString(input.deviceId)
        || !nonEmptyString(input.deviceEnvelopeId)
        || !revision(input.confirmedRemoteRevision)
        || typeof input.conflict !== "boolean"
        || !positiveVersion(input.envelopeVersion)
        || !positiveVersion(input.migrationVersion)) {
      return fail("invalid-trusted-device-metadata");
    }
    return pass(frozen(Object.assign(normaliseMetadata(input, TRUSTED_DEVICE_FIELDS),
      { contractVersion: SECURITY_CONTRACT_VERSION })));
  }

  function buildRemoteSafeMetadata(input) {
    if (!hasOnlyFields(input, REMOTE_METADATA_FIELDS)) return fail("remote-metadata-not-safe");
    if ((input.contractVersion !== undefined && input.contractVersion !== SECURITY_CONTRACT_VERSION)
        || !nonEmptyString(input.accountId)
        || !nonEmptyString(input.syncedPocketId)
        || !revision(input.revision)
        || !Number.isSafeInteger(input.encryptedRecordSize)
        || input.encryptedRecordSize < 0) {
      return fail("invalid-remote-metadata");
    }
    if (input.envelopeKinds !== undefined
        && (!Array.isArray(input.envelopeKinds)
          || input.envelopeKinds.some((kind) => !ENVELOPE_KINDS.includes(kind)))) {
      return fail("invalid-envelope-kind");
    }
    return pass(frozen(Object.assign(normaliseMetadata(input, REMOTE_METADATA_FIELDS),
      { contractVersion: SECURITY_CONTRACT_VERSION })));
  }

  function buildContentRecordMetadata(input) {
    if (!hasOnlyFields(input, CONTENT_RECORD_FIELDS)
        || (input.contractVersion !== undefined && input.contractVersion !== SECURITY_CONTRACT_VERSION)
        || !nonEmptyString(input.syncedPocketId)
        || !revision(input.revision)
        || !Number.isSafeInteger(input.encryptedRecordSize)
        || input.encryptedRecordSize < 0) {
      return fail("invalid-content-record-metadata");
    }
    return pass(frozen(Object.assign(normaliseMetadata(input, CONTENT_RECORD_FIELDS),
      { contractVersion: SECURITY_CONTRACT_VERSION })));
  }

  function buildKeyEnvelopeMetadata(input) {
    if (!hasOnlyFields(input, ENVELOPE_METADATA_FIELDS)
        || (input.contractVersion !== undefined && input.contractVersion !== SECURITY_CONTRACT_VERSION)
        || !nonEmptyString(input.syncedPocketId)
        || !nonEmptyString(input.envelopeId)
        || !ENVELOPE_KINDS.includes(input.kind)
        || !positiveVersion(input.version)
        || !nonEmptyString(input.createdAt)) {
      return fail("invalid-key-envelope-metadata");
    }
    return pass(frozen(Object.assign(normaliseMetadata(input, ENVELOPE_METADATA_FIELDS),
      { contractVersion: SECURITY_CONTRACT_VERSION })));
  }

  function buildRecoveryPackage(input) {
    const fields = [
      "packageVersion",
      "accountLocator",
      "syncedPocketId",
      "rootMaterial",
      "rootBits",
      "checksum",
      "instructions",
    ];
    if (!hasOnlyFields(input, fields)
        || !positiveVersion(input.packageVersion)
        || !nonEmptyString(input.accountLocator)
        || !nonEmptyString(input.syncedPocketId)
        || !Number.isSafeInteger(input.rootBits)
        || input.rootBits < RECOVERY_ROOT_BITS
        || !base64url(input.rootMaterial, 43)
        || !nonEmptyString(input.checksum)
        || !Array.isArray(input.instructions)
        || input.instructions.length === 0
        || input.instructions.some((instruction) => !nonEmptyString(instruction))) {
      return fail("invalid-recovery-package");
    }
    return pass(frozen(Object.assign({
      kind: "pocket-recovery-package",
      localOnly: true,
      remoteUploadAllowed: false,
    }, input)));
  }

  function validateOpaqueEncryptedRecord(record) {
    const fields = ["format", "version", "algorithm", "nonce", "ciphertext"];
    if (!hasOnlyFields(record, fields)
        || record.format !== "pocket.sync.content.opaque"
        || !positiveVersion(record.version)
        || record.algorithm !== "authenticated-encryption"
        || !base64url(record.nonce, 16)
        || !base64url(record.ciphertext, 24)) {
      return fail("encrypted-record-not-opaque");
    }
    return pass(frozen(record));
  }

  function buildConditionalWriteRequest(input) {
    const fields = [
      "apiVersion",
      "syncedPocketId",
      "expectedRevision",
      "operationId",
      "logicalChangeId",
      "attemptKind",
      "encryptedRecord",
    ];
    if (!hasOnlyFields(input, fields)
        || (input.apiVersion !== undefined && input.apiVersion !== REMOTE_API_CONTRACT_VERSION)
        || !nonEmptyString(input.syncedPocketId)
        || !revision(input.expectedRevision)
        || !nonEmptyString(input.operationId)
        || !nonEmptyString(input.logicalChangeId)
        || !["new-change", "idempotent-retry"].includes(input.attemptKind)) {
      return fail("invalid-conditional-write-request");
    }
    const encryptedRecord = validateOpaqueEncryptedRecord(input.encryptedRecord);
    if (!encryptedRecord.ok) return encryptedRecord;
    return pass(frozen({
      apiVersion: REMOTE_API_CONTRACT_VERSION,
      syncedPocketId: input.syncedPocketId,
      expectedRevision: input.expectedRevision,
      operationId: input.operationId,
      logicalChangeId: input.logicalChangeId,
      attemptKind: input.attemptKind,
      encryptedRecord: encryptedRecord.value,
    }));
  }

  function buildConditionalWriteResult(input) {
    const fields = ["apiVersion", "status", "revision", "actualRevision", "operationId", "replayed"];
    if (!hasOnlyFields(input, fields)
        || (input.apiVersion !== undefined && input.apiVersion !== REMOTE_API_CONTRACT_VERSION)
        || !nonEmptyString(input.operationId)) {
      return fail("invalid-conditional-write-result");
    }
    if (input.status === "committed" && revision(input.revision)) {
      return pass(frozen({
        apiVersion: REMOTE_API_CONTRACT_VERSION,
        status: "committed",
        wrote: true,
        revision: input.revision,
        operationId: input.operationId,
        replayed: input.replayed === true,
      }));
    }
    if (input.status === "conflict" && revision(input.actualRevision)) {
      return pass(frozen({
        apiVersion: REMOTE_API_CONTRACT_VERSION,
        status: "conflict",
        wrote: false,
        conflict: true,
        actualRevision: input.actualRevision,
        operationId: input.operationId,
      }));
    }
    return fail("invalid-conditional-write-result");
  }

  function validateRecoveryRotation(input) {
    if (!isObject(input)
        || input.recoverySucceeded !== true
        || !positiveVersion(input.previousVersion)
        || input.nextVersion !== input.previousVersion + 1
        || input.previousAuthorisationInvalidated !== true
        || input.replacementCopyRequired !== true) {
      return fail("recovery-rotation-incomplete", { ready: false });
    }
    return frozen({
      ok: true,
      ready: true,
      currentVersion: input.nextVersion,
      previousVersionValid: false,
      replacementCopyRequired: true,
    });
  }

  global.PocketSyncSecurityContract = Object.freeze({
    SECURITY_CONTRACT_VERSION,
    REMOTE_API_CONTRACT_VERSION,
    MASTER_KEY_BITS,
    RECOVERY_ROOT_BITS,
    ENVELOPE_KINDS,
    UNLOCK_PRIORITY,
    RECOVERY_DERIVATION_LABELS,
    RECOVERY_COPY,
    ACCOUNT_MODEL,
    MASTER_KEY_POLICY,
    PASSKEY_PRF_POLICY,
    DEVICE_STORE_BOUNDARY,
    ACTIVATION_REQUIREMENTS,
    validatePrfCeremonyResult,
    selectUnlockPath,
    validateRecoveryReadiness,
    validateActivationReadiness,
    buildTrustedDeviceMetadata,
    buildRemoteSafeMetadata,
    buildContentRecordMetadata,
    buildKeyEnvelopeMetadata,
    buildRecoveryPackage,
    validateOpaqueEncryptedRecord,
    buildConditionalWriteRequest,
    buildConditionalWriteResult,
    validateRecoveryRotation,
  });
})(typeof window !== "undefined" ? window : globalThis);
