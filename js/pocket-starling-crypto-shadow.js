/* Dormant P111 encrypted-object experiment. This domain encrypts exact P109
   canonical bytes under the existing Synced-Pocket master-key foundation. */
(function (global) {
  "use strict";

  const OBJECT_FORMAT = "pocket.sync.starling-object.opaque",
    OBJECT_VERSION = 1,
    OBJECT_ALGORITHM = "AES-GCM-256",
    REFERENCE_DOMAIN = "pocket.sync.starling-object.reference.v1",
    REFERENCE_PREFIX = `${REFERENCE_DOMAIN}:sha256:`,
    RECORD_FIELDS = Object.freeze([
      "format",
      "version",
      "algorithm",
      "nonce",
      "ciphertext",
    ]),
    CONTEXT_FIELDS = Object.freeze(["syncedPocketId"]),
    BASE64URL_PATTERN = /^[A-Za-z0-9_-]+$/;
  const textEncoder = new global.TextEncoder(),
    textDecoder = new global.TextDecoder("utf-8", { fatal: true });

  function objectError(code) {
    const error = new Error(`Pocket Starling crypto ${code}.`);
    error.code = code;
    return error;
  }

  function exactObject(value, fields, code) {
    if (
      !value ||
      typeof value !== "object" ||
      Array.isArray(value) ||
      Object.keys(value).length !== fields.length ||
      !fields.every((field) =>
        Object.prototype.hasOwnProperty.call(value, field),
      )
    )
      throw objectError(code);
    return value;
  }

  function syncCrypto() {
    const api = global.PocketSyncCrypto;
    if (
      !api ||
      !api.FORMAT ||
      typeof api.encodeBase64Url !== "function" ||
      typeof api.validateNonExtractableAesKey !== "function"
    )
      throw objectError("sync-crypto-unavailable");
    return api;
  }

  function webCrypto() {
    const api = global.crypto;
    if (!api || !api.subtle || typeof api.getRandomValues !== "function")
      throw objectError("web-crypto-unavailable");
    return api;
  }

  function validateContext(input) {
    const context = exactObject(
      input,
      CONTEXT_FIELDS,
      "object-context-invalid",
    );
    if (
      typeof context.syncedPocketId !== "string" ||
      context.syncedPocketId.length < 1 ||
      context.syncedPocketId.length > 160 ||
      context.syncedPocketId !== context.syncedPocketId.trim()
    )
      throw objectError("object-context-invalid");
    return Object.freeze({ syncedPocketId: context.syncedPocketId });
  }

  function decodeBase64Url(value) {
    if (
      typeof value !== "string" ||
      !value ||
      !BASE64URL_PATTERN.test(value) ||
      value.length % 4 === 1
    )
      throw objectError("object-record-invalid");
    let binary;
    try {
      const normalised = value.replace(/-/g, "+").replace(/_/g, "/"),
        padded = normalised.padEnd(Math.ceil(normalised.length / 4) * 4, "=");
      binary = global.atob(padded);
    } catch (_error) {
      throw objectError("object-record-invalid");
    }
    const bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index += 1)
      bytes[index] = binary.charCodeAt(index);
    if (syncCrypto().encodeBase64Url(bytes) !== value) {
      bytes.fill(0);
      throw objectError("object-record-invalid");
    }
    return bytes;
  }

  function validateRecord(input) {
    const record = exactObject(input, RECORD_FIELDS, "object-record-invalid");
    if (
      record.format !== OBJECT_FORMAT ||
      record.version !== OBJECT_VERSION ||
      record.algorithm !== OBJECT_ALGORITHM
    )
      throw objectError("object-record-invalid");
    const nonce = decodeBase64Url(record.nonce),
      ciphertext = decodeBase64Url(record.ciphertext),
      format = syncCrypto().FORMAT;
    try {
      if (
        nonce.byteLength !== format.nonceBytes ||
        ciphertext.byteLength < format.tagBytes
      )
        throw objectError("object-record-invalid");
      return Object.freeze({
        format: OBJECT_FORMAT,
        version: OBJECT_VERSION,
        algorithm: OBJECT_ALGORITHM,
        nonce: record.nonce,
        ciphertext: record.ciphertext,
      });
    } finally {
      nonce.fill(0);
      ciphertext.fill(0);
    }
  }

  function buildObjectAad(input) {
    const context = validateContext(input);
    return textEncoder.encode(
      JSON.stringify([
        OBJECT_FORMAT,
        OBJECT_VERSION,
        OBJECT_ALGORITHM,
        context.syncedPocketId,
      ]),
    );
  }

  function canonicalEncryptedRecord(input) {
    const record = validateRecord(input);
    return JSON.stringify([
      REFERENCE_DOMAIN,
      record.format,
      record.version,
      record.algorithm,
      record.nonce,
      record.ciphertext,
    ]);
  }

  async function referenceForRecord(input) {
    const canonical = canonicalEncryptedRecord(input),
      bytes = textEncoder.encode(canonical);
    try {
      const digest = new Uint8Array(
        await webCrypto().subtle.digest("SHA-256", bytes),
      );
      try {
        return REFERENCE_PREFIX + syncCrypto().encodeBase64Url(digest);
      } finally {
        digest.fill(0);
      }
    } catch (error) {
      if (error && error.code) throw error;
      throw objectError("object-reference-failed");
    } finally {
      bytes.fill(0);
    }
  }

  function randomNonce() {
    const format = syncCrypto().FORMAT,
      nonce = new Uint8Array(format.nonceBytes);
    try {
      webCrypto().getRandomValues(nonce);
      return nonce;
    } catch (_error) {
      nonce.fill(0);
      throw objectError("random-generation-failed");
    }
  }

  async function sealObject(canonicalBytes, masterKey, contextInput) {
    if (typeof canonicalBytes !== "string" || canonicalBytes.length === 0)
      throw objectError("object-plaintext-invalid");
    const cryptoApi = syncCrypto(),
      key = cryptoApi.validateNonExtractableAesKey(masterKey),
      context = validateContext(contextInput),
      plaintext = textEncoder.encode(canonicalBytes),
      nonce = randomNonce(),
      aad = buildObjectAad(context);
    try {
      const encrypted = await webCrypto().subtle.encrypt(
          {
            name: cryptoApi.FORMAT.webCryptoAlgorithm,
            iv: nonce,
            additionalData: aad,
            tagLength: cryptoApi.FORMAT.tagBits,
          },
          key,
          plaintext,
        ),
        record = validateRecord({
          format: OBJECT_FORMAT,
          version: OBJECT_VERSION,
          algorithm: OBJECT_ALGORITHM,
          nonce: cryptoApi.encodeBase64Url(nonce),
          ciphertext: cryptoApi.encodeBase64Url(new Uint8Array(encrypted)),
        }),
        ref = await referenceForRecord(record);
      return Object.freeze({ record, ref });
    } catch (error) {
      if (error && error.code) throw error;
      throw objectError("object-encryption-failed");
    } finally {
      plaintext.fill(0);
      nonce.fill(0);
      aad.fill(0);
    }
  }

  async function openObject(input, ref, masterKey, contextInput) {
    const record = validateRecord(input),
      expectedRef = await referenceForRecord(record);
    if (typeof ref !== "string" || ref !== expectedRef)
      throw objectError("object-reference-mismatch");
    const cryptoApi = syncCrypto(),
      key = cryptoApi.validateNonExtractableAesKey(masterKey),
      context = validateContext(contextInput),
      nonce = decodeBase64Url(record.nonce),
      ciphertext = decodeBase64Url(record.ciphertext),
      aad = buildObjectAad(context);
    let plaintext = null;
    try {
      let decrypted;
      try {
        decrypted = await webCrypto().subtle.decrypt(
          {
            name: cryptoApi.FORMAT.webCryptoAlgorithm,
            iv: nonce,
            additionalData: aad,
            tagLength: cryptoApi.FORMAT.tagBits,
          },
          key,
          ciphertext,
        );
      } catch (_error) {
        throw objectError("object-authentication-failed");
      }
      plaintext = new Uint8Array(decrypted);
      try {
        return textDecoder.decode(plaintext);
      } catch (_error) {
        throw objectError("object-plaintext-invalid");
      }
    } finally {
      if (plaintext) plaintext.fill(0);
      nonce.fill(0);
      ciphertext.fill(0);
      aad.fill(0);
    }
  }

  global.PocketStarlingCryptoShadow = Object.freeze({
    OBJECT_FORMAT,
    OBJECT_VERSION,
    OBJECT_ALGORITHM,
    REFERENCE_DOMAIN,
    REFERENCE_PREFIX,
    validateContext,
    validateRecord,
    buildObjectAad,
    canonicalEncryptedRecord,
    referenceForRecord,
    sealObject,
    openObject,
  });
})(typeof window !== "undefined" ? window : globalThis);
