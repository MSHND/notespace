/* Same-origin runtime for the unified standalone node popout editor. */
(function initialisePocketNodePopoutRuntime(global) {
  "use strict";
  function initialise(initialPayload, environment) {
    environment = environment || {};
    var window = environment.window || global;
    var document = environment.document || window.document;
    var navigator = environment.navigator || window.navigator || {};
    var requestAnimationFrame = environment.requestAnimationFrame || window.requestAnimationFrame || function (callback) { return window.setTimeout(callback, 0); };
    var alert = environment.alert || window.alert || function () {};
    var console = environment.console || window.console || { error: function () {} };
    var content = environment.content || window.PocketNodeContent;
    try { if (!content && window.opener && !window.opener.closed) content = window.opener.PocketNodeContent; } catch (_error) {}
    if (!content || !initialPayload || typeof initialPayload !== "object" || Array.isArray(initialPayload)) return false;
    var payload = Object.assign({}, initialPayload);
    var ownerToken = typeof payload.popupOwnerToken === "string" ? payload.popupOwnerToken : "";
    var popupToken = typeof payload.popupInstanceToken === "string" ? payload.popupInstanceToken : "";
    delete payload.popupOwnerToken; delete payload.popupInstanceToken;
    var readOnly = payload.readOnly === true;
    var dirty = false, editGeneration = 0, allowedToClose = false, saveInFlight = false;
    var titleInput = document.getElementById("titleInput");
    var pane = document.getElementById("outlinePane");
    var saveState = document.getElementById("saveState");
    var saveBtn = document.getElementById("saveBtn");
    var saveCloseBtn = document.getElementById("saveCloseBtn");
    var unsavedDialog = document.getElementById("unsavedDialog");
    var unsavedSaveBtn = document.getElementById("unsavedSaveBtn");
    var unsavedDiscardBtn = document.getElementById("unsavedDiscardBtn");
    var unsavedCancelBtn = document.getElementById("unsavedCancelBtn");
    if (!titleInput || !pane || !saveState || !saveBtn || !saveCloseBtn || !unsavedDialog || !unsavedSaveBtn || !unsavedDiscardBtn || !unsavedCancelBtn) return false;
    var parsed = content.parseLines(typeof payload.text === "string" ? payload.text : (payload.body || ""));
    var nextId = parsed.length;
    var lines = parsed.map(function (line, index) { return { id: "line_" + index, depth: line.depth, content: line.content }; });
    var collapsed = new Set();
    var selectedId = lines[0] ? lines[0].id : "";
    var dragSourceId = "";
    var returnFocus = null;
    var rowRegistry = new Map();
    var presentationIndexSeeded = false;
    var presentationProbe = typeof environment.presentationProbe === "function" ? environment.presentationProbe : null;

    function lineIndex(id) { for (var i = 0; i < lines.length; i += 1) if (lines[i].id === id) return i; return -1; }
    function hasChildren(index) { return content.hasChildren(lines, index); }
    function subtreeEnd(index) { return content.subtreeEnd(lines, index); }
    function isHidden(index) {
      var depth = Number(lines[index] && lines[index].depth) || 0;
      for (var i = index - 1; i >= 0; i -= 1) {
        var parentDepth = Number(lines[i] && lines[i].depth) || 0;
        if (parentDepth >= depth) continue;
        if (collapsed.has(lines[i].id)) return true;
        depth = parentDepth;
        if (depth <= 0) break;
      }
      return false;
    }
    function buildText() { return content.serialiseLines(lines); }
    function setSaveState(text, kind) { saveState.textContent = text || ""; saveState.className = "status" + (kind ? " " + kind : ""); }
    function setDirty(next) { if (readOnly) next = false; dirty = !!next; document.body?.classList?.toggle?.("isDirty", dirty); if (dirty) setSaveState("", ""); }
    function markMutation() { if (readOnly) return false; editGeneration += 1; setDirty(true); return true; }
    function createLine(contentText, depth) { nextId += 1; return { id: "line_new_" + nextId, depth: Math.max(0, Math.min(8, Number(depth) || 0)), content: String(contentText || "") }; }
    function rowHtmlState(index) { return { branch: hasChildren(index), collapsed: collapsed.has(lines[index].id) }; }
    function createRow(line, index) {
      var row = document.createElement("div"); row.className = "docRow"; row.setAttribute("data-line-id", line.id); row.setAttribute("data-depth", String(line.depth)); row.style.paddingLeft = (4 + line.depth * 22) + "px";
      var gutter = document.createElement("button"); gutter.type = "button"; gutter.className = "lineGutter" + (hasChildren(index) ? " branch" : " empty"); gutter.setAttribute("data-line-id", line.id); gutter.textContent = hasChildren(index) ? (collapsed.has(line.id) ? "▸" : "▾") : ""; gutter.setAttribute("aria-label", hasChildren(index) ? (collapsed.has(line.id) ? "Expand branch" : "Collapse branch") : "Line"); gutter.draggable = hasChildren(index) && !readOnly;
      var text = document.createElement("div"); text.className = "lineText"; text.setAttribute("data-line-id", line.id); text.contentEditable = readOnly ? "false" : "true"; text.spellcheck = true; text.textContent = line.content;
      row.appendChild(gutter); row.appendChild(text); return row;
    }
    function notePresentation(kind, count) {
      if (!presentationProbe) return;
      try { presentationProbe(kind, Number(count) || 1); } catch (_error) {}
    }
    function seedPresentationIndex() {
      if (presentationIndexSeeded) return true;
      var mounted = Array.prototype.slice.call(pane.children || []);
      notePresentation("full-pane-enumeration", 1);
      if (mounted.length === 0 && lines.length > 0) return false;
      rowRegistry.clear();
      for (var i = 0; i < mounted.length; i += 1) {
        var id = mounted[i]?.getAttribute?.("data-line-id") || "";
        if (id) rowRegistry.set(id, mounted[i]);
      }
      presentationIndexSeeded = true;
      return true;
    }
    function rowForId(id) {
      if (!presentationIndexSeeded) seedPresentationIndex();
      notePresentation("keyed-row-lookup", 1);
      return rowRegistry.get(id) || null;
    }
    function rowParts(row) {
      var result = { gutter: null, text: null }, nodes = row && (row.children || row.childNodes) || [];
      for (var i = 0; i < nodes.length; i += 1) {
        var node = nodes[i]; if (!node || node.nodeType === 3) continue;
        var classes = String(node.className || "").split(/\s+/);
        if (!result.gutter && classes.includes("lineGutter")) result.gutter = node;
        if (!result.text && classes.includes("lineText")) result.text = node;
      }
      return result;
    }
    function createVisibleRow(index) {
      var line = lines[index]; if (!line) return null;
      var row = createRow(line, index);
      rowRegistry.set(line.id, row);
      presentationIndexSeeded = true;
      notePresentation("row-create", 1);
      return row;
    }
    function detachVisibleRow(id) {
      var row = rowForId(id); if (!row) return false;
      if (row.parentNode === pane && typeof pane.removeChild === "function") pane.removeChild(row);
      rowRegistry.delete(id);
      notePresentation("row-remove", 1);
      return true;
    }
    function insertRowBefore(row, beforeRow) {
      if (!row) return false;
      var moving = row.parentNode === pane;
      if (beforeRow === row) return true;
      if (typeof pane.insertBefore === "function") pane.insertBefore(row, beforeRow || null);
      else if (!beforeRow && typeof pane.appendChild === "function") pane.appendChild(row);
      else return false;
      notePresentation(moving ? "row-move" : "row-insert", 1);
      return true;
    }
    function insertRowAfter(row, anchorRow) {
      if (!anchorRow) return insertRowBefore(row, pane.firstChild || null);
      return insertRowBefore(row, anchorRow.nextSibling || null);
    }
    function moveRowsBefore(rows, beforeRow) {
      for (var i = 0; i < rows.length; i += 1) if (rows[i]) insertRowBefore(rows[i], beforeRow || null);
    }
    function updateRowPresentation(row, index, updateText) {
      var line = lines[index]; if (!row || !line) return false;
      notePresentation("row-refresh", 1);
      var depth = Math.max(0, Math.min(8, Number(line.depth) || 0));
      if (row.getAttribute?.("data-line-id") !== line.id) row.setAttribute?.("data-line-id", line.id);
      if (row.getAttribute?.("data-depth") !== String(depth)) row.setAttribute?.("data-depth", String(depth));
      if (row.style) row.style.paddingLeft = (4 + depth * 22) + "px";
      var parts = rowParts(row), branch = hasChildren(index), folded = collapsed.has(line.id);
      if (parts.gutter) {
        var gutterClass = "lineGutter" + (branch ? " branch" : " empty");
        if (parts.gutter.className !== gutterClass) parts.gutter.className = gutterClass;
        parts.gutter.setAttribute?.("data-line-id", line.id);
        var glyph = branch ? (folded ? "▸" : "▾") : "";
        if (parts.gutter.textContent !== glyph) parts.gutter.textContent = glyph;
        parts.gutter.setAttribute?.("aria-label", branch ? (folded ? "Expand branch" : "Collapse branch") : "Line");
        parts.gutter.draggable = branch && !readOnly;
      }
      if (parts.text) {
        parts.text.setAttribute?.("data-line-id", line.id);
        if (updateText === true && parts.text.textContent !== line.content) parts.text.textContent = line.content;
      }
      return true;
    }
    function refreshRowAt(index, updateText) {
      if (index < 0 || index >= lines.length) return false;
      var row = rowForId(lines[index].id); if (!row) return false;
      return updateRowPresentation(row, index, updateText === true);
    }
    function refreshRowsAt(indexes) {
      var seen = new Set();
      for (var i = 0; i < indexes.length; i += 1) {
        var index = Number(indexes[i]);
        if (!Number.isInteger(index) || index < 0 || index >= lines.length || seen.has(index)) continue;
        seen.add(index); refreshRowAt(index, false);
      }
    }
    function refreshRowsByIds(ids) {
      var seen = new Set();
      for (var i = 0; i < ids.length; i += 1) {
        var id = ids[i]; if (!id || seen.has(id)) continue; seen.add(id);
        var index = lineIndex(id); if (index >= 0) refreshRowAt(index, false);
      }
    }
    function visibleDescendantIndexes(index) {
      var result = [], end = subtreeEnd(index), blockedDepth = null;
      for (var cursor = index + 1; cursor < end; cursor += 1) {
        var depth = Number(lines[cursor]?.depth) || 0;
        if (blockedDepth !== null) {
          if (depth > blockedDepth) continue;
          blockedDepth = null;
        }
        result.push(cursor);
        if (collapsed.has(lines[cursor].id) && hasChildren(cursor)) blockedDepth = depth;
      }
      return result;
    }
    function rebuildProjectionForRecovery(preferredId, caretAtEnd) {
      notePresentation("recovery-full-scan", 1);
      if (!Array.isArray(lines) || lines.length === 0) lines = [createLine("", 0)];
      pane.innerHTML = "";
      rowRegistry.clear(); presentationIndexSeeded = true;
      var visible = typeof content.visibleIndexes === "function" ? content.visibleIndexes(lines, collapsed) : [];
      for (var i = 0; i < visible.length; i += 1) {
        var row = createVisibleRow(visible[i]);
        if (row) pane.appendChild(row);
      }
      if (preferredId) focusLine(preferredId, caretAtEnd === true);
      return true;
    }
    function lineElement(id) {
      var row = rowForId(id); if (!row) return null;
      return rowParts(row).text;
    }
    function focusLine(id, caretAtEnd) {
      var el = lineElement(id); if (!el || typeof el.focus !== "function") return;
      el.focus({ preventScroll: true });
      if (!caretAtEnd) return;
      try {
        var selection = typeof environment.getSelection === "function" ? environment.getSelection() : (typeof window.getSelection === "function" ? window.getSelection() : (typeof document.getSelection === "function" ? document.getSelection() : null));
        var range = typeof document.createRange === "function" ? document.createRange() : null;
        if (!selection || !range || typeof range.selectNodeContents !== "function" || typeof range.collapse !== "function" || typeof selection.removeAllRanges !== "function" || typeof selection.addRange !== "function") return;
        range.selectNodeContents(el); range.collapse(false); selection.removeAllRanges(); selection.addRange(range);
      } catch (_error) {}
    }
    function syncLineElement(target) {
      if (!target || typeof target.getAttribute !== "function") return -1;
      var id = target.getAttribute("data-line-id") || ""; var index = lineIndex(id); if (index < 0) return -1;
      lines[index].content = target.textContent || ""; return index;
    }
    function selectionParts(target) {
      var selection = null;
      try { selection = typeof environment.getSelection === "function" ? environment.getSelection() : (typeof window.getSelection === "function" ? window.getSelection() : (typeof document.getSelection === "function" ? document.getSelection() : null)); } catch (_error) { return null; }
      if (!selection || selection.rangeCount !== 1 || typeof selection.getRangeAt !== "function") return null;
      var range = null;
      try { range = selection.getRangeAt(0); } catch (_error) { return null; }
      if (!range || typeof range.cloneRange !== "function" || !range.startContainer || !range.endContainer || !(target === range.startContainer || target.contains?.(range.startContainer)) || !(target === range.endContainer || target.contains?.(range.endContainer))) return null;
      try {
        var before = range.cloneRange(); before.selectNodeContents(target); before.setEnd(range.startContainer, range.startOffset);
        var after = range.cloneRange(); after.selectNodeContents(target); after.setStart(range.endContainer, range.endOffset);
        return { prefix: before.toString(), suffix: after.toString() };
      } catch (_error) { return null; }
    }
    function collapsedCaretState(target) {
      var selection = null;
      try { selection = typeof environment.getSelection === "function" ? environment.getSelection() : (typeof window.getSelection === "function" ? window.getSelection() : (typeof document.getSelection === "function" ? document.getSelection() : null)); } catch (_error) { return null; }
      if (!selection || selection.rangeCount !== 1 || typeof selection.getRangeAt !== "function") return null;
      var range = null;
      try { range = selection.getRangeAt(0); } catch (_error) { return null; }
      if (!range || range.collapsed !== true || typeof range.cloneRange !== "function" || !range.startContainer || !range.endContainer || !(target === range.startContainer || target.contains?.(range.startContainer)) || !(target === range.endContainer || target.contains?.(range.endContainer))) return null;
      try {
        var before = range.cloneRange(); before.selectNodeContents(target); before.setEnd(range.startContainer, range.startOffset);
        var rowY = null, rect = null;
        if (typeof range.getBoundingClientRect === "function") rect = range.getBoundingClientRect();
        if ((!rect || !Number.isFinite(Number(rect.top)) || !Number.isFinite(Number(rect.bottom))) && typeof range.getClientRects === "function") {
          var rects = range.getClientRects(); if (rects && rects.length) rect = rects[0];
        }
        if (rect) {
          var top = Number(rect.top), bottom = Number(rect.bottom);
          if (Number.isFinite(top) && Number.isFinite(bottom) && bottom - top > 0.5) rowY = (top + bottom) / 2;
        }
        return { offset: before.toString().length, rowY: rowY };
      } catch (_error) { return null; }
    }
    function collapsedCaretOffset(target) { var state = collapsedCaretState(target); return state ? state.offset : null; }
    function textPointAtOffset(target, offset) {
      var targetOffset = Math.max(0, Math.min(Number(offset) || 0, String(target && target.textContent || "").length));
      var remaining = targetOffset, lastText = null;
      function descend(node) {
        var children = node && node.childNodes ? node.childNodes : [];
        for (var i = 0; i < children.length; i += 1) {
          var child = children[i];
          if (child && child.nodeType === 3) {
            var value = String(child.nodeValue != null ? child.nodeValue : (child.textContent || ""));
            lastText = child;
            if (remaining <= value.length) return { container: child, offset: remaining };
            remaining -= value.length;
            continue;
          }
          var nested = descend(child); if (nested) return nested;
        }
        return null;
      }
      var point = descend(target);
      if (point) return point;
      if (lastText) return { container: lastText, offset: String(lastText.nodeValue != null ? lastText.nodeValue : (lastText.textContent || "")).length };
      return { container: target, offset: 0 };
    }
    function focusLineAtOffset(id, offset) {
      var el = lineElement(id); if (!el || typeof el.focus !== "function") return false;
      try {
        var selection = typeof environment.getSelection === "function" ? environment.getSelection() : (typeof window.getSelection === "function" ? window.getSelection() : (typeof document.getSelection === "function" ? document.getSelection() : null));
        var range = typeof document.createRange === "function" ? document.createRange() : null;
        if (!selection || !range || typeof range.setStart !== "function" || typeof range.collapse !== "function" || typeof selection.removeAllRanges !== "function" || typeof selection.addRange !== "function") return false;
        var point = textPointAtOffset(el, offset); if (!point || !point.container) return false;
        range.setStart(point.container, point.offset); range.collapse(true);
        el.focus({ preventScroll: true }); selection.removeAllRanges(); selection.addRange(range); return true;
      } catch (_error) { return false; }
    }
    function schedulePlainVerticalCaretBridge(sourceId, sourceElement, direction, offset, rowY) {
      requestAnimationFrame(function () {
        if (!sourceElement || document.activeElement !== sourceElement || lineElement(sourceId) !== sourceElement) return;
        var current = collapsedCaretState(sourceElement); if (!current) return;
        var hasVisualRows = typeof rowY === "number" && Number.isFinite(rowY) && typeof current.rowY === "number" && Number.isFinite(current.rowY);
        if (hasVisualRows) {
          if (Math.abs(current.rowY - rowY) > 2) return;
        } else if (current.offset !== offset) return;
        var sourceIndex = lineIndex(sourceId); if (sourceIndex < 0) return;
        var visible = typeof content.visibleIndexes === "function" ? content.visibleIndexes(lines, collapsed) : [];
        var position = visible.indexOf(sourceIndex); if (position < 0) return;
        var destinationPosition = position + direction; if (destinationPosition < 0 || destinationPosition >= visible.length) return;
        var destinationIndex = visible[destinationPosition]; var destination = lines[destinationIndex]; if (!destination) return;
        if (focusLineAtOffset(destination.id, offset)) selectedId = destination.id;
      });
    }
    function ingestPlainTextPaste(index, target, rawText) {
      var parts = selectionParts(target); if (!parts) return false;
      var pasted = content.parseLines(rawText); if (!Array.isArray(pasted) || pasted.length === 0) return false;
      if (pasted.length === 1) {
        lines[index].content = parts.prefix + content.serialiseLines(pasted) + parts.suffix;
        target.textContent = lines[index].content; markMutation(); return true;
      }
      var replacedId = lines[index].id;
      var replacedRow = rowForId(replacedId); if (!replacedRow) return false;
      var beforeRow = replacedRow.nextSibling || null;
      var anchorDepth = lines[index].depth, baselineDepth = pasted[0].depth, inserted = [];
      for (var cursor = 0; cursor < pasted.length; cursor += 1) inserted.push(createLine(pasted[cursor].content, anchorDepth + pasted[cursor].depth - baselineDepth));
      inserted[0].content = parts.prefix + inserted[0].content;
      inserted[inserted.length - 1].content += parts.suffix;
      lines.splice(index, 1, ...inserted); markMutation();
      for (var created = 0; created < inserted.length; created += 1) {
        var row = createVisibleRow(index + created); if (!row || !insertRowBefore(row, beforeRow)) return false;
      }
      detachVisibleRow(replacedId);
      refreshRowsAt([index - 1, index, index + inserted.length - 1, index + inserted.length]);
      focusLine(inserted[inserted.length - 1].id);
      return true;
    }
    function toggleBranch(index) {
      if (!hasChildren(index)) return false;
      var id = lines[index].id, branchRow = rowForId(id); if (!branchRow) return false;
      if (collapsed.has(id)) {
        collapsed.delete(id);
        var beforeRow = branchRow.nextSibling || null;
        var visible = visibleDescendantIndexes(index);
        for (var cursor = 0; cursor < visible.length; cursor += 1) {
          var descendant = lines[visible[cursor]];
          if (rowForId(descendant.id)) continue;
          var row = createVisibleRow(visible[cursor]); if (!row || !insertRowBefore(row, beforeRow)) return false;
        }
      } else {
        collapsed.add(id);
        var end = subtreeEnd(index);
        for (var hidden = index + 1; hidden < end; hidden += 1) if (rowRegistry.has(lines[hidden].id)) detachVisibleRow(lines[hidden].id);
      }
      refreshRowAt(index, false); focusLine(id); return true;
    }
    function indentBranch(index, delta) {
      if (readOnly || index < 0 || typeof content.indentSubtree !== "function") return false;
      var end = subtreeEnd(index), id = lines[index].id;
      var transformed = content.indentSubtree(lines, index, delta); if (!transformed || transformed.ok !== true) return false;
      lines = transformed.lines; markMutation();
      for (var cursor = index; cursor < end; cursor += 1) refreshRowAt(cursor, false);
      refreshRowsAt([index - 1, end]);
      focusLine(id); return true;
    }
    function moveBranch(index, direction) {
      if (readOnly || index < 0 || typeof content.moveSubtree !== "function") return false;
      var id = lines[index].id, end = subtreeEnd(index);
      var affectedIds = lines.slice(index, end).map(function (line) { return line.id; });
      var movingRows = affectedIds.map(rowForId).filter(Boolean);
      var oldBoundaryIds = [lines[index - 1]?.id || "", lines[end]?.id || ""];
      var transformed = content.moveSubtree(lines, index, direction); if (!transformed || transformed.ok !== true) return false;
      lines = transformed.lines; markMutation();
      var newStart = lineIndex(id), newEnd = subtreeEnd(newStart);
      var beforeRow = newEnd < lines.length ? rowForId(lines[newEnd].id) : null;
      moveRowsBefore(movingRows, beforeRow);
      for (var cursor = newStart; cursor < newEnd; cursor += 1) refreshRowAt(cursor, false);
      refreshRowsAt([newStart - 1, newEnd]);
      refreshRowsByIds(oldBoundaryIds);
      focusLine(id); return true;
    }
    function removeEmptyLine(index) {
      if (readOnly || index < 0 || lines.length <= 1 || typeof content.removeEmptyLine !== "function") return false;
      var removedId = lines[index].id, removedEnd = subtreeEnd(index);
      var promotedCount = Math.max(0, removedEnd - index - 1);
      var oldBoundaryIds = [lines[index - 1]?.id || "", lines[removedEnd]?.id || ""];
      var transformed = content.removeEmptyLine(lines, index); if (!transformed || transformed.ok !== true) return false;
      lines = transformed.lines; collapsed.delete(removedId); detachVisibleRow(removedId);
      var visible = typeof content.visibleIndexes === "function" ? content.visibleIndexes(lines, collapsed) : [];
      var preferredIndex = -1, caretAtEnd = false;
      for (var cursor = visible.length - 1; cursor >= 0; cursor -= 1) if (visible[cursor] < index) { preferredIndex = visible[cursor]; caretAtEnd = true; break; }
      if (preferredIndex < 0) for (var next = 0; next < visible.length; next += 1) if (visible[next] >= index) { preferredIndex = visible[next]; break; }
      if (preferredIndex < 0 && visible.length > 0) preferredIndex = visible[0];
      selectedId = preferredIndex >= 0 && lines[preferredIndex] ? lines[preferredIndex].id : "";
      markMutation();
      for (var promoted = 0; promoted < promotedCount; promoted += 1) refreshRowAt(index + promoted, false);
      refreshRowsAt([index - 1, index + promotedCount]);
      refreshRowsByIds(oldBoundaryIds);
      focusLine(selectedId, caretAtEnd); return true;
    }
    function moveBranchBefore(sourceId, targetId) {
      var source = lineIndex(sourceId), target = lineIndex(targetId); if (readOnly || source < 0 || target < 0 || source === target) return false;
      var end = subtreeEnd(source); if (target > source && target < end) return false;
      var branchIds = lines.slice(source, end).map(function (line) { return line.id; });
      var movingRows = branchIds.map(rowForId).filter(Boolean);
      var targetRow = rowForId(targetId); if (!targetRow) return false;
      var oldBoundaryIds = [lines[source - 1]?.id || "", lines[end]?.id || ""];
      var branch = lines.splice(source, end - source); if (target > source) target -= branch.length;
      var delta = lines[target] ? lines[target].depth - branch[0].depth : 0;
      for (var i = 0; i < branch.length; i += 1) branch[i].depth = Math.max(0, Math.min(8, branch[i].depth + delta));
      lines.splice(target, 0, ...branch); markMutation();
      moveRowsBefore(movingRows, targetRow);
      for (var cursor = target; cursor < target + branch.length; cursor += 1) refreshRowAt(cursor, false);
      refreshRowsAt([target - 1, target + branch.length]);
      refreshRowsByIds(oldBoundaryIds.concat([targetId]));
      focusLine(branch[0].id); return true;
    }
    function insertAfter(index) {
      var id = lines[index].id, currentRow = rowForId(id); if (!currentRow) return "";
      var marker = content.smartContinuation(lines[index].content);
      if (marker.exitList) {
        lines[index].content = ""; markMutation(); refreshRowAt(index, true); focusLine(id); return id;
      }
      var next = createLine(marker.content, lines[index].depth);
      lines.splice(index + 1, 0, next); markMutation();
      var row = createVisibleRow(index + 1); if (!row || !insertRowAfter(row, currentRow)) return "";
      refreshRowsAt([index, index + 1, index + 2]);
      focusLine(next.id); return next.id;
    }
    function applyReadOnlyState() { if (!readOnly) return; titleInput.readOnly = true; saveBtn.disabled = true; saveCloseBtn.disabled = true; setDirty(false); }
    function buildPayload() { return { id: payload.id, title: titleInput.value, text: buildText(), body: buildText(), updatedAt: new Date().toISOString(), fileSessionId: payload.fileSessionId, sourceFileName: payload.sourceFileName, sourcePipSession: payload.sourcePipSession, sourceOwnerKind: payload.sourceOwnerKind, sourceVaultSessionId: payload.sourceVaultSessionId, originalUpdatedAt: payload.originalUpdatedAt }; }
    function hasCompleteSaveContext() { return ownerToken.length > 0 && popupToken.length > 0 && Number.isSafeInteger(payload.fileSessionId) && payload.fileSessionId >= 0 && typeof payload.sourceFileName === "string" && payload.sourceFileName.length <= 120 && typeof payload.sourcePipSession === "boolean" && ["json","vault","synced","detached"].includes(payload.sourceOwnerKind) && typeof payload.sourceVaultSessionId === "string" && payload.sourceVaultSessionId.length <= 120 && (payload.sourceOwnerKind !== "vault" || payload.sourceVaultSessionId.length > 0) && typeof payload.originalUpdatedAt === "string" && payload.originalUpdatedAt.length > 0 && payload.originalUpdatedAt.length <= 40; }
    function openerPopoutWindow() { try { return window.opener && !window.opener.closed && window.opener.PocketNodePopoutWindow ? window.opener.PocketNodePopoutWindow : null; } catch (_error) { return null; } }
    function completeOwnedClose() { var target = openerPopoutWindow(); try { return !!(target && typeof target.completeCloseFromOwnedPopup === "function" && target.completeCloseFromOwnedPopup(ownerToken, popupToken, window)); } catch (_error) { return false; } }
    function cancelPendingOpen() { var target = openerPopoutWindow(); try { target?.cancelPendingOpen?.(ownerToken, popupToken, window); } catch (_error) {} }
    function hideUnsavedDialog() { unsavedDialog.hidden = true; }
    function focusEditor() { if (returnFocus && typeof returnFocus.focus === "function") returnFocus.focus({ preventScroll: true }); else focusLine(selectedId); returnFocus = null; }
    function keepEditing() { cancelPendingOpen(); hideUnsavedDialog(); focusEditor(); }
    function showUnsavedDialog() { if (readOnly) return false; returnFocus = document.activeElement; unsavedDialog.hidden = false; unsavedSaveBtn.focus({ preventScroll: true }); return true; }
    function matchesSession(a, b) { return a === ownerToken && b === popupToken; }
    window.PocketNodePopoutSession = Object.freeze({ getIdentity: function () { return { ownerToken, popupToken }; }, matches: matchesSession, hasUnsavedChanges: function () { return !readOnly && dirty; }, requestUnsavedProtection: function (a,b) { return matchesSession(a,b) && dirty && showUnsavedDialog(); }, requestOwnedClose: function (a,b) { if (!matchesSession(a,b) || (!readOnly && dirty)) return false; allowedToClose = true; window.close(); return true; } });
    function discardAndClose() { allowedToClose = true; dirty = false; if (completeOwnedClose()) return; window.close(); }
    function adoptAcceptedResult(result) { if (!result || result.applied !== true) return; if (typeof result.nodeUpdatedAt === "string" && result.nodeUpdatedAt) { payload.originalUpdatedAt = result.nodeUpdatedAt; payload.updatedAt = result.nodeUpdatedAt; } var identity = result.sourceIdentity; if (!result.ok || !result.exported || !identity || !Number.isSafeInteger(identity.fileSessionId)) return; payload.fileSessionId = identity.fileSessionId; payload.sourceFileName = typeof identity.sourceFileName === "string" ? identity.sourceFileName : ""; payload.sourcePipSession = identity.sourcePipSession === true; if (typeof identity.sourceOwnerKind === "string") payload.sourceOwnerKind = identity.sourceOwnerKind; if (typeof identity.sourceVaultSessionId === "string") payload.sourceVaultSessionId = identity.sourceVaultSessionId; }
    function failureDetails(result) { var reason = result && result.reason || "save-failed"; if (reason === "file-session-changed") return ["Different Pocket file — not saved","Pocket is now using a different file. Your editor changes were not applied."]; if (reason === "node-revision-changed") return ["Item changed elsewhere — not saved","This item changed after the editor was opened. Your changes were not applied."]; if (reason === "popup-session-changed") return ["Earlier Pocket window — not saved","This editor no longer belongs to the current Pocket window."]; if (reason === "external-file-changed") return ["Pocket changed elsewhere — not saved","This Pocket changed elsewhere. Your changes are still here."]; return [result && result.status || "Save not completed", result && result.message || "Pocket did not complete the truth-file save. Your editor changes are still here."]; }
    function finishSuccessfulSave(closeAfter, label) { setDirty(false); setSaveState(label || "saved", "saved"); if (closeAfter) { allowedToClose = true; if (completeOwnedClose()) return true; window.setTimeout(function () { window.close(); }, 80); } else cancelPendingOpen(); return true; }
    function handleSaveResult(result, closeAfter, generation) { result = result || {}; adoptAcceptedResult(result); if (result.ok && result.exported) { if (editGeneration !== generation) { setDirty(true); setSaveState("earlier changes saved — newer edits remain", "saved"); return false; } return finishSuccessfulSave(closeAfter,"saved"); } if (result.ok && result.reason === "unchanged") { if (editGeneration !== generation) { setDirty(true); return false; } return finishSuccessfulSave(closeAfter,"no changes"); } var failure = failureDetails(result); setDirty(true); setSaveState(failure[0],"failed"); alert(failure[1]); return false; }
    function save(closeAfter) { if (readOnly || saveInFlight) return false; hideUnsavedDialog(); if (!hasCompleteSaveContext()) { handleSaveResult({ok:false,reason:"missing-source-identity"},closeAfter,editGeneration); return false; } setSaveState("saving…",""); saveInFlight = true; var generation = editGeneration; var outgoing = buildPayload(); try { var target = openerPopoutWindow(); if (target && typeof target.applyAndSaveFromOwnedPopup === "function") { Promise.resolve(target.applyAndSaveFromOwnedPopup(ownerToken,popupToken,outgoing,window)).then(function (result) { saveInFlight=false; handleSaveResult(result,closeAfter,generation); }, function (error) { saveInFlight=false; console.error(error); setDirty(true); setSaveState("Truth-file write failed — not saved","failed"); }); return true; } } catch (error) { console.error(error); } saveInFlight=false; handleSaveResult({ok:false,reason:"popup-session-changed"},closeAfter,generation); return false; }
    function closeSafely() { if (readOnly || !dirty) { allowedToClose=true; window.close(); return; } showUnsavedDialog(); }

    seedPresentationIndex();

    if (typeof environment.probe === "function") { environment.probe(Object.freeze({ parse: content.parseLines, serialise: content.serialiseLines, smartContinuation: content.smartContinuation, hasChildren: content.hasChildren, subtreeEnd: content.subtreeEnd, buildText: buildText, indentBranch: indentBranch, moveBranch: moveBranch, toggleBranch: toggleBranch, removeEmptyLine: removeEmptyLine, moveBranchBefore: moveBranchBefore, insertAfter: insertAfter, ingestPlainTextPaste: ingestPlainTextPaste, rebuildProjectionForRecovery: rebuildProjectionForRecovery, lines: function(){ return JSON.parse(JSON.stringify(lines)); }, collapsed: function(){ return Array.from(collapsed); } })); return true; }

    titleInput.addEventListener("input", function () { markMutation(); });
    pane.addEventListener("input", function (ev) { var target = ev.target?.closest?.(".lineText[data-line-id]") || ev.target; var index = syncLineElement(target); if (index >= 0) { selectedId = lines[index].id; markMutation(); } });
    pane.addEventListener("paste", function (ev) { var text=ev.target?.closest?.(".lineText[data-line-id]"); if (!text || readOnly) return; ev.preventDefault(); var id=text.getAttribute("data-line-id")||"", index=lineIndex(id); if(index<0 || lineElement(id)!==text) return; var clipboard=ev.clipboardData, plainText=clipboard&&typeof clipboard.getData==="function"?clipboard.getData("text/plain"):null; if(typeof plainText!=="string") return; if(ingestPlainTextPaste(index,text,plainText)) selectedId=lines[Math.min(index,lines.length-1)].id; });
    pane.addEventListener("click", function (ev) { var gutter = ev.target?.closest?.(".lineGutter[data-line-id]"); if (gutter) { var gi=lineIndex(gutter.getAttribute("data-line-id")||""); if (gi>=0 && hasChildren(gi)) { ev.preventDefault(); toggleBranch(gi); } return; } var text=ev.target?.closest?.(".lineText[data-line-id]"); if (text) selectedId=text.getAttribute("data-line-id")||selectedId; });
    pane.addEventListener("keydown", function (ev) {
      var text=ev.target?.closest?.(".lineText[data-line-id]"); if (!text || readOnly) return;
      var index=syncLineElement(text); if(index<0)return; selectedId=lines[index].id;
      if(ev.key==="Backspace"&&!ev.altKey&&!ev.metaKey&&!ev.ctrlKey&&lines[index].content===""&&lines.length>1&&lineElement(lines[index].id)===text){if(removeEmptyLine(index))ev.preventDefault();return;}
      if(ev.key==="Enter"&&!ev.altKey&&!ev.metaKey&&!ev.ctrlKey){ev.preventDefault();insertAfter(index);return;}
      if(ev.key==="Tab"){ev.preventDefault();indentBranch(index,ev.shiftKey?-1:1);return;}
      if((ev.metaKey||ev.ctrlKey)&&!ev.shiftKey&&!ev.altKey&&(ev.key==="ArrowUp"||ev.key==="ArrowDown")){ev.preventDefault();moveBranch(index,ev.key==="ArrowUp"?"up":"down");return;}
      if(!ev.altKey&&!ev.metaKey&&!ev.ctrlKey&&!ev.shiftKey&&!ev.isComposing&&ev.keyCode!==229&&(ev.key==="ArrowUp"||ev.key==="ArrowDown")){
        if(document.activeElement!==text)return;
        var caretState=collapsedCaretState(text); if(!caretState)return;
        schedulePlainVerticalCaretBridge(lines[index].id,text,ev.key==="ArrowUp"?-1:1,caretState.offset,caretState.rowY); return;
      }
    });
    pane.addEventListener("dragstart", function(ev){var gutter=ev.target?.closest?.(".lineGutter[data-line-id]"); if(!gutter||readOnly)return; dragSourceId=gutter.getAttribute("data-line-id")||""; try{ev.dataTransfer?.setData?.("text/plain",dragSourceId);}catch(_error){} });
    pane.addEventListener("dragover", function(ev){if(dragSourceId)ev.preventDefault();});
    pane.addEventListener("drop", function(ev){if(!dragSourceId)return;var row=ev.target?.closest?.(".docRow[data-line-id]");var target=row?.getAttribute?.("data-line-id")||"";ev.preventDefault();if(target)moveBranchBefore(dragSourceId,target);dragSourceId="";});
    saveBtn.addEventListener("click",function(){save(false);}); saveCloseBtn.addEventListener("click",function(){save(true);}); document.getElementById("closeBtn")?.addEventListener("click",closeSafely); unsavedSaveBtn.addEventListener("click",function(){save(true);}); unsavedDiscardBtn.addEventListener("click",discardAndClose); unsavedCancelBtn.addEventListener("click",keepEditing);
    document.addEventListener("keydown",function(ev){if((ev.metaKey||ev.ctrlKey)&&(ev.key==="s"||ev.key==="S")){ev.preventDefault();save(false);return;} if(ev.key==="Escape"){ev.preventDefault();if(!unsavedDialog.hidden){keepEditing();return;}closeSafely();}});
    if(typeof window.addEventListener==="function")window.addEventListener("beforeunload",function(ev){if(readOnly||!dirty||allowedToClose)return;ev.preventDefault();ev.returnValue="";});
    applyReadOnlyState();
    return true;
  }
  function initialPayloadFromDocument() { if (!global.document || typeof global.document.getElementById !== "function") return null; var carrier=global.document.getElementById("pocketNodePopoutPayload"); if(!carrier||carrier.tagName!=="TEXTAREA")return null; try{var value=JSON.parse(carrier.value);return value&&typeof value==="object"&&!Array.isArray(value)?value:null;}catch(_error){return null;} }
  global.PocketNodePopoutRuntime=Object.freeze({initialise}); var initialPayload=initialPayloadFromDocument(); if(initialPayload)initialise(initialPayload);
})(window);