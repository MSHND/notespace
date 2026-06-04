/* Simple standalone PE editor override.
   Uses the main-window PE apply-and-save bridge, but writes a plain fresh
   editor window so body text and outline inputs are ordinary editable fields. */
(function initialisePocketPeSimpleStandalone(global) {
  "use strict";

  const PE_VERSION_LABEL = "PE · simple v0.4";

  function clean(value, max = 80) {
    return typeof cleanText === "function" ? cleanText(value, max) : String(value || "").trim().slice(0, max);
  }

  function escapeHtml(value) {
    return String(value || "").replace(/[&<>"]/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;" }[ch]));
  }

  function getSelectedNodeId(preferredId = "") {
    const direct = clean(preferredId, 80);
    if (direct) return direct;
    const stateId = clean(global.state?.selectedId, 80);
    if (stateId) return stateId;
    const active = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const row = active ? active.closest("[data-node-id]") : document.querySelector(".row.selected[data-node-id]");
    return row instanceof HTMLElement ? clean(row.getAttribute("data-node-id"), 80) : "";
  }

  function makeId() {
    return "line_" + Math.random().toString(36).slice(2, 9);
  }

  function normaliseOutline(items) {
    const source = Array.isArray(items) && items.length ? items : [{ id: makeId(), text: "", depth: 0, collapsed: false, order: 1000 }];
    return source.map((line, index) => ({
      id: clean(line && line.id, 80) || makeId(),
      text: String(line && line.text || "").replace(/\r/g, "").slice(0, 1200),
      depth: Math.max(0, Math.min(8, Number(line && line.depth) || 0)),
      collapsed: line && line.collapsed === true,
      order: (index + 1) * 1000
    }));
  }

  function writeSimpleEditor(win, payload) {
    const safePayload = {
      nodeId: clean(payload && payload.nodeId, 80),
      title: clean(payload && payload.title, 220),
      mode: payload && payload.mode === "outline" ? "outline" : "text",
      text: String(payload && payload.text || "").replace(/\r/g, "").slice(0, 12000),
      outline: normaliseOutline(payload && payload.outline)
    };

    win.document.open();
    win.document.write(`<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>item details</title>
<style>
  * { box-sizing: border-box; }
  html, body { height: 100%; }
  body { height: 100vh; margin: 0; display: flex; flex-direction: column; overflow: hidden; font-family: system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; background: #fbfbf8; color: #0f172a; }
  .bar { flex: 0 0 auto; display: flex; align-items: center; gap: 10px; min-height: 42px; padding: 8px 12px; border-bottom: 1px solid rgba(148,163,184,.24); background: rgba(255,255,255,.94); }
  .brand { font-size: 12px; font-weight: 750; color: rgba(15,23,42,.86); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 220px; }
  .status { font-size: 11px; color: rgba(100,116,139,.82); min-width: 150px; }
  .grow { flex: 1 1 auto; }
  button { border: 0; border-radius: 999px; background: transparent; padding: 5px 9px; font: inherit; font-size: 12px; color: rgba(51,65,85,.88); cursor: pointer; }
  button:hover, button:focus-visible, button.active { background: rgba(148,163,184,.18); color: #0f172a; outline: none; }
  button:disabled { opacity: .56; cursor: default; }
  main { flex: 1 1 auto; min-height: 0; display: flex; flex-direction: column; padding: 14px; gap: 12px; position: relative; }
  .titlePanel { flex: 0 0 auto; border: 1px solid rgba(148,163,184,.24); border-radius: 15px; background: rgba(255,255,255,.74); padding: 10px 14px 11px; box-shadow: 0 10px 24px -24px rgba(15,23,42,.36); }
  .titleLabel { display: block; margin: 0 0 4px; font-size: 10px; font-weight: 700; letter-spacing: .08em; text-transform: uppercase; color: rgba(100,116,139,.78); }
  #title { width: 100%; border: 0; border-radius: 0; background: transparent; box-shadow: none; min-height: 36px; padding: 0; font: inherit; font-size: 22px; font-weight: 650; letter-spacing: -0.02em; color: #0f172a; outline: none; }
  .bodyPanel { flex: 1 1 auto; min-height: 0; display: flex; flex-direction: column; border-top: 1px solid rgba(148,163,184,.28); padding-top: 12px; }
  #text { flex: 1 1 auto; width: 100%; min-height: 0; height: auto; border: 1px solid rgba(148,163,184,.22); border-radius: 15px; background: rgba(255,255,255,.96); padding: 14px; resize: none; font: inherit; font-size: 16px; line-height: 1.52; color: #0f172a; outline: none; pointer-events: auto; user-select: text; }
  #outline { display: none; flex: 1 1 auto; min-height: 0; overflow: auto; border: 1px solid rgba(148,163,184,.22); border-radius: 15px; background: rgba(255,255,255,.96); padding: 12px 14px; pointer-events: auto; user-select: text; }
  body.outlineMode #text { display: none; }
  body.outlineMode #outline { display: block; }
  .outlineRow { display: grid; grid-template-columns: 22px minmax(0, 1fr); align-items: center; min-height: 32px; }
  .outlineTwist { width: 22px; color: rgba(71,85,105,.72); user-select: none; }
  .outlineInput { width: 100%; min-height: 30px; border: 0; border-radius: 0; background: transparent; padding: 4px 6px; font: inherit; font-size: 15px; color: #0f172a; outline: none; box-shadow: none; pointer-events: auto; user-select: text; }
  .outlineInput:focus { background: rgba(255,255,255,.52); }
  .peVersion { position: fixed; right: 10px; bottom: 7px; z-index: 2; font-size: 9px; letter-spacing: .02em; color: rgba(100,116,139,.34); user-select: none; pointer-events: none; }
</style>
</head>
<body>
  <div class="bar">
    <div class="brand">item details</div>
    <button id="modeText" type="button">text</button>
    <button id="modeOutline" type="button">outline</button>
    <button id="saveBtn" type="button">save</button>
    <span id="status" class="status">ready</span>
    <div class="grow"></div>
    <button id="closeBtn" type="button">×</button>
  </div>
  <main>
    <section class="titlePanel" aria-label="Item title">
      <span class="titleLabel">title</span>
      <input id="title" aria-label="Item details title">
    </section>
    <section class="bodyPanel" aria-label="Item body">
      <textarea id="text" aria-label="Item details text" spellcheck="true"></textarea>
      <div id="outline" aria-label="Item details outline"></div>
    </section>
  </main>
  <div class="peVersion" title="${escapeHtml(PE_VERSION_LABEL)} · ${escapeHtml(safePayload.nodeId)}">${escapeHtml(PE_VERSION_LABEL)}</div>
<script>
(function () {
  var nodeId = ${JSON.stringify(safePayload.nodeId)};
  var mode = ${JSON.stringify(safePayload.mode)};
  var outline = ${JSON.stringify(safePayload.outline)};
  var dirty = false;
  var title = document.getElementById("title");
  var text = document.getElementById("text");
  var outlineEl = document.getElementById("outline");
  var status = document.getElementById("status");
  var modeText = document.getElementById("modeText");
  var modeOutline = document.getElementById("modeOutline");
  var saveBtn = document.getElementById("saveBtn");

  title.value = ${JSON.stringify(safePayload.title)};
  text.value = ${JSON.stringify(safePayload.text)};

  function makeId() { return "line_" + Math.random().toString(36).slice(2, 9); }
  function setStatus(value) { status.textContent = value || "ready"; }
  function markDirty() { dirty = true; window.__pocketPeDirty = true; setStatus("editing"); }
  function markClean(message) { dirty = false; window.__pocketPeDirty = false; setStatus(message || "saved"); }
  function lineDepth(line) { return Math.max(0, Math.min(8, Number(line && line.depth) || 0)); }
  function normaliseLine(line, index) {
    return { id: line.id || makeId(), text: String(line.text || "").slice(0, 1200), depth: lineDepth(line), collapsed: false, order: (index + 1) * 1000 };
  }
  function cleanedOutline() {
    var cleaned = outline.map(normaliseLine);
    while (cleaned.length > 1 && !String(cleaned[cleaned.length - 1].text || "").trim()) cleaned.pop();
    if (!cleaned.length) cleaned.push({ id: makeId(), text: "", depth: 0, collapsed: false, order: 1000 });
    return cleaned;
  }
  function outlineIndexFromInput(input) {
    if (!input || !input.dataset) return -1;
    var lineId = input.dataset.lineId || "";
    return outline.findIndex(function (line) { return line && line.id === lineId; });
  }
  function focusOutlineLine(id) {
    requestAnimationFrame(function () {
      var next = outlineEl.querySelector('[data-line-id="' + id + '"]');
      if (next) next.focus({ preventScroll: true });
    });
  }
  function insertOutlineLineAfter(index) {
    var current = outline[index] || { depth: 0 };
    var newLine = { id: makeId(), text: "", depth: lineDepth(current), collapsed: false, order: 0 };
    outline.splice(Math.max(0, index + 1), 0, newLine);
    markDirty();
    renderOutline(newLine.id);
  }
  function handleOutlineKey(ev, input, line, index) {
    var key = ev.key || "";
    if (key === "Enter" || ev.keyCode === 13) {
      ev.preventDefault();
      ev.stopPropagation();
      insertOutlineLineAfter(index);
      return true;
    }
    if (key === "Tab" || ev.keyCode === 9) {
      ev.preventDefault();
      ev.stopPropagation();
      line.depth = ev.shiftKey ? Math.max(0, lineDepth(line) - 1) : Math.min(8, lineDepth(line) + 1);
      markDirty();
      renderOutline(line.id);
      return true;
    }
    if ((key === "Backspace" || ev.keyCode === 8) && !input.value && outline.length > 1) {
      ev.preventDefault();
      ev.stopPropagation();
      var previous = outline[Math.max(0, index - 1)];
      outline.splice(index, 1);
      markDirty();
      renderOutline(previous.id);
      return true;
    }
    return false;
  }
  function renderOutline(focusId) {
    outlineEl.innerHTML = "";
    outline = cleanedOutline();
    outline.forEach(function (line, index) {
      var row = document.createElement("div");
      row.className = "outlineRow";
      row.style.paddingLeft = (lineDepth(line) * 22) + "px";
      var twist = document.createElement("div");
      twist.className = "outlineTwist";
      twist.textContent = "·";
      var input = document.createElement("input");
      input.className = "outlineInput";
      input.type = "text";
      input.value = line.text || "";
      input.dataset.lineId = line.id;
      input.addEventListener("input", function () { line.text = input.value; markDirty(); });
      input.addEventListener("keydown", function (ev) { handleOutlineKey(ev, input, line, index); });
      row.appendChild(twist);
      row.appendChild(input);
      outlineEl.appendChild(row);
    });
    if (focusId) focusOutlineLine(focusId);
  }
  outlineEl.addEventListener("keydown", function (ev) {
    var input = ev.target instanceof HTMLInputElement && ev.target.classList.contains("outlineInput") ? ev.target : null;
    if (!input) return;
    var index = outlineIndexFromInput(input);
    if (index < 0) return;
    handleOutlineKey(ev, input, outline[index], index);
  }, true);
  function setMode(nextMode) {
    mode = nextMode === "outline" ? "outline" : "text";
    document.body.classList.toggle("outlineMode", mode === "outline");
    modeText.classList.toggle("active", mode === "text");
    modeOutline.classList.toggle("active", mode === "outline");
    if (mode === "outline") renderOutline();
  }
  function save() {
    setStatus("saving…");
    saveBtn.disabled = true;
    try {
      if (window.opener && !window.opener.closed && typeof window.opener.__pocketPeApplyAndSave === "function") {
        var payload = { nodeId: nodeId, title: title.value, mode: mode, text: text.value, outline: cleanedOutline() };
        Promise.resolve(window.opener.__pocketPeApplyAndSave(payload)).then(function (result) {
          if (result && result.ok && result.saved) {
            markClean("saved");
          } else if (result && result.ok && result.applied) {
            markClean("saved here · use main save once");
          } else {
            setStatus((result && result.message) || "save failed");
          }
        }).catch(function (error) {
          console.error(error);
          setStatus("save failed");
        }).finally(function () {
          saveBtn.disabled = false;
        });
        return;
      }
    } catch (error) {
      console.error(error);
    }
    saveBtn.disabled = false;
    setStatus("save failed");
  }

  title.addEventListener("input", markDirty);
  text.addEventListener("input", markDirty);
  modeText.addEventListener("click", function () { setMode("text"); text.focus(); });
  modeOutline.addEventListener("click", function () { setMode("outline"); var first = outlineEl.querySelector(".outlineInput"); if (first) first.focus(); });
  saveBtn.addEventListener("click", save);
  document.getElementById("closeBtn").addEventListener("click", function () { if (!dirty || confirm("Close without saving?")) window.close(); });
  document.addEventListener("keydown", function (ev) { if ((ev.ctrlKey || ev.metaKey) && ev.key.toLowerCase() === "s") { ev.preventDefault(); save(); } });
  setMode(mode);
  requestAnimationFrame(function () { if (mode === "outline") { var first = outlineEl.querySelector(".outlineInput"); if (first) first.focus(); } else text.focus(); });
})();
</script>
</body>
</html>`);
    win.document.close();
  }

  function openSimple(nodeId = "") {
    const base = global.PocketPeEditor;
    const id = getSelectedNodeId(nodeId);
    const payload = base && typeof base.getPayload === "function" ? base.getPayload(id) : null;
    if (!payload) {
      if (typeof setStatus === "function") setStatus("Select an item first.", "warn");
      return false;
    }
    const width = 760;
    const height = 620;
    const left = Math.max(0, Math.round((global.screen.availWidth - width) / 2));
    const top = Math.max(0, Math.round((global.screen.availHeight - height) / 2));
    const win = global.open("", `pocketSimplePe_${clean(payload.nodeId, 40)}_${Date.now()}`, `popup=yes,width=${width},height=${height},left=${left},top=${top}`);
    if (!win) {
      if (typeof setStatus === "function") setStatus("Details popout blocked. Allow popups for pocket, then try again.", "warn", { durationMs: 5200 });
      return false;
    }
    writeSimpleEditor(win, payload);
    win.focus();
    console.info("[simple standalone PE] opened", { id: payload.nodeId, version: PE_VERSION_LABEL });
    return true;
  }

  function install() {
    const base = global.PocketPeEditor;
    if (!base || typeof base.getPayload !== "function" || typeof base.apply !== "function") {
      window.setTimeout(install, 120);
      return;
    }
    global.PocketPeEditor = Object.freeze({ ...base, open: openSimple, __simpleStandalone: true });
    global.openPocketPeEditor = openSimple;
    console.info("[simple standalone PE] installed", PE_VERSION_LABEL);
  }

  install();
})(window);
