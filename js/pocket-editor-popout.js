/* Editor popout: gives the detail editor proper writing room outside the sidebar window. */

(function initialisePocketEditorPopout(global) {
  "use strict";

  let editorWindow = null;
  const DRAFT_KEY_PREFIX = "pocket.editorPopoutDraft.v1.";

  function draftKeyFor(nodeId) {
    return `${DRAFT_KEY_PREFIX}${cleanText(nodeId, 80) || "unknown"}`;
  }

  function currentPayload() {
    const id = cleanText(global.state?.detailsEdit?.id, 80);
    const node = id && typeof nodeMap === "function" ? nodeMap().get(id) : null;
    return {
      id,
      title: el.detailEditorLabel instanceof HTMLInputElement ? el.detailEditorLabel.value : cleanText(node?.label, 220),
      body: el.detailEditorBody instanceof HTMLTextAreaElement ? el.detailEditorBody.value : normaliseDetails(node?.details, 4000),
      path: el.detailEditorPath instanceof HTMLElement ? el.detailEditorPath.textContent : "",
      openedAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };
  }

  function readStoredDraft(nodeId) {
    try {
      const raw = global.localStorage.getItem(draftKeyFor(nodeId));
      if (!raw) return null;
      const parsed = JSON.parse(raw);
      if (!parsed || typeof parsed !== "object") return null;
      if (cleanText(parsed.id, 80) !== cleanText(nodeId, 80)) return null;
      return parsed;
    } catch (_error) {
      return null;
    }
  }

  function clearStoredDraft(nodeId) {
    try {
      global.localStorage.removeItem(draftKeyFor(nodeId));
    } catch (_error) {}
  }

  function htmlEscape(value) {
    return String(value || "").replace(/[&<>"]/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[ch]));
  }

  function popoutHtml(payload) {
    const storedDraft = readStoredDraft(payload.id);
    const draftPayload = storedDraft && storedDraft.dirty ? { ...payload, ...storedDraft } : payload;
    const safeTitle = htmlEscape(draftPayload.title || "item");
    const safePath = htmlEscape(payload.path || "");
    const safeBody = htmlEscape(draftPayload.body || "");
    const payloadId = JSON.stringify(payload.id || "");
    const draftKey = JSON.stringify(draftKeyFor(payload.id));
    const initialDraft = JSON.stringify({
      id: payload.id || "",
      title: draftPayload.title || "",
      body: draftPayload.body || "",
      path: payload.path || "",
      openedAt: payload.openedAt || new Date().toISOString(),
      updatedAt: draftPayload.updatedAt || payload.updatedAt || new Date().toISOString(),
      dirty: !!storedDraft?.dirty
    });
    return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>pocket editor</title>
<style>
  :root { color-scheme: light; }
  * { box-sizing: border-box; }
  html, body { height: 100%; }
  body {
    margin: 0;
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Arial, sans-serif;
    background: #f9faf8;
    color: rgba(20,25,30,.95);
    overflow: hidden;
  }
  .wrap {
    height: 100vh;
    display: grid;
    grid-template-rows: auto auto minmax(0,1fr);
  }
  .topbar {
    display: flex;
    align-items: center;
    gap: 8px;
    min-height: 38px;
    padding: 4px 10px;
    border-bottom: 1px solid rgba(119,127,140,.17);
    background: rgba(249,250,248,.98);
  }
  .brand {
    font-size: 14px;
    font-weight: 650;
    color: rgba(62,71,83,.76);
    margin-right: 4px;
    white-space: nowrap;
  }
  .grow { flex: 1 1 auto; }
  button {
    border: 1px solid rgba(148,163,184,.32);
    border-radius: 999px;
    min-height: 28px;
    padding: 0 12px;
    background: rgba(255,255,255,.96);
    color: rgba(20,25,30,.9);
    cursor: pointer;
    font: inherit;
    font-size: 12px;
  }
  button:hover { background: white; }
  button.danger { color: rgba(127,29,29,.88); }
  .hint { color: rgba(62,71,83,.62); font-size: 12px; white-space: nowrap; }
  .dirtyDot { color: rgba(37,99,235,.85); opacity: 0; transition: opacity .12s ease; }
  body.isDirty .dirtyDot { opacity: 1; }
  .meta { padding: 10px 14px 4px; }
  .title { font-size: 13px; font-weight: 650; color: rgba(62,71,83,.78); display: flex; gap: 6px; align-items: center; }
  .path { font-size: 12px; color: rgba(62,71,83,.68); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .fields {
    min-height: 0;
    padding: 8px 14px 14px;
    display: grid;
    grid-template-rows: auto minmax(0,1fr);
    gap: 10px;
  }
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
  textarea { min-height: 0; height: 100%; resize: none; padding: 14px; font: inherit; font-size: 16px; line-height: 1.5; }
</style>
</head>
<body>
  <main class="wrap">
    <div class="topbar">
      <div class="brand">pocket editor</div>
      <button id="saveBtn" type="button">save</button>
      <button id="discardBtn" class="danger" type="button">discard</button>
      <button id="closeBtn" type="button">close</button>
      <div class="grow"></div>
      <div class="hint">Ctrl/Cmd+Enter saves</div>
    </div>
    <div class="meta">
      <div class="title">editing <span class="dirtyDot">*</span></div>
      <div class="path" title="${safePath}">${safePath}</div>
    </div>
    <div class="fields">
      <input id="titleInput" value="${safeTitle}" aria-label="Item name">
      <textarea id="bodyInput" aria-label="Item details">${safeBody}</textarea>
    </div>
  </main>
<script>
  const DRAFT_KEY = ${draftKey};
  let draft = ${initialDraft};
  let dirty = !!draft.dirty;
  let saveInFlight = false;
  let allowedToClose = false;
  const titleInput = document.getElementById("titleInput");
  const bodyInput = document.getElementById("bodyInput");

  function setDirty(next) {
    dirty = !!next;
    draft.dirty = dirty;
    document.body.classList.toggle("isDirty", dirty);
  }

  function buildDraft() {
    return {
      id: ${payloadId},
      title: titleInput.value,
      body: bodyInput.value,
      openedAt: draft.openedAt || new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      dirty
    };
  }

  function storeDraft() {
    try {
      draft = buildDraft();
      window.localStorage.setItem(DRAFT_KEY, JSON.stringify(draft));
    } catch (_error) {}
  }

  function clearDraft() {
    try { window.localStorage.removeItem(DRAFT_KEY); } catch (_error) {}
  }

  [titleInput, bodyInput].forEach((el) => el.addEventListener("input", () => {
    setDirty(true);
    storeDraft();
  }));

  function buildPayload() {
    return {
      type: "pocketEditorPopout:save",
      payload: {
        id: ${payloadId},
        title: titleInput.value,
        body: bodyInput.value,
        updatedAt: new Date().toISOString()
      }
    };
  }

  function save() {
    if (!window.opener || window.opener.closed) {
      alert("Pocket is not connected. This draft is still stored in this browser window.");
      storeDraft();
      return;
    }
    saveInFlight = true;
    storeDraft();
    window.opener.postMessage(buildPayload(), window.location.origin);
  }

  function closeSafely() {
    if (!dirty) {
      allowedToClose = true;
      window.close();
      return;
    }
    const shouldSave = confirm("Save changes before closing?");
    if (shouldSave) {
      save();
      return;
    }
    const shouldDiscard = confirm("Discard this popout draft?");
    if (shouldDiscard) {
      clearDraft();
      allowedToClose = true;
      window.close();
    }
  }

  document.getElementById("saveBtn").addEventListener("click", save);
  document.getElementById("discardBtn").addEventListener("click", () => {
    if (!dirty || confirm("Discard this popout draft?")) {
      clearDraft();
      allowedToClose = true;
      window.close();
    }
  });
  document.getElementById("closeBtn").addEventListener("click", closeSafely);
  document.addEventListener("keydown", (ev) => {
    if (ev.key === "Escape") { ev.preventDefault(); closeSafely(); }
    if (ev.key === "Enter" && (ev.metaKey || ev.ctrlKey)) { ev.preventDefault(); save(); }
  });
  window.addEventListener("message", (ev) => {
    if (ev.origin !== window.location.origin) return;
    if (!ev.data || ev.data.type !== "pocketEditorPopout:saved") return;
    saveInFlight = false;
    setDirty(false);
    clearDraft();
    allowedToClose = true;
    window.close();
  });
  window.addEventListener("beforeunload", (ev) => {
    if (!dirty || allowedToClose) return;
    storeDraft();
    ev.preventDefault();
    ev.returnValue = "Unsaved editor changes.";
  });
  setDirty(dirty);
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
    clearStoredDraft(payload.id);
    saveDetailsEditor();
    return true;
  }

  function notifyPopoutSaved() {
    try {
      if (editorWindow && !editorWindow.closed) {
        editorWindow.postMessage({ type: "pocketEditorPopout:saved" }, global.location.origin);
      }
    } catch {}
  }

  function openEditorPopout() {
    if (!isDetailsEditorOpen()) {
      openDetailsEditorForSelectedNode();
      if (!isDetailsEditorOpen()) return false;
    }
    const payload = currentPayload();
    const storedDraft = readStoredDraft(payload.id);
    if (storedDraft?.dirty) {
      setStatus("Recovered popout draft for this item.", "ok", { durationMs: 4200 });
    }
    const width = Math.min(820, Math.max(600, Math.round(global.screen.availWidth * 0.5)));
    const height = Math.min(820, Math.max(600, Math.round(global.screen.availHeight * 0.76)));
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

  function handlePopoutMessage(ev) {
    if (ev.origin !== global.location.origin) return;
    if (!ev.data || ev.data.type !== "pocketEditorPopout:save") return;
    const ok = applyPopoutEdit(ev.data.payload);
    if (ok) notifyPopoutSaved();
  }

  function init() {
    const button = document.getElementById("btnDetailPopout");
    if (button) button.addEventListener("click", openEditorPopout);
    global.addEventListener("message", handlePopoutMessage);
  }

  global.PocketEditorPopout = Object.freeze({ open: openEditorPopout, apply: applyPopoutEdit });
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init, { once: true });
  else init();
})(window);
