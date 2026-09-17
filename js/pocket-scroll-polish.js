/* Scroll polish: keep Main-tree travel comfortable without owning tree semantics. */

(function initialisePocketScrollPolish(global) {
  "use strict";

  let pendingPlainLeftParentCentre = null;

  function cleanId(value) {
    return typeof cleanText === "function" ? cleanText(value, 80) : String(value || "").trim();
  }

  function runtimeState() {
    try {
      if (typeof state !== "undefined") return state;
    } catch (_error) {}
    return global.state && typeof global.state === "object" ? global.state : null;
  }

  function currentNodeMap() {
    try {
      if (typeof nodeMap === "function") return nodeMap();
    } catch (_error) {}
    return typeof global.nodeMap === "function" ? global.nodeMap() : null;
  }

  function currentChildren(nodeId) {
    try {
      if (typeof sortNodesForParent === "function") return sortNodesForParent(nodeId);
    } catch (_error) {}
    return typeof global.sortNodesForParent === "function" ? global.sortNodesForParent(nodeId) : [];
  }

  function findRow(nodeId) {
    const id = cleanId(nodeId);
    if (!id || !(el.treeRoot instanceof HTMLElement)) return null;
    const escaped = typeof CSS?.escape === "function" ? CSS.escape(id) : id.replace(/"/g, '\\"');
    const row = el.treeRoot.querySelector(`.row[data-node-id="${escaped}"]`);
    return row instanceof HTMLElement ? row : null;
  }

  function softCenterRow(row, options = {}) {
    if (!(row instanceof HTMLElement)) return false;
    const instant = options.instant === true;
    const container = el.treeWrap instanceof HTMLElement ? el.treeWrap : null;
    if (!(container instanceof HTMLElement)) {
      try { row.scrollIntoView({ block: "center", inline: "nearest", behavior: instant ? "auto" : "smooth" }); } catch {}
      return true;
    }

    const rowBox = row.getBoundingClientRect();
    const wrapBox = container.getBoundingClientRect();
    const currentCenter = rowBox.top + (rowBox.height / 2);
    const targetCenter = wrapBox.top + (wrapBox.height * 0.46);
    const delta = currentCenter - targetCenter;

    if (Math.abs(delta) < 18) return true;
    try {
      container.scrollBy({ top: delta, left: 0, behavior: instant ? "auto" : "smooth" });
    } catch {
      container.scrollTop += delta;
    }
    return true;
  }

  function isRecentTypeJumpFor(id) {
    const currentState = runtimeState();
    const typeJump = currentState && currentState.typeJump ? currentState.typeJump : null;
    if (!typeJump) return false;
    const lastAt = Number(typeJump.lastAt || 0);
    if (!lastAt || Date.now() - lastAt > 220) return false;
    return cleanId(currentState.selectedId) === cleanId(id);
  }

  function editableTarget(target) {
    if (!(target instanceof HTMLElement)) return false;
    const tag = String(target.tagName || "").toLowerCase();
    return target.isContentEditable || tag === "input" || tag === "textarea" || tag === "select";
  }

  function armPlainLeftParentCentre(ev) {
    pendingPlainLeftParentCentre = null;
    if (!ev || ev.key !== "ArrowLeft" || ev.metaKey || ev.ctrlKey || ev.altKey || ev.shiftKey) return;
    if (editableTarget(ev.target)) return;
    const currentState = runtimeState();
    const currentId = cleanId(currentState?.selectedId);
    const map = currentNodeMap();
    if (!currentState || !currentId || !map || typeof map.get !== "function") return;
    const current = map.get(currentId) || null;
    if (!current) return;
    const kids = currentChildren(current.id);
    if (kids.length > 0 && !currentState.collapsed.has(current.id)) return;
    const parentId = cleanId(current.parentId);
    if (!parentId || parentId === "root") return;
    pendingPlainLeftParentCentre = {
      fromId: current.id,
      toId: parentId,
      at: Date.now(),
    };
  }

  function consumePlainLeftParentCentre(id) {
    const pending = pendingPlainLeftParentCentre;
    pendingPlainLeftParentCentre = null;
    const currentState = runtimeState();
    if (!pending || pending.toId !== id || Date.now() - pending.at > 260) return false;
    return cleanId(currentState?.selectedId) === id && pending.fromId !== id;
  }

  global.focusRowByNodeId = function focusRowByNodeId(nodeId, options = {}) {
    const id = cleanId(nodeId);
    if (!id || !(el.treeRoot instanceof HTMLElement)) return;
    requestAnimationFrame(() => {
      const row = findRow(id);
      if (!(row instanceof HTMLElement)) return;
      row.focus({ preventScroll: true });
      if (consumePlainLeftParentCentre(id) || options.center === true) {
        softCenterRow(row);
        return;
      }
      if (isRecentTypeJumpFor(id)) {
        softCenterRow(row, { instant: true });
        return;
      }
      if (typeof scrollRowComfortably === "function") {
        scrollRowComfortably(row, { instant: options.instant === true });
      }
    });
  };

  if (global.document && typeof global.document.addEventListener === "function") {
    global.document.addEventListener("keydown", armPlainLeftParentCentre, true);
  }

  global.PocketScrollPolish = Object.freeze({
    softCenterRow,
    armPlainLeftParentCentre,
  });
})(window);
