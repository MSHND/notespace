/* Generated document shell for the unified standalone node popout editor. */
(function initialisePocketNodePopoutTemplate(global) {
  "use strict";
  function fallbackHtmlEscape(value) {
    return String(value || "").replace(/[&<>\"]/g, function (ch) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;" }[ch]; });
  }
  function safeAsset(value, label) {
    if (!/^\/(?!\/)[A-Za-z0-9._/-]+\.js$/.test(value || "")) throw new Error(`PocketNodePopoutTemplate.render requires a same-origin ${label} asset.`);
    return value;
  }
  function render(payload, helpers) {
    helpers = helpers || {};
    const htmlEscape = typeof helpers.htmlEscape === "function" ? helpers.htmlEscape : fallbackHtmlEscape;
    const contentAssetUrl = safeAsset(helpers.contentAssetUrl, "content");
    const runtimeAssetUrl = safeAsset(helpers.runtimeAssetUrl, "runtime");
    const contract = global.PocketNodeContent;
    if (!contract || typeof contract.parseLines !== "function") throw new Error("PocketNodeContent is not loaded.");
    const payloadJson = JSON.stringify(payload).replace(/</g, "\\u003c");
    const safeTitle = htmlEscape(payload.title || "Untitled");
    const safePath = htmlEscape(payload.path || "");
    const readOnly = payload.readOnly === true;
    const readOnlyMessage = htmlEscape(payload.readOnlyMessage || "This item uses editor data that this version of Pocket can’t safely edit. Its readable text is shown below, and nothing will be changed.");
    const disabled = readOnly ? " disabled" : "";
    const lines = contract.parseLines(typeof payload.text === "string" ? payload.text : (payload.body || ""));
    const lineHtml = lines.map(function (line, index) {
      const branch = contract.hasChildren(lines, index);
      const text = htmlEscape(line.content);
      return `<div class="docRow" data-line-id="line_${index}" data-depth="${line.depth}" style="--depth:${line.depth}"><button class="lineGutter${branch ? " branch" : " empty"}" type="button" data-line-id="line_${index}" aria-label="${branch ? "Collapse branch" : "Line"}"${readOnly && !branch ? " disabled" : ""}>${branch ? "▾" : ""}</button><div class="lineText" data-line-id="line_${index}" contenteditable="${readOnly ? "false" : "true"}" spellcheck="true">${text}</div></div>`;
    }).join("");
    return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>pocket editor</title>
<style>
*{box-sizing:border-box}html,body{height:100%}body{margin:0;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Arial,sans-serif;background:#fbfbf8;color:rgba(15,23,42,.94);overflow:hidden}.wrap{height:100vh;display:grid;grid-template-rows:auto auto minmax(0,1fr)}.topbar{display:flex;align-items:center;gap:7px;min-height:44px;padding:6px 10px;border-bottom:1px solid rgba(148,163,184,.18);background:rgba(251,251,248,.98)}.identity,.actions{display:inline-flex;align-items:center;gap:6px}.brand{font-size:13px;font-weight:650;color:rgba(51,65,85,.72);white-space:nowrap}.dirty{opacity:0;display:inline-block;width:6px;height:6px;margin-left:4px;border-radius:999px;background:rgba(37,99,235,.72)}body.isDirty .dirty{opacity:1}.toolbarBtn,#closeBtn{border:1px solid rgba(148,163,184,.28);border-radius:999px;background:#fff;color:rgba(20,25,30,.95);height:28px;padding:0 12px;font:inherit;font-size:12px;cursor:pointer}.toolbarBtn:disabled{opacity:.48;cursor:not-allowed}#closeBtn{width:30px;padding:0;font-size:20px}.status{font-size:11px;color:rgba(100,116,139,.62);white-space:nowrap}.status.failed{color:rgba(127,29,29,.82)}.status.saved{color:rgba(22,101,52,.72)}.grow{flex:1}.hint{font-size:11px;color:rgba(100,116,139,.58)}.meta{padding:10px 14px 3px}.readOnlyBanner{margin-bottom:9px;padding:8px 10px;border:1px solid rgba(100,116,139,.2);border-radius:10px;background:rgba(241,245,249,.72);font-size:12px}.titleLine{font-size:12px;font-weight:650;color:rgba(71,85,105,.72)}.path{margin-top:1px;font-size:11px;color:rgba(100,116,139,.58);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.fields{min-height:0;padding:8px 14px 14px;display:grid;grid-template-rows:auto minmax(0,1fr);gap:10px}#titleInput,#outlinePane{width:100%;border:1px solid rgba(148,163,184,.18);border-radius:15px;background:rgba(255,255,255,.96);color:rgba(15,23,42,.94);outline:none}#titleInput{min-height:42px;padding:9px 11px;font-size:17px;font-weight:560}.documentPane{min-height:0;height:100%;overflow:auto;padding:10px 8px}.docRow{display:grid;grid-template-columns:20px minmax(0,1fr);align-items:start;gap:4px;min-height:30px;padding:2px 4px 2px calc(4px + (var(--depth) * 22px));border-radius:8px}.docRow:focus-within{background:rgba(241,245,249,.72)}.lineGutter{width:20px;min-height:25px;border:0;border-radius:8px;background:transparent;color:rgba(100,116,139,.72);cursor:grab}.lineGutter.empty{color:transparent;cursor:default}.lineText{min-height:26px;padding:3px 6px;border-radius:7px;outline:none;font-size:16px;line-height:1.45;white-space:pre-wrap;overflow-wrap:anywhere}.lineText:empty::before{content:""}.lineText[contenteditable="false"]{cursor:text;user-select:text}.unsavedDialog{position:fixed;inset:0;display:grid;place-items:center;padding:18px;background:rgba(15,23,42,.22);z-index:10}.unsavedDialog[hidden]{display:none}.unsavedPanel{width:min(320px,100%);border-radius:15px;background:#fff;padding:12px}.unsavedActions{display:grid;gap:6px}.unsavedActions button{min-height:34px;border:0;border-radius:10px;background:rgba(241,245,249,.75);text-align:left;padding:7px 10px}.unsavedActions .primary{background:rgba(37,99,235,.1);color:rgba(30,64,175,.94)}
</style></head>
<body${readOnly ? ' class="readOnly"' : ''}><main class="wrap"><div class="topbar"><div class="identity"><div class="brand">pocket editor <span class="dirty">*</span></div><span id="saveState" class="status" aria-live="polite"></span></div><div class="actions"><button id="saveBtn" class="toolbarBtn" type="button"${disabled}>save</button><button id="saveCloseBtn" class="toolbarBtn" type="button"${disabled}>save &amp; close</button></div><div class="grow"></div><div class="hint">Tab indents · branch arrows fold · Cmd/Ctrl+S saves</div><button id="closeBtn" type="button" aria-label="Close editor">×</button></div><div class="meta">${readOnly ? `<div class="readOnlyBanner" role="status">${readOnlyMessage}</div>` : ""}<div class="titleLine">${readOnly ? "viewing" : "editing"}</div><div class="path" title="${safePath}">${safePath}</div></div><div class="fields"><input id="titleInput" value="${safeTitle}" aria-label="Item name"${readOnly ? ' readonly aria-readonly="true"' : ''}><div id="outlinePane" class="documentPane" aria-label="Document">${lineHtml}</div></div></main><div id="unsavedDialog" class="unsavedDialog" role="dialog" aria-modal="true" aria-label="Unsaved changes" hidden><div class="unsavedPanel"><div class="unsavedActions"><button id="unsavedSaveBtn" class="primary" type="button">Save &amp; close</button><button id="unsavedDiscardBtn" type="button">Exit without saving</button><button id="unsavedCancelBtn" type="button">Go back to editing</button></div></div></div><textarea id="pocketNodePopoutPayload" hidden aria-hidden="true">${htmlEscape(payloadJson)}</textarea><script src="${contentAssetUrl}"></script><script src="${runtimeAssetUrl}"></script></body></html>`;
  }
  global.PocketNodePopoutTemplate = Object.freeze({ render });
})(window);
