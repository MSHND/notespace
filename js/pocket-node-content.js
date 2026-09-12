/* Canonical current-node PE content contract: one v2 text truth, bounded legacy projection. */
(function initialisePocketNodeContent(global) {
  "use strict";

  const V1_SCHEMA = "pocket.nodeEditor.v1";
  const V2_SCHEMA = "pocket.nodeEditor.v2";
  const MAX_DEPTH = 8;
  const DETAILS_CHARS = 4000;
  const V1_EDITOR_BYTES = 2000000;
  /* Accepted v1 envelope plus worst-case 4,000 UTF-16-code-unit details projection and separator. */
  const CANONICAL_BYTES = V1_EDITOR_BYTES + 16384;

  function isObject(value) {
    return !!value && typeof value === "object" && !Array.isArray(value);
  }

  function cloneJson(value) {
    try { return { ok: true, value: JSON.parse(JSON.stringify(value)) }; }
    catch (_error) { return { ok: false, value: undefined }; }
  }

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

  function normaliseLineEndings(value) {
    return String(value == null ? "" : value).replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  }

  function normaliseCanonicalText(value) {
    return normaliseLineEndings(value).split("\n").map(function (line) {
      const match = line.match(/^[ \t]*/);
      const leading = match ? match[0] : "";
      if (!leading.includes("\t")) return line;
      let expanded = "";
      for (const ch of leading) expanded += ch === "\t" ? "  " : " ";
      return expanded + line.slice(leading.length);
    }).join("\n");
  }

  function normaliseDetails(value) {
    if (typeof global.normaliseDetails === "function") return global.normaliseDetails(value, DETAILS_CHARS);
    return normaliseLineEndings(value).trim().slice(0, DETAILS_CHARS);
  }

  function parseEditorBody(value) {
    const source = String(value == null ? "" : value);
    return { text: normaliseCanonicalText(source), urgent: /(^|\s)#urgent\b/i.test(source) };
  }

  function validateText(value) {
    if (typeof value !== "string") return { ok: false, reason: "invalid-editor-text" };
    const text = normaliseCanonicalText(value);
    const bytes = utf8ByteLength(text);
    if (bytes > CANONICAL_BYTES) {
      return { ok: false, reason: "editor-text-too-large", actual: bytes, limit: CANONICAL_BYTES };
    }
    return { ok: true, text, bytes };
  }

  function v1EnvelopeAllows(outline) {
    const policy = global.PocketOutlinePersistencePolicy;
    if (policy && typeof policy.assessOutline === "function") return policy.assessOutline(outline).ok === true;
    return Array.isArray(outline) && outline.length <= 15000;
  }

  function normaliseV1Block(block, index) {
    const source = isObject(block) ? block : {};
    const rawDepth = Number(source.depth);
    return {
      id: typeof source.id === "string" ? source.id.slice(0, 80) : `legacy_${index}`,
      text: normaliseLineEndings(source.text == null ? "" : source.text).slice(0, 4000),
      depth: Number.isInteger(rawDepth) ? Math.max(0, Math.min(MAX_DEPTH, rawDepth)) : 0,
      collapsed: source.collapsed === true,
      order: index + 1,
    };
  }

  function classifyEditor(value, options = {}) {
    const present = Object.prototype.hasOwnProperty.call(options, "present")
      ? options.present === true : value !== undefined;
    if (!present || value === null) return { kind: "none", supported: false, schema: "", normalised: null };
    const cloned = cloneJson(value);
    if (!cloned.ok || !isObject(cloned.value)) {
      return { kind: "unsupported-or-malformed", supported: false, schema: "", normalised: null };
    }
    const source = cloned.value;
    const schema = typeof source.schema === "string" ? source.schema.slice(0, 80) : "";
    if (schema === V2_SCHEMA) {
      const keys = Object.keys(source).sort();
      const exact = keys.length === 2 && keys[0] === "schema" && keys[1] === "text";
      const checked = exact ? validateText(source.text) : { ok: false };
      if (!checked.ok) return { kind: "unsupported-or-malformed", supported: false, schema, normalised: null };
      return { kind: "supported-v2-text", supported: true, schema, normalised: { schema: V2_SCHEMA, text: checked.text } };
    }
    if (schema === V1_SCHEMA && source.mode === "outline" && Array.isArray(source.outline) && v1EnvelopeAllows(source.outline)) {
      const outline = source.outline.map(normaliseV1Block);
      return { kind: "supported-v1-outline", supported: true, schema, normalised: { schema: V1_SCHEMA, mode: "outline", outline } };
    }
    return { kind: "unsupported-or-malformed", supported: false, schema, normalised: null };
  }

  function projectV1Outline(outline) {
    if (!Array.isArray(outline)) return "";
    return outline.map(function (block) {
      const depth = Math.max(0, Math.min(MAX_DEPTH, Number(block && block.depth) || 0));
      return "  ".repeat(depth) + normaliseLineEndings(block && block.text || "");
    }).join("\n");
  }

  function readNode(node) {
    const source = isObject(node) ? node : {};
    const present = Object.prototype.hasOwnProperty.call(source, "editor");
    const classification = classifyEditor(present ? source.editor : undefined, { present });
    const details = normaliseDetails(source.details);
    if (classification.kind === "supported-v2-text") {
      return { kind: "v2", readOnly: false, text: classification.normalised.text, classification };
    }
    if (classification.kind === "supported-v1-outline") {
      const projected = projectV1Outline(classification.normalised.outline);
      if (!details) return { kind: "v1-outline", readOnly: false, text: projected, classification };
      if (details === normaliseDetails(projected)) {
        return { kind: "v1-duplicate", readOnly: false, text: projected, classification };
      }
      return { kind: "v1-dual", readOnly: false, text: `${details}\n\n${projected}`, classification };
    }
    if (classification.kind === "unsupported-or-malformed") {
      return { kind: "unsupported", readOnly: true, text: details, classification };
    }
    return { kind: "details", readOnly: false, text: details, classification };
  }

  function detailsProjection(text) {
    return normaliseDetails(normaliseCanonicalText(text));
  }

  function prepareCanonical(text) {
    const checked = validateText(text);
    if (!checked.ok) return checked;
    const meaningful = checked.text.trim().length > 0;
    return {
      ok: true,
      text: checked.text,
      bytes: checked.bytes,
      editor: meaningful ? { schema: V2_SCHEMA, text: checked.text } : null,
      details: meaningful ? detailsProjection(checked.text) : "",
    };
  }

  function parseMarker(content) {
    const text = String(content == null ? "" : content);
    let match = text.match(/^([1-9]\d*)\. (.*)$/);
    if (match) return { kind: "number", marker: `${match[1]}. `, number: Number(match[1]), body: match[2] };
    match = text.match(/^([-*]) (.*)$/);
    if (match) return { kind: "bullet", marker: `${match[1]} `, bullet: match[1], body: match[2] };
    return { kind: "plain", marker: "", body: text };
  }

  function parseLines(text) {
    const canonical = normaliseCanonicalText(text);
    const rawLines = canonical === "" ? [""] : canonical.split("\n");
    return rawLines.map(function (raw, index) {
      const leading = (raw.match(/^ */) || [""])[0].length;
      const depth = Math.max(0, Math.min(MAX_DEPTH, Math.floor(leading / 2)));
      const content = raw.slice(depth * 2);
      return { id: `line_${index}`, depth, content, marker: parseMarker(content) };
    });
  }

  function serialiseLines(lines) {
    if (!Array.isArray(lines) || lines.length === 0) return "";
    return normaliseCanonicalText(lines.map(function (line) {
      const depth = Math.max(0, Math.min(MAX_DEPTH, Number(line && line.depth) || 0));
      return "  ".repeat(depth) + String(line && line.content == null ? "" : line.content);
    }).join("\n"));
  }

  function subtreeEnd(lines, index) {
    if (!Array.isArray(lines) || index < 0 || index >= lines.length) return index;
    const depth = Number(lines[index].depth) || 0;
    let cursor = index + 1;
    while (cursor < lines.length && (Number(lines[cursor].depth) || 0) > depth) cursor += 1;
    return cursor;
  }

  function hasChildren(lines, index) {
    return Array.isArray(lines) && index >= 0 && index + 1 < lines.length
      && (Number(lines[index + 1].depth) || 0) > (Number(lines[index].depth) || 0);
  }

  function indentSubtree(lines, index, delta) {
    if (!Array.isArray(lines) || !Number.isInteger(index) || index < 0 || index >= lines.length || (delta !== 1 && delta !== -1)) return { ok: false, lines };
    if (delta > 0 && index === 0) return { ok: false, lines };
    const end = subtreeEnd(lines, index); const copy = lines.map((line) => ({ ...line }));
    for (let cursor = index; cursor < end; cursor += 1) { const next = (Number(copy[cursor].depth) || 0) + delta; if (next < 0 || next > MAX_DEPTH) return { ok: false, lines }; }
    for (let cursor = index; cursor < end; cursor += 1) copy[cursor].depth += delta;
    return { ok: true, lines: copy };
  }

  function siblingBefore(lines, index) {
    const depth = Number(lines[index]?.depth) || 0;
    for (let cursor = index - 1; cursor >= 0; cursor -= 1) { const candidateDepth = Number(lines[cursor]?.depth) || 0; if (candidateDepth === depth) return cursor; if (candidateDepth < depth) break; }
    return -1;
  }

  function moveSubtree(lines, index, direction) {
    if (!Array.isArray(lines) || !Number.isInteger(index) || index < 0 || index >= lines.length || (direction !== "up" && direction !== "down")) return { ok: false, lines };
    const depth = Number(lines[index].depth) || 0; const end = subtreeEnd(lines, index); const target = direction === "up" ? siblingBefore(lines, index) : end;
    if (target < 0 || target >= lines.length || (Number(lines[target].depth) || 0) !== depth) return { ok: false, lines };
    const copy = lines.map((line) => ({ ...line })); const branch = copy.splice(index, end - index);
    if (direction === "up") copy.splice(target, 0, ...branch);
    else { const targetStart = target - branch.length; const targetEnd = subtreeEnd(copy, targetStart); copy.splice(targetEnd, 0, ...branch); }
    return { ok: true, lines: copy };
  }

  function visibleIndexes(lines, collapsedIds) {
    if (!Array.isArray(lines)) return [];
    const collapsed = collapsedIds instanceof Set ? collapsedIds : new Set(Array.isArray(collapsedIds) ? collapsedIds : []); const visible = [];
    for (let index = 0; index < lines.length; index += 1) {
      let depth = Number(lines[index]?.depth) || 0; let hidden = false;
      for (let cursor = index - 1; cursor >= 0; cursor -= 1) { const parentDepth = Number(lines[cursor]?.depth) || 0; if (parentDepth >= depth) continue; if (collapsed.has(lines[cursor]?.id)) { hidden = true; break; } depth = parentDepth; if (depth <= 0) break; }
      if (!hidden) visible.push(index);
    }
    return visible;
  }

  function smartContinuation(content) {
    const marker = parseMarker(content);
    if (marker.kind === "number") {
      return marker.body.length === 0 ? { exitList: true, content: "" }
        : { exitList: false, content: `${marker.number + 1}. ` };
    }
    if (marker.kind === "bullet") {
      return marker.body.length === 0 ? { exitList: true, content: "" }
        : { exitList: false, content: marker.marker };
    }
    return { exitList: false, content: "" };
  }

  global.PocketNodeContent = Object.freeze({
    V1_SCHEMA,
    V2_SCHEMA,
    LIMITS: Object.freeze({ maxDepth: MAX_DEPTH, detailsChars: DETAILS_CHARS, canonicalBytes: CANONICAL_BYTES }),
    classifyEditor,
    normaliseCanonicalText,
    normaliseDetails,
    validateText,
    parseEditorBody,
    readNode,
    projectV1Outline,
    detailsProjection,
    prepareCanonical,
    parseMarker,
    parseLines,
    serialiseLines,
    subtreeEnd,
    hasChildren,
    indentSubtree,
    moveSubtree,
    visibleIndexes,
    smartContinuation,
    utf8ByteLength,
  });
})(typeof window !== "undefined" ? window : globalThis);
