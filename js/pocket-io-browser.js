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
  if (isPocketFilePermissionPromptOpen()) {
    showPocketFilePermissionPendingStatus();
    return;
  }
  if (typeof window.isPocketDeviceChangesDecisionOpen === "function"
      && window.isPocketDeviceChangesDecisionOpen()) {
    setStatus("Choose how to handle the file and device changes first.", "warn", { durationMs: 5200 });
    return;
  }
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
      if (!adoptPocketDocumentFromPip(snapshot)) {
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
        if (snapshot && snapshot.dirty) adoptPocketDocumentFromPip(snapshot);
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
    state.pocketFile = {
      writable: false,
      displayName: "",
      recentName: "",
      pendingName: "",
      gateMode: "",
      pipSession: false,
      detachedDeviceChanges: false,
    };
  }
  if (typeof state.pocketFile.detachedDeviceChanges !== "boolean") {
    state.pocketFile.detachedDeviceChanges = false;
  }
  return state.pocketFile;
}

let pendingPocketFileHandle = null;
let pendingPocketFilePermissionToken = 0;
let pendingPocketFilePermissionSourceSession = null;
let pocketFilePermissionRequestBusy = false;
let pocketFilePermissionUiBound = false;
let pocketFilePermissionInertRecords = [];
let pocketFilePermissionReturnFocus = null;

function isPocketFilePermissionPromptOpen() {
  return !!pendingPocketFileHandle && pocketFileState().gateMode === "permission";
}

function showPocketFilePermissionPendingStatus() {
  if (typeof setStatus === "function") {
    setStatus("Finish opening the new file, or cancel, before continuing.", "warn", { durationMs: 5200 });
  }
}

function pocketFilePermissionRequestIsCurrent(token, handle, sourceSession) {
  return token === pendingPocketFilePermissionToken
    && handle === pendingPocketFileHandle
    && isPocketFilePermissionPromptOpen()
    && !!sourceSession
    && isPocketFileSaveSessionCurrent(sourceSession);
}

function setPocketFilePermissionBackgroundInert(enabled) {
  const overlay = el.filePermissionOverlay;
  if (!(overlay instanceof HTMLElement) || !overlay.parentElement) return;
  if (enabled) {
    if (pocketFilePermissionInertRecords.length > 0) return;
    pocketFilePermissionInertRecords = Array.from(overlay.parentElement.children || [])
      .filter((element) => element !== overlay)
      .map((element) => {
        const previous = element.inert === true;
        element.inert = true;
        return { element, previous };
      });
    return;
  }
  for (const record of pocketFilePermissionInertRecords) {
    if (record && record.element) record.element.inert = record.previous;
  }
  pocketFilePermissionInertRecords = [];
}

function focusPocketFilePermissionContinue() {
  if (!isPocketFilePermissionPromptOpen()
      || !(el.filePermissionOverlay instanceof HTMLElement)
      || el.filePermissionOverlay.hidden) return;
  if (!(el.filePermissionContinue instanceof HTMLElement)) return;
  try {
    el.filePermissionContinue.focus({ preventScroll: true });
  } catch {
    el.filePermissionContinue.focus();
  }
}

function showPocketFilePermissionModal() {
  if (!(el.filePermissionOverlay instanceof HTMLElement)) return false;
  if (!(el.filePermissionOverlay.contains(document.activeElement))) {
    pocketFilePermissionReturnFocus = document.activeElement instanceof HTMLElement
      ? document.activeElement
      : null;
  }
  if (el.filePermissionFileName instanceof HTMLElement) {
    el.filePermissionFileName.textContent = cleanText(
      pocketFileState().pendingName || pendingPocketFileHandle?.name || "Selected Pocket file",
      120
    );
  }
  if (el.filePermissionContinue && typeof el.filePermissionContinue === "object") {
    el.filePermissionContinue.disabled = pocketFilePermissionRequestBusy;
  }
  if (el.filePermissionCancel && typeof el.filePermissionCancel === "object") {
    el.filePermissionCancel.disabled = false;
  }
  el.filePermissionOverlay.hidden = false;
  document.body?.classList?.add("filePermissionOpen");
  setPocketFilePermissionBackgroundInert(true);
  requestAnimationFrame(focusPocketFilePermissionContinue);
  return true;
}

