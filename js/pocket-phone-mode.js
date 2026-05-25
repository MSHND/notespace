/* phone mode toggle: intentionally manual and persisted locally. */

(function initialisePocketPhoneMode(global) {
  "use strict";

  const STORAGE_KEY = "pocket.phoneMode.v1";

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

  function setPhoneMode(enabled) {
    document.body.classList.toggle("phoneMode", enabled);
    saveMode(enabled);
    syncButton(document.getElementById("btnPhoneMode"), enabled);
  }

  function togglePhoneMode() {
    setPhoneMode(!document.body.classList.contains("phoneMode"));
  }

  function initPhoneMode() {
    const button = document.getElementById("btnPhoneMode");
    if (button) button.addEventListener("click", togglePhoneMode);
    setPhoneMode(readSavedMode());
  }

  global.PocketPhoneMode = Object.freeze({
    init: initPhoneMode,
    set: setPhoneMode,
    toggle: togglePhoneMode
  });

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", initPhoneMode, { once: true });
  } else {
    initPhoneMode();
  }
})(window);
