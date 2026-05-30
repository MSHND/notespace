/* Quiet build label so stale GitHub Pages/browser cache is visible. */

(function initialisePocketBuildLabel(global) {
  "use strict";

  const BUILD = Object.freeze({
    label: "build item-details-edit-route-2",
    stamp: "2026-05-30.2"
  });

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

  function openItemDetailsFromMenu(ev) {
    const target = ev.target instanceof HTMLElement ? ev.target : null;
    const button = target ? target.closest(".rowMiniMenuBtn") : null;
    if (!(button instanceof HTMLElement)) return false;
    if (!clean(button.textContent, 40).toLowerCase().startsWith("edit")) return false;

    const id = clean(global.state?.rowMiniMenuNodeId || global.state?.selectedId, 80);
    if (!id) return false;

    ev.preventDefault();
    ev.stopPropagation();
    ev.stopImmediatePropagation();

    if (global.state) global.state.selectedId = id;
    if (typeof closeRowMiniMenu === "function") closeRowMiniMenu({ restoreFocus: false });
    if (typeof closeCommandPalette === "function") closeCommandPalette({ restoreFocus: false });

    window.requestAnimationFrame(() => {
      if (typeof global.openPocketNodeEditor === "function") {
        global.openPocketNodeEditor(id);
        return;
      }
      if (typeof global.openPocketEditor === "function") {
        global.openPocketEditor(id);
        return;
      }
      if (typeof global.openDetailsEditorForSelectedNode === "function") global.openDetailsEditorForSelectedNode();
    });
    return true;
  }

  function installEditRoutes() {
    if (global.__pocketEditRoutesInstalled) return;
    document.addEventListener("pointerdown", openItemDetailsFromMenu, true);
    document.addEventListener("click", openItemDetailsFromMenu, true);
    global.__pocketEditRoutesInstalled = true;
    console.info("[item details edit routes] installed");
  }

  function init() {
    global.PocketBuild = BUILD;
    ensureBuildLabel();
    installEditRoutes();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init, { once: true });
  } else {
    init();
  }
})(window);
