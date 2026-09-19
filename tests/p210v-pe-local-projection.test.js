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

function createHarness(text) {
  const { content, runtime } = loadModules();
  const controls = new Map();
  let document;
  let ranges = [];
  let clearCount = 0;
  let runtimeCreateCount = 0;
  const presentationCounts = new Map();

  const peDom = createPeTestDom({
    onInnerHTMLClear() { clearCount += 1; },
  });
  const { Element, Range, selection, absoluteOffset, pointForOffset } = peDom;

  document = {
    activeElement: null,
    body: new Element("body"),
    createElement(tagName) { runtimeCreateCount += 1; return new Element(tagName); },
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
    row.appendChild(gutter); row.appendChild(editable); pane.appendChild(row);
  });

  const window = {
    document, navigator: {}, opener: null,
    getSelection() { return selection; },
    setTimeout(callback) { if (typeof callback === "function") callback(); return 1; },
    addEventListener() {}, close() {},
  };

  let api = null;
  const payload = { id: "p210v", title: "P210v", text, body: text, readOnly: false };
  assert.equal(runtime.initialise(payload, {
    window, document, content,
    getSelection() { return selection; },
    requestAnimationFrame(callback) { if (typeof callback === "function") callback(); return 1; },
    presentationProbe(kind, count) {
      presentationCounts.set(kind, (presentationCounts.get(kind) || 0) + (Number(count) || 1));
    },
    probe(value) { api = value; },
  }), true);
  assert.ok(api);

  function rowById(id) {
    return pane.children.find((row) => row.getAttribute("data-line-id") === id) || null;
  }
  function lineById(id) {
    return pane.querySelectorAll(".lineText[data-line-id]").find((line) => line.getAttribute("data-line-id") === id) || null;
  }
  function gutterById(id) {
    return pane.querySelectorAll(".lineGutter[data-line-id]").find((gutter) => gutter.getAttribute("data-line-id") === id) || null;
  }
  function rowIds() { return pane.children.map((row) => row.getAttribute("data-line-id")); }
  function rowState(id) {
    const row = rowById(id), line = lineById(id), gutter = gutterById(id);
    return row ? {
      row,
      depth: Number(row.getAttribute("data-depth")),
      text: line ? line.textContent : null,
      gutterClass: gutter ? gutter.className : null,
      gutterText: gutter ? gutter.textContent : null,
    } : null;
  }
  function setSelection(id, startOffset, endOffset = startOffset) {
    const target = lineById(id); assert.ok(target, `expected ${id}`);
    const start = pointForOffset(target, startOffset), end = pointForOffset(target, endOffset);
    const range = new Range();
    range.setStart(start.container, start.offset);
    range.setEnd(end.container, end.offset);
    target.focus(); selection.removeAllRanges(); selection.addRange(range);
  }
  function newRowsComparedWith(beforeRows) {
    const before = new Set(beforeRows);
    return pane.children.filter((row) => !before.has(row));
  }

  return {
    api, pane, document, rowById, lineById, gutterById, rowIds, rowState, setSelection,
    buildText: () => api.buildText(),
    semantic: () => plain(api.lines()),
    collapsed: () => plain(api.collapsed()),
    clearCount: () => clearCount,
    runtimeCreateCount: () => runtimeCreateCount,
    newRowsComparedWith,
    resetPresentationCounts() { presentationCounts.clear(); },
    presentationCounts() { return Object.fromEntries(presentationCounts); },
  };
}

