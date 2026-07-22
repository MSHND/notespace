/* First-class PE metadata recognition and opaque JSON preservation helpers. */

(function initialisePocketEditorMetadata(global) {
  "use strict";

  const EDITOR_SCHEMA = "pocket.nodeEditor.v1";
  const PE_SCHEMA = "pocket.pe.v1";
  const PE_MAX_TEXT_CHARS = 120000;
  const PE_MAX_OUTLINE_LINES = 3000;
  const PE_MAX_LINE_CHARS = 1200;
  const FIRST_CLASS_NODE_FIELDS = ["editor", "pe"];

  function clean(value, max = 80) {
    return typeof cleanText === "function" ? cleanText(value, max) : String(value || "").trim().slice(0, max);
  }

  function normaliseEditorBlock(raw, index) {
    const source = raw && typeof raw === "object" && !Array.isArray(raw) ? raw : {};
    const depth = Number(source.depth);
    return {
      id: clean(source.id, 80) || (typeof makeId === "function" ? makeId("block") : "block_" + index),
      text: String(source.text == null ? "" : source.text).replace(/\r/g, "").slice(0, 4000),
      depth: Number.isFinite(depth) ? Math.max(0, Math.min(8, Math.round(depth))) : 0,
      collapsed: source.collapsed === true,
      order: index + 1
    };
  }

  function normalisePeLine(raw, index) {
    const source = raw && typeof raw === "object" && !Array.isArray(raw) ? raw : {};
    const depthRaw = Number(source.depth);
    const orderRaw = Number(source.order);
    return {
      id: clean(source.id, 80) || (typeof makeId === "function" ? makeId("line") : "line_" + index),
      text: String(source.text == null ? "" : source.text).replace(/\r/g, "").slice(0, PE_MAX_LINE_CHARS),
      depth: Number.isFinite(depthRaw) ? Math.max(0, Math.min(8, Math.round(depthRaw))) : 0,
      collapsed: source.collapsed === true,
      order: Number.isFinite(orderRaw) ? Math.max(0, Math.round(orderRaw)) : (index + 1) * 1000
    };
  }

  function normalisePocketPe(value, fallbackTitle = "") {
    if (!value || typeof value !== "object" || Array.isArray(value)) return null;
    const title = clean(value.title || fallbackTitle, 220);
    const mode = clean(value.mode, 24).toLowerCase() === "outline" ? "outline" : "text";
    const text = String(value.text == null ? "" : value.text).replace(/\r/g, "").slice(0, PE_MAX_TEXT_CHARS);
    const outline = Array.isArray(value.outline)
      ? value.outline.slice(0, PE_MAX_OUTLINE_LINES).map(normalisePeLine)
      : [];
    const hasOutlineContent = outline.some((line) => String(line.text || "").trim());
    const hasContent = !!title || !!text.trim() || hasOutlineContent;
    if (!hasContent) return null;
    return {
      schema: PE_SCHEMA,
      title: title || clean(fallbackTitle, 220),
      mode,
      text,
      outline: outline.length ? outline : [{ id: typeof makeId === "function" ? makeId("line") : "line_0", text: "", depth: 0, collapsed: false, order: 1000 }],
      updatedAt: clean(value.updatedAt, 40) || (typeof nowIso === "function" ? nowIso() : new Date().toISOString())
    };
  }

  function cloneJsonCompatibleValue(value) {
    const ancestors = new Set();

    function clone(current) {
      if (current === null) return { ok: true, value: null };
      if (typeof current === "string" || typeof current === "boolean") return { ok: true, value: current };
      if (typeof current === "number") {
        return Number.isFinite(current) ? { ok: true, value: current } : { ok: false, value: undefined };
      }
      if (typeof current !== "object" || ancestors.has(current)) return { ok: false, value: undefined };

      ancestors.add(current);
      const output = Array.isArray(current) ? [] : {};
      const keys = Array.isArray(current) ? Array.from({ length: current.length }, (_unused, index) => String(index)) : Object.keys(current);
      for (const key of keys) {
        const child = clone(current[key]);
        if (!child.ok) {
          ancestors.delete(current);
          return { ok: false, value: undefined };
        }
        if (Array.isArray(output)) output.push(child.value);
        else Object.defineProperty(output, key, { value: child.value, enumerable: true, writable: true, configurable: true });
      }
      ancestors.delete(current);
      return { ok: true, value: output };
    }

    try {
      return clone(value);
    } catch (_error) {
      return { ok: false, value: undefined };
    }
  }

  function normaliseSupportedEditorValue(value) {
    if (!value || typeof value !== "object" || Array.isArray(value)) return null;
    if (value.schema !== EDITOR_SCHEMA || value.mode !== "outline" || !Array.isArray(value.outline)) return null;
    const outline = value.outline.slice(0, 400).map(normaliseEditorBlock);
    const meaningful = outline.some(function (block) {
      return (Number(block.depth) || 0) > 0 || block.collapsed === true || clean(block.text, 4000);
    });
    if (!meaningful) return null;
    return { schema: EDITOR_SCHEMA, mode: "outline", outline };
  }

  function normaliseSupportedEditorMeta(value) {
    const cloned = cloneJsonCompatibleValue(value);
    return cloned.ok ? normaliseSupportedEditorValue(cloned.value) : null;
  }

  function editorSchemaDiagnostic(value) {
    try {
      if (!value || typeof value !== "object" || Array.isArray(value)) return "";
      const schema = value.schema;
      if (typeof schema === "string") return schema.slice(0, 80);
      if (typeof schema === "boolean") return String(schema);
      if (typeof schema === "number" && Number.isFinite(schema)) return String(schema).slice(0, 80);
      if (schema === null) return "null";
    } catch (_error) {}
    return "";
  }

  function classifyEditorMeta(value, options = {}) {
    const hasPresentOption = !!options && Object.prototype.hasOwnProperty.call(options, "present");
    const present = hasPresentOption ? options.present === true : value !== undefined;
    if (!present || value === null) {
      return { kind: "none", supported: false, schema: "", normalised: null };
    }

    const cloned = cloneJsonCompatibleValue(value);
    const diagnosticValue = cloned.ok ? cloned.value : value;
    const schema = editorSchemaDiagnostic(diagnosticValue);
    if (!cloned.ok) {
      return { kind: "unsupported-or-malformed", supported: false, schema, normalised: null };
    }

    const normalised = normaliseSupportedEditorValue(cloned.value);
    if (!normalised) {
      return { kind: "unsupported-or-malformed", supported: false, schema, normalised: null };
    }
    return { kind: "supported-v1-outline", supported: true, schema: EDITOR_SCHEMA, normalised };
  }

  function copyFirstClassNodeFields(source, target) {
    if (!source || typeof source !== "object" || Array.isArray(source)) return target;
    if (!target || typeof target !== "object" || Array.isArray(target)) return target;
    for (const field of FIRST_CLASS_NODE_FIELDS) {
      if (!Object.prototype.hasOwnProperty.call(source, field)) continue;
      const cloned = cloneJsonCompatibleValue(source[field]);
      target[field] = cloned.ok ? cloned.value : source[field];
    }
    return target;
  }

  global.normaliseTreeEditorMeta = normaliseSupportedEditorMeta;
  global.normalisePocketPe = normalisePocketPe;
  global.PocketEditorMetadata = Object.freeze({
    EDITOR_SCHEMA,
    classifyEditorMeta,
    normaliseSupportedEditorMeta,
    copyFirstClassNodeFields,
    cloneJsonCompatibleValue
  });
})(window);
