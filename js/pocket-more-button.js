/* Topbar more button: visible doorway to the command palette.
   Also injects itself if an older cached index.html is missing the button. */

(function initialisePocketMoreButton(global) {
  "use strict";

  function createMoreButton() {
    const button = document.createElement("button");
    button.id = "btnMore";
    button.className = "chip utilityChip";
    button.type = "button";
    button.setAttribute("aria-label", "More pocket actions");
    button.textContent = "more";
    return button;
  }

  function ensureMoreButton() {
    let button = document.getElementById("btnMore");
    if (button) return button;

    const phoneButton = document.getElementById("btnPhoneMode");
    const pipButton = document.getElementById("btnPip");
    const topbar = document.querySelector(".topbar");
    if (!topbar) return null;

    button = createMoreButton();
    if (phoneButton && phoneButton.parentNode) {
      phoneButton.insertAdjacentElement("afterend", button);
    } else if (pipButton && pipButton.parentNode) {
      pipButton.insertAdjacentElement("afterend", button);
    } else {
      topbar.appendChild(button);
    }
    return button;
  }

  function openMoreActions() {
    if (typeof global.openCommandPalette === "function") {
      global.openCommandPalette();
      return;
    }
    if (typeof global.setStatus === "function") {
      global.setStatus("More actions are still loading.", "warn", { durationMs: 3200 });
    }
  }

  function initMoreButton() {
    const button = ensureMoreButton();
    if (!button) return;
    if (button.dataset.moreButtonWired === "1") return;
    button.dataset.moreButtonWired = "1";
    button.addEventListener("click", openMoreActions);
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", initMoreButton, { once: true });
  } else {
    initMoreButton();
  }
})(window);
