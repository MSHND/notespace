"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { createPeTestDom } = require("./helpers/pe-test-dom");

const ROOT = path.resolve(__dirname, "..");
function source(relativePath) { return fs.readFileSync(path.join(ROOT, relativePath), "utf8"); }
function plain(value) { return JSON.parse(JSON.stringify(value)); }

function loadModules() {
  const context = vm.createContext({ window: {}, TextEncoder });
  context.globalThis = context;
  vm.runInContext(source("js/pocket-node-content.js"), context, { filename: "js/pocket-node-content.js" });
  vm.runInContext(source("js/pocket-node-popout-runtime.js"), context, { filename: "js/pocket-node-popout-runtime.js" });
  return { content: context.window.PocketNodeContent, runtime: context.window.PocketNodePopoutRuntime };
}

function semanticLines(content, text) {
  return content.parseLines(text).map((line) => ({ id: line.id, depth: line.depth, content: line.content }));
}

function ids(lines) { return lines.map((line) => line.id); }

function createHarness(text) {
  const { content, runtime } = loadModules();
  const controls = new Map();
  let clearCount = 0;
  const presentationCounts = new Map();
  const peDom = createPeTestDom({
    onInnerHTMLClear() { clearCount += 1; },
  });
  const { Element, Range, selection, absoluteOffset, pointForOffset } = peDom;

  const document = {
    activeElement: null,
    body: new Element("body"),
    createElement(tagName) { return new Element(tagName); },
    createRange() { return new Range(); },
    getSelection() { return selection; },
    getElementById(id) { return controls.get(id) || null; },
    addEventListener() {},
  };
  peDom.bindDocument(document);

  for (const id of [
    "titleInput", "outlinePane", "saveState", "saveBtn", "saveCloseBtn", "unsavedDialog",
    "unsavedSaveBtn", "unsavedDiscardBtn", "unsavedCancelBtn", "closeBtn",
  ]) controls.set(id, new Element(id === "titleInput" ? "input" : id.includes("Btn") ? "button" : "div"));
  controls.get("unsavedDialog").hidden = true;

  const pane = controls.get("outlinePane");
  const parsed = content.parseLines(text);
  parsed.forEach((line, index) => {
    const row = new Element("div");
    row.className = "docRow";
    row.setAttribute("data-line-id", `line_${index}`);
    row.setAttribute("data-depth", String(line.depth));
    const gutter = new Element("button");
    gutter.className = "lineGutter" + (content.hasChildren(parsed, index) ? " branch" : " empty");
    gutter.setAttribute("data-line-id", `line_${index}`);
    gutter.textContent = content.hasChildren(parsed, index) ? "▾" : "";
    const editable = new Element("div");
    editable.className = "lineText";
    editable.setAttribute("data-line-id", `line_${index}`);
    editable.contentEditable = "true";
    editable.textContent = line.content;
    row.appendChild(gutter);
    row.appendChild(editable);
    pane.appendChild(row);
  });

  const window = {
    document,
    navigator: {},
    opener: null,
    getSelection() { return selection; },
    setTimeout(callback) { if (typeof callback === "function") callback(); return 1; },
    addEventListener() {},
    close() {},
  };

  const payload = { id: "p289", title: "P289", text, body: text, readOnly: false };
  assert.equal(runtime.initialise(payload, {
    window,
    document,
    content,
    getSelection() { return selection; },
    requestAnimationFrame(callback) { if (typeof callback === "function") callback(); return 1; },
    presentationProbe(kind, count) {
      presentationCounts.set(kind, (presentationCounts.get(kind) || 0) + (Number(count) || 1));
    },
  }), true);

  function rowById(id) {
    return pane.children.find((row) => row.getAttribute("data-line-id") === id) || null;
  }
  function lineById(id) {
    return pane.querySelectorAll(".lineText[data-line-id]").find((line) => line.getAttribute("data-line-id") === id) || null;
  }
  function rowIds() { return pane.children.map((row) => row.getAttribute("data-line-id")); }
  function rowSnapshot() {
    return pane.children.map((row) => {
      const id = row.getAttribute("data-line-id");
      return {
        id,
        depth: Number(row.getAttribute("data-depth")),
        content: lineById(id)?.textContent ?? "",
      };
    });
  }
  function setCaret(id, offset) {
    const target = lineById(id);
    assert.ok(target, `expected ${id}`);
    const point = pointForOffset(target, offset);
    const range = new Range();
    range.setStart(point.container, point.offset);
    range.collapse(true);
    target.focus();
    selection.removeAllRanges();
    selection.addRange(range);
  }
  function press(id, key, modifiers = {}) {
    const target = lineById(id);
    assert.ok(target, `expected ${id}`);
    return pane.dispatch("keydown", { target, key, ...modifiers });
  }
  function activeCaretOffset() {
    const active = document.activeElement;
    if (!active || selection.rangeCount !== 1) return null;
    const range = selection.getRangeAt(0);
    return range.collapsed ? absoluteOffset(active, range.startContainer, range.startOffset) : null;
  }
  function resetPresentationCounts() { presentationCounts.clear(); }
  function counts() { return Object.fromEntries(presentationCounts); }

  return {
    content, pane, document, rowById, lineById, rowIds, rowSnapshot,
    setCaret, press, activeCaretOffset,
    clearCount: () => clearCount,
    resetPresentationCounts,
    counts,
  };
}

