/* Quiet build label so stale GitHub Pages/browser cache is visible. */

(function initialisePocketBuildLabel(global) {
  "use strict";

  const BUILD = Object.freeze({
    label: "build item-details-edit-route",
    stamp: "2026-05-30.1"
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

  function installEditCommandRoute() {
    if (global.__pocketEditCommandRouteWrapped) return;
    if (typeof global.runCommandPaletteAction !== "function") return;
    const original = global.runCommandPaletteAction.bind(global);
    global.runCommandPaletteAction = function pocketRunCommandPaletteAction(action) {
      if (action !== "edit") return original(action);
      if (typeof closeCommandPalette === "function") closeCommandPalette({ restoreFocus: false });
      window.requestAnimationFrame(() => {
        const id = typeof cleanText === "function"
          ? cleanText(global.state?.selectedId, 80)
          : String(global.state?.selectedId || "").trim().slice(0, 80);
        if (id && global.state) global.state.selectedId = id;
        if (typeof global.openPocketNodeEditor === "function") {
          global.openPocketNodeEditor(id || null);
          return;
        }
        if (typeof global.openPocketEditor === "function") {
          global.openPocketEditor(id || null);
          return;
        }
        if (typeof global.openDetailsEditorForSelectedNode === "function") global.openDetailsEditorForSelectedNode();
      });
    };
    global.__pocketEditCommandRouteWrapped = true;
    console.info("[item details edit command route] installed");
  }

  function init() {
    global.PocketBuild = BUILD;
    ensureBuildLabel();
    installEditCommandRoute();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init, { once: true });
  } else {
    init();
  }
})(window);
