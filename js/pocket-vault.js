/* Pocket Vault v1 pipeline seam.

This layer prepares pocket for one source of truth without choosing the sync backend yet.
Readable tree data stays inside pocket state. Anything leaving the device should be a vault envelope.
*/

(function initialisePocketVault(global) {
  "use strict";

  const VAULT_STATE_KEY = "pocket.vault.state.v1";

  function readVaultState() {
    try {
      const parsed = JSON.parse(global.localStorage.getItem(VAULT_STATE_KEY) || "{}");
      return parsed && typeof parsed === "object" ? parsed : {};
    } catch (_error) {
      return {};
    }
  }

  function writeVaultState(next) {
    try {
      global.localStorage.setItem(VAULT_STATE_KEY, JSON.stringify(next || {}, null, 2));
      return true;
    } catch (_error) {
      return false;
    }
  }

  function nextRevision() {
    const current = readVaultState();
    const revision = Number(current.revision || 0) + 1;
    writeVaultState({
      ...current,
      revision,
      updatedAt: new Date().toISOString()
    });
    return revision;
  }

  function currentVaultId() {
    const current = readVaultState();
    if (current.vaultId) return String(current.vaultId);
    const vaultId = `vault_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
    writeVaultState({
      ...current,
      vaultId,
      revision: Number(current.revision || 0),
      createdAt: new Date().toISOString()
    });
    return vaultId;
  }

  function buildCurrentPocketPayload() {
    if (typeof global.buildPocketPayload !== "function") {
      throw new Error("Pocket payload builder is not available.");
    }
    return global.buildPocketPayload(new Date().toISOString());
  }

  async function sealCurrentPocket(passphrase) {
    if (!global.PocketCrypto || typeof global.PocketCrypto.sealJson !== "function") {
      throw new Error("Pocket crypto is not available.");
    }
    return global.PocketCrypto.sealJson(buildCurrentPocketPayload(), passphrase, {
      vaultId: currentVaultId(),
      revision: nextRevision()
    });
  }

  async function openVaultEnvelope(envelope, passphrase) {
    if (!global.PocketCrypto || typeof global.PocketCrypto.openJson !== "function") {
      throw new Error("Pocket crypto is not available.");
    }
    return global.PocketCrypto.openJson(envelope, passphrase);
  }

  function isVaultEnvelope(value) {
    return !!global.PocketCrypto && typeof global.PocketCrypto.isVaultEnvelope === "function" && global.PocketCrypto.isVaultEnvelope(value);
  }

  global.PocketVault = Object.freeze({
    readVaultState,
    writeVaultState,
    currentVaultId,
    nextRevision,
    buildCurrentPocketPayload,
    sealCurrentPocket,
    openVaultEnvelope,
    isVaultEnvelope
  });
})(window);