function assertNoGlobalProjection(counts) {
  assert.equal(counts["full-pane-enumeration"] || 0, 0);
  assert.equal(counts["recovery-full-scan"] || 0, 0);
}

test("P289 PocketNodeContent owns branch-aware plain split placement at start, middle and end", () => {
  const { content } = loadModules();
  const original = semanticLines(content, "Parent\n  Child\n    Grandchild\nTail");

  const start = content.splitLineAtCaret(original, 0, 0, "new-start");
  assert.equal(start.ok, true);
  assert.equal(start.placement, "before-branch");
  assert.deepEqual(ids(start.lines), ["new-start", "line_0", "line_1", "line_2", "line_3"]);
  assert.deepEqual(plain(start.lines).map(({ id, depth, content: text }) => ({ id, depth, content: text })), [
    { id: "new-start", depth: 0, content: "" },
    { id: "line_0", depth: 0, content: "Parent" },
    { id: "line_1", depth: 1, content: "Child" },
    { id: "line_2", depth: 2, content: "Grandchild" },
    { id: "line_3", depth: 0, content: "Tail" },
  ]);
  assert.equal(content.subtreeEnd(start.lines, 1), 4);

  const middle = content.splitLineAtCaret(original, 0, 3, "new-middle");
  assert.equal(middle.ok, true);
  assert.equal(middle.placement, "after-branch");
  assert.deepEqual(ids(middle.lines), ["line_0", "line_1", "line_2", "new-middle", "line_3"]);
  assert.equal(middle.lines[0].content, "Par");
  assert.equal(middle.lines[1].id, "line_1");
  assert.equal(middle.lines[1].depth, 1);
  assert.equal(middle.lines[2].id, "line_2");
  assert.equal(middle.lines[2].depth, 2);
  assert.equal(middle.lines[3].content, "ent");
  assert.equal(content.subtreeEnd(middle.lines, 0), 3);

  const end = content.splitLineAtCaret(original, 0, 6, "new-end");
  assert.equal(end.ok, true);
  assert.equal(end.placement, "after-branch");
  assert.deepEqual(ids(end.lines), ["line_0", "line_1", "line_2", "new-end", "line_3"]);
  assert.equal(end.lines[0].content, "Parent");
  assert.equal(end.lines[3].content, "");
  assert.equal(content.subtreeEnd(end.lines, 0), 3);

  assert.deepEqual(plain(original), [
    { id: "line_0", depth: 0, content: "Parent" },
    { id: "line_1", depth: 1, content: "Child" },
    { id: "line_2", depth: 2, content: "Grandchild" },
    { id: "line_3", depth: 0, content: "Tail" },
  ]);
});

