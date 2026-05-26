/* Browser Vault IO: local proof loop for E2EE pipeline.
   Temporary UI uses prompt() for passphrases; later this becomes a calm unlock panel. */

(function initialisePocketVaultBrowserIo(global) {
  "use strict";

  function downloadTextFile(fileName, text, mimeType = "application/json") {
    const blob = new Blob([text], { type: `${mimeType};charset=utf-8` });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = fileName;
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  function askPassphrase(label) {
    const value = global.prompt(label || "Pocket Vault passphrase");
    return value == null ? "" : String(value);
  }

  function vaultFileName(envelope) {
    const revision = Number(envelope?.revision || 0) || 1;
    return `pocket.vault.r${String(revision).padStart(3, "0")}.json`;
  }

  async function saveVaultFromCurrentPocket() {
    try {
      if (!Array.isArray(global.state?.nodes) || global.state.nodes.length === 0) {
        if (typeof global.setStatus === "function") global.setStatus("Nothing to seal yet.", "warn");
        return false;
      }
      const passphrase = askPassphrase("Choose a Pocket Vault passphrase");
      if (!passphrase) {
        if (typeof global.setStatus === "function") global.setStatus("Vault save cancelled.", "warn");
        return false;
      }
      const envelope = await global.PocketVault.sealCurrentPocket(passphrase);
      downloadTextFile(vaultFileName(envelope), JSON.stringify(envelope, null, 2));
      if (typeof global.setStatus === "function") {
        global.setStatus(`vault saved · revision ${envelope.revision}`, "ok", { durationMs: 5200 });
      }
      return true;
    } catch (error) {
      console.error(error);
      if (typeof global.setStatus === "function") global.setStatus(`Vault save failed: ${error.message}`, "warn", { durationMs: 7200 });
      return false;
    }
  }

  function readFileAsText(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result || ""));
      reader.onerror = () => reject(reader.error || new Error("Could not read vault file."));
      reader.readAsText(file);
    });
  }

  async function openVaultFile(file) {
    try {
      if (!file) return false;
      const raw = await readFileAsText(file);
      const envelope = JSON.parse(raw);
      if (!global.PocketVault.isVaultEnvelope(envelope)) {
        throw new Error("That file is not a Pocket Vault file.");
      }
      const passphrase = askPassphrase("Unlock Pocket Vault passphrase");
      if (!passphrase) {
        if (typeof global.setStatus === "function") global.setStatus("Vault open cancelled.", "warn");
        return false;
      }
      const payload = await global.PocketVault.openVaultEnvelope(envelope, passphrase);
      const norm = global.normaliseInput(payload);
      global.applyLoadedState(norm, {
        schema: norm.schema,
        fileName: file.name || "pocket.vault.json",
        writtenAt: norm.writtenAt || envelope.createdAt
      }, { clearOps: true, skipLocalSafetyCheck: true });
      if (typeof global.setStatus === "function") {
        global.setStatus(`vault opened · revision ${envelope.revision}`, "ok", { durationMs: 5200 });
      }
      return true;
    } catch (error) {
      console.error(error);
      if (typeof global.setStatus === "function") global.setStatus(`Vault open failed: ${error.message}`, "warn", { durationMs: 7200 });
      return false;
    }
  }

  function chooseVaultFile() {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = ".json,application/json";
    input.addEventListener("change", () => openVaultFile(input.files && input.files[0]));
    input.click();
  }

  function wireCommandPaletteButtons() {
    const saveBtn = document.getElementById("cmdSaveVault");
    if (saveBtn) saveBtn.addEventListener("click", () => {
      if (typeof global.closeCommandPalette === "function") global.closeCommandPalette();
      saveVaultFromCurrentPocket();
    });

    const openBtn = document.getElementById("cmdOpenVault");
    if (openBtn) openBtn.addEventListener("click", () => {
      if (typeof global.closeCommandPalette === "function") global.closeCommandPalette();
      chooseVaultFile();
    });
  }

  function init() {
    wireCommandPaletteButtons();
  }

  global.PocketVaultBrowserIo = Object.freeze({
    init,
    saveVaultFromCurrentPocket,
    chooseVaultFile,
    openVaultFile
  });

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init, { once: true });
  } else {
    init();
  }
})(window);
