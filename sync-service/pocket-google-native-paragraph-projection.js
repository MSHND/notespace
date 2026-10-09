"use strict";

// P349xv — isolated, dormant native Google paragraph -> plain UTF-8 projection.
// No Google client, Pocket store, release/publisher authority, or production route.
const { createHash } = require("node:crypto");
const { NAMES } = require("./pocket-handover-release-witness.js");

const isObject = x => x !== null && typeof x === "object" && !Array.isArray(x);
const keysOnly = (x, names) => isObject(x) && Object.keys(x).every(k => names.includes(k));
const validId = x => typeof x === "string" && x.length > 0 && x.trim() === x;
const denied = reason => Object.freeze({ ok: false, reason });
const isEmptyMap = x => x == null || (isObject(x) && Object.keys(x).length === 0);

// Buffer.from() silently replaces lone surrogates; treat malformed UTF-16 as
// unsupported rather than returning a digest of different bytes.
function wellFormed(s) {
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    if (c >= 0xD800 && c <= 0xDBFF) {
      if (++i === s.length) return false;
      const next = s.charCodeAt(i);
      if (next < 0xDC00 || next > 0xDFFF) return false;
    } else if (c >= 0xDC00 && c <= 0xDFFF) return false;
  }
  return true;
}

// Both the expected identity and native snapshot are inputs, NOT an external
// attestation. Callers must obtain/recheck trusted Google revisions separately.
function projectGoogleNativeParagraphs({ snapshot, name, documentId, revisionId,
  tabId = "t.0" } = {}) {
  try {
    if (!NAMES.includes(name) || !validId(documentId) || !validId(revisionId)
        || !validId(tabId)) return denied("expected-identity-invalid");
    if (!isObject(snapshot) || snapshot.documentId !== documentId
        || snapshot.revisionId !== revisionId
        || !Array.isArray(snapshot.tabs) || snapshot.tabs.length !== 1
        || !isEmptyMap(snapshot.body))
      return denied("document-or-revision-invalid");
    // A duplicate top-level legacy body could be an alternate text source.
    if (snapshot.body && Object.keys(snapshot.body).length) {
      if (Array.isArray(snapshot.body.content) && snapshot.body.content.length)
        return denied("ambiguous-legacy-body");
      if (Object.keys(snapshot.body).some(k => k !== "content"))
        return denied("ambiguous-legacy-body");
    }
    if (snapshot.suggestionsViewMode != null
        && !["SUGGESTIONS_INLINE", "PREVIEW_SUGGESTIONS_ACCEPTED"].includes(
          snapshot.suggestionsViewMode)) return denied("suggestion-mode-unsupported");
    const tab = snapshot.tabs[0];
    if (!isObject(tab) || tab.tabId !== tabId
        || (tab.documentId != null && tab.documentId !== documentId)
        || tab.parentTabId != null
        || (tab.nestingLevel != null && tab.nestingLevel !== 0)
        || !isObject(tab.body) || !Array.isArray(tab.body.content))
      return denied("tab-or-body-invalid");
    for (const key of ["headers", "footers", "footnotes", "lists", "inlineObjects",
      "positionedObjects", "namedRanges", "dropdownDefinitions",
      "suggestedDocumentStyleChanges", "suggestedNamedStylesChanges"]) {
      if (!isEmptyMap(tab[key])) return denied("unsupported-tab-content");
    }
    const blocks = tab.body.content;
    if (blocks.length < 2 || !keysOnly(blocks[0], ["startIndex", "endIndex", "sectionBreak"])
        || !isObject(blocks[0].sectionBreak)
        || blocks[0].endIndex !== 1
        || (blocks[0].startIndex != null && blocks[0].startIndex !== 0))
      return denied("section-or-empty-body-invalid");
    let cursor = 1;
    const values = [];
    for (const block of blocks.slice(1)) {
      if (!keysOnly(block, ["startIndex", "endIndex", "paragraph"])
          || !isObject(block.paragraph)
          || block.startIndex !== cursor
          || !Number.isSafeInteger(block.endIndex) || block.endIndex <= cursor
          || !keysOnly(block.paragraph, ["elements", "paragraphStyle", "bullet"])
          || block.paragraph.bullet != null
          || !Array.isArray(block.paragraph.elements)
          || block.paragraph.elements.length === 0)
        return denied("unsupported-paragraph-or-index");
      let index = cursor;
      let full = "";
      for (const el of block.paragraph.elements) {
        if (!keysOnly(el, ["startIndex", "endIndex", "textRun"])
            || !keysOnly(el.textRun, ["content", "textStyle"])
            || typeof el.textRun.content !== "string" || !el.textRun.content.length
            || el.startIndex !== index || !Number.isSafeInteger(el.endIndex)
            || el.endIndex !== index + el.textRun.content.length)
          return denied("unsupported-text-run-or-index");
        full += el.textRun.content;
        index = el.endIndex;
      }
      if (index !== block.endIndex || !full.endsWith("\n")
          || full.slice(0, -1).includes("\n")
          || full.slice(0, -1).includes("\r")
          || !wellFormed(full))
        return denied("ambiguous-ending-or-malformed-text");
      values.push(full.slice(0, -1)); // remove ONE structural terminal LF
      cursor = block.endIndex;
    }
    const content = values.join("\n"); // keep leading/interior/trailing empties
    const bytes = Buffer.from(content, "utf8");
    return Object.freeze({
      ok: true, name, documentId, revisionId, tabId, content,
      utf8ByteCount: bytes.length,
      sha256: createHash("sha256").update(bytes).digest("hex"),
      paragraphCount: values.length,
      emptyParagraphCount: values.filter(x => x === "").length,
    });
  } catch (_error) {
    return denied("malformed-snapshot");
  }
}

module.exports = Object.freeze({ projectGoogleNativeParagraphs });
