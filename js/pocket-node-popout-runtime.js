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
    function render(preferredId) {
      if (!Array.isArray(lines) || lines.length === 0) lines = [createLine("", 0)];
      pane.innerHTML = "";
      var visible = typeof content.visibleIndexes === "function" ? new Set(content.visibleIndexes(lines, collapsed)) : null;
      for (var i = 0; i < lines.length; i += 1) if (!visible || visible.has(i)) pane.appendChild(createRow(lines[i], i));
      if (preferredId) requestAnimationFrame(function () { focusLine(preferredId); });
    }
    function lineElement(id) {
      if (!pane || typeof pane.querySelectorAll !== "function") return null;
      var nodes = pane.querySelectorAll(".lineText[data-line-id]");
      for (var i = 0; i < nodes.length; i += 1) if (nodes[i].getAttribute("data-line-id") === id) return nodes[i];
      return null;
    }
    function focusLine(id) { var el = lineElement(id); if (el && typeof el.focus === "function") el.focus({ preventScroll: true }); }
    function syncLineElement(target) {
      if (!target || typeof target.getAttribute !== "function") return -1;
      var id = target.getAttribute("data-line-id") || ""; var index = lineIndex(id); if (index < 0) return -1;
      lines[index].content = target.textContent || ""; return index;
    }
    function toggleBranch(index) { if (!hasChildren(index)) return false; var id = lines[index].id; if (collapsed.has(id)) collapsed.delete(id); else collapsed.add(id); render(id); return true; }
    function indentBranch(index, delta) {
      if (readOnly || index < 0 || typeof content.indentSubtree !== "function") return false;
      var transformed = content.indentSubtree(lines, index, delta); if (!transformed || transformed.ok !== true) return false;
      var id = lines[index].id; lines = transformed.lines; markMutation(); render(id); return true;
    }
    function moveBranch(index, direction) {
      if (readOnly || index < 0 || typeof content.moveSubtree !== "function") return false;
      var id = lines[index].id; var transformed = content.moveSubtree(lines, index, direction); if (!transformed || transformed.ok !== true) return false;
      lines = transformed.lines; markMutation(); render(id); return true;
    }
    function moveBranchBefore(sourceId, targetId) {
      var source = lineIndex(sourceId), target = lineIndex(targetId); if (readOnly || source < 0 || target < 0 || source === target) return false;
      var end = subtreeEnd(source); if (target > source && target < end) return false; var branch = lines.splice(source, end - source); if (target > source) target -= branch.length;
      var delta = lines[target] ? lines[target].depth - branch[0].depth : 0; for (var i = 0; i < branch.length; i += 1) branch[i].depth = Math.max(0, Math.min(8, branch[i].depth + delta));
      lines.splice(target, 0, ...branch); markMutation(); render(branch[0].id); return true;
    }
    function insertAfter(index) {
      var marker = content.smartContinuation(lines[index].content);
      if (marker.exitList) { lines[index].content = ""; markMutation(); render(lines[index].id); return lines[index].id; }
      var next = createLine(marker.content, lines[index].depth); lines.splice(index + 1, 0, next); markMutation(); render(next.id); return next.id;
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
    function failureDetails(result) { var reason = result && result.reason || "save-failed"; if (reason === "file-session-changed") return ["Different Pocket file — not saved","Pocket is now using a different file. Your editor changes were not applied."]; if (reason === "node-revision-changed") return ["Item changed elsewhere — not saved","This item changed after the editor was opened. Your changes were not applied."]; if (reason === "popup-session-changed") return ["Earlier Pocket window — not saved","This editor no longer belongs to the current Pocket window."]; return [result && result.status || "Save not completed", result && result.message || "Pocket did not complete the truth-file save. Your editor changes are still here."]; }
    function finishSuccessfulSave(closeAfter, label) { setDirty(false); setSaveState(label || "saved", "saved"); if (closeAfter) { allowedToClose = true; if (completeOwnedClose()) return true; window.setTimeout(function () { window.close(); }, 80); } else cancelPendingOpen(); return true; }
    function handleSaveResult(result, closeAfter, generation) { result = result || {}; adoptAcceptedResult(result); if (result.ok && result.exported) { if (editGeneration !== generation) { setDirty(true); setSaveState("earlier changes saved — newer edits remain", "saved"); return false; } return finishSuccessfulSave(closeAfter,"saved"); } if (result.ok && result.reason === "unchanged") { if (editGeneration !== generation) { setDirty(true); return false; } return finishSuccessfulSave(closeAfter,"no changes"); } var failure = failureDetails(result); setDirty(true); setSaveState(failure[0],"failed"); alert(failure[1]); return false; }
    function save(closeAfter) { if (readOnly || saveInFlight) return false; hideUnsavedDialog(); if (!hasCompleteSaveContext()) { handleSaveResult({ok:false,reason:"missing-source-identity"},closeAfter,editGeneration); return false; } setSaveState("saving…",""); saveInFlight = true; var generation = editGeneration; var outgoing = buildPayload(); try { var target = openerPopoutWindow(); if (target && typeof target.applyAndSaveFromOwnedPopup === "function") { Promise.resolve(target.applyAndSaveFromOwnedPopup(ownerToken,popupToken,outgoing,window)).then(function (result) { saveInFlight=false; handleSaveResult(result,closeAfter,generation); }, function (error) { saveInFlight=false; console.error(error); setDirty(true); setSaveState("Truth-file write failed — not saved","failed"); }); return true; } } catch (error) { console.error(error); } saveInFlight=false; handleSaveResult({ok:false,reason:"popup-session-changed"},closeAfter,generation); return false; }
    function closeSafely() { if (readOnly || !dirty) { allowedToClose=true; window.close(); return; } showUnsavedDialog(); }

    if (typeof environment.probe === "function") { environment.probe(Object.freeze({ parse: content.parseLines, serialise: content.serialiseLines, smartContinuation: content.smartContinuation, hasChildren: content.hasChildren, subtreeEnd: content.subtreeEnd, buildText: buildText, indentBranch: indentBranch, moveBranch: moveBranch, toggleBranch: toggleBranch, lines: function(){ return JSON.parse(JSON.stringify(lines)); }, collapsed: function(){ return Array.from(collapsed); } })); return true; }

    titleInput.addEventListener("input", function () { markMutation(); });
    pane.addEventListener("input", function (ev) { var target = ev.target?.closest?.(".lineText[data-line-id]") || ev.target; var index = syncLineElement(target); if (index >= 0) { selectedId = lines[index].id; markMutation(); } });
    pane.addEventListener("click", function (ev) { var gutter = ev.target?.closest?.(".lineGutter[data-line-id]"); if (gutter) { var gi=lineIndex(gutter.getAttribute("data-line-id")||""); if (gi>=0 && hasChildren(gi)) { ev.preventDefault(); toggleBranch(gi); } return; } var text=ev.target?.closest?.(".lineText[data-line-id]"); if (text) selectedId=text.getAttribute("data-line-id")||selectedId; });
    pane.addEventListener("keydown", function (ev) { var text=ev.target?.closest?.(".lineText[data-line-id]"); if (!text || readOnly) return; var index=syncLineElement(text); if(index<0)return; selectedId=lines[index].id; if(ev.key==="Enter"&&!ev.altKey&&!ev.metaKey&&!ev.ctrlKey){ev.preventDefault();insertAfter(index);return;} if(ev.key==="Tab"){ev.preventDefault();indentBranch(index,ev.shiftKey?-1:1);return;} if((ev.metaKey||ev.ctrlKey)&&!ev.shiftKey&&!ev.altKey&&(ev.key==="ArrowUp"||ev.key==="ArrowDown")){ev.preventDefault();moveBranch(index,ev.key==="ArrowUp"?"up":"down");return;} });
    pane.addEventListener("dragstart", function(ev){var gutter=ev.target?.closest?.(".lineGutter[data-line-id]"); if(!gutter||readOnly)return; dragSourceId=gutter.getAttribute("data-line-id")||""; try{ev.dataTransfer?.setData?.("text/plain",dragSourceId);}catch(_error){} });
    pane.addEventListener("dragover", function(ev){if(dragSourceId)ev.preventDefault();});
    pane.addEventListener("drop", function(ev){if(!dragSourceId)return;var row=ev.target?.closest?.(".docRow[data-line-id]");var target=row?.getAttribute?.("data-line-id")||"";ev.preventDefault();if(target)moveBranchBefore(dragSourceId,target);dragSourceId="";});
    saveBtn.addEventListener("click",function(){save(false);}); saveCloseBtn.addEventListener("click",function(){save(true);}); document.getElementById("closeBtn")?.addEventListener("click",closeSafely); unsavedSaveBtn.addEventListener("click",function(){save(true);}); unsavedDiscardBtn.addEventListener("click",discardAndClose); unsavedCancelBtn.addEventListener("click",keepEditing);
    document.addEventListener("keydown",function(ev){if((ev.metaKey||ev.ctrlKey)&&(ev.key==="s"||ev.key==="S")){ev.preventDefault();save(false);return;} if(ev.key==="Escape"){ev.preventDefault();if(!unsavedDialog.hidden){keepEditing();return;}closeSafely();}});
    if(typeof window.addEventListener==="function")window.addEventListener("beforeunload",function(ev){if(readOnly||!dirty||allowedToClose)return;ev.preventDefault();ev.returnValue="";});
    applyReadOnlyState(); if(!readOnly){titleInput.focus?.(); titleInput.select?.();}
    return true;
  }
  function initialPayloadFromDocument() { if (!global.document || typeof global.document.getElementById !== "function") return null; var carrier=global.document.getElementById("pocketNodePopoutPayload"); if(!carrier||carrier.tagName!=="TEXTAREA")return null; try{var value=JSON.parse(carrier.value);return value&&typeof value==="object"&&!Array.isArray(value)?value:null;}catch(_error){return null;} }
  global.PocketNodePopoutRuntime=Object.freeze({initialise}); var initialPayload=initialPayloadFromDocument(); if(initialPayload)initialise(initialPayload);
})(window);
