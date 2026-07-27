/* Pocket Vault v1 pipeline seam.

This layer prepares pocket for one encrypted source of truth without choosing a
sync backend. Vault identity, revision and unlocked keys are owned by the exact
in-memory Vault session, never by origin-global browser storage.
*/

(function initialisePocketVault(global) {
  "use strict";

  let activeUnlockedSession = null;
  const activeSessionRollbacks = new WeakMap();

  function pocketCrypto() {
    const cryptoOwner = global.PocketCrypto;
    if (!cryptoOwner
        || typeof cryptoOwner.unlockEnvelope !== "function"
        || typeof cryptoOwner.createUnlockedSession !== "function"
        || typeof cryptoOwner.sealWithUnlockedKey !== "function") {
      throw new Error("Pocket crypto is not available.");
    }
    return cryptoOwner;
  }

  function createSecureToken(prefix) {
    const cryptoObject = global.crypto;
    if (!cryptoObject || typeof cryptoObject.getRandomValues !== "function") {
      throw new Error("Pocket Vault needs secure browser randomness.");
    }
    if (typeof cryptoObject.randomUUID === "function") {
      return `${prefix}_${cryptoObject.randomUUID().replace(/-/g, "")}`;
    }
    const bytes = new Uint8Array(16);
    cryptoObject.getRandomValues(bytes);
    let hex = "";
    for (const value of bytes) hex += value.toString(16).padStart(2, "0");
    return `${prefix}_${hex}`;
  }

  function createVaultId() {
    return createSecureToken("vault");
  }

  function requireActivatableSession(session) {
    const format = pocketCrypto().FORMAT;
    const key = session && session.cryptoKey;
    const usages = key && key.usages ? Array.from(key.usages) : [];
    const vaultId = typeof session?.vaultId === "string" ? session.vaultId.trim() : "";
    const revision = Number(session?.revision);
    const iterations = Number(session?.iterations);
    const salt = typeof session?.salt === "string" ? session.salt : "";
    const createdAt = typeof session?.createdAt === "string" ? session.createdAt : "";
    if (!key
        || key.type !== "secret"
        || key.extractable !== false
        || key.algorithm?.name !== format.cipher
        || Number(key.algorithm?.length) !== 256
        || !usages.includes("encrypt")
        || !usages.includes("decrypt")
        || !vaultId
        || vaultId.length > 160
        || !Number.isSafeInteger(revision)
        || revision < 0
        || !Number.isSafeInteger(iterations)
        || iterations !== format.iterations
        || !salt
        || !createdAt
        || !Number.isFinite(Date.parse(createdAt))
        || session.contentType !== format.contentType) {
      throw new Error("Pocket Vault unlocked session is missing or invalid.");
    }
    return {
      cryptoKey: key,
      salt,
      iterations,
      vaultId,
      revision,
      createdAt,
      contentType: format.contentType
    };
  }

  function activateUnlockedSession(session) {
    const prepared = requireActivatableSession(session);
    activeUnlockedSession = Object.freeze({
      ...prepared,
      vaultSessionId: createSecureToken("vault_session")
    });
    return activeUnlockedSession;
  }

  function getActiveSession() {
    return activeUnlockedSession;
  }

  function captureActiveSessionIdentity() {
    if (!activeUnlockedSession) return null;
    return Object.freeze({
      vaultSessionId: activeUnlockedSession.vaultSessionId,
      vaultId: activeUnlockedSession.vaultId,
      revision: activeUnlockedSession.revision
    });
  }

  function isActiveSessionIdentityCurrent(identity) {
    return !!activeUnlockedSession
      && !!identity
      && typeof identity === "object"
      && !Array.isArray(identity)
      && identity.vaultSessionId === activeUnlockedSession.vaultSessionId
      && identity.vaultId === activeUnlockedSession.vaultId
      && Number(identity.revision) === activeUnlockedSession.revision;
  }

  function replaceActiveSessionRevision(expectedSessionId, nextRevision) {
    if (!activeUnlockedSession
        || typeof expectedSessionId !== "string"
        || expectedSessionId !== activeUnlockedSession.vaultSessionId) {
      return null;
    }
    const revision = Number(nextRevision);
    if (!Number.isSafeInteger(revision)
        || activeUnlockedSession.revision >= Number.MAX_SAFE_INTEGER
        || revision !== activeUnlockedSession.revision + 1) {
      return null;
    }
    activeUnlockedSession = Object.freeze({
      ...activeUnlockedSession,
      revision
    });
    return activeUnlockedSession;
  }

  function clearActiveSession() {
    const hadSession = !!activeUnlockedSession;
    activeUnlockedSession = null;
    return hadSession;
  }

  function captureActiveSessionForRollback() {
    const token = Object.freeze({});
    activeSessionRollbacks.set(token, activeUnlockedSession);
    return token;
  }

  function restoreActiveSessionForRollback(token) {
    if (!token || !activeSessionRollbacks.has(token)) {
      throw new Error("Pocket could not restore the previous Vault session.");
    }
    activeUnlockedSession = activeSessionRollbacks.get(token);
    activeSessionRollbacks.delete(token);
    return true;
  }

  function buildCurrentPocketPayload() {
    if (typeof global.buildPocketPayload !== "function") {
      throw new Error("Pocket payload builder is not available.");
    }
    return global.buildPocketPayload(new Date().toISOString());
  }

  async function createUnlockedSession(passphrase, options = {}) {
    let rawPassphrase = String(passphrase || "");
    passphrase = "";
    try {
      return pocketCrypto().createUnlockedSession(rawPassphrase, {
        ...options,
        vaultId: options.vaultId || createVaultId()
      });
    } finally {
      rawPassphrase = "";
    }
  }

  async function unlockEnvelope(envelope, passphrase) {
    let rawPassphrase = String(passphrase || "");
    passphrase = "";
    try {
      return pocketCrypto().unlockEnvelope(envelope, rawPassphrase);
    } finally {
      rawPassphrase = "";
    }
  }

  async function sealWithUnlockedKey(payload, session, nextRevision) {
    return pocketCrypto().sealWithUnlockedKey(payload, session, nextRevision);
  }

  async function sealCurrentPocketWithUnlockedKey(session, nextRevision) {
    return sealWithUnlockedKey(buildCurrentPocketPayload(), session, nextRevision);
  }

  async function sealCurrentPocket(passphrase) {
    let rawPassphrase = String(passphrase || "");
    passphrase = "";
    try {
      return global.PocketCrypto.sealJson(buildCurrentPocketPayload(), rawPassphrase, {
        vaultId: createVaultId(),
        revision: 1
      });
    } finally {
      rawPassphrase = "";
    }
  }

  async function openVaultEnvelope(envelope, passphrase) {
    let rawPassphrase = String(passphrase || "");
    passphrase = "";
    try {
      return global.PocketCrypto.openJson(envelope, rawPassphrase);
    } finally {
      rawPassphrase = "";
    }
  }

  function isVaultEnvelope(value) {
    return !!global.PocketCrypto
      && typeof global.PocketCrypto.isVaultEnvelope === "function"
      && global.PocketCrypto.isVaultEnvelope(value);
  }

  /*
  Legacy proof-loop methods remain harmless for callers which still probe them.
  They deliberately neither read nor write pocket.vault.state.v1 and must not be
  used as active Vault ownership or revision authority.
  */
  function readVaultState() {
    return {};
  }

  function writeVaultState(_next) {
    return false;
  }

  function currentVaultId() {
    return "";
  }

  function nextRevision() {
    return 0;
  }

  global.PocketVault = Object.freeze({
    readVaultState,
    writeVaultState,
    currentVaultId,
    nextRevision,
    createVaultId,
    activateUnlockedSession,
    getActiveSession,
    captureActiveSessionIdentity,
    isActiveSessionIdentityCurrent,
    replaceActiveSessionRevision,
    clearActiveSession,
    captureActiveSessionForRollback,
    restoreActiveSessionForRollback,
    buildCurrentPocketPayload,
    createUnlockedSession,
    unlockEnvelope,
    sealWithUnlockedKey,
    sealCurrentPocketWithUnlockedKey,
    sealCurrentPocket,
    openVaultEnvelope,
    isVaultEnvelope
  });
})(window);
