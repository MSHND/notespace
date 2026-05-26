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

  const textEncoder = new TextEncoder();
  const textDecoder = new TextDecoder();

  function getSubtle() {
    const cryptoObject = global.crypto;
    if (!cryptoObject || !cryptoObject.subtle) {
      throw new Error("Pocket Vault needs Web Crypto in browser, or a future Electron crypto bridge.");
    }
    return cryptoObject;
  }

  function getRandomBytes(length) {
    const bytes = new Uint8Array(length);
    getSubtle().getRandomValues(bytes);
    return bytes;
  }

  function bytesToBase64Url(bytes) {
    let binary = "";
    for (let i = 0; i < bytes.length; i += 1) binary += String.fromCharCode(bytes[i]);
    return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
  }

  function base64UrlToBytes(value) {
    const normalised = String(value || "").replace(/-/g, "+").replace(/_/g, "/");
    const padded = normalised.padEnd(Math.ceil(normalised.length / 4) * 4, "=");
    const binary = atob(padded);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
    return bytes;
  }

  function requirePassphrase(passphrase) {
    const value = String(passphrase || "");
    if (value.length < 8) throw new Error("Pocket Vault passphrase must be at least 8 characters.");
    return value;
  }

  async function deriveVaultKey(passphrase, salt, iterations) {
    const cryptoObject = getSubtle();
    const baseKey = await cryptoObject.subtle.importKey(
      "raw",
      textEncoder.encode(requirePassphrase(passphrase)),
      "PBKDF2",
      false,
      ["deriveKey"]
    );
    return cryptoObject.subtle.deriveKey(
      { name: "PBKDF2", salt, iterations, hash: "SHA-256" },
      baseKey,
      { name: "AES-GCM", length: 256 },
      false,
      ["encrypt", "decrypt"]
    );
  }

  function buildHeader(options = {}) {
    return {
      kind: FORMAT.kind,
      version: FORMAT.version,
      vaultId: String(options.vaultId || "default"),
      revision: Number.isFinite(Number(options.revision)) ? Number(options.revision) : 1,
      createdAt: new Date().toISOString(),
      contentType: FORMAT.contentType
    };
  }

  async function sealJson(value, passphrase, options = {}) {
    const cryptoObject = getSubtle();
    const salt = getRandomBytes(FORMAT.saltBytes);
    const nonce = getRandomBytes(FORMAT.nonceBytes);
    const iterations = Number(options.iterations || FORMAT.iterations);
    const header = buildHeader(options);
    const key = await deriveVaultKey(passphrase, salt, iterations);
    const plainText = JSON.stringify(value, null, 2);
    const cipherBuffer = await cryptoObject.subtle.encrypt(
      { name: "AES-GCM", iv: nonce },
      key,
      textEncoder.encode(plainText)
    );

    return {
      ...header,
      crypto: {
        cipher: FORMAT.cipher,
        kdf: FORMAT.kdf,
        iterations,
        salt: bytesToBase64Url(salt),
        nonce: bytesToBase64Url(nonce),
        encoding: FORMAT.encoding
      },
      payload: bytesToBase64Url(new Uint8Array(cipherBuffer))
    };
  }

  async function openJson(envelopeOrText, passphrase) {
    const envelope = typeof envelopeOrText === "string" ? JSON.parse(envelopeOrText) : envelopeOrText;
    if (!isVaultEnvelope(envelope)) throw new Error("This is not a supported Pocket Vault file.");
    const meta = envelope.crypto || {};
    if (meta.cipher !== FORMAT.cipher || meta.kdf !== FORMAT.kdf) {
      throw new Error("Unsupported Pocket Vault crypto settings.");
    }
    const cryptoObject = getSubtle();
    const key = await deriveVaultKey(passphrase, base64UrlToBytes(meta.salt), Number(meta.iterations));
    const plainBuffer = await cryptoObject.subtle.decrypt(
      { name: "AES-GCM", iv: base64UrlToBytes(meta.nonce) },
      key,
      base64UrlToBytes(envelope.payload)
    );
    return JSON.parse(textDecoder.decode(plainBuffer));
  }

  function isVaultEnvelope(value) {
    return !!value && typeof value === "object" && value.kind === FORMAT.kind && Number(value.version) === FORMAT.version;
  }

  global.PocketCrypto = Object.freeze({
    FORMAT,
    sealJson,
    openJson,
    encryptJson: sealJson,
    decryptJson: openJson,
    isVaultEnvelope,
    isEncryptedPocketEnvelope: isVaultEnvelope
  });
})(window);
