/* Synced Pocket cryptographic foundation.

This module is intentionally unloaded. It defines versioned Web Crypto
operations without activating sync, storage, account, or transport behaviour.
*/

(function initialisePocketSyncCrypto(global) {
  "use strict";

  const FORMAT = Object.freeze({
    content: "pocket.sync.content.opaque",
    masterKeyEnvelope: "pocket.sync.master-key-envelope.opaque",
    version: 1,
    algorithm: "AES-GCM-256",
    webCryptoAlgorithm: "AES-GCM",
    kdf: "HKDF-SHA-256",
    webCryptoKdf: "HKDF",
    hash: "SHA-256",
    contentType: "portal.export.v1+json",
    encoding: "base64url",
    keyBits: 256,
    keyBytes: 32,
    nonceBytes: 12,
    tagBits: 128,
    tagBytes: 16,
    hkdfSaltBytes: 32,
    derivationVersion: 1,
  });
  const DERIVATION_LABELS = Object.freeze({
    "passkey-prf": "pocket.sync.passkey-prf.master-key-wrapping.v1",
    "device-transfer": "pocket.sync.device-transfer.master-key-wrapping.v1",
    recovery: "pocket.sync.recovery.master-key-wrapping.v1",
  });
  const RECOVERY_AUTHORISATION_LABEL = "pocket.sync.recovery.account-authorisation.v1";
  const ENVELOPE_KINDS = Object.freeze([
    "device",
    "passkey-prf",
    "device-transfer",
    "recovery",
  ]);
  const POLICY = Object.freeze({
    canonicalUnpaddedBase64url: true,
    callerSuppliedNonceAllowed: false,
    maximumEncryptionsPerKey: 2 ** 31,
    operationalCountingRequiredElsewhere: true,
    perfectMemoryErasureClaimed: false,
  });
  const RECORD_FIELDS = Object.freeze(["format", "version", "algorithm", "nonce", "ciphertext"]);
  const CONTENT_CONTEXT_FIELDS = Object.freeze(["syncedPocketId", "revision", "contentType"]);
  const ENVELOPE_CONTEXT_FIELDS = Object.freeze([
    "syncedPocketId",
    "envelopeId",
    "envelopeKind",
    "envelopeVersion",
  ]);
  const PLAN_FIELDS = Object.freeze(["context", "wrappingKey"]);
  const BASE64URL_PATTERN = /^[A-Za-z0-9_-]+$/;
  const KEY_USAGES = Object.freeze(["encrypt", "decrypt"]);
  const textEncoder = new global.TextEncoder();
  const textDecoder = new global.TextDecoder("utf-8", { fatal: true });

  function cryptoError(code) {
    const error = new Error(`Pocket Sync crypto ${code}.`);
    error.code = code;
    return error;
  }

  function requireObject(value, fields, code) {
    if (!value || typeof value !== "object" || Array.isArray(value)
        || !Object.keys(value).every((field) => fields.includes(field))) {
      throw cryptoError(code);
    }
    return value;
  }

  function requireIdentifier(value, code) {
    if (typeof value !== "string"
        || value.length < 1
        || value.length > 160
        || value !== value.trim()) {
      throw cryptoError(code);
    }
    return value;
  }

  function requirePositiveVersion(value, code) {
    if (!Number.isSafeInteger(value) || value < 1) throw cryptoError(code);
    return value;
  }

  function requireRevision(value) {
    if (!Number.isSafeInteger(value) || value < 0) throw cryptoError("content-context-invalid");
    return value;
  }

  function getCrypto() {
    const cryptoObject = global.crypto;
    if (!cryptoObject || !cryptoObject.subtle || typeof cryptoObject.getRandomValues !== "function") {
      throw cryptoError("web-crypto-unavailable");
    }
    return cryptoObject;
  }

  function randomBytes(length) {
    const bytes = new Uint8Array(length);
    try {
      getCrypto().getRandomValues(bytes);
      return bytes;
    } catch (_error) {
      bytes.fill(0);
      throw cryptoError("random-generation-failed");
    }
  }

  function encodeBase64Url(bytes) {
    if (!(bytes instanceof Uint8Array)) throw cryptoError("bytes-invalid");
    let binary = "";
    for (let index = 0; index < bytes.length; index += 1) {
      binary += String.fromCharCode(bytes[index]);
    }
    return global.btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
  }

  function decodeBase64Url(value, code) {
    if (typeof value !== "string"
        || !value
        || !BASE64URL_PATTERN.test(value)
        || value.length % 4 === 1) {
      throw cryptoError(code);
    }
    const normalised = value.replace(/-/g, "+").replace(/_/g, "/");
    const padded = normalised.padEnd(Math.ceil(normalised.length / 4) * 4, "=");
    let binary;
    try {
      binary = global.atob(padded);
    } catch (_error) {
      throw cryptoError(code);
    }
    const bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index += 1) {
      bytes[index] = binary.charCodeAt(index);
    }
    if (encodeBase64Url(bytes) !== value) throw cryptoError(code);
    return bytes;
  }

  function copySecretBytes(value) {
    let copy;
    if (value instanceof ArrayBuffer) {
      copy = new Uint8Array(value.slice(0));
    } else if (ArrayBuffer.isView(value)) {
      copy = new Uint8Array(value.byteLength);
      copy.set(new Uint8Array(value.buffer, value.byteOffset, value.byteLength));
    } else {
      throw cryptoError("derivation-secret-invalid");
    }
    if (copy.byteLength < FORMAT.keyBytes) {
      copy.fill(0);
      throw cryptoError("derivation-secret-invalid");
    }
    return copy;
  }

  function validateNonExtractableAesKey(key) {
    const usages = key && key.usages ? Array.from(key.usages) : [];
    if (!key
        || key.type !== "secret"
        || key.extractable !== false
        || key.algorithm?.name !== FORMAT.webCryptoAlgorithm
        || key.algorithm?.length !== FORMAT.keyBits
        || usages.length !== KEY_USAGES.length
        || !KEY_USAGES.every((usage) => usages.includes(usage))) {
      throw cryptoError("key-invalid");
    }
    return key;
  }

  function validateContentContext(input) {
    const context = requireObject(input, CONTENT_CONTEXT_FIELDS, "content-context-invalid");
    if (context.contentType !== FORMAT.contentType) throw cryptoError("content-context-invalid");
    return Object.freeze({
      syncedPocketId: requireIdentifier(context.syncedPocketId, "content-context-invalid"),
      revision: requireRevision(context.revision),
      contentType: FORMAT.contentType,
    });
  }

  function validateEnvelopeContext(input) {
    const context = requireObject(input, ENVELOPE_CONTEXT_FIELDS, "envelope-context-invalid");
    if (!ENVELOPE_KINDS.includes(context.envelopeKind)) {
      throw cryptoError("envelope-context-invalid");
    }
    return Object.freeze({
      syncedPocketId: requireIdentifier(context.syncedPocketId, "envelope-context-invalid"),
      envelopeId: requireIdentifier(context.envelopeId, "envelope-context-invalid"),
      envelopeKind: context.envelopeKind,
      envelopeVersion: requirePositiveVersion(context.envelopeVersion, "envelope-context-invalid"),
    });
  }

  function validateHkdfContext(input) {
    const context = validateEnvelopeContext(input);
    if (!DERIVATION_LABELS[context.envelopeKind]) throw cryptoError("derivation-context-invalid");
    return context;
  }

  function buildContentAad(input) {
    const context = validateContentContext(input);
    return textEncoder.encode(JSON.stringify([
      FORMAT.content,
      FORMAT.version,
      FORMAT.algorithm,
      context.syncedPocketId,
      context.revision,
      context.contentType,
    ]));
  }

  function buildEnvelopeAad(input) {
    const context = validateEnvelopeContext(input);
    return textEncoder.encode(JSON.stringify([
      FORMAT.masterKeyEnvelope,
      FORMAT.version,
      FORMAT.algorithm,
      context.syncedPocketId,
      context.envelopeId,
      context.envelopeKind,
      context.envelopeVersion,
    ]));
  }

  function buildHkdfInfo(input) {
    const context = validateHkdfContext(input);
    return textEncoder.encode(JSON.stringify([
      DERIVATION_LABELS[context.envelopeKind],
      context.syncedPocketId,
      context.envelopeId,
      context.envelopeVersion,
    ]));
  }

  function validateContentRecord(input) {
    const record = requireObject(input, RECORD_FIELDS, "content-record-invalid");
    if (record.format !== FORMAT.content
        || record.version !== FORMAT.version
        || record.algorithm !== FORMAT.algorithm) {
      throw cryptoError("content-record-invalid");
    }
    const nonce = decodeBase64Url(record.nonce, "content-record-invalid");
    const ciphertext = decodeBase64Url(record.ciphertext, "content-record-invalid");
    if (nonce.byteLength !== FORMAT.nonceBytes || ciphertext.byteLength < FORMAT.tagBytes) {
      throw cryptoError("content-record-invalid");
    }
    return Object.freeze({
      format: FORMAT.content,
      version: FORMAT.version,
      algorithm: FORMAT.algorithm,
      nonce: record.nonce,
      ciphertext: record.ciphertext,
    });
  }

  function validateMasterKeyEnvelope(input) {
    const record = requireObject(input, RECORD_FIELDS, "master-key-envelope-invalid");
    if (record.format !== FORMAT.masterKeyEnvelope
        || record.version !== FORMAT.version
        || record.algorithm !== FORMAT.algorithm) {
      throw cryptoError("master-key-envelope-invalid");
    }
    const nonce = decodeBase64Url(record.nonce, "master-key-envelope-invalid");
    const ciphertext = decodeBase64Url(record.ciphertext, "master-key-envelope-invalid");
    if (nonce.byteLength !== FORMAT.nonceBytes
        || ciphertext.byteLength !== FORMAT.keyBytes + FORMAT.tagBytes) {
      throw cryptoError("master-key-envelope-invalid");
    }
    return Object.freeze({
      format: FORMAT.masterKeyEnvelope,
      version: FORMAT.version,
      algorithm: FORMAT.algorithm,
      nonce: record.nonce,
      ciphertext: record.ciphertext,
    });
  }

  async function generateDeviceWrappingKey() {
    let key;
    try {
      key = await getCrypto().subtle.generateKey(
        { name: FORMAT.webCryptoAlgorithm, length: FORMAT.keyBits },
        false,
        KEY_USAGES
      );
    } catch (_error) {
      throw cryptoError("device-key-generation-failed");
    }
    return validateNonExtractableAesKey(key);
  }

  async function deriveWrappingKey(secretBytes, saltText, input) {
    const context = validateHkdfContext(input);
    const salt = decodeBase64Url(saltText, "derivation-salt-invalid");
    if (salt.byteLength !== FORMAT.hkdfSaltBytes) throw cryptoError("derivation-salt-invalid");
    const secret = copySecretBytes(secretBytes);
    const info = buildHkdfInfo(context);
    try {
      const baseKey = await getCrypto().subtle.importKey(
        "raw",
        secret,
        FORMAT.webCryptoKdf,
        false,
        ["deriveKey"]
      );
      const key = await getCrypto().subtle.deriveKey(
        { name: FORMAT.webCryptoKdf, hash: FORMAT.hash, salt, info },
        baseKey,
        { name: FORMAT.webCryptoAlgorithm, length: FORMAT.keyBits },
        false,
        KEY_USAGES
      );
      return validateNonExtractableAesKey(key);
    } catch (error) {
      if (error && error.code === "key-invalid") throw error;
      throw cryptoError("wrapping-key-derivation-failed");
    } finally {
      secret.fill(0);
      salt.fill(0);
      info.fill(0);
    }
  }

  async function createDerivedWrappingKey(secretBytes, input) {
    const context = validateHkdfContext(input);
    const salt = randomBytes(FORMAT.hkdfSaltBytes);
    const kdfSalt = encodeBase64Url(salt);
    try {
      const key = await deriveWrappingKey(secretBytes, kdfSalt, context);
      return Object.freeze({
        key,
        kdf: FORMAT.kdf,
        kdfSalt,
        derivationVersion: FORMAT.derivationVersion,
      });
    } finally {
      salt.fill(0);
    }
  }

  async function deriveRecoveryAuthorisationVerifier(secretBytes, saltText) {
    const salt = decodeBase64Url(saltText, "derivation-salt-invalid");
    if (salt.byteLength !== FORMAT.hkdfSaltBytes) throw cryptoError("derivation-salt-invalid");
    const secret = copySecretBytes(secretBytes);
    const info = textEncoder.encode(JSON.stringify([RECOVERY_AUTHORISATION_LABEL]));
    try {
      const baseKey = await getCrypto().subtle.importKey(
        "raw",
        secret,
        FORMAT.webCryptoKdf,
        false,
        ["deriveBits"]
      );
      const bits = await getCrypto().subtle.deriveBits(
        { name: FORMAT.webCryptoKdf, hash: FORMAT.hash, salt, info },
        baseKey,
        FORMAT.keyBits
      );
      const verifierBytes = new Uint8Array(bits);
      try {
        return encodeBase64Url(verifierBytes);
      } finally {
        verifierBytes.fill(0);
      }
    } catch (error) {
      if (error && typeof error.code === "string") throw error;
      throw cryptoError("recovery-verifier-derivation-failed");
    } finally {
      secret.fill(0);
      salt.fill(0);
      info.fill(0);
    }
  }

  async function createRecoveryAuthorisationVerifier(secretBytes) {
    const salt = randomBytes(FORMAT.hkdfSaltBytes);
    const kdfSalt = encodeBase64Url(salt);
    try {
      const verifier = await deriveRecoveryAuthorisationVerifier(secretBytes, kdfSalt);
      return Object.freeze({
        format: "pocket.sync.recovery-authorisation-verifier.opaque",
        version: 1,
        kdf: FORMAT.kdf,
        kdfSalt,
        derivationVersion: FORMAT.derivationVersion,
        verifier,
      });
    } finally {
      salt.fill(0);
    }
  }

  function validatePlans(plans, options) {
    const allowEmpty = options && options.allowEmpty === true;
    const reservedIds = new Set((options && options.reservedIds) || []);
    if (!Array.isArray(plans) || (!allowEmpty && plans.length < 1)) {
      throw cryptoError("envelope-plans-invalid");
    }
    return plans.map((plan) => {
      requireObject(plan, PLAN_FIELDS, "envelope-plan-invalid");
      const context = validateEnvelopeContext(plan.context);
      if (reservedIds.has(context.envelopeId)) throw cryptoError("envelope-id-duplicate");
      reservedIds.add(context.envelopeId);
      return Object.freeze({
        context,
        wrappingKey: validateNonExtractableAesKey(plan.wrappingKey),
      });
    });
  }

  async function importMasterKey(rawBytes) {
    try {
      const key = await getCrypto().subtle.importKey(
        "raw",
        rawBytes,
        { name: FORMAT.webCryptoAlgorithm, length: FORMAT.keyBits },
        false,
        KEY_USAGES
      );
      return validateNonExtractableAesKey(key);
    } catch (error) {
      if (error && error.code === "key-invalid") throw error;
      throw cryptoError("master-key-import-failed");
    }
  }

  async function wrapMasterBytes(rawMasterKey, plan) {
    const nonce = randomBytes(FORMAT.nonceBytes);
    const aad = buildEnvelopeAad(plan.context);
    try {
      const encrypted = await getCrypto().subtle.encrypt(
        {
          name: FORMAT.webCryptoAlgorithm,
          iv: nonce,
          additionalData: aad,
          tagLength: FORMAT.tagBits,
        },
        plan.wrappingKey,
        rawMasterKey
      );
      const record = Object.freeze({
        format: FORMAT.masterKeyEnvelope,
        version: FORMAT.version,
        algorithm: FORMAT.algorithm,
        nonce: encodeBase64Url(nonce),
        ciphertext: encodeBase64Url(new Uint8Array(encrypted)),
      });
      validateMasterKeyEnvelope(record);
      return Object.freeze({ context: plan.context, record });
    } catch (error) {
      if (error && error.code === "master-key-envelope-invalid") throw error;
      throw cryptoError("master-key-envelope-encryption-failed");
    } finally {
      nonce.fill(0);
      aad.fill(0);
    }
  }

  async function createMasterKeyBundle(envelopePlans) {
    const plans = validatePlans(envelopePlans);
    const rawMasterKey = randomBytes(FORMAT.keyBytes);
    try {
      const masterKey = await importMasterKey(rawMasterKey);
      const envelopes = [];
      for (const plan of plans) {
        envelopes.push(await wrapMasterBytes(rawMasterKey, plan));
      }
      return Object.freeze({ masterKey, envelopes: Object.freeze(envelopes) });
    } finally {
      rawMasterKey.fill(0);
    }
  }

  async function decryptMasterBytes(sourceEnvelope, sourceWrappingKey, sourceContext) {
    const record = validateMasterKeyEnvelope(sourceEnvelope);
    const context = validateEnvelopeContext(sourceContext);
    const key = validateNonExtractableAesKey(sourceWrappingKey);
    const nonce = decodeBase64Url(record.nonce, "master-key-envelope-invalid");
    const ciphertext = decodeBase64Url(record.ciphertext, "master-key-envelope-invalid");
    const aad = buildEnvelopeAad(context);
    try {
      const decrypted = await getCrypto().subtle.decrypt(
        {
          name: FORMAT.webCryptoAlgorithm,
          iv: nonce,
          additionalData: aad,
          tagLength: FORMAT.tagBits,
        },
        key,
        ciphertext
      );
      const rawMasterKey = new Uint8Array(decrypted);
      if (rawMasterKey.byteLength !== FORMAT.keyBytes) {
        rawMasterKey.fill(0);
        throw cryptoError("master-key-size-invalid");
      }
      return rawMasterKey;
    } catch (error) {
      if (error && error.code === "master-key-size-invalid") throw error;
      throw cryptoError("master-key-envelope-authentication-failed");
    } finally {
      nonce.fill(0);
      ciphertext.fill(0);
      aad.fill(0);
    }
  }

  async function openMasterKeyBundle(
    sourceEnvelope,
    sourceWrappingKey,
    sourceContext,
    additionalEnvelopePlans = []
  ) {
    const context = validateEnvelopeContext(sourceContext);
    const plans = validatePlans(additionalEnvelopePlans, {
      allowEmpty: true,
      reservedIds: [context.envelopeId],
    });
    const rawMasterKey = await decryptMasterBytes(sourceEnvelope, sourceWrappingKey, context);
    try {
      const masterKey = await importMasterKey(rawMasterKey);
      const envelopes = [];
      for (const plan of plans) {
        envelopes.push(await wrapMasterBytes(rawMasterKey, plan));
      }
      return Object.freeze({ masterKey, envelopes: Object.freeze(envelopes) });
    } finally {
      rawMasterKey.fill(0);
    }
  }

  async function sealContent(payload, masterKey, input) {
    const key = validateNonExtractableAesKey(masterKey);
    const context = validateContentContext(input);
    let json;
    try {
      json = JSON.stringify(payload);
    } catch (_error) {
      throw cryptoError("content-serialisation-failed");
    }
    if (typeof json !== "string") throw cryptoError("content-serialisation-failed");
    const plaintext = textEncoder.encode(json);
    const nonce = randomBytes(FORMAT.nonceBytes);
    const aad = buildContentAad(context);
    try {
      const encrypted = await getCrypto().subtle.encrypt(
        {
          name: FORMAT.webCryptoAlgorithm,
          iv: nonce,
          additionalData: aad,
          tagLength: FORMAT.tagBits,
        },
        key,
        plaintext
      );
      const record = Object.freeze({
        format: FORMAT.content,
        version: FORMAT.version,
        algorithm: FORMAT.algorithm,
        nonce: encodeBase64Url(nonce),
        ciphertext: encodeBase64Url(new Uint8Array(encrypted)),
      });
      return validateContentRecord(record);
    } catch (error) {
      if (error && error.code === "content-record-invalid") throw error;
      throw cryptoError("content-encryption-failed");
    } finally {
      plaintext.fill(0);
      nonce.fill(0);
      aad.fill(0);
      json = "";
    }
  }

  async function openContent(input, masterKey, contextInput) {
    const record = validateContentRecord(input);
    const key = validateNonExtractableAesKey(masterKey);
    const context = validateContentContext(contextInput);
    const nonce = decodeBase64Url(record.nonce, "content-record-invalid");
    const ciphertext = decodeBase64Url(record.ciphertext, "content-record-invalid");
    const aad = buildContentAad(context);
    let plaintext = null;
    try {
      let decrypted;
      try {
        decrypted = await getCrypto().subtle.decrypt(
          {
            name: FORMAT.webCryptoAlgorithm,
            iv: nonce,
            additionalData: aad,
            tagLength: FORMAT.tagBits,
          },
          key,
          ciphertext
        );
      } catch (_error) {
        throw cryptoError("content-authentication-failed");
      }
      plaintext = new Uint8Array(decrypted);
      let json;
      try {
        json = textDecoder.decode(plaintext);
        return JSON.parse(json);
      } catch (_error) {
        throw cryptoError("content-json-invalid");
      } finally {
        json = "";
      }
    } finally {
      if (plaintext) plaintext.fill(0);
      nonce.fill(0);
      ciphertext.fill(0);
      aad.fill(0);
    }
  }

  global.PocketSyncCrypto = Object.freeze({
    FORMAT,
    POLICY,
    DERIVATION_LABELS,
    ENVELOPE_KINDS,
    encodeBase64Url,
    validateContentRecord,
    validateMasterKeyEnvelope,
    validateContentContext,
    validateEnvelopeContext,
    validateHkdfContext,
    validateNonExtractableAesKey,
    buildContentAad,
    buildEnvelopeAad,
    buildHkdfInfo,
    generateDeviceWrappingKey,
    createDerivedWrappingKey,
    deriveRecoveryAuthorisationVerifier,
    createRecoveryAuthorisationVerifier,
    deriveWrappingKey,
    createMasterKeyBundle,
    openMasterKeyBundle,
    sealContent,
    openContent,
  });
})(typeof window !== "undefined" ? window : globalThis);
