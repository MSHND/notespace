/* phone selected-row menu button and phone menu trimming. */

(function initialisePocketPhoneMenu(global) {
  "use strict";

  function isPhoneMode() {
    return document.body.classList.contains("phoneMode");
  }

  function addPhoneMenuButtonToSelectedRow() {
    if (!isPhoneMode()) return;
    const selectedRow = document.querySelector(".row.selected[data-node-id]");
    if (!(selectedRow instanceof HTMLElement)) return;
    if (selectedRow.querySelector(".phoneRowMenuBtn")) return;

    const button = document.createElement("button");
    button.type = "button";
    button.className = "phoneRowMenuBtn";
    button.textContent = "⋯";
    button.setAttribute("aria-label", "Actions for selected item");
    button.title = "Actions";
    button.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      const nodeId = selectedRow.getAttribute("data-node-id") || "";
      if (!nodeId || typeof global.openRowMiniMenu !== "function") return;
      global.openRowMiniMenu(nodeId, button);
    });
    selectedRow.appendChild(button);
  }

  function removeCopyFromPhoneMenu() {
    if (!isPhoneMode()) return;
    const buttons = Array.from(document.querySelectorAll(".rowMiniMenuBtn"));
    for (const button of buttons) {
      if (!(button instanceof HTMLElement)) continue;
      const label = String(button.textContent || "").toLowerCase();
      if (!label.includes("copy text")) continue;
      const previous = button.previousElementSibling;
      const next = button.nextElementSibling;
      button.remove();
      if (previous instanceof HTMLElement && previous.classList.contains("rowMiniMenuSep") && next instanceof HTMLElement && next.classList.contains("rowMiniMenuSep")) {
        previous.remove();
      }
    }
  }

  function decoratePhoneUi() {
    addPhoneMenuButtonToSelectedRow();
    removeCopyFromPhoneMenu();
  }

  const originalRenderTree = global.renderTree;
  if (typeof originalRenderTree === "function") {
    global.renderTree = function renderTreeWithPhoneMenu() {
      const result = originalRenderTree.apply(this, arguments);
      window.requestAnimationFrame(decoratePhoneUi);
      return result;
    };
  }

  const originalOpenRowMiniMenu = global.openRowMiniMenu;
  if (typeof originalOpenRowMiniMenu === "function") {
    global.openRowMiniMenu = function openRowMiniMenuWithPhoneTrim() {
      const result = originalOpenRowMiniMenu.apply(this, arguments);
      window.requestAnimationFrame(decoratePhoneUi);
      return result;
    };
  }

  document.addEventListener("click", () => window.requestAnimationFrame(decoratePhoneUi), true);
  document.addEventListener("DOMContentLoaded", decoratePhoneUi, { once: true });
  window.PocketPhoneMenu = Object.freeze({ refresh: decoratePhoneUi });
})(window);