test("P289 semantic owner keeps list continuation after the whole branch and preserves list exit", () => {
  const { content } = loadModules();

  const numbered = semanticLines(content, "1. Parent\n  Child\n    Grandchild\nTail");
  const continued = content.splitLineAtCaret(numbered, 0, 9, "new-number");
  assert.equal(continued.ok, true);
  assert.equal(continued.placement, "after-branch");
  assert.deepEqual(ids(continued.lines), ["line_0", "line_1", "line_2", "new-number", "line_3"]);
  assert.equal(continued.lines[3].content, "2. ");
  assert.equal(content.subtreeEnd(continued.lines, 0), 3);

  const exitLines = semanticLines(content, "1. \n  Child\n    Grandchild\nTail");
  const exited = content.splitLineAtCaret(exitLines, 0, 3, "unused-id");
  assert.equal(exited.ok, true);
  assert.equal(exited.kind, "list-exit");
  assert.deepEqual(ids(exited.lines), ["line_0", "line_1", "line_2", "line_3"]);
  assert.equal(exited.lines[0].content, "");
  assert.equal(exited.lines[1].depth, 1);
  assert.equal(exited.lines[2].depth, 2);
  assert.equal(content.subtreeEnd(exited.lines, 0), 3);
});

test("P289 semantic join rejoins a following plain leaf into the preceding branch head without consuming descendants", () => {
  const { content } = loadModules();
  const original = semanticLines(content, "Parent\n  Child\n    Grandchild\nTail");
  const split = content.splitLineAtCaret(original, 0, 3, "right-half");
  assert.equal(split.ok, true);
  const joined = content.joinPlainSiblingAtStart(split.lines, 3, 0);
  assert.equal(joined.ok, true);
  assert.equal(joined.survivorId, "line_0");
  assert.equal(joined.removedId, "right-half");
  assert.equal(joined.focusOffset, 3);
  assert.deepEqual(ids(joined.lines), ["line_0", "line_1", "line_2", "line_3"]);
  assert.deepEqual(plain(joined.lines), plain(original));

  const currentHasChildren = semanticLines(content, "Parent\nNext\n  Child\nTail");
  assert.equal(content.joinPlainSiblingAtStart(currentHasChildren, 1, 0).ok, false);

  const markerMismatch = semanticLines(content, "1. Parent\n  Child\nPlain");
  assert.equal(content.joinPlainSiblingAtStart(markerMismatch, 2, 0).ok, false);

  const depthMismatch = semanticLines(content, "Parent\n  Child");
  assert.equal(content.joinPlainSiblingAtStart(depthMismatch, 1, 0).ok, false);

  const wrongCaret = semanticLines(content, "Parent\nPlain");
  assert.equal(content.joinPlainSiblingAtStart(wrongCaret, 1, 1).ok, false);
});

