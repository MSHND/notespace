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

  function popupRuntimeScript(initial) {
    return `(function () {
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
  var unsavedDialog = document.getElementById("unsavedDialog");
  var unsavedSaveBtn = document.getElementById("unsavedSaveBtn");
  var unsavedDiscardBtn = document.getElementById("unsavedDiscardBtn");
  var unsavedCancelBtn = document.getElementById("unsavedCancelBtn");
  var returnFocus = null;
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
  function focusEditor() { if (returnFocus && typeof returnFocus.focus === "function") returnFocus.focus({ preventScroll: true }); else bodyInput.focus({ preventScroll: true }); returnFocus = null; }
  function hideUnsavedDialog() { unsavedDialog.hidden = true; }
  function keepEditing() { hideUnsavedDialog(); focusEditor(); }
  function showUnsavedDialog() { returnFocus = document.activeElement; unsavedDialog.hidden = false; unsavedSaveBtn.focus({ preventScroll: true }); }
  function discardAndClose() { allowedToClose = true; dirty = false; window.close(); }
  function save() {
    hideUnsavedDialog();
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
  function closeSafely() { if (!dirty) { allowedToClose = true; window.close(); return; } showUnsavedDialog(); }
  titleInput.addEventListener("input", function () { setDirty(true); });
  bodyInput.addEventListener("input", function () { setDirty(true); });
  document.getElementById("saveBtn").addEventListener("click", save);
  document.getElementById("closeBtn").addEventListener("click", closeSafely);
  unsavedSaveBtn.addEventListener("click", save);
  unsavedDiscardBtn.addEventListener("click", discardAndClose);
  unsavedCancelBtn.addEventListener("click", keepEditing);
  textModeBtn.addEventListener("click", function () { setMode("text"); });
  outlineModeBtn.addEventListener("click", function () { setMode("outline"); });
  document.addEventListener("keydown", function (ev) { if ((ev.key === "s" || ev.key === "S" || ev.key === "Enter") && (ev.metaKey || ev.ctrlKey)) { ev.preventDefault(); save(); return; } if (ev.key === "Escape") { ev.preventDefault(); if (!unsavedDialog.hidden) keepEditing(); else closeSafely(); } });
  window.addEventListener("beforeunload", function (ev) { if (!dirty || allowedToClose) return; ev.preventDefault(); ev.returnValue = ""; });
  updateModeChrome();
  if (mode === "outline") { if (!outline) outline = textToOutline(bodyInput.value); renderOutline(0); }
  titleInput.focus();
  titleInput.select();
})();
`;
  }

  function editorHtml(payload) {
    if (!global.PocketNodePopoutTemplate || typeof global.PocketNodePopoutTemplate.render !== "function") {
      throw new Error("PocketNodePopoutTemplate is not loaded.");
    }
    return global.PocketNodePopoutTemplate.render(payload, {
      htmlEscape: htmlEscape,
      runtimeScript: popupRuntimeScript(safeJson(payload))
    });
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
