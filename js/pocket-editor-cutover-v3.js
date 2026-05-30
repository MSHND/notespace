/* Editor cutover v3.
   Route Edit/Enter/double-click/right-click Edit into the popout editor.
   The old inline details editor may be used only as a temporary compatibility
   bridge for the existing popout code; it is immediately hidden and never
   trusted as stale source data. */

(function initialisePocketEditorCutoverV3(global) {
  "use strict";

  console.info("[editor cutover v3] loaded");

  // Preserve the original details opener. PocketEditorPopout.open() currently
  // calls this internally, so replacing it creates a recursion loop.
  const legacyOpenDetailsForSelectedNode = typeof global.openDetailsEditorForSelectedNode === "function"
    ? global.openDetailsEditorForSelectedNode.bind(global)
    : null;

  function clean(value, max = 80) {
    return typeof cleanText === "function" ? cleanText(value, max) : String(value || "").trim().slice(0, max);
  }

  function detailText(value, max = 4000) {
    return typeof normaliseDetails === "function" ? normaliseDetails(value, max) : String(value || "").replace(/\r/g, "").trim().slice(0, max);
  }

  function mapNode(id) {
    return id && typeof nodeMap === "function" ? nodeMap().get(id) || null : null;
  }

  function selectedNode(input) {
    let id = "";
    if (typeof input === "string") id = clean(input, 80);
    else if (input && typeof input === "object") id = clean(input.id, 80);
    if (!id) id = clean(global.state?.selectedId, 80);
    if (!id) id = clean(global.state?.detailsEdit?.id, 80);
    return mapNode(id);
  }

  function setStatusSafe(message, tone) {
    if (typeof setStatus === "function") setStatus(message, tone || "ok");
  }

  function hideInlineEditor() {
    const overlay = document.getElementById("detailOverlay");
    if (overlay instanceof HTMLElement) overlay.hidden = true;
  }

  function clearDraftsFor(id) {
    try {
      [
        `pocket.editorPopoutDraft.v1.${id}`,
        `pocket.editorPopoutDraft.v2.${id}`,
        "pocket.editorPopoutDraft.v1.unknown",
        "pocket.editorPopoutDraft.v2.unknown"
      ].forEach((key) => global.localStorage.removeItem(key));
    } catch (_error) {}
  }

  function forceInlineBridgeToNode(node) {
    if (!node || !global.state) return false;
    global.state.selectedId = node.id;
    if (global.state.detailsEdit) {
      global.state.detailsEdit.id = node.id;
      global.state.detailsEdit.originalLabel = clean(node.label, 220);
      global.state.detailsEdit.originalDetails = detailText(node.details, 4000);
      global.state.detailsEdit.originalUrgent = node.urgent === true;
      global.state.detailsEdit.originalCopyContext = node.copyContext === true;
    }
    if (global.el?.detailEditorLabel instanceof HTMLInputElement) global.el.detailEditorLabel.value = clean(node.label, 220);
    if (global.el?.detailEditorBody instanceof HTMLTextAreaElement) global.el.detailEditorBody.value = detailText(node.details, 4000);
    if (global.el?.detailEditorPath instanceof HTMLElement && typeof getPath === "function") global.el.detailEditorPath.textContent = getPath(node.id);
    if (global.el?.detailEditorUrgent instanceof HTMLInputElement) global.el.detailEditorUrgent.checked = node.urgent === true;
    if (global.el?.detailEditorCopyContext instanceof HTMLInputElement) global.el.detailEditorCopyContext.checked = node.copyContext === true;
    return true;
  }

  function openDirect(input) {
    const node = selectedNode(input);
    console.info("[editor cutover v3] edit requested", {
      requested: clean(input?.id || input, 80),
      selectedId: clean(global.state?.selectedId, 80),
      detailsEditId: clean(global.state?.detailsEdit?.id, 80),
      nodeId: clean(node?.id, 80),
      label: clean(node?.label, 80),
      hasLegacyOpen: !!legacyOpenDetailsForSelectedNode,
      hasPopout: !!(global.PocketEditorPopout && typeof global.PocketEditorPopout.open === "function")
    });

    if (!node) {
      setStatusSafe("Select an item first.", "warn");
      return false;
    }

    if (!global.PocketEditorPopout || typeof global.PocketEditorPopout.open !== "function") {
      setStatusSafe("Editor popout is not available yet. Refresh and try again.", "warn");
      return false;
    }

    clearDraftsFor(node.id);
    forceInlineBridgeToNode(node);

    // Ensure the legacy details bridge is open with the selected node before
    // the existing popout builder reads from it. Then hide it immediately.
    try {
      if (legacyOpenDetailsForSelectedNode) legacyOpenDetailsForSelectedNode();
      forceInlineBridgeToNode(node);
    } catch (error) {
      console.warn("[editor cutover v3] legacy details bridge failed", error);
    }

    let ok = false;
    try {
      ok = !!global.PocketEditorPopout.open();
    } catch (error) {
      console.error("[editor cutover v3] popout open failed", error);
      setStatusSafe("Editor failed to open. Check Console for details.", "warn");
      ok = false;
    }

    window.setTimeout(() => {
      forceInlineBridgeToNode(node);
      hideInlineEditor();
    }, 0);
    window.setTimeout(hideInlineEditor, 80);
    window.setTimeout(hideInlineEditor, 240);

    console.info("[editor cutover v3] popout open result", { ok, id: node.id });
    return ok;
  }

  function currentEditorOpener() {
    return typeof global.openPocketNodeEditor === "function" && global.openPocketNodeEditor !== openDirect
      ? global.openPocketNodeEditor
      : null;
  }

  function eatAndOpen(ev, nodeId) {
    if (ev) {
      ev.preventDefault();
      ev.stopPropagation();
      ev.stopImmediatePropagation();
    }
    const id = clean(nodeId || global.state?.rowMiniMenuNodeId || global.state?.selectedId, 80);
    if (id && global.state) global.state.selectedId = id;
    if (typeof closeCommandPalette === "function") closeCommandPalette({ restoreFocus: false });
    if (typeof closeRowMiniMenu === "function") closeRowMiniMenu({ restoreFocus: false });
    const opener = currentEditorOpener();
    if (opener) return opener(id || null);
    return openDirect(id || null);
  }

  function rowFromEvent(ev) {
    const target = ev.target instanceof HTMLElement ? ev.target : null;
    return target ? target.closest("[data-node-id]") : null;
  }

  function nodeIdFromEvent(ev) {
    const row = rowFromEvent(ev);
    return row instanceof HTMLElement ? clean(row.getAttribute("data-node-id"), 80) : "";
  }

  function clickCapture(ev) {
    const target = ev.target instanceof HTMLElement ? ev.target : null;
    if (!target) return;
    const rowId = nodeIdFromEvent(ev);
    const isPrimaryEdit = target.closest("#btnOpenPrimary") || target.closest("#cmdEdit") || target.closest("#btnDetailPopout");
    const menuButton = target.closest(".rowMiniMenuBtn");
    const isRowEdit = menuButton && clean(menuButton.textContent, 40).toLowerCase().startsWith("edit");
    if (!isPrimaryEdit && !isRowEdit) return;
    const targetId = rowId || clean(global.state?.rowMiniMenuNodeId, 80) || clean(global.state?.selectedId, 80);
    if (targetId && global.state) global.state.selectedId = targetId;
    eatAndOpen(ev, targetId);
  }

  function doubleClickCapture(ev) {
    const id = nodeIdFromEvent(ev);
    if (!id) return;
    if (global.state) global.state.selectedId = id;
    eatAndOpen(ev, id);
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
    eatAndOpen(ev, node.id);
  }

  function install() {
    hideInlineEditor();
    global.openPocketNodeEditor = openDirect;
    global.openPocketEditor = openDirect;
    // Do NOT replace openDetailsEditorForSelectedNode/openDetailsEditorForNode.
    // The current popout opener depends on the original function internally.
    document.addEventListener("click", clickCapture, true);
    document.addEventListener("dblclick", doubleClickCapture, true);
    const treeWrap = document.getElementById("treeWrap");
    if (treeWrap) treeWrap.addEventListener("keydown", keyCapture, true);
    else document.addEventListener("keydown", keyCapture, true);
    console.info("[editor cutover v3] installed", {
      hasLegacyOpen: !!legacyOpenDetailsForSelectedNode,
      hasPopout: !!(global.PocketEditorPopout && typeof global.PocketEditorPopout.open === "function")
    });
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", install, { once: true });
  else install();
})(window);
