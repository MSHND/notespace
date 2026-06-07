/* Standalone node popout editor.
   This editor reads directly from nodeMap/state and saves directly back to the
   node. It deliberately does not read the retired inline details editor fields
   or recover browser drafts. */

(function initialisePocketNodePopoutEditor(global) {
  "use strict";

  let editorWindow = null;
  const OUTLINE_EDITOR_SCHEMA = "pocket.nodeEditor.v1";

  function clean(value, max = 80) {
    return typeof cleanText === "function" ? cleanText(value, max) : String(value || "").trim().slice(0, max);
  }

  function normaliseDetailsSafe(value, max = 4000) {
    return typeof normaliseDetails === "function" ? normaliseDetails(value, max) : String(value || "").replace(/\r/g, "").trim().slice(0, max);
  }

  function htmlEscape(value) {
    return String(value || "").replace(/[&<>\"]/g, function (ch) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;" }[ch];
    });
  }

  function safeJson(value) {
    return JSON.stringify(value).replace(/</g, "\\u003c");
  }

  function getNode(input) {
    let id = "";
    if (typeof input === "string") id = clean(input, 80);
    else if (input && typeof input === "object") id = clean(input.id, 80);
    if (!id) id = clean(global.state?.selectedId, 80);
    if (!id || typeof nodeMap !== "function") return null;
    return nodeMap().get(id) || null;
  }

  function normaliseOutlineBlock(raw, index) {
    const depth = Number(raw?.depth);
    return {
      id: clean(raw?.id, 80) || (typeof makeId === "function" ? makeId("block") : "block_" + index),
      text: String(raw?.text == null ? "" : raw.text).replace(/\r/g, "").slice(0, 4000),
      depth: Number.isFinite(depth) ? Math.max(0, Math.min(8, Math.round(depth))) : 0,
      collapsed: raw?.collapsed === true,
      order: index + 1
    };
  }

  function normaliseEditorMeta(value) {
    if (!value || typeof value !== "object") return null;
    const mode = clean(value.mode, 24).toLowerCase() === "outline" ? "outline" : "text";
    if (mode !== "outline") return null;
    const outline = Array.isArray(value.outline) ? value.outline.slice(0, 400).map(normaliseOutlineBlock) : [];
    const meaningful = outline.some(function (block) {
      return (Number(block.depth) || 0) > 0 || block.collapsed === true || clean(block.text, 4000);
    });
    if (!meaningful) return null;
    return { schema: OUTLINE_EDITOR_SCHEMA, mode: "outline", outline: outline };
  }

  function payloadFromNode(node) {
    const editor = normaliseEditorMeta(node.editor) || null;
    return {
      id: clean(node.id, 80),
      title: clean(node.label, 220) || "Untitled",
      body: normaliseDetailsSafe(node.details, 4000),
      mode: editor?.mode || "text",
      outline: Array.isArray(editor?.outline) ? editor.outline : null,
      path: typeof getPath === "function" ? getPath(node.id) : "",
      openedAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };
  }

  function editorHtml(payload) {
    const initial = safeJson(payload);
    const safeTitle = htmlEscape(payload.title || "Untitled");
    const safePath = htmlEscape(payload.path || "");
    const safeBody = htmlEscape(payload.body || "");

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
  .brand { font-size: 13px; font-weight: 650; color: rgba(51, 65, 85, .72); white-space: nowrap; }
  button { border: 0; background: transparent; padding: 2px 4px; min-height: 24px; color: rgba(51, 65, 85, .82); cursor: pointer; font: inherit; font-size: 12px; font-weight: 620; }
  button:hover, button:focus-visible { color: rgba(15, 23, 42, .98); outline: none; background: rgba(148, 163, 184, .12); border-radius: 999px; }
  .mode button.on { color: rgba(15, 23, 42, .98); font-style: italic; }
  .status { min-width: 54px; color: rgba(100, 116, 139, .62); font-size: 11px; }
  .status.failed { color: rgba(127, 29, 29, .82); }
  .status.saved { color: rgba(22, 101, 52, .72); }
  .grow { flex: 1 1 auto; }
  .hint { color: rgba(100, 116, 139, .54); font-size: 11px; white-space: nowrap; }
  .dirty { opacity: 0; color: rgba(37, 99, 235, .8); }
  body.isDirty .dirty { opacity: 1; }
  .meta { padding: 10px 14px 3px; min-width: 0; }
  .titleLine { font-size: 12px; font-weight: 650; color: rgba(71, 85, 105, .72); }
  .path { margin-top: 1px; font-size: 11px; color: rgba(100, 116, 139, .58); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .fields { min-height: 0; padding: 8px 14px 14px; display: grid; grid-template-rows: auto minmax(0, 1fr); gap: 10px; }
  input, textarea, .outlinePane { width: 100%; border: 1px solid rgba(148, 163, 184, .18); border-radius: 15px; background: rgba(255, 255, 255, .96); color: rgba(15, 23, 42, .94); outline: none; box-shadow: 0 10px 24px -22px rgba(15, 23, 42, .38); }
  input { min-height: 42px; padding: 9px 11px; font-size: 17px; font-weight: 560; }
  textarea { min-height: 0; height: 100%; resize: none; padding: 14px; font: inherit; font-size: 16px; line-height: 1.52; }
  .outlinePane { min-height: 0; height: 100%; overflow: auto; padding: 10px 8px; }
  .outlineRow { display: grid; grid-template-columns: 20px minmax(0, 1fr); align-items: start; gap: 2px; min-height: 30px; padding: 1px 4px; border-radius: 9px; }
  .outlineRow:focus-within { background: rgba(241, 245, 249, .72); }
  .outlineToggle { width: 20px; min-height: 24px; border-radius: 9px; color: rgba(100, 116, 139, .7); cursor: grab; }
  .outlineToggle.empty { opacity: .35; }
  .outlineText { min-height: 26px; padding: 3px 6px; border-radius: 8px; outline: none; font-size: 16px; line-height: 1.45; white-space: pre-wrap; overflow-wrap: anywhere; }
  .outlineText:empty::before { content: "note"; color: rgba(100, 116, 139, .34); }
  body.textMode .outlinePane { display: none; }
  body.outlineMode textarea { display: none; }
</style>
</head>
<body class="textMode">
  <main class="wrap">
    <div class="topbar"><div class="brand">pocket editor <span class="dirty">*</span></div><button id="saveBtn" type="button">save</button><span id="saveState" class="status" aria-live="polite"></span><div class="mode" aria-label="Editor mode"><button id="textModeBtn" type="button">text</button><button id="outlineModeBtn" type="button">outline</button></div><div class="grow"></div><div class="hint">Tab indents branch · Ctrl+Enter saves</div><button id="closeBtn" type="button" aria-label="Close editor">×</button></div>
    <div class="meta"><div class="titleLine">editing</div><div class="path" title="${safePath}">${safePath}</div></div>
    <div class="fields"><input id="titleInput" value="${safeTitle}" aria-label="Item name"><textarea id="bodyInput" aria-label="Item details">${safeBody}</textarea><div id="outlinePane" class="outlinePane" aria-label="Item outline"></div></div>
  </main>
<script>
(function () {
  var payload = ${initial};
  var dirty = false;
  var allowedToClose = false;
  var mode = payload.mode === "outline" ? "outline" : "text";
  var outline = Array.isArray(payload.outline) ? payload.outline.map(function (b) { return { id: b.id || "", text: String(b.text || ""), depth: Math.max(0, Math.min(8, Number(b.depth) || 0)), collapsed: b.collapsed === true }; }) : null;
  var titleInput = document.getElementById("titleInput");
  var bodyInput = document.getElementById("bodyInput");
  var outlinePane = document.getElementById("outlinePane");
  var textModeBtn = document.getElementById("textModeBtn");
  var outlineModeBtn = document.getElementById("outlineModeBtn");
  var saveState = document.getElementById("saveState");
  function setSaveState(text, kind) { saveState.textContent = text || ""; saveState.className = "status" + (kind ? " " + kind : ""); }
  function setDirty(next) { dirty = !!next; document.body.classList.toggle("isDirty", dirty); if (dirty) setSaveState("", ""); }
  function makeBlock(text, depth) { return { id: "b_" + Date.now().toString(36) + "_" + Math.random().toString(36).slice(2, 8), text: String(text || ""), depth: Math.max(0, Math.min(8, Number(depth) || 0)), collapsed: false }; }
  function textToOutline(text) { return String(text || "").split("\\n").map(function (line) { var leading = (line.match(/^\s*/) || [""])[0].replace(/\t/g, "  ").length; return makeBlock(line.trimStart(), Math.floor(leading / 2)); }); }
  function outlineToText(blocks) { return (blocks || []).map(function (block) { return "  ".repeat(Math.max(0, Number(block.depth) || 0)) + String(block.text || ""); }).join("\\n"); }
  function hasChildren(index) { var here = outline[index]; var next = outline[index + 1]; return !!here && !!next && (Number(next.depth) || 0) > (Number(here.depth) || 0); }
  function isHidden(index) { var depth = Number(outline[index] && outline[index].depth) || 0; for (var i = index - 1; i >= 0; i -= 1) { var parentDepth = Number(outline[i] && outline[i].depth) || 0; if (parentDepth < depth && outline[i].collapsed) return true; } return false; }
  function updateModeChrome() { document.body.classList.toggle("textMode", mode === "text"); document.body.classList.toggle("outlineMode", mode === "outline"); textModeBtn.classList.toggle("on", mode === "text"); outlineModeBtn.classList.toggle("on", mode === "outline"); }
  function renderOutline(focusIndex) {
    if (!Array.isArray(outline) || outline.length === 0) outline = [makeBlock("", 0)];
    outlinePane.innerHTML = "";
    outline.forEach(function (block, index) {
      if (isHidden(index)) return;
      var row = document.createElement("div");
      row.className = "outlineRow";
      row.style.paddingLeft = (4 + (Number(block.depth) || 0) * 22) + "px";
      var toggle = document.createElement("button");
      toggle.type = "button";
      toggle.className = "outlineToggle" + (hasChildren(index) ? "" : " empty");
      toggle.textContent = hasChildren(index) ? (block.collapsed ? "▸" : "▾") : "•";
      toggle.addEventListener("click", function () { if (!hasChildren(index)) return; block.collapsed = !block.collapsed; setDirty(true); renderOutline(index); });
      var text = document.createElement("div");
      text.className = "outlineText";
      text.contentEditable = "true";
      text.spellcheck = true;
      text.textContent = block.text || "";
      text.addEventListener("input", function () { block.text = text.textContent || ""; setDirty(true); });
      text.addEventListener("keydown", function (ev) {
        if (ev.key === "Enter" && !ev.shiftKey) { ev.preventDefault(); outline.splice(index + 1, 0, makeBlock("", block.depth || 0)); setDirty(true); renderOutline(index + 1); return; }
        if (ev.key === "Tab") { ev.preventDefault(); var delta = ev.shiftKey ? -1 : 1; block.depth = Math.max(0, Math.min(8, (Number(block.depth) || 0) + delta)); setDirty(true); renderOutline(index); return; }
        if (ev.key === "Backspace" && !text.textContent && outline.length > 1) { ev.preventDefault(); outline.splice(index, 1); setDirty(true); renderOutline(Math.max(0, index - 1)); }
      });
      row.appendChild(toggle);
      row.appendChild(text);
      outlinePane.appendChild(row);
      if (index === focusIndex) requestAnimationFrame(function () { text.focus(); });
    });
  }
  function setMode(nextMode) { if (nextMode === "outline") { if (!outline) outline = textToOutline(bodyInput.value); mode = "outline"; updateModeChrome(); renderOutline(0); } else { if (outline) bodyInput.value = outlineToText(outline); mode = "text"; updateModeChrome(); bodyInput.focus({ preventScroll: true }); } setDirty(true); }
  function currentBody() { return mode === "outline" ? outlineToText(outline) : bodyInput.value; }
  function buildPayload() { return { id: payload.id, title: titleInput.value, body: currentBody(), mode: mode, outline: outline, updatedAt: new Date().toISOString() }; }
  function save() {
    setSaveState("saving…", "");
    try {
      if (window.opener && !window.opener.closed && window.opener.PocketNodePopoutEditor && typeof window.opener.PocketNodePopoutEditor.apply === "function") {
        var ok = window.opener.PocketNodePopoutEditor.apply(buildPayload());
        if (ok) { allowedToClose = true; dirty = false; setSaveState("saved", "saved"); window.setTimeout(function () { window.close(); }, 80); return; }
      }
    } catch (error) { console.error(error); }
    setSaveState("failed", "failed");
    alert("Pocket is not connected. Copy your text before closing.");
  }
  function closeSafely() { if (!dirty) { allowedToClose = true; window.close(); return; } if (confirm("Close without saving?")) { allowedToClose = true; window.close(); } }
  titleInput.addEventListener("input", function () { setDirty(true); });
  bodyInput.addEventListener("input", function () { setDirty(true); });
  document.getElementById("saveBtn").addEventListener("click", save);
  document.getElementById("closeBtn").addEventListener("click", closeSafely);
  textModeBtn.addEventListener("click", function () { setMode("text"); });
  outlineModeBtn.addEventListener("click", function () { setMode("outline"); });
  document.addEventListener("keydown", function (ev) { if (ev.key === "Escape") { ev.preventDefault(); closeSafely(); } if (ev.key === "Enter" && (ev.metaKey || ev.ctrlKey)) { ev.preventDefault(); save(); } });
  window.addEventListener("beforeunload", function (ev) { if (!dirty || allowedToClose) return; ev.preventDefault(); ev.returnValue = "Unsaved editor changes."; });
  updateModeChrome();
  if (mode === "outline") { if (!outline) outline = textToOutline(bodyInput.value); renderOutline(0); }
  titleInput.focus();
  titleInput.select();
})();
</script>
</body>
</html>`;
  }

  function open(input) {
    const node = getNode(input);
    if (!node) {
      if (typeof setStatus === "function") setStatus("Select an item first.", "warn");
      console.warn("[node popout editor] no node", { input, selectedId: global.state?.selectedId });
      return false;
    }

    const payload = payloadFromNode(node);
    const width = Math.min(820, Math.max(600, Math.round(global.screen.availWidth * 0.5)));
    const height = Math.min(820, Math.max(600, Math.round(global.screen.availHeight * 0.76)));
    const left = Math.round((global.screen.availWidth - width) / 2);
    const top = Math.round((global.screen.availHeight - height) / 2);
    editorWindow = global.open("", "pocketNodePopoutEditor", `popup=yes,width=${width},height=${height},left=${left},top=${top}`);
    if (!editorWindow) {
      if (typeof setStatus === "function") setStatus("Popout blocked. Allow popups for pocket, then try again.", "warn", { durationMs: 5200 });
      return false;
    }
    editorWindow.document.open();
    editorWindow.document.write(editorHtml(payload));
    editorWindow.document.close();
    editorWindow.focus();
    console.info("[node popout editor] opened", { id: payload.id, title: payload.title });
    return true;
  }

  function apply(payload) {
    const id = clean(payload?.id, 80);
    const node = getNode(id);
    if (!id || !node) {
      if (typeof setStatus === "function") setStatus("Editor item no longer exists.", "warn");
      return false;
    }

    const beforeLabel = clean(node.label, 220);
    const beforeDetails = normaliseDetailsSafe(node.details, 4000);
    const beforeEditor = JSON.stringify(normaliseEditorMeta(node.editor) || null);
    const nextLabel = clean(payload.title, 220) || beforeLabel || "Untitled";
    const nextDetails = normaliseDetailsSafe(payload.body, 4000);
    const editorMeta = normaliseEditorMeta(payload);
    const afterEditor = JSON.stringify(editorMeta || null);
    const changed = beforeLabel !== nextLabel || beforeDetails !== nextDetails || beforeEditor !== afterEditor;

    if (!changed) {
      if (typeof setStatus === "function") setStatus("No editor changes to save.", "ok");
      return true;
    }

    node.label = nextLabel;
    if (nextDetails) node.details = nextDetails;
    else delete node.details;
    if (editorMeta) node.editor = editorMeta;
    else delete node.editor;
    node.updatedAt = typeof nowIso === "function" ? nowIso() : new Date().toISOString();
    if (global.state) global.state.selectedId = id;

    if (typeof recordOp === "function") recordOp({ type: "details_edit", id: id, path: typeof getPath === "function" ? getPath(id) : "", changed: editorMeta ? "outline" : "details" });
    if (typeof refreshMeta === "function") refreshMeta();
    if (typeof renderTree === "function") renderTree();
    if (typeof focusRowByNodeId === "function") focusRowByNodeId(id, { instant: true });
    if (typeof saveWorkspaceState === "function") saveWorkspaceState();
    if (typeof persistPipSnapshot === "function") persistPipSnapshot();
    if (typeof setStatus === "function") setStatus(editorMeta ? `Saved outline for "${clean(node.label, 80)}".` : `Saved details for "${clean(node.label, 80)}".`, "ok");
    console.info("[node popout editor] saved", { id: id, changed: editorMeta ? "outline" : "details" });
    return true;
  }

  global.PocketNodePopoutEditor = Object.freeze({ open: open, apply: apply });
})(window);