function closePocketFilePermissionModal(options = {}) {
  const opts = { restoreFocus: false, ...options };
  const returnFocus = pocketFilePermissionReturnFocus;
  pocketFilePermissionReturnFocus = null;
  if (el.filePermissionOverlay instanceof HTMLElement) {
    el.filePermissionOverlay.hidden = true;
  }
  document.body?.classList?.remove("filePermissionOpen");
  setPocketFilePermissionBackgroundInert(false);
  if (opts.restoreFocus) {
    if (typeof refocusTreeNavigation === "function" && canShowPocketTree()) {
      refocusTreeNavigation(state.selectedId);
    } else {
      const fallback = returnFocus instanceof HTMLElement
        ? returnFocus
        : (el.btnLoad instanceof HTMLElement ? el.btnLoad : null);
      fallback?.focus?.();
    }
  }
}

function pocketFilePermissionFocusableElements() {
  if (!(el.filePermissionOverlay instanceof HTMLElement)
      || typeof el.filePermissionOverlay.querySelectorAll !== "function") return [];
  return Array.from(el.filePermissionOverlay.querySelectorAll("button:not([disabled])"));
}

function handlePocketFilePermissionKeydown(event) {
  if (!isPocketFilePermissionPromptOpen() || !event) return;
  const targetInside = el.filePermissionOverlay instanceof HTMLElement
    && el.filePermissionOverlay.contains(event.target);
  if (event.key === "Escape") {
    event.preventDefault();
    event.stopImmediatePropagation?.();
    cancelPocketFilePermissionRequest();
    return;
  }
  if (event.key === "Tab") {
    const items = pocketFilePermissionFocusableElements();
    if (items.length === 0) {
      event.preventDefault();
      event.stopImmediatePropagation?.();
      return;
    }
    const currentIndex = items.indexOf(document.activeElement);
    const nextIndex = event.shiftKey
      ? (currentIndex <= 0 ? items.length - 1 : currentIndex - 1)
      : (currentIndex < 0 || currentIndex >= items.length - 1 ? 0 : currentIndex + 1);
    event.preventDefault();
    event.stopImmediatePropagation?.();
    items[nextIndex].focus();
    return;
  }
  if (targetInside && (event.key === "Enter" || event.key === " ")) {
    event.stopImmediatePropagation?.();
    return;
  }
  event.preventDefault();
  event.stopImmediatePropagation?.();
}

function bindPocketFilePermissionUi() {
  if (pocketFilePermissionUiBound || !(el.filePermissionOverlay instanceof HTMLElement)) return false;
  pocketFilePermissionUiBound = true;
  el.filePermissionContinue?.addEventListener("click", () => {
    void continuePocketFilePermissionRequest();
  });
  el.filePermissionCancel?.addEventListener("click", cancelPocketFilePermissionRequest);
  window.addEventListener("keydown", handlePocketFilePermissionKeydown, true);
  document.addEventListener("focusin", (event) => {
    if (!isPocketFilePermissionPromptOpen()) return;
    if (el.filePermissionOverlay instanceof HTMLElement
        && el.filePermissionOverlay.contains(event.target)) return;
    focusPocketFilePermissionContinue();
  }, true);
  return true;
}

function setPocketFileSession(handle, displayName, options = {}) {
  const nextHandle = handle || null;
  const nextName = cleanText(displayName, 120);
  const nextDetached = options.detachedDeviceChanges === true
    && !nextHandle
    && options.pipSession !== true;
  const nextWritable = !!nextHandle || options.pipSession === true;
  const nextPip = options.pipSession === true;
  const session = pocketFileState();
  const targetChanged = truthFileHandle !== nextHandle
    || session.writable !== nextWritable
    || session.pipSession !== nextPip
    || session.detachedDeviceChanges !== nextDetached;
  const routineWriteToCurrentHandle = isPocketFilePermissionPromptOpen()
    && nextHandle === truthFileHandle
    && !targetChanged
    && options.forceNewSession !== true;
  if (isPocketFilePermissionPromptOpen() && !routineWriteToCurrentHandle) {
    clearPendingPocketFileHandle({ render: false, restoreFocus: false });
  }
  truthFileHandle = nextHandle;
  session.writable = nextWritable;
  session.displayName = nextName;
  if (!routineWriteToCurrentHandle) {
    session.pendingName = "";
    session.gateMode = "";
  }
  session.pipSession = nextPip;
  session.detachedDeviceChanges = nextDetached;
  if (targetChanged || options.forceNewSession === true) pocketFileSessionId += 1;
  return session;
}

function setDetachedPocketDocumentSession(displayName = "Device changes") {
  return setPocketFileSession(null, displayName, {
    detachedDeviceChanges: true,
    forceNewSession: true,
  });
}

