/* Topbar more button: visible doorway to the command palette. */

(function initialisePocketMoreButton(global) {
  "use strict";

  function initMoreButton() {
    const button = document.getElementById("btnMore");
    if (!button) return;
    button.addEventListener("click", () => {
      if (typeof global.openCommandPalette === "function") {
        global.openCommandPalette();
      }
    });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", initMoreButton, { once: true });
  } else {
    initMoreButton();
  }
})(window);
