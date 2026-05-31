/* Standalone item details route.
   Enter opens a simple item details editor for the selected node. The editor stores
   data in node.pe and does not read/write the old inline details editor fields. */
(function initialisePocketPeRoute(global) {
  "use strict";

  const PE_SCHEMA = "pocket.pe.v1";

  function clean(value, max = 80) {
    return typeof cleanText === "function" ? cleanText(value, max) : String(value || "").trim().slice(0, max);
  }

  function escapeHtml(value) {
    return String(value || "").replace(/[&<>"]/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;" }[ch]));
  }

  function nodeById(id) {
    return id && typeof nodeMap === "function" ? nodeMap().get(id) || null : null;
  }

  function domSelectedNodeId() {
    const active = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const activeRow = active ? active.closest("[data-node-id]") : null;
    const selectedRow = document.querySelector(".row.selected[data-node-id], .row:focus[data-node-id], [aria-selected='true'][data-node-id]");
    const row = activeRow || selectedRow;
    return row instanceof HTMLElement ? clean(row.getAttribute("data-node-id"), 80) : "";
  }

  function nodeIdFromEvent(ev) {
    const target = ev?.target instanceof HTMLElement ? ev.target : null;
    const row = target ? target.closest("[data-node-id]") : null;
    return row instanceof HTMLElement ? clean(row.getAttribute("data-node-id"), 80) : "";
  }

  function selectedNode(preferredId = "") {
    const id = clean(preferredId || global.state?.selectedId || global.state?.detailsEdit?.id || domSelectedNodeId(), 80);
    return nodeById(id);
  }

  function makeOutlineId() {
    return `line_${Math.random().toString(36).slice(2, 9)}`;
  }

  function normaliseOutline(value) {
    const source = Array.isArray(value) ? value : [];
    return source.map((item, index) => ({
      id: clean(item?.id, 80) || makeOutlineId(),
      text: String(item?.text || "").replace(/\r/g, "").slice(0, 1200),
      depth: Math.max(0, Math.min(8, Number(item?.depth) || 0)),
      collapsed: item?.collapsed === true,
      order: Number.isFinite(item?.order) ? item.order : (index + 1) * 1000
    }));
  }

  function pePayloadForNode(node) {
    const pe = node.pe && typeof node.pe === "object" && node.pe.schema === PE_SCHEMA ? node.pe : null;
    const outline = normaliseOutline(pe?.outline);
    return {
      nodeId: clean(node.id, 80),
      title: pe ? clean(pe.title, 220) : clean(node.label, 220),
      mode: pe?.mode === "outline" ? "outline" : "text",
      text: pe ? String(pe.text || "").replace(/\r/g, "").slice(0, 12000) : "",
      outline: outline.length ? outline : [{ id: makeOutlineId(), text: "", depth: 0, collapsed: false, order: 1000 }]
    };
  }

  function getPayload(nodeId) {
    const node = nodeById(clean(nodeId, 80)) || selectedNode();
    return node ? pePayloadForNode(node) : null;
  }

  function applyPe(payload) {
    const id = clean(payload && payload.nodeId, 80);
    const node = nodeById(id);
    if (!node) {
      if (typeof setStatus === "function") setStatus("This item no longer exists.", "warn");
      return false;
    }
    const mode = payload?.mode === "outline" ? "outline" : "text";
    const updatedAt = typeof nowIso === "function" ? nowIso() : new Date().toISOString();
    node.pe = {
      schema: PE_SCHEMA,
      title: clean(payload.title, 220) || clean(node.label, 220),
      mode,
      text: String(payload.text || "").replace(/\r/g, "").slice(0, 12000),
      outline: normaliseOutline(payload.outline),
      updatedAt
    };
    node.updatedAt = updatedAt;
    if (global.state) global.state.selectedId = node.id;
    if (typeof recordOp === "function") recordOp({ type: "pe_edit", id: node.id, path: typeof getPath === "function" ? getPath(node.id) : "", changed: mode === "outline" ? "pe_outline" : "pe_text" });
    if (typeof refreshMeta === "function") refreshMeta();
    if (typeof renderTree === "function") renderTree();
    if (typeof focusRowByNodeId === "function") focusRowByNodeId(node.id, { instant: true });
    if (typeof saveWorkspaceState === "function") saveWorkspaceState();
    if (typeof persistPipSnapshot === "function") persistPipSnapshot();
    if (typeof setStatus === "function") setStatus(`Saved details for "${clean(node.label, 80)}".`, "ok");
    console.info("[item details route] saved", { id: node.id, mode });
    return true;
  }

  function writeEditor(win, payload, nodeLabel) {
    win.document.open();
    win.document.write(`<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>item details</title>
<style>
  * { box-sizing: border-box; }
  html, body { height: 100%; }
  body { margin: 0; font-family: system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; background: #fbfbf8; color: #0f172a; overflow: hidden; }
  main { height: 100vh; display: grid; grid-template-rows: auto minmax(0, 1fr); }
  .bar { display: flex; align-items: center; gap: 10px; padding: 9px 12px; border-bottom: 1px solid rgba(148,163,184,.24); background: rgba(255,255,255,.78); }
  .brand { font-size: 13px; font-weight: 700; color: rgba(51,65,85,.82); max-width: 260px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  button { border: 0; background: transparent; border-radius: 999px; padding: 4px 8px; font: inherit; font-size: 12px; color: rgba(51,65,85,.82); cursor: pointer; }
  button:hover, button:focus-visible, button.active { background: rgba(148,163,184,.16); outline: none; color: #0f172a; }
  .status { min-width: 72px; font-size: 11px; color: rgba(100,116,139,.74); }
  .grow { flex: 1 1 auto; }
  .body { min-height: 0; display: grid; grid-template-rows: auto minmax(0, 1fr); gap: 10px; padding: 14px; }
  input, textarea { width: 100%; border: 1px solid rgba(148,163,184,.22); border-radius: 15px; background: rgba(255,255,255,.96); color: #0f172a; outline: none; box-shadow: 0 10px 24px -22px rgba(15,23,42,.38); }
  input { min-height: 42px; padding: 9px 12px; font-size: 17px; font-weight: 560; }
  textarea { min-height: 0; height: 100%; resize: none; padding: 14px; font: inherit; font-size: 16px; line-height: 1.52; }
  .editorPane { min-height: 0; display: none; }
  .editorPane.active { display: block; }
  #textPane.active { display: grid; }
  #outlinePane { height: 100%; overflow: auto; border: 1px solid rgba(148,163,184,.18); border-radius: 15px; background: rgba(255,255,255,.88); padding: 10px 8px; box-shadow: 0 10px 24px -22px rgba(15,23,42,.38); }
  .outlineRow { display: grid; grid-template-columns: 22px minmax(0, 1fr); align-items: center; min-height: 32px; border-radius: 10px; }
  .outlineRow:hover, .outlineRow:focus-within { background: rgba(148,163,184,.10); }
  .twist { width: 22px; height: 24px; display: grid; place-items: center; border-radius: 8px; color: rgba(71,85,105,.72); user-select: none; }
  .twist.hasKids { cursor: pointer; }
  .outlineInput { border: 0; box-shadow: none; border-radius: 8px; min-height: 30px; padding: 4px 6px; font-size: 15px; font-weight: 400; background: transparent; }
  .outlineInput:focus { background: rgba(255,255,255,.7); }
</style>
</head>
<body>
<main>
  <div class="bar"><div class="brand">details · ${escapeHtml(nodeLabel)}</div><button id="modeText" type="button">text</button><button id="modeOutline" type="button">outline</button><button id="saveBtn" type="button">save</button><span id="status" class="status">connected</span><div class="grow"></div><button id="closeBtn" type="button">×</button></div>
  <section class="body"><input id="title" aria-label="Item details title"><div id="textPane" class="editorPane"><textarea id="text" aria-label="Item details text"></textarea></div><div id="outlinePane" class="editorPane" aria-label="Item details outline"></div></section>
</main>
<script>
(function () {
  var initialPayload = ${JSON.stringify(payload)};
  var nodeId = initialPayload.nodeId;
  var title = document.getElementById("title");
  var text = document.getElementById("text");
  var status = document.getElementById("status");
  var textPane = document.getElementById("textPane");
  var outlinePane = document.getElementById("outlinePane");
  var modeText = document.getElementById("modeText");
  var modeOutline = document.getElementById("modeOutline");
  var mode = initialPayload.mode === "outline" ? "outline" : "text";
  var outline = Array.isArray(initialPayload.outline) && initialPayload.outline.length ? initialPayload.outline : [{ id: makeId(), text: "", depth: 0, collapsed: false, order: 1000 }];
  var dirty = false;

  title.value = initialPayload.title || "";
  text.value = initialPayload.text || "";

  function makeId() { return "line_" + Math.random().toString(36).slice(2, 9); }
  function setStatus(value) { status.textContent = value || "connected"; }
  function markDirty() { dirty = true; window.__pocketPeDirty = true; setStatus("editing"); }
  function markClean() { dirty = false; window.__pocketPeDirty = false; setStatus("saved"); }
  function lineDepth(line) { return Math.max(0, Math.min(8, Number(line.depth) || 0)); }
  function hasChild(index) { return !!outline[index + 1] && lineDepth(outline[index + 1]) > lineDepth(outline[index]); }
  function isHidden(index) {
    var depth = lineDepth(outline[index]);
    for (var i = index - 1; i >= 0; i--) {
      var candidateDepth = lineDepth(outline[i]);
      if (candidateDepth < depth) {
        if (outline[i].collapsed) return true;
        depth = candidateDepth;
      }
    }
    return false;
  }
  function normaliseLine(line, index) {
    return { id: line.id || makeId(), text: String(line.text || "").slice(0, 1200), depth: lineDepth(line), collapsed: line.collapsed === true, order: (index + 1) * 1000 };
  }
  function serialiseOutline() { return outline.map(normaliseLine); }
  function visibleInputs() { return Array.prototype.slice.call(outlinePane.querySelectorAll(".outlineInput")); }
  function focusLine(id) {
    window.requestAnimationFrame(function () {
      var input = outlinePane.querySelector('[data-line-id="' + id + '"]');
      if (input) { input.focus({ preventScroll: true }); input.select(); }
    });
  }
  function setMode(nextMode) {
    mode = nextMode === "outline" ? "outline" : "text";
    modeText.classList.toggle("active", mode === "text");
    modeOutline.classList.toggle("active", mode === "outline");
    textPane.classList.toggle("active", mode === "text");
    outlinePane.classList.toggle("active", mode === "outline");
    if (mode === "outline") renderOutline();
  }
  function renderOutline() {
    outlinePane.innerHTML = "";
    outline.forEach(function (line, index) {
      if (isHidden(index)) return;
      var row = document.createElement("div");
      row.className = "outlineRow";
      row.style.paddingLeft = (lineDepth(line) * 22) + "px";
      var twist = document.createElement("button");
      twist.type = "button";
      twist.className = "twist" + (hasChild(index) ? " hasKids" : "");
      twist.textContent = hasChild(index) ? (line.collapsed ? "▸" : "▾") : "·";
      twist.addEventListener("click", function (ev) {
        ev.preventDefault();
        if (!hasChild(index)) return;
        line.collapsed = !line.collapsed;
        markDirty();
        renderOutline();
        focusLine(line.id);
      });
      var input = document.createElement("input");
      input.className = "outlineInput";
      input.type = "text";
      input.value = line.text || "";
      input.setAttribute("data-line-id", line.id);
      input.addEventListener("input", function () { line.text = input.value; markDirty(); });
      input.addEventListener("keydown", function (ev) {
        if (ev.key === "Enter") {
          ev.preventDefault();
          var newLine = { id: makeId(), text: "", depth: lineDepth(line), collapsed: false, order: 0 };
          outline.splice(index + 1, 0, newLine);
          markDirty();
          renderOutline();
          focusLine(newLine.id);
          return;
        }
        if (ev.key === "Tab") {
          ev.preventDefault();
          if (ev.shiftKey) line.depth = Math.max(0, lineDepth(line) - 1);
          else line.depth = Math.min(8, lineDepth(line) + 1);
          markDirty();
          renderOutline();
          focusLine(line.id);
          return;
        }
        if (ev.key === "Backspace" && !input.value && outline.length > 1) {
          ev.preventDefault();
          var previous = outline[Math.max(0, index - 1)];
          outline.splice(index, 1);
          markDirty();
          renderOutline();
          focusLine(previous.id);
        }
      });
      row.appendChild(twist);
      row.appendChild(input);
      outlinePane.appendChild(row);
    });
  }
  function save() {
    setStatus("saving…");
    try {
      if (window.opener && !window.opener.closed && window.opener.PocketPeEditor && typeof window.opener.PocketPeEditor.apply === "function") {
        var ok = window.opener.PocketPeEditor.apply({ nodeId: nodeId, title: title.value, mode: mode, text: text.value, outline: serialiseOutline() });
        if (ok) { markClean(); return; }
      }
    } catch (error) { console.error(error); }
    setStatus("save failed");
  }
  title.addEventListener("input", markDirty);
  text.addEventListener("input", markDirty);
  modeText.addEventListener("click", function () { setMode("text"); markDirty(); text.focus(); });
  modeOutline.addEventListener("click", function () { setMode("outline"); markDirty(); focusLine(outline[0].id); });
  document.getElementById("saveBtn").addEventListener("click", save);
  document.getElementById("closeBtn").addEventListener("click", function () { if (!dirty || confirm("Close without saving?")) window.close(); });
  document.addEventListener("keydown", function (ev) { if ((ev.ctrlKey || ev.metaKey) && ev.key.toLowerCase() === "s") { ev.preventDefault(); save(); } });
  setMode(mode);
  if (mode === "outline") focusLine(outline[0].id); else text.focus();
})();
</script>
</body>
</html>`);
    win.document.close();
  }

  function openPeForNode(nodeId = "") {
    const node = selectedNode(nodeId);
    if (!node) {
      if (typeof setStatus === "function") setStatus("Select an item first.", "warn");
      console.warn("[item details route] no selected node", { requestedId: nodeId, selectedId: global.state?.selectedId, detailsEditId: global.state?.detailsEdit?.id, domId: domSelectedNodeId() });
      return false;
    }
    const width = 760;
    const height = 600;
    const left = Math.max(0, Math.round((global.screen.availWidth - width) / 2));
    const top = Math.max(0, Math.round((global.screen.availHeight - height) / 2));
    const win = global.open("", "pocketStandalonePe", `popup=yes,width=${width},height=${height},left=${left},top=${top}`);
    if (!win) {
      if (typeof setStatus === "function") setStatus("Details popout blocked. Allow popups for pocket, then try Enter again.", "warn", { durationMs: 5200 });
      console.warn("[item details route] popup blocked");
      return false;
    }
    writeEditor(win, pePayloadForNode(node), clean(node.label, 220));
    win.focus();
    console.info("[item details route] opened", { id: node.id, label: clean(node.label, 80) });
    return true;
  }

  document.addEventListener("keydown", function (ev) {
    if (ev.key !== "Enter" || ev.metaKey || ev.ctrlKey || ev.altKey || ev.shiftKey) return;
    if (global.state?.moveMode || global.state?.inlineEdit?.id || global.pendingPathImport) return;
    const capturedId = nodeIdFromEvent(ev) || domSelectedNodeId() || clean(global.state?.selectedId, 80);
    window.setTimeout(() => openPeForNode(capturedId), 0);
  }, true);

  global.PocketPeEditor = Object.freeze({ open: openPeForNode, getPayload, apply: applyPe });
  global.openPocketPeEditor = openPeForNode;
  console.info("[item details route] installed text/outline mode");
})(window);
