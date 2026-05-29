/* Final editor route override.
   User-facing edit actions open the standalone node popout editor directly. */
(function initialisePocketNodeEditorRoute(global) {
  "use strict";

  function clean(value, max) {
    const limit = max || 80;
    return typeof cleanText === "function" ? cleanText(value, limit) : String(value || "").trim().slice(0, limit);
  }

  function nodeById(id) {
    return id && typeof nodeMap === "function" ? nodeMap().get(id) || null : null;
  }

  function selectedNode(id) {
    const nodeId = clean(id || global.state?.selectedId || global.state?.detailsEdit?.id, 80);
    return nodeById(nodeId);
  }

  function hideOldEditor() {
    const overlay = document.getElementById("detailOverlay");
    if (overlay instanceof HTMLElement) overlay.hidden = true;
  }

  function rowIdFromEvent(ev) {
    const target = ev.target instanceof HTMLElement ? ev.target : null;
    const row = target ? target.closest("[data-node-id]") : null;
    return row instanceof HTMLElement ? clean(row.getAttribute("data-node-id"), 80) : "";
  }

  function openNodeEditor(id) {
    const node = selectedNode(id);
    if (!node) {
      if (typeof setStatus === "function") setStatus("Select an item first.", "warn");
      return false;
    }
    if (!global.PocketNodePopoutEditor || typeof global.PocketNodePopoutEditor.open !== "function") {
      if (typeof setStatus === "function") setStatus("Node editor is not available yet. Refresh and try again.", "warn");
      return false;
    }
    if (global.state) {
      global.state.selectedId = node.id;
      if (global.state.detailsEdit) global.state.detailsEdit.id = "";
    }
    hideOldEditor();
    const ok = global.PocketNodePopoutEditor.open(node.id);
    setTimeout(hideOldEditor, 0);
    setTimeout(hideOldEditor, 120);
    console.info("[node editor route] opened", { ok, id: node.id, label: clean(node.label, 80) });
    return ok;
  }

  function eat(ev, id) {
    if (ev) {
      ev.preventDefault();
      ev.stopPropagation();
      ev.stopImmediatePropagation();
    }
    if (typeof closeCommandPalette === "function") closeCommandPalette({ restoreFocus: false });
    if (typeof closeRowMiniMenu === "function") closeRowMiniMenu({ restoreFocus: false });
    return openNodeEditor(id);
  }

  document.addEventListener("click", function (ev) {
    const target = ev.target instanceof HTMLElement ? ev.target : null;
    if (!target) return;
    const rowId = rowIdFromEvent(ev);
    const menuButton = target.closest(".rowMiniMenuBtn");
    const isEdit = target.closest("#btnOpenPrimary") || target.closest("#cmdEdit") || target.closest("#btnDetailPopout") || (menuButton && clean(menuButton.textContent, 40).toLowerCase().startsWith("edit"));
    if (!isEdit) return;
    if (rowId && global.state) global.state.selectedId = rowId;
    eat(ev, rowId);
  }, true);

  document.addEventListener("dblclick", function (ev) {
    const rowId = rowIdFromEvent(ev);
    if (!rowId) return;
    if (global.state) global.state.selectedId = rowId;
    eat(ev, rowId);
  }, true);

  document.addEventListener("keydown", function (ev) {
    if (ev.key !== "Enter" || ev.metaKey || ev.ctrlKey || ev.altKey || ev.shiftKey) return;
    if (global.state?.moveMode || global.state?.inlineEdit?.id || global.pendingPathImport) return;
    const node = selectedNode();
    if (!node) return;
    if (typeof shouldCopyOnSingleClick === "function") {
      const hasKids = typeof sortNodesForParent === "function" ? sortNodesForParent(node.id).length > 0 : false;
      if (shouldCopyOnSingleClick(node, hasKids)) return;
    }
    eat(ev, node.id);
  }, true);

  global.openPocketNodeEditor = openNodeEditor;
  global.openPocketEditor = openNodeEditor;
  global.openDetailsEditorForSelectedNode = function () { return openNodeEditor(global.state?.selectedId); };
  global.openDetailsEditorForNode = function (nodeOrId) { return openNodeEditor(typeof nodeOrId === "object" ? nodeOrId?.id : nodeOrId); };
  hideOldEditor();
  console.info("[node editor route] installed", { hasStandalone: !!global.PocketNodePopoutEditor });
})(window);
