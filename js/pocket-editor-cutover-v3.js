/* Editor cutover v3.
   Route Edit/double-click/right-click Edit into the standalone item details editor.
   Enter is left available for copy/row behaviours and must not open editors.
   Phone mode retains the in-page details owner; desktop routes use the canonical editor. */

(function initialisePocketEditorCutoverV3(global) {
  "use strict";

  console.info("[editor cutover v3] loaded");

  // Preserve the original details opener for Phone mode only. Desktop uses the
  // canonical PocketPeEditor.open(node.id) standalone item details window.
  const legacyOpenDetailsForSelectedNode = typeof global.openDetailsEditorForSelectedNode === "function"
    ? global.openDetailsEditorForSelectedNode.bind(global)
    : null;

  function clean(value, max = 80) {
    return typeof cleanText === "function" ? cleanText(value, max) : String(value || "").trim().slice(0, max);
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

  function openStandalone(node) {
    if (!global.PocketPeEditor || typeof global.PocketPeEditor.open !== "function") return false;
    clearDraftsFor(node.id);
    hideInlineEditor();
    return !!global.PocketPeEditor.open(node.id);
  }

  function requiresReadOnlyCompatibility(node) {
    if (!node || typeof node !== "object" || !Object.prototype.hasOwnProperty.call(node, "editor") || node.editor === null) return false;
    const model = global.PocketNodePopoutModel;
    if (!model || typeof model.classifyNodeEditor !== "function") return true;
    try {
      return model.classifyNodeEditor(node).kind === "unsupported-or-malformed";
    } catch (error) {
      console.warn("[editor cutover v3] editor classification failed", error);
      return true;
    }
  }

  function isPhoneMode() {
    return global.document?.body?.classList?.contains("phoneMode") === true;
  }

  function openPhoneDetails(node) {
    if (!isPhoneMode() || !legacyOpenDetailsForSelectedNode) return false;
    if (typeof global.requirePocketFileForChanges === "function"
        && !global.requirePocketFileForChanges()) return false;
    if (typeof state !== "undefined" && state) state.selectedId = node.id;
    legacyOpenDetailsForSelectedNode();
    return true;
  }

  function openDirect(input) {
    const node = selectedNode(input);
    console.info("[editor cutover v3] edit requested", {
      foundNode: !!node,
      hasStandalone: !!(global.PocketPeEditor && typeof global.PocketPeEditor.open === "function"),
      hasLegacyOpen: !!legacyOpenDetailsForSelectedNode,
      hasPopout: !!(global.PocketEditorPopout && typeof global.PocketEditorPopout.open === "function")
    });

    if (!node) {
      setStatusSafe("Select an item first.", "warn");
      return false;
    }

    const readOnlyCompatibility = requiresReadOnlyCompatibility(node);
    if (!readOnlyCompatibility && isPhoneMode()) return openPhoneDetails(node);
    let ok = false;
    try {
      ok = openStandalone(node);
    } catch (error) {
      console.warn("[editor cutover v3] standalone item details failed", error);
      ok = false;
    }

    if (!ok && readOnlyCompatibility) {
      setStatusSafe("This item requires Pocket's read-only compatibility view. Its editor data was not changed.", "warn");
    }
    if (!ok && !readOnlyCompatibility) {
      setStatusSafe("The safe editor could not open. Nothing was changed. Allow popups, then try again.", "warn");
    }
    console.info("[editor cutover v3] editor open result", { ok });
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
