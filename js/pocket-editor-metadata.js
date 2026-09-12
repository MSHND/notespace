/* First-class node.editor recognition and opaque JSON preservation helpers. */
(function initialisePocketEditorMetadata(global) {
  "use strict";

  const FIRST_CLASS_NODE_FIELDS = ["editor"];

  function contract() {
    if (!global.PocketNodeContent || typeof global.PocketNodeContent.classifyEditor !== "function") {
      throw new Error("PocketNodeContent is not loaded.");
    }
    return global.PocketNodeContent;
  }

  function cloneJsonCompatibleValue(value) {
    const ancestors = new Set();
    function clone(current) {
      if (current === null) return { ok: true, value: null };
      if (typeof current === "string" || typeof current === "boolean") return { ok: true, value: current };
      if (typeof current === "number") return Number.isFinite(current) ? { ok: true, value: current } : { ok: false };
      if (typeof current !== "object" || ancestors.has(current)) return { ok: false };
      ancestors.add(current);
      const output = Array.isArray(current) ? [] : {};
      const keys = Array.isArray(current) ? Array.from({ length: current.length }, (_unused, i) => String(i)) : Object.keys(current);
      for (const key of keys) {
        const child = clone(current[key]);
        if (!child.ok) { ancestors.delete(current); return { ok: false }; }
        if (Array.isArray(output)) output.push(child.value);
        else Object.defineProperty(output, key, { value: child.value, enumerable: true, writable: true, configurable: true });
      }
      ancestors.delete(current);
      return { ok: true, value: output };
    }
    try { return clone(value); } catch (_error) { return { ok: false }; }
  }

  function classifyEditorMeta(value, options = {}) {
    return contract().classifyEditor(value, options);
  }

  function normaliseSupportedEditorMeta(value) {
    const classification = contract().classifyEditor(value, { present: value !== undefined });
    return classification.supported ? classification.normalised : null;
  }

  function isMeaningfulOutline(outline) {
    return Array.isArray(outline) && outline.some(function (block) {
      return !!block && typeof block === "object" && !Array.isArray(block)
        && (String(block.text == null ? "" : block.text).trim().length > 0
          || (Number(block.depth) || 0) > 0 || block.collapsed === true);
    });
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
  global.PocketEditorMetadata = Object.freeze({
    EDITOR_SCHEMA: contract().V1_SCHEMA,
    EDITOR_SCHEMA_V1: contract().V1_SCHEMA,
    EDITOR_SCHEMA_V2: contract().V2_SCHEMA,
    classifyEditorMeta,
    normaliseSupportedEditorMeta,
    isMeaningfulOutline,
    copyFirstClassNodeFields,
    cloneJsonCompatibleValue,
  });
})(window);
