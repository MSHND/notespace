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
        error: saved ? "" : "Could not save from popout. Use Save in the main pocket window.",
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
    types: [{ description: "Pocket file", accept: { "application/json": [".json"] } }],
  };
}

function pocketFileState() {
  if (!state.pocketFile || typeof state.pocketFile !== "object") {
    state.pocketFile = { writable: false, displayName: "", recentName: "", gateMode: "", pipSession: false };
  }
  return state.pocketFile;
}

function setPocketFileSession(handle, displayName, options = {}) {
  truthFileHandle = handle || null;
  const session = pocketFileState();
  session.writable = !!handle || options.pipSession === true;
  session.displayName = cleanText(displayName, 120);
  session.gateMode = "";
  session.pipSession = options.pipSession === true;
  return session;
}

function clearPocketFileSession(options = {}) {
  truthFileHandle = null;
  const session = pocketFileState();
  session.writable = false;
  session.displayName = "";
  session.gateMode = "";
  session.pipSession = false;
  if (options.keepRecent !== true) session.recentName = "";
}

function hasWritablePocketFile() {
  return !!truthFileHandle && pocketFileState().writable === true;
}

function canShowPocketTree() {
  const session = pocketFileState();
  return hasWritablePocketFile() || (isPipMode && session.pipSession === true);
}

function canModifyPocket() {
  return canShowPocketTree();
}

function showPocketFileGatePrompt() {
  pocketFileState().gateMode = "blocked";
  if (typeof renderTree === "function") renderTree();
  if (typeof setStatus === "function") {
    setStatus("Load your Pocket file to make changes.", "warn", { durationMs: 6200 });
  }
}

function requirePocketFileForChanges() {
  if (canModifyPocket()) return true;
  showPocketFileGatePrompt();
  return false;
}

function openRecentPocketFileDb() {
  if (!window.indexedDB) return Promise.resolve(null);
  return new Promise((resolve) => {
    const request = window.indexedDB.open(RECENT_POCKET_FILE_DB_NAME, 1);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (db && !db.objectStoreNames.contains(RECENT_POCKET_FILE_STORE)) {
        db.createObjectStore(RECENT_POCKET_FILE_STORE);
      }
    };
    request.onsuccess = () => resolve(request.result || null);
    request.onerror = () => resolve(null);
    request.onblocked = () => resolve(null);
  });
}

async function readRecentPocketFileRecord() {
  const db = await openRecentPocketFileDb();
  if (!db) return null;
  return new Promise((resolve) => {
    const tx = db.transaction(RECENT_POCKET_FILE_STORE, "readonly");
    const store = tx.objectStore(RECENT_POCKET_FILE_STORE);
    const request = store.get("current");
    request.onsuccess = () => resolve(request.result && typeof request.result === "object" ? request.result : null);
    request.onerror = () => resolve(null);
    tx.oncomplete = () => db.close();
    tx.onerror = () => {
      try { db.close(); } catch {}
      resolve(null);
    };
  });
}

async function storeRecentPocketFileHandle(handle, displayName = "") {
  if (!handle) return false;
  const db = await openRecentPocketFileDb();
  if (!db) return false;
  return new Promise((resolve) => {
    const tx = db.transaction(RECENT_POCKET_FILE_STORE, "readwrite");
    const store = tx.objectStore(RECENT_POCKET_FILE_STORE);
    store.put({
      handle,
      displayName: cleanText(displayName || handle.name, 120),
      updatedAt: nowIso(),
    }, "current");
    tx.oncomplete = () => {
      db.close();
      resolve(true);
    };
    tx.onerror = () => {
      try { db.close(); } catch {}
      resolve(false);
    };
  });
}

async function refreshRecentPocketFileHint() {
  const record = await readRecentPocketFileRecord();
  const name = cleanText(record?.displayName || record?.handle?.name, 120);
  pocketFileState().recentName = name;
  if (!canShowPocketTree() && typeof renderTree === "function") renderTree();
  return record || null;
}

