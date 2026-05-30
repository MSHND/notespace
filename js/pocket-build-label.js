/* Quiet build label so stale GitHub Pages/browser cache is visible. */

(function initialisePocketBuildLabel(global) {
  "use strict";

  const BUILD = Object.freeze({
    label: "build item-details-edit-route-4",
    stamp: "2026-05-30.4"
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
    const nodeId = clean(id || global.state?.rowMiniMenuNodeId || global.state?.selectedId, 80);
    if (!nodeId) return false;
    if (global.state) global.state.selectedId = nodeId;
    if (typeof closeRowMiniMenu === "function") closeRowMiniMenu({ restoreFocus: false });
    if (typeof closeCommandPalette === "function") closeCommandPalette({ restoreFocus: false });
    console.info("[item details edit routes] opening", nodeId);
    if (typeof global.openPocketNodeEditor === "function") return !!global.openPocketNodeEditor(nodeId);
    if (typeof global.openPocketEditor === "function") return !!global.openPocketEditor(nodeId);
    if (typeof global.openDetailsEditorForSelectedNode === "function") return !!global.openDetailsEditorForSelectedNode();
    return false;
  }

  function replaceRowMenuEditButton(nodeId) {
    const buttons = Array.from(document.querySelectorAll(".rowMiniMenuBtn"));
    const editButton = buttons.find((button) => button instanceof HTMLElement
      && clean(button.textContent, 40).toLowerCase().startsWith("edit"));
    if (!(editButton instanceof HTMLElement) || editButton.__pocketItemDetailsEditButton) return;

    const replacement = editButton.cloneNode(true);
    replacement.__pocketItemDetailsEditButton = true;
    replacement.addEventListener("click", (ev) => {
      ev.preventDefault();
      ev.stopPropagation();
      ev.stopImmediatePropagation();
      openItemDetails(nodeId);
    }, true);
    replacement.addEventListener("keydown", (ev) => {
      if (ev.key !== "Enter" && ev.key !== " ") return;
      ev.preventDefault();
      ev.stopPropagation();
      ev.stopImmediatePropagation();
      openItemDetails(nodeId);
    }, true);
    editButton.replaceWith(replacement);
    console.info("[item details edit routes] row menu Edit replaced", clean(nodeId, 80));
  }

  function installRowMenuWrapper() {
    if (global.__pocketRowMenuEditReplaced) return;
    if (typeof global.openRowMiniMenu !== "function") return;
    const originalOpenRowMiniMenu = global.openRowMiniMenu.bind(global);
    global.openRowMiniMenu = function pocketOpenRowMiniMenuWithItemDetails(nodeId, anchorEl, point) {
      const ok = originalOpenRowMiniMenu(nodeId, anchorEl, point);
      window.requestAnimationFrame(() => replaceRowMenuEditButton(nodeId));
      window.setTimeout(() => replaceRowMenuEditButton(nodeId), 0);
      return ok;
    };
    global.__pocketRowMenuEditReplaced = true;
    console.info("[item details edit routes] row menu wrapper installed");
  }

  function init() {
    global.PocketBuild = BUILD;
    ensureBuildLabel();
    installRowMenuWrapper();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init, { once: true });
  } else {
    init();
  }
})(window);