function clearPocketFileSession(options = {}) {
  clearPendingPocketFileHandle({ render: false, restoreFocus: false });
  const session = pocketFileState();
  const targetChanged = !!truthFileHandle
    || session.writable === true
    || !!session.displayName
    || session.pipSession === true
    || session.detachedDeviceChanges === true;
  truthFileHandle = null;
  session.writable = false;
  session.displayName = "";
  session.pendingName = "";
  session.gateMode = "";
  session.pipSession = false;
  session.detachedDeviceChanges = false;
  if (options.keepRecent !== true) session.recentName = "";
  if (targetChanged) pocketFileSessionId += 1;
}

function hasWritablePocketFile() {
  return !!truthFileHandle && pocketFileState().writable === true;
}

function capturePocketFileSaveSession() {
  const session = pocketFileState();
  return {
    id: pocketFileSessionId,
    handle: truthFileHandle,
    displayName: cleanText(session.displayName, 120),
    writable: session.writable === true,
    pipSession: session.pipSession === true,
    detachedDeviceChanges: session.detachedDeviceChanges === true,
  };
}

function isPocketFileSaveSessionCurrent(snapshot) {
  const session = pocketFileState();
  return !!snapshot
    && snapshot.id === pocketFileSessionId
    && snapshot.handle === truthFileHandle
    && snapshot.pipSession === (session.pipSession === true)
    && snapshot.detachedDeviceChanges === (session.detachedDeviceChanges === true);
}

function capturePocketEditorSourceIdentity() {
  const session = pocketFileState();
  return {
    fileSessionId: pocketFileSessionId,
    sourceFileName: cleanText(session.displayName || state.source?.fileName, 120),
    sourcePipSession: session.pipSession === true,
  };
}

function isPocketEditorSourceIdentityCurrent(identity) {
  return !!identity
    && typeof identity === "object"
    && !Array.isArray(identity)
    && Number.isSafeInteger(identity.fileSessionId)
    && identity.fileSessionId >= 0
    && identity.fileSessionId === pocketFileSessionId;
}

function renewPocketDocumentSession() {
  const session = pocketFileState();
  setPocketFileSession(truthFileHandle, session.displayName || state.source?.fileName, {
    pipSession: session.pipSession === true,
    detachedDeviceChanges: session.detachedDeviceChanges === true,
    forceNewSession: true,
  });
  return capturePocketEditorSourceIdentity();
}

function adoptPocketDocumentFromPip(snapshot) {
  if (isPocketFilePermissionPromptOpen()) {
    showPocketFilePermissionPendingStatus();
    return false;
  }
  if (typeof window.isPocketDeviceChangesDecisionOpen === "function"
      && window.isPocketDeviceChangesDecisionOpen()) {
    setStatus("Choose how to handle the file and device changes first.", "warn", { durationMs: 5200 });
    return false;
  }
  return typeof adoptPocketLiteSessionState === "function" && adoptPocketLiteSessionState(snapshot);
}

function canShowPocketTree() {
  const session = pocketFileState();
  return hasWritablePocketFile()
    || (isPipMode && session.pipSession === true)
    || session.detachedDeviceChanges === true;
}

function canModifyPocket() {
  if (isPocketFilePermissionPromptOpen()) return false;
  if (typeof window.isPocketDeviceChangesDecisionOpen === "function"
      && window.isPocketDeviceChangesDecisionOpen()) {
    return false;
  }
  return canShowPocketTree();
}

