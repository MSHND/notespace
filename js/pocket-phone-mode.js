/* Legacy manual phone mode remains available to responsive code, but its
   toolbar switch is no longer part of the normal shell. */

(function initialisePocketPhoneMode(global) {
  "use strict";

  const STORAGE_KEY = "pocket.phoneMode.v1";
  const REVIEW_SEEN_KEY = "pocket.phoneMode.autoRestoreSeen.v1";

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
      const save = document.getElementById("btnExportTree");
      const topbar = document.querySelector(".topbar");
      if (!topbar) return null;
      more = document.createElement("button");
      more.id = "btnMore";
      more.className = "chip utilityChip";
      more.type = "button";
      more.textContent = "⋯";
      more.setAttribute("aria-label", "More Pocket actions");
      if (save) save.insertAdjacentElement("afterend", more);
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

  function shouldReviewLocalPhoneChanges() {
    if (!document.body.classList.contains("phoneMode")) return false;
    if (typeof global.canShowPocketTree !== "function" || !global.canShowPocketTree()) return false;
    if (typeof global.readLocalSafetySnapshot !== "function") return false;
    if (typeof global.reviewCurrentPocketDeviceChanges !== "function") return false;
    return !!global.readLocalSafetySnapshot();
  }

  function maybeReviewLocalPhoneChanges() {
    if (!shouldReviewLocalPhoneChanges()) return false;
    const opened = global.reviewCurrentPocketDeviceChanges({ origin: "phone-mode" });
    if (opened) {
      try { global.localStorage.setItem(REVIEW_SEEN_KEY, new Date().toISOString()); } catch (_error) {}
    }
    return opened;
  }

  function setPhoneMode(enabled) {
    document.body.classList.toggle("phoneMode", enabled);
    saveMode(enabled);
    syncButton(document.getElementById("btnPhoneMode"), enabled);
    ensureMoreButton();
    if (enabled) {
      requestAnimationFrame(() => maybeReviewLocalPhoneChanges());
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
    maybeReviewLocalPhoneChanges,
    ensureMoreButton
  });

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", initPhoneMode, { once: true });
  } else {
    initPhoneMode();
  }
})(window);
