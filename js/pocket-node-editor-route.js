/* Minimal standalone PE route.
   Enter opens a separate popout editor connected to the selected node via node.pe.
   It deliberately does not read from or write to the old inline details editor. */
(function initialisePocketPeRoute(global) {
  "use strict";

  const PE_SCHEMA = "pocket.pe.v1";

  function clean(value, max = 80) {
    return typeof cleanText === "function" ? cleanText(value, max) : String(value || "").trim().slice(0, max);
  }

  function safeJson(value) {
    return JSON.stringify(value).replace(/</g, "\\u003c");
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

  function writeEditorShell(win, payload) {
    const initial = safeJson(payload);
    const doc = win.document;
    doc.open();
    doc.write(`<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>pocket PE</title>
<style>
  * { box-sizing: border-box; }
  html, body { height: 100%; }
  body { margin: 0; font-family: system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; background: #fbfbf8; color: #0f172a; overflow: hidden; }
  .wrap { height: 100vh; display: grid; grid-template-rows: auto minmax(0,1fr); }
  .bar { display: flex; align-items: center; gap: 10px; padding: 8px 12px; border-bottom: 1px solid rgba(148,163,184,.24); background: rgba(255,255,255,.72); }
  .brand { font-size: 13px; font-weight: 650; color: rgba(51,65,85,.8); max-width: 190px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .grow { flex: 1 1 auto; }
  button { border: 0; background: transparent; padding: 4px 7px; border-radius: 999px; font: inherit; font-size: 12px; color: rgba(51,65,85,.82); cursor: pointer; }
  button:hover, button:focus-visible { background: rgba(148,163,184,.16); outline: none; color: #0f172a; }
  button.on { font-style: italic; color: #0f172a; background: rgba(148,163,184,.12); }
  .status { min-width: 80px; font-size: 11px; color: rgba(100,116,139,.72); }
  .hint { font-size: 11px; color: rgba(100,116,139,.58); white-space: nowrap; }
  .main { min-height: 0; padding: 14px; display: grid; grid-template-rows: auto minmax(0,1fr); gap: 10px; }
  input, textarea, .outline { width: 100%; border: 1px solid rgba(148,163,184,.22); border-radius: 15px; background: rgba(255,255,255,.96); color: #0f172a; outline: none; box-shadow: 0 10px 24px -22px rgba(15,23,42,.38); }
  input { min-height: 42px; padding: 9px 12px; font-size: 17px; font-weight: 560; }
  textarea { height: 100%; min-height: 0; resize: none; padding: 14px; font: inherit; font-size: 16px; line-height: 1.52; }
  .outline { height: 100%; min-height: 0; overflow: auto; padding: 10px 8px; user-select: none; }
  .row { display: grid; grid-template-columns: 22px minmax(0,1fr); align-items: start; gap: 4px; min-height: 30px; padding: 1px 4px; border-radius: 9px; }
  .row:focus-within { background: rgba(241,245,249,.82); }
  .row.selected { background: rgba(191,219,254,.72); }
  .row.selected:focus-within { background: rgba(147,197,253,.56); }
  .toggle { width: 22px; min-height: 25px; color: rgba(100,116,139,.75); }
  .toggle.empty { opacity: .38; cursor: default; }
  .text { min-height: 26px; padding: 3px 6px; border-radius: 8px; outline: none; font-size: 16px; line-height: 1.45; white-space: pre-wrap; overflow-wrap: anywhere; user-select: text; }
  .text:empty::before { content: "note"; color: rgba(100,116,139,.34); }
  body.textMode .outline { display: none; }
  body.outlineMode textarea { display: none; }
</style>
</head>
<body class="outlineMode">
  <main class="wrap">
    <div class="bar">
      <div id="brand" class="brand">PE</div>
      <button id="saveBtn" type="button">save</button>
      <span id="status" class="status">connected</span>
      <button id="textBtn" type="button">text</button>
      <button id="outlineBtn" type="button">outline</button>
      <div class="grow"></div>
      <div class="hint">Drag rows to select · Ctrl+C copies range</div>
      <button id="closeBtn" type="button">×</button>
    </div>
    <section class="main">
      <input id="title" aria-label="PE title">
      <textarea id="body" aria-label="PE text editor"></textarea>
      <div id="outline" class="outline" aria-label="PE outline editor"></div>
    </section>
  </main>
<script>
(function () {
  var payload = ${initial};
  var mode = payload.mode === "text" ? "text" : "outline";
  var blocks = Array.isArray(payload.outline) && payload.outline.length ? payload.outline : [{ id: "pe_blank", text: "", depth: 0, collapsed: false }];
  var selected = new Set();
  var anchorIndex = 0;
  var dragSelecting = false;
  var dirty = false;
  var title = document.getElementById("title");
  var body = document.getElementById("body");
  var outline = document.getElementById("outline");
  var textBtn = document.getElementById("textBtn");
  var outlineBtn = document.getElementById("outlineBtn");
  var status = document.getElementById("status");
  document.getElementById("brand").textContent = "PE · " + (payload.nodeLabel || "node");
  title.value = payload.title || "";
  body.value = payload.text || "";
  function block(text, depth, collapsed) { return { id: "b" + Date.now().toString(36) + Math.random().toString(36).slice(2,6), text: text || "", depth: Math.max(0, Math.min(8, depth || 0)), collapsed: collapsed === true }; }
  function hasChild(i) { return blocks[i + 1] && Number(blocks[i + 1].depth || 0) > Number(blocks[i].depth || 0); }
  function hidden(i) { var depth = Number(blocks[i].depth || 0); for (var x = i - 1; x >= 0; x -= 1) { if (Number(blocks[x].depth || 0) < depth) return blocks[x].collapsed === true || hidden(x); } return false; }
  function outlineToText() { return blocks.map(function (b) { return "  ".repeat(Math.max(0, Number(b.depth || 0))) + String(b.text || ""); }).join("\\n"); }
  function textToOutline() { blocks = body.value.split("\\n").map(function (line) { var lead = (line.match(/^\\s*/) || [""])[0].replace(/\\t/g, "  ").length; return block(line.trimStart(), Math.floor(lead / 2), false); }); if (!blocks.length) blocks = [block("", 0, false)]; selected.clear(); anchorIndex = 0; }
  function setStatus(text) { status.textContent = text || "connected"; }
  function setDirty() { dirty = true; setStatus("editing"); }
  function setMode(next) { if (next === mode) return; if (next === "outline") { textToOutline(); mode = "outline"; } else { body.value = outlineToText(); mode = "text"; } setDirty(); render(); }
  function selectRange(from, to) { selected.clear(); var a = Math.min(from, to); var b = Math.max(from, to); for (var i = a; i <= b; i += 1) { if (!hidden(i)) selected.add(i); } setStatus(selected.size + " rows selected"); render(to); }
  function copySelected() { if (!selected.size) return false; var indexes = Array.from(selected).sort(function (a, b) { return a - b; }); var text = indexes.map(function (i) { var b = blocks[i]; return "  ".repeat(Math.max(0, Number(b.depth || 0))) + String(b.text || ""); }).join("\\n"); if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(text).then(function () { setStatus("copied " + indexes.length + " rows"); }); return true; }
  function currentText() { return mode === "outline" ? outlineToText() : body.value; }
  function save() {
    var outgoing = { nodeId: payload.nodeId, title: title.value, mode: mode, text: currentText(), outline: blocks };
    try {
      if (window.opener && window.opener.PocketPeEditor && typeof window.opener.PocketPeEditor.apply === "function") {
        var ok = window.opener.PocketPeEditor.apply(outgoing);
        if (ok) { dirty = false; setStatus("saved"); return; }
      }
    } catch (error) { console.error(error); }
    setStatus("save failed");
  }
  function render(focusIndex) {
    document.body.classList.toggle("textMode", mode === "text");
    document.body.classList.toggle("outlineMode", mode === "outline");
    textBtn.classList.toggle("on", mode === "text");
    outlineBtn.classList.toggle("on", mode === "outline");
    outline.innerHTML = "";
    blocks.forEach(function (b, i) {
      if (hidden(i)) return;
      var row = document.createElement("div"); row.className = "row" + (selected.has(i) ? " selected" : ""); row.style.paddingLeft = (4 + Math.max(0, b.depth || 0) * 24) + "px";
      row.addEventListener("mousedown", function (ev) { if (ev.button !== 0) return; if (ev.shiftKey) selectRange(anchorIndex, i); else { selected.clear(); selected.add(i); anchorIndex = i; setStatus("1 row selected"); render(i); } dragSelecting = true; ev.preventDefault(); });
      row.addEventListener("mouseenter", function () { if (!dragSelecting) return; selectRange(anchorIndex, i); });
      var t = document.createElement("button"); t.type = "button"; t.className = "toggle" + (hasChild(i) ? "" : " empty"); t.textContent = hasChild(i) ? (b.collapsed ? "▸" : "▾") : "•";
      t.addEventListener("click", function (ev) { ev.stopPropagation(); if (!hasChild(i)) return; b.collapsed = !b.collapsed; setDirty(); render(i); });
      var text = document.createElement("div"); text.className = "text"; text.contentEditable = "true"; text.spellcheck = true; text.textContent = b.text || "";
      text.addEventListener("focus", function () { if (!selected.has(i)) { selected.clear(); selected.add(i); anchorIndex = i; render(i); } });
      text.addEventListener("input", function () { b.text = text.textContent || ""; setDirty(); });
      text.addEventListener("keydown", function (ev) {
        if ((ev.ctrlKey || ev.metaKey) && ev.key.toLowerCase() === "c" && selected.size > 1) { ev.preventDefault(); copySelected(); return; }
        if (ev.key === "Enter" && !ev.shiftKey) { ev.preventDefault(); blocks.splice(i + 1, 0, block("", b.depth || 0, false)); selected.clear(); selected.add(i + 1); anchorIndex = i + 1; setDirty(); render(i + 1); return; }
        if (ev.key === "Tab") { ev.preventDefault(); b.depth = Math.max(0, Math.min(8, (b.depth || 0) + (ev.shiftKey ? -1 : 1))); setDirty(); render(i); return; }
        if (ev.key === "Backspace" && !text.textContent && blocks.length > 1) { ev.preventDefault(); blocks.splice(i, 1); selected.clear(); selected.add(Math.max(0, i - 1)); anchorIndex = Math.max(0, i - 1); setDirty(); render(Math.max(0, i - 1)); }
      });
      row.appendChild(t); row.appendChild(text); outline.appendChild(row);
      if (i === focusIndex) requestAnimationFrame(function () { text.focus(); });
    });
  }
  document.addEventListener("mouseup", function () { dragSelecting = false; });
  document.addEventListener("keydown", function (ev) { if ((ev.ctrlKey || ev.metaKey) && ev.key.toLowerCase() === "s") { ev.preventDefault(); save(); } if ((ev.ctrlKey || ev.metaKey) && ev.key.toLowerCase() === "c" && selected.size > 1) { ev.preventDefault(); copySelected(); } });
  title.addEventListener("input", setDirty);
  body.addEventListener("input", setDirty);
  textBtn.addEventListener("click", function () { setMode("text"); });
  outlineBtn.addEventListener("click", function () { setMode("outline"); });
  document.getElementById("saveBtn").addEventListener("click", save);
  document.getElementById("closeBtn").addEventListener("click", function () { if (!dirty || confirm("Close without saving?")) window.close(); });
  selected.add(0);
  render(0);
})();
</script>
</body>
</html>`);
    doc.close();
  }

  function openPeForSelectedNode() {
    const node = selectedNode();
    if (!node) {
      if (typeof setStatus === "function") setStatus("Select a node first.", "warn");
      return false;
    }
    const payload = normalisePe(node.pe, node);
    const width = 720;
    const height = 560;
    const left = Math.max(0, Math.round((global.screen.availWidth - width) / 2));
    const top = Math.max(0, Math.round((global.screen.availHeight - height) / 2));
    const win = global.open("", "pocketStandalonePe", `popup=yes,width=${width},height=${height},left=${left},top=${top}`);
    if (!win) {
      if (typeof setStatus === "function") setStatus("PE popout blocked. Allow popups for pocket, then try Enter again.", "warn", { durationMs: 5200 });
      return false;
    }
    writeEditorShell(win, payload);
    win.focus();
    console.info("[pe route] opened", { id: node.id, label: clean(node.label, 80) });
    return true;
  }

  document.addEventListener("keydown", function (ev) {
    if (ev.key !== "Enter" || ev.metaKey || ev.ctrlKey || ev.altKey || ev.shiftKey) return;
    if (global.state?.moveMode || global.state?.inlineEdit?.id || global.pendingPathImport) return;
    // Still deliberately do not preventDefault/stopPropagation. The old inline
    // editor may open too while PE proves itself separately.
    openPeForSelectedNode();
  }, true);

  global.PocketPeEditor = Object.freeze({ open: openPeForSelectedNode, apply: applyPe });
  global.openPocketNodeEditorSmokeTest = openPeForSelectedNode;
  console.info("[pe route] installed");
})(window);
