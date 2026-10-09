"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { createHash } = require("node:crypto");
const { projectGoogleNativeParagraphs: project } =
  require("../sync-service/pocket-google-native-paragraph-projection.js");
const { NAMES } = require("../sync-service/pocket-handover-release-witness.js");

const ID = "synthetic-google-id", REV = "opaque-revision-1", NAME = "pocket.start-here";
const hash = s => createHash("sha256").update(Buffer.from(s, "utf8")).digest("hex");

// Exact native get_document-shaped TEST DATA: indexes count JS UTF-16 code
// units, whereas source digest and byte count use UTF-8.
function native(values, options = {}) {
  let cursor = 1;
  const blocks = [{ endIndex: 1, sectionBreak: { sectionStyle: {
    sectionType: "CONTINUOUS", contentDirection: "LEFT_TO_RIGHT",
    columnSeparatorStyle: "NONE",
  } } }];
  for (const value of values) {
    const parts = Array.isArray(value) ? value : [value];
    const elements = [];
    for (let i = 0; i < parts.length; i++) {
      const content = parts[i] + (i === parts.length - 1 ? "\n" : "");
      const endIndex = cursor + content.length;
      elements.push({ startIndex: cursor, endIndex,
        textRun: { content, textStyle: { bold: i % 2 === 0 } } });
      cursor = endIndex;
    }
    blocks.push({ startIndex: elements[0].startIndex, endIndex: cursor,
      paragraph: { elements, paragraphStyle: { namedStyleType: "NORMAL_TEXT" } } });
  }
  return {
    documentId: options.id ?? ID, revisionId: options.rev ?? REV,
    suggestionsViewMode: "SUGGESTIONS_INLINE",
    tabs: [{ tabId: options.tab ?? "t.0", documentId: options.id ?? ID,
      parentTabId: null, body: { content: blocks },
      headers: null, footers: null, footnotes: null, lists: null,
      inlineObjects: null, positionedObjects: null }],
  };
}
function run(doc, overrides = {}) {
  return project({ snapshot: doc, name: NAME, documentId: ID,
    revisionId: REV, tabId: "t.0", ...overrides });
}
function success(doc, text) {
  const r = run(doc);
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.equal(r.content, text);
  assert.equal(r.sha256, hash(text));
  assert.equal(r.utf8ByteCount, Buffer.byteLength(text, "utf8"));
  assert.deepEqual({ name:r.name, documentId:r.documentId,
    revisionId:r.revisionId, tabId:r.tabId },
  { name:NAME, documentId:ID, revisionId:REV, tabId:"t.0" });
  return r;
}
function rejectMutation(change) {
  const doc = native(["header", "", "body"]);
  change(doc);
  const r = run(doc);
  assert.equal(r.ok, false, JSON.stringify(r));
  assert.equal(Object.hasOwn(r, "content"), false,
    "unsafe source may never return partial text");
}

