/* Editor popout: gives the detail editor proper writing room outside the sidebar window. */

(function initialisePocketEditorPopout(global) {
  "use strict";

  let editorWindow = null;

  function currentPayload() {
    const id = cleanText(global.state?.detailsEdit?.id, 80);
    const node = id && typeof nodeMap === "function" ? nodeMap().get(id) : null;
    return {
      id,
      title: el.detailEditorLabel instanceof HTMLInputElement ? el.detailEditorLabel.value : cleanText(node?.label, 220),
      body: el.detailEditorBody instanceof HTMLTextAreaElement ? el.detailEditorBody.value : normaliseDetails(node?.details, 4000),
      path: el.detailEditorPath instanceof HTMLElement ? el.detailEditorPath.textContent : "",
      urgent: el.detailEditorUrgent instanceof HTMLInputElement ? !!el.detailEditorUrgent.checked : false,
      copyContext: el.detailEditorCopyContext instanceof HTMLInputElement ? !!el.detailEditorCopyContext.checked : false
    };
  }

  function htmlEscape(value) {
    return String(value || "").replace(/[&<>"]/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[ch]));
  }

  function popoutHtml(payload) {
    const safeTitle = htmlEscape(payload.title || "item");
    const safePath = htmlEscape(payload.path || "");
    const safeBody = htmlEscape(payload.body || "");
    return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>pocket editor</title>
<style>
  :root { color-scheme: light; }
  * { box-sizing: border-box; }
  body {
    margin: 0;
    min-height: 100vh;
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Arial, sans-serif;
    background: #f9faf8;
    color: rgba(20,25,30,.95);
  }
  .wrap {
    min-height: 100vh;
    padding: 16px;
    display: grid;
    grid-template-rows: auto auto minmax(0,1fr) auto;
    gap: 10px;
  }
  .title { font-size: 13px; font-weight: 650; color: rgba(62,71,83,.78); }
  .path { font-size: 12px; color: rgba(62,71,83,.68); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  input, textarea {
    width: 100%;
    border: 1px solid rgba(119,127,140,.2);
    border-radius: 14px;
    background: rgba(255,255,255,.98);
    color: rgba(20,25,30,.95);
    outline: none;
    box-shadow: 0 8px 20px -18px rgba(17,24,39,.35);
  }
  input { min-height: 42px; padding: 9px 11px; font-size: 17px; font-weight: 550; }
  textarea { min-height: 54vh; resize: vertical; padding: 12px; font: inherit; font-size: 16px; line-height: 1.48; }
  .meta { display: flex; flex-wrap: wrap; gap: 12px; align-items: center; color: rgba(62,71,83,.76); font-size: 13px; }
  label { display: inline-flex; align-items: center; gap: 6px; }
  .buttons { display: flex; justify-content: flex-end; gap: 8px; }
  button {
    border: 1px solid rgba(148,163,184,.32);
    border-radius: 999px;
    min-height: 32px;
    padding: 0 14px;
    background: rgba(255,255,255,.96);
    color: rgba(20,25,30,.9);
    cursor: pointer;
    font: inherit;
    font-size: 13px;
  }
  button:hover { background: white; }
  .hint { margin-right: auto; align-self: center; color: rgba(62,71,83,.62); font-size: 12px; }
</style>
</head>
<body>
  <main class="wrap">
    <div>
      <div class="title">pocket editor</div>
      <div class="path" title="${safePath}">${safePath}</div>
    </div>
    <input id="titleInput" value="${safeTitle}" aria-label="Item name">
    <textarea id="bodyInput" aria-label="Item details">${safeBody}</textarea>
    <div class="meta">
      <label><input id="urgentInput" type="checkbox" ${payload.urgent ? "checked" : ""}> urgent</label>
      <label><input id="copyContextInput" type="checkbox" ${payload.copyContext ? "checked" : ""}> copy context</label>
    </div>
    <div class="buttons">
      <span class="hint">Ctrl/Cmd+Enter saves</span>
      <button id="cancelBtn" type="button">cancel</button>
      <button id="saveBtn" type="button">save</button>
    </div>
  </main>
<script>
  let dirty = false;
  const titleInput = document.getElementById("titleInput");
  const bodyInput = document.getElementById("bodyInput");
  const urgentInput = document.getElementById("urgentInput");
  const copyContextInput = document.getElementById("copyContextInput");
  [titleInput, bodyInput, urgentInput, copyContextInput].forEach((el) => el.addEventListener("input", () => dirty = true));
  function payload() {
    return {
      id: ${JSON.stringify(payload.id)},
      title: titleInput.value,
      body: bodyInput.value,
      urgent: urgentInput.checked,
      copyContext: copyContextInput.checked
    };
  }
  function save() {
    if (!window.opener || !window.opener.PocketEditorPopout) return;
    const ok = window.opener.PocketEditorPopout.apply(payload());
    if (ok) { dirty = false; window.close(); }
  }
  document.getElementById("saveBtn").addEventListener("click", save);
  document.getElementById("cancelBtn").addEventListener("click", () => window.close());
  document.addEventListener("keydown", (ev) => {
    if (ev.key === "Escape") window.close();
    if (ev.key === "Enter" && (ev.metaKey || ev.ctrlKey)) { ev.preventDefault(); save(); }
  });
  window.addEventListener("beforeunload", (ev) => {
    if (!dirty) return;
    ev.preventDefault();
    ev.returnValue = "Unsaved editor changes.";
  });
  titleInput.focus();
  titleInput.select();
</script>
</body>
</html>`;
  }

  function applyPopoutEdit(payload) {
    if (!payload || payload.id !== cleanText(state.detailsEdit?.id, 80)) {
      setStatus("Editor popout no longer matches the open item.", "warn");
      return false;
    }
    if (el.detailEditorLabel instanceof HTMLInputElement) el.detailEditorLabel.value = cleanText(payload.title, 220);
    if (el.detailEditorBody instanceof HTMLTextAreaElement) el.detailEditorBody.value = String(payload.body || "");
    if (el.detailEditorUrgent instanceof HTMLInputElement) el.detailEditorUrgent.checked = !!payload.urgent;
    if (el.detailEditorCopyContext instanceof HTMLInputElement) el.detailEditorCopyContext.checked = !!payload.copyContext;
    saveDetailsEditor();
    return true;
  }

  function openEditorPopout() {
    if (!isDetailsEditorOpen()) {
      openDetailsEditorForSelectedNode();
      if (!isDetailsEditorOpen()) return false;
    }
    const payload = currentPayload();
    const width = Math.min(760, Math.max(560, Math.round(global.screen.availWidth * 0.46)));
    const height = Math.min(760, Math.max(560, Math.round(global.screen.availHeight * 0.72)));
    const left = Math.round((global.screen.availWidth - width) / 2);
    const top = Math.round((global.screen.availHeight - height) / 2);
    editorWindow = global.open("", "pocketEditorPopout", `popup=yes,width=${width},height=${height},left=${left},top=${top}`);
    if (!editorWindow) {
      setStatus("Popout blocked. Allow popups for pocket, then try again.", "warn", { durationMs: 5200 });
      return false;
    }
    editorWindow.document.open();
    editorWindow.document.write(popoutHtml(payload));
    editorWindow.document.close();
    editorWindow.focus();
    return true;
  }

  function init() {
    const button = document.getElementById("btnDetailPopout");
    if (button) button.addEventListener("click", openEditorPopout);
  }

  global.PocketEditorPopout = Object.freeze({ open: openEditorPopout, apply: applyPopoutEdit });
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init, { once: true });
  else init();
})(window);
