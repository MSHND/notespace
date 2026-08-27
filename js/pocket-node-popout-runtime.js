/* Same-origin runtime for the standalone node popout editor. */
(function initialisePocketNodePopoutRuntime(global) {
  "use strict";

  function initialise(initialPayload, environment) {
  environment = environment || {};
  var window = environment.window || global;
  var document = environment.document || window.document;
  var navigator = environment.navigator || window.navigator;
  var requestAnimationFrame = environment.requestAnimationFrame || window.requestAnimationFrame || function (callback) { return window.setTimeout(callback, 0); };
  var alert = environment.alert || window.alert || function () {};
  var console = environment.console || window.console || { error: function () {} };
  if (!initialPayload || typeof initialPayload !== "object" || Array.isArray(initialPayload)) return false;
  var payload = Object.assign({}, initialPayload);
  var ownerToken = typeof payload.popupOwnerToken === "string" ? payload.popupOwnerToken : "";
  var popupToken = typeof payload.popupInstanceToken === "string" ? payload.popupInstanceToken : "";
  delete payload.popupOwnerToken;
  delete payload.popupInstanceToken;
  var readOnly = payload.readOnly === true;
  var dirty = false;
  var editGeneration = 0;
  var allowedToClose = false;
  var mode = !readOnly && payload.mode === "outline" ? "outline" : "text";
  var outline = !readOnly && Array.isArray(payload.outline) ? payload.outline.map(function (b) { return { id: b.id || "", text: String(b.text || ""), depth: Math.max(0, Math.min(8, Number(b.depth) || 0)), collapsed: b.collapsed === true }; }) : null;
  var outlineSelectedIds = new Set();
  var outlineSelectionAnchorId = "";
  var outlineEditingId = "";
  var outlineEditingOriginalText = "";
  var outlineEditingWasDirty = false;
  var outlineDragUndoSnapshot = null;
  var titleInput = document.getElementById("titleInput");
  var bodyInput = document.getElementById("bodyInput");
  var outlinePane = document.getElementById("outlinePane");
  var textModeBtn = document.getElementById("textModeBtn");
  var outlineModeBtn = document.getElementById("outlineModeBtn");
  var saveState = document.getElementById("saveState");
  var saveBtn = document.getElementById("saveBtn");
  var saveCloseBtn = document.getElementById("saveCloseBtn");
  var outlineContextMenu = document.getElementById("outlineContextMenu");
  var unsavedDialog = document.getElementById("unsavedDialog");
  var unsavedSaveBtn = document.getElementById("unsavedSaveBtn");
  var unsavedDiscardBtn = document.getElementById("unsavedDiscardBtn");
  var unsavedCancelBtn = document.getElementById("unsavedCancelBtn");
  var returnFocus = null;
  var outlineContextReturnFocus = null;
  var outlineContextTargetId = "";
  var saveInFlight = false;
  function setSaveState(text, kind) { saveState.textContent = text || ""; saveState.className = "status" + (kind ? " " + kind : ""); }
  function setDirty(next) { if (readOnly) { dirty = false; document.body.classList.remove("isDirty"); return; } dirty = !!next; document.body.classList.toggle("isDirty", dirty); if (dirty) setSaveState("", ""); }
  function markContentMutation(next, options) { if (readOnly) return; if (!(options && options.preserveOutlineDragUndo)) outlineDragUndoSnapshot = null; editGeneration += 1; setDirty(next); }
  function applyReadOnlyState() {
    if (!readOnly) return;
    document.body.classList.add("readOnly");
    titleInput.readOnly = true;
    bodyInput.readOnly = true;
    saveBtn.disabled = true;
    saveCloseBtn.disabled = true;
    textModeBtn.disabled = true;
    outlineModeBtn.disabled = true;
    outlineContextMenu.hidden = true;
    unsavedDialog.hidden = true;
    setDirty(false);
  }
  function makeBlock(text, depth) { return { id: "b_" + Date.now().toString(36) + "_" + Math.random().toString(36).slice(2, 8), text: String(text || ""), depth: Math.max(0, Math.min(8, Number(depth) || 0)), collapsed: false }; }
  function ensureBlockId(block) { if (block && !block.id) block.id = makeBlock("", 0).id; return block && block.id ? block.id : ""; }
  function hasChildren(index) { var here = outline[index]; var next = outline[index + 1]; return !!here && !!next && (Number(next.depth) || 0) > (Number(here.depth) || 0); }
  function focusOutlineBlock(blockId) {
    if (!outlinePane || !blockId) return;
    requestAnimationFrame(function () {
      var rows = outlinePane.querySelectorAll(".outlineRow[data-block-id]");
      for (var i = 0; i < rows.length; i += 1) {
        if (rows[i].getAttribute("data-block-id") !== blockId) continue;
        var target = rows[i].querySelector(".outlineToggle") || rows[i].querySelector(".outlineText");
        if (target && typeof target.focus === "function") target.focus({ preventScroll: true });
        return;
      }
    });
  }
  function selectedOutlineBlockId() {
    if (outlineSelectedIds.size !== 1) return "";
    var selected = "";
    outlineSelectedIds.forEach(function (blockId) { selected = blockId; });
    return blockIndexById(selected) >= 0 ? selected : "";
  }
  function beginOutlineRowEditing(blockId) {
    if (readOnly || mode !== "outline" || !blockId || blockIndexById(blockId) < 0) return false;
    closeOutlineContextMenu({ restoreFocus: false });
    selectSingleOutlineBlock(blockId);
    var block = outline[blockIndexById(blockId)];
    outlineEditingOriginalText = String(block && block.text || "");
    outlineEditingWasDirty = dirty;
    outlineEditingId = blockId;
    renderOutline(blockIndexById(blockId));
    return true;
  }
  function collapseOrExpandAllOutlineBranches(collapsed) {
    if (readOnly || mode !== "outline" || !Array.isArray(outline)) return false;
    syncOutlineFromDom();
    var active = document.activeElement;
    var activeRow = active && typeof active.closest === "function" ? active.closest(".outlineRow[data-block-id]") : null;
    var preferredId = activeRow?.getAttribute("data-block-id") || "";
    var changed = false;
    outline.forEach(function (block, index) {
      if (!hasChildren(index) || block.collapsed === collapsed) return;
      block.collapsed = collapsed;
      changed = true;
    });
    if (!changed) return false;
    markContentMutation(true);
    renderOutline();
    var visible = visibleOutlineBlockIds();
    if (visible.indexOf(preferredId) < 0) preferredId = visible[0] || "";
    if (preferredId && !outlineSelectedIds.has(preferredId)) selectSingleOutlineBlock(preferredId);
    focusOutlineBlock(preferredId);
    return true;
  }
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
  function outlineContextMenuIsOpen() { return !!outlineContextMenu && !outlineContextMenu.hidden; }
  function outlineContextMenuItems() {
    if (!outlineContextMenu) return [];
    return Array.prototype.slice.call(outlineContextMenu.querySelectorAll('[role="menuitem"]'));
  }
  function closeOutlineContextMenu(options) {
    options = options || {};
    if (!outlineContextMenuIsOpen()) return false;
    outlineContextMenu.hidden = true;
    outlineContextMenu.style.left = "";
    outlineContextMenu.style.top = "";
    var focusTarget = outlineContextReturnFocus;
    outlineContextReturnFocus = null;
    outlineContextTargetId = "";
    if (options.restoreFocus !== false && focusTarget && focusTarget.isConnected && typeof focusTarget.focus === "function") {
      requestAnimationFrame(function () { focusTarget.focus({ preventScroll: true }); });
    }
    return true;
  }
  function openOutlineContextMenu(ev, row) {
    if (!outlineContextMenu || !row) return false;
    closeOutlineContextMenu({ restoreFocus: false });
    outlineContextReturnFocus = row.querySelector(".outlineToggle") || row.querySelector(".outlineText") || document.activeElement;
    outlineContextMenu.hidden = false;
    outlineContextMenu.style.left = "0px";
    outlineContextMenu.style.top = "0px";
    var rect = outlineContextMenu.getBoundingClientRect();
    var margin = 6;
    var viewportWidth = Math.max(margin * 2, Number(window.innerWidth) || document.documentElement.clientWidth || 0);
    var viewportHeight = Math.max(margin * 2, Number(window.innerHeight) || document.documentElement.clientHeight || 0);
    var left = Math.max(margin, Math.min(Number(ev.clientX) || margin, viewportWidth - rect.width - margin));
    var top = Math.max(margin, Math.min(Number(ev.clientY) || margin, viewportHeight - rect.height - margin));
    outlineContextMenu.style.left = left + "px";
    outlineContextMenu.style.top = top + "px";
    var items = outlineContextMenuItems();
    if (items.length) requestAnimationFrame(function () { items[0].focus({ preventScroll: true }); });
    return true;
  }
  function handleOutlineContextMenu(ev) {
    if (mode !== "outline" || !ev || !ev.target || typeof ev.target.closest !== "function") return;
    var row = ev.target.closest(".outlineRow[data-block-id]");
    if (!row || !outlinePane.contains(row)) return;
    var blockId = row.getAttribute("data-block-id") || "";
    if (!blockId || blockIndexById(blockId) < 0) return;
    ev.preventDefault();
    syncOutlineFromDom();
    if (!outlineSelectedIds.has(blockId)) selectSingleOutlineBlock(blockId);
    else updateOutlineSelectionChrome();
    openOutlineContextMenu(ev, row);
    outlineContextTargetId = blockId;
  }
  function handleOutlineContextMenuKeydown(ev) {
    if (!outlineContextMenuIsOpen()) return;
    if (ev.key === "Escape") {
      ev.preventDefault();
      ev.stopPropagation();
      closeOutlineContextMenu({ restoreFocus: true });
      return;
    }
    var items = outlineContextMenuItems();
    if (!items.length) return;
    var index = items.indexOf(document.activeElement);
    var nextIndex = -1;
    if (ev.key === "ArrowDown") nextIndex = index < 0 ? 0 : (index + 1) % items.length;
    else if (ev.key === "ArrowUp") nextIndex = index < 0 ? items.length - 1 : (index - 1 + items.length) % items.length;
    else if (ev.key === "Home") nextIndex = 0;
    else if (ev.key === "End") nextIndex = items.length - 1;
    if (nextIndex < 0) return;
    ev.preventDefault();
    items[nextIndex].focus({ preventScroll: true });
  }
  function finishOutlineRowEditing(target, options) {
    options = options || {};
    if (mode !== "outline" || !outlinePane || !target || target.nodeType !== 1 || typeof target.closest !== "function") return false;
    var text = target.closest(".outlineText[data-block-id]");
    if (!text || !outlinePane.contains(text)) return false;
    var row = text.closest(".outlineRow[data-block-id]");
    var blockId = row ? row.getAttribute("data-block-id") || "" : "";
    if (!blockId) return false;
    if (outlineEditingId !== blockId) return false;
    if (options.cancel) {
      var block = outline[blockIndexById(blockId)];
      if (block) block.text = outlineEditingOriginalText;
      text.textContent = outlineEditingOriginalText;
      setDirty(outlineEditingWasDirty);
    } else syncOutlineTextElement(text);
    outlineEditingId = "";
    outlineEditingOriginalText = "";
    outlineEditingWasDirty = false;
    selectSingleOutlineBlock(blockId);
    renderOutline(blockIndexById(blockId));
    focusOutlineBlock(blockId);
    return true;
  }
  function exitOutlineRowEditing(target) { return finishOutlineRowEditing(target); }
  function isEditablePeTarget(target) {
    if (!target || target.nodeType !== 1) return false;
    if (target === titleInput || target === bodyInput || target.isContentEditable || target.contentEditable === "true") return true;
    var tag = String(target.tagName || "").toLowerCase();
    if (tag === "input" || tag === "textarea" || tag === "select") return true;
    if (typeof target.closest !== "function") return false;
    var outlineText = target.closest(".outlineText[data-block-id]");
    if (outlineText && (outlineText.isContentEditable || outlineText.contentEditable === "true")) return true;
    return !!target.closest('input, textarea, select, [contenteditable="true"]');
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
  function outlineSiblingIndex(index, direction) {
    var depth = outlineDepth(index);
    if (direction < 0) {
      for (var cursor = index - 1; cursor >= 0; cursor -= 1) {
        var previousDepth = outlineDepth(cursor);
        if (previousDepth < depth) return -1;
        if (previousDepth === depth) return cursor;
      }
      return -1;
    }
    for (var next = outlineSubtreeEndIndex(index); next < outline.length; next += 1) {
      var nextDepth = outlineDepth(next);
      if (nextDepth < depth) return -1;
      if (nextDepth === depth) return next;
    }
    return -1;
  }
  function outlineParentIndex(index) {
    var depth = outlineDepth(index);
    for (var cursor = index - 1; cursor >= 0; cursor -= 1) {
      if (outlineDepth(cursor) < depth) return cursor;
    }
    return -1;
  }
  function insertOutlineEditingNewline(text) {
    if (!text) return false;
    var inserted = false;
    try {
      var selection = typeof window.getSelection === "function" ? window.getSelection() : null;
      if (selection && selection.rangeCount > 0 && typeof selection.getRangeAt === "function" && document.createTextNode) {
        var range = selection.getRangeAt(0);
        if (range && text.contains(range.commonAncestorContainer)) {
          range.deleteContents();
          var newline = document.createTextNode("\n");
          range.insertNode(newline);
          range.setStartAfter(newline);
          range.collapse(true);
          selection.removeAllRanges();
          selection.addRange(range);
          inserted = true;
        }
      }
    } catch (_error) {}
    if (!inserted) text.textContent = String(text.textContent || "") + "\n";
    syncOutlineTextElement(text);
    markContentMutation(true);
    return true;
  }
  function moveSelectedOutlineBranch(direction) {
    var blockId = selectedOutlineBlockId();
    var index = blockIndexById(blockId);
    if (index < 0) return false;
    syncOutlineFromDom();
    if (direction === "left") {
      if (outlineDepth(index) <= 0) return false;
      var parentIndex = outlineParentIndex(index);
      if (parentIndex < 0) return false;
      var parentId = ensureBlockId(outline[parentIndex]);
      var outdentEnd = outlineSubtreeEndIndex(index);
      var outdentedBranch = outline.splice(index, outdentEnd - index);
      for (var outdent = 0; outdent < outdentedBranch.length; outdent += 1) outdentedBranch[outdent].depth = Math.max(0, Number(outdentedBranch[outdent].depth) - 1);
      var relocatedParentIndex = blockIndexById(parentId);
      if (relocatedParentIndex < 0) return false;
      outline.splice.apply(outline, [outlineSubtreeEndIndex(relocatedParentIndex), 0].concat(outdentedBranch));
    } else if (direction === "right") {
      var previousIndex = outlineSiblingIndex(index, -1);
      var indentEnd = outlineSubtreeEndIndex(index);
      if (previousIndex < 0 || outlineDepth(index) >= 8 || outlineDepth(indentEnd - 1) >= 8) return false;
      for (var indent = index; indent < indentEnd; indent += 1) outline[indent].depth = outlineDepth(indent) + 1;
    } else {
      var siblingIndex = outlineSiblingIndex(index, direction === "up" ? -1 : 1);
      if (siblingIndex < 0) return false;
      var currentEnd = outlineSubtreeEndIndex(index);
      if (direction === "up") {
        var previousBranch = outline.slice(siblingIndex, index);
        var currentBranch = outline.slice(index, currentEnd);
        outline.splice.apply(outline, [siblingIndex, currentEnd - siblingIndex].concat(currentBranch, previousBranch));
      } else {
        var nextEnd = outlineSubtreeEndIndex(siblingIndex);
        var movingBranch = outline.slice(index, currentEnd);
        var nextBranch = outline.slice(currentEnd, nextEnd);
        outline.splice.apply(outline, [index, nextEnd - index].concat(nextBranch, movingBranch));
      }
    }
    markContentMutation(true);
    selectSingleOutlineBlock(blockId);
    renderOutline(blockIndexById(blockId));
    return true;
  }

  var OUTLINE_GUTTER_DRAG_THRESHOLD_PX = 6;
  function copyOutlineStructure(value) {
    return Array.isArray(value) ? value.map(function (block) {
      return { id: String(block && block.id || ""), text: String(block && block.text || ""), depth: outlineDepthForBlock(block), collapsed: !!(block && block.collapsed) };
    }) : [];
  }
  function outlineStructureMatches(left, right) {
    if (!Array.isArray(left) || !Array.isArray(right) || left.length !== right.length) return false;
    for (var index = 0; index < left.length; index += 1) {
      if (left[index].id !== right[index].id || left[index].text !== right[index].text
        || outlineDepthForBlock(left[index]) !== outlineDepthForBlock(right[index])
        || !!left[index].collapsed !== !!right[index].collapsed) return false;
    }
    return true;
  }
  function undoOutlineDrag() {
    if (!outlineDragUndoSnapshot || readOnly || mode !== "outline" || outlineEditingId) return false;
    outline = copyOutlineStructure(outlineDragUndoSnapshot.outline);
    var restoreId = outlineDragUndoSnapshot.selectedId;
    var restoreDirty = outlineDragUndoSnapshot.wasDirty || outlineDragUndoSnapshot.savedAfterDrag === true;
    outlineDragUndoSnapshot = null;
    selectSingleOutlineBlock(restoreId);
    markContentMutation(restoreDirty, { preserveOutlineDragUndo: true });
    renderOutline(blockIndexById(restoreId));
    return true;
  }
  function moveOutlineBranchToDrop(blockId, targetId, position) {
    if (readOnly || mode !== "outline" || !Array.isArray(outline) || ["before", "inside", "after"].indexOf(position) < 0) return false;
    syncOutlineFromDom();
    var beforeMove = copyOutlineStructure(outline);
    var sourceIndex = blockIndexById(blockId);
    var targetIndex = blockIndexById(targetId);
    if (sourceIndex < 0 || targetIndex < 0) return false;
    var sourceEnd = outlineSubtreeEndIndex(sourceIndex);
    if (targetIndex >= sourceIndex && targetIndex < sourceEnd) return false;
    var sourceDepth = outlineDepth(sourceIndex);
    var targetDepth = outlineDepth(targetIndex);
    var branch = outline.slice(sourceIndex, sourceEnd);
    var nextDepth = position === "inside" ? targetDepth + 1 : targetDepth;
    var depthDelta = nextDepth - sourceDepth;
    for (var depthIndex = 0; depthIndex < branch.length; depthIndex += 1) {
      var adjustedDepth = Math.max(0, Number(branch[depthIndex].depth) || 0) + depthDelta;
      if (adjustedDepth < 0 || adjustedDepth > 8) return false;
    }
    outline.splice(sourceIndex, branch.length);
    targetIndex = blockIndexById(targetId);
    if (targetIndex < 0) return false;
    var insertAt = position === "before" ? targetIndex : outlineSubtreeEndIndex(targetIndex);
    for (var branchIndex = 0; branchIndex < branch.length; branchIndex += 1) branch[branchIndex].depth = outlineDepthForBlock(branch[branchIndex]) + depthDelta;
    outline.splice.apply(outline, [insertAt, 0].concat(branch));
    if (outlineStructureMatches(beforeMove, outline)) return false;
    outlineDragUndoSnapshot = { outline: beforeMove, selectedId: blockId, wasDirty: dirty, savedAfterDrag: false };
    selectSingleOutlineBlock(blockId);
    markContentMutation(true, { preserveOutlineDragUndo: true });
    renderOutline(blockIndexById(blockId));
    return true;
  }
  function outlineDepthForBlock(block) { return Math.max(0, Number(block && block.depth) || 0); }
  function outlineDropPositionForPointer(row, clientY) {
    if (!row || typeof row.getBoundingClientRect !== "function" || !Number.isFinite(clientY)) return "inside";
    var rect = row.getBoundingClientRect();
    var height = Math.max(1, Number(rect.height) || (Number(rect.bottom) - Number(rect.top)) || 1);
    var offset = clientY - Number(rect.top || 0);
    if (offset < height * 0.3) return "before";
    if (offset > height * 0.7) return "after";
    return "inside";
  }
  function clearOutlineDragFeedback(gutter, ghost, targetRow) {
    gutter.classList.remove("branchDragSource");
    var sourceRow = typeof gutter.closest === "function" ? gutter.closest(".outlineRow[data-block-id]") : null;
    if (sourceRow) sourceRow.classList.remove("branchDragLifted");
    if (targetRow) targetRow.classList.remove("branchDropBefore", "branchDropInside", "branchDropAfter");
    if (ghost && ghost.parentNode && typeof ghost.parentNode.removeChild === "function") ghost.parentNode.removeChild(ghost);
  }
  function installOutlineGutterDrag(gutter, blockId) {
    if (!gutter || typeof gutter.addEventListener !== "function") return;
    function suppressGestureClick() {
      var timeoutId = 0;
      function clear() {
        gutter.removeEventListener("click", suppress, true);
        if (timeoutId && typeof window.clearTimeout === "function") window.clearTimeout(timeoutId);
        timeoutId = 0;
      }
      function suppress(ev) {
        ev.preventDefault();
        ev.stopImmediatePropagation();
        clear();
      }
      gutter.addEventListener("click", suppress, true);
      timeoutId = window.setTimeout(clear, 0);
    }
    gutter.addEventListener("pointerdown", function (ev) {
      if (ev.button !== undefined && ev.button !== 0) return;
      var startX = Number(ev.clientX) || 0;
      var startY = Number(ev.clientY) || 0;
      var dragging = false;
      var ghost = null;
      var dropTargetRow = null;
      function updateFeedback(moveEvent) {
        if (ghost) {
          ghost.style.left = (Number(moveEvent.clientX) || 0) + 14 + "px";
          ghost.style.top = (Number(moveEvent.clientY) || 0) + 14 + "px";
        }
        var pointed = typeof document.elementFromPoint === "function"
          ? document.elementFromPoint(Number(moveEvent.clientX) || 0, Number(moveEvent.clientY) || 0)
          : moveEvent.target;
        var targetRow = pointed && typeof pointed.closest === "function" ? pointed.closest(".outlineRow[data-block-id]") : null;
        var targetBlockId = targetRow ? targetRow.getAttribute("data-block-id") || "" : "";
        var sourceIndex = blockIndexById(blockId);
        var sourceEnd = sourceIndex < 0 ? -1 : outlineSubtreeEndIndex(sourceIndex);
        var targetIndex = blockIndexById(targetBlockId);
        var position = targetRow ? outlineDropPositionForPointer(targetRow, Number(moveEvent.clientY)) : "";
        var valid = sourceIndex >= 0 && targetIndex >= 0 && (targetIndex < sourceIndex || targetIndex >= sourceEnd);
        var nextDepth = position === "inside" && targetIndex >= 0 ? outlineDepth(targetIndex) + 1 : outlineDepth(targetIndex);
        var depthDelta = nextDepth - outlineDepth(sourceIndex);
        for (var branchIndex = sourceIndex; valid && branchIndex < sourceEnd; branchIndex += 1) {
          if (outlineDepth(branchIndex) + depthDelta > 8) valid = false;
        }
        if (dropTargetRow) dropTargetRow.classList.remove("branchDropBefore", "branchDropInside", "branchDropAfter");
        dropTargetRow = valid ? targetRow : null;
        if (dropTargetRow) dropTargetRow.classList.add(position === "before" ? "branchDropBefore" : position === "after" ? "branchDropAfter" : "branchDropInside");
      }
      function cleanup() {
        if (typeof document.removeEventListener === "function") {
          document.removeEventListener("pointermove", onMove, true);
          document.removeEventListener("pointerup", onUp, true);
          document.removeEventListener("pointercancel", onCancel, true);
        }
        clearOutlineDragFeedback(gutter, ghost, dropTargetRow);
        ghost = null;
        dropTargetRow = null;
      }
      function onMove(moveEvent) {
        var dx = (Number(moveEvent.clientX) || 0) - startX;
        var dy = (Number(moveEvent.clientY) || 0) - startY;
        if (!dragging) {
          if (Math.hypot(dx, dy) < OUTLINE_GUTTER_DRAG_THRESHOLD_PX) return;
          dragging = true;
          gutter.classList.add("branchDragSource");
          var sourceRow = typeof gutter.closest === "function" ? gutter.closest(".outlineRow[data-block-id]") : null;
          if (sourceRow) sourceRow.classList.add("branchDragLifted");
          var sourceBlock = outline[blockIndexById(blockId)];
          if (sourceBlock && document.body && typeof document.createElement === "function" && typeof document.body.appendChild === "function") {
            var branchSize = outlineSubtreeEndIndex(blockIndexById(blockId)) - blockIndexById(blockId);
            ghost = document.createElement("div");
            ghost.className = "outlineDragGhost";
            ghost.setAttribute("aria-hidden", "true");
            ghost.textContent = String(sourceBlock.text || "Untitled") + (branchSize > 1 ? " · " + (branchSize - 1) + " below" : "");
            document.body.appendChild(ghost);
          }
        }
        updateFeedback(moveEvent);
      }
      function onUp(upEvent) {
        cleanup();
        if (!dragging) return;
        suppressGestureClick();
        upEvent.preventDefault();
        var pointed = typeof document.elementFromPoint === "function"
          ? document.elementFromPoint(Number(upEvent.clientX) || 0, Number(upEvent.clientY) || 0)
          : upEvent.target;
        var targetRow = pointed && typeof pointed.closest === "function" ? pointed.closest(".outlineRow[data-block-id]") : null;
        var targetBlockId = targetRow ? targetRow.getAttribute("data-block-id") || "" : "";
        if (targetBlockId) moveOutlineBranchToDrop(blockId, targetBlockId, outlineDropPositionForPointer(targetRow, Number(upEvent.clientY)));
      }
      function onCancel() { cleanup(); }
      document.addEventListener("pointermove", onMove, true);
      document.addEventListener("pointerup", onUp, true);
      document.addEventListener("pointercancel", onCancel, true);
    });
  }
  function insertOutlineSiblingFromNavigation() {
    var selectedId = selectedOutlineBlockId();
    if (selectedId) return insertOutlineSibling(selectedId, "below");
    if (readOnly || mode !== "outline") return false;
    syncOutlineFromDom();
    var block = makeBlock("", 0);
    outline.push(block);
    selectSingleOutlineBlock(block.id);
    outlineEditingId = block.id;
    outlineEditingOriginalText = "";
    outlineEditingWasDirty = dirty;
    markContentMutation(true);
    renderOutline(outline.length - 1);
    return true;
  }
  function insertOutlineSibling(targetBlockId, direction) {
    if (readOnly || mode !== "outline" || !Array.isArray(outline) || (direction !== "above" && direction !== "below")) return false;
    syncOutlineFromDom();
    var targetIndex = blockIndexById(targetBlockId);
    if (targetIndex < 0) return false;
    var insertAt = direction === "above" ? targetIndex : outlineSubtreeEndIndex(targetIndex);
    var block = makeBlock("", outlineDepth(targetIndex));
    outline.splice(insertAt, 0, block);
    selectSingleOutlineBlock(block.id);
    outlineEditingOriginalText = "";
    outlineEditingWasDirty = dirty;
    outlineEditingId = block.id;
    markContentMutation(true);
    renderOutline(insertAt);
    return true;
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
    return { text: lines.join("\n"), count: lines.length };
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
  function cloneOutlineBlock(block) {
    return { id: makeBlock("", 0).id, text: String(block && block.text || ""), depth: Math.max(0, Math.min(8, Number(block && block.depth) || 0)), collapsed: !!(block && block.collapsed) };
  }
  function duplicateOutlineSelection() {
    if (mode !== "outline" || !hasOutlineSelection()) return false;
    var rootIndexes = selectedOutlineRootIndexes();
    if (!rootIndexes.length) return false;
    var clones = [];
    var clonedRootIds = [];
    var insertAt = 0;
    rootIndexes.forEach(function (rootIndex) {
      insertAt = Math.max(insertAt, outlineSubtreeEndIndex(rootIndex));
      var end = outlineSubtreeEndIndex(rootIndex);
      for (var i = rootIndex; i < end; i += 1) {
        var clone = cloneOutlineBlock(outline[i]);
        if (i === rootIndex) clonedRootIds.push(clone.id);
        clones.push(clone);
      }
    });
    if (!clones.length) return false;
    outline.splice.apply(outline, [insertAt, 0].concat(clones));
    outlineSelectedIds.clear();
    clonedRootIds.forEach(function (blockId) { outlineSelectedIds.add(blockId); });
    outlineSelectionAnchorId = clonedRootIds[0] || "";
    markContentMutation(true);
    setSaveState("duplicated " + clonedRootIds.length + " outline block" + (clonedRootIds.length === 1 ? "" : "s"), "");
    renderOutline(insertAt);
    return true;
  }
  function deleteOutlineSelection() {
    if (mode !== "outline" || !hasOutlineSelection()) return false;
    var rootIndexes = selectedOutlineRootIndexes();
    if (!rootIndexes.length) return false;
    var ranges = rootIndexes.map(function (rootIndex) {
      return { start: rootIndex, end: outlineSubtreeEndIndex(rootIndex) };
    });
    var firstDeletedIndex = ranges[0].start;
    var deletedCount = 0;
    for (var i = ranges.length - 1; i >= 0; i -= 1) {
      var range = ranges[i];
      var count = Math.max(0, range.end - range.start);
      if (!count) continue;
      outline.splice(range.start, count);
      deletedCount += count;
    }
    if (!deletedCount) return false;
    outlineSelectedIds.clear();
    outlineSelectionAnchorId = "";
    if (!outline.length) outline = [makeBlock("", 0)];
    var focusIndex = Math.min(firstDeletedIndex, outline.length - 1);
    var focusBlockId = ensureBlockId(outline[focusIndex]);
    if (focusBlockId) outlineSelectedIds.add(focusBlockId);
    outlineSelectionAnchorId = focusBlockId;
    markContentMutation(true);
    setSaveState("deleted " + deletedCount + " outline row" + (deletedCount === 1 ? "" : "s"), "");
    renderOutline(focusIndex);
    return true;
  }
  function leadingIndentInfo(line) {
    var match = String(line || "").match(/^[ \t]*/);
    var leading = match ? match[0] : "";
    var tabs = 0;
    var spaces = 0;
    for (var i = 0; i < leading.length; i += 1) {
      if (leading.charAt(i) === "\t") tabs += 1;
      else if (leading.charAt(i) === " ") spaces += 1;
    }
    return { tabs: tabs, spaces: spaces, text: String(line || "").slice(leading.length) };
  }
  function inferPastedSpaceUnit(lines) {
    var indents = lines.map(function (line) { return leadingIndentInfo(line).spaces; });
    var shallowest = indents.reduce(function (minSpaces, spaces) { return Math.min(minSpaces, spaces); }, indents[0] || 0);
    var unit = 0;
    indents.forEach(function (spaces) {
      var relativeSpaces = spaces - shallowest;
      if (relativeSpaces > 0 && (unit === 0 || relativeSpaces < unit)) unit = relativeSpaces;
    });
    return Math.max(1, unit || shallowest || 1);
  }
  function outlineBlocksFromPastedText(text, baseDepth) {
    var rawLines = String(text || "").replace(/\r\n/g, "\n").replace(/\r/g, "\n").split("\n");
    var lines = rawLines.filter(function (line) { return String(line || "").trim().length > 0; });
    if (!lines.length) return [];
    var spaceUnit = inferPastedSpaceUnit(lines);
    var parsed = lines.map(function (line) {
      var info = leadingIndentInfo(line);
      return { text: info.text, relativeDepth: info.tabs + Math.floor(info.spaces / spaceUnit) };
    });
    var shallowest = parsed.reduce(function (minDepth, item) { return Math.min(minDepth, item.relativeDepth); }, parsed[0].relativeDepth);
    return parsed.map(function (item) {
      return makeBlock(item.text, Math.max(0, Math.min(8, (Number(baseDepth) || 0) + item.relativeDepth - shallowest)));
    });
  }
  function pastedRootIds(blocks) {
    if (!blocks.length) return [];
    var minDepth = blocks.reduce(function (depth, block) { return Math.min(depth, Number(block.depth) || 0); }, Number(blocks[0].depth) || 0);
    return blocks.filter(function (block) { return (Number(block.depth) || 0) === minDepth; }).map(function (block) { return block.id; });
  }
  var LARGE_STRUCTURED_PASTE_ROW_THRESHOLD = 200;
  function collapseLargePastedRoots(blocks) {
    if (!Array.isArray(blocks) || blocks.length < LARGE_STRUCTURED_PASTE_ROW_THRESHOLD) return blocks;
    var rootDepth = blocks.reduce(function (depth, block) { return Math.min(depth, Number(block.depth) || 0); }, Number(blocks[0] && blocks[0].depth) || 0);
    for (var index = 0; index < blocks.length; index += 1) {
      var block = blocks[index];
      var next = blocks[index + 1];
      if ((Number(block.depth) || 0) === rootDepth && next && (Number(next.depth) || 0) > rootDepth) block.collapsed = true;
    }
    return blocks;
  }
  function insertOutlineBlocksAt(insertAt, blocks) {
    outline = outline.slice(0, insertAt).concat(blocks, outline.slice(insertAt));
  }
  function activeOutlineRowIndex(target) {
    var textEl = target && target.closest ? target.closest(".outlineText[data-block-id]") : null;
    var blockId = textEl ? textEl.getAttribute("data-block-id") || "" : "";
    if (!blockId && document.activeElement && document.activeElement.closest) {
      var activeText = document.activeElement.closest(".outlineText[data-block-id]");
      blockId = activeText ? activeText.getAttribute("data-block-id") || "" : "";
    }
    return blockIndexById(blockId);
  }
  function selectedOutlinePasteTarget() {
    var rootIndexes = selectedOutlineRootIndexes();
    if (!rootIndexes.length) return null;
    var finalRootIndex = rootIndexes[rootIndexes.length - 1];
    return { insertAt: outlineSubtreeEndIndex(finalRootIndex), baseDepth: outlineDepth(finalRootIndex) };
  }
  function insertStructuredOutlineText(text, options) {
    options = options || {};
    if (mode !== "outline") return 0;
    syncOutlineFromDom();
    var insertion = hasOutlineSelection() ? selectedOutlinePasteTarget() : null;
    if (!insertion && options.requireSelection === true) return 0;
    if (!insertion) {
      var rowIndex = activeOutlineRowIndex(options.target);
      if (rowIndex < 0) return 0;
      insertion = { insertAt: rowIndex + 1, baseDepth: outlineDepth(rowIndex) };
    }
    var blocks = outlineBlocksFromPastedText(text, insertion.baseDepth);
    if (!blocks.length) return 0;
    collapseLargePastedRoots(blocks);
    insertOutlineBlocksAt(insertion.insertAt, blocks);
    var rootIds = pastedRootIds(blocks);
    outlineSelectedIds.clear();
    rootIds.forEach(function (blockId) { outlineSelectedIds.add(blockId); });
    outlineSelectionAnchorId = rootIds[0] || "";
    markContentMutation(true);
    setSaveState("pasted " + blocks.length + " outline row" + (blocks.length === 1 ? "" : "s"), "");
    renderOutline(insertion.insertAt);
    return blocks.length;
  }
  function pasteOutlineSelectionFromClipboard() {
    if (mode !== "outline" || !hasOutlineSelection()) return false;
    if (!navigator.clipboard || typeof navigator.clipboard.readText !== "function") {
      setSaveState("paste unavailable - use Cmd/Ctrl+V", "failed");
      return false;
    }
    try {
      Promise.resolve(navigator.clipboard.readText()).then(function (text) {
        if (!String(text || "").trim()) {
          setSaveState("nothing to paste", "failed");
          return;
        }
        if (mode !== "outline" || !hasOutlineSelection() || !insertStructuredOutlineText(text, { requireSelection: true })) {
          setSaveState("select outline rows first", "failed");
        }
      }, function () {
        setSaveState("paste unavailable - use Cmd/Ctrl+V", "failed");
      });
      return true;
    } catch (_error) {
      setSaveState("paste unavailable - use Cmd/Ctrl+V", "failed");
      return false;
    }
  }
  function handleOutlinePaste(ev) {
    if (mode !== "outline" || !ev || !ev.clipboardData) return;
    var text = ev.clipboardData.getData("text/plain") || "";
    if (String(text).replace(/\r\n/g, "\n").replace(/\r/g, "\n").indexOf("\n") < 0) return;
    if (insertStructuredOutlineText(text, { target: ev.target }) > 0) ev.preventDefault();
  }
  function updateModeChrome() { document.body.classList.toggle("textMode", mode === "text"); document.body.classList.toggle("outlineMode", mode === "outline"); textModeBtn.classList.toggle("on", mode === "text"); outlineModeBtn.classList.toggle("on", mode === "outline"); }
  function wakeOutlineNavigation(preferredId) {
    if (!Array.isArray(outline) || outline.length === 0) outline = [makeBlock("", 0)];
    outline.forEach(ensureBlockId);
    var preferredIndex = blockIndexById(preferredId);
    if (preferredIndex < 0 || isHidden(preferredIndex)) {
      preferredIndex = 0;
      while (preferredIndex < outline.length && isHidden(preferredIndex)) preferredIndex += 1;
    }
    var block = outline[preferredIndex] || outline[0];
    var blockId = ensureBlockId(block);
    selectSingleOutlineBlock(blockId);
    renderOutline(blockIndexById(blockId));
    return blockId;
  }
  function outlineRowElement(blockId) {
    if (!outlinePane || !blockId) return null;
    var rows = outlinePane.querySelectorAll(".outlineRow[data-block-id]");
    for (var i = 0; i < rows.length; i += 1) if (rows[i].getAttribute("data-block-id") === blockId) return rows[i];
    return null;
  }
  function updateOutlineToggleChrome(toggle, index) {
    if (!toggle) return;
    var children = hasChildren(index);
    var block = outline[index] || {};
    toggle.className = "outlineToggle" + (children ? "" : " empty");
    toggle.textContent = children ? (block.collapsed ? "▸" : "▾") : "";
    toggle.setAttribute("aria-label", children ? (block.collapsed ? "Expand branch" : "Collapse branch") : "Select branch");
  }
  function createOutlineRow(block, index) {
    ensureBlockId(block);
    var row = document.createElement("div");
    row.className = "outlineRow" + (outlineSelectedIds.has(block.id) ? " isOutlineSelected" : "");
    row.setAttribute("data-block-id", block.id);
    row.setAttribute("aria-selected", outlineSelectedIds.has(block.id) ? "true" : "false");
    row.style.paddingLeft = (4 + (Number(block.depth) || 0) * 22) + "px";
    var toggle = document.createElement("button");
    toggle.type = "button";
    updateOutlineToggleChrome(toggle, index);
    installOutlineGutterDrag(toggle, block.id);
    toggle.addEventListener("click", function (ev) {
      syncOutlineFromDom();
      handleOutlineSelectClick(ev, block);
      if (ev.shiftKey || ev.metaKey || ev.ctrlKey) { focusOutlineBlock(block.id); return; }
      if (hasChildren(index)) {
        toggleOutlineBranchLocally(index);
        markContentMutation(true);
        focusOutlineBlock(block.id);
      } else focusOutlineBlock(block.id);
    });
    var text = document.createElement("div");
    text.className = "outlineText";
    text.setAttribute("data-block-id", block.id);
    var editing = outlineEditingId === block.id;
    text.contentEditable = editing ? "true" : "false";
    text.spellcheck = true;
    text.textContent = block.text || "";
    text.addEventListener("input", function () { block.text = text.textContent || ""; markContentMutation(true); });
    text.addEventListener("click", function (ev) {
      ev.stopPropagation();
      if (outlineEditingId === block.id) return;
      ev.preventDefault();
      beginOutlineRowEditing(ensureBlockId(block));
    });
    text.addEventListener("keydown", function (ev) {
      if (outlineEditingId !== block.id) return;
      if (ev.key === "Enter" && ev.altKey) { ev.preventDefault(); insertOutlineEditingNewline(text); return; }
      if (ev.key === "Enter") {
        ev.preventDefault();
        if (ev.metaKey || ev.ctrlKey) {
          syncOutlineTextElement(text);
          var currentId = ensureBlockId(block);
          outlineEditingId = "";
          outlineEditingOriginalText = "";
          outlineEditingWasDirty = false;
          insertOutlineSibling(currentId, "below");
        } else finishOutlineRowEditing(text);
        return;
      }
      if (ev.key === "Tab") {
        ev.preventDefault();
        syncOutlineTextElement(text);
        var visibleIds = visibleOutlineBlockIds();
        var visibleIndex = visibleIds.indexOf(ensureBlockId(block));
        var nextId = visibleIds[visibleIndex + (ev.shiftKey ? -1 : 1)] || "";
        finishOutlineRowEditing(text);
        if (nextId) beginOutlineRowEditing(nextId);
        return;
      }
      if (ev.key === "Backspace" && !text.textContent && outline.length > 1) {
        ev.preventDefault();
        syncOutlineFromDom();
        var nextIndex = Math.max(0, index - 1);
        outline.splice(index, 1);
        var nextBlock = outline[nextIndex];
        outlineEditingId = nextBlock ? ensureBlockId(nextBlock) : "";
        if (outlineEditingId) {
          selectSingleOutlineBlock(outlineEditingId);
          outlineEditingOriginalText = String(nextBlock.text || "");
          outlineEditingWasDirty = dirty;
        }
        markContentMutation(true);
        renderOutline(nextIndex);
        return;
      }
      if (ev.key === "Escape") { ev.preventDefault(); ev.stopPropagation(); finishOutlineRowEditing(text, { cancel: true }); }
    });
    row.appendChild(toggle);
    row.appendChild(text);
    row.addEventListener("click", function (ev) {
      if (outlineEditingId === block.id || ev.target === text || ev.target === toggle) return;
      var blockId = ensureBlockId(block);
      if (ev.shiftKey) selectOutlineRange(blockId);
      else if (ev.metaKey || ev.ctrlKey) {
        if (outlineSelectedIds.has(blockId)) outlineSelectedIds.delete(blockId);
        else outlineSelectedIds.add(blockId);
        outlineSelectionAnchorId = blockId;
        updateOutlineSelectionChrome();
      } else selectSingleOutlineBlock(blockId);
      focusOutlineBlock(blockId);
    });
    return row;
  }
  function toggleOutlineBranchLocally(index) {
    var block = outline[index];
    var row = block && outlineRowElement(ensureBlockId(block));
    if (!block || !row || !hasChildren(index)) return false;
    block.collapsed = !block.collapsed;
    updateOutlineToggleChrome(row.children[0], index);
    var branchEnd = outlineSubtreeEndIndex(index);
    if (block.collapsed) {
      for (var removeIndex = index + 1; removeIndex < branchEnd; removeIndex += 1) {
        var descendantRow = outlineRowElement(ensureBlockId(outline[removeIndex]));
        if (descendantRow && descendantRow.parentNode) descendantRow.parentNode.removeChild(descendantRow);
      }
      return true;
    }
    var insertionPoint = row.nextSibling;
    for (var insertIndex = index + 1; insertIndex < branchEnd; insertIndex += 1) {
      if (!isHidden(insertIndex)) outlinePane.insertBefore(createOutlineRow(outline[insertIndex], insertIndex), insertionPoint);
    }
    return true;
  }
  function renderOutline(focusIndex) {
    syncOutlineFromDom();
    if (!Array.isArray(outline) || outline.length === 0) outline = [makeBlock("", 0)];
    outline.forEach(ensureBlockId);
    pruneOutlineSelection();
    outlinePane.innerHTML = "";
    outline.forEach(function (block, index) {
      if (isHidden(index)) return;
      var row = createOutlineRow(block, index);
      outlinePane.appendChild(row);
      if (index === focusIndex) {
        if (outlineEditingId === block.id) requestAnimationFrame(function () { row.children[1].focus({ preventScroll: true }); });
        else focusOutlineBlock(block.id);
      }
    });
  }
  function setMode(nextMode) { if (readOnly) return false; if (mode === "outline") syncOutlineFromDom(); if (nextMode !== "outline") { outlineEditingId = ""; outlineEditingOriginalText = ""; outlineEditingWasDirty = false; closeOutlineContextMenu({ restoreFocus: false }); clearOutlineSelection(); } mode = nextMode === "outline" ? "outline" : "text"; updateModeChrome(); if (mode === "outline") wakeOutlineNavigation(selectedOutlineBlockId()); else bodyInput.focus({ preventScroll: true }); return true; }
  function selectAndFocusOutlineBlock(blockId) {
    if (!blockId || blockIndexById(blockId) < 0) return false;
    selectSingleOutlineBlock(blockId);
    focusOutlineBlock(blockId);
    return true;
  }
  function visibleParentOutlineBlockId(index) {
    var depth = outlineDepth(index);
    for (var cursor = index - 1; cursor >= 0; cursor -= 1) {
      if (outlineDepth(cursor) < depth) return ensureBlockId(outline[cursor]);
    }
    return "";
  }
  function navigateSelectedOutline(key) {
    var blockId = selectedOutlineBlockId();
    var index = blockIndexById(blockId);
    if (index < 0) return false;
    var visible = visibleOutlineBlockIds();
    var visibleIndex = visible.indexOf(blockId);
    if (visibleIndex < 0) return false;
    if (key === "ArrowUp" || key === "ArrowDown") {
      return selectAndFocusOutlineBlock(visible[visibleIndex + (key === "ArrowUp" ? -1 : 1)] || "");
    }
    if (key === "ArrowLeft") {
      if (hasChildren(index) && outline[index].collapsed !== true) {
        toggleOutlineBranchLocally(index);
        markContentMutation(true);
        return selectAndFocusOutlineBlock(blockId);
      }
      return selectAndFocusOutlineBlock(visibleParentOutlineBlockId(index));
    }
    if (key === "ArrowRight") {
      if (hasChildren(index) && outline[index].collapsed === true) {
        toggleOutlineBranchLocally(index);
        markContentMutation(true);
        return selectAndFocusOutlineBlock(blockId);
      }
      var child = outline[index + 1];
      return child && outlineDepth(index + 1) > outlineDepth(index)
        ? selectAndFocusOutlineBlock(ensureBlockId(child)) : false;
    }
    return false;
  }
  function currentBody() { return bodyInput.value; }
  function buildPayload() {
    if (readOnly) return null;
    if (Array.isArray(outline)) { syncOutlineFromDom(); outline.forEach(ensureBlockId); }
    var nextPayload = {
      id: payload.id,
      title: titleInput.value,
      body: currentBody(),
      mode: mode,
      outline: outline,
      updatedAt: new Date().toISOString(),
      fileSessionId: payload.fileSessionId,
      sourceFileName: payload.sourceFileName,
      sourcePipSession: payload.sourcePipSession,
      sourceOwnerKind: payload.sourceOwnerKind,
      sourceVaultSessionId: payload.sourceVaultSessionId,
      originalUpdatedAt: payload.originalUpdatedAt
    };
    nextPayload.schema = "pocket.nodeEditor.v1";
    return nextPayload;
  }
  function hasCompleteSaveContext() {
    return ownerToken.length > 0
      && popupToken.length > 0
      && Number.isSafeInteger(payload.fileSessionId)
      && payload.fileSessionId >= 0
      && typeof payload.sourceFileName === "string"
      && payload.sourceFileName.length <= 120
      && typeof payload.sourcePipSession === "boolean"
      && (payload.sourceOwnerKind === "json"
        || payload.sourceOwnerKind === "vault"
        || payload.sourceOwnerKind === "synced"
        || payload.sourceOwnerKind === "detached")
      && typeof payload.sourceVaultSessionId === "string"
      && payload.sourceVaultSessionId.length <= 120
      && (payload.sourceOwnerKind !== "vault" || payload.sourceVaultSessionId.length > 0)
      && typeof payload.originalUpdatedAt === "string"
      && payload.originalUpdatedAt.length > 0
      && payload.originalUpdatedAt.length <= 40;
  }
  function focusEditor() { if (returnFocus && typeof returnFocus.focus === "function") returnFocus.focus({ preventScroll: true }); else bodyInput.focus({ preventScroll: true }); returnFocus = null; }
  function hideUnsavedDialog() { unsavedDialog.hidden = true; }
  function openerPopoutWindow() { try { return window.opener && !window.opener.closed && window.opener.PocketNodePopoutWindow ? window.opener.PocketNodePopoutWindow : null; } catch (_error) { return null; } }
  function completeOwnedClose() { var target = openerPopoutWindow(); try { return !!(target && typeof target.completeCloseFromOwnedPopup === "function" && target.completeCloseFromOwnedPopup(ownerToken, popupToken, window)); } catch (error) { console.error(error); return false; } }
  function cancelPendingOpen() { var target = openerPopoutWindow(); try { if (target && typeof target.cancelPendingOpen === "function") target.cancelPendingOpen(ownerToken, popupToken, window); } catch (error) { console.error(error); } }
  function keepEditing() { cancelPendingOpen(); hideUnsavedDialog(); focusEditor(); }
  function showUnsavedDialog() { if (readOnly) return false; returnFocus = document.activeElement; unsavedDialog.hidden = false; unsavedSaveBtn.focus({ preventScroll: true }); return true; }
  function requestUnsavedProtection() { if (readOnly || !dirty) return false; return showUnsavedDialog(); }
  function matchesSession(candidateOwnerToken, candidatePopupToken) { return candidateOwnerToken === ownerToken && candidatePopupToken === popupToken; }
  window.PocketNodePopoutSession = Object.freeze({
    getIdentity: function () { return { ownerToken: ownerToken, popupToken: popupToken }; },
    matches: matchesSession,
    hasUnsavedChanges: function () { return !readOnly && dirty === true; },
    requestUnsavedProtection: function (candidateOwnerToken, candidatePopupToken) {
      return matchesSession(candidateOwnerToken, candidatePopupToken) && requestUnsavedProtection();
    },
    requestOwnedClose: function (candidateOwnerToken, candidatePopupToken) {
      if (!matchesSession(candidateOwnerToken, candidatePopupToken) || (!readOnly && dirty)) return false;
      allowedToClose = true;
      window.close();
      return true;
    }
  });
  function discardAndClose() { closeOutlineContextMenu({ restoreFocus: false }); allowedToClose = true; dirty = false; if (completeOwnedClose()) return; window.close(); }
  function finishSuccessfulSave(closeAfter, label) {
    if (outlineDragUndoSnapshot) outlineDragUndoSnapshot.savedAfterDrag = true;
    setDirty(false);
    setSaveState(label || "saved", "saved");
    if (closeAfter) {
      closeOutlineContextMenu({ restoreFocus: false });
      allowedToClose = true;
      if (completeOwnedClose()) return true;
      window.setTimeout(function () { window.close(); }, 80);
    } else {
      cancelPendingOpen();
    }
    return true;
  }
  function adoptAcceptedResult(result) {
    if (!result || result.applied !== true) return;
    if (typeof result.nodeUpdatedAt === "string" && result.nodeUpdatedAt) {
      payload.originalUpdatedAt = result.nodeUpdatedAt;
      payload.updatedAt = result.nodeUpdatedAt;
    }
    var identity = result.sourceIdentity;
    if (!result.ok || !result.exported || !identity || !Number.isSafeInteger(identity.fileSessionId)) return;
    payload.fileSessionId = identity.fileSessionId;
    payload.sourceFileName = typeof identity.sourceFileName === "string" ? identity.sourceFileName : "";
    payload.sourcePipSession = identity.sourcePipSession === true;
    payload.sourceOwnerKind = typeof identity.sourceOwnerKind === "string" ? identity.sourceOwnerKind : "";
    payload.sourceVaultSessionId = typeof identity.sourceVaultSessionId === "string" ? identity.sourceVaultSessionId : "";
  }
  function saveFailureDetails(result) {
    var reason = result && result.reason ? result.reason : "save-failed";
    if (reason === "popup-session-changed") return {
      status: "This editor belongs to an earlier Pocket window — not saved",
      message: "Pocket could not verify that this editor still belongs to the current window. Nothing was changed. Copy anything you need, then close it and reopen the item from the current Pocket window."
    };
    if (reason === "file-session-changed") return {
      status: "Different Pocket file — not saved",
      message: "Pocket is now using a different file. Your editor changes were not applied. Copy anything you need, close this editor, and reopen the item from the current file."
    };
    if (reason === "node-revision-changed") return {
      status: "Item changed elsewhere — not saved",
      message: "This item changed after the editor was opened. Your changes were not applied. Copy anything you need, then close and reopen the item."
    };
    if (reason === "missing-node") return {
      status: "Item no longer exists — not saved",
      message: "This item no longer exists. Your editor changes were not applied."
    };
    if (reason === "missing-source-identity" || reason === "missing-node-revision") return {
      status: "Editor source could not be verified — not saved",
      message: "Pocket could not verify where this editor belongs. Nothing was changed. Close and reopen the item before saving."
    };
    if (reason === "cancelled") return {
      status: "Save cancelled — not saved",
      message: "The truth-file save was cancelled. Your editor changes are still here."
    };
    if (reason === "stale-guard") return {
      status: "Truth-file safety check — not saved",
      message: "Pocket paused at its stale-file safety check. Your editor changes are still here."
    };
    if (reason === "no-pocket-file") return {
      status: "No writable Pocket file — not saved",
      message: "Pocket does not have a current writable file. Your editor changes are still here."
    };
    if (reason === "downloaded-copy") return {
      status: "Copy downloaded — truth file not saved",
      message: "Pocket made a separate download, but the current truth file was not saved. Your editor remains unsaved."
    };
    if (reason === "export-unavailable") return {
      status: "Truth-file save unavailable",
      message: "Pocket could not reach the current truth-file save path. Your editor changes are still here."
    };
    if (reason === "write-failed" || reason === "permission-denied") return {
      status: "Truth-file write failed — not saved",
      message: "Pocket could not write the truth file. Your editor changes are still here, so you can retry."
    };
    return {
      status: result && result.status ? result.status : "Save not completed",
      message: result && result.message ? result.message : "Pocket did not complete the truth-file save. Your editor changes are still here."
    };
  }
  function handleSaveResult(result, closeAfter, saveGeneration) {
    result = result || {};
    adoptAcceptedResult(result);
    if (result.ok && result.exported) {
      if (editGeneration !== saveGeneration) {
        setDirty(true);
        setSaveState("earlier changes saved — newer edits remain", "saved");
        return false;
      }
      return finishSuccessfulSave(closeAfter, "saved");
    }
    if (result.ok && result.reason === "unchanged") {
      if (editGeneration !== saveGeneration) {
        setDirty(true);
        setSaveState("newer edits remain", "failed");
        return false;
      }
      return finishSuccessfulSave(closeAfter, "no changes");
    }
    var failure = saveFailureDetails(result);
    if (result.applied && !result.exported) {
      setDirty(true);
      setSaveState(failure.status, "failed");
      alert(failure.message);
      return false;
    }
    setDirty(true);
    setSaveState(failure.status, "failed");
    alert(failure.message);
    return false;
  }
  function handleSaveError(error) {
    console.error(error);
    setDirty(true);
    setSaveState("Truth-file write failed — not saved", "failed");
    alert("Pocket could not complete the truth-file save. Your editor changes are still here, so you can retry.");
    return false;
  }
  function save(closeAfter) {
    if (readOnly) return false;
    closeAfter = closeAfter === true;
    if (saveInFlight) return false;
    hideUnsavedDialog();
    if (!hasCompleteSaveContext()) {
      handleSaveResult({
        ok: false,
        applied: false,
        exported: false,
        reason: "missing-source-identity"
      }, closeAfter, editGeneration);
      return false;
    }
    setSaveState("saving…", "");
    saveInFlight = true;
    var saveGeneration = editGeneration;
    var outgoingPayload = buildPayload();
    try {
      var target = openerPopoutWindow();
      if (target && typeof target.applyAndSaveFromOwnedPopup === "function") {
        Promise.resolve(target.applyAndSaveFromOwnedPopup(ownerToken, popupToken, outgoingPayload, window)).then(function (result) {
          saveInFlight = false;
          handleSaveResult(result, closeAfter, saveGeneration);
        }, function (error) {
          saveInFlight = false;
          handleSaveError(error);
        });
        return true;
      }
    } catch (error) {
      saveInFlight = false;
      console.error(error);
    }
    saveInFlight = false;
    handleSaveResult({
      ok: false,
      applied: false,
      changed: false,
      exported: false,
      reason: "popup-session-changed"
    }, closeAfter, saveGeneration);
    return false;
  }
  function closeSafely() { closeOutlineContextMenu({ restoreFocus: false }); if (readOnly || !dirty) { allowedToClose = true; window.close(); return; } showUnsavedDialog(); }
  if (typeof environment.probe === "function") {
    environment.probe(Object.freeze({
      outlineBlocksFromPastedText: outlineBlocksFromPastedText,
      collapseLargePastedRoots: collapseLargePastedRoots,
      insertOutlineBlocksAt: function (existing, insertAt, blocks) {
        outline = Array.isArray(existing) ? existing : [];
        insertOutlineBlocksAt(insertAt, blocks);
        return outline;
      },
      renderEmptyOutline: function (pane) {
        outline = [];
        outlinePane = pane;
        outlineSelectedIds = new Set();
        outlineSelectionAnchorId = "";
        renderOutline();
        return outline;
      },
    }));
    return true;
  }
  titleInput.addEventListener("input", function () { markContentMutation(true); });
  bodyInput.addEventListener("input", function () { markContentMutation(true); });
  saveBtn.addEventListener("click", function () { save(false); });
  saveCloseBtn.addEventListener("click", function () { save(true); });
  outlinePane.addEventListener("paste", handleOutlinePaste);
  outlinePane.addEventListener("contextmenu", handleOutlineContextMenu);
  if (outlineContextMenu) {
    outlineContextMenu.addEventListener("click", function (ev) {
      var button = ev.target && typeof ev.target.closest === "function" ? ev.target.closest("button[data-outline-action]") : null;
      if (!button || !outlineContextMenu.contains(button)) return;
      ev.preventDefault();
      ev.stopPropagation();
      var action = button.getAttribute("data-outline-action") || "";
      if (action === "insert-above" || action === "insert-below") {
        var contextTargetId = outlineContextTargetId;
        closeOutlineContextMenu({ restoreFocus: false });
        if (!insertOutlineSibling(contextTargetId, action === "insert-above" ? "above" : "below")) setSaveState("insert unavailable", "failed");
        return;
      }
      if (mode !== "outline" || !hasOutlineSelection()) {
        closeOutlineContextMenu({ restoreFocus: true });
        setSaveState("select outline rows first", "failed");
        return;
      }
      if (action === "copy") { closeOutlineContextMenu({ restoreFocus: true }); if (!copyOutlineSelection()) setSaveState("copy failed", "failed"); return; }
      if (action === "paste") { closeOutlineContextMenu({ restoreFocus: true }); pasteOutlineSelectionFromClipboard(); return; }
      if (action === "duplicate") { closeOutlineContextMenu({ restoreFocus: false }); if (!duplicateOutlineSelection()) setSaveState("duplicate unavailable", "failed"); return; }
      if (action === "delete") { closeOutlineContextMenu({ restoreFocus: false }); if (!deleteOutlineSelection()) setSaveState("delete unavailable", "failed"); return; }
      closeOutlineContextMenu({ restoreFocus: true });
    });
    outlineContextMenu.addEventListener("keydown", handleOutlineContextMenuKeydown);
  }
  document.addEventListener("pointerdown", function (ev) { if (outlineContextMenuIsOpen() && !outlineContextMenu.contains(ev.target)) closeOutlineContextMenu({ restoreFocus: false }); }, true);
  window.addEventListener("scroll", function () { closeOutlineContextMenu({ restoreFocus: false }); }, true);
  window.addEventListener("resize", function () { closeOutlineContextMenu({ restoreFocus: false }); });
  document.getElementById("closeBtn").addEventListener("click", closeSafely);
  unsavedSaveBtn.addEventListener("click", function () { save(true); });
  unsavedDiscardBtn.addEventListener("click", discardAndClose);
  unsavedCancelBtn.addEventListener("click", keepEditing);
  textModeBtn.addEventListener("click", function () { setMode("text"); });
  outlineModeBtn.addEventListener("click", function () { setMode("outline"); });
  document.addEventListener("keydown", function (ev) {
    if (!isEditablePeTarget(ev.target) && mode === "outline" && !outlineContextMenuIsOpen() && unsavedDialog.hidden
      && !ev.altKey && !ev.shiftKey && (ev.metaKey || ev.ctrlKey) && (ev.key === "z" || ev.key === "Z")
      && undoOutlineDrag()) {
      ev.preventDefault();
      return;
    }
    var outlineNavigationTarget = !isEditablePeTarget(ev.target)
      && mode === "outline"
      && !outlineContextMenuIsOpen()
      && unsavedDialog.hidden
      && !ev.metaKey && !ev.ctrlKey && !ev.altKey && !ev.shiftKey;
    if (outlineNavigationTarget && ev.key === "Enter" && selectedOutlineBlockId()) {
      ev.preventDefault();
      beginOutlineRowEditing(selectedOutlineBlockId());
      return;
    }
    if (outlineNavigationTarget && ["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"].includes(ev.key)
      && navigateSelectedOutline(ev.key)) {
      ev.preventDefault();
      return;
    }
    if (!isEditablePeTarget(ev.target) && mode === "outline" && !outlineContextMenuIsOpen() && unsavedDialog.hidden
      && !ev.altKey && !ev.shiftKey && (ev.metaKey || ev.ctrlKey)
      && ["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"].includes(ev.key)) {
      ev.preventDefault();
      moveSelectedOutlineBranch(ev.key === "ArrowUp" ? "up" : ev.key === "ArrowDown" ? "down" : ev.key === "ArrowLeft" ? "left" : "right");
      return;
    }
    if (!isEditablePeTarget(ev.target) && mode === "outline" && !outlineContextMenuIsOpen() && unsavedDialog.hidden
      && !ev.metaKey && !ev.ctrlKey && !ev.altKey && (ev.key === "+" || ev.key === "=" || ev.key === "Add")) {
      ev.preventDefault();
      insertOutlineSiblingFromNavigation();
      return;
    }
    var outlineShortcutTarget = !isEditablePeTarget(ev.target)
      && mode === "outline"
      && !outlineContextMenuIsOpen()
      && unsavedDialog.hidden;
    if (outlineShortcutTarget && (ev.key === "," || ev.key === ".")
      && (ev.metaKey || ev.ctrlKey) && !ev.altKey && !ev.shiftKey) {
      ev.preventDefault();
      collapseOrExpandAllOutlineBranches(ev.key === ",");
      return;
    }
    if (!isEditablePeTarget(ev.target) && (ev.key === "c" || ev.key === "C") && (ev.metaKey || ev.ctrlKey) && !ev.altKey && !ev.shiftKey && copyOutlineSelection()) { ev.preventDefault(); return; }
    if ((ev.key === "d" || ev.key === "D") && (ev.metaKey || ev.ctrlKey) && !ev.altKey && !ev.shiftKey && duplicateOutlineSelection()) { ev.preventDefault(); return; }
    if ((ev.key === "Delete" || ev.key === "Backspace") && !ev.metaKey && !ev.ctrlKey && !ev.altKey && !ev.shiftKey && mode === "outline" && hasOutlineSelection() && !isEditablePeTarget(ev.target)) {
      ev.preventDefault();
      closeOutlineContextMenu({ restoreFocus: false });
      deleteOutlineSelection();
      return;
    }
    if ((ev.key === "s" || ev.key === "S" || ev.key === "Enter") && (ev.metaKey || ev.ctrlKey)) { ev.preventDefault(); if (!readOnly) save(false); return; }
    if (ev.key === "Escape") {
      ev.preventDefault();
      if (closeOutlineContextMenu({ restoreFocus: true })) return;
      if (!unsavedDialog.hidden) { keepEditing(); return; }
      if (finishOutlineRowEditing(ev.target, { cancel: true })) return;
      closeSafely();
    }
  });
  window.addEventListener("beforeunload", function (ev) { if (readOnly || !dirty || allowedToClose) return; ev.preventDefault(); ev.returnValue = ""; });
  applyReadOnlyState();
  updateModeChrome();
  if (readOnly) bodyInput.focus({ preventScroll: true });
  else if (mode === "outline") wakeOutlineNavigation("");
  else { titleInput.focus(); titleInput.select(); }
  return true;
  }

  function initialPayloadFromDocument() {
    if (!global.document || typeof global.document.getElementById !== "function") return null;
    var carrier = global.document.getElementById("pocketNodePopoutPayload");
    if (!carrier || carrier.tagName !== "TEXTAREA") return null;
    try {
      var value = JSON.parse(carrier.value);
      return value && typeof value === "object" && !Array.isArray(value) ? value : null;
    } catch (_error) { return null; }
  }

  global.PocketNodePopoutRuntime = Object.freeze({ initialise: initialise });
  var initialPayload = initialPayloadFromDocument();
  if (initialPayload) initialise(initialPayload);
})(window);
