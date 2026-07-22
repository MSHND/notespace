/* Generated document shell for the standalone node popout editor. */
(function initialisePocketNodePopoutTemplate(global) {
  "use strict";

  function fallbackHtmlEscape(value) {
    return String(value || "").replace(/[&<>\"]/g, function (ch) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;" }[ch];
    });
  }

  function render(payload, helpers) {
    helpers = helpers || {};
    const htmlEscape = typeof helpers.htmlEscape === "function" ? helpers.htmlEscape : fallbackHtmlEscape;
    const runtimeScript = String(helpers.runtimeScript || "");
    if (!runtimeScript) throw new Error("PocketNodePopoutTemplate.render requires a runtime script.");

    const safeTitle = htmlEscape(payload.title || "Untitled");
    const safePath = htmlEscape(payload.path || "");
    const safeBody = htmlEscape(payload.body || "");
    const readOnly = payload.readOnly === true;
    const readOnlyMessage = htmlEscape(
      payload.readOnlyMessage
      || "This item uses editor data that this version of Pocket can’t safely edit. Its readable text is shown below, and nothing will be changed."
    );
    const readOnlyBanner = readOnly
      ? `<div id="readOnlyBanner" class="readOnlyBanner" role="status">${readOnlyMessage}</div>`
      : "";
    const readOnlyFieldAttributes = readOnly
      ? ` readonly aria-readonly="true" aria-describedby="readOnlyBanner"`
      : "";
    const disabledEditorControl = readOnly ? " disabled" : "";
    const toolbarHint = readOnly ? "Read only · select text to copy" : "Tab indents branch · Cmd/Ctrl+S saves";
    const bodyClass = readOnly ? "textMode readOnly" : "textMode";

    return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>pocket editor</title>
<style>
  :root { --pe-chip-shadow: 0 1px 2px rgba(15, 23, 42, .045); --pe-focus-ring: 0 0 0 2px rgba(37, 99, 235, .14); }
  * { box-sizing: border-box; }
  html, body { height: 100%; }
  body { margin: 0; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Arial, sans-serif; background: #fbfbf8; color: rgba(15, 23, 42, .94); overflow: hidden; }
  .wrap { height: 100vh; display: grid; grid-template-rows: auto auto minmax(0, 1fr); }
  .topbar { display: flex; align-items: center; gap: 7px; min-height: 44px; padding: 6px 10px; border-bottom: 1px solid rgba(148, 163, 184, .18); background: rgba(251, 251, 248, .98); }
  .toolbarGroup { display: inline-flex; align-items: center; gap: 6px; min-height: 28px; padding: 0; border: 0; border-radius: 0; background: transparent; }
  .toolbarGroup.identity { min-width: 0; gap: 8px; padding: 3px 8px; border-color: transparent; background: transparent; }
  .toolbarGroup.actions { gap: 6px; }
  .brand { font-size: 13px; font-weight: 650; color: rgba(51, 65, 85, .72); white-space: nowrap; }
  button { border: 0; border-radius: 9px; background: transparent; padding: 4px 8px; min-height: 26px; color: rgba(51, 65, 85, .82); cursor: pointer; font: inherit; font-size: 12px; font-weight: 620; }
  button:hover, button:focus-visible { color: rgba(15, 23, 42, .98); outline: none; background: rgba(148, 163, 184, .12); }
  button:focus-visible { box-shadow: var(--pe-focus-ring); }
  .toolbarBtn, .mode button { border: 1px solid rgba(148, 163, 184, .28); border-radius: 999px; background: rgba(255, 255, 255, .98); color: rgba(20, 25, 30, .95); height: 28px; min-height: 28px; padding: 0 12px; line-height: 1; white-space: nowrap; box-shadow: var(--pe-chip-shadow); display: inline-flex; align-items: center; justify-content: center; font-weight: 500; }
  .toolbarBtn:hover, .mode button:hover { background: rgba(255, 255, 255, 1); border-color: rgba(116, 124, 136, .26); color: rgba(13, 17, 22, .99); outline: none; box-shadow: var(--pe-chip-shadow); }
  .toolbarBtn:focus-visible, .mode button:focus-visible { background: rgba(255, 255, 255, 1); border-color: rgba(116, 124, 136, .26); color: rgba(13, 17, 22, .99); outline: none; box-shadow: var(--pe-focus-ring), var(--pe-chip-shadow); }
  button:disabled, button:disabled:hover, button:disabled:focus-visible { cursor: not-allowed; opacity: .48; color: rgba(100, 116, 139, .7); background: rgba(248, 250, 252, .82); border-color: rgba(148, 163, 184, .2); box-shadow: none; }
  #closeBtn { width: 30px; min-height: 30px; padding: 0; border: 1px solid rgba(148, 163, 184, .28); border-radius: 999px; background: rgba(255, 255, 255, .9); color: rgba(15, 23, 42, .82); font-size: 20px; line-height: 1; box-shadow: 0 8px 18px -16px rgba(15, 23, 42, .65); }
  #closeBtn:hover, #closeBtn:focus-visible { border-color: rgba(71, 85, 105, .36); background: rgba(241, 245, 249, .96); color: rgba(15, 23, 42, .98); }
  .mode button.on { color: rgba(29, 78, 216, .88); background: rgba(37, 99, 235, .1); border-color: rgba(37, 99, 235, .3); font-style: normal; }
  .status { display: inline-flex; align-items: center; min-width: 58px; min-height: 20px; color: rgba(100, 116, 139, .62); font-size: 11px; white-space: nowrap; }
  .status.failed { color: rgba(127, 29, 29, .82); }
  .status.saved { color: rgba(22, 101, 52, .72); }
  .grow { flex: 1 1 auto; }
  .toolbarHint { color: rgba(100, 116, 139, .58); font-size: 11px; white-space: nowrap; padding: 0 4px; }
  .dirty { opacity: 0; display: inline-block; width: 6px; height: 6px; margin-left: 4px; border-radius: 999px; background: rgba(37, 99, 235, .72); color: transparent; overflow: hidden; transform: translateY(-1px); }
  body.isDirty .dirty { opacity: 1; }
  .meta { padding: 10px 14px 3px; min-width: 0; }
  .readOnlyBanner { margin-bottom: 9px; padding: 8px 10px; border: 1px solid rgba(100, 116, 139, .2); border-radius: 10px; background: rgba(241, 245, 249, .72); color: rgba(51, 65, 85, .82); font-size: 12px; line-height: 1.42; }
  .titleLine { font-size: 12px; font-weight: 650; color: rgba(71, 85, 105, .72); }
  .path { margin-top: 1px; font-size: 11px; color: rgba(100, 116, 139, .58); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .fields { min-height: 0; padding: 8px 14px 14px; display: grid; grid-template-rows: auto minmax(0, 1fr); gap: 10px; }
  input, textarea, .outlinePane { width: 100%; border: 1px solid rgba(148, 163, 184, .18); border-radius: 15px; background: rgba(255, 255, 255, .96); color: rgba(15, 23, 42, .94); outline: none; box-shadow: 0 10px 24px -22px rgba(15, 23, 42, .38); }
  input { min-height: 42px; padding: 9px 11px; font-size: 17px; font-weight: 560; }
  textarea { min-height: 0; height: 100%; resize: none; padding: 14px; font: inherit; font-size: 16px; line-height: 1.52; }
  body.readOnly input, body.readOnly textarea { cursor: text; user-select: text; background: rgba(248, 250, 252, .88); }
  .outlinePane { min-height: 0; height: 100%; overflow: auto; padding: 10px 8px; }
  .outlineRow { display: grid; grid-template-columns: 18px 20px minmax(0, 1fr); align-items: start; gap: 4px; min-height: 30px; padding: 2px 4px; border-radius: 9px; transition: background-color 120ms ease; }
  .outlineRow:focus-within { background: rgba(241, 245, 249, .72); }
  .outlineRow.isOutlineSelected { background: rgba(37, 99, 235, .08); }
  .outlineRow.isOutlineSelected:focus-within { background: rgba(37, 99, 235, .11); }
  .outlineSelect { width: 18px; min-height: 24px; padding: 0; border-radius: 8px; display: inline-flex; align-items: center; justify-content: center; }
  .outlineSelect::before { content: ""; width: 8px; height: 8px; border: 1px solid rgba(100, 116, 139, .42); border-radius: 999px; background: rgba(255, 255, 255, .85); box-shadow: 0 1px 2px rgba(15, 23, 42, .06); }
  .outlineSelect:hover::before, .outlineSelect:focus-visible::before { border-color: rgba(37, 99, 235, .46); background: rgba(239, 246, 255, .9); }
  .outlineSelect.on::before { border-color: rgba(37, 99, 235, .72); background: rgba(37, 99, 235, .72); }
  .outlineToggle { width: 20px; min-height: 24px; border-radius: 9px; color: rgba(100, 116, 139, .7); cursor: pointer; }
  .outlineToggle.empty { opacity: .35; }
  .outlineText { min-height: 26px; padding: 3px 6px; border-radius: 8px; outline: none; font-size: 16px; line-height: 1.45; white-space: pre-wrap; overflow-wrap: anywhere; caret-color: rgba(37, 99, 235, .86); }
  .outlineSelect:focus-visible, .outlineToggle:focus-visible, .outlineText:focus-visible { box-shadow: var(--pe-focus-ring); }
  .outlineText:empty::before { content: "note"; color: rgba(100, 116, 139, .34); }
  .outlineContextMenu { position: fixed; z-index: 9; display: grid; gap: 2px; min-width: 176px; padding: 4px; border: 1px solid rgba(148, 163, 184, .3); border-radius: 8px; background: rgba(255, 255, 255, .99); box-shadow: 0 18px 42px -24px rgba(15, 23, 42, .58); }
  .outlineContextMenu[hidden] { display: none; }
  .outlineContextMenu button { width: 100%; min-height: 30px; padding: 5px 9px; border-radius: 6px; text-align: left; font-size: 12px; font-weight: 560; }
  .outlineContextMenu button[data-outline-action="delete"] { color: rgba(153, 27, 27, .86); }
  .outlineContextMenu button[data-outline-action="delete"]:hover, .outlineContextMenu button[data-outline-action="delete"]:focus-visible { color: rgba(127, 29, 29, .98); background: rgba(254, 226, 226, .62); }
  body.textMode .outlinePane, body.textMode .outlineOnly { display: none; }
  body.outlineMode textarea { display: none; }
  .unsavedDialog { position: fixed; inset: 0; display: grid; place-items: center; padding: 18px; background: rgba(15, 23, 42, .22); z-index: 10; }
  .unsavedDialog[hidden] { display: none; }
  .unsavedPanel { width: min(320px, 100%); border: 1px solid rgba(148, 163, 184, .22); border-radius: 15px; background: rgba(255, 255, 255, .98); box-shadow: 0 24px 70px -34px rgba(15, 23, 42, .6); padding: 12px; }
  .unsavedActions { display: grid; gap: 6px; }
  .unsavedActions button { width: 100%; min-height: 34px; border-radius: 10px; background: rgba(241, 245, 249, .75); text-align: left; padding: 7px 10px; }
  .unsavedActions button.primary { background: rgba(37, 99, 235, .1); color: rgba(30, 64, 175, .94); }
</style>
</head>
<body class="${bodyClass}">
  <main class="wrap">
    <div class="topbar"><div class="toolbarGroup identity"><div class="brand">pocket editor <span class="dirty">*</span></div><span id="saveState" class="status" aria-live="polite"></span></div><div class="toolbarGroup actions" aria-label="Save actions"><button id="saveBtn" class="toolbarBtn" type="button"${disabledEditorControl}>save</button><button id="saveCloseBtn" class="toolbarBtn" type="button"${disabledEditorControl}>save &amp; close</button></div><div class="toolbarGroup mode" aria-label="Editor mode"><button id="textModeBtn" type="button"${disabledEditorControl}>text</button><button id="outlineModeBtn" type="button"${disabledEditorControl}>outline</button></div><div class="grow"></div><div class="toolbarHint">${toolbarHint}</div><button id="closeBtn" type="button" aria-label="Close editor">×</button></div>
    <div class="meta">${readOnlyBanner}<div class="titleLine">${readOnly ? "viewing" : "editing"}</div><div class="path" title="${safePath}">${safePath}</div></div>
    <div class="fields"><input id="titleInput" value="${safeTitle}" aria-label="Item name"${readOnlyFieldAttributes}><textarea id="bodyInput" aria-label="Item details"${readOnlyFieldAttributes}>${safeBody}</textarea><div id="outlinePane" class="outlinePane" aria-label="Item outline"></div></div>
  </main>
  <div id="outlineContextMenu" class="outlineContextMenu" role="menu" aria-label="Outline selection actions" hidden>
    <button type="button" role="menuitem" data-outline-action="copy">Copy</button>
    <button type="button" role="menuitem" data-outline-action="paste">Paste after selection</button>
    <button type="button" role="menuitem" data-outline-action="duplicate">Duplicate</button>
    <button type="button" role="menuitem" data-outline-action="delete">Delete</button>
  </div>
  <div id="unsavedDialog" class="unsavedDialog" role="dialog" aria-modal="true" aria-label="Unsaved changes" hidden>
    <div class="unsavedPanel">
      <div class="unsavedActions">
        <button id="unsavedSaveBtn" class="primary" type="button">Save &amp; close</button>
        <button id="unsavedDiscardBtn" type="button">Exit without saving</button>
        <button id="unsavedCancelBtn" type="button">Go back to editing</button>
      </div>
    </div>
  </div>
<script>
${runtimeScript}
</script>
</body>
</html>`;
  }

  global.PocketNodePopoutTemplate = Object.freeze({ render: render });
})(window);
