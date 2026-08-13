/* Synced Pocket encrypted device-store foundation.

This module is intentionally unloaded. It defines one strict encrypted record
and a narrow atomic transaction boundary without activating a synced owner.
*/

(function initialisePocketSyncDeviceStore(global) {
  "use strict";

  const CONFIG = Object.freeze({
    databaseName: "pocket.sync.device.v1",
    databaseVersion: 1,
    objectStoreName: "pockets",
    keyPath: "syncedPocketId",
    indexes: Object.freeze([]),
  });
  const FORMAT = Object.freeze({
    recordKind: "pocket.sync.device-state",
    recordSchemaVersion: 5,
    recoveryStagingKind: "pocket.sync.recovery-staging",
    recoveryStagingSchemaVersion: 2,
    firstStoreRevision: 1,
  });
  const MIGRATION_POLICY = Object.freeze({
    currentDatabaseVersion: CONFIG.databaseVersion,
    currentRecordSchemaVersion: FORMAT.recordSchemaVersion,
    registeredRecordMigrations: Object.freeze([
      "1-to-2-encrypted-activation-draft",
      "2-to-3-encrypted-recovery-draft",
      "3-to-4-per-long-lived-key-usage",
      "4-to-5-master-key-device-allowance",
    ]),
    destructiveResetAllowed: false,
  });
  const TOP_LEVEL_FIELDS = Object.freeze([
    "kind",
    "schemaVersion",
    "storeRevision",
    "syncedPocketId",
    "deviceId",
    "deviceWrappingKey",
    "deviceEnvelope",
    "content",
    "remote",
    "usage",
    "activationDraft",
    "recoveryDraft",
    "additionalDeviceDraft",
  ]);
  const VERSION_ONE_TOP_LEVEL_FIELDS = Object.freeze(TOP_LEVEL_FIELDS.filter(
    (field) => !["activationDraft", "recoveryDraft", "additionalDeviceDraft"].includes(field)
  ));
  const VERSION_TWO_TOP_LEVEL_FIELDS = Object.freeze(TOP_LEVEL_FIELDS.filter(
    (field) => !["recoveryDraft", "additionalDeviceDraft"].includes(field)
  ));
  const VERSION_THREE_TOP_LEVEL_FIELDS = Object.freeze(TOP_LEVEL_FIELDS.filter(
    (field) => field !== "additionalDeviceDraft"
  ));
  const DEVICE_ENVELOPE_FIELDS = Object.freeze(["context", "metadata", "record"]);
  const DEVICE_METADATA_FIELDS = Object.freeze([
    "contractVersion",
    "syncedPocketId",
    "envelopeId",
    "kind",
    "version",
    "deviceId",
    "createdAt",
    "kdf",
  ]);
  const CONTENT_FIELDS = Object.freeze(["context", "record"]);
  const RECOVERY_STAGING_FIELDS = Object.freeze([
    "kind", "schemaVersion", "storeRevision", "syncedPocketId", "deviceId",
    "deviceWrappingKey", "recoveryDraft", "usage",
  ]);
  const RECOVERY_STAGING_V1_FIELDS = Object.freeze(RECOVERY_STAGING_FIELDS.filter((field) => field !== "usage"));
  const REMOTE_FIELDS = Object.freeze(["confirmedRevision", "pending", "conflict"]);
  const PENDING_FIELDS = Object.freeze([
    "expectedRevision",
    "operationId",
    "logicalChangeId",
    "attemptKind",
  ]);
  const CONFLICT_FIELDS = Object.freeze(["actualRevision", "operationId"]);
  const USAGE_FIELDS = Object.freeze([
    "masterKeyGeneration",
    "masterKeyContentEncryptions",
    "masterKeyContentEncryptionLimit",
    "deviceWrappingKeyEncryptions",
  ]);
  const USAGE_INCREMENT_FIELDS = Object.freeze([
    "masterKeyContentEncryptions", "deviceWrappingKeyEncryptions",
  ]);
  const VERSION_THREE_USAGE_FIELDS = Object.freeze([
    "masterKeyGeneration", "contentEncryptionsOnDevice", "envelopeEncryptionsOnDevice",
  ]);

  function deviceStoreError(code) {
    const error = new Error(`Pocket Sync device store ${code}.`);
    error.code = code;
    return error;
  }

  function normaliseError(error, fallbackCode) {
    return error && typeof error.code === "string"
      ? error
      : deviceStoreError(fallbackCode);
  }

  function exactObject(value, fields, code) {
    if (!value
        || typeof value !== "object"
        || Array.isArray(value)
        || Object.keys(value).length !== fields.length
        || !fields.every((field) => Object.prototype.hasOwnProperty.call(value, field))) {
      throw deviceStoreError(code);
    }
    return value;
  }

  function identifier(value, code) {
    if (typeof value !== "string"
        || value.length < 1
        || value.length > 160
        || value !== value.trim()) {
      throw deviceStoreError(code);
    }
    return value;
  }

  function positiveInteger(value, code) {
    if (!Number.isSafeInteger(value) || value < 1) throw deviceStoreError(code);
    return value;
  }

  function nonNegativeInteger(value, code) {
    if (!Number.isSafeInteger(value) || value < 0) throw deviceStoreError(code);
    return value;
  }

  function validTimestamp(value) {
    return typeof value === "string"
      && value.length > 0
      && value.length <= 80
      && value === value.trim()
      && Number.isFinite(Date.parse(value));
  }

  function cryptoContract() {
    const contract = global.PocketSyncCrypto;
    if (!contract
        || typeof contract.validateNonExtractableAesKey !== "function"
        || typeof contract.validateMasterKeyEnvelope !== "function"
        || typeof contract.validateContentRecord !== "function"
        || typeof contract.validateEnvelopeContext !== "function"
        || typeof contract.validateContentContext !== "function") {
      throw deviceStoreError("crypto-contract-unavailable");
    }
    return contract;
  }

  function securityContract() {
    const contract = global.PocketSyncSecurityContract;
    if (!contract
        || typeof contract.buildKeyEnvelopeMetadata !== "function"
        || typeof contract.buildConditionalWriteRequest !== "function") {
      throw deviceStoreError("security-contract-unavailable");
    }
    return contract;
  }

  function isCryptoKey(value) {
    if (!value || typeof value !== "object") return false;
    if (typeof global.CryptoKey === "function") return value instanceof global.CryptoKey;
    return Object.prototype.toString.call(value) === "[object CryptoKey]";
  }

  function validateDeviceWrappingKey(value) {
    if (!isCryptoKey(value)) throw deviceStoreError("device-wrapping-key-invalid");
    try {
      return cryptoContract().validateNonExtractableAesKey(value);
    } catch (_error) {
      throw deviceStoreError("device-wrapping-key-invalid");
    }
  }

  function freezeValue(value, cryptoKey) {
    if (value === cryptoKey) return value;
    if (Array.isArray(value)) return Object.freeze(value.map((item) => freezeValue(item, cryptoKey)));
    if (value && typeof value === "object") {
      const copy = {};
      Object.keys(value).forEach((key) => {
        copy[key] = freezeValue(value[key], cryptoKey);
      });
      return Object.freeze(copy);
    }
    return value;
  }

  function validateDeviceEnvelope(input, syncedPocketId, deviceId) {
    const value = exactObject(input, DEVICE_ENVELOPE_FIELDS, "device-envelope-invalid");
    let context;
    let record;
    try {
      context = cryptoContract().validateEnvelopeContext(value.context);
      record = cryptoContract().validateMasterKeyEnvelope(value.record);
    } catch (_error) {
      throw deviceStoreError("device-envelope-invalid");
    }
    if (context.envelopeKind !== "device"
        || context.syncedPocketId !== syncedPocketId) {
      throw deviceStoreError("device-envelope-identity-invalid");
    }

    const metadataInput = exactObject(
      value.metadata,
      DEVICE_METADATA_FIELDS,
      "device-envelope-metadata-invalid"
    );
    if (!validTimestamp(metadataInput.createdAt)) {
      throw deviceStoreError("device-envelope-metadata-invalid");
    }
    const metadataResult = securityContract().buildKeyEnvelopeMetadata(metadataInput);
    if (!metadataResult.ok) throw deviceStoreError("device-envelope-metadata-invalid");
    const metadata = metadataResult.value;
    if (metadata.contractVersion !== 1
        || metadata.syncedPocketId !== syncedPocketId
        || metadata.syncedPocketId !== context.syncedPocketId
        || metadata.envelopeId !== context.envelopeId
        || metadata.kind !== "device"
        || metadata.kind !== context.envelopeKind
        || metadata.version !== context.envelopeVersion
        || metadata.deviceId !== deviceId
        || metadata.kdf !== "none") {
      throw deviceStoreError("device-envelope-identity-invalid");
    }
    return Object.freeze({ context, metadata, record });
  }

  function validateContent(input, syncedPocketId) {
    const value = exactObject(input, CONTENT_FIELDS, "device-content-invalid");
    let context;
    let record;
    try {
      context = cryptoContract().validateContentContext(value.context);
      record = cryptoContract().validateContentRecord(value.record);
    } catch (_error) {
      throw deviceStoreError("device-content-invalid");
    }
    if (context.syncedPocketId !== syncedPocketId) {
      throw deviceStoreError("device-content-identity-invalid");
    }
    return Object.freeze({ context, record });
  }

  function validateActivationDraft(input, syncedPocketId, storeRevision) {
    if (input === null) return null;
    const value = exactObject(input, CONTENT_FIELDS, "activation-draft-invalid");
    const encrypted = validateContent(value, syncedPocketId);
    if (encrypted.context.revision !== storeRevision) {
      throw deviceStoreError("activation-draft-revision-invalid");
    }
    return encrypted;
  }

  function validatePending(input, syncedPocketId, contentRecord, confirmedRevision) {
    if (input === null) return null;
    const pending = exactObject(input, PENDING_FIELDS, "device-pending-invalid");
    const value = Object.freeze({
      expectedRevision: nonNegativeInteger(pending.expectedRevision, "device-pending-invalid"),
      operationId: identifier(pending.operationId, "device-pending-invalid"),
      logicalChangeId: identifier(pending.logicalChangeId, "device-pending-invalid"),
      attemptKind: pending.attemptKind,
    });
    if (value.expectedRevision !== confirmedRevision
        || !["new-change", "idempotent-retry"].includes(value.attemptKind)) {
      throw deviceStoreError("device-pending-invalid");
    }
    const request = securityContract().buildConditionalWriteRequest({
      syncedPocketId,
      expectedRevision: value.expectedRevision,
      operationId: value.operationId,
      logicalChangeId: value.logicalChangeId,
      attemptKind: value.attemptKind,
      encryptedRecord: contentRecord,
    });
    if (!request.ok) throw deviceStoreError("device-pending-invalid");
    return value;
  }

  function validateConflict(input, pending, confirmedRevision) {
    if (input === null) return null;
    if (!pending) throw deviceStoreError("device-conflict-invalid");
    const conflict = exactObject(input, CONFLICT_FIELDS, "device-conflict-invalid");
    const value = Object.freeze({
      actualRevision: nonNegativeInteger(conflict.actualRevision, "device-conflict-invalid"),
      operationId: identifier(conflict.operationId, "device-conflict-invalid"),
    });
    if (value.operationId !== pending.operationId
        || value.actualRevision <= confirmedRevision) {
      throw deviceStoreError("device-conflict-invalid");
    }
    return value;
  }

  function validateRemote(input, syncedPocketId, content) {
    const remote = exactObject(input, REMOTE_FIELDS, "device-remote-invalid");
    const confirmedRevision = nonNegativeInteger(
      remote.confirmedRevision,
      "device-remote-invalid"
    );
    const pending = validatePending(
      remote.pending,
      syncedPocketId,
      content.record,
      confirmedRevision
    );
    const conflict = validateConflict(remote.conflict, pending, confirmedRevision);
    if (pending) {
      if (confirmedRevision >= Number.MAX_SAFE_INTEGER
          || content.context.revision !== confirmedRevision + 1) {
        throw deviceStoreError("device-pending-revision-invalid");
      }
    } else if (content.context.revision !== confirmedRevision || conflict !== null) {
      throw deviceStoreError("device-confirmed-revision-invalid");
    }
    return Object.freeze({ confirmedRevision, pending, conflict });
  }

  function validateUsage(input) {
    const usage = exactObject(input, USAGE_FIELDS, "device-usage-invalid");
    const value = Object.freeze({
      masterKeyGeneration: positiveInteger(
        usage.masterKeyGeneration,
        "device-usage-invalid"
      ),
      masterKeyContentEncryptions: nonNegativeInteger(
        usage.masterKeyContentEncryptions,
        "device-usage-invalid"
      ),
      masterKeyContentEncryptionLimit: nonNegativeInteger(
        usage.masterKeyContentEncryptionLimit,
        "device-usage-invalid"
      ),
      deviceWrappingKeyEncryptions: nonNegativeInteger(
        usage.deviceWrappingKeyEncryptions,
        "device-usage-invalid"
      ),
    });
    const ceiling = cryptoContract().POLICY?.maximumEncryptionsPerKey;
    if (!Number.isSafeInteger(ceiling)
        || ceiling < 1
        || value.masterKeyContentEncryptions > value.masterKeyContentEncryptionLimit
        || value.masterKeyContentEncryptionLimit > ceiling
        || value.deviceWrappingKeyEncryptions >= ceiling) {
      throw deviceStoreError("device-usage-limit-reached");
    }
    return value;
  }

  function usageReservationConflict() {
    throw deviceStoreError("device-usage-reservation-conflict");
  }

  function usageReservationIncrements(input) {
    const increments = exactObject(input, USAGE_INCREMENT_FIELDS, "device-usage-invalid");
    const value = Object.freeze({
      masterKeyContentEncryptions: nonNegativeInteger(
        increments.masterKeyContentEncryptions, "device-usage-invalid"
      ),
      deviceWrappingKeyEncryptions: nonNegativeInteger(
        increments.deviceWrappingKeyEncryptions, "device-usage-invalid"
      ),
    });
    if (value.masterKeyContentEncryptions === 0 && value.deviceWrappingKeyEncryptions === 0) {
      throw deviceStoreError("device-usage-invalid");
    }
    return value;
  }

  function reserveUsage(current, expectedUsageInput, incrementsInput) {
    const expectedUsage = validateUsage(expectedUsageInput);
    const increments = usageReservationIncrements(incrementsInput);
    if (current.usage.masterKeyGeneration !== expectedUsage.masterKeyGeneration
        || current.usage.masterKeyContentEncryptions !== expectedUsage.masterKeyContentEncryptions
        || current.usage.deviceWrappingKeyEncryptions
          !== expectedUsage.deviceWrappingKeyEncryptions) {
      usageReservationConflict();
    }
    const nextUsage = validateUsage({
      masterKeyGeneration: current.usage.masterKeyGeneration,
      masterKeyContentEncryptions: current.usage.masterKeyContentEncryptions
        + increments.masterKeyContentEncryptions,
      masterKeyContentEncryptionLimit: current.usage.masterKeyContentEncryptionLimit,
      deviceWrappingKeyEncryptions: current.usage.deviceWrappingKeyEncryptions
        + increments.deviceWrappingKeyEncryptions,
    });
    return validateRecord(Object.assign({}, current, { usage: nextUsage }));
  }

  function validateCurrentRecord(input) {
    const record = exactObject(input, TOP_LEVEL_FIELDS, "device-state-invalid");
    if (record.kind !== FORMAT.recordKind) throw deviceStoreError("device-state-kind-invalid");
    if (record.schemaVersion !== FORMAT.recordSchemaVersion) {
      throw deviceStoreError("device-state-schema-unsupported");
    }
    const storeRevision = positiveInteger(record.storeRevision, "device-store-revision-invalid");
    const syncedPocketId = identifier(record.syncedPocketId, "device-state-identity-invalid");
    const deviceId = identifier(record.deviceId, "device-state-identity-invalid");
    const deviceWrappingKey = validateDeviceWrappingKey(record.deviceWrappingKey);
    const deviceEnvelope = validateDeviceEnvelope(record.deviceEnvelope, syncedPocketId, deviceId);
    const content = validateContent(record.content, syncedPocketId);
    const remote = validateRemote(record.remote, syncedPocketId, content);
    const usage = validateUsage(record.usage);
    const activationDraft = validateActivationDraft(
      record.activationDraft,
      syncedPocketId,
      storeRevision
    );
    const recoveryDraft = validateActivationDraft(
      record.recoveryDraft,
      syncedPocketId,
      storeRevision
    );
    const additionalDeviceDraft = validateActivationDraft(
      record.additionalDeviceDraft,
      syncedPocketId,
      storeRevision
    );
    return freezeValue({
      kind: FORMAT.recordKind,
      schemaVersion: FORMAT.recordSchemaVersion,
      storeRevision,
      syncedPocketId,
      deviceId,
      deviceWrappingKey,
      deviceEnvelope,
      content,
      remote,
      usage,
      activationDraft,
      recoveryDraft,
      additionalDeviceDraft,
    }, deviceWrappingKey);
  }

  function migrateLegacyUsage(input) {
    const usage = exactObject(input, VERSION_THREE_USAGE_FIELDS, "device-usage-invalid");
    // The old envelope aggregate combined key purposes.  It cannot be split
    // retrospectively, so retain its full value against the device key.
    return {
      masterKeyGeneration: usage.masterKeyGeneration,
      masterKeyContentEncryptions: usage.contentEncryptionsOnDevice,
      masterKeyContentEncryptionLimit: usage.contentEncryptionsOnDevice,
      deviceWrappingKeyEncryptions: (() => {
        const total = usage.contentEncryptionsOnDevice + usage.envelopeEncryptionsOnDevice;
        if (!Number.isSafeInteger(total)) throw deviceStoreError("device-usage-limit-reached");
        return total;
      })(),
    };
  }

  function migrateVersionOneRecord(input) {
    const legacy = exactObject(input, VERSION_ONE_TOP_LEVEL_FIELDS, "device-state-invalid");
    return validateCurrentRecord(Object.assign({}, legacy, {
      schemaVersion: FORMAT.recordSchemaVersion,
      usage: migrateLegacyUsage(legacy.usage),
      activationDraft: null,
      recoveryDraft: null,
      additionalDeviceDraft: null,
    }));
  }

  function migrateVersionTwoRecord(input) {
    const previous = exactObject(input, VERSION_TWO_TOP_LEVEL_FIELDS, "device-state-invalid");
    return validateCurrentRecord(Object.assign({}, previous, {
      schemaVersion: FORMAT.recordSchemaVersion,
      usage: migrateLegacyUsage(previous.usage),
      recoveryDraft: null,
      additionalDeviceDraft: null,
    }));
  }

  function migrateVersionThreeRecord(input) {
    const previous = exactObject(input, VERSION_THREE_TOP_LEVEL_FIELDS, "device-state-invalid");
    return validateCurrentRecord(Object.assign({}, previous, {
      schemaVersion: FORMAT.recordSchemaVersion,
      usage: migrateLegacyUsage(previous.usage),
      additionalDeviceDraft: null,
    }));
  }

  function migrateVersionFourRecord(input) {
    const previous = exactObject(input, VERSION_THREE_TOP_LEVEL_FIELDS, "device-state-invalid");
    return validateCurrentRecord(Object.assign({}, previous, {
      schemaVersion: FORMAT.recordSchemaVersion,
      usage: Object.assign({}, previous.usage, {
        masterKeyContentEncryptionLimit: previous.usage.masterKeyContentEncryptions,
      }),
      additionalDeviceDraft: null,
    }));
  }

  function validateRecord(input) {
    if (!input || typeof input !== "object" || Array.isArray(input)) {
      throw deviceStoreError("device-state-invalid");
    }
    if (input.schemaVersion === 1) return migrateVersionOneRecord(input);
    if (input.schemaVersion === 2) return migrateVersionTwoRecord(input);
    if (input.schemaVersion === 3) return migrateVersionThreeRecord(input);
    if (input.schemaVersion === 4) return migrateVersionFourRecord(input);
    return validateCurrentRecord(input);
  }

  function validateRecoveryStagingRecord(input) {
    const record = exactObject(input, RECOVERY_STAGING_FIELDS, "recovery-staging-invalid");
    if (record.kind !== FORMAT.recoveryStagingKind
        || record.schemaVersion !== FORMAT.recoveryStagingSchemaVersion) {
      throw deviceStoreError("recovery-staging-schema-invalid");
    }
    const storeRevision = positiveInteger(record.storeRevision, "device-store-revision-invalid");
    const syncedPocketId = identifier(record.syncedPocketId, "device-state-identity-invalid");
    const deviceId = identifier(record.deviceId, "device-state-identity-invalid");
    const deviceWrappingKey = validateDeviceWrappingKey(record.deviceWrappingKey);
    const recoveryDraft = validateActivationDraft(
      record.recoveryDraft,
      syncedPocketId,
      storeRevision
    );
    if (recoveryDraft === null) throw deviceStoreError("recovery-staging-draft-invalid");
    const usage = exactObject(record.usage, ["deviceWrappingKeyEncryptions"], "recovery-staging-usage-invalid");
    const deviceWrappingKeyEncryptions = nonNegativeInteger(usage.deviceWrappingKeyEncryptions, "recovery-staging-usage-invalid");
    const ceiling = cryptoContract().POLICY?.maximumEncryptionsPerKey;
    if (!Number.isSafeInteger(ceiling) || deviceWrappingKeyEncryptions >= ceiling) {
      throw deviceStoreError("device-usage-limit-reached");
    }
    return freezeValue({
      kind: FORMAT.recoveryStagingKind,
      schemaVersion: FORMAT.recoveryStagingSchemaVersion,
      storeRevision,
      syncedPocketId,
      deviceId,
      deviceWrappingKey,
      recoveryDraft,
      usage: Object.freeze({ deviceWrappingKeyEncryptions }),
    }, deviceWrappingKey);
  }

  function migrateRecoveryStagingRecord(input) {
    if (input?.schemaVersion === FORMAT.recoveryStagingSchemaVersion) return validateRecoveryStagingRecord(input);
    if (input?.schemaVersion !== 1) throw deviceStoreError("recovery-staging-schema-invalid");
    const legacy = exactObject(input, RECOVERY_STAGING_V1_FIELDS, "recovery-staging-invalid");
    return validateRecoveryStagingRecord(Object.assign({}, legacy, {
      schemaVersion: FORMAT.recoveryStagingSchemaVersion,
      usage: { deviceWrappingKeyEncryptions: legacy.storeRevision },
    }));
  }

  function validateStoredRecord(input) {
    if (input && input.kind === FORMAT.recoveryStagingKind) {
      return migrateRecoveryStagingRecord(input);
    }
    return migrateRecord(input);
  }

  function migrateRecord(input) {
    if (!input || typeof input !== "object" || Array.isArray(input)) {
      throw deviceStoreError("device-state-invalid");
    }
    if (input.schemaVersion === FORMAT.recordSchemaVersion) return validateCurrentRecord(input);
    if (input.schemaVersion === 1) return migrateVersionOneRecord(input);
    if (input.schemaVersion === 2) return migrateVersionTwoRecord(input);
    if (input.schemaVersion === 3) return migrateVersionThreeRecord(input);
    if (input.schemaVersion === 4) return migrateVersionFourRecord(input);
    if (Number.isSafeInteger(input.schemaVersion)
        && input.schemaVersion >= 0
        && input.schemaVersion < FORMAT.recordSchemaVersion) {
      throw deviceStoreError("device-state-migration-unavailable");
    }
    throw deviceStoreError("device-state-schema-unsupported");
  }

  function validateReplacement(current, expectedStoreRevision, next) {
    if (current.storeRevision !== expectedStoreRevision) {
      throw deviceStoreError("device-store-revision-conflict");
    }
    if (expectedStoreRevision >= Number.MAX_SAFE_INTEGER
        || next.storeRevision !== expectedStoreRevision + 1) {
      throw deviceStoreError("device-store-revision-invalid");
    }
    if (next.syncedPocketId !== current.syncedPocketId) {
      throw deviceStoreError("device-state-identity-invalid");
    }
    if (next.remote.confirmedRevision < current.remote.confirmedRevision) {
      throw deviceStoreError("device-remote-revision-rollback");
    }
    if (next.usage.masterKeyGeneration < current.usage.masterKeyGeneration) {
      throw deviceStoreError("device-usage-rollback");
    }
    if ((next.usage.masterKeyGeneration === current.usage.masterKeyGeneration
          && next.usage.masterKeyContentEncryptions
            < current.usage.masterKeyContentEncryptions)
        || next.usage.deviceWrappingKeyEncryptions
          < current.usage.deviceWrappingKeyEncryptions) {
      throw deviceStoreError("device-usage-rollback");
    }
    if (next.usage.masterKeyGeneration === current.usage.masterKeyGeneration
        && next.usage.masterKeyContentEncryptionLimit
          < current.usage.masterKeyContentEncryptionLimit) {
      throw deviceStoreError("device-usage-rollback");
    }
    return next;
  }

  function validateDriver(driver) {
    if (!driver
        || typeof driver.open !== "function"
        || typeof driver.transaction !== "function"
        || typeof driver.close !== "function") {
      throw deviceStoreError("device-store-driver-invalid");
    }
    return driver;
  }

  function createStore(driverInput) {
    const driver = validateDriver(driverInput);
    let opened = false;

    function requireOpen() {
      if (!opened) throw deviceStoreError("device-store-not-open");
    }

    async function openStore() {
      await driver.open(CONFIG);
      opened = true;
      return true;
    }

    async function readPocket(syncedPocketIdInput) {
      requireOpen();
      const syncedPocketId = identifier(
        syncedPocketIdInput,
        "device-state-identity-invalid"
      );
      return driver.transaction("readonly", async (transaction) => {
        const found = await transaction.get(syncedPocketId);
        transaction.checkpoint("after-read-before-validation");
        return found === undefined ? null : migrateRecord(found);
      });
    }

    async function readActivation(activationIdInput) {
      requireOpen();
      const activationId = identifier(activationIdInput, "activation-draft-identity-invalid");
      const records = await driver.transaction("readonly", async (transaction) => {
        if (typeof transaction.getAll !== "function") {
          throw deviceStoreError("device-store-driver-invalid");
        }
        const found = await transaction.getAll();
        transaction.checkpoint("after-read-before-validation");
        if (!Array.isArray(found)) throw deviceStoreError("device-store-read-invalid");
        return found.map((record) => validateStoredRecord(record));
      });
      let match = null;
      for (const record of records) {
        if (record.kind !== FORMAT.recordKind) continue;
        if (record.activationDraft === null) continue;
        let draft;
        try {
          draft = await cryptoContract().openContent(
            record.activationDraft.record,
            record.deviceWrappingKey,
            record.activationDraft.context
          );
        } catch (_error) {
          throw deviceStoreError("activation-draft-invalid");
        }
        if (draft && draft.activationId === activationId) {
          if (match !== null) throw deviceStoreError("activation-draft-identity-conflict");
          match = Object.freeze({ record, draft: freezeValue(draft, record.deviceWrappingKey) });
        }
      }
      return match;
    }

    async function readStoredRecord(syncedPocketIdInput) {
      requireOpen();
      const syncedPocketId = identifier(syncedPocketIdInput, "device-state-identity-invalid");
      return driver.transaction("readonly", async (transaction) => {
        const found = await transaction.get(syncedPocketId);
        transaction.checkpoint("after-read-before-validation");
        return found === undefined ? null : validateStoredRecord(found);
      });
    }

    async function readRecoveryAttempt(recoveryAttemptIdInput) {
      requireOpen();
      const recoveryAttemptId = identifier(
        recoveryAttemptIdInput,
        "recovery-attempt-identity-invalid"
      );
      const records = await driver.transaction("readonly", async (transaction) => {
        if (typeof transaction.getAll !== "function") {
          throw deviceStoreError("device-store-driver-invalid");
        }
        const found = await transaction.getAll();
        transaction.checkpoint("after-read-before-validation");
        if (!Array.isArray(found)) throw deviceStoreError("device-store-read-invalid");
        return found.map((record) => validateStoredRecord(record));
      });
      let match = null;
      for (const record of records) {
        const encryptedDraft = record.kind === FORMAT.recoveryStagingKind
          ? record.recoveryDraft
          : record.kind === FORMAT.recordKind ? record.recoveryDraft : null;
        if (encryptedDraft === null) continue;
        let draft;
        try {
          draft = await cryptoContract().openContent(
            encryptedDraft.record,
            record.deviceWrappingKey,
            encryptedDraft.context
          );
        } catch (_error) {
          throw deviceStoreError("recovery-staging-draft-invalid");
        }
        if (draft && draft.recoveryAttemptId === recoveryAttemptId) {
          if (match !== null) throw deviceStoreError("recovery-attempt-identity-conflict");
          match = Object.freeze({ record, draft: freezeValue(draft, record.deviceWrappingKey) });
        }
      }
      return match;
    }

    async function readAdditionalDeviceAttempt(attemptIdInput) {
      requireOpen();
      const attemptId = identifier(attemptIdInput, "additional-device-attempt-invalid");
      const records = await driver.transaction("readonly", async (transaction) => {
        if (typeof transaction.getAll !== "function") throw deviceStoreError("device-store-driver-invalid");
        return (await transaction.getAll()).map((record) => migrateRecord(record));
      });
      let match = null;
      for (const record of records) {
        if (record.additionalDeviceDraft === null) continue;
        let draft;
        try { draft = await cryptoContract().openContent(record.additionalDeviceDraft.record,
          record.deviceWrappingKey, record.additionalDeviceDraft.context); }
        catch (_error) { throw deviceStoreError("additional-device-draft-invalid"); }
        if (draft?.attemptId === attemptId) {
          if (match !== null) throw deviceStoreError("additional-device-attempt-identity-conflict");
          match = Object.freeze({ record, draft: freezeValue(draft, record.deviceWrappingKey) });
        }
      }
      return match;
    }

    async function createRecoveryStaging(input) {
      requireOpen();
      return driver.transaction("readwrite", async (transaction) => {
        const syncedPocketId = identifier(input?.syncedPocketId, "device-state-identity-invalid");
        const current = await transaction.get(syncedPocketId);
        transaction.checkpoint("after-read-before-validation");
        if (current !== undefined) throw deviceStoreError("device-store-already-exists");
        const record = validateRecoveryStagingRecord(input);
        if (record.storeRevision !== FORMAT.firstStoreRevision) {
          throw deviceStoreError("device-store-revision-invalid");
        }
        transaction.checkpoint("after-validation-before-write");
        await transaction.add(record);
        transaction.checkpoint("after-write-before-commit");
        return record;
      });
    }

    async function replaceRecoveryStaging(syncedPocketIdInput, expectedRevisionInput, input) {
      requireOpen();
      const syncedPocketId = identifier(syncedPocketIdInput, "device-state-identity-invalid");
      const expectedRevision = positiveInteger(
        expectedRevisionInput,
        "device-store-revision-invalid"
      );
      return driver.transaction("readwrite", async (transaction) => {
        const found = await transaction.get(syncedPocketId);
        transaction.checkpoint("after-read-before-validation");
        if (found === undefined) throw deviceStoreError("device-store-not-found");
        const current = migrateRecoveryStagingRecord(found);
        if (current.storeRevision !== expectedRevision) {
          throw deviceStoreError("device-store-revision-conflict");
        }
        const next = validateRecoveryStagingRecord(input);
        if (expectedRevision >= Number.MAX_SAFE_INTEGER
            || next.storeRevision !== expectedRevision + 1
            || next.syncedPocketId !== current.syncedPocketId
            || next.deviceId !== current.deviceId
            || next.usage.deviceWrappingKeyEncryptions < current.usage.deviceWrappingKeyEncryptions) {
          throw deviceStoreError("device-store-revision-invalid");
        }
        transaction.checkpoint("after-validation-before-write");
        await transaction.put(next);
        transaction.checkpoint("after-write-before-commit");
        return next;
      });
    }

    async function promoteRecoveryStaging(syncedPocketIdInput, expectedRevisionInput, input) {
      requireOpen();
      const syncedPocketId = identifier(syncedPocketIdInput, "device-state-identity-invalid");
      const expectedRevision = positiveInteger(
        expectedRevisionInput,
        "device-store-revision-invalid"
      );
      return driver.transaction("readwrite", async (transaction) => {
        const found = await transaction.get(syncedPocketId);
        transaction.checkpoint("after-read-before-validation");
        if (found === undefined) throw deviceStoreError("device-store-not-found");
        const current = migrateRecoveryStagingRecord(found);
        if (current.storeRevision !== expectedRevision) {
          throw deviceStoreError("device-store-revision-conflict");
        }
        const next = validateRecord(input);
        if (expectedRevision >= Number.MAX_SAFE_INTEGER
            || next.storeRevision !== expectedRevision + 1
            || next.syncedPocketId !== current.syncedPocketId
            || next.deviceId !== current.deviceId
            || next.usage.deviceWrappingKeyEncryptions < current.usage.deviceWrappingKeyEncryptions) {
          throw deviceStoreError("device-store-revision-invalid");
        }
        transaction.checkpoint("after-validation-before-write");
        await transaction.put(next);
        transaction.checkpoint("after-write-before-commit");
        return next;
      });
    }

    async function createPocket(input) {
      requireOpen();
      return driver.transaction("readwrite", async (transaction) => {
        const requestedId = input && input.syncedPocketId;
        const syncedPocketId = identifier(requestedId, "device-state-identity-invalid");
        const current = await transaction.get(syncedPocketId);
        transaction.checkpoint("after-read-before-validation");
        if (current !== undefined) throw deviceStoreError("device-store-already-exists");
        const record = validateRecord(input);
        if (record.storeRevision !== FORMAT.firstStoreRevision) {
          throw deviceStoreError("device-store-revision-invalid");
        }
        transaction.checkpoint("after-validation-before-write");
        await transaction.add(record);
        transaction.checkpoint("after-write-before-commit");
        return record;
      });
    }

    async function replacePocket(syncedPocketIdInput, expectedStoreRevisionInput, input) {
      requireOpen();
      const syncedPocketId = identifier(
        syncedPocketIdInput,
        "device-state-identity-invalid"
      );
      const expectedStoreRevision = positiveInteger(
        expectedStoreRevisionInput,
        "device-store-revision-invalid"
      );
      return driver.transaction("readwrite", async (transaction) => {
        const found = await transaction.get(syncedPocketId);
        transaction.checkpoint("after-read-before-validation");
        if (found === undefined) throw deviceStoreError("device-store-not-found");
        const current = migrateRecord(found);
        if (current.storeRevision !== expectedStoreRevision) {
          throw deviceStoreError("device-store-revision-conflict");
        }
        const next = validateRecord(input);
        validateReplacement(current, expectedStoreRevision, next);
        transaction.checkpoint("after-validation-before-write");
        await transaction.put(next);
        transaction.checkpoint("after-write-before-commit");
        return next;
      });
    }

    async function reservePocketEncryptionUsage(
      syncedPocketIdInput,
      expectedStoreRevisionInput,
      expectedUsageInput,
      incrementsInput
    ) {
      requireOpen();
      const syncedPocketId = identifier(syncedPocketIdInput, "device-state-identity-invalid");
      const expectedStoreRevision = positiveInteger(
        expectedStoreRevisionInput, "device-store-revision-invalid"
      );
      return driver.transaction("readwrite", async (transaction) => {
        const found = await transaction.get(syncedPocketId);
        transaction.checkpoint("after-read-before-validation");
        if (found === undefined) throw deviceStoreError("device-store-not-found");
        const current = migrateRecord(found);
        if (current.storeRevision !== expectedStoreRevision) {
          throw deviceStoreError("device-store-revision-conflict");
        }
        const next = reserveUsage(current, expectedUsageInput, incrementsInput);
        transaction.checkpoint("after-validation-before-write");
        await transaction.put(next);
        transaction.checkpoint("after-write-before-commit");
        return next;
      });
    }

    async function reserveRecoveryStagingEncryptionUsage(
      syncedPocketIdInput,
      expectedStoreRevisionInput,
      expectedDeviceWrappingKeyEncryptionsInput,
      incrementInput
    ) {
      requireOpen();
      const syncedPocketId = identifier(syncedPocketIdInput, "device-state-identity-invalid");
      const expectedStoreRevision = positiveInteger(
        expectedStoreRevisionInput, "device-store-revision-invalid"
      );
      const expectedDeviceWrappingKeyEncryptions = nonNegativeInteger(
        expectedDeviceWrappingKeyEncryptionsInput, "recovery-staging-usage-invalid"
      );
      const increment = positiveInteger(incrementInput, "recovery-staging-usage-invalid");
      return driver.transaction("readwrite", async (transaction) => {
        const found = await transaction.get(syncedPocketId);
        transaction.checkpoint("after-read-before-validation");
        if (found === undefined) throw deviceStoreError("device-store-not-found");
        const current = migrateRecoveryStagingRecord(found);
        if (current.storeRevision !== expectedStoreRevision) {
          throw deviceStoreError("device-store-revision-conflict");
        }
        if (current.usage.deviceWrappingKeyEncryptions !== expectedDeviceWrappingKeyEncryptions) {
          usageReservationConflict();
        }
        const next = validateRecoveryStagingRecord(Object.assign({}, current, {
          usage: {
            deviceWrappingKeyEncryptions: current.usage.deviceWrappingKeyEncryptions + increment,
          },
        }));
        transaction.checkpoint("after-validation-before-write");
        await transaction.put(next);
        transaction.checkpoint("after-write-before-commit");
        return next;
      });
    }

    function closeStore() {
      driver.close();
      opened = false;
      return true;
    }

    return Object.freeze({
      open: openStore,
      readPocket,
      readActivation,
      readStoredRecord,
      readRecoveryAttempt,
      readAdditionalDeviceAttempt,
      createPocket,
      replacePocket,
      reservePocketEncryptionUsage,
      createRecoveryStaging,
      replaceRecoveryStaging,
      reserveRecoveryStagingEncryptionUsage,
      promoteRecoveryStaging,
      close: closeStore,
    });
  }

  function createIndexedDbDriver(indexedDbInput = global.indexedDB) {
    let database = null;

    function mapIndexedDbError(error, fallbackCode) {
      if (error && error.name === "VersionError") {
        return deviceStoreError("device-store-database-version-unsupported");
      }
      if (error && error.name === "DataCloneError") {
        return deviceStoreError("device-key-storage-unsupported");
      }
      return normaliseError(error, fallbackCode);
    }

    function requestResult(store, method, value) {
      return new Promise((resolve, reject) => {
        let request;
        try {
          request = store[method](value);
        } catch (error) {
          reject(mapIndexedDbError(error, "device-store-request-failed"));
          return;
        }
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(mapIndexedDbError(
          request.error,
          "device-store-request-failed"
        ));
      });
    }

    function verifyDatabaseShape(db) {
      const names = Array.from(db.objectStoreNames || []);
      if (db.version !== CONFIG.databaseVersion
          || names.length !== 1
          || names[0] !== CONFIG.objectStoreName) {
        throw deviceStoreError("device-store-database-shape-invalid");
      }
      let transaction;
      let store;
      try {
        transaction = db.transaction(CONFIG.objectStoreName, "readonly");
        store = transaction.objectStore(CONFIG.objectStoreName);
      } catch (_error) {
        throw deviceStoreError("device-store-database-shape-invalid");
      }
      if (store.keyPath !== CONFIG.keyPath
          || store.autoIncrement === true
          || Array.from(store.indexNames || []).length !== 0) {
        try { transaction.abort(); } catch (_error) {}
        throw deviceStoreError("device-store-database-shape-invalid");
      }
    }

    async function openDriver() {
      if (database) return true;
      if (!indexedDbInput || typeof indexedDbInput.open !== "function") {
        throw deviceStoreError("indexeddb-unavailable");
      }
      return new Promise((resolve, reject) => {
        let request;
        let settled = false;
        let upgradeError = null;
        const finishReject = (error) => {
          if (settled) return;
          settled = true;
          reject(error);
        };
        try {
          request = indexedDbInput.open(CONFIG.databaseName, CONFIG.databaseVersion);
        } catch (error) {
          finishReject(mapIndexedDbError(error, "device-store-open-failed"));
          return;
        }
        request.onupgradeneeded = (event) => {
          const db = request.result;
          if (settled) {
            try { request.transaction.abort(); } catch (_abortError) {}
            return;
          }
          try {
            if (event.oldVersion !== 0 || Array.from(db.objectStoreNames || []).length !== 0) {
              throw deviceStoreError("device-store-migration-unavailable");
            }
            db.createObjectStore(CONFIG.objectStoreName, { keyPath: CONFIG.keyPath });
          } catch (error) {
            upgradeError = normaliseError(error, "device-store-upgrade-failed");
            try { request.transaction.abort(); } catch (_abortError) {}
          }
        };
        request.onerror = () => finishReject(upgradeError || mapIndexedDbError(
          request.error,
          "device-store-open-failed"
        ));
        request.onblocked = () => finishReject(deviceStoreError("device-store-open-blocked"));
        request.onsuccess = () => {
          const db = request.result;
          if (settled) {
            try { db.close(); } catch (_error) {}
            return;
          }
          try {
            verifyDatabaseShape(db);
          } catch (error) {
            try { db.close(); } catch (_closeError) {}
            finishReject(error);
            return;
          }
          db.onversionchange = () => {
            try { db.close(); } catch (_error) {}
            if (database === db) database = null;
          };
          database = db;
          settled = true;
          resolve(true);
        };
      });
    }

    async function transactionDriver(mode, work) {
      if (!database) throw deviceStoreError("device-store-not-open");
      if (!["readonly", "readwrite"].includes(mode) || typeof work !== "function") {
        throw deviceStoreError("device-store-transaction-invalid");
      }
      return new Promise((resolve, reject) => {
        let transaction;
        let store;
        try {
          transaction = database.transaction(CONFIG.objectStoreName, mode);
          store = transaction.objectStore(CONFIG.objectStoreName);
        } catch (error) {
          reject(mapIndexedDbError(error, "device-store-transaction-failed"));
          return;
        }
        let result;
        let operationFinished = false;
        let operationError = null;
        let settled = false;
        const finishReject = (error) => {
          if (settled) return;
          settled = true;
          reject(normaliseError(error, "device-store-transaction-failed"));
        };
        transaction.oncomplete = () => {
          if (settled) return;
          if (!operationFinished) {
            finishReject(deviceStoreError("device-store-transaction-failed"));
            return;
          }
          settled = true;
          resolve(result);
        };
        transaction.onabort = () => finishReject(
          operationError || mapIndexedDbError(transaction.error, "device-store-transaction-aborted")
        );
        transaction.onerror = () => {};
        const boundary = Object.freeze({
          get: (key) => requestResult(store, "get", key),
          getAll: () => requestResult(store, "getAll"),
          add: (value) => requestResult(store, "add", value),
          put: (value) => requestResult(store, "put", value),
          checkpoint: () => {},
        });
        Promise.resolve()
          .then(() => work(boundary))
          .then((value) => {
            result = value;
            operationFinished = true;
          })
          .catch((error) => {
            operationError = normaliseError(error, "device-store-transaction-failed");
            try {
              transaction.abort();
            } catch (_abortError) {
              finishReject(operationError);
            }
          });
      });
    }

    function closeDriver() {
      if (database) {
        try { database.close(); } catch (_error) {}
        database = null;
      }
      return true;
    }

    return Object.freeze({
      open: openDriver,
      transaction: transactionDriver,
      close: closeDriver,
    });
  }

  let defaultStore = null;

  function getDefaultStore() {
    if (!defaultStore) defaultStore = createStore(createIndexedDbDriver());
    return defaultStore;
  }

  global.PocketSyncDeviceStore = Object.freeze({
    CONFIG,
    FORMAT,
    MIGRATION_POLICY,
    validateRecord,
    validateRecoveryStagingRecord,
    migrateRecord,
    validateReplacement,
    createStore,
    createIndexedDbDriver,
    open: () => getDefaultStore().open(),
    readPocket: (syncedPocketId) => getDefaultStore().readPocket(syncedPocketId),
    readActivation: (activationId) => getDefaultStore().readActivation(activationId),
    readStoredRecord: (syncedPocketId) => getDefaultStore().readStoredRecord(syncedPocketId),
    readRecoveryAttempt: (recoveryAttemptId) => getDefaultStore()
      .readRecoveryAttempt(recoveryAttemptId),
    readAdditionalDeviceAttempt: (attemptId) => getDefaultStore()
      .readAdditionalDeviceAttempt(attemptId),
    createPocket: (record) => getDefaultStore().createPocket(record),
    replacePocket: (syncedPocketId, expectedStoreRevision, record) => getDefaultStore()
      .replacePocket(syncedPocketId, expectedStoreRevision, record),
    reservePocketEncryptionUsage: (syncedPocketId, expectedStoreRevision, expectedUsage, increments) => getDefaultStore()
      .reservePocketEncryptionUsage(syncedPocketId, expectedStoreRevision, expectedUsage, increments),
    createRecoveryStaging: (record) => getDefaultStore().createRecoveryStaging(record),
    replaceRecoveryStaging: (syncedPocketId, expectedStoreRevision, record) => getDefaultStore()
      .replaceRecoveryStaging(syncedPocketId, expectedStoreRevision, record),
    reserveRecoveryStagingEncryptionUsage: (syncedPocketId, expectedStoreRevision, expectedUsage, increment) => getDefaultStore()
      .reserveRecoveryStagingEncryptionUsage(syncedPocketId, expectedStoreRevision, expectedUsage, increment),
    promoteRecoveryStaging: (syncedPocketId, expectedStoreRevision, record) => getDefaultStore()
      .promoteRecoveryStaging(syncedPocketId, expectedStoreRevision, record),
    close: () => getDefaultStore().close(),
  });
})(typeof window !== "undefined" ? window : globalThis);
