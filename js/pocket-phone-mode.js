/* phone mode toggle: intentionally manual and persisted locally.
   Also injects topbar more if an older cached index.html does not include it. */

(function initialisePocketPhoneMode(global) {
  "use strict";

  const STORAGE_KEY = "pocket.phoneMode.v1";
  const AUTO_RESTORE_KEY = "pocket.phoneMode.autoRestoreSeen.v1";

  function readSavedMode() {
    try {
      return global.localStorage.getItem(STORAGE_KEY) === "1";
    } catch (_error) {
      return false;
    }
  }

  function saveMode(enabled) {
    try {
      global.localStorage.setItem(STORAGE_KEY, enabled ? "1" : "0");
    } catch (_error) {
      // Non-essential preference; ignore blocked storage.
    }
  }

  function syncButton(button, enabled) {
    if (!button) return;
    button.classList.toggle("on", enabled);
    button.setAttribute("aria-pressed", enabled ? "true" : "false");
    button.title = enabled ? "Leave phone mode" : "Use phone mode";
  }

  function ensureMoreButton() {
    let more = document.getElementById("btnMore");
    if (!more) {
      const phone = document.getElementById("btnPhoneMode");
      const pip = document.getElementById("btnPip");
      const topbar = document.querySelector(".topbar");
      if (!topbar) return null;
      more = document.createElement("button");
      more.id = "btnMore";
      more.className = "chip utilityChip";
      more.type = "button";
      more.textContent = "more";
      more.setAttribute("aria-label", "More pocket actions");
      if (phone) phone.insertAdjacentElement("afterend", more);
      else if (pip) pip.insertAdjacentElement("afterend", more);
      else topbar.appendChild(more);
    }
    if (more.dataset.moreButtonWired !== "1") {
      more.dataset.moreButtonWired = "1";
      more.addEventListener("click", () => {
        if (typeof global.openCommandPalette === "function") global.openCommandPalette();
        else if (typeof global.setStatus === "function") global.setStatus("More actions are still loading.", "warn", { durationMs: 3200 });
      });
    }
    return more;
  }

  function shouldAutoRestoreLocalPhoneCopy() {
    if (!document.body.classList.contains("phoneMode")) return false;
    if (Array.isArray(global.state?.nodes) && global.state.nodes.length > 0) return false;
    if (typeof global.readLocalSafetySnapshot !== "function") return false;
    if (typeof global.restoreLocalSafetySnapshot !== "function") return false;
    return !!global.readLocalSafetySnapshot();
  }

  function maybeAutoRestoreLocalPhoneCopy() {
    if (!shouldAutoRestoreLocalPhoneCopy()) return false;
    const snapshot = global.readLocalSafetySnapshot();
    const ok = global.restoreLocalSafetySnapshot(snapshot);
    if (ok) {
      try { global.localStorage.setItem(AUTO_RESTORE_KEY, new Date().toISOString()); } catch (_error) {}
      if (typeof global.setStatus === "function") {
        global.setStatus("opened local phone copy", "ok", { durationMs: 4200 });
      }
    }
    return ok;
  }

  function setPhoneMode(enabled) {
    document.body.classList.toggle("phoneMode", enabled);
    saveMode(enabled);
    syncButton(document.getElementById("btnPhoneMode"), enabled);
    ensureMoreButton();
    if (enabled) {
      requestAnimationFrame(() => maybeAutoRestoreLocalPhoneCopy());
    }
  }

  function togglePhoneMode() {
    setPhoneMode(!document.body.classList.contains("phoneMode"));
  }

  function initPhoneMode() {
    ensureMoreButton();
    const button = document.getElementById("btnPhoneMode");
    if (button) button.addEventListener("click", togglePhoneMode);
    setPhoneMode(readSavedMode());
  }

  global.PocketPhoneMode = Object.freeze({
    init: initPhoneMode,
    set: setPhoneMode,
    toggle: togglePhoneMode,
    maybeAutoRestoreLocalPhoneCopy,
    ensureMoreButton
  });

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", initPhoneMode, { once: true });
  } else {
    initPhoneMode();
  }
})(window);
