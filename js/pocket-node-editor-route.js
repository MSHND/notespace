/* Minimal standalone editor route test.
   Enter opens a separate popout with an outline-capable editor shell. It does
   not block the existing inline editor and is not connected to node content yet. */
(function initialisePocketNodeEditorRouteSmokeTest(global) {
  "use strict";

  function writeEditorShell(win) {
    const doc = win.document;
    doc.open();
    doc.write(`<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>pocket editor smoke test</title>
<style>
  * { box-sizing: border-box; }
  html, body { height: 100%; }
  body { margin: 0; font-family: system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; background: #fbfbf8; color: #0f172a; overflow: hidden; }
  .wrap { height: 100vh; display: grid; grid-template-rows: auto minmax(0,1fr); }
  .bar { display: flex; align-items: center; gap: 10px; padding: 8px 12px; border-bottom: 1px solid rgba(148,163,184,.24); background: rgba(255,255,255,.72); }
  .brand { font-size: 13px; font-weight: 650; color: rgba(51,65,85,.8); }
  .grow { flex: 1 1 auto; }
  button { border: 0; background: transparent; padding: 4px 7px; border-radius: 999px; font: inherit; font-size: 12px; color: rgba(51,65,85,.82); cursor: pointer; }
  button:hover, button:focus-visible { background: rgba(148,163,184,.16); outline: none; color: #0f172a; }
  button.on { font-style: italic; color: #0f172a; background: rgba(148,163,184,.12); }
  .status { min-width: 90px; font-size: 11px; color: rgba(100,116,139,.72); }
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
      <div class="brand">standalone editor test</div>
      <button id="saveBtn" type="button">save</button>
      <span id="status" class="status">not connected</span>
      <button id="textBtn" type="button">text</button>
      <button id="outlineBtn" type="button">outline</button>
      <div class="grow"></div>
      <div class="hint">Drag rows to select · Ctrl+C copies range</div>
      <button id="closeBtn" type="button">×</button>
    </div>
    <section class="main">
      <input id="title" value="Untitled test note" aria-label="Title">
      <textarea id="body" aria-label="Text editor">This is a disconnected test editor.</textarea>
      <div id="outline" class="outline" aria-label="Outline editor"></div>
    </section>
  </main>
<script>
(function () {
  var mode = "outline";
  var blocks = [
    { id: "a", text: "First outline point", depth: 0, collapsed: false },
    { id: "b", text: "Child point", depth: 1, collapsed: false },
    { id: "c", text: "Second outline point", depth: 0, collapsed: false }
  ];
  var selected = new Set();
  var anchorIndex = 0;
  var dragSelecting = false;
  var body = document.getElementById("body");
  var outline = document.getElementById("outline");
  var textBtn = document.getElementById("textBtn");
  var outlineBtn = document.getElementById("outlineBtn");
  var status = document.getElementById("status");
  function block(text, depth) { return { id: "b" + Date.now().toString(36) + Math.random().toString(36).slice(2,6), text: text || "", depth: Math.max(0, Math.min(8, depth || 0)), collapsed: false }; }
  function hasChild(i) { return blocks[i + 1] && Number(blocks[i + 1].depth || 0) > Number(blocks[i].depth || 0); }
  function hidden(i) { var depth = Number(blocks[i].depth || 0); for (var x = i - 1; x >= 0; x -= 1) { if (Number(blocks[x].depth || 0) < depth) return blocks[x].collapsed === true || hidden(x); } return false; }
  function visibleIndexes() { return blocks.map(function (_, i) { return i; }).filter(function (i) { return !hidden(i); }); }
  function outlineToText() { return blocks.map(function (b) { return "  ".repeat(Math.max(0, Number(b.depth || 0))) + String(b.text || ""); }).join("\\n"); }
  function textToOutline() { blocks = body.value.split("\\n").map(function (line) { var lead = (line.match(/^\\s*/) || [""])[0].replace(/\\t/g, "  ").length; return block(line.trimStart(), Math.floor(lead / 2)); }); if (!blocks.length) blocks = [block("", 0)]; selected.clear(); anchorIndex = 0; }
  function setStatus(text) { status.textContent = text || "not connected"; }
  function setMode(next) { if (next === mode) return; if (next === "outline") { textToOutline(); mode = "outline"; } else { body.value = outlineToText(); mode = "text"; } render(); }
  function selectOne(i) { selected.clear(); selected.add(i); anchorIndex = i; setStatus("1 row selected"); render(i); }
  function selectRange(from, to) { selected.clear(); var a = Math.min(from, to); var b = Math.max(from, to); for (var i = a; i <= b; i += 1) { if (!hidden(i)) selected.add(i); } setStatus(selected.size + " rows selected"); render(to); }
  function copySelected() {
    if (!selected.size) return false;
    var indexes = Array.from(selected).sort(function (a, b) { return a - b; });
    var text = indexes.map(function (i) { var b = blocks[i]; return "  ".repeat(Math.max(0, Number(b.depth || 0))) + String(b.text || ""); }).join("\\n");
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(function () { setStatus("copied " + indexes.length + " rows"); }).catch(function () { setStatus("copy failed"); });
    } else {
      var ta = document.createElement("textarea"); ta.value = text; document.body.appendChild(ta); ta.select(); document.execCommand("copy"); ta.remove(); setStatus("copied " + indexes.length + " rows");
    }
    return true;
  }
  function render(focusIndex) {
    document.body.classList.toggle("textMode", mode === "text");
    document.body.classList.toggle("outlineMode", mode === "outline");
    textBtn.classList.toggle("on", mode === "text");
    outlineBtn.classList.toggle("on", mode === "outline");
    outline.innerHTML = "";
    blocks.forEach(function (b, i) {
      if (hidden(i)) return;
      var row = document.createElement("div"); row.className = "row" + (selected.has(i) ? " selected" : ""); row.style.paddingLeft = (4 + Math.max(0, b.depth || 0) * 24) + "px"; row.dataset.index = String(i);
      row.addEventListener("mousedown", function (ev) { if (ev.button !== 0) return; if (ev.shiftKey) selectRange(anchorIndex, i); else { selected.clear(); selected.add(i); anchorIndex = i; setStatus("1 row selected"); render(i); } dragSelecting = true; ev.preventDefault(); });
      row.addEventListener("mouseenter", function () { if (!dragSelecting) return; selectRange(anchorIndex, i); });
      var t = document.createElement("button"); t.type = "button"; t.className = "toggle" + (hasChild(i) ? "" : " empty"); t.textContent = hasChild(i) ? (b.collapsed ? "▸" : "▾") : "•";
      t.addEventListener("click", function (ev) { ev.stopPropagation(); if (!hasChild(i)) return; b.collapsed = !b.collapsed; render(i); });
      var text = document.createElement("div"); text.className = "text"; text.contentEditable = "true"; text.spellcheck = true; text.textContent = b.text || "";
      text.addEventListener("focus", function () { if (!selected.has(i)) { selected.clear(); selected.add(i); anchorIndex = i; render(i); } });
      text.addEventListener("input", function () { b.text = text.textContent || ""; setStatus("editing"); });
      text.addEventListener("keydown", function (ev) {
        if ((ev.ctrlKey || ev.metaKey) && ev.key.toLowerCase() === "c" && selected.size > 1) { ev.preventDefault(); copySelected(); return; }
        if (ev.key === "Enter" && !ev.shiftKey) { ev.preventDefault(); blocks.splice(i + 1, 0, block("", b.depth || 0)); selected.clear(); selected.add(i + 1); anchorIndex = i + 1; setStatus("new point"); render(i + 1); return; }
        if (ev.key === "Tab") { ev.preventDefault(); b.depth = Math.max(0, Math.min(8, (b.depth || 0) + (ev.shiftKey ? -1 : 1))); setStatus("outline moved"); render(i); return; }
        if (ev.key === "Backspace" && !text.textContent && blocks.length > 1) { ev.preventDefault(); blocks.splice(i, 1); selected.clear(); selected.add(Math.max(0, i - 1)); anchorIndex = Math.max(0, i - 1); setStatus("removed point"); render(Math.max(0, i - 1)); }
      });
      row.appendChild(t); row.appendChild(text); outline.appendChild(row);
      if (i === focusIndex) requestAnimationFrame(function () { text.focus(); });
    });
  }
  document.addEventListener("mouseup", function () { dragSelecting = false; });
  document.addEventListener("keydown", function (ev) { if ((ev.ctrlKey || ev.metaKey) && ev.key.toLowerCase() === "c" && selected.size > 1) { ev.preventDefault(); copySelected(); } });
  textBtn.addEventListener("click", function () { setMode("text"); });
  outlineBtn.addEventListener("click", function () { setMode("outline"); });
  document.getElementById("saveBtn").addEventListener("click", function () { setStatus("save not connected yet"); });
  document.getElementById("closeBtn").addEventListener("click", function () { window.close(); });
  selected.add(0);
  render(0);
})();
</script>
</body>
</html>`);
    doc.close();
  }

  function openOutlineTestPopout() {
    const width = 720;
    const height = 560;
    const left = Math.max(0, Math.round((global.screen.availWidth - width) / 2));
    const top = Math.max(0, Math.round((global.screen.availHeight - height) / 2));
    const win = global.open("", "pocketStandaloneEditorSmokeTest", `popup=yes,width=${width},height=${height},left=${left},top=${top}`);
    if (!win) {
      if (typeof setStatus === "function") setStatus("Test popout blocked. Allow popups for pocket, then try Enter again.", "warn", { durationMs: 5200 });
      console.warn("[node editor route smoke] popup blocked");
      return false;
    }
    writeEditorShell(win);
    win.focus();
    console.info("[node editor route smoke] outline popup opened");
    return true;
  }

  document.addEventListener("keydown", function (ev) {
    if (ev.key !== "Enter" || ev.metaKey || ev.ctrlKey || ev.altKey || ev.shiftKey) return;
    if (global.state?.moveMode || global.state?.inlineEdit?.id || global.pendingPathImport) return;
    // Deliberately do not preventDefault/stopPropagation. The existing inline
    // editor should still open too while we prove the separate popout path.
    openOutlineTestPopout();
  }, true);

  global.openPocketNodeEditorSmokeTest = openOutlineTestPopout;
  console.info("[node editor route smoke] outline mode installed");
})(window);
