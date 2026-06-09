/* Popup window orchestration for the standalone node popout editor. */
(function initialisePocketNodePopoutWindow(global) {
  "use strict";

  let editorWindow = null;

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

  function open(payload, helpers) {
    helpers = helpers || {};
    const width = Math.min(820, Math.max(600, Math.round(global.screen.availWidth * 0.5)));
    const height = Math.min(820, Math.max(600, Math.round(global.screen.availHeight * 0.76)));
    const left = Math.round((global.screen.availWidth - width) / 2);
    const top = Math.round((global.screen.availHeight - height) / 2);
    editorWindow = global.open("", "pocketNodePopoutEditor", `popup=yes,width=${width},height=${height},left=${left},top=${top}`);
    if (!editorWindow) {
      setBlockedPopupStatus(helpers);
      return false;
    }
    editorWindow.document.open();
    editorWindow.document.write(editorHtml(payload, helpers));
    editorWindow.document.close();
    editorWindow.focus();
    return true;
  }

  global.PocketNodePopoutWindow = Object.freeze({ open: open });
})(window);
