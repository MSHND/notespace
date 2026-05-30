/* Standalone item details route.
   Enter opens a simple free-text editor for the selected node. The editor stores
   data in node.pe and does not read/write the old inline details editor fields. */
(function initialisePocketPeRoute(global) {
  "use strict";

  const PE_SCHEMA = "pocket.pe.v1";

  function clean(value, max = 80) {
    return typeof cleanText === "function" ? cleanText(value, max) : String(value || "").trim().slice(0, max);
  }

  function escapeHtml(value) {
    return String(value || "").replace(/[&<>\"]/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;" }[ch]));
  }

  function escapeTextarea(value) {
    return String(value || "").replace(/[&<]/g, (ch) => ({ "&": "&amp;", "<": "&lt;" }[ch]));
  }

  function nodeById(id) {
    return id && typeof nodeMap === "function" ? nodeMap().get(id) || null : null;
  }

  function domSelectedNodeId() {
    const active = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const activeRow = active ? active.closest("[data-node-id]") : null;
    const selectedRow = document.querySelector(".row.selected[data-node-id], .row:focus[data-node-id], [aria-selected='true'][data-node-id]");
    const row = activeRow || selectedRow;
    return row instanceof HTMLElement ? clean(row.getAttribute("data-node-id"), 80) : "";
  }

  function nodeIdFromEvent(ev) {
    const target = ev?.target instanceof HTMLElement ? ev.target : null;
    const row = target ? target.closest("[data-node-id]") : null;
    return row instanceof HTMLElement ? clean(row.getAttribute("data-node-id"), 80) : "";
  }

  function selectedNode(preferredId = "") {
    const id = clean(preferredId || global.state?.selectedId || global.state?.detailsEdit?.id || domSelectedNodeId(), 80);
    return nodeById(id);
  }

  function pePayloadForNode(node) {
    const pe = node.pe && typeof node.pe === "object" && node.pe.schema === PE_SCHEMA ? node.pe : null;
    return {
      nodeId: clean(node.id, 80),
      title: pe ? clean(pe.title, 220) : clean(node.label, 220),
      text: pe ? String(pe.text || "").replace(/\r/g, "").slice(0, 12000) : ""
    };
  }

  function getPayload(nodeId) {
    const node = nodeById(clean(nodeId, 80)) || selectedNode();
    return node ? pePayloadForNode(node) : null;
  }

  function applyPe(payload) {
    const id = clean(payload && payload.nodeId, 80);
    const node = nodeById(id);
    if (!node) {
      if (typeof setStatus === "function") setStatus("This item no longer exists.", "warn");
      return false;
    }
    const updatedAt = typeof nowIso === "function" ? nowIso() : new Date().toISOString();
    node.pe = {
      schema: PE_SCHEMA,
      title: clean(payload.title, 220) || clean(node.label, 220),
      mode: "text",
      text: String(payload.text || "").replace(/\r/g, "").slice(0, 12000),
      updatedAt
    };
    node.updatedAt = updatedAt;
    if (global.state) global.state.selectedId = node.id;
    if (typeof recordOp === "function") recordOp({ type: "pe_edit", id: node.id, path: typeof getPath === "function" ? getPath(node.id) : "", changed: "pe_text" });
    if (typeof refreshMeta === "function") refreshMeta();
    if (typeof renderTree === "function") renderTree();
    if (typeof focusRowByNodeId === "function") focusRowByNodeId(node.id, { instant: true });
    if (typeof saveWorkspaceState === "function") saveWorkspaceState();
    if (typeof persistPipSnapshot === "function") persistPipSnapshot();
    if (typeof setStatus === "function") setStatus(`Saved details for "${clean(node.label, 80)}".`, "ok");
    console.info("[item details route] saved text", { id: node.id });
    return true;
  }

  function writeTextEditor(win, payload, nodeLabel) {
    win.document.open();
    win.document.write(`<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>item details</title>
<style>
  * { box-sizing: border-box; }
  html, body { height: 100%; }
  body { margin: 0; font-family: system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; background: #fbfbf8; color: #0f172a; overflow: hidden; }
  main { height: 100vh; display: grid; grid-template-rows: auto minmax(0, 1fr); }
  .bar { display: flex; align-items: center; gap: 10px; padding: 9px 12px; border-bottom: 1px solid rgba(148,163,184,.24); background: rgba(255,255,255,.78); }
  .brand { font-size: 13px; font-weight: 700; color: rgba(51,65,85,.82); max-width: 260px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  button { border: 0; background: transparent; border-radius: 999px; padding: 4px 8px; font: inherit; font-size: 12px; color: rgba(51,65,85,.82); cursor: pointer; }
  button:hover, button:focus-visible { background: rgba(148,163,184,.16); outline: none; color: #0f172a; }
  .status { min-width: 72px; font-size: 11px; color: rgba(100,116,139,.74); }
  .grow { flex: 1 1 auto; }
  .body { min-height: 0; display: grid; grid-template-rows: auto minmax(0, 1fr); gap: 10px; padding: 14px; }
  input, textarea { width: 100%; border: 1px solid rgba(148,163,184,.22); border-radius: 15px; background: rgba(255,255,255,.96); color: #0f172a; outline: none; box-shadow: 0 10px 24px -22px rgba(15,23,42,.38); }
  input { min-height: 42px; padding: 9px 12px; font-size: 17px; font-weight: 560; }
  textarea { min-height: 0; height: 100%; resize: none; padding: 14px; font: inherit; font-size: 16px; line-height: 1.52; }
</style>
</head>
<body>
<main>
  <div class="bar"><div class="brand">details · ${escapeHtml(nodeLabel)}</div><button id="saveBtn" type="button">save</button><span id="status" class="status">connected</span><div class="grow"></div><button id="closeBtn" type="button">×</button></div>
  <section class="body"><input id="title" value="${escapeHtml(payload.title)}" aria-label="Item details title"><textarea id="text" aria-label="Item details text">${escapeTextarea(payload.text)}</textarea></section>
</main>
<script>
(function () {
  var nodeId = ${JSON.stringify(payload.nodeId)};
  var title = document.getElementById("title");
  var text = document.getElementById("text");
  var status = document.getElementById("status");
  var dirty = false;
  function setStatus(value) { status.textContent = value || "connected"; }
  function markDirty() { dirty = true; setStatus("editing"); }
  function save() {
    setStatus("saving…");
    try {
      if (window.opener && !window.opener.closed && window.opener.PocketPeEditor && typeof window.opener.PocketPeEditor.apply === "function") {
        var ok = window.opener.PocketPeEditor.apply({ nodeId: nodeId, title: title.value, text: text.value });
        if (ok) { dirty = false; setStatus("saved"); return; }
      }
    } catch (error) { console.error(error); }
    setStatus("save failed");
  }
  title.addEventListener("input", markDirty);
  text.addEventListener("input", markDirty);
  document.getElementById("saveBtn").addEventListener("click", save);
  document.getElementById("closeBtn").addEventListener("click", function () { if (!dirty || confirm("Close without saving?")) window.close(); });
  document.addEventListener("keydown", function (ev) { if ((ev.ctrlKey || ev.metaKey) && ev.key.toLowerCase() === "s") { ev.preventDefault(); save(); } });
  text.focus();
})();
</script>
</body>
</html>`);
    win.document.close();
  }

  function openPeForNode(nodeId = "") {
    const node = selectedNode(nodeId);
    if (!node) {
      if (typeof setStatus === "function") setStatus("Select an item first.", "warn");
      console.warn("[item details route] no selected node", { requestedId: nodeId, selectedId: global.state?.selectedId, detailsEditId: global.state?.detailsEdit?.id, domId: domSelectedNodeId() });
      return false;
    }
    const width = 760;
    const height = 600;
    const left = Math.max(0, Math.round((global.screen.availWidth - width) / 2));
    const top = Math.max(0, Math.round((global.screen.availHeight - height) / 2));
    const win = global.open("", "pocketStandalonePe", `popup=yes,width=${width},height=${height},left=${left},top=${top}`);
    if (!win) {
      if (typeof setStatus === "function") setStatus("Details popout blocked. Allow popups for pocket, then try Enter again.", "warn", { durationMs: 5200 });
      console.warn("[item details route] popup blocked");
      return false;
    }
    writeTextEditor(win, pePayloadForNode(node), clean(node.label, 220));
    win.focus();
    console.info("[item details route] opened text", { id: node.id, label: clean(node.label, 80) });
    return true;
  }

  document.addEventListener("keydown", function (ev) {
    if (ev.key !== "Enter" || ev.metaKey || ev.ctrlKey || ev.altKey || ev.shiftKey) return;
    if (global.state?.moveMode || global.state?.inlineEdit?.id || global.pendingPathImport) return;
    const capturedId = nodeIdFromEvent(ev) || domSelectedNodeId() || clean(global.state?.selectedId, 80);
    window.setTimeout(() => openPeForNode(capturedId), 0);
  }, true);

  global.PocketPeEditor = Object.freeze({ open: openPeForNode, getPayload, apply: applyPe });
  global.openPocketPeEditor = openPeForNode;
  console.info("[item details route] installed text mode");
})(window);
