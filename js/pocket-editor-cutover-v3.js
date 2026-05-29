/* Editor cutover v3.
   Final, small override: Edit opens node-bound popout only. Inline detail editor is retired. */

(function initialisePocketEditorCutoverV3(global) {
  "use strict";

  const nodeBoundOpen = global.PocketEditorPopoutV2 && typeof global.PocketEditorPopoutV2.open === "function"
    ? global.PocketEditorPopoutV2.open
    : (global.PocketEditorPopout && typeof global.PocketEditorPopout.open === "function" ? global.PocketEditorPopout.open : null);
  const nodeBoundApply = global.PocketEditorPopout && typeof global.PocketEditorPopout.apply === "function"
    ? global.PocketEditorPopout.apply
    : null;

  function clean(value, max = 80) {
    return typeof cleanText === "function" ? cleanText(value, max) : String(value || "").trim().slice(0, max);
  }

  function selectedNode() {
    const id = clean(global.state?.selectedId, 80);
    return id && typeof nodeMap === "function" ? nodeMap().get(id) || null : null;
  }

  function retireInlineEditor() {
    const overlay = document.getElementById("detailOverlay");
    if (overlay instanceof HTMLElement) overlay.hidden = true;
    if (global.state?.detailsEdit) {
      global.state.detailsEdit.id = "";
      global.state.detailsEdit.originalLabel = "";
      global.state.detailsEdit.originalDetails = "";
      global.state.detailsEdit.originalUrgent = false;
      global.state.detailsEdit.originalCopyContext = false;
    }
  }

  function clearPopoutDrafts() {
    try {
      const remove = [];
      for (let i = 0; i < global.localStorage.length; i += 1) {
        const key = global.localStorage.key(i) || "";
        if (key.startsWith("pocket.editorPopoutDraft.v1.") || key.startsWith("pocket.editorPopoutDraft.v2.")) remove.push(key);
      }
      remove.forEach((key) => global.localStorage.removeItem(key));
    } catch (_error) {}
  }

  function openDirect() {
    const node = selectedNode();
    if (!node) {
      if (typeof setStatus === "function") setStatus("Select an item first.", "warn");
      return false;
    }
    retireInlineEditor();
    clearPopoutDrafts();
    const ok = !!(nodeBoundOpen && nodeBoundOpen());
    window.setTimeout(retireInlineEditor, 0);
    window.setTimeout(retireInlineEditor, 80);
    window.setTimeout(retireInlineEditor, 240);
    return ok;
  }

  function eatAndOpen(ev) {
    if (ev) {
      ev.preventDefault();
      ev.stopPropagation();
      ev.stopImmediatePropagation();
    }
    if (typeof closeCommandPalette === "function") closeCommandPalette({ restoreFocus: false });
    if (typeof closeRowMiniMenu === "function") closeRowMiniMenu({ restoreFocus: false });
    return openDirect();
  }

  function rowFromEvent(ev) {
    const target = ev.target instanceof HTMLElement ? ev.target : null;
    return target ? target.closest("[data-node-id]") : null;
  }

  function clickCapture(ev) {
    const target = ev.target instanceof HTMLElement ? ev.target : null;
    if (!target) return;
    if (target.closest("#btnOpenPrimary") || target.closest("#cmdEdit")) {
      eatAndOpen(ev);
      return;
    }
    const menuButton = target.closest(".rowMiniMenuBtn");
    if (menuButton && clean(menuButton.textContent, 40).toLowerCase().startsWith("edit")) eatAndOpen(ev);
  }

  function doubleClickCapture(ev) {
    const row = rowFromEvent(ev);
    if (!(row instanceof HTMLElement)) return;
    const id = clean(row.getAttribute("data-node-id"), 80);
    if (!id) return;
    global.state.selectedId = id;
    eatAndOpen(ev);
  }

  function keyCapture(ev) {
    if (ev.key !== "Enter" || ev.metaKey || ev.ctrlKey || ev.altKey || ev.shiftKey) return;
    if (global.state?.moveMode || global.state?.inlineEdit?.id || global.pendingPathImport) return;
    const node = selectedNode();
    if (!node) return;
    if (typeof shouldCopyOnSingleClick === "function") {
      const hasKids = typeof sortNodesForParent === "function" ? sortNodesForParent(node.id).length > 0 : false;
      if (shouldCopyOnSingleClick(node, hasKids)) return;
    }
    eatAndOpen(ev);
  }

  function install() {
    retireInlineEditor();
    global.openDetailsEditorForSelectedNode = openDirect;
    if (nodeBoundApply) global.PocketEditorPopout = Object.freeze({ open: openDirect, apply: nodeBoundApply });
    document.addEventListener("click", clickCapture, true);
    const treeWrap = document.getElementById("treeWrap");
    if (treeWrap) {
      treeWrap.addEventListener("dblclick", doubleClickCapture, true);
      treeWrap.addEventListener("keydown", keyCapture, true);
    }
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", install, { once: true });
  else install();
})(window);