test("P349xv structural blanks: two leading, interior consecutive and trailing", () => {
  const p = ["", "", "POCKET", "", "", "Second", ""];
  const text = "\n\nPOCKET\n\n\nSecond\n";
  const r = success(native(p), text);
  assert.equal(r.paragraphCount, 7);
  assert.equal(r.emptyParagraphCount, 5);
  assert.equal((text.match(/\n/g) || []).length, 6);
  assert.notEqual(r.sha256, hash(text + "\n"),
    "must not append an invented extra terminator");
  assert.notEqual(r.sha256, hash("POCKET\nSecond"));
});
test("P349xv one nonempty paragraph has NO invented final newline", () => {
  const r = success(native(["abc"]), "abc");
  assert.equal(r.sha256, "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
  assert.notEqual(r.sha256, hash("abc\n"));
});
test("P349xv empty native Google paragraph is complete empty text, not missing content", () => {
  const r = success(native([""]), "");
  assert.equal(r.sha256, "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855");
  assert.equal(r.paragraphCount, 1);
  assert.equal(r.emptyParagraphCount, 1);
  success(native(["a", ""]), "a\n");
});
test("P349xv whitespace-only, literal tabs, indentation and bullets are byte-exact", () => {
  const source = ["  ", "\t", "   •  first\titem  ", "  - literal bullet  "];
  const expected = source.join("\n");
  const r = success(native(source), expected);
  assert.equal(r.emptyParagraphCount, 0);
  assert.equal(r.paragraphCount, 4);
  assert.ok(r.content.includes("\t"));
  assert.ok(r.content.includes("•"));
  assert.notEqual(r.sha256, hash(expected.trim()));
});
test("P349xv native multi-run order and styles do NOT alter UTF-8 content", () => {
  const original = native([["A ", "🍃", " Māori", " •", "\tZ"], "next"]);
  const copy = structuredClone(original);
  const result = success(original, "A 🍃 Māori •\tZ\nnext");
  assert.deepEqual(original, copy, "projection must be read-only");
  assert.ok(result.utf8ByteCount > result.content.length);
});
test("P349xv split UTF-16 surrogate pair across two runs is joined before validation", () => {
  const emoji = "🍃";
  success(native([["start ", emoji.slice(0, 1), emoji.slice(1), " end"]]), "start 🍃 end");
});
test("P349xv Unicode combinations, CJK and U+2028 remain exactly encoded", () => {
  const source = ["café e\u0301 日本語", "line\u2028separator"];
  success(native(source), source.join("\n"));
});
test("P349xv all nine release-witness identity names are accepted, no extra names", () => {
  for (const name of NAMES) {
    const r = run(native([name]), { name });
    assert.equal(r.ok, true, name);
    assert.equal(r.name, name);
  }
  assert.equal(run(native(["x"]), { name: "arbitrary-project" }).ok, false);
});
test("P349xv exact expected document, source revision and tab identity are required", () => {
  for (const mutation of [
    x => { x.documentId = "unrecognised"; },
    x => { x.revisionId = "new"; },
    x => { x.tabs[0].tabId = "t.1"; },
    x => { x.tabs[0].documentId = "unrecognised"; },
    x => { x.tabs[0].parentTabId = "t.parent"; },
    x => { x.tabs[0].nestingLevel = 1; },
    x => { x.tabs.push(structuredClone(x.tabs[0])); },
    x => { x.tabs = []; },
    x => { delete x.revisionId; },
    x => { x.suggestionsViewMode = "PREVIEW_WITHOUT_SUGGESTIONS"; },
  ]) rejectMutation(mutation);
  for (const opts of [{documentId:"wrong"}, {revisionId:"wrong"}, {tabId:"bad"},
    {revisionId:""}, {name:"pocket.not-authorised"}]) {
    assert.equal(run(native(["x"]), opts).ok, false);
  }
});
test("P349xv unexpected native tabs/objects/lists/footnotes/body are denied", () => {
  for (const mutation of [
    x => { x.tabs[0].body.content.push({ table: { rows: [] } }); },
    x => { x.tabs[0].body.content[2] = { tableOfContents: {} }; },
    x => { x.tabs[0].body.content[1].paragraph.bullet = {listId:"a"}; },
    x => { x.tabs[0].lists = { a: {} }; },
    x => { x.tabs[0].inlineObjects = { a: {} }; },
    x => { x.tabs[0].positionedObjects = { a: {} }; },
    x => { x.tabs[0].headers = { a: {} }; },
    x => { x.tabs[0].footers = { a: {} }; },
    x => { x.tabs[0].footnotes = { a: {} }; },
    x => { x.tabs[0].namedRanges = { a: {} }; },
    x => { x.body = { content: structuredClone(x.tabs[0].body.content) }; },
    x => { x.tabs[0].body.content.push({ sectionBreak: {} }); },
  ]) rejectMutation(mutation);
});
test("P349xv rejects non-text paragraph elements and suggested/partial runs", () => {
  for (const mutation of [
    x => { x.tabs[0].body.content[1].paragraph.elements[0] = {
      startIndex:1,endIndex:2,inlineObjectElement:{inlineObjectId:"x"} }; },
    x => { x.tabs[0].body.content[1].paragraph.elements[0].suggestedInsertionIds=["s1"]; },
    x => { x.tabs[0].body.content[1].paragraph.elements[0].textRun.content = null; },
    x => { delete x.tabs[0].body.content[1].paragraph.elements[0].textRun.content; },
    x => { x.tabs[0].body.content[1].paragraph.elements = []; },
    x => { x.tabs[0].body.content[1].paragraph.elements[0].textRun.content = ""; },
    x => { x.tabs[0].body.content[1].paragraph.elements[0].endIndex++; },
    x => { x.tabs[0].body.content[2].startIndex++; },
    x => { x.tabs[0].body.content[1].paragraph.suggestedParagraphStyleChanges = {}; },
  ]) rejectMutation(mutation);
});
test("P349xv fails closed for missing/double structural LF and embedded line breaks", () => {
  for (const text of ["unterminated", "two\n\n", "hard\nline\n", "windows\r\n", "\n\n"]) {
    const doc = native(["x"]);
    const runPart = doc.tabs[0].body.content[1].paragraph.elements[0];
    runPart.textRun.content = text;
    runPart.endIndex = runPart.startIndex + text.length;
    doc.tabs[0].body.content[1].endIndex = runPart.endIndex;
    assert.equal(run(doc).ok, false, JSON.stringify(text));
  }
});
test("P349xv malformed lone UTF-16 surrogates reject before Buffer replacement", () => {
  for (const s of ["\uD83C", "\uDF43", "ok\uD83C x", "\uDF43🍃"]) {
    assert.equal(run(native([s])).ok, false);
  }
});
test("P349xv absence of a native paragraph and ambiguous first section reject", () => {
  for (const change of [
    x=>{ x.tabs[0].body.content=[]; },
    x=>{ x.tabs[0].body.content[0].endIndex=2; },
    x=>{ x.tabs[0].body.content.shift(); },
    x=>{ x.tabs[0].body.content[0].table = {}; },
    x=>{ x.tabs[0].body.content[0].startIndex=7; },
  ]) rejectMutation(change);
});
test("P349xv synthetic projection is not publication/currentness attestation", () => {
  const r = success(native(["not a grant"]), "not a grant");
  assert.deepEqual(Object.keys(r).sort(), ["ok","name","documentId","revisionId",
    "tabId","content","utf8ByteCount","sha256","paragraphCount",
    "emptyParagraphCount"].sort());
  assert.equal(r.published, undefined);
  assert.equal(r.sourceCurrent, undefined);
  assert.equal(r.approved, undefined);
});
