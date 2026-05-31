/* Quiet build label so stale GitHub Pages/browser cache is visible. */

(function initialisePocketBuildLabel(global) {
  "use strict";

  const BUILD = Object.freeze({
    label: "build replacement-row-menu-3",
    stamp: "2026-05-30.7"
  });

  let replacementMenu = null;

  function ensureBuildLabel() {
    const topbar = document.querySelector(".topbar");
    if (!topbar) return null;

    let label = document.getElementById("pocketBuildLabel");
    if (!label) {
      label = document.createElement("div");
      label.id = "pocketBuildLabel";
      label.className = "pocketBuildLabel";
      const statusLane = document.querySelector(".topStatusLane");
      if (statusLane && statusLane.parentNode === topbar) {
        topbar.insertBefore(label, statusLane);
      } else {
        topbar.appendChild(label);
      }
    }

    label.textContent = BUILD.label;
    label.title = `${BUILD.label} · ${BUILD.stamp}`;
    return label;
  }

  function clean(value, max = 80) {
    return typeof cleanText === "function"
      ? cleanText(value, max)
      : String(value || "").trim().slice(0, max);
  }

  function closeReplacementMenu() {
    if (replacementMenu instanceof HTMLElement) replacementMenu.remove();
    replacementMenu = null;
  }

  function openItemDetails(id) {
    const nodeId = clean(id || global.state?.selectedId, 80);
    if (!nodeId) return false;
    if (global.state) global.state.selectedId = nodeId;
    closeReplacementMenu();
    if (typeof closeRowMiniMenu === "function") closeRowMiniMenu({ restoreFocus: false });
    if (typeof closeCommandPalette === "function") closeCommandPalette({ restoreFocus: false });
    console.info("[replacement row menu] opening item details", nodeId);
    if (typeof global.openPocketPeEditor === "function") return !!global.openPocketPeEditor(nodeId);
    if (global.PocketPeEditor && typeof global.PocketPeEditor.open === "function") return !!global.PocketPeEditor.open(nodeId);
    if (typeof global.openPocketNodeEditor === "function") return !!global.openPocketNodeEditor(nodeId);
    if (typeof global.openPocketEditor === "function") return !!global.openPocketEditor(nodeId);
    if (typeof global.openDetailsEditorForSelectedNode === "function") return !!global.openDetailsEditorForSelectedNode();
    return false;
  }

  function runAction(action, id) {
    closeReplacementMenu();
    if (global.state) state.selectedId = id;
    if (action === "edit") return openItemDetails(id);
    if (action === "add_sibling" && typeof insertSiblingBelow === "function") {
      const previousBlock = global.__pocketSuppressNextEditOpen;
      global.__pocketSuppressNextEditOpen = true;
      insertSiblingBelow(id);
      window.setTimeout(() => {
        global.__pocketSuppressNextEditOpen = previousBlock || false;
      }, 250);
      return true;
    }
    if (action === "delete" && typeof deleteSelected === "function") {
      deleteSelected();
      return true;
    }
    return false;
  }

  function addButton(menu, label, action, id) {
    const btn = document.createElement("button");
    btn.className = "rowMiniMenuBtn";
    btn.type = "button";
    btn.setAttribute("role", "menuitem");
    const span = document.createElement("span");
    span.className = "rowMiniMenuLabel";
    span.textContent = label;
    btn.appendChild(span);
    btn.addEventListener("click", (ev) => {
      ev.preventDefault();
      ev.stopPropagation();
      ev.stopImmediatePropagation();
      runAction(action, id);
    });
    menu.appendChild(btn);
    return btn;
  }

  function positionMenu(menu, point) {
    const gap = 6;
    const vw = Math.max(document.documentElement.clientWidth || 0, window.innerWidth || 0);
    const vh = Math.max(document.documentElement.clientHeight || 0, window.innerHeight || 0);
    menu.style.left = "0px";
    menu.style.top = "0px";
    menu.style.visibility = "hidden";
    const rect = menu.getBoundingClientRect();
    const width = Math.min(rect.width || 150, Math.max(120, vw - gap * 2));
    const height = Math.min(rect.height || 160, Math.max(80, vh - gap * 2));
    let left = Number.isFinite(point?.x) ? point.x + 4 : gap;
    let top = Number.isFinite(point?.y) ? point.y + 4 : gap;
    if (left + width > vw - gap) left = vw - width - gap;
    if (top + height > vh - gap) top = vh - height - gap;
    menu.style.left = `${Math.max(gap, Math.round(left))}px`;
    menu.style.top = `${Math.max(gap, Math.round(top))}px`;
    menu.style.visibility = "";
  }

  function openReplacementMenu(id, point) {
    const node = typeof nodeMap === "function" ? nodeMap().get(id) || null : null;
    if (!node) return false;
    closeReplacementMenu();
    if (typeof closeRowMiniMenu === "function") closeRowMiniMenu({ restoreFocus: false });
    if (typeof closeCommandPalette === "function") closeCommandPalette({ restoreFocus: false });
    if (global.state) global.state.selectedId = id;

    const menu = document.createElement("div");
    menu.className = "rowMiniMenu";
    menu.setAttribute("role", "menu");
    menu.setAttribute("aria-label", "Row actions");

    const title = document.createElement("div");
    title.className = "rowMiniMenuTitle";
    title.textContent = `Actions · ${clean(node.name || node.label || "Untitled", 80) || "Untitled"}`;
    menu.appendChild(title);

    addButton(menu, "Edit", "edit", id);
    addButton(menu, "Add below", "add_sibling", id);
    const sep = document.createElement("div");
    sep.className = "rowMiniMenuSep";
    sep.setAttribute("role", "separator");
    menu.appendChild(sep);
    addButton(menu, "Delete", "delete", id);

    menu.addEventListener("click", (ev) => ev.stopPropagation());
    menu.addEventListener("pointerdown", (ev) => ev.stopPropagation());
    menu.addEventListener("keydown", (ev) => {
      if (ev.key === "Escape") {
        ev.preventDefault();
        ev.stopPropagation();
        closeReplacementMenu();
        if (typeof refocusTreeNavigation === "function") refocusTreeNavigation(id);
      }
    });

    document.body.appendChild(menu);
    replacementMenu = menu;
    positionMenu(menu, point);
    const first = menu.querySelector(".rowMiniMenuBtn");
    if (first instanceof HTMLElement) first.focus({ preventScroll: true });
    console.info("[replacement row menu] opened", id);
    return true;
  }

  function installReplacementContextMenu() {
    if (global.__pocketReplacementContextMenuInstalled) return;
    document.addEventListener("contextmenu", (ev) => {
      const target = ev.target instanceof HTMLElement ? ev.target : null;
      const row = target ? target.closest("[data-node-id]") : null;
      const id = row instanceof HTMLElement ? clean(row.getAttribute("data-node-id"), 80) : "";
      if (!id) return;
      ev.preventDefault();
      ev.stopPropagation();
      ev.stopImmediatePropagation();
      openReplacementMenu(id, { x: ev.clientX, y: ev.clientY });
    }, true);
    document.addEventListener("pointerdown", (ev) => {
      if (!(replacementMenu instanceof HTMLElement)) return;
      if (replacementMenu.contains(ev.target)) return;
      closeReplacementMenu();
    }, true);
    global.__pocketReplacementContextMenuInstalled = true;
    console.info("[replacement row menu] installed");
  }

  function init() {
    global.PocketBuild = BUILD;
    ensureBuildLabel();
    installReplacementContextMenu();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init, { once: true });
  } else {
    init();
  }
})(window);
