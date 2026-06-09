/* Inline runtime script factory for the standalone node popout editor. */
(function initialisePocketNodePopoutRuntime(global) {
  "use strict";

  function build(initialJson) {
    return `(function () {
  var payload = ${initialJson};
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
  var saveCloseBtn = document.getElementById("saveCloseBtn");
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
  function openerPopoutWindow() { try { return window.opener && !window.opener.closed && window.opener.PocketNodePopoutWindow ? window.opener.PocketNodePopoutWindow : null; } catch (_error) { return null; } }
  function resumePendingOpen() { var target = openerPopoutWindow(); try { return !!(target && typeof target.resumePendingOpen === "function" && target.resumePendingOpen()); } catch (error) { console.error(error); return false; } }
  function cancelPendingOpen() { var target = openerPopoutWindow(); try { if (target && typeof target.cancelPendingOpen === "function") target.cancelPendingOpen(); } catch (error) { console.error(error); } }
  function keepEditing() { cancelPendingOpen(); hideUnsavedDialog(); focusEditor(); }
  function showUnsavedDialog() { returnFocus = document.activeElement; unsavedDialog.hidden = false; unsavedSaveBtn.focus({ preventScroll: true }); }
  function requestUnsavedProtection() { if (!dirty) return false; showUnsavedDialog(); try { window.focus(); } catch (_error) {} return true; }
  window.PocketNodePopoutSession = Object.freeze({
    hasUnsavedChanges: function () { return dirty === true; },
    requestUnsavedProtection: requestUnsavedProtection
  });
  function discardAndClose() { allowedToClose = true; dirty = false; if (resumePendingOpen()) return; window.close(); }
  function save(closeAfter) {
    closeAfter = closeAfter === true;
    hideUnsavedDialog();
    setSaveState("saving…", "");
    try {
      if (window.opener && !window.opener.closed && window.opener.PocketNodePopoutEditor && typeof window.opener.PocketNodePopoutEditor.apply === "function") {
        var ok = window.opener.PocketNodePopoutEditor.apply(buildPayload());
        if (ok) {
          setDirty(false);
          setSaveState("saved", "saved");
          if (closeAfter) { allowedToClose = true; if (resumePendingOpen()) return true; window.setTimeout(function () { window.close(); }, 80); }
          else cancelPendingOpen();
          return true;
        }
      }
    } catch (error) { console.error(error); }
    setSaveState("failed", "failed");
    alert("Pocket is not connected. Copy your text before closing.");
    return false;
  }
  function closeSafely() { if (!dirty) { allowedToClose = true; window.close(); return; } showUnsavedDialog(); }
  titleInput.addEventListener("input", function () { setDirty(true); });
  bodyInput.addEventListener("input", function () { setDirty(true); });
  document.getElementById("saveBtn").addEventListener("click", function () { save(false); });
  saveCloseBtn.addEventListener("click", function () { save(true); });
  document.getElementById("closeBtn").addEventListener("click", closeSafely);
  unsavedSaveBtn.addEventListener("click", function () { save(true); });
  unsavedDiscardBtn.addEventListener("click", discardAndClose);
  unsavedCancelBtn.addEventListener("click", keepEditing);
  textModeBtn.addEventListener("click", function () { setMode("text"); });
  outlineModeBtn.addEventListener("click", function () { setMode("outline"); });
  document.addEventListener("keydown", function (ev) { if ((ev.key === "s" || ev.key === "S" || ev.key === "Enter") && (ev.metaKey || ev.ctrlKey)) { ev.preventDefault(); save(false); return; } if (ev.key === "Escape") { ev.preventDefault(); if (!unsavedDialog.hidden) keepEditing(); else closeSafely(); } });
  window.addEventListener("beforeunload", function (ev) { if (!dirty || allowedToClose) return; ev.preventDefault(); ev.returnValue = ""; });
  updateModeChrome();
  if (mode === "outline") { if (!outline) outline = textToOutline(bodyInput.value); renderOutline(0); }
  titleInput.focus();
  titleInput.select();
})();
`;
  }

  global.PocketNodePopoutRuntime = Object.freeze({ build: build });
})(window);
