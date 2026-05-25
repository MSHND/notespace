/* pocket crypto foundation

Purpose:
- Keep encryption separate from storage and UI.
- Keep browser and future Electron implementations behind the same small API.
- Store only encrypted envelopes when cloud sync is added later.

API target:
window.PocketCrypto.encryptJson(value, passphrase)
window.PocketCrypto.decryptJson(envelope, passphrase)
window.PocketCrypto.isEncryptedPocketEnvelope(value)

Format target:
{
  kind: "pocket.encrypted",
  version: 1,
  createdAt: ISO timestamp,
  crypto: {
    cipher: "AES-GCM",
    kdf: "PBKDF2-SHA-256",
    iterations: 310000,
    salt: base64url,
    iv: base64url,
    encoding: "base64url"
  },
  payload: base64url
}

Implementation note:
The browser build should use Web Crypto. The later Electron build can provide an equivalent bridge without changing pocket UI/actions.
*/

(function initialisePocketCrypto(global) {
  "use strict";

  const FORMAT = Object.freeze({
    kind: "pocket.encrypted",
    version: 1,
    cipher: "AES-GCM",
    kdf: "PBKDF2-SHA-256",
    iterations: 310000,
    encoding: "base64url"
  });

  function notWiredYet() {
    throw new Error("Pocket crypto foundation is present but not wired yet.");
  }

  function isEncryptedPocketEnvelope(value) {
    return !!value && typeof value === "object" && value.kind === FORMAT.kind && Number(value.version) === FORMAT.version;
  }

  global.PocketCrypto = Object.freeze({
    FORMAT,
    encryptJson: notWiredYet,
    decryptJson: notWiredYet,
    isEncryptedPocketEnvelope
  });
})(window);