async function initialisePocketFileGate() {
  clearPocketFileSession({ keepRecent: true });
  await refreshRecentPocketFileHint();
  if (typeof refreshMeta === "function") refreshMeta();
  if (typeof renderTree === "function") renderTree();
  return true;
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
    const canWrite = await ensureWritePermission(handle);
    if (!canWrite) {
      clearPocketFileSession({ keepRecent: true });
      setStatus("Pocket could not save changes in that file. Choose another Pocket file.", "warn", { durationMs: 7200 });
      if (typeof renderTree === "function") renderTree();
      return false;
    }
    const file = await handle.getFile();
    setPocketFileSession(handle, file.name || handle.name);
    const loaded = await loadFromFile(file);
    if (!loaded) {
      clearPocketFileSession({ keepRecent: true });
      if (typeof renderTree === "function") renderTree();
      return false;
    }
    await storeRecentPocketFileHandle(handle, file.name || handle.name);
    pocketFileState().recentName = cleanText(file.name || handle.name, 120);
    setStatus("Pocket file loaded. Changes will save in the right place.", "ok", { durationMs: 5200 });
    refreshMeta();
    return true;
  } catch (err) {
    console.warn("[pocket-lite] open file handle failed", err);
    clearPocketFileSession({ keepRecent: true });
    setStatus("Could not open that Pocket file.", "warn");
    if (typeof renderTree === "function") renderTree();
    return false;
  }
}

async function openPocketFile() {
  if (typeof window.showOpenFilePicker !== "function") {
    setStatus("Pocket file loading is not available in this browser.", "warn", { durationMs: 6200 });
    return false;
  }
  const recent = await readRecentPocketFileRecord();
  if (recent && recent.handle) {
    const loadedRecent = await loadFromFileHandle(recent.handle);
    if (loadedRecent) return true;
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
    setStatus("Could not open the Pocket file picker.", "warn", { durationMs: 6200 });
    return false;
  }
}

async function writePocketPayloadToHandle(payload, handle) {
  const data = `${JSON.stringify(payload, null, 2)}\n`;
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
}

async function writeTruthFile(payload) {
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

  try {
    if (truthFileHandle) {
      const existingAttempt = await writePocketPayloadToHandle(payload, truthFileHandle);
      if (existingAttempt.ok) {
        const name = cleanText(truthFileHandle.name || state.source?.fileName, 120);
        setPocketFileSession(truthFileHandle, name);
        void storeRecentPocketFileHandle(truthFileHandle, name);
        return { ...existingAttempt, target: "opened-file" };
      }
      if (existingAttempt.permissionDenied) return existingAttempt;
      clearPocketFileSession({ keepRecent: true });
    }

    const pickedHandle = await pickHandle();
    if (!pickedHandle) return { ok: false, reason: "unsupported" };
    const pickedAttempt = await writePocketPayloadToHandle(payload, pickedHandle);
    if (pickedAttempt.ok) {
      const name = cleanText(pickedHandle.name || "pocket-data.json", 120);
      setPocketFileSession(pickedHandle, name);
      await storeRecentPocketFileHandle(pickedHandle, name);
      return { ...pickedAttempt, target: "picked-file" };
    }
    return pickedAttempt;
  } catch (err) {
    if (isFilePickerAbort(err)) {
      return { ok: false, aborted: true, error: err };
    }
    clearPocketFileSession({ keepRecent: true });
    return { ok: false, aborted: false, error: err };
  }
}

function buildEmptyPocketPayload(writtenAt = nowIso()) {
  return {
    schema: "portal.export.v1",
    exportedAt: writtenAt,
    writtenAt,
    mainThoughtTree: [],
    mainThoughtTreeTombstones: [],
    data: {
      mainThoughtTree: [],
      mainThoughtTreeTombstones: [],
    },
  };
}

function isPocketPayloadShape(parsed) {
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return false;
  if (Array.isArray(parsed.mainThoughtTree)) return true;
  if (parsed.data && typeof parsed.data === "object" && Array.isArray(parsed.data.mainThoughtTree)) return true;
  const schema = cleanText(parsed.schema, 80);
  return schema === "portal.export.v1" || schema === "portal.mtt.web.v1" || schema === "portal.sync.v1";
}