test("P289 real PE Enter keeps Parent/Child/Grandchild identity and places the new sibling at the branch boundary", () => {
  const cases = [
    { name: "start", offset: 0, position: 0, parent: "Parent", inserted: "" },
    { name: "middle", offset: 3, position: 3, parent: "Par", inserted: "ent" },
    { name: "end", offset: 6, position: 3, parent: "Parent", inserted: "" },
  ];

  for (const scenario of cases) {
    const h = createHarness("Parent\n  Child\n    Grandchild\nTail");
    const parent = h.rowById("line_0");
    const child = h.rowById("line_1");
    const grandchild = h.rowById("line_2");
    const tail = h.rowById("line_3");
    h.setCaret("line_0", scenario.offset);
    h.resetPresentationCounts();

    const event = h.press("line_0", "Enter");
    assert.equal(event.defaultPrevented, true, scenario.name);
    const insertedId = h.rowIds().find((id) => !["line_0", "line_1", "line_2", "line_3"].includes(id));
    assert.ok(insertedId, scenario.name);
    assert.equal(h.rowIds()[scenario.position], insertedId, scenario.name);
    assert.equal(h.rowById("line_0"), parent, scenario.name);
    assert.equal(h.rowById("line_1"), child, scenario.name);
    assert.equal(h.rowById("line_2"), grandchild, scenario.name);
    assert.equal(h.rowById("line_3"), tail, scenario.name);
    assert.equal(h.lineById("line_0").textContent, scenario.parent, scenario.name);
    assert.equal(h.lineById("line_1").textContent, "Child", scenario.name);
    assert.equal(h.lineById("line_2").textContent, "Grandchild", scenario.name);
    assert.equal(h.lineById(insertedId).textContent, scenario.inserted, scenario.name);
    assert.equal(Number(h.rowById("line_1").getAttribute("data-depth")), 1, scenario.name);
    assert.equal(Number(h.rowById("line_2").getAttribute("data-depth")), 2, scenario.name);
    assert.equal(h.document.activeElement?.getAttribute("data-line-id"), insertedId, scenario.name);
    assert.equal(h.activeCaretOffset(), 0, scenario.name);
    assert.equal(h.clearCount(), 0, scenario.name);
    const counts = h.counts();
    assert.equal(counts["row-create"] || 0, 1, scenario.name);
    assert.equal(counts["row-insert"] || 0, 1, scenario.name);
    assertNoGlobalProjection(counts);
  }
});

test("P289 real PE middle split and Backspace are branch-aware local inverses", () => {
  const h = createHarness("Parent\n  Child\n    Grandchild\nTail");
  const parent = h.rowById("line_0");
  const child = h.rowById("line_1");
  const grandchild = h.rowById("line_2");
  const tail = h.rowById("line_3");

  h.setCaret("line_0", 3);
  h.resetPresentationCounts();
  assert.equal(h.press("line_0", "Enter").defaultPrevented, true);
  const insertedId = h.rowIds().find((id) => !["line_0", "line_1", "line_2", "line_3"].includes(id));
  assert.ok(insertedId);
  assert.deepEqual(h.rowIds(), ["line_0", "line_1", "line_2", insertedId, "line_3"]);
  assert.equal(h.lineById("line_0").textContent, "Par");
  assert.equal(h.lineById(insertedId).textContent, "ent");

  h.setCaret(insertedId, 0);
  h.resetPresentationCounts();
  const backspace = h.press(insertedId, "Backspace");
  assert.equal(backspace.defaultPrevented, true);
  assert.deepEqual(h.rowIds(), ["line_0", "line_1", "line_2", "line_3"]);
  assert.equal(h.rowById("line_0"), parent);
  assert.equal(h.rowById("line_1"), child);
  assert.equal(h.rowById("line_2"), grandchild);
  assert.equal(h.rowById("line_3"), tail);
  assert.equal(h.lineById("line_0").textContent, "Parent");
  assert.equal(h.lineById("line_1").textContent, "Child");
  assert.equal(h.lineById("line_2").textContent, "Grandchild");
  assert.equal(Number(h.rowById("line_1").getAttribute("data-depth")), 1);
  assert.equal(Number(h.rowById("line_2").getAttribute("data-depth")), 2);
  assert.equal(h.document.activeElement?.getAttribute("data-line-id"), "line_0");
  assert.equal(h.activeCaretOffset(), 3);
  assert.equal(h.clearCount(), 0);
  const counts = h.counts();
  assert.equal(counts["row-remove"] || 0, 1);
  assertNoGlobalProjection(counts);
});

