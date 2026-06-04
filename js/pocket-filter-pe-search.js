/* PE-aware tree filter.
   The main tree renderer already searches node labels, paths, old details and
   legacy outline metadata. This wrapper makes it see the newer node.pe text and
   outline lines without writing that search text back into the truth JSON. */
(function initialisePocketFilterPeSearch(global) {
  "use strict";

  if (global.__pocketFilterPeSearchInstalled) return;

  function clean(value, max = 12000) {
    return typeof cleanText === "function" ? cleanText(value, max) : String(value || "").trim().slice(0, max);
  }

  function peSearchText(node) {
    if (!node || !node.pe || typeof node.pe !== "object") return "";
    const pe = node.pe;
    const parts = [
      pe.title,
      pe.text,
      Array.isArray(pe.outline) ? pe.outline.map((line) => line && line.text).filter(Boolean).join("\n") : ""
    ];
    return clean(parts.filter(Boolean).join("\n"), 16000);
  }

  function queryIsActive() {
    const input = document.getElementById("search");
    return input instanceof HTMLInputElement && clean(input.value, 120).length > 0;
  }

  function augmentDetailsForSearch() {
    if (!queryIsActive() || !global.state || !Array.isArray(global.state.nodes)) return [];
    const changed = [];
    for (const node of global.state.nodes) {
      const peText = peSearchText(node);
      if (!peText) continue;
      const original = typeof node.details === "string" ? node.details : "";
      node.details = original ? `${original}\n\n${peText}` : peText;
      changed.push([node, original]);
    }
    return changed;
  }

  function restoreDetails(changed) {
    for (const pair of changed) {
      const node = pair[0];
      const original = pair[1];
      if (!node || typeof node !== "object") continue;
      if (original) node.details = original;
      else delete node.details;
    }
  }

  function install() {
    if (typeof global.renderTree !== "function") {
      window.setTimeout(install, 120);
      return;
    }
    const originalRenderTree = global.renderTree;
    if (originalRenderTree.__peSearchWrapped) return;

    function renderTreeWithPeSearch(...args) {
      const changed = augmentDetailsForSearch();
      try {
        return originalRenderTree.apply(this, args);
      } finally {
        restoreDetails(changed);
      }
    }

    renderTreeWithPeSearch.__peSearchWrapped = true;
    global.renderTree = renderTreeWithPeSearch;
    global.__pocketFilterPeSearchInstalled = true;
    console.info("[filter PE search] installed");
  }

  install();
})(window);