test("P210v/P210w source invariant keeps full reconstruction recovery-only and ordinary structural operations transaction-local", () => {
  const runtime = source("js/pocket-node-popout-runtime.js");
  assert.match(runtime, /function rebuildProjectionForRecovery\(/);
  assert.equal((runtime.match(/pane\.innerHTML\s*=\s*""/g) || []).length, 1);
  assert.doesNotMatch(runtime, /\bfunction render\(|\brender\s*\(|\bfunction patchProjection\(|\bpatchProjection\s*\(/);
  assert.match(runtime, /var rowRegistry = new Map\(\)/);
  assert.match(runtime, /function seedPresentationIndex\(/);
  assert.match(runtime, /function rowForId\(/);
  const start = runtime.indexOf("function ingestPlainTextPaste");
  const end = runtime.indexOf("function applyReadOnlyState", start);
  assert.ok(start >= 0 && end > start);
  const operations = runtime.slice(start, end);
  assert.doesNotMatch(operations, /pane\.innerHTML|pane\.children|querySelectorAll|rebuildProjectionForRecovery|full-pane-enumeration|patchProjection|content\.visibleIndexes/);
  for (const name of ["ingestPlainTextPaste", "toggleBranch", "indentBranch", "moveBranch", "removeEmptyLine", "moveBranchBefore", "insertAfter"]) {
    const at = operations.indexOf(`function ${name}`);
    assert.ok(at >= 0, name);
  }
});
test("P210v Enter inserts one local row, preserves unaffected identity, focuses it, and keeps list semantics", () => {
  const h = createHarness("Alpha\nTail");
  const beforeRows = [...h.pane.children];
  const alpha = h.rowById("line_0"), tail = h.rowById("line_1");
  const nextId = h.api.insertAfter(0);
  assert.equal(h.buildText(), "Alpha\n\nTail");
  assert.equal(h.rowById("line_0"), alpha);
  assert.equal(h.rowById("line_1"), tail);
  assert.deepEqual(h.newRowsComparedWith(beforeRows).length, 1);
  assert.deepEqual(h.rowIds(), ["line_0", nextId, "line_1"]);
  assert.equal(h.document.activeElement?.getAttribute("data-line-id"), nextId);
  assert.equal(h.clearCount(), 0);

  const numbered = createHarness("1. Item\nTail");
  const numberedTail = numbered.rowById("line_1");
  const numberedId = numbered.api.insertAfter(0);
  assert.equal(numbered.buildText(), "1. Item\n2. \nTail");
  assert.equal(numbered.rowById("line_1"), numberedTail);
  assert.equal(numbered.lineById(numberedId).textContent, "2. ");
  assert.equal(numbered.clearCount(), 0);

  const exit = createHarness("1. \nTail");
  const exitRow = exit.rowById("line_0"), exitTail = exit.rowById("line_1");
  const exitId = exit.api.insertAfter(0);
  assert.equal(exitId, "line_0");
  assert.equal(exit.buildText(), "\nTail");
  assert.equal(exit.rowById("line_0"), exitRow);
  assert.equal(exit.rowById("line_1"), exitTail);
  assert.equal(exit.lineById("line_0").textContent, "");
  assert.deepEqual(exit.rowIds(), ["line_0", "line_1"]);
  assert.equal(exit.clearCount(), 0);
});

test("P210v empty-line Backspace transaction removes only that row, promotes descendants in place, and preserves survivor focus rule", () => {
  const h = createHarness("Top\n\n  Child\n    Grand\nSibling");
  const top = h.rowById("line_0"), removed = h.rowById("line_1");
  const child = h.rowById("line_2"), grand = h.rowById("line_3"), sibling = h.rowById("line_4");
  assert.equal(h.api.removeEmptyLine(1), true);
  assert.equal(h.rowById("line_1"), null);
  assert.ok(removed.parentNode === null);
  assert.equal(h.rowById("line_0"), top);
  assert.equal(h.rowById("line_2"), child);
  assert.equal(h.rowById("line_3"), grand);
  assert.equal(h.rowById("line_4"), sibling);
  assert.equal(h.rowState("line_2").depth, 0);
  assert.equal(h.rowState("line_3").depth, 1);
  assert.equal(h.buildText(), "Top\nChild\n  Grand\nSibling");
  assert.equal(h.document.activeElement?.getAttribute("data-line-id"), "line_0");
  assert.equal(h.clearCount(), 0);
});

test("P210v indent/outdent patches only affected depth while preserving row identity and neighbouring gutter correctness", () => {
  const h = createHarness("Parent\nChild\nTail");
  const parent = h.rowById("line_0"), child = h.rowById("line_1"), tail = h.rowById("line_2");
  assert.equal(h.api.indentBranch(1, 1), true);
  assert.equal(h.buildText(), "Parent\n  Child\nTail");
  assert.equal(h.rowById("line_0"), parent);
  assert.equal(h.rowById("line_1"), child);
  assert.equal(h.rowById("line_2"), tail);
  assert.equal(h.rowState("line_1").depth, 1);
  assert.equal(h.rowState("line_0").gutterClass, "lineGutter branch");
  assert.equal(h.rowState("line_0").gutterText, "▾");

  assert.equal(h.api.indentBranch(1, -1), true);
  assert.equal(h.buildText(), "Parent\nChild\nTail");
  assert.equal(h.rowById("line_0"), parent);
  assert.equal(h.rowById("line_1"), child);
  assert.equal(h.rowById("line_2"), tail);
  assert.equal(h.rowState("line_1").depth, 0);
  assert.equal(h.rowState("line_0").gutterClass, "lineGutter empty");
  assert.equal(h.rowState("line_0").gutterText, "");
  assert.equal(h.clearCount(), 0);
});

test("P210v collapse removes only hidden descendants and expand materialises only required descendants", () => {
  const h = createHarness("Parent\n  Child\nTail");
  const parent = h.rowById("line_0"), childBefore = h.rowById("line_1"), tail = h.rowById("line_2");
  assert.equal(h.api.toggleBranch(0), true);
  assert.deepEqual(h.collapsed(), ["line_0"]);
  assert.equal(h.rowById("line_0"), parent);
  assert.equal(h.rowById("line_1"), null);
  assert.equal(h.rowById("line_2"), tail);
  assert.equal(h.rowState("line_0").gutterText, "▸");
  assert.ok(childBefore.parentNode === null);

  const rowsBeforeExpand = [...h.pane.children];
  assert.equal(h.api.toggleBranch(0), true);
  assert.deepEqual(h.collapsed(), []);
  assert.equal(h.rowById("line_0"), parent);
  assert.equal(h.rowById("line_2"), tail);
  assert.notEqual(h.rowById("line_1"), childBefore);
  assert.equal(h.newRowsComparedWith(rowsBeforeExpand).length, 1);
  assert.equal(h.rowState("line_0").gutterText, "▾");
  assert.equal(h.clearCount(), 0);
});

test("P210v Ctrl/Cmd branch move reorders existing row objects rather than recreating them", () => {
  const h = createHarness("One\nTwo\nThree");
  const one = h.rowById("line_0"), two = h.rowById("line_1"), three = h.rowById("line_2");
  assert.equal(h.api.moveBranch(1, "up"), true);
  assert.equal(h.buildText(), "Two\nOne\nThree");
  assert.deepEqual(h.rowIds(), ["line_1", "line_0", "line_2"]);
  assert.equal(h.rowById("line_0"), one);
  assert.equal(h.rowById("line_1"), two);
  assert.equal(h.rowById("line_2"), three);
  assert.equal(h.clearCount(), 0);
});

test("P210v drag/drop branch move reuses the existing subtree DOM and preserves unrelated identity", () => {
  const h = createHarness("A\n  Achild\nB\nC");
  const refs = new Map(h.rowIds().map((id) => [id, h.rowById(id)]));
  assert.equal(h.api.moveBranchBefore("line_0", "line_3"), true);
  assert.equal(h.buildText(), "B\nA\n  Achild\nC");
  assert.deepEqual(h.rowIds(), ["line_2", "line_0", "line_1", "line_3"]);
  for (const [id, row] of refs) assert.equal(h.rowById(id), row, id);
  assert.equal(h.clearCount(), 0);
});

test("P210v multi-line paste replaces only the affected span and preserves unrelated row identity", () => {
  const h = createHarness("Alpha\nBeta\nTail");
  const alpha = h.rowById("line_0"), beta = h.rowById("line_1"), tail = h.rowById("line_2");
  const beforeRows = [...h.pane.children];
  h.setSelection("line_1", 1, 3);
  assert.equal(h.api.ingestPlainTextPaste(1, h.lineById("line_1"), "X\n  Y"), true);
  assert.equal(h.buildText(), "Alpha\nBX\n  Ya\nTail");
  assert.equal(h.rowById("line_0"), alpha);
  assert.equal(h.rowById("line_2"), tail);
  assert.ok(beta.parentNode === null);
  const newRows = h.newRowsComparedWith(beforeRows);
  assert.equal(newRows.length, 2);
  assert.deepEqual(h.rowIds(), ["line_0", newRows[0].getAttribute("data-line-id"), newRows[1].getAttribute("data-line-id"), "line_2"]);
  assert.equal(h.rowState(newRows[0].getAttribute("data-line-id")).text, "BX");
  assert.equal(h.rowState(newRows[1].getAttribute("data-line-id")).text, "Ya");
  assert.equal(h.rowState(newRows[1].getAttribute("data-line-id")).depth, 1);
  assert.equal(h.document.activeElement?.getAttribute("data-line-id"), newRows[1].getAttribute("data-line-id"));
  assert.equal(h.clearCount(), 0);
});


function p210wLines(prefix, unrelatedCount) {
  const lines = [...prefix];
  for (let index = 0; index < unrelatedCount; index += 1) lines.push(`Unrelated ${index}`);
  return lines.join("\n");
}

function p210wCountsAfter(harness, action) {
  harness.resetPresentationCounts();
  action();
  return harness.presentationCounts();
}

function assertNoGlobalPresentationWork(counts) {
  assert.equal(counts["full-pane-enumeration"] || 0, 0);
  assert.equal(counts["recovery-full-scan"] || 0, 0);
}

test("P210w Enter presentation cost is constant from tiny to 1000-row unrelated document", () => {
  function run(unrelated) {
    const h = createHarness(p210wLines(["Alpha", "Tail"], unrelated));
    const farId = `line_${unrelated + 1}`;
    const farRow = h.rowById(farId);
    const counts = p210wCountsAfter(h, () => {
      const inserted = h.api.insertAfter(0);
      assert.ok(inserted);
      assert.equal(h.document.activeElement?.getAttribute("data-line-id"), inserted);
    });
    assert.equal(h.rowById(farId), farRow);
    assert.equal(counts["row-create"] || 0, 1);
    assert.equal(counts["row-insert"] || 0, 1);
    assertNoGlobalPresentationWork(counts);
    return counts;
  }
  const small = run(2);
  const large = run(1000);
  assert.deepEqual(large, small);
});

test("P210w list-exit Enter remains constant and touches no unrelated presentation row", () => {
  function run(unrelated) {
    const h = createHarness(p210wLines(["1. ", "Tail"], unrelated));
    const farId = `line_${unrelated + 1}`;
    const farRow = h.rowById(farId);
    const counts = p210wCountsAfter(h, () => {
      assert.equal(h.api.insertAfter(0), "line_0");
      assert.equal(h.lineById("line_0").textContent, "");
    });
    assert.equal(h.rowById(farId), farRow);
    assert.equal(counts["row-create"] || 0, 0);
    assert.equal(counts["row-remove"] || 0, 0);
    assertNoGlobalPresentationWork(counts);
    return counts;
  }
  assert.deepEqual(run(1000), run(2));
});

test("P210w collapse/expand work scales with subtree, not unrelated visible document size", () => {
  function run(unrelated) {
    const h = createHarness(p210wLines(["Parent", "  Child", "  Child two", "Tail"], unrelated));
    const farId = `line_${unrelated + 3}`;
    const farRow = h.rowById(farId);
    const collapse = p210wCountsAfter(h, () => assert.equal(h.api.toggleBranch(0), true));
    assert.equal(h.rowById(farId), farRow);
    assert.equal(collapse["row-remove"] || 0, 2);
    assertNoGlobalPresentationWork(collapse);
    const expand = p210wCountsAfter(h, () => assert.equal(h.api.toggleBranch(0), true));
    assert.equal(h.rowById(farId), farRow);
    assert.equal(expand["row-create"] || 0, 2);
    assert.equal(expand["row-insert"] || 0, 2);
    assertNoGlobalPresentationWork(expand);
    return { collapse, expand };
  }
  assert.deepEqual(run(1000), run(2));
});

test("P210w indent/outdent work scales with affected subtree only", () => {
  function run(unrelated) {
    const h = createHarness(p210wLines(["Parent", "Child", "  Grandchild", "Tail"], unrelated));
    const farId = `line_${unrelated + 3}`;
    const farRow = h.rowById(farId);
    const indent = p210wCountsAfter(h, () => assert.equal(h.api.indentBranch(1, 1), true));
    assert.equal(h.rowById(farId), farRow);
    assertNoGlobalPresentationWork(indent);
    const outdent = p210wCountsAfter(h, () => assert.equal(h.api.indentBranch(1, -1), true));
    assert.equal(h.rowById(farId), farRow);
    assertNoGlobalPresentationWork(outdent);
    return { indent, outdent };
  }
  assert.deepEqual(run(1000), run(2));
});

test("P210w empty-line removal uses visible neighbours and scales with promoted subtree only", () => {
  function run(unrelated) {
    const h = createHarness(p210wLines(["Top", "", "  Child", "    Grand", "Tail"], unrelated));
    const farId = `line_${unrelated + 4}`;
    const farRow = h.rowById(farId);
    const counts = p210wCountsAfter(h, () => assert.equal(h.api.removeEmptyLine(1), true));
    assert.equal(h.rowById(farId), farRow);
    assert.equal(h.document.activeElement?.getAttribute("data-line-id"), "line_0");
    assert.equal(counts["row-remove"] || 0, 1);
    assertNoGlobalPresentationWork(counts);
    return counts;
  }
  assert.deepEqual(run(1000), run(2));
});

test("P210w Ctrl/Cmd move work is bounded by moved/relationship region", () => {
  function run(unrelated) {
    const h = createHarness(p210wLines(["One", "Two", "Three"], unrelated));
    const farId = `line_${unrelated + 2}`;
    const farRow = h.rowById(farId);
    const counts = p210wCountsAfter(h, () => assert.equal(h.api.moveBranch(1, "up"), true));
    assert.equal(h.rowById(farId), farRow);
    assert.equal(counts["row-move"] || 0, 1);
    assertNoGlobalPresentationWork(counts);
    return counts;
  }
  assert.deepEqual(run(1000), run(2));
});

test("P210w drag/drop move work is bounded by moved branch and direct relationships", () => {
  function run(unrelated) {
    const h = createHarness(p210wLines(["A", "  Achild", "B", "C"], unrelated));
    const farId = `line_${unrelated + 3}`;
    const farRow = h.rowById(farId);
    const counts = p210wCountsAfter(h, () => assert.equal(h.api.moveBranchBefore("line_0", "line_3"), true));
    assert.equal(h.rowById(farId), farRow);
    assert.equal(counts["row-move"] || 0, 2);
    assertNoGlobalPresentationWork(counts);
    return counts;
  }
  assert.deepEqual(run(1000), run(2));
});

test("P210w multi-line paste work is bounded by inserted/replaced span", () => {
  function run(unrelated) {
    const h = createHarness(p210wLines(["Alpha", "Beta", "Tail"], unrelated));
    const farId = `line_${unrelated + 2}`;
    const farRow = h.rowById(farId);
    h.setSelection("line_1", 1, 3);
    const counts = p210wCountsAfter(h, () => {
      assert.equal(h.api.ingestPlainTextPaste(1, h.lineById("line_1"), "X\n  Y"), true);
    });
    assert.equal(h.rowById(farId), farRow);
    assert.equal(counts["row-create"] || 0, 2);
    assert.equal(counts["row-remove"] || 0, 1);
    assert.equal(counts["row-insert"] || 0, 2);
    assertNoGlobalPresentationWork(counts);
    return counts;
  }
  assert.deepEqual(run(1000), run(2));
});

test("P210v full reconstruction remains an explicit exceptional recovery boundary", () => {
  const h = createHarness("Alpha\nBeta");
  const before = [...h.pane.children];
  assert.equal(h.clearCount(), 0);
  assert.equal(h.api.rebuildProjectionForRecovery("line_0", false), true);
  assert.equal(h.clearCount(), 1);
  assert.equal(h.rowIds().length, 2);
  assert.notEqual(h.rowById("line_0"), before[0]);
  assert.notEqual(h.rowById("line_1"), before[1]);
  assert.equal(h.document.activeElement?.getAttribute("data-line-id"), "line_0");
});
