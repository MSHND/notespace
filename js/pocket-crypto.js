/* pocket crypto foundation

Purpose:
- Keep readable pocket data on-device only.
- Store/sync only Pocket Vault envelopes.
- Keep browser, Electron, and future iOS aligned around one envelope format.
*/

(function initialisePocketCrypto(global) {
  "use strict";

  const FORMAT = Object.freeze({
    kind: "pocket.vault",
    version: 1,
    contentType: "portal.export.v1+json",
    cipher: "AES-GCM",
    kdf: "PBKDF2-SHA-256",
    iterations: 310000,
    saltBytes: 16,
    nonceBytes: 12,
    encoding: "base64url"
  });
  const MAX_VAULT_ID_LENGTH = 160;
  const BASE64URL_PATTERN = /^[A-Za-z0-9_-]+$/;

  const textEncoder = new TextEncoder();
  const textDecoder = new TextDecoder();

  function getCrypto() {
    const cryptoObject = global.crypto;
    if (!cryptoObject || !cryptoObject.subtle) {
      throw new Error("Pocket Vault needs Web Crypto in browser, or a future Electron crypto bridge.");
    }
    return cryptoObject;
  }

  function getRandomBytes(length) {
    const bytes = new Uint8Array(length);
    getCrypto().getRandomValues(bytes);
    return bytes;
  }

  function bytesToBase64Url(bytes) {
    let binary = "";
    for (let i = 0; i < bytes.length; i += 1) binary += String.fromCharCode(bytes[i]);
    return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
  }

  function requireBase64Url(value, label) {
    const text = typeof value === "string" ? value : "";
    if (!text || !BASE64URL_PATTERN.test(text) || text.length % 4 === 1) {
      throw new Error(`Pocket Vault ${label} is not valid base64url data.`);
    }
    return text;
  }

  function base64UrlToBytes(value, label = "data") {
    const text = requireBase64Url(value, label);
    const normalised = text.replace(/-/g, "+").replace(/_/g, "/");
    const padded = normalised.padEnd(Math.ceil(normalised.length / 4) * 4, "=");
    let binary;
    try {
      binary = atob(padded);
    } catch (_error) {
      throw new Error(`Pocket Vault ${label} is not valid base64url data.`);
    }
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
    if (bytesToBase64Url(bytes) !== text) {
      throw new Error(`Pocket Vault ${label} is not canonical base64url data.`);
    }
    return bytes;
  }

  function requirePassphrase(passphrase) {
    const value = String(passphrase || "");
    if (value.length < 8) throw new Error("Pocket Vault passphrase must be at least 8 characters.");
    return value;
  }

  function requireIterations(value) {
    const iterations = Number(value);
    if (!Number.isSafeInteger(iterations) || iterations !== FORMAT.iterations) {
      throw new Error("Unsupported Pocket Vault PBKDF2 settings.");
    }
    return iterations;
  }

  function requireVaultId(value) {
    const vaultId = typeof value === "string" ? value.trim() : "";
    if (!vaultId || vaultId.length > MAX_VAULT_ID_LENGTH) {
      throw new Error("Pocket Vault identity is missing or invalid.");
    }
    return vaultId;
  }

  function requireRevision(value, options = {}) {
    const minimum = options.allowZero === true ? 0 : 1;
    const revision = Number(value);
    if (!Number.isSafeInteger(revision) || revision < minimum) {
      throw new Error("Pocket Vault revision is missing or invalid.");
    }
    return revision;
  }

  function requireCreatedAt(value) {
    const createdAt = typeof value === "string" ? value.trim() : "";
    if (!createdAt || createdAt.length > 80 || !Number.isFinite(Date.parse(createdAt))) {
      throw new Error("Pocket Vault creation time is missing or invalid.");
    }
    return createdAt;
  }

  async function deriveVaultKey(passphrase, salt, iterations) {
    const cryptoObject = getCrypto();
    let rawPassphrase = requirePassphrase(passphrase);
    passphrase = "";
    const passphraseBytes = textEncoder.encode(rawPassphrase);
    rawPassphrase = "";
    let baseKey;
    try {
      baseKey = await cryptoObject.subtle.importKey(
        "raw",
        passphraseBytes,
        "PBKDF2",
        false,
        ["deriveKey"]
      );
    } finally {
      passphraseBytes.fill(0);
    }
    return cryptoObject.subtle.deriveKey(
      { name: "PBKDF2", salt, iterations: requireIterations(iterations), hash: "SHA-256" },
      baseKey,
      { name: "AES-GCM", length: 256 },
      false,
      ["encrypt", "decrypt"]
    );
  }

  function requireUnlockedKey(session) {
    const key = session && session.cryptoKey;
    const usages = key && key.usages ? Array.from(key.usages) : [];
    if (!key
        || key.type !== "secret"
        || key.extractable !== false
        || key.algorithm?.name !== FORMAT.cipher
        || Number(key.algorithm?.length) !== 256
        || !usages.includes("encrypt")
        || !usages.includes("decrypt")) {
      throw new Error("Pocket Vault is not unlocked with a supported non-extractable key.");
    }
    return key;
  }

  function parseEnvelope(envelopeOrText) {
    let envelope = envelopeOrText;
    if (typeof envelopeOrText === "string") {
      try {
        envelope = JSON.parse(envelopeOrText);
      } catch (_error) {
        throw new Error("This is not a supported Pocket Vault file.");
      }
    }
    if (!envelope || typeof envelope !== "object" || Array.isArray(envelope)
        || envelope.kind !== FORMAT.kind
        || Number(envelope.version) !== FORMAT.version) {
      throw new Error("This is not a supported Pocket Vault file.");
    }
    if (envelope.contentType !== FORMAT.contentType) {
      throw new Error("Unsupported Pocket Vault content type.");
    }
    const meta = envelope.crypto;
    if (!meta || typeof meta !== "object" || Array.isArray(meta)
        || meta.cipher !== FORMAT.cipher
        || meta.kdf !== FORMAT.kdf
        || meta.encoding !== FORMAT.encoding) {
      throw new Error("Unsupported Pocket Vault crypto settings.");
    }
    const iterations = requireIterations(meta.iterations);
    const saltText = requireBase64Url(meta.salt, "salt");
    const nonceText = requireBase64Url(meta.nonce, "nonce");
    const salt = base64UrlToBytes(saltText, "salt");
    const nonce = base64UrlToBytes(nonceText, "nonce");
    if (salt.length !== FORMAT.saltBytes) {
      throw new Error("Pocket Vault salt has an unsupported length.");
    }
    if (nonce.length !== FORMAT.nonceBytes) {
      throw new Error("Pocket Vault nonce has an unsupported length.");
    }
    const payloadText = requireBase64Url(envelope.payload, "payload");
    return Object.freeze({
      envelope,
      vaultId: requireVaultId(envelope.vaultId),
      revision: requireRevision(envelope.revision),
      createdAt: requireCreatedAt(envelope.createdAt),
      contentType: FORMAT.contentType,
      iterations,
      salt,
      saltText,
      nonce,
      payloadText
    });
  }

  function isVaultEnvelope(value) {
    try {
      parseEnvelope(value);
      return true;
    } catch (_error) {
      return false;
    }
  }

  async function unlockEnvelope(envelopeOrText, passphrase) {
    const parsed = parseEnvelope(envelopeOrText);
    let rawPassphrase = String(passphrase || "");
    passphrase = "";
    let key;
    try {
      key = await deriveVaultKey(rawPassphrase, parsed.salt, parsed.iterations);
    } finally {
      rawPassphrase = "";
    }
    const cryptoObject = getCrypto();
    const plainBuffer = await cryptoObject.subtle.decrypt(
      { name: FORMAT.cipher, iv: parsed.nonce },
      key,
      base64UrlToBytes(parsed.payloadText, "payload")
    );
    let payload;
    try {
      payload = JSON.parse(textDecoder.decode(plainBuffer));
    } catch (_error) {
      throw new Error("Pocket Vault decrypted content is not valid JSON.");
    }
    return Object.freeze({
      payload,
      cryptoKey: key,
      salt: parsed.saltText,
      iterations: parsed.iterations,
      vaultId: parsed.vaultId,
      revision: parsed.revision,
      createdAt: parsed.createdAt,
      contentType: parsed.contentType
    });
  }

  async function createUnlockedSession(passphrase, options = {}) {
    const iterations = requireIterations(options.iterations ?? FORMAT.iterations);
    const salt = getRandomBytes(FORMAT.saltBytes);
    let rawPassphrase = String(passphrase || "");
    passphrase = "";
    let cryptoKey;
    try {
      cryptoKey = await deriveVaultKey(rawPassphrase, salt, iterations);
    } finally {
      rawPassphrase = "";
    }
    return Object.freeze({
      cryptoKey,
      salt: bytesToBase64Url(salt),
      iterations,
      vaultId: requireVaultId(options.vaultId || "default"),
      revision: requireRevision(options.revision ?? 0, { allowZero: true }),
      createdAt: requireCreatedAt(options.createdAt || new Date().toISOString()),
      contentType: FORMAT.contentType
    });
  }

  async function sealWithUnlockedKey(value, session, nextRevision) {
    const cryptoObject = getCrypto();
    const key = requireUnlockedKey(session);
    const vaultId = requireVaultId(session.vaultId);
    const currentRevision = requireRevision(session.revision, { allowZero: true });
    const revision = requireRevision(nextRevision);
    if (currentRevision >= Number.MAX_SAFE_INTEGER || revision !== currentRevision + 1) {
      throw new Error("Pocket Vault revision must advance by exactly one.");
    }
    const iterations = requireIterations(session.iterations);
    const saltText = requireBase64Url(session.salt, "salt");
    const salt = base64UrlToBytes(saltText, "salt");
    if (salt.length !== FORMAT.saltBytes) {
      throw new Error("Pocket Vault salt has an unsupported length.");
    }
    const nonce = getRandomBytes(FORMAT.nonceBytes);
    const plainText = JSON.stringify(value, null, 2);
    if (typeof plainText !== "string") {
      throw new Error("Pocket Vault content could not be serialised.");
    }
    const cipherBuffer = await cryptoObject.subtle.encrypt(
      { name: FORMAT.cipher, iv: nonce },
      key,
      textEncoder.encode(plainText)
    );
    return {
      kind: FORMAT.kind,
      version: FORMAT.version,
      vaultId,
      revision,
      createdAt: requireCreatedAt(session.createdAt),
      contentType: FORMAT.contentType,
      crypto: {
        cipher: FORMAT.cipher,
        kdf: FORMAT.kdf,
        iterations,
        salt: saltText,
        nonce: bytesToBase64Url(nonce),
        encoding: FORMAT.encoding
      },
      payload: bytesToBase64Url(new Uint8Array(cipherBuffer))
    };
  }

  async function sealJson(value, passphrase, options = {}) {
    const revision = requireRevision(options.revision ?? 1);
    let rawPassphrase = String(passphrase || "");
    passphrase = "";
    let sessionRequest;
    try {
      sessionRequest = createUnlockedSession(rawPassphrase, {
        vaultId: options.vaultId || "default",
        revision: revision - 1,
        iterations: options.iterations ?? FORMAT.iterations
      });
    } finally {
      rawPassphrase = "";
    }
    const session = await sessionRequest;
    return sealWithUnlockedKey(value, session, revision);
  }

  async function openJson(envelopeOrText, passphrase) {
    let rawPassphrase = String(passphrase || "");
    passphrase = "";
    let unlockRequest;
    try {
      unlockRequest = unlockEnvelope(envelopeOrText, rawPassphrase);
    } finally {
      rawPassphrase = "";
    }
    const unlocked = await unlockRequest;
    return unlocked.payload;
  }

  global.PocketCrypto = Object.freeze({
    FORMAT,
    validateEnvelope: parseEnvelope,
    unlockEnvelope,
    createUnlockedSession,
    sealWithUnlockedKey,
    sealJson,
    openJson,
    encryptJson: sealJson,
    decryptJson: openJson,
    isVaultEnvelope,
    isEncryptedPocketEnvelope: isVaultEnvelope
  });
})(window);
