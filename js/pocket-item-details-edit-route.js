/* Route visible Edit actions into the standalone item details editor.
   Keep this late-loading and narrow: no internal pe naming refactor. */
(function initialisePocketItemDetailsEditRoute(global) {
  "use strict";

  console.info("[item details edit route] loaded");

  function clean(value, max = 80) {
    return typeof cleanText === "function"
      ? cleanText(value, max)
      : String(value || "").trim().slice(0, max);
  }

  function selectedIdFromEvent(ev) {
    const target = ev.target instanceof HTMLElement ? ev.target : null;
    const row = target ? target.closest("[data-node-id]") : null;
    const rowId = row instanceof HTMLElement ? clean(row.getAttribute("data-node-id"), 80) : "";
    return rowId
      || clean(global.state?.rowMiniMenuNodeId, 80)
      || clean(global.state?.selectedId, 80);
  }

  function isEditAction(target) {
    if (!(target instanceof HTMLElement)) return false;
    if (target.closest("#cmdEdit") || target.closest("#btnOpenPrimary")) return true;
    const menuButton = target.closest(".rowMiniMenuBtn");
    if (!(menuButton instanceof HTMLElement)) return false;
    const label = clean(menuButton.textContent, 40).toLowerCase();
    return label.startsWith("edit");
  }

  function openItemDetails(ev) {
    const id = selectedIdFromEvent(ev);
    if (!id) return false;
    if (global.state) global.state.selectedId = id;

    ev.preventDefault();
    ev.stopPropagation();
    ev.stopImmediatePropagation();

    if (typeof closeCommandPalette === "function") closeCommandPalette({ restoreFocus: false });
    if (typeof closeRowMiniMenu === "function") closeRowMiniMenu({ restoreFocus: false });

    if (typeof global.openPocketNodeEditor === "function") {
      return !!global.openPocketNodeEditor(id);
    }

    if (typeof global.openPocketEditor === "function") {
      return !!global.openPocketEditor(id);
    }

    if (typeof openDetailsEditorForSelectedNode === "function") {
      return !!openDetailsEditorForSelectedNode();
    }

    if (typeof setStatus === "function") setStatus("Editor is not available yet. Refresh and try again.", "warn");
    return false;
  }

  document.addEventListener("click", (ev) => {
    const target = ev.target instanceof HTMLElement ? ev.target : null;
    if (!isEditAction(target)) return;
    openItemDetails(ev);
  }, true);
})(window);
