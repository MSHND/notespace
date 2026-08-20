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

  function safeJson(value) {
    return JSON.stringify(value).replace(/</g, "\\u003c");
  }

  function editorHtml(payload, helpers, popupToken) {
    helpers = helpers || {};
    if (!global.PocketNodePopoutTemplate || typeof global.PocketNodePopoutTemplate.render !== "function") {
      throw new Error("PocketNodePopoutTemplate is not loaded.");
    }
    if (!global.PocketNodePopoutRuntime || typeof global.PocketNodePopoutRuntime.build !== "function") {
      throw new Error("PocketNodePopoutRuntime is not loaded.");
    }
    const escape = typeof helpers.htmlEscape === "function" ? helpers.htmlEscape : htmlEscape;
    const toJson = typeof helpers.safeJson === "function" ? helpers.safeJson : safeJson;
    const runtimePayload = {
      ...payload,
      popupOwnerToken: ownerToken,
      popupInstanceToken: popupToken
    };
    return global.PocketNodePopoutTemplate.render(payload, {
      htmlEscape: escape,
      runtimeScript: global.PocketNodePopoutRuntime.build(toJson(runtimePayload))
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

  function unregisterPopup(record) {
    if (!record) return;
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

  function writeFreshPopup(record, payload, helpers) {
    if (!record || !livePopups.has(record) || !freshPopupIsOwned(record.window)) return false;
    try {
      record.window.name = record.targetName;
      record.window.document.open();
      record.window.document.write(editorHtml(payload, helpers, record.popupToken));
      record.window.document.close();
    } catch (_error) {
      closeFreshPopup(record);
      unregisterPopup(record);
      return false;
    }
    const session = ownedSession(record);
    if (!session) {
      closeFreshPopup(record);
      unregisterPopup(record);
      return false;
    }
    try {
      if (typeof record.window.focus === "function") record.window.focus();
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
      targetName: targetName
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
        || candidatePopupToken !== record.popupToken) {
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
