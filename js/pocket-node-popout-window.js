/* Popup window orchestration for the standalone node popout editor. */
(function initialisePocketNodePopoutWindow(global) {
  "use strict";

  let editorWindow = null;
  let pendingOpen = null;

  function htmlEscape(value) {
    return String(value || "").replace(/[&<>"]/g, function (ch) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;" }[ch];
    });
  }

  function safeJson(value) {
    return JSON.stringify(value).replace(/</g, "\\u003c");
  }

  function editorHtml(payload, helpers) {
    helpers = helpers || {};
    if (!global.PocketNodePopoutTemplate || typeof global.PocketNodePopoutTemplate.render !== "function") {
      throw new Error("PocketNodePopoutTemplate is not loaded.");
    }
    if (!global.PocketNodePopoutRuntime || typeof global.PocketNodePopoutRuntime.build !== "function") {
      throw new Error("PocketNodePopoutRuntime is not loaded.");
    }
    const escape = typeof helpers.htmlEscape === "function" ? helpers.htmlEscape : htmlEscape;
    const toJson = typeof helpers.safeJson === "function" ? helpers.safeJson : safeJson;
    return global.PocketNodePopoutTemplate.render(payload, {
      htmlEscape: escape,
      runtimeScript: global.PocketNodePopoutRuntime.build(toJson(payload))
    });
  }

  function setBlockedPopupStatus(helpers) {
    const status = helpers && typeof helpers.setStatus === "function"
      ? helpers.setStatus
      : (typeof setStatus === "function" ? setStatus : null);
    if (status) status("Popout blocked. Allow popups for pocket, then try again.", "warn", { durationMs: 5200 });
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

  function hasUnsavedChanges(win) {
    const session = sessionFor(win);
    try {
      return !!(session && typeof session.hasUnsavedChanges === "function" && session.hasUnsavedChanges());
    } catch (_error) {
      return false;
    }
  }

  function requestUnsavedProtection(win) {
    const session = sessionFor(win);
    try {
      if (win && typeof win.focus === "function") win.focus();
    } catch (_error) {}
    try {
      if (session && typeof session.requestUnsavedProtection === "function") session.requestUnsavedProtection();
    } catch (_error) {}
  }

  function rememberPendingOpen(payload, helpers) {
    pendingOpen = { payload: payload, helpers: helpers || {} };
  }

  function blockIfDirty(win, pending) {
    if (!isOpen(win) || !hasUnsavedChanges(win)) return false;
    if (pending) rememberPendingOpen(pending.payload, pending.helpers);
    requestUnsavedProtection(win);
    return true;
  }

  function writeToEditorWindow(payload, helpers) {
    editorWindow.document.open();
    editorWindow.document.write(editorHtml(payload, helpers));
    editorWindow.document.close();
    editorWindow.focus();
    return true;
  }

  function openNow(payload, helpers) {
    helpers = helpers || {};
    const bounds = popupGeometry();
    editorWindow = global.open("", "pocketNodePopoutEditor", `popup=yes,width=${bounds.width},height=${bounds.height},left=${bounds.left},top=${bounds.top}`);
    if (!editorWindow) {
      setBlockedPopupStatus(helpers);
      return false;
    }
    return writeToEditorWindow(payload, helpers);
  }

  function open(payload, helpers) {
    helpers = helpers || {};
    const pending = { payload: payload, helpers: helpers };
    if (blockIfDirty(editorWindow, pending)) return false;
    const bounds = popupGeometry();
    editorWindow = global.open("", "pocketNodePopoutEditor", `popup=yes,width=${bounds.width},height=${bounds.height},left=${bounds.left},top=${bounds.top}`);
    if (!editorWindow) {
      setBlockedPopupStatus(helpers);
      return false;
    }
    if (blockIfDirty(editorWindow, pending)) return false;
    return writeToEditorWindow(payload, helpers);
  }

  function resumePendingOpen() {
    const pending = pendingOpen;
    if (!pending) return false;
    pendingOpen = null;
    return openNow(pending.payload, pending.helpers);
  }

  function cancelPendingOpen() {
    pendingOpen = null;
  }

  global.PocketNodePopoutWindow = Object.freeze({
    open: open,
    hasUnsavedChanges: function () {
      return hasUnsavedChanges(editorWindow);
    },
    resumePendingOpen: resumePendingOpen,
    cancelPendingOpen: cancelPendingOpen
  });
})(window);
