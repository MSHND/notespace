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
    function paneRows() {
      try { return Array.prototype.slice.call(pane.children || []); } catch (_error) { return []; }
    }
    function rowElement(id) {
      var rows = paneRows();
      for (var i = 0; i < rows.length; i += 1) if (rows[i]?.getAttribute?.("data-line-id") === id) return rows[i];
      return null;
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
    function visibleIndexes() {
      if (typeof content.visibleIndexes === "function") return content.visibleIndexes(lines, collapsed);
      var result = []; for (var i = 0; i < lines.length; i += 1) if (!isHidden(i)) result.push(i); return result;
    }
    function updateRowPresentation(row, index, updateText) {
      var line = lines[index]; if (!row || !line) return false;
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
    function rowNeedsPresentationRefresh(row, index) {
      var line = lines[index]; if (!row || !line) return true;
      if (row.getAttribute?.("data-depth") !== String(Math.max(0, Math.min(8, Number(line.depth) || 0)))) return true;
      var parts = rowParts(row), branch = hasChildren(index), folded = collapsed.has(line.id);
      if (!parts.gutter) return false;
      if (parts.gutter.className !== "lineGutter" + (branch ? " branch" : " empty")) return true;
      if (parts.gutter.textContent !== (branch ? (folded ? "▸" : "▾") : "")) return true;
      return false;
    }
    function detachRow(row) {
      if (!row || row.parentNode !== pane) return;
      if (typeof pane.removeChild === "function") { pane.removeChild(row); return; }
      if (Array.isArray(pane.children)) { var ci = pane.children.indexOf(row); if (ci >= 0) pane.children.splice(ci, 1); }
      if (Array.isArray(pane.childNodes) && pane.childNodes !== pane.children) { var ni = pane.childNodes.indexOf(row); if (ni >= 0) pane.childNodes.splice(ni, 1); }
      row.parentNode = null;
    }
    function placeRowAt(row, position) {
      var current = paneRows(), currentIndex = current.indexOf(row);
      if (currentIndex === position) return;
      var before = current[position] || null;
      if (typeof pane.insertBefore === "function") { pane.insertBefore(row, before); return; }
      if (row.parentNode === pane) detachRow(row);
      current = paneRows();
      var at = Math.max(0, Math.min(position, current.length));
      if (Array.isArray(pane.children)) pane.children.splice(at, 0, row);
      if (Array.isArray(pane.childNodes) && pane.childNodes !== pane.children) pane.childNodes.splice(at, 0, row);
      row.parentNode = pane;
    }
    function rebuildProjectionForRecovery(preferredId, caretAtEnd) {
      if (!Array.isArray(lines) || lines.length === 0) lines = [createLine("", 0)];
      pane.innerHTML = "";
      var visible = visibleIndexes();
      for (var i = 0; i < visible.length; i += 1) pane.appendChild(createRow(lines[visible[i]], visible[i]));
      if (preferredId) focusLine(preferredId, caretAtEnd === true);
      return true;
    }
    function patchProjection(options) {
      options = options || {};
      if (!Array.isArray(lines) || lines.length === 0) return false;
      var affected = new Set(Array.isArray(options.affectedIds) ? options.affectedIds : []);
      var textIds = new Set(Array.isArray(options.textIds) ? options.textIds : []);
      var visible = visibleIndexes(), desiredIds = new Set();
      for (var i = 0; i < visible.length; i += 1) desiredIds.add(lines[visible[i]].id);
      var existingRows = paneRows();
      for (var r = 0; r < existingRows.length; r += 1) {
        var existingId = existingRows[r]?.getAttribute?.("data-line-id") || "";
        if (!desiredIds.has(existingId)) detachRow(existingRows[r]);
      }
      for (var position = 0; position < visible.length; position += 1) {
        var index = visible[position], line = lines[index], row = rowElement(line.id), created = false;
        if (!row) { row = createRow(line, index); created = true; }
        placeRowAt(row, position);
        if (created || affected.has(line.id) || rowNeedsPresentationRefresh(row, index)) {
          updateRowPresentation(row, index, created || textIds.has(line.id));
        }
      }
      if (options.focusId) focusLine(options.focusId, options.caretAtEnd === true);
      return true;
    }
    function lineElement(id) {
      if (!pane || typeof pane.querySelectorAll !== "function") return null;
      var nodes = pane.querySelectorAll(".lineText[data-line-id]");
      for (var i = 0; i < nodes.length; i += 1) if (nodes[i].getAttribute("data-line-id") === id) return nodes[i];
      return null;
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
      var anchorDepth = lines[index].depth, baselineDepth = pasted[0].depth, inserted = [];
      for (var cursor = 0; cursor < pasted.length; cursor += 1) inserted.push(createLine(pasted[cursor].content, anchorDepth + pasted[cursor].depth - baselineDepth));
      inserted[0].content = parts.prefix + inserted[0].content;
      inserted[inserted.length - 1].content += parts.suffix;
      lines.splice(index, 1, ...inserted); markMutation(); patchProjection({ affectedIds: inserted.map(function (line) { return line.id; }), textIds: inserted.map(function (line) { return line.id; }), focusId: inserted[inserted.length - 1].id }); return true;
    }
    function toggleBranch(index) { if (!hasChildren(index)) return false; var id = lines[index].id; if (collapsed.has(id)) collapsed.delete(id); else collapsed.add(id); patchProjection({ affectedIds: [id], focusId: id }); return true; }
    function indentBranch(index, delta) {
      if (readOnly || index < 0 || typeof content.indentSubtree !== "function") return false;
      var transformed = content.indentSubtree(lines, index, delta); if (!transformed || transformed.ok !== true) return false;
      var id = lines[index].id, end = subtreeEnd(index), affectedIds = lines.slice(index, end).map(function (line) { return line.id; }); lines = transformed.lines; markMutation(); patchProjection({ affectedIds: affectedIds, focusId: id }); return true;
    }
    function moveBranch(index, direction) {
      if (readOnly || index < 0 || typeof content.moveSubtree !== "function") return false;
      var id = lines[index].id, end = subtreeEnd(index), affectedIds = lines.slice(index, end).map(function (line) { return line.id; }); var transformed = content.moveSubtree(lines, index, direction); if (!transformed || transformed.ok !== true) return false;
      lines = transformed.lines; markMutation(); patchProjection({ affectedIds: affectedIds, focusId: id }); return true;
    }
    function removeEmptyLine(index) {
      if (readOnly || index < 0 || lines.length <= 1 || typeof content.removeEmptyLine !== "function") return false;
      var removedId = lines[index].id, removedEnd = subtreeEnd(index), affectedIds = lines.slice(index + 1, removedEnd).map(function (line) { return line.id; });
      var transformed = content.removeEmptyLine(lines, index); if (!transformed || transformed.ok !== true) return false;
      lines = transformed.lines; collapsed.delete(removedId);
      var visible = typeof content.visibleIndexes === "function" ? content.visibleIndexes(lines, collapsed) : [];
      var preferredIndex = -1, caretAtEnd = false;
      for (var cursor = visible.length - 1; cursor >= 0; cursor -= 1) if (visible[cursor] < index) { preferredIndex = visible[cursor]; caretAtEnd = true; break; }
      if (preferredIndex < 0) for (var next = 0; next < visible.length; next += 1) if (visible[next] >= index) { preferredIndex = visible[next]; break; }
      if (preferredIndex < 0 && visible.length > 0) preferredIndex = visible[0];
      selectedId = preferredIndex >= 0 && lines[preferredIndex] ? lines[preferredIndex].id : "";
      markMutation(); patchProjection({ affectedIds: affectedIds, focusId: selectedId, caretAtEnd: caretAtEnd }); return true;
    }
    function moveBranchBefore(sourceId, targetId) {
      var source = lineIndex(sourceId), target = lineIndex(targetId); if (readOnly || source < 0 || target < 0 || source === target) return false;
      var end = subtreeEnd(source); if (target > source && target < end) return false; var branch = lines.splice(source, end - source); if (target > source) target -= branch.length;
      var delta = lines[target] ? lines[target].depth - branch[0].depth : 0; for (var i = 0; i < branch.length; i += 1) branch[i].depth = Math.max(0, Math.min(8, branch[i].depth + delta));
      lines.splice(target, 0, ...branch); markMutation(); patchProjection({ affectedIds: branch.map(function (line) { return line.id; }), focusId: branch[0].id }); return true;
    }
    function insertAfter(index) {
      var marker = content.smartContinuation(lines[index].content);
      if (marker.exitList) { lines[index].content = ""; markMutation(); patchProjection({ affectedIds: [lines[index].id], textIds: [lines[index].id], focusId: lines[index].id }); return lines[index].id; }
      var next = createLine(marker.content, lines[index].depth); lines.splice(index + 1, 0, next); markMutation(); patchProjection({ affectedIds: [next.id], textIds: [next.id], focusId: next.id }); return next.id;
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

    if (typeof environment.probe === "function") { environment.probe(Object.freeze({ parse: content.parseLines, serialise: content.serialiseLines, smartContinuation: content.smartContinuation, hasChildren: content.hasChildren, subtreeEnd: content.subtreeEnd, buildText: buildText, indentBranch: indentBranch, moveBranch: moveBranch, toggleBranch: toggleBranch, removeEmptyLine: removeEmptyLine, moveBranchBefore: moveBranchBefore, insertAfter: insertAfter, ingestPlainTextPaste: ingestPlainTextPaste, patchProjection: patchProjection, rebuildProjectionForRecovery: rebuildProjectionForRecovery, lines: function(){ return JSON.parse(JSON.stringify(lines)); }, collapsed: function(){ return Array.from(collapsed); } })); return true; }

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