function showPocketFileGatePrompt() {
  if (isPocketFilePermissionPromptOpen()) {
    showPocketFilePermissionPendingStatus();
    return;
  }
  if (typeof window.isPocketDeviceChangesDecisionOpen === "function"
      && window.isPocketDeviceChangesDecisionOpen()) {
    if (typeof setStatus === "function") {
      setStatus("Choose how to handle the file and device changes first.", "warn", { durationMs: 5200 });
    }
    return;
  }
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

async function getPocketFilePermissionState(handle) {
  if (!handle) return "denied";
  const opts = { mode: "readwrite" };
  try {
    if (typeof handle.queryPermission === "function") {
      const current = await handle.queryPermission(opts);
      return current === "granted" || current === "denied" ? current : "prompt";
    }
    return typeof handle.requestPermission === "function" ? "prompt" : "granted";
  } catch (err) {
    console.warn("[pocket-lite] permission query failed", err);
    return "prompt";
  }
}

function clearPendingPocketFileHandle(options = {}) {
  pendingPocketFilePermissionToken += 1;
  pendingPocketFileHandle = null;
  pendingPocketFilePermissionSourceSession = null;
  pocketFilePermissionRequestBusy = false;
  const session = pocketFileState();
  session.pendingName = "";
  if (session.gateMode === "permission") session.gateMode = "";
  if (el.filePermissionContinue && typeof el.filePermissionContinue === "object") {
    el.filePermissionContinue.disabled = false;
  }
  closePocketFilePermissionModal({ restoreFocus: options.restoreFocus === true });
  if (options.render === true && typeof renderTree === "function") renderTree();
  if (typeof refreshMeta === "function") refreshMeta();
}

function showPocketFilePermissionExplanation(handle, displayName = "", options = {}) {
  if (!handle) return false;
  if (isPocketFilePermissionPromptOpen()) {
    showPocketFilePermissionPendingStatus();
    return false;
  }
  const sourceSession = options.sourceSession || capturePocketFileSaveSession();
  if (!isPocketFileSaveSessionCurrent(sourceSession)) return false;
  pendingPocketFilePermissionToken += 1;
  pendingPocketFileHandle = handle || null;
  pendingPocketFilePermissionSourceSession = sourceSession;
  pocketFilePermissionRequestBusy = false;
  const session = pocketFileState();
  session.pendingName = cleanText(displayName || handle?.name, 120);
  session.gateMode = "permission";
  showPocketFilePermissionModal();
  if (typeof refreshMeta === "function") refreshMeta();
  return false;
}

async function continuePocketFilePermissionRequest() {
  if (pocketFilePermissionRequestBusy) return false;
  const handle = pendingPocketFileHandle;
  const pendingName = cleanText(pocketFileState().pendingName || handle?.name, 120);
  const token = pendingPocketFilePermissionToken;
  const sourceSession = pendingPocketFilePermissionSourceSession;
  if (!handle) {
    clearPendingPocketFileHandle({ restoreFocus: true });
    setStatus("Choose a Pocket file to continue.", "warn");
    return false;
  }
  pocketFilePermissionRequestBusy = true;
  if (el.filePermissionContinue && typeof el.filePermissionContinue === "object") {
    el.filePermissionContinue.disabled = true;
  }
  const canWrite = await ensureWritePermission(handle);
  if (!pocketFilePermissionRequestIsCurrent(token, handle, sourceSession)) return false;
  if (!canWrite) {
    clearPendingPocketFileHandle({ restoreFocus: true });
    setStatus("That file was not opened. Your current Pocket file is unchanged.", "warn", { durationMs: 6200 });
    return false;
  }
  const loaded = await loadFromFileHandle(handle, {
    permissionAlreadyGranted: true,
    displayName: pendingName,
    permissionRequest: { token, sourceSession },
    canContinue: () => pocketFilePermissionRequestIsCurrent(token, handle, sourceSession),
    beforeAdopt: () => {
      if (!pocketFilePermissionRequestIsCurrent(token, handle, sourceSession)) return false;
      clearPendingPocketFileHandle({ render: false, restoreFocus: false });
      return true;
    },
  });
  if (loaded) return true;
  if (pocketFilePermissionRequestIsCurrent(token, handle, sourceSession)) {
    clearPendingPocketFileHandle({ restoreFocus: true });
    setStatus("That file was not opened. Your current Pocket file is unchanged.", "warn", { durationMs: 6200 });
  }
  return false;
}

function cancelPocketFilePermissionRequest() {
  if (!isPocketFilePermissionPromptOpen()) return false;
  clearPendingPocketFileHandle({ restoreFocus: true });
  setStatus("Open cancelled. Your current Pocket file is unchanged.", "warn");
  return false;
}

bindPocketFilePermissionUi();

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

async function readRecentPocketFileMeta() {
  const db = await openRecentPocketFileDb();
  if (!db) return null;
  return new Promise((resolve) => {
    const tx = db.transaction(RECENT_POCKET_FILE_STORE, "readonly");
    const store = tx.objectStore(RECENT_POCKET_FILE_STORE);
    const request = store.get("current");
    request.onsuccess = () => {
      const record = request.result && typeof request.result === "object" ? request.result : null;
      const displayName = cleanText(record?.displayName || record?.name, 120);
      const updatedAt = cleanText(record?.updatedAt, 40);
      resolve(displayName ? { displayName, updatedAt } : null);
    };
    request.onerror = () => resolve(null);
    tx.oncomplete = () => db.close();
    tx.onerror = () => {
      try { db.close(); } catch {}
      resolve(null);
    };
  });
}

async function storeRecentPocketFileMeta(displayName = "") {
  const name = cleanText(displayName, 120);
  if (!name) return false;
  const db = await openRecentPocketFileDb();
  if (!db) return false;
  return new Promise((resolve) => {
    const tx = db.transaction(RECENT_POCKET_FILE_STORE, "readwrite");
    const store = tx.objectStore(RECENT_POCKET_FILE_STORE);
    store.put({
      displayName: name,
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
  const record = await readRecentPocketFileMeta();
  const name = cleanText(record?.displayName, 120);
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

async function loadFromFileHandle(handle, options = {}) {
  if (!handle || typeof handle.getFile !== "function") return false;
  const opts = {
    permissionAlreadyGranted: false,
    displayName: "",
    sourceSession: null,
    permissionRequest: null,
    canContinue: null,
    beforeAdopt: null,
    ...options,
  };
  const openingSourceSession = opts.permissionRequest?.sourceSession
    || opts.sourceSession
    || capturePocketFileSaveSession();
  const deviceChangesDecisionIsOpen = () => (
    typeof window.isPocketDeviceChangesDecisionOpen === "function"
    && window.isPocketDeviceChangesDecisionOpen()
  );
  const openingIsCurrent = () => {
    if (opts.permissionRequest) {
      return pocketFilePermissionRequestIsCurrent(
        opts.permissionRequest.token,
        handle,
        opts.permissionRequest.sourceSession
      );
    }
    return isPocketFileSaveSessionCurrent(openingSourceSession)
      && !isPocketFilePermissionPromptOpen()
      && !deviceChangesDecisionIsOpen();
  };
  try {
    if (isPocketFilePermissionPromptOpen() && !opts.permissionRequest) {
      showPocketFilePermissionPendingStatus();
      return false;
    }
    if (deviceChangesDecisionIsOpen()) {
      setStatus("Choose how to handle the file and device changes first.", "warn", { durationMs: 5200 });
      return false;
    }
    if (!opts.permissionAlreadyGranted) {
      const permissionState = await getPocketFilePermissionState(handle);
      if (!openingIsCurrent()) return false;
      if (permissionState === "prompt") {
        return showPocketFilePermissionExplanation(
          handle,
          opts.displayName || handle.name,
          { sourceSession: openingSourceSession }
        );
      }
      if (permissionState !== "granted") {
        setStatus("Pocket needs permission to save changes to that file.", "warn", { durationMs: 6200 });
        if (typeof renderTree === "function") renderTree();
        return false;
      }
    }
    if (!openingIsCurrent()) return false;
    const file = await handle.getFile();
    if (!openingIsCurrent()) return false;
    const fileSession = {
      handle,
      displayName: opts.displayName || file.name || handle.name,
      adoptedIdentity: null,
    };
    const loaded = await loadFromFile(file, {
      fileSession,
      canContinue: () => (
        openingIsCurrent()
        && (typeof opts.canContinue !== "function" || opts.canContinue() !== false)
      ),
      beforeAdopt: () => {
        if (!openingIsCurrent()) return false;
        return typeof opts.beforeAdopt !== "function" || opts.beforeAdopt() !== false;
      },
    });
    if (!loaded) {
      if (typeof renderTree === "function") renderTree();
      return false;
    }
    if (!isPocketEditorSourceIdentityCurrent(fileSession.adoptedIdentity)) return true;
    void storeRecentPocketFileMeta(file.name || handle.name);
    pocketFileState().recentName = cleanText(file.name || handle.name, 120);
    if (!(typeof window.isPocketDeviceChangesDecisionOpen === "function"
        && window.isPocketDeviceChangesDecisionOpen())) {
      setStatus("Pocket file loaded. Changes will save in the right place.", "ok", { durationMs: 5200 });
      refocusTreeNavigation(state.selectedId);
    }
    refreshMeta();
    return true;
  } catch (err) {
    console.warn("[pocket-lite] open file handle failed", err);
    setStatus("Could not open that Pocket file.", "warn");
    if (typeof renderTree === "function") renderTree();
    return false;
  }
}

async function openPocketFile() {
  if (isPocketFilePermissionPromptOpen()) {
    showPocketFilePermissionPendingStatus();
    return false;
  }
  if (typeof window.isPocketDeviceChangesDecisionOpen === "function"
      && window.isPocketDeviceChangesDecisionOpen()) {
    setStatus("Choose how to handle the file and device changes first.", "warn", { durationMs: 5200 });
    return false;
  }
  if (typeof window.showOpenFilePicker !== "function") {
    setStatus("Pocket file loading is not available in this browser.", "warn", { durationMs: 6200 });
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
    return await loadFromFileHandle(handle, { displayName: handle.name });
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

async function writeTruthFile(payload, options = {}) {
  if (isPocketFilePermissionPromptOpen()) {
    return { ok: false, reason: "file-permission-pending" };
  }
  const expectedSession = options.expectedSession || null;
  const activeHandle = expectedSession ? expectedSession.handle : truthFileHandle;
  const expectedSessionIsCurrent = () => !expectedSession || isPocketFileSaveSessionCurrent(expectedSession);
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
    if (activeHandle) {
      const existingAttempt = await writePocketPayloadToHandle(payload, activeHandle);
      if (!expectedSessionIsCurrent()) {
        return { ok: false, reason: "file-session-changed" };
      }
      if (existingAttempt.ok) {
        const name = cleanText(activeHandle.name || state.source?.fileName, 120);
        setPocketFileSession(activeHandle, name);
        void storeRecentPocketFileMeta(name);
        return {
          ...existingAttempt,
          target: "opened-file",
          sourceIdentity: capturePocketEditorSourceIdentity(),
        };
      }
      if (isPocketFilePermissionPromptOpen()) {
        return { ok: false, reason: "file-permission-pending" };
      }
      if (existingAttempt.permissionDenied) return existingAttempt;
    }

    if (!expectedSessionIsCurrent()) return { ok: false, reason: "file-session-changed" };
    const pickedHandle = await pickHandle();
    if (!pickedHandle) return { ok: false, reason: "unsupported" };
    if (!expectedSessionIsCurrent()) return { ok: false, reason: "file-session-changed" };
    const pickedAttempt = await writePocketPayloadToHandle(payload, pickedHandle);
    if (!expectedSessionIsCurrent()) {
      return { ok: false, reason: "file-session-changed", wroteSeparateCopy: pickedAttempt.ok === true };
    }
    if (pickedAttempt.ok) {
      const name = cleanText(pickedHandle.name || "pocket-data.json", 120);
      setPocketFileSession(pickedHandle, name, { forceNewSession: true });
      state.source.fileName = name;
      const adoptedIdentity = capturePocketEditorSourceIdentity();
      void storeRecentPocketFileMeta(name);
      return {
        ...pickedAttempt,
        target: "picked-file",
        adoptedFromSessionId: expectedSession ? expectedSession.id : null,
        sourceIdentity: adoptedIdentity,
      };
    }
    return pickedAttempt;
  } catch (err) {
    if (isFilePickerAbort(err)) {
      return { ok: false, reason: "cancelled", aborted: true, error: err };
    }
    return { ok: false, reason: "write-failed", aborted: false, error: err };
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

function buildLoadedPocketComparisonDocument(norm, parsed) {
  const owner = window.PocketDeviceChanges;
  const normalised = {
    nodes: Array.isArray(norm?.nodes) ? norm.nodes : [],
    tombstones: Array.isArray(norm?.tombstones) ? norm.tombstones : [],
    rootExtras: norm?.rootExtras || {},
    dataExtras: norm?.dataExtras || {},
  };
  if (!owner || typeof owner.coerceDocument !== "function") {
    return {
      schema: "pocket.deviceChanges.comparisonInput.v1",
      document: normalised,
      combinationSafe: false,
    };
  }
  const raw = owner.coerceDocument(parsed);
  if (!raw || !raw.ok) {
    return {
      schema: "pocket.deviceChanges.comparisonInput.v1",
      document: normalised,
      combinationSafe: false,
    };
  }
  return {
    schema: "pocket.deviceChanges.comparisonInput.v1",
    document: raw.document,
    combinationSafe: raw.ambiguousTreeCopies !== true
      && typeof owner.documentsEqual === "function"
      && owner.documentsEqual(raw.document, normalised),
  };
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
  if (isPocketFilePermissionPromptOpen()) {
    showPocketFilePermissionPendingStatus();
    return false;
  }
  if (typeof window.isPocketDeviceChangesDecisionOpen === "function"
      && window.isPocketDeviceChangesDecisionOpen()) {
    setStatus("Choose how to handle the file and device changes first.", "warn", { durationMs: 5200 });
    return false;
  }
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
    const norm = normaliseInput(payload);
    setPocketFileSession(handle, name, { forceNewSession: true });
    applyLoadedState(norm, {
      schema: norm.schema,
      fileName: name,
      writtenAt: norm.writtenAt || payload.writtenAt || "",
    }, {
      skipLocalSafetyCheck: true,
      establishDocumentBaseline: true,
      baselinePayload: payload,
    });
    pocketFileState().recentName = name;
    if (typeof adoptPocketOperations === "function") {
      adoptPocketOperations([], 0);
    } else {
      state.ops = [];
    }
    clearLocalSafetySnapshot();
    clearConflictGuard();
    markSavedNow(payload);
    refreshMeta();
    renderTree();
    setStatus("Pocket file created. Changes will save in the right place.", "ok", { durationMs: 5200 });
    void storeRecentPocketFileMeta(name);
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
  const saveSession = capturePocketFileSaveSession();
  return enqueueTreeSave(async () => {
    if (!isPocketFileSaveSessionCurrent(saveSession)) {
      return exportTreeResult(options, false, "file-session-changed");
    }
    if (!canModifyPocket()) {
      const permissionPending = isPocketFilePermissionPromptOpen();
      showPocketFileGatePrompt();
      if (!permissionPending) refocusTreeNavigation(state.selectedId);
      return exportTreeResult(
        options,
        false,
        permissionPending ? "file-permission-pending" : "no-pocket-file"
      );
    }
    if (shouldPauseForStaleExportGuard(options)) return exportTreeResult(options, false, "stale-guard");
    const opsAtSaveStart = Array.isArray(state.ops) ? state.ops.length : 0;
    const saveStartHighestSequence = typeof getPocketHighestOperationSequence === "function"
      ? getPocketHighestOperationSequence()
      : opsAtSaveStart;
    if (opsAtSaveStart === 0 && saveSession.detachedDeviceChanges !== true) {
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
    state.activeSaveOperationCeiling = saveStartHighestSequence;
    let writeResult;
    try {
      writeResult = await writeTruthFile(payload, { expectedSession: saveSession });
    } finally {
      state.activeSaveOperationCeiling = 0;
    }
    const pickedFileAdoption = !!(
      writeResult
      && writeResult.ok
      && writeResult.target === "picked-file"
      && writeResult.adoptedFromSessionId === saveSession.id
      && isPocketEditorSourceIdentityCurrent(writeResult.sourceIdentity)
    );
    if (!isPocketFileSaveSessionCurrent(saveSession) && !pickedFileAdoption) {
      return exportTreeResult(options, false, "file-session-changed");
    }
    if (writeResult.ok) {
      markSavedNow(payload);
      state.source.writtenAt = cleanText(payload.writtenAt || payload.exportedAt, 40);
      if (typeof establishPocketDocumentBaseline === "function") {
        establishPocketDocumentBaseline(payload, state.source);
      }
      state.detachedSafetyBase = null;
      // Only clear browser change records covered by the frozen payload.
      if (typeof retainPocketOperationsAfterSequence === "function") {
        retainPocketOperationsAfterSequence(saveStartHighestSequence);
      } else {
        state.ops = Array.isArray(state.ops) ? state.ops.slice(opsAtSaveStart) : [];
      }
      const newerSafetyStored = state.ops.length > 0
        ? saveLocalSafetySnapshot("newer-change-after-save")
        : true;
      if (state.ops.length === 0) clearLocalSafetySnapshot();
      if (state.ops.length > 0 && !newerSafetyStored) {
        setStatus(`Saved to Pocket file. ${state.ops.length} newer change${state.ops.length === 1 ? "" : "s"} remain open, but Pocket could not refresh the device safety copy.`, "warn", { durationMs: 7200 });
      } else if (state.ops.length > 0) {
        setStatus(`${backupProofLabel()}. ${state.ops.length} newer change${state.ops.length === 1 ? "" : "s"} still local.`, "ok", { durationMs: 5600 });
      } else if (writeResult.target === "opened-file") {
        setStatus("Saved to Pocket file.", "ok", { durationMs: 5200 });
      } else if (writeResult.target === "picked-file") {
        setStatus("Saved to Pocket file.", "ok", { durationMs: 5200 });
      } else {
        setStatus(backupProofLabel(), "ok", { durationMs: 5200 });
      }
      flashSaveChip(newerSafetyStored ? "Safe" : "Check");
      clearConflictGuard();
      persistPipSnapshot();
      refocusTreeNavigation(state.selectedId);
      return exportTreeResult(options, true, "truth-file", {
        target: writeResult.target || "truth-file",
        sourceIdentity: writeResult.sourceIdentity || capturePocketEditorSourceIdentity(),
      });
    }
    if (writeResult.aborted) {
      setStatus("Save cancelled.", "warn");
      refocusTreeNavigation(state.selectedId);
      return exportTreeResult(options, false, "cancelled");
    }
    if (writeResult.reason === "file-permission-pending") {
      showPocketFilePermissionPendingStatus();
      return exportTreeResult(options, false, "file-permission-pending");
    }
    if (options.downloadFallback === false) {
      const message = writeResult.permissionDenied
        ? "Save access denied. Use main Save to choose a writable file."
        : "Could not save from here. Use Save in the main pocket window.";
      setStatus(message, "warn");
      refocusTreeNavigation(state.selectedId);
      return exportTreeResult(options, false, writeResult.reason || "write-failed");
    }
    if (saveSession.detachedDeviceChanges === true) {
      setStatus("Could not save that file. Your device changes are still open.", "warn", { durationMs: 6200 });
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
  const opts = {
    allowImportFallback: false,
    fileSession: null,
    canContinue: null,
    beforeAdopt: null,
    ...options,
  };
  const pendingFileSession = opts.fileSession
    && opts.fileSession.handle
    && typeof opts.fileSession.handle === "object"
    ? opts.fileSession
    : null;
  const adoptLoadedFileSession = () => {
    if (!pendingFileSession) return true;
    if (typeof opts.beforeAdopt === "function" && opts.beforeAdopt() === false) return false;
    setPocketFileSession(
      pendingFileSession.handle,
      pendingFileSession.displayName || file.name || pendingFileSession.handle.name,
      { forceNewSession: true }
    );
    pendingFileSession.adoptedIdentity = capturePocketEditorSourceIdentity();
    return true;
  };
  const loadedStateOptions = (extra = {}) => ({
    ...extra,
    establishDocumentBaseline: !!pendingFileSession,
  });
  const fileLoadIsCurrent = () => (
    typeof opts.canContinue !== "function" || opts.canContinue() !== false
  );
  if (!canShowPocketTree() && !pendingFileSession) {
    setStatus("Use Choose Pocket file so changes save in the right place.", "warn", { durationMs: 6200 });
    return false;
  }
  let text = "";
  try {
    text = await file.text();
  } catch (err) {
    setStatus(`Could not read file: ${err && err.message ? err.message : "read failed"}`, "warn");
    return false;
  }
  if (!fileLoadIsCurrent()) return false;
  let parsed = null;
  try {
    parsed = JSON.parse(text);
  } catch (err) {
    const ndjsonEntries = parseNdjsonLines(text);
    const latestChange = pickLatestChangeSnapshot(ndjsonEntries);
    if (opts.allowImportFallback && latestChange && latestChange.norm && Array.isArray(latestChange.norm.nodes) && latestChange.norm.nodes.length > 0) {
      snapshotCurrentTreeForRestore();
      if (!adoptLoadedFileSession()) return false;
      applyLoadedState(latestChange.norm, {
        schema: latestChange.norm.schema || "pocket.change.v1",
        fileName: cleanText(file.name, 120),
        writtenAt: latestChange.writtenAt || latestChange.norm.writtenAt || "",
      }, loadedStateOptions());
      saveAutoCache(latestChange.norm, {
        schema: latestChange.norm.schema || "pocket.change.v1",
        fileName: cleanText(file.name, 120),
        writtenAt: latestChange.writtenAt || latestChange.norm.writtenAt || "",
      });
      if (!(typeof window.isPocketDeviceChangesDecisionOpen === "function"
          && window.isPocketDeviceChangesDecisionOpen())) {
        setStatus("pocket opened from change log.", "ok");
      }
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
  if (!fileLoadIsCurrent()) return false;
  if (!Array.isArray(norm.nodes) || norm.nodes.length === 0) {
    if (isPocketPayloadShape(parsed)) {
      snapshotCurrentTreeForRestore();
      if (!adoptLoadedFileSession()) return false;
      applyLoadedState(norm, {
        schema: norm.schema || "",
        fileName: cleanText(file.name, 120),
        writtenAt: norm.writtenAt || "",
      }, loadedStateOptions({
        comparisonDocument: buildLoadedPocketComparisonDocument(norm, parsed),
      }));
      saveAutoCache(norm, {
        schema: norm.schema || "",
        fileName: cleanText(file.name, 120),
        writtenAt: norm.writtenAt || "",
      });
      if (!(typeof window.isPocketDeviceChangesDecisionOpen === "function"
          && window.isPocketDeviceChangesDecisionOpen())) {
        setStatus("Pocket file loaded.", "ok");
      }
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
  if (!adoptLoadedFileSession()) return false;
  applyLoadedState(norm, {
    schema: norm.schema || "",
    fileName: cleanText(file.name, 120),
    writtenAt: norm.writtenAt || "",
  }, loadedStateOptions({
    comparisonDocument: buildLoadedPocketComparisonDocument(norm, parsed),
  }));
  saveAutoCache(norm, {
    schema: norm.schema || "",
    fileName: cleanText(file.name, 120),
    writtenAt: norm.writtenAt || "",
  });
  if (!(typeof window.isPocketDeviceChangesDecisionOpen === "function"
      && window.isPocketDeviceChangesDecisionOpen())) {
    setStatus("pocket opened.", "ok");
  }
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
