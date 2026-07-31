/* Content-based inspection for the one Pocket Choose file doorway. */
(function initialisePocketFileOpening(global) {
  "use strict";

  const MAX_FILE_CHARS = 5000000;

  function clean(value, max = 120) {
    return typeof global.cleanText === "function"
      ? global.cleanText(value, max)
      : String(value || "").trim().slice(0, max);
  }

  function isAbort(error) {
    return !!error && (
      error.name === "AbortError"
      || /abort/i.test(String(error.message || ""))
    );
  }

  function pickerOptions() {
    return {
      types: [{
        description: "Pocket file",
        accept: { "application/json": [".json", ".vault"] },
      }],
      multiple: false,
    };
  }

  function classifyParsed(parsed) {
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return { ok: false, kind: "unsupported", reason: "unsupported-content" };
    }
    const looksLikeVault = parsed.kind === global.PocketCrypto?.FORMAT?.kind;
    if (global.PocketCrypto?.isVaultEnvelope?.(parsed) === true) {
      try {
        global.PocketCrypto?.validateEnvelope?.(parsed);
        return { ok: true, kind: "vault", envelope: parsed };
      } catch (_error) {
        return { ok: false, kind: "unsupported", reason: "damaged-vault" };
      }
    }
    if (looksLikeVault) {
      return { ok: false, kind: "unsupported", reason: "damaged-vault" };
    }
    if (global.isPocketPayloadShape?.(parsed) === true) {
      return { ok: true, kind: "json", payload: parsed };
    }
    return { ok: false, kind: "unsupported", reason: "unsupported-content" };
  }

  async function inspectHandle(handle, options = {}) {
    const canContinue = typeof options.canContinue === "function"
      ? options.canContinue
      : () => true;
    if (!handle || typeof handle.getFile !== "function" || !canContinue()) {
      return { ok: false, kind: "unsupported", reason: "candidate-changed" };
    }
    let file;
    let raw = "";
    let parsed;
    try {
      file = await handle.getFile();
      if (!canContinue()) {
        return { ok: false, kind: "unsupported", reason: "candidate-changed" };
      }
      raw = await file.text();
      if (!canContinue()) {
        return { ok: false, kind: "unsupported", reason: "candidate-changed" };
      }
      if (raw.length > MAX_FILE_CHARS) {
        return { ok: false, kind: "unsupported", reason: "file-too-large" };
      }
      parsed = JSON.parse(raw);
    } catch (error) {
      return {
        ok: false,
        kind: "unsupported",
        reason: "read-or-parse-failed",
        error,
      };
    }
    const classified = classifyParsed(parsed);
    return {
      ...classified,
      handle,
      file,
      fileName: clean(file?.name || handle.name || "Pocket file", 120),
      raw,
      parsed,
    };
  }

  async function chooseExistingFile(options = {}) {
    const canContinue = typeof options.canContinue === "function"
      ? options.canContinue
      : () => true;
    if (typeof global.showOpenFilePicker !== "function") {
      return { ok: false, reason: "unsupported" };
    }
    let handle;
    try {
      const handles = await global.showOpenFilePicker(pickerOptions());
      handle = Array.isArray(handles) ? handles[0] : null;
    } catch (error) {
      return {
        ok: false,
        reason: isAbort(error) ? "cancelled" : "picker-failed",
        error,
      };
    }
    if (!handle || !canContinue()) {
      return { ok: false, reason: handle ? "candidate-changed" : "cancelled" };
    }
    return inspectHandle(handle, { canContinue });
  }

  async function openSelectedHandle(handle, options = {}) {
    const sourceSession = options.sourceSession
      || global.capturePocketFileSaveSession?.()
      || null;
    const canContinue = () => (
      global.isPocketFileSaveSessionCurrent?.(sourceSession) === true
      && global.PocketVaultRecovery?.isFlowOpen?.() !== true
      && global.isPocketFilePermissionPromptOpen?.() !== true
      && global.isPocketDeviceChangesDecisionOpen?.() !== true
    );
    const inspected = options.inspected?.handle === handle
      ? options.inspected
      : await inspectHandle(handle, { canContinue });
    if (!canContinue()) return false;
    if (!inspected.ok) {
      global.setStatus?.(
        inspected.reason === "damaged-vault"
          ? "That encrypted Vault is damaged or unsupported. Nothing was opened or written."
          : "That file is not a supported Pocket JSON or encrypted Vault. Nothing was opened or written.",
        "warn",
        { durationMs: 7200 }
      );
      return false;
    }
    if (inspected.kind === "vault") {
      return await global.PocketVaultBrowserIo?.openVaultFile?.(handle, sourceSession) === true;
    }
    return await global.loadFromFileHandle?.(handle, {
      displayName: inspected.fileName,
      sourceSession,
    }) === true;
  }

  async function chooseAndOpen() {
    const sourceSession = global.capturePocketFileSaveSession?.();
    const canContinue = () => (
      !!sourceSession
      && global.isPocketFileSaveSessionCurrent?.(sourceSession) === true
    );
    const inspected = await chooseExistingFile({ canContinue });
    if (!inspected.ok) {
      if (inspected.reason !== "cancelled" && inspected.reason !== "candidate-changed") {
        global.setStatus?.(
          inspected.reason === "damaged-vault"
            ? "That encrypted Vault is damaged or unsupported. Nothing was opened or written."
            : "That file is not a supported Pocket JSON or encrypted Vault. Nothing was opened or written.",
          "warn",
          { durationMs: 7200 }
        );
      }
      return false;
    }
    return openSelectedHandle(inspected.handle, {
      sourceSession,
      inspected,
    });
  }

  global.PocketFileOpening = Object.freeze({
    MAX_FILE_CHARS,
    pickerOptions,
    classifyParsed,
    inspectHandle,
    chooseExistingFile,
    openSelectedHandle,
    chooseAndOpen,
  });
})(typeof window !== "undefined" ? window : globalThis);