test("P289 real PE list continuation lands after descendants and list exit leaves the subtree attached", () => {
  const continued = createHarness("1. Item\n  Child\n    Grandchild\nTail");
  const child = continued.rowById("line_1");
  const grandchild = continued.rowById("line_2");
  continued.setCaret("line_0", 7);
  assert.equal(continued.press("line_0", "Enter").defaultPrevented, true);
  const insertedId = continued.rowIds().find((id) => !["line_0", "line_1", "line_2", "line_3"].includes(id));
  assert.ok(insertedId);
  assert.deepEqual(continued.rowIds(), ["line_0", "line_1", "line_2", insertedId, "line_3"]);
  assert.equal(continued.lineById(insertedId).textContent, "2. ");
  assert.equal(continued.rowById("line_1"), child);
  assert.equal(continued.rowById("line_2"), grandchild);

  const exited = createHarness("1. \n  Child\n    Grandchild\nTail");
  const exitChild = exited.rowById("line_1");
  const exitGrandchild = exited.rowById("line_2");
  exited.setCaret("line_0", 3);
  assert.equal(exited.press("line_0", "Enter").defaultPrevented, true);
  assert.deepEqual(exited.rowIds(), ["line_0", "line_1", "line_2", "line_3"]);
  assert.equal(exited.lineById("line_0").textContent, "");
  assert.equal(exited.rowById("line_1"), exitChild);
  assert.equal(exited.rowById("line_2"), exitGrandchild);
  assert.equal(Number(exited.rowById("line_1").getAttribute("data-depth")), 1);
  assert.equal(Number(exited.rowById("line_2").getAttribute("data-depth")), 2);
});

test("P289 ownership invariant keeps structural meaning in PocketNodeContent and PE keyboard grammar unchanged", () => {
  const contentSource = source("js/pocket-node-content.js");
  const runtime = source("js/pocket-node-popout-runtime.js");

  assert.match(contentSource, /function splitLineAtCaret\(lines, index, caretOffset, newLineId\)/);
  assert.match(contentSource, /function joinPlainSiblingAtStart\(lines, index, caretOffset\)/);
  assert.match(contentSource, /splitLineAtCaret,\s*joinPlainSiblingAtStart,/);

  const insertStart = runtime.indexOf("function insertAfter(");
  const insertEnd = runtime.indexOf("function applyReadOnlyState", insertStart);
  const insertBody = runtime.slice(insertStart, insertEnd);
  assert.match(insertBody, /content\.splitLineAtCaret\(lines, index, caretOffset, proposedId\)/);
  assert.doesNotMatch(insertBody, /content\.smartContinuation|content\.parseMarker|lines\.splice\(index \+ 1/);

  const joinStart = runtime.indexOf("function joinPlainLineAtStart(");
  const joinEnd = runtime.indexOf("function insertAfter(", joinStart);
  const joinBody = runtime.slice(joinStart, joinEnd);
  assert.match(joinBody, /content\.joinPlainSiblingAtStart\(lines, index, caretOffset\)/);
  assert.doesNotMatch(joinBody, /content\.parseMarker|subtreeEnd\(index - 1\)|hasChildren\(index\)/);

  const keydownStart = runtime.indexOf('pane.addEventListener("keydown"');
  const keydownEnd = runtime.indexOf('pane.addEventListener("dragstart"', keydownStart);
  const paneKeydown = runtime.slice(keydownStart, keydownEnd);
  assert.equal((paneKeydown.match(/ev\.key==="Enter"/g) || []).length, 1);
  assert.equal((paneKeydown.match(/ev\.key==="Backspace"/g) || []).length, 1);
  assert.match(paneKeydown, /if\(ev\.key==="Tab"\)\{ev\.preventDefault\(\);indentBranch\(index,ev\.shiftKey\?-1:1\);return;\}/);
  assert.match(paneKeydown, /\(ev\.metaKey\|\|ev\.ctrlKey\).*\(ev\.key==="ArrowUp"\|\|ev\.key==="ArrowDown"\)/);
  assert.doesNotMatch(paneKeydown, /\(ev\.metaKey\|\|ev\.ctrlKey\).*ArrowLeft.*moveBranch|\(ev\.metaKey\|\|ev\.ctrlKey\).*ArrowRight.*moveBranch/);
});
