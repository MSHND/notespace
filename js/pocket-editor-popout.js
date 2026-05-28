/* Editor popout: minimal writing surface with safer drafts and first-pass outline mode. */

(function initialisePocketEditorPopout(global) {
  "use strict";

  let editorWindow = null;
  const DRAFT_KEY_PREFIX = "pocket.editorPopoutDraft.v1.";
  const OUTLINE_EDITOR_SCHEMA = "pocket.nodeEditor.v1";

  function draftKeyFor(nodeId) {
    return `${DRAFT_KEY_PREFIX}${cleanText(nodeId, 80) || "unknown"}`;
  }

  function htmlEscape(value) {
    return String(value || "").replace(/[&<>"]/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[ch]));
  }

  function normalisePopoutOutlineBlock(raw = {}, index = 0) {
    const depthRaw = Number(raw.depth);
    return {
      id: cleanText(raw.id, 80) || makeId("block"),
      text: String(raw.text == null ? "" : raw.text).replace(/\r/g, "").slice(0, 4000),
      depth: Number.isFinite(depthRaw) ? Math.max(0, Math.min(8, Math.round(depthRaw))) : 0,
      collapsed: raw.collapsed === true,
      order: index + 1
    };
  }

  function normalisePopoutEditorMeta(value = {}) {
    if (!value || typeof value !== "object") return null;
    const mode = cleanText(value.mode, 24).toLowerCase() === "outline" ? "outline" : "text";
    if (mode !== "outline") return null;
    const outline = Array.isArray(value.outline) ? value.outline.slice(0, 400).map(normalisePopoutOutlineBlock) : [];
    const meaningful = outline.some((block) => (Number(block.depth) || 0) > 0 || block.collapsed === true);
    if (!meaningful) return null;
    return { schema: OUTLINE_EDITOR_SCHEMA, mode: "outline", outline };
  }

  function currentPayload() {
    const id = cleanText(global.state?.detailsEdit?.id || global.state?.selectedId, 80);
    const node = id && typeof nodeMap === "function" ? nodeMap().get(id) : null;
    const editor = normalisePopoutEditorMeta(node?.editor) || null;
    return {
      id,
      title: el.detailEditorLabel instanceof HTMLInputElement ? el.detailEditorLabel.value : cleanText(node?.label, 220),
      body: el.detailEditorBody instanceof HTMLTextAreaElement ? el.detailEditorBody.value : normaliseDetails(node?.details, 4000),
      mode: editor?.mode || "text",
      outline: Array.isArray(editor?.outline) ? editor.outline : null,
      path: el.detailEditorPath instanceof HTMLElement ? el.detailEditorPath.textContent : (node ? getPath(node.id) : ""),
      openedAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };
  }

  function readStoredDraft(nodeId) {
    try {
      const raw = global.localStorage.getItem(draftKeyFor(nodeId));
      if (!raw) return null;
      const parsed = JSON.parse(raw);
      if (!parsed || typeof parsed !== "object") return null;
      if (cleanText(parsed.id, 80) !== cleanText(nodeId, 80)) return null;
      return parsed;
    } catch (_error) {
      return null;
    }
  }

  function clearStoredDraft(nodeId) {
    try { global.localStorage.removeItem(draftKeyFor(nodeId)); } catch (_error) {}
  }

  function popoutHtml(payload) {
    const storedDraft = readStoredDraft(payload.id);
    const draftPayload = storedDraft && storedDraft.dirty ? { ...payload, ...storedDraft } : payload;
    const safeTitle = htmlEscape(draftPayload.title || "item");
    const safePath = htmlEscape(payload.path || "");
    const safeBody = htmlEscape(draftPayload.body || "");
    const payloadId = JSON.stringify(payload.id || "");
    const draftKey = JSON.stringify(draftKeyFor(payload.id));
    const initialDraft = JSON.stringify({
      id: payload.id || "",
      title: draftPayload.title || "",
      body: draftPayload.body || "",
      mode: draftPayload.mode || "text",
      outline: Array.isArray(draftPayload.outline) ? draftPayload.outline : null,
      openedAt: payload.openedAt || new Date().toISOString(),
      updatedAt: draftPayload.updatedAt || payload.updatedAt || new Date().toISOString(),
      dirty: !!storedDraft?.dirty
    });

    return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>pocket editor</title>
<style>
  :root { color-scheme: light; }
  * { box-sizing: border-box; }
  html, body { height: 100%; }
  body { margin: 0; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Arial, sans-serif; background: #fbfbf8; color: rgba(15, 23, 42, .94); overflow: hidden; }
  .wrap { height: 100vh; display: grid; grid-template-rows: auto auto minmax(0, 1fr); }
  .topbar { position: relative; display: flex; align-items: center; gap: 10px; min-height: 38px; padding: 6px 42px 5px 14px; border-bottom: 1px solid rgba(148, 163, 184, .14); background: rgba(251, 251, 248, .98); }
  .brand { font-size: 13px; font-weight: 650; color: rgba(51, 65, 85, .72); white-space: nowrap; }
  .quietBtn { border: 0; background: transparent; padding: 2px 3px; min-height: 24px; color: rgba(51, 65, 85, .82); cursor: pointer; font: inherit; font-size: 12px; font-weight: 620; }
  .quietBtn:hover, .quietBtn:focus-visible { color: rgba(15, 23, 42, .98); outline: none; }
  .modeSwitch { display: inline-flex; gap: 7px; margin-left: 2px; }
  .modeBtn { color: rgba(100, 116, 139, .78); }
  .modeBtn.on { color: rgba(15, 23, 42, .98); font-style: italic; }
  .saveState { min-width: 42px; color: rgba(100, 116, 139, .62); font-size: 11px; white-space: nowrap; }
  .saveState.failed { color: rgba(127, 29, 29, .82); }
  .saveState.saved { color: rgba(22, 101, 52, .72); }
  .closeBtn { position: absolute; top: 6px; right: 10px; width: 26px; height: 26px; border-radius: 999px; font-size: 20px; line-height: 21px; }
  .closeBtn:hover, .closeBtn:focus-visible { background: rgba(148, 163, 184, .13); }
  .grow { flex: 1 1 auto; }
  .hint { color: rgba(100, 116, 139, .54); font-size: 11px; white-space: nowrap; }
  .dirtyDot { color: rgba(37, 99, 235, .8); opacity: 0; transition: opacity .12s ease; }
  body.isDirty .dirtyDot { opacity: 1; }
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
  .outlineRow.dragSource { opacity: .42; }
  .outlineRow.dropBefore { box-shadow: inset 0 2px 0 rgba(37, 99, 235, .38); }
  .outlineRow.dropAfter { box-shadow: inset 0 -2px 0 rgba(37, 99, 235, .38); }
  .outlineToggle { width: 20px; min-height: 24px; border: 0; padding: 0; background: transparent; color: rgba(100, 116, 139, .7); cursor: grab; }
  .outlineToggle:active { cursor: grabbing; }
  .outlineToggle.empty { opacity: .25; }
  .outlineText { min-height: 26px; padding: 3px 6px; border-radius: 8px; outline: none; font-size: 16px; line-height: 1.45; white-space: pre-wrap; overflow-wrap: anywhere; }
  .outlineText:empty::before { content: "note"; color: rgba(100, 116, 139, .34); }
  body.isTextMode .outlinePane { display: none; }
  body.isOutlineMode textarea { display: none; }
</style>
</head>
<body class="isTextMode">
  <main class="wrap">
    <div class="topbar"><div class="brand">pocket editor <span class="dirtyDot">*</span></div><button id="saveBtn" class="quietBtn" type="button">save</button><span id="saveState" class="saveState" aria-live="polite"></span><div class="modeSwitch" aria-label="Editor mode"><button id="textModeBtn" class="quietBtn modeBtn" type="button">text</button><button id="outlineModeBtn" class="quietBtn modeBtn" type="button">outline</button></div><div class="grow"></div><div class="hint">Tab indents branch · drag dot reorders</div><button id="closeBtn" class="quietBtn closeBtn" type="button" aria-label="Close editor" title="Close editor">×</button></div>
    <div class="meta"><div class="titleLine">editing</div><div class="path" title="${safePath}">${safePath}</div></div>
    <div class="fields"><input id="titleInput" value="${safeTitle}" aria-label="Item name"><textarea id="bodyInput" aria-label="Item details">${safeBody}</textarea><div id="outlinePane" class="outlinePane" aria-label="Item outline"></div></div>
  </main>
<script>
(function () {
  const DRAFT_KEY = ${draftKey};
  const PAYLOAD_ID = ${payloadId};
  let draft = ${initialDraft};
  let dirty = !!draft.dirty;
  let allowedToClose = false;
  let mode = draft.mode === "outline" ? "outline" : "text";
  let outline = Array.isArray(draft.outline) ? draft.outline : null;
  let draggingIndex = null;
  const titleInput = document.getElementById("titleInput");
  const bodyInput = document.getElementById("bodyInput");
  const outlinePane = document.getElementById("outlinePane");
  const textModeBtn = document.getElementById("textModeBtn");
  const outlineModeBtn = document.getElementById("outlineModeBtn");
  const saveState = document.getElementById("saveState");
  function setSaveState(text, kind) { if (!saveState) return; saveState.textContent = text || ""; saveState.className = "saveState" + (kind ? " " + kind : ""); }
  function makeBlock(text, depth) { return { id: "b_" + Date.now().toString(36) + "_" + Math.random().toString(36).slice(2, 8), text: String(text || ""), depth: Math.max(0, Math.min(8, Number(depth) || 0)), collapsed: false }; }
  function textToOutline(text) { return String(text || "").split("\\n").map(function (line) { const leading = (line.match(/^\\s*/) || [""])[0].replace(/\\t/g, "  ").length; return makeBlock(line.trimStart(), Math.floor(leading / 2)); }); }
  function outlineToText(blocks) { return (blocks || []).map(function (block) { return "  ".repeat(Math.max(0, Number(block.depth) || 0)) + String(block.text || ""); }).join("\\n"); }
  function hasChildren(index) { const here = outline[index]; const next = outline[index + 1]; return !!here && !!next && (Number(next.depth) || 0) > (Number(here.depth) || 0); }
  function subtreeEnd(index) { const base = Number(outline[index]?.depth) || 0; let end = index + 1; while (end < outline.length && (Number(outline[end]?.depth) || 0) > base) end += 1; return end; }
  function isHidden(index) { const depth = Number(outline[index]?.depth) || 0; for (let i = index - 1; i >= 0; i -= 1) { const parentDepth = Number(outline[i]?.depth) || 0; if (parentDepth < depth && outline[i].collapsed) return true; } return false; }
  function setDirty(next) { dirty = !!next; draft.dirty = dirty; document.body.classList.toggle("isDirty", dirty); }
  function currentBody() { return mode === "outline" ? outlineToText(outline) : bodyInput.value; }
  function buildDraft() { return { id: PAYLOAD_ID, title: titleInput.value, body: currentBody(), mode: mode, outline: outline, openedAt: draft.openedAt || new Date().toISOString(), updatedAt: new Date().toISOString(), dirty: dirty }; }
  function storeDraft() { try { draft = buildDraft(); window.localStorage.setItem(DRAFT_KEY, JSON.stringify(draft)); } catch (_error) {} }
  function clearDraft() { try { window.localStorage.removeItem(DRAFT_KEY); } catch (_error) {} }
  function markDirty() { setDirty(true); setSaveState("", ""); storeDraft(); }
  function updateModeChrome() { document.body.classList.toggle("isTextMode", mode === "text"); document.body.classList.toggle("isOutlineMode", mode === "outline"); textModeBtn.classList.toggle("on", mode === "text"); outlineModeBtn.classList.toggle("on", mode === "outline"); }
  function focusBlock(index) { requestAnimationFrame(function () { const row = outlinePane.querySelector('[data-index="' + index + '"] .outlineText'); if (!row) return; row.focus({ preventScroll: true }); const range = document.createRange(); range.selectNodeContents(row); range.collapse(false); const selection = window.getSelection(); selection.removeAllRanges(); selection.addRange(range); }); }
  function clearDropMarkers() { outlinePane.querySelectorAll(".dropBefore,.dropAfter,.dragSource").forEach(function (row) { row.classList.remove("dropBefore", "dropAfter", "dragSource"); }); }
  function getDropPosition(ev, row, index) { const box = row.getBoundingClientRect(); const after = ev.clientY > box.top + (box.height / 2); return { index: index + (after ? 1 : 0), after: after }; }
  function moveBranch(fromIndex, toIndex) { if (!Array.isArray(outline)) return false; if (!Number.isFinite(fromIndex) || !Number.isFinite(toIndex)) return false; const end = subtreeEnd(fromIndex); if (toIndex >= fromIndex && toIndex <= end) return false; const branch = outline.slice(fromIndex, end); outline.splice(fromIndex, branch.length); let adjusted = toIndex > fromIndex ? toIndex - branch.length : toIndex; adjusted = Math.max(0, Math.min(outline.length, adjusted)); outline.splice(adjusted, 0, ...branch); markDirty(); renderOutline(adjusted); return true; }
  function renderOutline(focusIndex) {
    if (!Array.isArray(outline) || outline.length === 0) outline = [makeBlock("", 0)];
    outlinePane.innerHTML = "";
    outline.forEach(function (block, index) {
      if (isHidden(index)) return;
      const row = document.createElement("div");
      row.className = "outlineRow";
      row.dataset.index = String(index);
      row.style.paddingLeft = (4 + (Number(block.depth) || 0) * 22) + "px";
      const toggle = document.createElement("button");
      toggle.type = "button";
      toggle.draggable = true;
      toggle.className = "outlineToggle" + (hasChildren(index) ? "" : " empty");
      toggle.textContent = hasChildren(index) ? (block.collapsed ? "▸" : "▾") : "•";
      toggle.title = "Drag to reorder this branch";
      toggle.addEventListener("click", function () { if (!hasChildren(index)) return; block.collapsed = !block.collapsed; markDirty(); renderOutline(index); });
      toggle.addEventListener("dragstart", function (ev) { draggingIndex = index; row.classList.add("dragSource"); ev.dataTransfer.effectAllowed = "move"; ev.dataTransfer.setData("text/plain", String(index)); });
      row.addEventListener("dragover", function (ev) { if (draggingIndex == null) return; ev.preventDefault(); clearDropMarkers(); const drop = getDropPosition(ev, row, index); row.classList.add(drop.after ? "dropAfter" : "dropBefore"); });
      row.addEventListener("drop", function (ev) { if (draggingIndex == null) return; ev.preventDefault(); const drop = getDropPosition(ev, row, index); const from = draggingIndex; draggingIndex = null; clearDropMarkers(); moveBranch(from, drop.index); });
      row.addEventListener("dragend", function () { draggingIndex = null; clearDropMarkers(); });
      const text = document.createElement("div");
      text.className = "outlineText";
      text.contentEditable = "true";
      text.spellcheck = true;
      text.textContent = block.text || "";
      text.addEventListener("input", function () { block.text = text.textContent || ""; markDirty(); });
      text.addEventListener("keydown", function (ev) {
        if (ev.key === "Enter" && !ev.shiftKey) { ev.preventDefault(); outline.splice(index + 1, 0, makeBlock("", block.depth || 0)); markDirty(); renderOutline(index + 1); return; }
        if (ev.key === "Tab") { ev.preventDefault(); const delta = ev.shiftKey ? -1 : 1; const baseDepth = Number(block.depth) || 0; if (delta < 0 && baseDepth <= 0) return; const end = subtreeEnd(index); for (let i = index; i < end; i += 1) { outline[i].depth = Math.max(0, Math.min(8, (Number(outline[i].depth) || 0) + delta)); } markDirty(); renderOutline(index); return; }
        if (ev.key === "Backspace" && !text.textContent && outline.length > 1) { ev.preventDefault(); outline.splice(index, 1); markDirty(); renderOutline(Math.max(0, index - 1)); }
      });
      row.appendChild(toggle);
      row.appendChild(text);
      outlinePane.appendChild(row);
    });
    if (Number.isFinite(focusIndex)) focusBlock(focusIndex);
  }
  function setMode(nextMode) { const target = nextMode === "outline" ? "outline" : "text"; if (target === "outline") { if (mode !== "outline" || !outline) outline = textToOutline(bodyInput.value); mode = "outline"; updateModeChrome(); renderOutline(0); } else { if (mode === "outline" && outline) bodyInput.value = outlineToText(outline); mode = "text"; updateModeChrome(); bodyInput.focus({ preventScroll: true }); } markDirty(); }
  function buildPayload() { return { id: PAYLOAD_ID, title: titleInput.value, body: currentBody(), mode: mode, outline: outline, updatedAt: new Date().toISOString() }; }
  function closeAfterSaved() { allowedToClose = true; setDirty(false); clearDraft(); setSaveState("saved", "saved"); window.setTimeout(function () { allowedToClose = true; window.close(); }, 60); }
  function save() { const payload = buildPayload(); setSaveState("saving…", ""); storeDraft(); try { if (window.opener && !window.opener.closed && window.opener.PocketEditorPopout && typeof window.opener.PocketEditorPopout.apply === "function") { const ok = window.opener.PocketEditorPopout.apply(payload); if (ok) { closeAfterSaved(); return; } } } catch (error) { console.error(error); } try { if (window.opener && !window.opener.closed) { window.opener.postMessage({ type: "pocketEditorPopout:save", payload: payload }, "*"); window.setTimeout(function () { if (dirty) setSaveState("waiting…", ""); }, 450); return; } } catch (error) { console.error(error); } setSaveState("failed", "failed"); alert("Pocket is not connected. This draft is still stored here."); }
  function closeSafely() { if (!dirty) { allowedToClose = true; window.close(); return; } if (confirm("Save changes before closing?")) { save(); return; } if (confirm("Close without saving?")) { clearDraft(); allowedToClose = true; setDirty(false); window.close(); } }
  titleInput.addEventListener("input", markDirty); bodyInput.addEventListener("input", markDirty); document.getElementById("saveBtn").addEventListener("click", save); document.getElementById("closeBtn").addEventListener("click", closeSafely); textModeBtn.addEventListener("click", function () { setMode("text"); }); outlineModeBtn.addEventListener("click", function () { setMode("outline"); });
  document.addEventListener("keydown", function (ev) { if (ev.key === "Escape") { ev.preventDefault(); closeSafely(); } if (ev.key === "Enter" && (ev.metaKey || ev.ctrlKey)) { ev.preventDefault(); save(); } });
  window.addEventListener("message", function (ev) { if (!ev.data || ev.data.type !== "pocketEditorPopout:saved") return; closeAfterSaved(); });
  window.addEventListener("beforeunload", function (ev) { if (!dirty || allowedToClose) return; storeDraft(); ev.preventDefault(); ev.returnValue = "Unsaved editor changes."; });
  updateModeChrome(); if (mode === "outline") { if (!outline) outline = textToOutline(bodyInput.value); renderOutline(0); } setDirty(dirty); titleInput.focus(); titleInput.select();
})();
</script>
</body>
</html>`;
  }

  function applyPopoutEdit(payload) {
    if (!payload || !cleanText(payload.id, 80)) {
      setStatus("Editor popout could not identify the item.", "warn");
      return false;
    }
    const id = cleanText(payload.id, 80);
    const node = nodeMap().get(id) || null;
    if (!node) {
      setStatus("Editor popout item no longer exists.", "warn");
      return false;
    }

    const beforeEditor = JSON.stringify(normalisePopoutEditorMeta(node.editor) || null);
    const beforeLabel = cleanText(node.label, 220);
    const beforeDetails = normaliseDetails(node.details, 4000);
    const nextLabel = cleanText(payload.title, 220) || beforeLabel || "Untitled";
    const nextDetails = normaliseDetails(String(payload.body || ""), 4000);
    const editorMeta = normalisePopoutEditorMeta(payload);
    const afterEditor = JSON.stringify(editorMeta || null);
    const changed = beforeLabel !== nextLabel || beforeDetails !== nextDetails || beforeEditor !== afterEditor;

    if (!changed) {
      clearStoredDraft(id);
      setStatus("No editor changes to save.", "ok");
      return true;
    }

    node.label = nextLabel;
    if (nextDetails) node.details = nextDetails;
    else delete node.details;
    if (editorMeta) node.editor = editorMeta;
    else delete node.editor;
    node.updatedAt = nowIso();

    if (el.detailEditorLabel instanceof HTMLInputElement && cleanText(state.detailsEdit?.id, 80) === id) el.detailEditorLabel.value = nextLabel;
    if (el.detailEditorBody instanceof HTMLTextAreaElement && cleanText(state.detailsEdit?.id, 80) === id) el.detailEditorBody.value = nextDetails;

    state.selectedId = id;
    recordOp({ type: "details_edit", id, path: getPath(id), changed: editorMeta ? "outline" : "details" });
    refreshMeta();
    renderTree();
    focusRowByNodeId(id, { instant: true });
    saveWorkspaceState();
    persistPipSnapshot();
    clearStoredDraft(id);
    setStatus(editorMeta ? `Saved outline for "${cleanText(node.label, 80)}".` : `Saved details for "${cleanText(node.label, 80)}".`, "ok");
    return true;
  }

  function notifyPopoutSaved() {
    try { if (editorWindow && !editorWindow.closed) editorWindow.postMessage({ type: "pocketEditorPopout:saved" }, "*"); } catch {}
  }

  function openEditorPopout() {
    if (!isDetailsEditorOpen()) {
      openDetailsEditorForSelectedNode();
      if (!isDetailsEditorOpen()) return false;
    }
    const payload = currentPayload();
    const storedDraft = readStoredDraft(payload.id);
    if (storedDraft?.dirty) setStatus("Recovered popout draft for this item.", "ok", { durationMs: 4200 });
    const width = Math.min(820, Math.max(600, Math.round(global.screen.availWidth * 0.5)));
    const height = Math.min(820, Math.max(600, Math.round(global.screen.availHeight * 0.76)));
    const left = Math.round((global.screen.availWidth - width) / 2);
    const top = Math.round((global.screen.availHeight - height) / 2);
    editorWindow = global.open("", "pocketEditorPopout", `popup=yes,width=${width},height=${height},left=${left},top=${top}`);
    if (!editorWindow) {
      setStatus("Popout blocked. Allow popups for pocket, then try again.", "warn", { durationMs: 5200 });
      return false;
    }
    editorWindow.document.open();
    editorWindow.document.write(popoutHtml(payload));
    editorWindow.document.close();
    editorWindow.focus();
    return true;
  }

  function handlePopoutMessage(ev) {
    if (!ev.data || ev.data.type !== "pocketEditorPopout:save") return;
    const ok = applyPopoutEdit(ev.data.payload);
    if (ok) notifyPopoutSaved();
  }

  function init() {
    const button = document.getElementById("btnDetailPopout");
    if (button) button.addEventListener("click", openEditorPopout);
    global.addEventListener("message", handlePopoutMessage);
  }

  global.PocketEditorPopout = Object.freeze({ open: openEditorPopout, apply: applyPopoutEdit });
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init, { once: true });
  else init();
})(window);
