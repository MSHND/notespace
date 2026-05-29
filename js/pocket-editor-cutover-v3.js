/* Editor cutover v3.
   Edit now opens the node-bound popout editor directly. The retired inline
   details editor is hidden and is no longer used as a source of truth. */

(function initialisePocketEditorCutoverV3(global) {
  "use strict";

  console.info("[editor cutover v3] loaded");

  const popoutApply = global.PocketEditorPopout && typeof global.PocketEditorPopout.apply === "function"
    ? global.PocketEditorPopout.apply.bind(global.PocketEditorPopout)
    : null;

  let editorWindow = null;

  function clean(value, max = 80) {
    return typeof cleanText === "function" ? cleanText(value, max) : String(value || "").trim().slice(0, max);
  }

  function details(value, max = 4000) {
    return typeof normaliseDetails === "function" ? normaliseDetails(value, max) : String(value || "").replace(/\r/g, "").trim().slice(0, max);
  }

  function htmlEscape(value) {
    return String(value || "").replace(/[&<>\"]/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;" }[ch]));
  }

  function safeJson(value) {
    return JSON.stringify(value).replace(/</g, "\\u003c");
  }

  function selectedNode(input) {
    let id = "";
    if (typeof input === "string") id = clean(input, 80);
    else if (input && typeof input === "object") id = clean(input.id, 80);
    if (!id) id = clean(global.state?.selectedId, 80);
    return id && typeof nodeMap === "function" ? nodeMap().get(id) || null : null;
  }

  function nodePayload(node) {
    const editor = node && node.editor && typeof node.editor === "object" ? node.editor : null;
    const mode = clean(editor?.mode, 24).toLowerCase() === "outline" ? "outline" : "text";
    const outline = Array.isArray(editor?.outline) ? editor.outline : null;
    return {
      id: clean(node.id, 80),
      title: clean(node.label, 220) || "Untitled",
      body: details(node.details, 4000),
      mode,
      outline,
      path: typeof getPath === "function" ? getPath(node.id) : "",
      openedAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };
  }

  function retireInlineEditor() {
    const overlay = document.getElementById("detailOverlay");
    if (overlay instanceof HTMLElement) overlay.hidden = true;
    if (global.state?.detailsEdit) {
      global.state.detailsEdit.id = "";
      global.state.detailsEdit.originalLabel = "";
      global.state.detailsEdit.originalDetails = "";
      global.state.detailsEdit.originalUrgent = false;
      global.state.detailsEdit.originalCopyContext = false;
    }
  }

  function clearPopoutDraftsForNode(id) {
    try {
      [
        `pocket.editorPopoutDraft.v1.${id}`,
        `pocket.editorPopoutDraft.v2.${id}`,
        "pocket.editorPopoutDraft.v1.unknown",
        "pocket.editorPopoutDraft.v2.unknown"
      ].forEach((key) => global.localStorage.removeItem(key));
    } catch (_error) {}
  }

  function editorHtml(payload) {
    const safeTitle = htmlEscape(payload.title || "Untitled");
    const safePath = htmlEscape(payload.path || "");
    const safeBody = htmlEscape(payload.body || "");
    const initial = safeJson(payload);
    return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>pocket editor</title>
<style>
  * { box-sizing: border-box; }
  html, body { height: 100%; }
  body { margin: 0; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Arial, sans-serif; background: #fbfbf8; color: rgba(15, 23, 42, .94); overflow: hidden; }
  .wrap { height: 100vh; display: grid; grid-template-rows: auto auto minmax(0, 1fr); }
  .topbar { display: flex; align-items: center; gap: 10px; min-height: 38px; padding: 6px 12px; border-bottom: 1px solid rgba(148, 163, 184, .16); background: rgba(251, 251, 248, .98); }
  .brand { font-size: 13px; font-weight: 650; color: rgba(51, 65, 85, .72); }
  button { border: 0; background: transparent; padding: 2px 4px; min-height: 24px; color: rgba(51, 65, 85, .82); cursor: pointer; font: inherit; font-size: 12px; font-weight: 620; }
  button:hover, button:focus-visible { color: rgba(15, 23, 42, .98); outline: none; background: rgba(148, 163, 184, .12); border-radius: 999px; }
  .mode button.on { color: rgba(15, 23, 42, .98); font-style: italic; }
  .status { min-width: 52px; color: rgba(100, 116, 139, .62); font-size: 11px; }
  .grow { flex: 1 1 auto; }
  .hint { color: rgba(100, 116, 139, .54); font-size: 11px; white-space: nowrap; }
  .dirty { opacity: 0; color: rgba(37, 99, 235, .8); }
  body.isDirty .dirty { opacity: 1; }
  .meta { padding: 10px 14px 3px; }
  .titleLine { font-size: 12px; font-weight: 650; color: rgba(71, 85, 105, .72); }
  .path { margin-top: 1px; font-size: 11px; color: rgba(100, 116, 139, .58); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .fields { min-height: 0; padding: 8px 14px 14px; display: grid; grid-template-rows: auto minmax(0, 1fr); gap: 10px; }
  input, textarea, .outlinePane { width: 100%; border: 1px solid rgba(148, 163, 184, .18); border-radius: 15px; background: rgba(255, 255, 255, .96); color: rgba(15, 23, 42, .94); outline: none; box-shadow: 0 10px 24px -22px rgba(15, 23, 42, .38); }
  input { min-height: 42px; padding: 9px 11px; font-size: 17px; font-weight: 560; }
  textarea { min-height: 0; height: 100%; resize: none; padding: 14px; font: inherit; font-size: 16px; line-height: 1.52; }
  .outlinePane { min-height: 0; height: 100%; overflow: auto; padding: 10px 8px; }
  .outlineRow { display: grid; grid-template-columns: 20px minmax(0, 1fr); align-items: start; gap: 2px; min-height: 30px; padding: 1px 4px; border-radius: 9px; }
  .outlineRow:focus-within { background: rgba(241, 245, 249, .72); }
  .dot { width: 20px; min-height: 24px; border-radius: 9px; color: rgba(100, 116, 139, .7); cursor: grab; }
  .text { min-height: 26px; padding: 3px 6px; border-radius: 8px; outline: none; font-size: 16px; line-height: 1.45; white-space: pre-wrap; overflow-wrap: anywhere; }
  .text:empty::before { content: "note"; color: rgba(100, 116, 139, .34); }
  body.textMode .outlinePane { display: none; }
  body.outlineMode textarea { display: none; }
</style>
</head>
<body class="textMode">
  <main class="wrap">
    <div class="topbar"><div class="brand">pocket editor <span class="dirty">*</span></div><button id="saveBtn" type="button">save</button><span id="status" class="status"></span><div class="mode"><button id="textBtn" type="button">text</button><button id="outlineBtn" type="button">outline</button></div><div class="grow"></div><div class="hint">Tab indents branch · Ctrl+Enter saves</div><button id="closeBtn" type="button">×</button></div>
    <div class="meta"><div class="titleLine">editing</div><div class="path" title="${safePath}">${safePath}</div></div>
    <div class="fields"><input id="title" value="${safeTitle}" aria-label="Item name"><textarea id="body" aria-label="Item details">${safeBody}</textarea><div id="outline" class="outlinePane" aria-label="Item outline"></div></div>
  </main>
<script>
(function () {
  const payload = ${initial};
  let dirty = false;
  let mode = payload.mode === "outline" ? "outline" : "text";
  let outline = Array.isArray(payload.outline) ? payload.outline.map(function (b) { return { id: b.id || "", text: String(b.text || ""), depth: Math.max(0, Math.min(8, Number(b.depth) || 0)), collapsed: b.collapsed === true }; }) : null;
  const title = document.getElementById("title");
  const body = document.getElementById("body");
  const pane = document.getElementById("outline");
  const status = document.getElementById("status");
  const textBtn = document.getElementById("textBtn");
  const outlineBtn = document.getElementById("outlineBtn");
  function setStatus(text) { status.textContent = text || ""; }
  function setDirty(next) { dirty = !!next; document.body.classList.toggle("isDirty", dirty); if (dirty) setStatus(""); }
  function makeBlock(text, depth) { return { id: "b_" + Date.now().toString(36) + "_" + Math.random().toString(36).slice(2, 8), text: String(text || ""), depth: Math.max(0, Math.min(8, Number(depth) || 0)), collapsed: false }; }
  function textToOutline(text) { return String(text || "").split("\\n").map(function (line) { const leading = (line.match(/^\\s*/) || [""])[0].replace(/\\t/g, "  ").length; return makeBlock(line.trimStart(), Math.floor(leading / 2)); }); }
  function outlineToText(blocks) { return (blocks || []).map(function (block) { return "  ".repeat(Math.max(0, Number(block.depth) || 0)) + String(block.text || ""); }).join("\\n"); }
  function updateChrome() { document.body.classList.toggle("textMode", mode === "text"); document.body.classList.toggle("outlineMode", mode === "outline"); textBtn.classList.toggle("on", mode === "text"); outlineBtn.classList.toggle("on", mode === "outline"); }
  function renderOutline(focusIndex) {
    if (!Array.isArray(outline) || outline.length === 0) outline = [makeBlock("", 0)];
    pane.innerHTML = "";
    outline.forEach(function (block, index) {
      const row = document.createElement("div");
      row.className = "outlineRow";
      row.style.paddingLeft = (4 + (Number(block.depth) || 0) * 22) + "px";
      const dot = document.createElement("button");
      dot.type = "button";
      dot.className = "dot";
      dot.textContent = "•";
      const text = document.createElement("div");
      text.className = "text";
      text.contentEditable = "true";
      text.spellcheck = true;
      text.textContent = block.text || "";
      text.addEventListener("input", function () { block.text = text.textContent || ""; setDirty(true); });
      text.addEventListener("keydown", function (ev) {
        if (ev.key === "Enter" && !ev.shiftKey) { ev.preventDefault(); outline.splice(index + 1, 0, makeBlock("", block.depth || 0)); setDirty(true); renderOutline(index + 1); return; }
        if (ev.key === "Tab") { ev.preventDefault(); const delta = ev.shiftKey ? -1 : 1; block.depth = Math.max(0, Math.min(8, (Number(block.depth) || 0) + delta)); setDirty(true); renderOutline(index); return; }
        if (ev.key === "Backspace" && !text.textContent && outline.length > 1) { ev.preventDefault(); outline.splice(index, 1); setDirty(true); renderOutline(Math.max(0, index - 1)); }
      });
      row.appendChild(dot);
      row.appendChild(text);
      pane.appendChild(row);
      if (index === focusIndex) requestAnimationFrame(function () { text.focus(); });
    });
  }
  function setMode(next) {
    if (next === "outline") { if (!outline) outline = textToOutline(body.value); mode = "outline"; updateChrome(); renderOutline(0); }
    else { if (outline) body.value = outlineToText(outline); mode = "text"; updateChrome(); body.focus({ preventScroll: true }); }
    setDirty(true);
  }
  function currentBody() { return mode === "outline" ? outlineToText(outline) : body.value; }
  function buildPayload() { return { id: payload.id, title: title.value, body: currentBody(), mode: mode, outline: outline, updatedAt: new Date().toISOString() }; }
  function save() {
    setStatus("saving…");
    try {
      if (window.opener && !window.opener.closed && typeof window.opener.PocketEditorCutoverSave === "function") {
        const ok = window.opener.PocketEditorCutoverSave(buildPayload());
        if (ok) { dirty = false; window.close(); return; }
      }
    } catch (error) { console.error(error); }
    setStatus("failed");
    alert("Pocket is not connected. Copy your text before closing.");
  }
  function closeSafely() { if (!dirty || confirm("Close without saving?")) window.close(); }
  title.addEventListener("input", function () { setDirty(true); });
  body.addEventListener("input", function () { setDirty(true); });
  document.getElementById("saveBtn").addEventListener("click", save);
  document.getElementById("closeBtn").addEventListener("click", closeSafely);
  textBtn.addEventListener("click", function () { setMode("text"); });
  outlineBtn.addEventListener("click", function () { setMode("outline"); });
  document.addEventListener("keydown", function (ev) { if (ev.key === "Escape") { ev.preventDefault(); closeSafely(); } if (ev.key === "Enter" && (ev.ctrlKey || ev.metaKey)) { ev.preventDefault(); save(); } });
  window.addEventListener("beforeunload", function (ev) { if (!dirty) return; ev.preventDefault(); ev.returnValue = "Unsaved editor changes."; });
  updateChrome();
  if (mode === "outline") { if (!outline) outline = textToOutline(body.value); renderOutline(0); }
  title.focus();
  title.select();
})();
</script>
</body>
</html>`;
  }

  function openNodePopout(node) {
    const payload = nodePayload(node);
    clearPopoutDraftsForNode(payload.id);
    const width = Math.min(820, Math.max(600, Math.round(global.screen.availWidth * 0.5)));
    const height = Math.min(820, Math.max(600, Math.round(global.screen.availHeight * 0.76)));
    const left = Math.round((global.screen.availWidth - width) / 2);
    const top = Math.round((global.screen.availHeight - height) / 2);
    editorWindow = global.open("", "pocketEditorPopout", `popup=yes,width=${width},height=${height},left=${left},top=${top}`);
    if (!editorWindow) {
      if (typeof setStatus === "function") setStatus("Popout blocked. Allow popups for pocket, then try again.", "warn", { durationMs: 5200 });
      return false;
    }
    editorWindow.document.open();
    editorWindow.document.write(editorHtml(payload));
    editorWindow.document.close();
    editorWindow.focus();
    return true;
  }

  function openDirect(input) {
    const node = selectedNode(input);
    console.info("[editor cutover v3] edit requested", { selectedId: clean(global.state?.selectedId, 80), requested: clean(input?.id || input, 80), label: clean(node?.label, 80), hasApply: !!popoutApply });
    if (!node) {
      if (typeof setStatus === "function") setStatus("Select an item first.", "warn");
      return false;
    }
    if (!popoutApply) {
      if (typeof setStatus === "function") setStatus("Editor save bridge is not available.", "warn");
      return false;
    }
    global.state.selectedId = node.id;
    retireInlineEditor();
    const ok = openNodePopout(node);
    window.setTimeout(retireInlineEditor, 0);
    window.setTimeout(retireInlineEditor, 80);
    window.setTimeout(retireInlineEditor, 240);
    console.info("[editor cutover v3] direct popout result", { ok, id: node.id });
    return ok;
  }

  function saveFromPopout(payload) {
    if (!popoutApply) return false;
    const ok = !!popoutApply(payload);
    retireInlineEditor();
    return ok;
  }

  function eatAndOpen(ev) {
    if (ev) {
      ev.preventDefault();
      ev.stopPropagation();
      ev.stopImmediatePropagation();
    }
    if (typeof closeCommandPalette === "function") closeCommandPalette({ restoreFocus: false });
    if (typeof closeRowMiniMenu === "function") closeRowMiniMenu({ restoreFocus: false });
    return openDirect();
  }

  function rowFromEvent(ev) {
    const target = ev.target instanceof HTMLElement ? ev.target : null;
    return target ? target.closest("[data-node-id]") : null;
  }

  function clickCapture(ev) {
    const target = ev.target instanceof HTMLElement ? ev.target : null;
    if (!target) return;
    const row = rowFromEvent(ev);
    if (row instanceof HTMLElement) {
      const rowId = clean(row.getAttribute("data-node-id"), 80);
      if (rowId && (target.closest("#cmdEdit") || target.closest(".rowMiniMenuBtn"))) global.state.selectedId = rowId;
    }
    if (target.closest("#btnOpenPrimary") || target.closest("#cmdEdit") || target.closest("#btnDetailPopout")) {
      eatAndOpen(ev);
      return;
    }
    const menuButton = target.closest(".rowMiniMenuBtn");
    if (menuButton && clean(menuButton.textContent, 40).toLowerCase().startsWith("edit")) eatAndOpen(ev);
  }

  function doubleClickCapture(ev) {
    const row = rowFromEvent(ev);
    if (!(row instanceof HTMLElement)) return;
    const id = clean(row.getAttribute("data-node-id"), 80);
    if (!id) return;
    global.state.selectedId = id;
    eatAndOpen(ev);
  }

  function keyCapture(ev) {
    if (ev.key !== "Enter" || ev.metaKey || ev.ctrlKey || ev.altKey || ev.shiftKey) return;
    if (global.state?.moveMode || global.state?.inlineEdit?.id || global.pendingPathImport) return;
    const node = selectedNode();
    if (!node) return;
    if (typeof shouldCopyOnSingleClick === "function") {
      const hasKids = typeof sortNodesForParent === "function" ? sortNodesForParent(node.id).length > 0 : false;
      if (shouldCopyOnSingleClick(node, hasKids)) return;
    }
    eatAndOpen(ev);
  }

  function install() {
    retireInlineEditor();
    global.PocketEditorCutoverSave = saveFromPopout;
    global.openPocketNodeEditor = openDirect;
    global.openPocketEditor = openDirect;
    global.openDetailsEditorForSelectedNode = openDirect;
    global.openDetailsEditorForNode = openDirect;
    document.addEventListener("click", clickCapture, true);
    document.addEventListener("dblclick", doubleClickCapture, true);
    const treeWrap = document.getElementById("treeWrap");
    if (treeWrap) treeWrap.addEventListener("keydown", keyCapture, true);
    else document.addEventListener("keydown", keyCapture, true);
    console.info("[editor cutover v3] installed", { hasApply: !!popoutApply });
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", install, { once: true });
  else install();
})(window);
