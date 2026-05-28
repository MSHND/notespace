/* Popout node guard.
   Before opening popout, ensure the normal detail editor is showing the currently selected node. */

(function initialisePocketEditorPopoutNodeGuard(global) {
  "use strict";

  function clean(value, max = 80) {
    return typeof cleanText === "function" ? cleanText(value, max) : String(value || "").trim().slice(0, max);
  }

  function detailEditorIsDirty() {
    return typeof hasUnsavedDetailsEditorChanges === "function" && hasUnsavedDetailsEditorChanges();
  }

  function ensurePopoutUsesSelectedNode(ev) {
    const selectedId = clean(global.state?.selectedId, 80);
    const detailId = clean(global.state?.detailsEdit?.id, 80);
    if (!selectedId || !detailId || selectedId === detailId) return;

    if (detailEditorIsDirty()) {
      const switchNode = global.confirm(
        "The detail editor still has unsaved changes for another item.\n\n" +
        "OK: switch popout to the selected item\n" +
        "Cancel: stay with the current editor item"
      );
      if (!switchNode) {
        ev.preventDefault();
        ev.stopPropagation();
        ev.stopImmediatePropagation();
        if (typeof setStatus === "function") setStatus("Popout stayed with the current editor item.", "warn", { durationMs: 3600 });
        return;
      }
    }

    if (typeof closeDetailsEditor === "function") {
      closeDetailsEditor({ restoreFocus: false, revertDraft: false, nodeId: selectedId });
    }
    if (typeof openDetailsEditorForSelectedNode === "function") {
      openDetailsEditorForSelectedNode();
    }
    if (typeof PocketDetailDirtyState?.refresh === "function") requestAnimationFrame(PocketDetailDirtyState.refresh);
  }

  function init() {
    const button = document.getElementById("btnDetailPopout");
    if (!button) return;
    button.addEventListener("click", ensurePopoutUsesSelectedNode, true);
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init, { once: true });
  else init();
})(window);
