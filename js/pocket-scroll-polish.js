/* Scroll polish: soft centre selected type-jump results without changing normal click/arrow behaviour. */

(function initialisePocketScrollPolish(global) {
  "use strict";

  function cleanId(value) {
    return typeof cleanText === "function" ? cleanText(value, 80) : String(value || "").trim();
  }

  function findRow(nodeId) {
    const id = cleanId(nodeId);
    if (!id || !(el.treeRoot instanceof HTMLElement)) return null;
    const escaped = typeof CSS?.escape === "function" ? CSS.escape(id) : id.replace(/"/g, '\\"');
    const row = el.treeRoot.querySelector(`.row[data-node-id="${escaped}"]`);
    return row instanceof HTMLElement ? row : null;
  }

  function softCenterRow(row) {
    if (!(row instanceof HTMLElement)) return false;
    const container = el.treeWrap instanceof HTMLElement ? el.treeWrap : null;
    if (!(container instanceof HTMLElement)) {
      try { row.scrollIntoView({ block: "center", inline: "nearest", behavior: "smooth" }); } catch {}
      return true;
    }

    const rowBox = row.getBoundingClientRect();
    const wrapBox = container.getBoundingClientRect();
    const currentCenter = rowBox.top + (rowBox.height / 2);
    const targetCenter = wrapBox.top + (wrapBox.height * 0.46);
    const delta = currentCenter - targetCenter;

    if (Math.abs(delta) < 18) return true;
    try {
      container.scrollBy({ top: delta, left: 0, behavior: "smooth" });
    } catch {
      container.scrollTop += delta;
    }
    return true;
  }

  function isRecentTypeJumpFor(id) {
    const typeJump = state && state.typeJump ? state.typeJump : null;
    if (!typeJump) return false;
    const lastAt = Number(typeJump.lastAt || 0);
    if (!lastAt || Date.now() - lastAt > 220) return false;
    return cleanId(state.selectedId) === cleanId(id);
  }

  global.focusRowByNodeId = function focusRowByNodeId(nodeId, options = {}) {
    const id = cleanId(nodeId);
    if (!id || !(el.treeRoot instanceof HTMLElement)) return;
    requestAnimationFrame(() => {
      const row = findRow(id);
      if (!(row instanceof HTMLElement)) return;
      row.focus({ preventScroll: true });
      if (options.center === true || isRecentTypeJumpFor(id)) {
        softCenterRow(row);
        return;
      }
      if (typeof scrollRowComfortably === "function") {
        scrollRowComfortably(row, { instant: options.instant === true });
      }
    });
  };

  global.PocketScrollPolish = Object.freeze({ softCenterRow });
})(window);
