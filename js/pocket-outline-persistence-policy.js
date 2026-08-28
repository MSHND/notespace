/* Shared bounded persistence envelope for first-class PE Outlines. */
(function initialisePocketOutlinePersistencePolicy(global) {
  "use strict";

  const EDITOR_SCHEMA = "pocket.nodeEditor.v1";
  const LIMITS = Object.freeze({
    outlineBlocks: 15000,
    editorBytes: 2000000,
    localFileChars: 8000000,
  });

  function utf8ByteLength(value) {
    const text = typeof value === "string" ? value : "";
    if (typeof TextEncoder === "function") return new TextEncoder().encode(text).byteLength;
    let bytes = 0;
    for (let index = 0; index < text.length; index += 1) {
      const code = text.charCodeAt(index);
      if (code < 0x80) bytes += 1;
      else if (code < 0x800) bytes += 2;
      else if (code >= 0xd800 && code <= 0xdbff && index + 1 < text.length
          && text.charCodeAt(index + 1) >= 0xdc00 && text.charCodeAt(index + 1) <= 0xdfff) {
        bytes += 4;
        index += 1;
      } else bytes += 3;
    }
    return bytes;
  }

  function serialiseEditorMeta(outline) {
    try {
      const canonicalOutline = Array.isArray(outline) ? outline.map((block, index) => ({
        id: block && block.id,
        text: block && block.text,
        depth: block && block.depth,
        collapsed: !!(block && block.collapsed === true),
        order: index + 1,
      })) : outline;
      const text = JSON.stringify({ schema: EDITOR_SCHEMA, mode: "outline", outline: canonicalOutline });
      return typeof text === "string" ? text : null;
    } catch (_error) {
      return null;
    }
  }

  function assessOutline(outline) {
    if (!Array.isArray(outline)) return { ok: false, reason: "invalid-outline" };
    if (outline.length > LIMITS.outlineBlocks) {
      return { ok: false, reason: "outline-too-many-blocks", actual: outline.length, limit: LIMITS.outlineBlocks };
    }
    const serialised = serialiseEditorMeta(outline);
    if (serialised === null) return { ok: false, reason: "invalid-outline" };
    const bytes = utf8ByteLength(serialised);
    if (bytes > LIMITS.editorBytes) {
      return { ok: false, reason: "outline-too-large", actual: bytes, limit: LIMITS.editorBytes };
    }
    return { ok: true, bytes };
  }

  function allowsLocalFileText(text) {
    return typeof text === "string" && text.length <= LIMITS.localFileChars;
  }

  global.PocketOutlinePersistencePolicy = Object.freeze({
    LIMITS,
    assessOutline,
    allowsLocalFileText,
    serialiseEditorMeta,
    utf8ByteLength,
  });
})(typeof window !== "undefined" ? window : globalThis);
