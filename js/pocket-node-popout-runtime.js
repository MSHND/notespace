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
  var outlineSelectedIds = new Set();
  var outlineSelectionAnchorId = "";
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
  var saveInFlight = false;
  function setSaveState(text, kind) { saveState.textContent = text || ""; saveState.className = "status" + (kind ? " " + kind : ""); }
  function setDirty(next) { dirty = !!next; document.body.classList.toggle("isDirty", dirty); if (dirty) setSaveState("", ""); }
  function makeBlock(text, depth) { return { id: "b_" + Date.now().toString(36) + "_" + Math.random().toString(36).slice(2, 8), text: String(text || ""), depth: Math.max(0, Math.min(8, Number(depth) || 0)), collapsed: false }; }
  function ensureBlockId(block) { if (block && !block.id) block.id = makeBlock("", 0).id; return block && block.id ? block.id : ""; }
  function textToOutline(text) { return String(text || "").split("\\n").map(function (line) { var leading = (line.match(/^\s*/) || [""])[0].replace(/\t/g, "  ").length; return makeBlock(line.trimStart(), Math.floor(leading / 2)); }); }
  function outlineToText(blocks) { return (blocks || []).map(function (block) { return "  ".repeat(Math.max(0, Number(block.depth) || 0)) + String(block.text || ""); }).join("\\n"); }
  function hasChildren(index) { var here = outline[index]; var next = outline[index + 1]; return !!here && !!next && (Number(next.depth) || 0) > (Number(here.depth) || 0); }
  function isHidden(index) {
    var searchDepth = Number(outline[index] && outline[index].depth) || 0;
    if (searchDepth <= 0) return false;
    for (var i = index - 1; i >= 0; i -= 1) {
      var parentDepth = Number(outline[i] && outline[i].depth) || 0;
      if (parentDepth >= searchDepth) continue;
      if (outline[i] && outline[i].collapsed) return true;
      searchDepth = parentDepth;
      if (searchDepth <= 0) return false;
    }
    return false;
  }
  function syncOutlineTextElement(textEl) {
    if (!Array.isArray(outline) || !textEl) return;
    var blockId = textEl.getAttribute("data-block-id") || "";
    if (!blockId) return;
    for (var i = 0; i < outline.length; i += 1) {
      if (outline[i] && outline[i].id === blockId) { outline[i].text = textEl.textContent || ""; return; }
    }
  }
  function syncOutlineFromDom() {
    if (!Array.isArray(outline) || !outlinePane) return;
    var active = document.activeElement;
    if (active && active.classList && active.classList.contains("outlineText")) syncOutlineTextElement(active);
    Array.prototype.forEach.call(outlinePane.querySelectorAll(".outlineText[data-block-id]"), syncOutlineTextElement);
  }
  function outlineDepth(index) { return Math.max(0, Number(outline[index] && outline[index].depth) || 0); }
  function blockIndexById(blockId) {
    if (!Array.isArray(outline) || !blockId) return -1;
    for (var i = 0; i < outline.length; i += 1) if (outline[i] && outline[i].id === blockId) return i;
    return -1;
  }
  function visibleOutlineBlockIds() {
    if (!outlinePane) return [];
    return Array.prototype.map.call(outlinePane.querySelectorAll(".outlineRow[data-block-id]"), function (row) { return row.getAttribute("data-block-id") || ""; }).filter(Boolean);
  }
  function hasOutlineSelection() { return outlineSelectedIds.size > 0; }
  function pruneOutlineSelection() {
    if (!Array.isArray(outline) || outlineSelectedIds.size === 0) return;
    var known = new Set();
    outline.forEach(function (block) { var id = ensureBlockId(block); if (id) known.add(id); });
    outlineSelectedIds.forEach(function (id) { if (!known.has(id)) outlineSelectedIds.delete(id); });
    if (outlineSelectionAnchorId && !known.has(outlineSelectionAnchorId)) outlineSelectionAnchorId = "";
  }
  function updateOutlineSelectionChrome() {
    if (!outlinePane) return;
    Array.prototype.forEach.call(outlinePane.querySelectorAll(".outlineRow[data-block-id]"), function (row) {
      var blockId = row.getAttribute("data-block-id") || "";
      var selected = outlineSelectedIds.has(blockId);
      row.classList.toggle("isOutlineSelected", selected);
      row.setAttribute("aria-selected", selected ? "true" : "false");
      var selector = row.querySelector(".outlineSelect");
      if (selector) {
        selector.classList.toggle("on", selected);
        selector.setAttribute("aria-pressed", selected ? "true" : "false");
      }
    });
  }
  function clearOutlineSelection() {
    if (!hasOutlineSelection()) return false;
    outlineSelectedIds.clear();
    outlineSelectionAnchorId = "";
    updateOutlineSelectionChrome();
    return true;
  }
  function selectSingleOutlineBlock(blockId) {
    outlineSelectedIds.clear();
    if (blockId) outlineSelectedIds.add(blockId);
    outlineSelectionAnchorId = blockId || "";
    updateOutlineSelectionChrome();
  }
  function selectOutlineRange(blockId) {
    var visibleIds = visibleOutlineBlockIds();
    var anchorId = outlineSelectionAnchorId && visibleIds.indexOf(outlineSelectionAnchorId) >= 0 ? outlineSelectionAnchorId : blockId;
    var start = visibleIds.indexOf(anchorId);
    var end = visibleIds.indexOf(blockId);
    if (start < 0 || end < 0) { selectSingleOutlineBlock(blockId); return; }
    outlineSelectedIds.clear();
    var lo = Math.min(start, end);
    var hi = Math.max(start, end);
    for (var i = lo; i <= hi; i += 1) outlineSelectedIds.add(visibleIds[i]);
    outlineSelectionAnchorId = anchorId;
    updateOutlineSelectionChrome();
  }
  function handleOutlineSelectClick(ev, block) {
    ev.preventDefault();
    ev.stopPropagation();
    var blockId = ensureBlockId(block);
    if (!blockId) return;
    if (ev.shiftKey) { selectOutlineRange(blockId); return; }
    if (ev.metaKey || ev.ctrlKey) {
      if (outlineSelectedIds.has(blockId)) outlineSelectedIds.delete(blockId);
      else outlineSelectedIds.add(blockId);
      outlineSelectionAnchorId = blockId;
      updateOutlineSelectionChrome();
      return;
    }
    selectSingleOutlineBlock(blockId);
  }
  function selectedAncestorIndex(index, selectedIndexes) {
    var searchDepth = outlineDepth(index);
    if (searchDepth <= 0) return -1;
    for (var i = index - 1; i >= 0; i -= 1) {
      var parentDepth = outlineDepth(i);
      if (parentDepth >= searchDepth) continue;
      if (selectedIndexes.has(i)) return i;
      searchDepth = parentDepth;
      if (searchDepth <= 0) return -1;
    }
    return -1;
  }
  function selectedOutlineRootIndexes() {
    syncOutlineFromDom();
    pruneOutlineSelection();
    var indexes = [];
    outlineSelectedIds.forEach(function (blockId) {
      var index = blockIndexById(blockId);
      if (index >= 0) indexes.push(index);
    });
    indexes.sort(function (a, b) { return a - b; });
    var selectedIndexes = new Set(indexes);
    return indexes.filter(function (index) { return selectedAncestorIndex(index, selectedIndexes) < 0; });
  }
  function outlineSubtreeEndIndex(index) {
    var rootDepth = outlineDepth(index);
    var end = index + 1;
    while (end < outline.length && outlineDepth(end) > rootDepth) end += 1;
    return end;
  }
  function outlineSelectionToText() {
    var lines = [];
    selectedOutlineRootIndexes().forEach(function (rootIndex) {
      var rootDepth = outlineDepth(rootIndex);
      var end = outlineSubtreeEndIndex(rootIndex);
      for (var i = rootIndex; i < end; i += 1) {
        lines.push("  ".repeat(Math.max(0, outlineDepth(i) - rootDepth)) + String(outline[i] && outline[i].text || ""));
      }
    });
    return { text: lines.join("\\n"), count: lines.length };
  }
  function fallbackCopyToClipboard(text) {
    var active = document.activeElement;
    var holder = document.createElement("textarea");
    holder.value = text;
    holder.setAttribute("readonly", "readonly");
    holder.style.position = "fixed";
    holder.style.left = "-9999px";
    holder.style.top = "0";
    document.body.appendChild(holder);
    holder.focus();
    holder.select();
    var ok = false;
    try { ok = document.execCommand && document.execCommand("copy"); } catch (_error) { ok = false; }
    document.body.removeChild(holder);
    try { if (active && typeof active.focus === "function") active.focus({ preventScroll: true }); } catch (_error) {}
    return ok;
  }
  function writeClipboardText(text, done) {
    if (navigator.clipboard && typeof navigator.clipboard.writeText === "function") {
      navigator.clipboard.writeText(text).then(function () { done(true); }, function () { done(fallbackCopyToClipboard(text)); });
      return;
    }
    done(fallbackCopyToClipboard(text));
  }
  function copyOutlineSelection() {
    if (mode !== "outline" || !hasOutlineSelection()) return false;
    var result = outlineSelectionToText();
    if (result.count <= 0) return false;
    writeClipboardText(result.text, function (ok) {
      if (ok) setSaveState("copied " + result.count + " outline row" + (result.count === 1 ? "" : "s"), "saved");
      else setSaveState("copy failed", "failed");
    });
    return true;
  }
  function updateModeChrome() { document.body.classList.toggle("textMode", mode === "text"); document.body.classList.toggle("outlineMode", mode === "outline"); textModeBtn.classList.toggle("on", mode === "text"); outlineModeBtn.classList.toggle("on", mode === "outline"); }
  function renderOutline(focusIndex) {
    syncOutlineFromDom();
    if (!Array.isArray(outline) || outline.length === 0) outline = [makeBlock("", 0)];
    outline.forEach(ensureBlockId);
    pruneOutlineSelection();
    outlinePane.innerHTML = "";
    outline.forEach(function (block, index) {
      if (isHidden(index)) return;
      ensureBlockId(block);
      var row = document.createElement("div");
      row.className = "outlineRow" + (outlineSelectedIds.has(block.id) ? " isOutlineSelected" : "");
      row.setAttribute("data-block-id", block.id);
      row.setAttribute("aria-selected", outlineSelectedIds.has(block.id) ? "true" : "false");
      row.style.paddingLeft = (4 + (Number(block.depth) || 0) * 22) + "px";
      var selector = document.createElement("button");
      selector.type = "button";
      selector.className = "outlineSelect" + (outlineSelectedIds.has(block.id) ? " on" : "");
      selector.setAttribute("aria-label", "Select outline row");
      selector.setAttribute("aria-pressed", outlineSelectedIds.has(block.id) ? "true" : "false");
      selector.addEventListener("click", function (ev) { handleOutlineSelectClick(ev, block); });
      var toggle = document.createElement("button");
      toggle.type = "button";
      toggle.className = "outlineToggle" + (hasChildren(index) ? "" : " empty");
      toggle.textContent = hasChildren(index) ? (block.collapsed ? "▸" : "▾") : "•";
      toggle.addEventListener("click", function () { syncOutlineFromDom(); if (!hasChildren(index)) return; block.collapsed = !block.collapsed; setDirty(true); renderOutline(index); });
      var text = document.createElement("div");
      text.className = "outlineText";
      text.setAttribute("data-block-id", block.id);
      text.contentEditable = "true";
      text.spellcheck = true;
      text.textContent = block.text || "";
      text.addEventListener("input", function () { block.text = text.textContent || ""; setDirty(true); });
      text.addEventListener("keydown", function (ev) {
        if (ev.key === "Enter" && !ev.shiftKey) { ev.preventDefault(); syncOutlineFromDom(); outline.splice(index + 1, 0, makeBlock("", block.depth || 0)); setDirty(true); renderOutline(index + 1); return; }
        if (ev.key === "Tab") { ev.preventDefault(); syncOutlineFromDom(); var delta = ev.shiftKey ? -1 : 1; block.depth = Math.max(0, Math.min(8, (Number(block.depth) || 0) + delta)); setDirty(true); renderOutline(index); return; }
        if (ev.key === "Backspace" && !text.textContent && outline.length > 1) { ev.preventDefault(); syncOutlineFromDom(); outline.splice(index, 1); setDirty(true); renderOutline(Math.max(0, index - 1)); }
      });
      row.appendChild(selector);
      row.appendChild(toggle);
      row.appendChild(text);
      outlinePane.appendChild(row);
      if (index === focusIndex) requestAnimationFrame(function () { text.focus(); });
    });
  }
  function setMode(nextMode) { if (mode === "outline") syncOutlineFromDom(); if (nextMode !== "outline") clearOutlineSelection(); if (nextMode === "outline") { if (!outline) outline = textToOutline(bodyInput.value); mode = "outline"; updateModeChrome(); renderOutline(0); } else { if (outline) bodyInput.value = outlineToText(outline); mode = "text"; updateModeChrome(); bodyInput.focus({ preventScroll: true }); } setDirty(true); }
  function currentBody() { if (mode === "outline") { syncOutlineFromDom(); return outlineToText(outline); } return bodyInput.value; }
  function buildPayload() { if (Array.isArray(outline)) { syncOutlineFromDom(); outline.forEach(ensureBlockId); } return { id: payload.id, title: titleInput.value, body: currentBody(), mode: mode, outline: outline, updatedAt: new Date().toISOString() }; }
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
  function finishSuccessfulSave(closeAfter, label) {
    setDirty(false);
    setSaveState(label || "saved", "saved");
    if (closeAfter) {
      allowedToClose = true;
      if (resumePendingOpen()) return true;
      window.setTimeout(function () { window.close(); }, 80);
    } else {
      cancelPendingOpen();
    }
    return true;
  }
  function handleSaveResult(result, closeAfter) {
    result = result || {};
    if (result.ok && result.exported) return finishSuccessfulSave(closeAfter, "saved");
    if (result.ok && result.reason === "unchanged") return finishSuccessfulSave(closeAfter, "no changes");
    if (result.applied && !result.exported) {
      setDirty(true);
      setSaveState("main save needed", "failed");
      return false;
    }
    setDirty(true);
    setSaveState("failed", "failed");
    alert("Pocket did not accept the save. Copy your text before closing.");
    return false;
  }
  function handleSaveError(error) {
    console.error(error);
    setDirty(true);
    setSaveState("failed", "failed");
    alert("Pocket is not connected. Copy your text before closing.");
    return false;
  }
  function save(closeAfter) {
    closeAfter = closeAfter === true;
    if (saveInFlight) return false;
    hideUnsavedDialog();
    setSaveState("saving…", "");
    saveInFlight = true;
    try {
      if (window.opener && !window.opener.closed && window.opener.PocketNodePopoutEditor) {
        if (typeof window.opener.PocketNodePopoutEditor.applyAndSave === "function") {
          Promise.resolve(window.opener.PocketNodePopoutEditor.applyAndSave(buildPayload())).then(function (result) {
            saveInFlight = false;
            handleSaveResult(result, closeAfter);
          }, function (error) {
            saveInFlight = false;
            handleSaveError(error);
          });
          return true;
        }
        if (typeof window.opener.PocketNodePopoutEditor.apply === "function") {
          var ok = window.opener.PocketNodePopoutEditor.apply(buildPayload());
          saveInFlight = false;
          if (ok) {
            setDirty(true);
            setSaveState("main save needed", "failed");
            return false;
          }
        }
      }
    } catch (error) {
      saveInFlight = false;
      return handleSaveError(error);
    }
    saveInFlight = false;
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
  document.addEventListener("keydown", function (ev) { if ((ev.key === "c" || ev.key === "C") && (ev.metaKey || ev.ctrlKey) && !ev.altKey && !ev.shiftKey && copyOutlineSelection()) { ev.preventDefault(); return; } if ((ev.key === "s" || ev.key === "S" || ev.key === "Enter") && (ev.metaKey || ev.ctrlKey)) { ev.preventDefault(); save(false); return; } if (ev.key === "Escape") { ev.preventDefault(); if (!unsavedDialog.hidden) keepEditing(); else if (mode === "outline" && clearOutlineSelection()) return; else closeSafely(); } });
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
