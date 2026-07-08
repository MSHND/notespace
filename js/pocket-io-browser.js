/* Popout URL, browser save/download, stale export guard, status actions. */

function buildPipUrl() {
  const u = new URL(window.location.href);
  u.searchParams.set("pip", "1");
  return u.toString();
}

function openPopupFallback() {
  const nextUrl = buildPipUrl();
  const popup = window.open(
    nextUrl,
    "pocketLitePopout",
    "popup=yes,width=620,height=820,resizable=yes,scrollbars=yes"
  );
  if (popup) {
    popup.focus();
    setStatus("Opened pop-out window.", "ok");
  } else {
    setStatus("Popup blocked. Allow popups for this page.", "warn");
  }
}

async function openPipWindow() {
  if (isPipMode) {
    setStatus("Already in pop-out mode.", "warn");
    return;
  }
  persistPipSnapshot();
  const dpip = window.documentPictureInPicture;
  if (!dpip || typeof dpip.requestWindow !== "function") {
    openPopupFallback();
    return;
  }
  try {
    const pipWin = await dpip.requestWindow({
      width: Math.max(540, Math.round(window.innerWidth * 0.72)),
      height: Math.max(640, Math.round(window.innerHeight * 0.86)),
    });
    const pipUrl = buildPipUrl();
    const safePipUrl = pipUrl.replace(/\"/g, "&quot;");
    pipWin.document.open();
    pipWin.document.write(
      "<!doctype html><html><head><meta charset='utf-8'><title>pocket popout</title>" +
      "<style>html,body{margin:0;height:100%;background:#f7f8f7;overflow:hidden}body{display:grid;grid-template-rows:22px minmax(0,1fr)}.pipDragRail{height:22px;display:flex;align-items:center;padding:0 8px;border-bottom:1px solid rgba(148,163,184,.16);color:rgba(71,85,105,.72);font:600 12px -apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;letter-spacing:.08px;user-select:none;cursor:grab;background:rgba(249,250,248,.96)}.pipDragRail:active{cursor:grabbing}.pipFrameWrap{min-height:0}iframe{border:0;width:100%;height:100%;display:block}</style>" +
      "<script>" +
      "window.__pocketLitePipDirty=false;" +
      "window.__pocketLiteUnsavedCloseMessage=" + JSON.stringify(UNSAVED_CLOSE_MESSAGE) + ";" +
      "window.addEventListener('message',function(ev){var data=ev&&ev.data;if(!data||data.type!=='pocketLite:dirtyState')return;window.__pocketLitePipDirty=!!data.dirty;});" +
      "function __pocketLiteHasDirtyIframe(){if(window.__pocketLitePipDirty)return true;try{var frame=document.getElementById('pocketLitePipFrame');var fn=frame&&frame.contentWindow&&frame.contentWindow.__pocketLiteHasUnsavedChanges;return typeof fn==='function'&&!!fn();}catch(err){return false;}}" +
      "function __pocketLiteBeforeUnload(ev){if(!__pocketLiteHasDirtyIframe())return;ev.preventDefault();ev.returnValue=window.__pocketLiteUnsavedCloseMessage;return window.__pocketLiteUnsavedCloseMessage;}" +
      "window.addEventListener('beforeunload',__pocketLiteBeforeUnload);" +
      "window.onbeforeunload=__pocketLiteBeforeUnload;" +
      "</" + "script>" +
      "</head><body><div class='pipDragRail' title='Drag this strip to move the popout'>pocket</div><div class='pipFrameWrap'><iframe id=\"pocketLitePipFrame\" src=\"" + safePipUrl + "\"></iframe></div></body></html>"
    );
    pipWin.document.close();
    pipWin.__pocketLiteSaveFromPip = async (snapshot) => {
      if (!adoptPocketLiteSessionState(snapshot)) {
        return { ok: false, error: "Could not receive PiP changes." };
      }
      const saved = await exportTree({ downloadFallback: false });
      return {
        ok: !!saved,
        error: saved ? "" : "Could not write the truth file from PiP. Use Save in the main pocket window.",
      };
    };
    pipWin.addEventListener("pagehide", (event) => {
      try {
        const doc = event && event.target ? event.target : pipWin.document;
        const frame = doc && typeof doc.getElementById === "function"
          ? doc.getElementById("pocketLitePipFrame")
          : null;
        const exportSession = frame && frame.contentWindow && frame.contentWindow.__pocketLiteExportSessionState;
        const snapshot = typeof exportSession === "function"
          ? exportSession({ commitDetails: true })
          : null;
        if (snapshot && snapshot.dirty) adoptPocketLiteSessionState(snapshot);
      } catch {}
    });
    setStatus("Opened popout window.", "ok");
  } catch (err) {
    setStatus(`PiP unavailable: ${err && err.message ? err.message : "not supported"}`, "warn");
    openPopupFallback();
  }
}

function isFilePickerAbort(err) {
  return !!err && (
    err.name === "AbortError"
    || /abort/i.test(String(err.message || ""))
  );
}

function jsonFilePickerOptions() {
  return {
    types: [{ description: "Pocket JSON", accept: { "application/json": [".json"] } }],
  };
}

async function ensureWritePermission(handle) {
  if (!handle) return false;
  const opts = { mode: "readwrite" };
  try {
    if (typeof handle.queryPermission === "function") {
      const current = await handle.queryPermission(opts);
      if (current === "granted") return true;
    }
    if (typeof handle.requestPermission === "function") {
      const next = await handle.requestPermission(opts);
      return next === "granted";
    }
    return true;
  } catch (err) {
    console.warn("[pocket-lite] write permission check failed", err);
    return false;
  }
}

async function loadFromFileHandle(handle) {
  if (!handle || typeof handle.getFile !== "function") return false;
  try {
    const file = await handle.getFile();
    const loaded = await loadFromFile(file);
    if (!loaded) return false;
    truthFileHandle = handle;
    const canWrite = await ensureWritePermission(handle);
    if (canWrite) setStatus("pocket opened with save access.", "ok", { durationMs: 5200 });
    else setStatus("pocket opened read-only. Save may ask again or download a copy.", "warn", { durationMs: 7200 });
    refreshMeta();
    return true;
  } catch (err) {
    console.warn("[pocket-lite] open file handle failed", err);
    setStatus(`Could not open file: ${err && err.message ? err.message : "open failed"}`, "warn");
    return false;
  }
}

async function openPocketFile() {
  if (typeof window.showOpenFilePicker !== "function") {
    if (el.fileInput instanceof HTMLInputElement) el.fileInput.click();
    else setStatus("Open is not available here.", "warn");
    return false;
  }
  try {
    const handles = await window.showOpenFilePicker({
      ...jsonFilePickerOptions(),
      multiple: false,
    });
    const handle = Array.isArray(handles) ? handles[0] : null;
    if (!handle) {
      setStatus("Open cancelled.", "warn");
      return false;
    }
    return await loadFromFileHandle(handle);
  } catch (err) {
    if (isFilePickerAbort(err)) {
      setStatus("Open cancelled.", "warn");
      return false;
    }
    console.warn("[pocket-lite] native file picker failed", err);
    setStatus("Could not use the native file picker. Try the browser upload fallback.", "warn", { durationMs: 6200 });
    if (el.fileInput instanceof HTMLInputElement) el.fileInput.click();
    return false;
  }
}

async function writeTruthFile(payload) {
  const data = `${JSON.stringify(payload, null, 2)}\n`;
  const resolveSavePicker = () => {
    const scopes = [window];
    try {
      if (window.parent && window.parent !== window) scopes.push(window.parent);
    } catch {}
    try {
      if (window.top && window.top !== window && window.top !== window.parent) scopes.push(window.top);
    } catch {}
    for (const scope of scopes) {
      try {
        if (scope && typeof scope.showSaveFilePicker === "function") {
          return scope.showSaveFilePicker.bind(scope);
        }
      } catch {}
    }
    return null;
  };
  const pickHandle = async () => {
    const picker = resolveSavePicker();
    if (!picker) return null;
    return picker({
      ...jsonFilePickerOptions(),
      suggestedName: "pocket-data.json",
    });
  };
  const writeWithHandle = async (handle) => {
    if (!handle || typeof handle.createWritable !== "function") {
      return { ok: false, reason: "unsupported" };
    }
    const permitted = await ensureWritePermission(handle);
    if (!permitted) return { ok: false, reason: "permission-denied", permissionDenied: true };
    const writable = await handle.createWritable();
    try {
      await writable.write(data);
      await writable.close();
      return { ok: true };
    } catch (err) {
      try { await writable.abort?.(); } catch {}
      throw err;
    }
  };

  try {
    if (truthFileHandle) {
      const existingAttempt = await writeWithHandle(truthFileHandle);
      if (existingAttempt.ok) return { ...existingAttempt, target: "opened-file" };
      if (existingAttempt.permissionDenied) return existingAttempt;
      truthFileHandle = null;
    }

    const pickedHandle = await pickHandle();
    if (!pickedHandle) return { ok: false, reason: "unsupported" };
    const pickedAttempt = await writeWithHandle(pickedHandle);
    if (pickedAttempt.ok) {
      truthFileHandle = pickedHandle;
      return { ...pickedAttempt, target: "picked-file" };
    }
    return pickedAttempt;
  } catch (err) {
    if (isFilePickerAbort(err)) {
      return { ok: false, aborted: true, error: err };
    }
    truthFileHandle = null;
    return { ok: false, aborted: false, error: err };
  }
}

function enqueueTreeSave(task) {
  const run = async () => {
    state.saveInProgress = true;
    refreshMeta();
    try {
      return await task();
    } finally {
      state.saveInProgress = false;
      refreshMeta();
    }
  };
  const queued = exportTreeQueue.then(run, run);
  exportTreeQueue = queued.catch(() => {});
  return queued;
}

function downloadPocketBackupCopy(payload = buildPocketPayload(nowIso()), reason = "copy") {
  const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
  const blob = new Blob([`${JSON.stringify(payload, null, 2)}\n`], { type: "application/json" });
  const href = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = href;
  a.download = `pocket-data-${stamp}.json`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(href);
  markSavedNow(payload);
  if (reason !== "silent") {
    setStatus(`${backupProofLabel()} saved as a separate copy.`, "ok", { durationMs: 6200 });
  }
  return true;
}

function shouldPauseForStaleExportGuard(options = {}) {
  if (options.ignoreStaleGuard) return false;
  const guard = state.conflictGuard || {};
  if (!guard.active) return false;
  if (Date.now() <= pendingStaleExportConfirmExpiresAt) return false;
  pendingStaleExportConfirmExpiresAt = Date.now() + 15000;
  const payload = buildPocketPayload(nowIso());
  setStatus("This file looks older than another local/saved copy. Save again to overwrite, or download a separate copy.", "warn", {
    durationMs: 15000,
    action: {
      label: "Download copy",
      onClick: () => downloadPocketBackupCopy(payload),
    },
  });
  flashSaveChip("Check first");
  refocusTreeNavigation(state.selectedId);
  return true;
}

function exportTreeResult(options, ok, reason, extra = {}, legacyOk = ok) {
  const result = { ok: !!ok, reason: cleanText(reason, 80), ...extra };
  return options.returnDetails === true ? result : !!legacyOk;
}

async function exportTree(options = {}) {
  return enqueueTreeSave(async () => {
    if (state.nodes.length === 0) return exportTreeResult(options, false, "empty");
    if (shouldPauseForStaleExportGuard(options)) return exportTreeResult(options, false, "stale-guard");
    const opsAtSaveStart = Array.isArray(state.ops) ? state.ops.length : 0;
    if (opsAtSaveStart === 0) {
      clearLocalSafetySnapshot();
      setStatus(backupProofLabel(readLastBackupMeta()) || "Already saved.", "ok", { durationMs: 4200 });
      flashSaveChip("Safe");
      refocusTreeNavigation(state.selectedId);
      return exportTreeResult(options, false, "no-changes");
    }
    // Freeze a point-in-time snapshot so edits during save are not mixed
    // into this payload and their ops are preserved as unsaved.
    const payload = buildPocketPayload(nowIso());
    saveLastSaveSnapshot(payload);
    const writeResult = await writeTruthFile(payload);
    if (writeResult.ok) {
      markSavedNow(payload);
      // Only clear ops that existed at save start.
      state.ops = Array.isArray(state.ops) ? state.ops.slice(opsAtSaveStart) : [];
      if (state.ops.length > 0) {
        setStatus(`${backupProofLabel()}. ${state.ops.length} newer change${state.ops.length === 1 ? "" : "s"} still local.`, "ok", { durationMs: 5600 });
      } else if (writeResult.target === "opened-file") {
        setStatus("Saved to opened JSON.", "ok", { durationMs: 5200 });
      } else if (writeResult.target === "picked-file") {
        setStatus("Saved to chosen JSON.", "ok", { durationMs: 5200 });
      } else {
        setStatus(backupProofLabel(), "ok", { durationMs: 5200 });
      }
      flashSaveChip("Safe");
      clearLocalSafetySnapshot();
      clearConflictGuard();
      persistPipSnapshot();
      refocusTreeNavigation(state.selectedId);
      return exportTreeResult(options, true, "truth-file", { target: writeResult.target || "truth-file" });
    }
    if (writeResult.aborted) {
      setStatus("Save cancelled.", "warn");
      refocusTreeNavigation(state.selectedId);
      return exportTreeResult(options, false, "cancelled");
    }
    if (options.downloadFallback === false) {
      const message = writeResult.permissionDenied
        ? "Save access denied. Use main Save to choose a writable file."
        : "Could not write the truth file here. Use Save in the main pocket window.";
      setStatus(message, "warn");
      refocusTreeNavigation(state.selectedId);
      return exportTreeResult(options, false, writeResult.reason || "write-failed");
    }
    downloadPocketBackupCopy(payload, "silent");
    clearConflictGuard();
    if (writeResult.permissionDenied) {
      setStatus("Save access denied. Downloaded a safe copy instead.", "warn", { durationMs: 7200 });
    } else {
      setStatus(`${backupProofLabel()} saved as a separate copy.`, "warn", { durationMs: 6200 });
    }
    refocusTreeNavigation(state.selectedId);
    return exportTreeResult(options, false, "downloaded-copy", { downloaded: true }, true);
  });
}

function saveCurrentContext() {
  if (isDetailsEditorOpen()) {
    saveDetailsEditor();
    return;
  }
  if (isPipMode && window.parent !== window) {
    void saveThroughPipHost();
    return;
  }
  if (isPipMode) {
    void exportTree({ downloadFallback: false });
    return;
  }
  void exportTree();
}

async function loadFromFile(file) {
  if (!file) return false;
  let text = "";
  try {
    text = await file.text();
  } catch (err) {
    setStatus(`Could not read file: ${err && err.message ? err.message : "read failed"}`, "warn");
    return false;
  }
  let parsed = null;
  try {
    parsed = JSON.parse(text);
  } catch (err) {
    const ndjsonEntries = parseNdjsonLines(text);
    const latestChange = pickLatestChangeSnapshot(ndjsonEntries);
    if (latestChange && latestChange.norm && Array.isArray(latestChange.norm.nodes) && latestChange.norm.nodes.length > 0) {
      snapshotCurrentTreeForRestore();
      applyLoadedState(latestChange.norm, {
        schema: latestChange.norm.schema || "pocket.change.v1",
        fileName: cleanText(file.name, 120),
        writtenAt: latestChange.writtenAt || latestChange.norm.writtenAt || "",
      });
      saveAutoCache(latestChange.norm, {
        schema: latestChange.norm.schema || "pocket.change.v1",
        fileName: cleanText(file.name, 120),
        writtenAt: latestChange.writtenAt || latestChange.norm.writtenAt || "",
      });
      setStatus(`pocket opened from change log.`, "ok");
      return true;
    }
    const queued = queuePathImport(text, {
      requireAnchor: true,
      sourceInfo: {
        schema: "path.lines",
        fileName: cleanText(file.name, 120),
        writtenAt: "",
      },
    });
    if (queued !== 0) return false;
    setStatus(`File is not valid JSON: ${err && err.message ? err.message : "parse failed"}`, "warn");
    return false;
  }

  const norm = normaliseInput(parsed);
  if (!Array.isArray(norm.nodes) || norm.nodes.length === 0) {
    const queued = queuePathImport(text, {
      requireAnchor: true,
      sourceInfo: {
        schema: "path.lines",
        fileName: cleanText(file.name, 120),
        writtenAt: "",
      },
    });
    if (queued !== 0) return false;
    setStatus("No usable mainThoughtTree nodes were found in that file.", "warn");
    return false;
  }
  snapshotCurrentTreeForRestore();
  applyLoadedState(norm, {
    schema: norm.schema || "",
    fileName: cleanText(file.name, 120),
    writtenAt: norm.writtenAt || "",
  });
  saveAutoCache(norm, {
    schema: norm.schema || "",
    fileName: cleanText(file.name, 120),
    writtenAt: norm.writtenAt || "",
  });
  setStatus(`pocket opened.`, "ok");
  return true;
}

function triggerStatusAction(event) {
  if (!statusActionHandler) return false;
  event.preventDefault();
  event.stopPropagation();
  const action = statusActionHandler;
  statusActionHandler = null;
  try {
    action();
  } catch (err) {
    console.error("[pocket-lite] status action failed:", err);
    setStatus("Could not complete action.", "warn");
  }
  return true;
}