function payloadForNewPocketFile() {
  const recovery = typeof readLocalSafetySnapshot === "function" ? readLocalSafetySnapshot() : null;
  const recoveredPayload = recovery?.parsed?.payload;
  if (recoveredPayload && typeof recoveredPayload === "object") {
    return safeJsonClone(recoveredPayload, 5000000) || recoveredPayload;
  }
  return buildEmptyPocketPayload(nowIso());
}

async function createNewPocketFile() {
  if (typeof window.showSaveFilePicker !== "function") {
    setStatus("Pocket file creation is not available in this browser.", "warn", { durationMs: 6200 });
    return false;
  }
  try {
    const handle = await window.showSaveFilePicker({
      ...jsonFilePickerOptions(),
      suggestedName: "pocket-data.json",
    });
    if (!handle) {
      setStatus("Create cancelled.", "warn");
      return false;
    }
    const payload = payloadForNewPocketFile();
    const written = await writePocketPayloadToHandle(payload, handle);
    if (!written.ok) {
      setStatus("Pocket could not save changes in that file. Choose another Pocket file.", "warn", { durationMs: 7200 });
      return false;
    }
    const name = cleanText(handle.name || "pocket-data.json", 120);
    setPocketFileSession(handle, name);
    await storeRecentPocketFileHandle(handle, name);
    pocketFileState().recentName = name;
    const norm = normaliseInput(payload);
    applyLoadedState(norm, {
      schema: norm.schema,
      fileName: name,
      writtenAt: norm.writtenAt || payload.writtenAt || "",
    }, { skipLocalSafetyCheck: true });
    state.ops = [];
    clearLocalSafetySnapshot();
    clearConflictGuard();
    markSavedNow(payload);
    refreshMeta();
    renderTree();
    setStatus("Pocket file created. Changes will save in the right place.", "ok", { durationMs: 5200 });
    return true;
  } catch (err) {
    if (isFilePickerAbort(err)) {
      setStatus("Create cancelled.", "warn");
      return false;
    }
    console.warn("[pocket-lite] create pocket file failed", err);
    setStatus("Could not create that Pocket file.", "warn");
    return false;
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
    if (!canModifyPocket()) {
      showPocketFileGatePrompt();
      refocusTreeNavigation(state.selectedId);
      return exportTreeResult(options, false, "no-pocket-file");
    }
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
        setStatus("Saved to Pocket file.", "ok", { durationMs: 5200 });
      } else if (writeResult.target === "picked-file") {
        setStatus("Saved to Pocket file.", "ok", { durationMs: 5200 });
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
        : "Could not save from here. Use Save in the main pocket window.";
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
  if (!canModifyPocket()) {
    showPocketFileGatePrompt();
    return;
  }
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

async function loadFromFile(file, options = {}) {
  if (!file) return false;
  const opts = { allowImportFallback: false, ...options };
  if (!canShowPocketTree()) {
    setStatus("Use Load Pocket file so changes save in the right place.", "warn", { durationMs: 6200 });
    return false;
  }
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
    if (opts.allowImportFallback && latestChange && latestChange.norm && Array.isArray(latestChange.norm.nodes) && latestChange.norm.nodes.length > 0) {
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
    if (!opts.allowImportFallback) {
      setStatus("That does not look like a Pocket file.", "warn");
      return false;
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
    setStatus("That does not look like a Pocket file.", "warn");
    return false;
  }

  const norm = normaliseInput(parsed);
  if (!Array.isArray(norm.nodes) || norm.nodes.length === 0) {
    if (isPocketPayloadShape(parsed)) {
      snapshotCurrentTreeForRestore();
      applyLoadedState(norm, {
        schema: norm.schema || "",
        fileName: cleanText(file.name, 120),
        writtenAt: norm.writtenAt || "",
      }, { skipLocalSafetyCheck: true });
      saveAutoCache(norm, {
        schema: norm.schema || "",
        fileName: cleanText(file.name, 120),
        writtenAt: norm.writtenAt || "",
      });
      setStatus("Pocket file loaded.", "ok");
      return true;
    }
    if (!opts.allowImportFallback) {
      setStatus("That does not look like a Pocket file.", "warn");
      return false;
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
    setStatus("That does not look like a Pocket file.", "warn");
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
