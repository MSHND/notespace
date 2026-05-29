/* Popout editor v2.
   Direct node-bound editor: no hidden detail-editor fields, no shared stale popout window. */

(function initialisePocketEditorPopoutV2(global) {
  "use strict";

  const previousApply = global.PocketEditorPopout && typeof global.PocketEditorPopout.apply === "function"
    ? global.PocketEditorPopout.apply
    : null;
  const OUTLINE_EDITOR_SCHEMA = "pocket.nodeEditor.v1";
  const DRAFT_KEY_PREFIX = "pocket.editorPopoutDraft.v2.";

  function clean(value, max = 80) {
    return typeof cleanText === "function" ? cleanText(value, max) : String(value || "").trim().slice(0, max);
  }

  function htmlEscape(value) {
    return String(value || "").replace(/[&<>"]/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[ch]));
  }

  function details(value) {
    return typeof normaliseDetails === "function" ? normaliseDetails(value, 4000) : String(value || "").replace(/\r/g, "").trim();
  }

  function getNode(id) {
    return id && typeof nodeMap === "function" ? nodeMap().get(id) || null : null;
  }

  function selectedNode() {
    const id = clean(global.state?.selectedId, 80);
    return getNode(id);
  }

  function draftKeyFor(id) {
    return `${DRAFT_KEY_PREFIX}${clean(id, 80) || "unknown"}`;
  }

  function normaliseOutlineBlock(raw = {}, index = 0) {
    const depth = Number(raw.depth);
    return {
      id: clean(raw.id, 80) || `block_${index + 1}`,
      text: String(raw.text == null ? "" : raw.text).replace(/\r/g, "").slice(0, 4000),
      depth: Number.isFinite(depth) ? Math.max(0, Math.min(8, Math.round(depth))) : 0,
      collapsed: raw.collapsed === true,
      order: index + 1
    };
  }

  function normaliseEditorMeta(value = {}) {
    if (!value || typeof value !== "object") return null;
    const mode = clean(value.mode, 24).toLowerCase() === "outline" ? "outline" : "text";
    if (mode !== "outline") return null;
    const outline = Array.isArray(value.outline) ? value.outline.slice(0, 400).map(normaliseOutlineBlock) : [];
    const meaningful = outline.some((block) => (Number(block.depth) || 0) > 0 || block.collapsed === true);
    if (!meaningful) return null;
    return { schema: OUTLINE_EDITOR_SCHEMA, mode: "outline", outline };
  }

  function buildPayloadFromNode(node) {
    const editor = normaliseEditorMeta(node.editor);
    return {
      id: node.id,
      title: clean(node.label, 220) || "Untitled",
      body: details(node.details),
      mode: editor?.mode || "text",
      outline: Array.isArray(editor?.outline) ? editor.outline : null,
      path: typeof getPath === "function" ? getPath(node.id) : clean(node.label, 220),
      openedAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };
  }

  function readDraft(id) {
    try {
      const parsed = JSON.parse(global.localStorage.getItem(draftKeyFor(id)) || "null");
      if (!parsed || typeof parsed !== "object") return null;
      if (clean(parsed.id, 80) !== clean(id, 80)) return null;
      return parsed;
    } catch (_error) {
      return null;
    }
  }

  function clearDraft(id) {
    try { global.localStorage.removeItem(draftKeyFor(id)); } catch (_error) {}
  }

  function editorHtml(payload) {
    const stored = readDraft(payload.id);
    const source = stored && stored.dirty ? { ...payload, ...stored } : payload;
    const initial = JSON.stringify({
      id: payload.id,
      title: source.title || "",
      body: source.body || "",
      mode: source.mode || "text",
      outline: Array.isArray(source.outline) ? source.outline : null,
      dirty: !!stored?.dirty,
      draftKey: draftKeyFor(payload.id)
    });
    const safePath = htmlEscape(payload.path || "");
    return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>pocket editor</title>
<style>
  * { box-sizing: border-box; }
  html, body { height: 100%; }
  body { margin: 0; overflow: hidden; background: #fbfbf8; color: rgba(15,23,42,.94); font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Arial, sans-serif; }
  .wrap { height: 100vh; display: grid; grid-template-rows: auto auto minmax(0, 1fr); }
  .topbar { display: flex; align-items: center; gap: 12px; min-height: 40px; padding: 7px 44px 6px 14px; border-bottom: 1px solid rgba(148,163,184,.14); position: relative; }
  button { border: 0; background: transparent; font: inherit; color: rgba(51,65,85,.82); cursor: pointer; padding: 2px 3px; }
  button:hover, button:focus-visible { color: rgba(15,23,42,.98); outline: none; }
  .brand { font-size: 13px; font-weight: 700; color: rgba(51,65,85,.72); }
  .dirtyDot { color: rgba(37,99,235,.8); opacity: 0; }
  body.dirty .dirtyDot { opacity: 1; }
  .mode.on { color: rgba(15,23,42,.98); font-style: italic; font-weight: 650; }
  .state { min-width: 44px; font-size: 11px; color: rgba(100,116,139,.7); }
  .close { position: absolute; right: 10px; top: 6px; width: 26px; height: 26px; border-radius: 999px; font-size: 21px; line-height: 21px; }
  .meta { padding: 10px 14px 4px; }
  .metaTitle { font-size: 12px; font-weight: 700; color: rgba(71,85,105,.72); }
  .path { margin-top: 1px; font-size: 11px; color: rgba(100,116,139,.62); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .fields { min-height: 0; padding: 8px 14px 14px; display: grid; grid-template-rows: auto minmax(0, 1fr); gap: 10px; }
  input, textarea, .outline { width: 100%; border: 1px solid rgba(148,163,184,.18); border-radius: 15px; background: rgba(255,255,255,.96); color: rgba(15,23,42,.94); outline: none; box-shadow: 0 10px 24px -22px rgba(15,23,42,.38); }
  input { min-height: 42px; padding: 9px 11px; font-size: 17px; font-weight: 560; }
  textarea { min-height: 0; height: 100%; resize: none; padding: 14px; font: inherit; font-size: 16px; line-height: 1.52; }
  .outline { min-height: 0; height: 100%; overflow: auto; padding: 10px 8px; display: none; }
  body.outlineMode textarea { display: none; }
  body.outlineMode .outline { display: block; }
  .row { display: grid; grid-template-columns: 20px minmax(0, 1fr); gap: 3px; min-height: 30px; align-items: start; border-radius: 9px; padding: 1px 4px; }
  .row:focus-within { background: rgba(241,245,249,.72); }
  .dot { color: rgba(100,116,139,.65); cursor: grab; user-select: none; }
  .text { min-height: 26px; padding: 3px 6px; border-radius: 8px; outline: none; font-size: 16px; line-height: 1.45; white-space: pre-wrap; overflow-wrap: anywhere; }
  .text:empty::before { content: "note"; color: rgba(100,116,139,.34); }
</style>
</head>
<body>
<main class="wrap">
  <div class="topbar"><div class="brand">pocket editor <span class="dirtyDot">*</span></div><button id="saveBtn">save</button><span id="state" class="state"></span><button id="textBtn" class="mode">text</button><button id="outlineBtn" class="mode">outline</button><button id="closeBtn" class="close" title="Close">×</button></div>
  <div class="meta"><div class="metaTitle">editing</div><div class="path" title="${safePath}">${safePath}</div></div>
  <div class="fields"><input id="title" aria-label="Item name"><textarea id="body" aria-label="Item details"></textarea><div id="outline" class="outline"></div></div>
</main>
<script>
(function () {
  const initial = ${initial};
  const title = document.getElementById("title");
  const body = document.getElementById("body");
  const outlineEl = document.getElementById("outline");
  const state = document.getElementById("state");
  let mode = initial.mode === "outline" ? "outline" : "text";
  let dirty = !!initial.dirty;
  let outline = Array.isArray(initial.outline) ? initial.outline : null;
  let dragging = null;
  let allowedClose = false;
  title.value = initial.title || "";
  body.value = initial.body || "";
  function makeBlock(text, depth) { return { id: "b_" + Math.random().toString(36).slice(2), text: String(text || ""), depth: Math.max(0, Math.min(8, Number(depth) || 0)), collapsed: false }; }
  function textToOutline(text) { return String(text || "").split("\\n").map(line => { const lead = (line.match(/^\\s*/) || [""])[0].replace(/\\t/g, "  ").length; return makeBlock(line.trimStart(), Math.floor(lead / 2)); }); }
  function outlineToText() { return (outline || []).map(b => "  ".repeat(Math.max(0, Number(b.depth) || 0)) + String(b.text || "")).join("\\n"); }
  function subtreeEnd(index) { const base = Number(outline[index]?.depth) || 0; let end = index + 1; while (end < outline.length && (Number(outline[end]?.depth) || 0) > base) end++; return end; }
  function setState(text) { state.textContent = text || ""; }
  function setDirty(next) { dirty = !!next; document.body.classList.toggle("dirty", dirty); }
  function currentBody() { return mode === "outline" ? outlineToText() : body.value; }
  function draft() { return { id: initial.id, title: title.value, body: currentBody(), mode, outline, dirty, draftKey: initial.draftKey }; }
  function storeDraft() { try { localStorage.setItem(initial.draftKey, JSON.stringify(draft())); } catch(e) {} }
  function clearDraft() { try { localStorage.removeItem(initial.draftKey); } catch(e) {} }
  function markDirty() { setDirty(true); setState(""); storeDraft(); }
  function updateMode() { document.body.classList.toggle("outlineMode", mode === "outline"); document.getElementById("textBtn").classList.toggle("on", mode === "text"); document.getElementById("outlineBtn").classList.toggle("on", mode === "outline"); }
  function renderOutline(focus) { if (!outline || !outline.length) outline = [makeBlock("", 0)]; outlineEl.innerHTML = ""; outline.forEach((block, index) => { const row = document.createElement("div"); row.className = "row"; row.style.paddingLeft = (4 + (Number(block.depth) || 0) * 22) + "px"; const dot = document.createElement("div"); dot.className = "dot"; dot.textContent = "•"; dot.draggable = true; dot.addEventListener("dragstart", ev => { dragging = index; ev.dataTransfer.setData("text/plain", String(index)); }); row.addEventListener("dragover", ev => { if (dragging == null) return; ev.preventDefault(); }); row.addEventListener("drop", ev => { if (dragging == null) return; ev.preventDefault(); const from = dragging; dragging = null; const end = subtreeEnd(from); const branch = outline.slice(from, end); outline.splice(from, branch.length); let to = index > from ? index - branch.length : index; outline.splice(Math.max(0, Math.min(outline.length, to)), 0, ...branch); markDirty(); renderOutline(to); }); const text = document.createElement("div"); text.className = "text"; text.contentEditable = "true"; text.textContent = block.text || ""; text.addEventListener("input", () => { block.text = text.textContent || ""; markDirty(); }); text.addEventListener("keydown", ev => { if (ev.key === "Enter" && !ev.shiftKey) { ev.preventDefault(); outline.splice(index + 1, 0, makeBlock("", block.depth || 0)); markDirty(); renderOutline(index + 1); } else if (ev.key === "Tab") { ev.preventDefault(); const delta = ev.shiftKey ? -1 : 1; const end = subtreeEnd(index); for (let i = index; i < end; i++) outline[i].depth = Math.max(0, Math.min(8, (Number(outline[i].depth) || 0) + delta)); markDirty(); renderOutline(index); } }); row.appendChild(dot); row.appendChild(text); outlineEl.appendChild(row); }); if (Number.isFinite(focus)) requestAnimationFrame(() => { const t = outlineEl.children[focus]?.querySelector(".text"); if (t) t.focus(); }); }
  function setMode(next) { if (next === mode) return; if (next === "outline") { outline = textToOutline(body.value); mode = "outline"; renderOutline(0); } else { body.value = outlineToText(); mode = "text"; body.focus(); } updateMode(); markDirty(); }
  function payload() { return { id: initial.id, title: title.value, body: currentBody(), mode, outline, updatedAt: new Date().toISOString() }; }
  function save() { setState("saving…"); storeDraft(); try { if (opener && !opener.closed && opener.PocketEditorPopout && typeof opener.PocketEditorPopout.apply === "function") { const ok = opener.PocketEditorPopout.apply(payload()); if (ok) { allowedClose = true; clearDraft(); setDirty(false); setState("saved"); setTimeout(() => window.close(), 80); return; } } } catch (e) { console.error(e); } setState("failed"); alert("Pocket did not accept the save. Your draft is still stored in this editor."); }
  function closeSafely() { if (!dirty) { allowedClose = true; window.close(); return; } if (confirm("Save changes before closing?")) { save(); return; } if (confirm("Close without saving?")) { clearDraft(); allowedClose = true; setDirty(false); window.close(); } }
  title.addEventListener("input", markDirty); body.addEventListener("input", markDirty); document.getElementById("saveBtn").addEventListener("click", save); document.getElementById("closeBtn").addEventListener("click", closeSafely); document.getElementById("textBtn").addEventListener("click", () => setMode("text")); document.getElementById("outlineBtn").addEventListener("click", () => setMode("outline")); document.addEventListener("keydown", ev => { if (ev.key === "Escape") { ev.preventDefault(); closeSafely(); } if (ev.key === "Enter" && (ev.metaKey || ev.ctrlKey)) { ev.preventDefault(); save(); } }); window.addEventListener("beforeunload", ev => { if (!dirty || allowedClose) return; storeDraft(); ev.preventDefault(); ev.returnValue = "Unsaved editor changes."; }); if (mode === "outline") { if (!outline) outline = textToOutline(body.value); renderOutline(0); } updateMode(); setDirty(dirty); title.focus(); title.select();
})();
</script>
</body>
</html>`;
  }

  function apply(payload) {
    if (previousApply) return previousApply(payload);
    return false;
  }

  function open() {
    const node = selectedNode();
    if (!node) {
      if (typeof setStatus === "function") setStatus("Select an item first.", "warn");
      return false;
    }
    const payload = buildPayloadFromNode(node);
    const name = `pocketEditor_${clean(node.id, 80).replace(/[^a-z0-9_\-]/gi, "_")}`;
    const width = Math.min(860, Math.max(620, Math.round(global.screen.availWidth * 0.55)));
    const height = Math.min(840, Math.max(620, Math.round(global.screen.availHeight * 0.78)));
    const left = Math.round((global.screen.availWidth - width) / 2);
    const top = Math.round((global.screen.availHeight - height) / 2);
    const win = global.open("", name, `popup=yes,width=${width},height=${height},left=${left},top=${top}`);
    if (!win) {
      if (typeof setStatus === "function") setStatus("Popout blocked. Allow popups for pocket, then try again.", "warn", { durationMs: 5200 });
      return false;
    }
    win.document.open();
    win.document.write(editorHtml(payload));
    win.document.close();
    win.focus();
    return true;
  }

  global.PocketEditorPopout = Object.freeze({ open, apply });
  global.PocketEditorPopoutV2 = Object.freeze({ open });
})(window);
