/* Quiet build label so stale GitHub Pages/browser cache is visible. */

(function initialisePocketBuildLabel(global) {
  "use strict";

  const BUILD = Object.freeze({
    label: "build right-click-paused-1",
    stamp: "2026-05-30.8"
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

  function openItemDetails(id) {
    const nodeId = clean(id || global.state?.selectedId, 80);
    if (!nodeId) return false;
    if (global.state) global.state.selectedId = nodeId;
    if (typeof closeRowMiniMenu === "function") closeRowMiniMenu({ restoreFocus: false });
    if (typeof closeCommandPalette === "function") closeCommandPalette({ restoreFocus: false });
    console.info("[item details route patch] opening", nodeId);
    if (typeof global.openPocketPeEditor === "function") return !!global.openPocketPeEditor(nodeId);
    if (global.PocketPeEditor && typeof global.PocketPeEditor.open === "function") return !!global.PocketPeEditor.open(nodeId);
    if (typeof global.openPocketNodeEditor === "function") return !!global.openPocketNodeEditor(nodeId);
    if (typeof global.openPocketEditor === "function") return !!global.openPocketEditor(nodeId);
    if (typeof global.openDetailsEditorForSelectedNode === "function") return !!global.openDetailsEditorForSelectedNode();
    return false;
  }

  function installRightClickPause() {
    if (global.__pocketRightClickPaused) return;
    document.addEventListener("contextmenu", (ev) => {
      const target = ev.target instanceof HTMLElement ? ev.target : null;
      const row = target ? target.closest("[data-node-id]") : null;
      const id = row instanceof HTMLElement ? clean(row.getAttribute("data-node-id"), 80) : "";
      if (!id) return;
      ev.preventDefault();
      ev.stopPropagation();
      ev.stopImmediatePropagation();
      if (global.state) global.state.selectedId = id;
      if (typeof closeRowMiniMenu === "function") closeRowMiniMenu({ restoreFocus: false });
      if (typeof setStatus === "function") setStatus("Right-click menu paused while we rebuild it.", "warn", { durationMs: 2200 });
      console.info("[right click menu] paused", id);
    }, true);
    global.__pocketRightClickPaused = true;
    console.info("[right click menu] paused installed");
  }

  function installDoubleClickRoute() {
    if (global.__pocketDoubleClickItemDetailsInstalled) return;
    document.addEventListener("dblclick", (ev) => {
      const target = ev.target instanceof HTMLElement ? ev.target : null;
      const row = target ? target.closest("[data-node-id]") : null;
      const id = row instanceof HTMLElement ? clean(row.getAttribute("data-node-id"), 80) : "";
      if (!id) return;
      ev.preventDefault();
      ev.stopPropagation();
      ev.stopImmediatePropagation();
      openItemDetails(id);
    }, true);
    global.__pocketDoubleClickItemDetailsInstalled = true;
    console.info("[double click item details] installed");
  }

  function init() {
    global.PocketBuild = BUILD;
    ensureBuildLabel();
    installRightClickPause();
    installDoubleClickRoute();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init, { once: true });
  } else {
    init();
  }
})(window);
