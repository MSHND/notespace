/* Popout-first editor path.
   Edit actions now open the full popout editor directly. */

(function initialisePocketEditorPopoutDefault(global) {
  "use strict";

  const originalOpenDetails = global.openDetailsEditorForSelectedNode;

  function clean(value, max = 80) {
    return typeof cleanText === "function" ? cleanText(value, max) : String(value || "").trim().slice(0, max);
  }

  function selectedNode() {
    const id = clean(global.state?.selectedId, 80);
    if (!id || typeof nodeMap !== "function") return null;
    return nodeMap().get(id) || null;
  }

  function nodeWouldCopy(node) {
    if (!node || typeof shouldCopyOnSingleClick !== "function") return false;
    const hasKids = typeof sortNodesForParent === "function" ? sortNodesForParent(node.id).length > 0 : false;
    return shouldCopyOnSingleClick(node, hasKids);
  }

  function closeLegacyDetailLayer(nodeId) {
    if (typeof closeDetailsEditor !== "function") return;
    try {
      closeDetailsEditor({ restoreFocus: false, revertDraft: false, nodeId });
    } catch (_error) {}
  }

  function openSelectedInPopout() {
    const node = selectedNode();
    if (!node) {
      if (typeof setStatus === "function") setStatus("Select an item first.", "warn");
      return false;
    }

    if (typeof isDetailsEditorOpen !== "function" || !isDetailsEditorOpen() || clean(global.state?.detailsEdit?.id, 80) !== node.id) {
      if (typeof originalOpenDetails === "function") originalOpenDetails.call(global);
    }

    const ok = !!(global.PocketEditorPopout && typeof global.PocketEditorPopout.open === "function" && global.PocketEditorPopout.open());
    if (ok) window.setTimeout(() => closeLegacyDetailLayer(node.id), 180);
    return ok;
  }

  function interceptEditButton(ev) {
    ev.preventDefault();
    ev.stopPropagation();
    ev.stopImmediatePropagation();
    openSelectedInPopout();
  }

  function interceptCommandEdit(ev) {
    ev.preventDefault();
    ev.stopPropagation();
    ev.stopImmediatePropagation();
    if (typeof closeCommandPalette === "function") closeCommandPalette({ restoreFocus: false });
    openSelectedInPopout();
  }

  function interceptRowMenuEdit(ev) {
    const target = ev.target instanceof HTMLElement ? ev.target : null;
    const button = target ? target.closest(".rowMiniMenuBtn") : null;
    if (!(button instanceof HTMLElement)) return;
    const text = clean(button.textContent, 40).toLowerCase();
    if (!text.startsWith("edit")) return;
    ev.preventDefault();
    ev.stopPropagation();
    ev.stopImmediatePropagation();
    if (typeof closeRowMiniMenu === "function") closeRowMiniMenu({ restoreFocus: false });
    openSelectedInPopout();
  }

  function findRowFromEvent(ev) {
    const target = ev.target instanceof HTMLElement ? ev.target : null;
    return target ? target.closest("[data-node-id]") : null;
  }

  function interceptTreeDoubleClick(ev) {
    const row = findRowFromEvent(ev);
    if (!(row instanceof HTMLElement)) return;
    const id = clean(row.getAttribute("data-node-id"), 80);
    if (!id) return;
    ev.preventDefault();
    ev.stopPropagation();
    ev.stopImmediatePropagation();
    global.state.selectedId = id;
    if (typeof refreshMeta === "function") refreshMeta();
    if (typeof renderTree === "function") renderTree();
    openSelectedInPopout();
  }

  function interceptTreeEnter(ev) {
    if (ev.key !== "Enter") return;
    if (ev.metaKey || ev.ctrlKey || ev.altKey || ev.shiftKey) return;
    if (global.state?.moveMode || global.state?.inlineEdit?.id) return;
    if (typeof isDetailsEditorOpen === "function" && isDetailsEditorOpen()) return;
    if (global.pendingPathImport) return;

    const node = selectedNode();
    if (!node || nodeWouldCopy(node)) return;

    ev.preventDefault();
    ev.stopPropagation();
    ev.stopImmediatePropagation();
    openSelectedInPopout();
  }

  function install() {
    const editButton = document.getElementById("btnOpenPrimary");
    if (editButton) editButton.addEventListener("click", interceptEditButton, true);

    const cmdEdit = document.getElementById("cmdEdit");
    if (cmdEdit) cmdEdit.addEventListener("click", interceptCommandEdit, true);

    document.addEventListener("click", interceptRowMenuEdit, true);

    const treeWrap = document.getElementById("treeWrap");
    if (treeWrap) {
      treeWrap.addEventListener("dblclick", interceptTreeDoubleClick, true);
      treeWrap.addEventListener("keydown", interceptTreeEnter, true);
    }
  }

  global.PocketEditorPopoutDefault = Object.freeze({ openSelected: openSelectedInPopout });
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", install, { once: true });
  else install();
})(window);
