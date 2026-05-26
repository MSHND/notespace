/* Local Pocket Vault test actions: save/open encrypted vault files. */

(function initialisePocketVaultLocal(global) {
  "use strict";

  function downloadJsonFile(payload, filename) {
    const blob = new Blob([`${JSON.stringify(payload, null, 2)}\n`], { type: "application/json" });
    const href = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = href;
    anchor.download = filename;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    URL.revokeObjectURL(href);
  }

  function askPassphrase(purpose) {
    const label = purpose || "Pocket Vault passphrase";
    const value = window.prompt(`${label}\n\nUse 8+ characters. This is local-only for now.`);
    return value === null ? "" : String(value);
  }

  async function saveVaultFile() {
    try {
      if (!global.PocketVault || typeof global.PocketVault.sealCurrentPocket !== "function") {
        throw new Error("Pocket Vault is not ready yet.");
      }
      if (!Array.isArray(global.state?.nodes) || global.state.nodes.length === 0) {
        if (typeof global.setStatus === "function") global.setStatus("Open or create a pocket first.", "warn");
        return false;
      }
      const passphrase = askPassphrase("Set a passphrase for this encrypted pocket vault");
      if (!passphrase) {
        if (typeof global.setStatus === "function") global.setStatus("Vault save cancelled.", "warn");
        return false;
      }
      const envelope = await global.PocketVault.sealCurrentPocket(passphrase);
      const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
      downloadJsonFile(envelope, `pocket-vault-${stamp}.json`);
      if (typeof global.setStatus === "function") {
        global.setStatus(`Vault saved · revision ${envelope.revision}`, "ok", { durationMs: 5200 });
      }
      return true;
    } catch (error) {
      if (typeof global.setStatus === "function") {
        global.setStatus(`Vault save failed: ${error && error.message ? error.message : "unknown error"}`, "warn", { durationMs: 7000 });
      }
      return false;
    }
  }

  function chooseVaultFile() {
    return new Promise((resolve) => {
      const input = document.createElement("input");
      input.type = "file";
      input.accept = ".json,application/json";
      input.hidden = true;
      input.addEventListener("change", () => {
        const file = input.files && input.files[0] ? input.files[0] : null;
        input.remove();
        resolve(file);
      }, { once: true });
      document.body.appendChild(input);
      input.click();
    });
  }

  async function openVaultFile() {
    try {
      if (!global.PocketVault || typeof global.PocketVault.openVaultEnvelope !== "function") {
        throw new Error("Pocket Vault is not ready yet.");
      }
      const file = await chooseVaultFile();
      if (!file) {
        if (typeof global.setStatus === "function") global.setStatus("Vault open cancelled.", "warn");
        return false;
      }
      const raw = await file.text();
      const envelope = JSON.parse(raw);
      if (!global.PocketVault.isVaultEnvelope(envelope)) {
        throw new Error("Selected file is not a Pocket Vault.");
      }
      const passphrase = askPassphrase("Unlock this pocket vault");
      if (!passphrase) {
        if (typeof global.setStatus === "function") global.setStatus("Vault open cancelled.", "warn");
        return false;
      }
      const payload = await global.PocketVault.openVaultEnvelope(envelope, passphrase);
      const norm = global.normaliseInput(payload);
      global.applyLoadedState(norm, {
        schema: "pocket.vault.v1",
        fileName: file.name || "pocket vault",
        writtenAt: envelope.createdAt || payload.writtenAt || ""
      }, { clearOps: true, skipLocalSafetyCheck: true });
      if (typeof global.setStatus === "function") {
        global.setStatus(`Vault opened · revision ${envelope.revision}`, "ok", { durationMs: 5200 });
      }
      return true;
    } catch (error) {
      if (typeof global.setStatus === "function") {
        global.setStatus(`Vault open failed: ${error && error.message ? error.message : "unknown error"}`, "warn", { durationMs: 7000 });
      }
      return false;
    }
  }

  function makeCommandButton(label, hint, action) {
    const button = document.createElement("button");
    button.className = "commandBtn";
    button.type = "button";
    const text = document.createElement("span");
    text.textContent = label;
    const hintEl = document.createElement("span");
    hintEl.className = "commandHint";
    hintEl.textContent = hint;
    button.appendChild(text);
    button.appendChild(hintEl);
    button.addEventListener("click", () => {
      if (typeof global.closeCommandPalette === "function") global.closeCommandPalette({ restoreFocus: false });
      void action();
    });
    return button;
  }

  function injectVaultCommands() {
    const card = document.querySelector(".commandCard");
    if (!card || document.getElementById("cmdSaveVault")) return false;
    const saveButton = makeCommandButton("save vault", "encrypted", saveVaultFile);
    saveButton.id = "cmdSaveVault";
    const openButton = makeCommandButton("open vault", "encrypted", openVaultFile);
    openButton.id = "cmdOpenVault";
    card.appendChild(saveButton);
    card.appendChild(openButton);
    return true;
  }

  function init() {
    injectVaultCommands();
  }

  global.PocketVaultLocal = Object.freeze({
    init,
    saveVaultFile,
    openVaultFile,
    injectVaultCommands
  });

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init, { once: true });
  } else {
    init();
  }
})(window);
