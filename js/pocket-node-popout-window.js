/* Popup window orchestration for the standalone node popout editor. */
(function initialisePocketNodePopoutWindow(global) {
  "use strict";

  const ownerToken = randomToken("owner");
  const livePopups = new Set();
  let lastOpenedPopup = null;

  function randomToken(prefix) {
    let value = "";
    try {
      if (global.crypto && typeof global.crypto.randomUUID === "function") {
        value = global.crypto.randomUUID();
      } else if (global.crypto && typeof global.crypto.getRandomValues === "function") {
        const bytes = new Uint32Array(4);
        global.crypto.getRandomValues(bytes);
        value = Array.from(bytes, function (part) {
          return part.toString(16).padStart(8, "0");
        }).join("");
      }
    } catch (_error) {}
    if (!value) {
      const parts = [];
      for (let index = 0; index < 6; index += 1) {
        parts.push(Math.floor(Math.random() * 0x100000000).toString(16).padStart(8, "0"));
      }
      value = parts.join("");
    }
    return `${prefix}_${String(value).replace(/[^a-zA-Z0-9_-]/g, "")}`;
  }

  function htmlEscape(value) {
    return String(value || "").replace(/[&<>"]/g, function (ch) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;" }[ch];
    });
  }

  function runtimeAssetUrl() {
    try {
      return new global.URL("js/pocket-node-popout-runtime.js", global.location.href).pathname;
    } catch (_error) {
      return "/js/pocket-node-popout-runtime.js";
    }
  }

  function editorHtml(payload, helpers, popupToken) {
    helpers = helpers || {};
    if (!global.PocketNodePopoutTemplate || typeof global.PocketNodePopoutTemplate.render !== "function") {
      throw new Error("PocketNodePopoutTemplate is not loaded.");
    }
    if (!global.PocketNodePopoutRuntime || typeof global.PocketNodePopoutRuntime.initialise !== "function") {
      throw new Error("PocketNodePopoutRuntime is not loaded.");
    }
    const escape = typeof helpers.htmlEscape === "function" ? helpers.htmlEscape : htmlEscape;
    const runtimePayload = {
      ...payload,
      popupOwnerToken: ownerToken,
      popupInstanceToken: popupToken
    };
    return global.PocketNodePopoutTemplate.render(runtimePayload, {
      htmlEscape: escape,
      runtimeAssetUrl: runtimeAssetUrl()
    });
  }

  function setBlockedPopupStatus(helpers) {
    const status = helpers && typeof helpers.setStatus === "function"
      ? helpers.setStatus
      : (typeof setStatus === "function" ? setStatus : null);
    if (status) status("Popout blocked. Allow popups for pocket, then try again.", "warn", { durationMs: 5200 });
  }

  function setIsolatedPopupFailureStatus(helpers) {
    const status = helpers && typeof helpers.setStatus === "function"
      ? helpers.setStatus
      : (typeof setStatus === "function" ? setStatus : null);
    if (status) {
      status("Pocket could not open a private editor window. Nothing was changed.", "warn", { durationMs: 6200 });
    }
  }

  function popupGeometry() {
    const width = Math.min(820, Math.max(600, Math.round(global.screen.availWidth * 0.5)));
    const height = Math.min(820, Math.max(600, Math.round(global.screen.availHeight * 0.76)));
    return {
      width: width,
      height: height,
      left: Math.round((global.screen.availWidth - width) / 2),
      top: Math.round((global.screen.availHeight - height) / 2)
    };
  }

  function isOpen(win) {
    try {
      return !!win && win.closed !== true;
    } catch (_error) {
      return false;
    }
  }

  function sessionFor(win) {
    try {
      return win && win.PocketNodePopoutSession ? win.PocketNodePopoutSession : null;
    } catch (_error) {
      return null;
    }
  }

  function identityFor(session) {
    try {
      return session && typeof session.getIdentity === "function"
        ? session.getIdentity()
        : null;
    } catch (_error) {
      return null;
    }
  }

  function sessionMatches(session, popupToken) {
    const identity = identityFor(session);
    return !!identity
      && identity.ownerToken === ownerToken
      && identity.popupToken === popupToken;
  }

  function freshPopupIsOwned(win) {
    try {
      return isOpen(win)
        && win.opener === global
        && !win.PocketNodePopoutSession;
    } catch (_error) {
      return false;
    }
  }

  function ownedSession(record) {
    if (!record || !isOpen(record.window)) return null;
    const session = sessionFor(record.window);
    return sessionMatches(session, record.popupToken) ? session : null;
  }

  function removeStartupListener(record) {
    if (!record || !record.startupListener) return;
    try {
      if (record.window && typeof record.window.removeEventListener === "function") {
        record.window.removeEventListener("load", record.startupListener);
      }
    } catch (_error) {}
    record.startupListener = null;
  }

  function unregisterPopup(record) {
    if (!record) return;
    removeStartupListener(record);
    livePopups.delete(record);
    if (lastOpenedPopup === record) {
      lastOpenedPopup = Array.from(livePopups).at(-1) || null;
    }
  }

  function closeFreshPopup(record) {
    try {
      if (record && record.window && typeof record.window.close === "function") record.window.close();
    } catch (_error) {}
  }

  function popupHasUnsavedChanges(record) {
    if (record && record.startupState === "pending") return false;
    const session = ownedSession(record);
    if (!session) {
      unregisterPopup(record);
      return false;
    }
    try {
      return !!(session && typeof session.hasUnsavedChanges === "function" && session.hasUnsavedChanges());
    } catch (_error) {
      unregisterPopup(record);
      return false;
    }
  }

  function hasUnsavedChanges(win) {
    if (win) {
      const record = Array.from(livePopups).find((candidate) => candidate.window === win);
      return !!record && popupHasUnsavedChanges(record);
    }
    let dirty = false;
    for (const record of Array.from(livePopups)) {
      if (popupHasUnsavedChanges(record)) dirty = true;
    }
    return dirty;
  }

  function requestUnsavedProtection(record) {
    if (record && record.startupState === "pending") return false;
    const session = ownedSession(record);
    if (!session) {
      unregisterPopup(record);
      return false;
    }
    try {
      if (typeof session.requestUnsavedProtection !== "function"
          || session.requestUnsavedProtection(ownerToken, record.popupToken) !== true) {
        unregisterPopup(record);
        return false;
      }
      if (record.window && typeof record.window.focus === "function") record.window.focus();
      return true;
    } catch (_error) {
      unregisterPopup(record);
      return false;
    }
  }

  function failPendingStartup(record, helpers) {
    if (!record || !livePopups.has(record)) return false;
    closeFreshPopup(record);
    unregisterPopup(record);
    setIsolatedPopupFailureStatus(helpers);
    return false;
  }

  function confirmPendingStartup(record, helpers) {
    if (!record || !livePopups.has(record) || record.startupState !== "pending") return false;
    removeStartupListener(record);
    try {
      if (!isOpen(record.window)
          || record.window.opener !== global
          || !ownedSession(record)) {
        return failPendingStartup(record, helpers);
      }
      record.startupState = "ready";
      if (typeof record.window.focus === "function") record.window.focus();
      return true;
    } catch (_error) {
      return failPendingStartup(record, helpers);
    }
  }

  function beginPendingStartup(record, helpers) {
    if (!record || !livePopups.has(record) || record.startupState !== "pending") return false;
    if (!record.window || typeof record.window.addEventListener !== "function") return false;
    record.startupListener = function () { confirmPendingStartup(record, helpers); };
    try {
      record.window.addEventListener("load", record.startupListener, { once: true });
      return true;
    } catch (_error) {
      record.startupListener = null;
      return false;
    }
  }

  function writeFreshPopup(record, payload, helpers) {
    if (!record || !livePopups.has(record) || !freshPopupIsOwned(record.window)) return false;
    try {
      record.window.name = record.targetName;
      record.window.document.open();
    } catch (_error) {
      closeFreshPopup(record);
      unregisterPopup(record);
      return false;
    }
    if (!beginPendingStartup(record, helpers)) {
      closeFreshPopup(record);
      unregisterPopup(record);
      return false;
    }
    try {
      record.window.document.write(editorHtml(payload, helpers, record.popupToken));
      record.window.document.close();
    } catch (_error) {
      closeFreshPopup(record);
      unregisterPopup(record);
      return false;
    }
    return true;
  }

  function openFresh(payload, helpers) {
    helpers = helpers || {};
    const bounds = popupGeometry();
    const popupToken = randomToken("popup");
    const targetName = `pocketPe_${ownerToken}_${popupToken}`;
    const win = global.open("", "_blank", `popup=yes,width=${bounds.width},height=${bounds.height},left=${bounds.left},top=${bounds.top}`);
    if (!win) {
      setBlockedPopupStatus(helpers);
      return false;
    }
    if (!freshPopupIsOwned(win)) {
      setIsolatedPopupFailureStatus(helpers);
      return false;
    }
    const record = {
      window: win,
      popupToken: popupToken,
      targetName: targetName,
      startupState: "pending",
      startupListener: null
    };
    livePopups.add(record);
    lastOpenedPopup = record;
    if (!writeFreshPopup(record, payload, helpers)) {
      setIsolatedPopupFailureStatus(helpers);
      return false;
    }
    return true;
  }

  function open(payload, helpers) {
    helpers = helpers || {};
    return openFresh(payload, helpers);
  }

  function popupSessionRejection() {
    return {
      ok: false,
      applied: false,
      changed: false,
      exported: false,
      reason: "popup-session-changed",
      status: "This editor belongs to an earlier Pocket window — not saved",
      message: "Pocket could not verify that this editor still belongs to the current window. Nothing was changed. Copy anything you need, then close it and reopen the item from the current Pocket window."
    };
  }

  function validatePopupCall(candidateOwnerToken, candidatePopupToken, callerWindow) {
    const record = Array.from(livePopups).find((candidate) => candidate.window === callerWindow);
    if (!record
        || candidateOwnerToken !== ownerToken
        || candidatePopupToken !== record.popupToken
        || record.startupState !== "ready") {
      return null;
    }
    const session = ownedSession(record);
    if (!session) {
      unregisterPopup(record);
      return null;
    }
    return record;
  }

  async function applyAndSaveFromOwnedPopup(candidateOwnerToken, candidatePopupToken, payload, callerWindow) {
    if (!validatePopupCall(candidateOwnerToken, candidatePopupToken, callerWindow)) {
      return popupSessionRejection();
    }
    const editor = global.PocketNodePopoutEditor;
    if (!editor || typeof editor.applyAndSave !== "function") {
      return popupSessionRejection();
    }
    return editor.applyAndSave(payload);
  }

  function completeCloseFromOwnedPopup(candidateOwnerToken, candidatePopupToken, callerWindow) {
    const record = validatePopupCall(candidateOwnerToken, candidatePopupToken, callerWindow);
    if (!record) return false;
    const session = ownedSession(record);
    if (!session || typeof session.requestOwnedClose !== "function") return false;
    try {
      if (session.requestOwnedClose(ownerToken, record.popupToken) !== true) return false;
    } catch (_error) {
      return false;
    }
    unregisterPopup(record);
    return true;
  }

  function cancelPendingOpen(candidateOwnerToken, candidatePopupToken, callerWindow) {
    const record = validatePopupCall(candidateOwnerToken, candidatePopupToken, callerWindow);
    if (!record) return false;
    return true;
  }

  global.PocketNodePopoutWindow = Object.freeze({
    open: open,
    hasUnsavedChanges: function () {
      return hasUnsavedChanges();
    },
    getOwnerToken: function () {
      return ownerToken;
    },
    getCurrentSessionIdentity: function () {
      return lastOpenedPopup && livePopups.has(lastOpenedPopup)
        ? { ownerToken: ownerToken, popupToken: lastOpenedPopup.popupToken, targetName: lastOpenedPopup.targetName }
        : null;
    },
    applyAndSaveFromOwnedPopup: applyAndSaveFromOwnedPopup,
    completeCloseFromOwnedPopup: completeCloseFromOwnedPopup,
    cancelPendingOpen: cancelPendingOpen
  });
})(window);
