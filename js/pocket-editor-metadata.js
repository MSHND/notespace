/* Explicit editor metadata normalisation.
   Keeps outline metadata trustworthy without treating it as random node baggage. */

(function initialisePocketEditorMetadata(global) {
  "use strict";

  const EDITOR_SCHEMA = "pocket.nodeEditor.v1";
  const PE_SCHEMA = "pocket.pe.v1";
  const PE_MAX_TEXT_CHARS = 120000;
  const PE_MAX_OUTLINE_LINES = 3000;
  const PE_MAX_LINE_CHARS = 1200;

  function normaliseEditorBlock(raw = {}, index = 0) {
    const depthRaw = Number(raw.depth);
    const orderRaw = Number(raw.order);
    return {
      id: cleanText(raw.id, 80) || makeId("block"),
      text: String(raw.text == null ? "" : raw.text).replace(/\r/g, "").slice(0, 4000),
      depth: Number.isFinite(depthRaw) ? Math.max(0, Math.min(8, Math.round(depthRaw))) : 0,
      collapsed: raw.collapsed === true,
      order: Number.isFinite(orderRaw) ? Math.max(0, Math.round(orderRaw)) : index + 1
    };
  }

  function normalisePeLine(raw = {}, index = 0) {
    const depthRaw = Number(raw.depth);
    const orderRaw = Number(raw.order);
    return {
      id: cleanText(raw.id, 80) || makeId("line"),
      text: String(raw.text == null ? "" : raw.text).replace(/\r/g, "").slice(0, PE_MAX_LINE_CHARS),
      depth: Number.isFinite(depthRaw) ? Math.max(0, Math.min(8, Math.round(depthRaw))) : 0,
      collapsed: raw.collapsed === true,
      order: Number.isFinite(orderRaw) ? Math.max(0, Math.round(orderRaw)) : (index + 1) * 1000
    };
  }

  function normalisePocketPe(value, fallbackTitle = "") {
    if (!value || typeof value !== "object" || Array.isArray(value)) return null;
    const title = cleanText(value.title || fallbackTitle, 220);
    const mode = cleanText(value.mode, 24).toLowerCase() === "outline" ? "outline" : "text";
    const text = String(value.text == null ? "" : value.text).replace(/\r/g, "").slice(0, PE_MAX_TEXT_CHARS);
    const outline = Array.isArray(value.outline)
      ? value.outline.slice(0, PE_MAX_OUTLINE_LINES).map(normalisePeLine)
      : [];
    const hasOutlineContent = outline.some((line) => String(line.text || "").trim());
    const hasContent = !!title || !!text.trim() || hasOutlineContent;
    if (!hasContent) return null;
    return {
      schema: PE_SCHEMA,
      title: title || cleanText(fallbackTitle, 220),
      mode,
      text,
      outline: outline.length ? outline : [{ id: makeId("line"), text: "", depth: 0, collapsed: false, order: 1000 }],
      updatedAt: cleanText(value.updatedAt, 40) || nowIso()
    };
  }

  function normaliseTreeEditorMeta(value) {
    if (!value || typeof value !== "object" || Array.isArray(value)) return null;
    const mode = cleanText(value.mode, 24).toLowerCase() === "outline" ? "outline" : "text";
    if (mode !== "outline") return null;
    const outline = Array.isArray(value.outline)
      ? value.outline.slice(0, 400).map(normaliseEditorBlock)
      : [];
    const meaningful = outline.some((block) => (Number(block.depth) || 0) > 0 || block.collapsed === true);
    if (!meaningful) return null;
    return {
      schema: EDITOR_SCHEMA,
      mode: "outline",
      outline
    };
  }

  function normaliseNodesWithEditor(raw) {
    const arr = Array.isArray(raw) ? raw : [];
    const out = [];
    const seen = new Set();
    for (let i = 0; i < arr.length; i += 1) {
      const item = arr[i];
      if (!item || typeof item !== "object") continue;
      const id = cleanText(item.id, 80);
      if (!id || id === "root" || seen.has(id)) continue;
      seen.add(id);
      const parentId = cleanText(item.parentId, 80) || "root";
      const label = cleanText(item.label, 220);
      if (!label) continue;
      const orderRaw = Number(item.order);
      const order = Number.isFinite(orderRaw) ? Math.round(orderRaw) : (1000 + out.length);
      const updatedAt = cleanText(item.updatedAt, 40) || nowIso();
      const urgent = normaliseUrgentFlag(item.urgent);
      const details = normaliseDetails(item.details, 4000);
      const task = normaliseTreeTaskMeta(item.task || item.taskMeta);
      const profile = normaliseTreeProfile(item.profile);
      const system = normaliseTreeSystemMeta(item.system);
      const status = normaliseTreeStatusMeta(item.status);
      const editor = normaliseTreeEditorMeta(item.editor);
      const pe = normalisePocketPe(item.pe, label);
      const extras = normaliseNodeExtras(item);
      const payload = {
        id,
        parentId,
        label,
        order,
        updatedAt,
        source: cleanText(item.source, 30) || "manual",
      };
      if (urgent) payload.urgent = true;
      if (details) payload.details = details;
      if (task) payload.task = task;
      if (profile) payload.profile = profile;
      if (system) payload.system = system;
      if (status) payload.status = status;
      if (editor) payload.editor = editor;
      if (pe) payload.pe = pe;
      if (extras) Object.assign(payload, extras);
      out.push(payload);
    }
    return out;
  }

  global.normaliseTreeEditorMeta = normaliseTreeEditorMeta;
  global.normalisePocketPe = normalisePocketPe;
  global.normaliseNodes = normaliseNodesWithEditor;
})(window);
