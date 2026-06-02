/* Editor cutover v3.
   Route Edit/double-click/right-click Edit into the standalone item details editor.
   Enter is left available for copy/row behaviours and must not open editors.
   The old inline/details popout path is kept only as a fallback. */

(function initialisePocketEditorCutoverV3(global) {
  "use strict";

  console.info("[editor cutover v3] loaded");

  // Preserve the original details opener for fallback only. The main route is now
  // PocketPeEditor.open(node.id), which writes the standalone item details window.
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

  function openStandalone(node) {
    if (!global.PocketPeEditor || typeof global.PocketPeEditor.open !== "function") return false;
    clearDraftsFor(node.id);
    hideInlineEditor();
    return !!global.PocketPeEditor.open(node.id);
  }

  function openLegacyFallback(node) {
    clearDraftsFor(node.id);
    forceInlineBridgeToNode(node);

    try {
      if (legacyOpenDetailsForSelectedNode) legacyOpenDetailsForSelectedNode();
      forceInlineBridgeToNode(node);
    } catch (error) {
      console.warn("[editor cutover v3] legacy details bridge failed", error);
    }

    let ok = false;
    try {
      ok = !!(global.PocketEditorPopout && typeof global.PocketEditorPopout.open === "function" && global.PocketEditorPopout.open());
    } catch (error) {
      console.error("[editor cutover v3] fallback popout open failed", error);
      ok = false;
    }

    window.setTimeout(() => {
      forceInlineBridgeToNode(node);
      hideInlineEditor();
    }, 0);
    window.setTimeout(hideInlineEditor, 80);
    window.setTimeout(hideInlineEditor, 240);
    return ok;
  }

  function openDirect(input) {
    const node = selectedNode(input);
    console.info("[editor cutover v3] edit requested", {
      requested: clean(input?.id || input, 80),
      selectedId: clean(global.state?.selectedId, 80),
      detailsEditId: clean(global.state?.detailsEdit?.id, 80),
      nodeId: clean(node?.id, 80),
      label: clean(node?.label, 80),
      hasStandalone: !!(global.PocketPeEditor && typeof global.PocketPeEditor.open === "function"),
      hasLegacyOpen: !!legacyOpenDetailsForSelectedNode,
      hasPopout: !!(global.PocketEditorPopout && typeof global.PocketEditorPopout.open === "function")
    });

    if (!node) {
      setStatusSafe("Select an item first.", "warn");
      return false;
    }

    let ok = false;
    try {
      ok = openStandalone(node);
    } catch (error) {
      console.warn("[editor cutover v3] standalone item details failed", error);
      ok = false;
    }

    if (!ok) ok = openLegacyFallback(node);
    if (!ok) setStatusSafe("Editor failed to open. Refresh and try again.", "warn");
    console.info("[editor cutover v3] editor open result", { ok, id: node.id });
    return ok;
  }

  function eatAndOpen(ev, nodeId) {
    if (ev) {
      ev.preventDefault();
      ev.stopPropagation();
      ev.stopImmediatePropagation();
    }
    if (typeof closeCommandPalette === "function") closeCommandPalette({ restoreFocus: false });
    if (typeof closeRowMiniMenu === "function") closeRowMiniMenu({ restoreFocus: false });
    return openDirect(nodeId || null);
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
    if (rowId && global.state) global.state.selectedId = rowId;
    eatAndOpen(ev, rowId);
  }

  function doubleClickCapture(ev) {
    const id = nodeIdFromEvent(ev);
    if (!id) return;
    if (global.state) global.state.selectedId = id;
    eatAndOpen(ev, id);
  }

  function install() {
    hideInlineEditor();
    global.openPocketNodeEditor = openDirect;
    global.openPocketEditor = openDirect;
    document.addEventListener("click", clickCapture, true);
    document.addEventListener("dblclick", doubleClickCapture, true);
    console.info("[editor cutover v3] installed", {
      hasStandalone: !!(global.PocketPeEditor && typeof global.PocketPeEditor.open === "function"),
      hasLegacyOpen: !!legacyOpenDetailsForSelectedNode,
      hasPopout: !!(global.PocketEditorPopout && typeof global.PocketEditorPopout.open === "function")
    });
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", install, { once: true });
  else install();
})(window);
