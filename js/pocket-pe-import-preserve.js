/* Preserve node.pe during import normalisation.
   The generic extras keeper has a small-size guard, which is good for random
   baggage but wrong for PE outlines. This wrapper treats PE as first-class data
   so larger outlines survive opening a truth JSON. */
(function initialisePocketPeImportPreserve(global) {
  "use strict";

  if (global.__pocketPeImportPreserveInstalled) return;

  const PE_SCHEMA = "pocket.pe.v1";
  const PE_VISIBLE_VERSION = "PE · simple v0.5";

  function clean(value, max = 80) {
    return typeof cleanText === "function" ? cleanText(value, max) : String(value || "").trim().slice(0, max);
  }

  function makeLineId(index) {
    return "line_import_" + String(index + 1).padStart(4, "0");
  }

  function normalisePeOutline(rawOutline) {
    if (!Array.isArray(rawOutline)) return [];
    return rawOutline.slice(0, 3000).map((line, index) => {
      const depthRaw = Number(line && line.depth);
      const orderRaw = Number(line && line.order);
      return {
        id: clean(line && line.id, 80) || makeLineId(index),
        text: String(line && line.text || "").replace(/\r/g, "").slice(0, 1200),
        depth: Number.isFinite(depthRaw) ? Math.max(0, Math.min(8, Math.round(depthRaw))) : 0,
        collapsed: line && line.collapsed === true,
        order: Number.isFinite(orderRaw) ? Math.max(0, Math.round(orderRaw)) : (index + 1) * 1000
      };
    });
  }

  function normalisePe(rawPe, fallbackTitle) {
    if (!rawPe || typeof rawPe !== "object" || Array.isArray(rawPe)) return null;
    const outline = normalisePeOutline(rawPe.outline);
    const text = String(rawPe.text || "").replace(/\r/g, "").slice(0, 120000);
    const title = clean(rawPe.title || fallbackTitle, 220);
    const mode = rawPe.mode === "outline" ? "outline" : "text";
    const updatedAt = clean(rawPe.updatedAt, 40) || (typeof nowIso === "function" ? nowIso() : new Date().toISOString());
    const hasContent = !!title || !!text.trim() || outline.some((line) => clean(line.text, 1200));
    if (!hasContent) return null;
    return {
      schema: PE_SCHEMA,
      title: title || clean(fallbackTitle, 220),
      mode,
      text,
      outline: outline.length ? outline : [{ id: makeLineId(0), text: "", depth: 0, collapsed: false, order: 1000 }],
      updatedAt
    };
  }

  function installPeVersionMarkerPatch() {
    if (global.__pocketPeVisibleVersionPatchInstalled) return;
    const originalOpen = global.open.bind(global);

    function patchVersionLabel(win) {
      try {
        if (!win || win.closed || !win.document) return false;
        const marker = win.document.querySelector(".peVersion");
        if (!(marker instanceof win.HTMLElement)) return false;
        marker.textContent = PE_VISIBLE_VERSION;
        marker.title = String(marker.title || "").replace(/PE · simple v\d+\.\d+/g, PE_VISIBLE_VERSION) || PE_VISIBLE_VERSION;
        return true;
      } catch (_error) {
        return false;
      }
    }

    function patchSoon(win) {
      [0, 80, 240, 520].forEach((delay) => window.setTimeout(() => patchVersionLabel(win), delay));
    }

    global.open = function pocketOpenWithPeVisibleVersion(...args) {
      const win = originalOpen(...args);
      const name = String(args[1] || "");
      if (win && name.startsWith("pocketSimplePe_")) patchSoon(win);
      return win;
    };

    global.__pocketPeVisibleVersionPatchInstalled = true;
    console.info("[pe visible version] installed", PE_VISIBLE_VERSION);
  }

  function install() {
    installPeVersionMarkerPatch();

    if (typeof global.normaliseNodes !== "function") {
      window.setTimeout(install, 120);
      return;
    }

    const baseNormaliseNodes = global.normaliseNodes;
    if (baseNormaliseNodes.__peImportPreserveWrapped) return;

    function normaliseNodesPreservingPe(raw) {
      const rawArr = Array.isArray(raw) ? raw : [];
      const peById = new Map();
      for (const item of rawArr) {
        if (!item || typeof item !== "object") continue;
        const id = clean(item.id, 80);
        if (!id) continue;
        const pe = normalisePe(item.pe, item.label);
        if (pe) peById.set(id, pe);
      }

      const nodes = baseNormaliseNodes(raw);
      if (!Array.isArray(nodes) || peById.size === 0) return nodes;

      for (const node of nodes) {
        const pe = peById.get(clean(node && node.id, 80));
        if (pe) node.pe = pe;
      }
      return nodes;
    }

    normaliseNodesPreservingPe.__peImportPreserveWrapped = true;
    global.normaliseNodes = normaliseNodesPreservingPe;
    global.__pocketPeImportPreserveInstalled = true;
    console.info("[pe import preserve] installed");
  }

  install();
})(window);
