/* Standalone PE route.
   Enter opens pe-editor.html for the selected node. PE stores data in node.pe and
   does not read/write the old inline details editor fields. */
(function initialisePocketPeRoute(global) {
  "use strict";

  const PE_SCHEMA = "pocket.pe.v1";

  function clean(value, max = 80) {
    return typeof cleanText === "function" ? cleanText(value, max) : String(value || "").trim().slice(0, max);
  }

  function nodeById(id) {
    return id && typeof nodeMap === "function" ? nodeMap().get(id) || null : null;
  }

  function selectedNode() {
    const id = clean(global.state?.selectedId || global.state?.detailsEdit?.id, 80);
    return nodeById(id);
  }

  function block(text, depth, collapsed, index) {
    return {
      id: "pe_" + Date.now().toString(36) + "_" + index + "_" + Math.random().toString(36).slice(2, 6),
      text: String(text || "").replace(/\r/g, "").slice(0, 4000),
      depth: Math.max(0, Math.min(8, Number(depth) || 0)),
      collapsed: collapsed === true,
    };
  }

  function normalisePe(raw, node) {
    const pe = raw && typeof raw === "object" && raw.schema === PE_SCHEMA ? raw : null;
    const mode = pe && pe.mode === "text" ? "text" : "outline";
    const text = pe ? String(pe.text || "").replace(/\r/g, "").slice(0, 12000) : "";
    const outline = pe && Array.isArray(pe.outline)
      ? pe.outline.slice(0, 500).map((item, index) => block(item.text, item.depth, item.collapsed, index))
      : [block("", 0, false, 0)];
    return {
      nodeId: clean(node.id, 80),
      nodeLabel: clean(node.label, 220) || "Untitled node",
      title: pe ? clean(pe.title, 220) : clean(node.label, 220),
      mode,
      text,
      outline,
    };
  }

  function getPayload(nodeId) {
    const node = nodeById(clean(nodeId, 80)) || selectedNode();
    return node ? normalisePe(node.pe, node) : null;
  }

  function applyPe(payload) {
    const id = clean(payload && payload.nodeId, 80);
    const node = nodeById(id);
    if (!node) {
      if (typeof setStatus === "function") setStatus("PE node no longer exists.", "warn");
      return false;
    }
    const outline = Array.isArray(payload.outline)
      ? payload.outline.slice(0, 500).map((item, index) => block(item.text, item.depth, item.collapsed, index))
      : [];
    node.pe = {
      schema: PE_SCHEMA,
      title: clean(payload.title, 220),
      mode: payload.mode === "text" ? "text" : "outline",
      text: String(payload.text || "").replace(/\r/g, "").slice(0, 12000),
      outline,
      updatedAt: typeof nowIso === "function" ? nowIso() : new Date().toISOString(),
    };
    node.updatedAt = node.pe.updatedAt;
    if (global.state) global.state.selectedId = node.id;
    if (typeof recordOp === "function") recordOp({ type: "pe_edit", id: node.id, path: typeof getPath === "function" ? getPath(node.id) : "", changed: "pe" });
    if (typeof refreshMeta === "function") refreshMeta();
    if (typeof renderTree === "function") renderTree();
    if (typeof focusRowByNodeId === "function") focusRowByNodeId(node.id, { instant: true });
    if (typeof saveWorkspaceState === "function") saveWorkspaceState();
    if (typeof persistPipSnapshot === "function") persistPipSnapshot();
    if (typeof setStatus === "function") setStatus(`Saved PE for "${clean(node.label, 80)}".`, "ok");
    console.info("[pe route] saved", { id: node.id });
    return true;
  }

  function openPeForSelectedNode() {
    const node = selectedNode();
    if (!node) {
      if (typeof setStatus === "function") setStatus("Select a node first.", "warn");
      return false;
    }
    const width = 760;
    const height = 600;
    const left = Math.max(0, Math.round((global.screen.availWidth - width) / 2));
    const top = Math.max(0, Math.round((global.screen.availHeight - height) / 2));
    const url = `pe-editor.html#${encodeURIComponent(node.id)}`;
    const win = global.open(url, "pocketStandalonePe", `popup=yes,width=${width},height=${height},left=${left},top=${top}`);
    if (!win) {
      if (typeof setStatus === "function") setStatus("PE popout blocked. Allow popups for pocket, then try Enter again.", "warn", { durationMs: 5200 });
      return false;
    }
    win.focus();
    console.info("[pe route] opened", { id: node.id, label: clean(node.label, 80) });
    return true;
  }

  document.addEventListener("keydown", function (ev) {
    if (ev.key !== "Enter" || ev.metaKey || ev.ctrlKey || ev.altKey || ev.shiftKey) return;
    if (global.state?.moveMode || global.state?.inlineEdit?.id || global.pendingPathImport) return;
    // Deliberately do not preventDefault/stopPropagation yet. The old inline
    // editor may open too while PE proves itself separately.
    openPeForSelectedNode();
  }, true);

  global.PocketPeEditor = Object.freeze({ open: openPeForSelectedNode, getPayload, apply: applyPe });
  global.openPocketPeEditor = openPeForSelectedNode;
  console.info("[pe route] installed");
})(window);
