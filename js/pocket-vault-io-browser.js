/* Browser Vault IO: local proof loop for E2EE pipeline.
   Temporary UI uses prompt() for passphrases; later this becomes a calm unlock panel. */

(function initialisePocketVaultBrowserIo(global) {
  "use strict";

  function say(message, tone = "ok", durationMs = 5200) {
    if (typeof global.setStatus === "function") {
      global.setStatus(message, tone, { durationMs });
    } else {
      console.log(message);
    }
  }

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
      say("preparing vault…", "ok", 1800);
      if (!Array.isArray(global.state?.nodes) || global.state.nodes.length === 0) {
        say("Nothing to seal yet.", "warn");
        return false;
      }
      if (!global.PocketVault || typeof global.PocketVault.sealCurrentPocket !== "function") {
        throw new Error("Pocket Vault is not loaded yet.");
      }
      const passphrase = askPassphrase("Choose a Pocket Vault passphrase");
      if (!passphrase) {
        say("Vault save cancelled.", "warn");
        return false;
      }
      const envelope = await global.PocketVault.sealCurrentPocket(passphrase);
      downloadTextFile(vaultFileName(envelope), JSON.stringify(envelope, null, 2));
      say(`vault saved · revision ${envelope.revision}`, "ok", 5200);
      return true;
    } catch (error) {
      console.error(error);
      say(`Vault save failed: ${error.message}`, "warn", 7200);
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
      if (!global.PocketVault || typeof global.PocketVault.openVaultEnvelope !== "function") {
        throw new Error("Pocket Vault is not loaded yet.");
      }
      const raw = await readFileAsText(file);
      const envelope = JSON.parse(raw);
      if (!global.PocketVault.isVaultEnvelope(envelope)) {
        throw new Error("That file is not a Pocket Vault file.");
      }
      const passphrase = askPassphrase("Unlock Pocket Vault passphrase");
      if (!passphrase) {
        say("Vault open cancelled.", "warn");
        return false;
      }
      const payload = await global.PocketVault.openVaultEnvelope(envelope, passphrase);
      const norm = global.normaliseInput(payload);
      global.applyLoadedState(norm, {
        schema: norm.schema,
        fileName: file.name || "pocket.vault.json",
        writtenAt: norm.writtenAt || envelope.createdAt
      }, { clearOps: true, skipLocalSafetyCheck: true });
      say(`vault opened · revision ${envelope.revision}`, "ok", 5200);
      return true;
    } catch (error) {
      console.error(error);
      say(`Vault open failed: ${error.message}`, "warn", 7200);
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

  function closePaletteQuietly() {
    if (typeof global.closeCommandPalette === "function") {
      global.closeCommandPalette({ restoreFocus: false });
    }
  }

  function wireCommandPaletteButtons() {
    const saveBtn = document.getElementById("cmdSaveVault");
    if (saveBtn && saveBtn.dataset.vaultWired !== "1") {
      saveBtn.dataset.vaultWired = "1";
      saveBtn.addEventListener("click", (ev) => {
        ev.preventDefault();
        ev.stopPropagation();
        closePaletteQuietly();
        void saveVaultFromCurrentPocket();
      });
    }

    const openBtn = document.getElementById("cmdOpenVault");
    if (openBtn && openBtn.dataset.vaultWired !== "1") {
      openBtn.dataset.vaultWired = "1";
      openBtn.addEventListener("click", (ev) => {
        ev.preventDefault();
        ev.stopPropagation();
        closePaletteQuietly();
        chooseVaultFile();
      });
    }
  }

  function handleDelegatedVaultClick(ev) {
    const target = ev.target instanceof Element ? ev.target.closest("#cmdSaveVault, #cmdOpenVault") : null;
    if (!target) return;
    ev.preventDefault();
    ev.stopPropagation();
    closePaletteQuietly();
    if (target.id === "cmdSaveVault") void saveVaultFromCurrentPocket();
    if (target.id === "cmdOpenVault") chooseVaultFile();
  }

  function init() {
    wireCommandPaletteButtons();
    document.addEventListener("click", handleDelegatedVaultClick, true);
    // The command palette can be rendered/bound after this file loads, so do a second quiet pass.
    setTimeout(wireCommandPaletteButtons, 250);
    setTimeout(wireCommandPaletteButtons, 1000);
  }

  global.PocketVaultBrowserIo = Object.freeze({
    init,
    saveVaultFromCurrentPocket,
    chooseVaultFile,
    openVaultFile,
    wireCommandPaletteButtons
  });

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init, { once: true });
  } else {
    init();
  }
})(window);
