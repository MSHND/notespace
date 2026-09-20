"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { createPeTestDom } = require("./helpers/pe-test-dom");

const ROOT = path.resolve(__dirname, "..");

function source(relativePath) {
  return fs.readFileSync(path.join(ROOT, relativePath), "utf8");
}

function plain(value) {
  return JSON.parse(JSON.stringify(value));
}

function loadContent() {
  const context = vm.createContext({ window: {}, TextEncoder });
  context.globalThis = context;
  vm.runInContext(source("js/pocket-node-content.js"), context, { filename: "js/pocket-node-content.js" });
  return context.window.PocketNodeContent;
}

function loadRuntime() {
  const context = vm.createContext({ window: {} });
  vm.runInContext(source("js/pocket-node-popout-runtime.js"), context, { filename: "js/pocket-node-popout-runtime.js" });
  return context.window.PocketNodePopoutRuntime;
}

function createHarness(text, options = {}) {
  const content = loadContent();
  const runtime = loadRuntime();
  const controls = new Map();
  let dirtyMarks = 0;
  let document;

  const peDom = createPeTestDom({
    onClassToggle(name, force) {
      if (name === "isDirty" && force === true) dirtyMarks += 1;
    },
  });
  const { Element } = peDom;

  document = {
    activeElement: null,
    body: new Element("body"),
    createElement(tagName) { return new Element(tagName); },
    getElementById(id) { return controls.get(id) || null; },
    addEventListener() {},
  };
  peDom.bindDocument(document);

  for (const id of [
    "titleInput", "outlinePane", "saveState", "saveBtn", "saveCloseBtn", "unsavedDialog",
    "unsavedSaveBtn", "unsavedDiscardBtn", "unsavedCancelBtn", "closeBtn",
  ]) controls.set(id, new Element(id === "titleInput" ? "input" : id.includes("Btn") ? "button" : "div"));
  controls.get("unsavedDialog").hidden = true;

  const window = {
    document,
    navigator: {},
    opener: null,
    setTimeout(callback) { if (typeof callback === "function") callback(); return 1; },
    addEventListener() {},
    close() {},
  };

  const payload = {
    id: "p207",
    title: "P207",
    text,
    body: text,
    readOnly: options.readOnly === true,
  };

  assert.equal(runtime.initialise(payload, {
    window,
    document,
    content,
    requestAnimationFrame(callback) { if (typeof callback === "function") callback(); return 1; },
  }), true);

  const pane = controls.get("outlinePane");
  const parsed = content.parseLines(text);
  pane.innerHTML = "";
  parsed.forEach((line, index) => {
    const row = new Element("div");
    row.className = "docRow";
    row.setAttribute("data-line-id", `line_${index}`);
    row.setAttribute("data-depth", String(line.depth));
    const editable = new Element("div");
    editable.className = "lineText";
    editable.setAttribute("data-line-id", `line_${index}`);
    editable.contentEditable = options.readOnly === true ? "false" : "true";
    editable.textContent = line.content;
    row.appendChild(editable);
    pane.appendChild(row);
  });

  function lineById(id) {
    return pane.querySelectorAll(".lineText[data-line-id]").find((line) => line.getAttribute("data-line-id") === id) || null;
  }

  function lines() {
    return pane.querySelectorAll(".lineText[data-line-id]").map((line) => ({
      id: line.getAttribute("data-line-id"),
      depth: Number(line.parentNode.getAttribute("data-depth")),
      content: line.textContent,
    }));
  }

  function key(id, keyName, modifiers = {}) {
    const target = lineById(id);
    assert.ok(target, `expected ${id} to be rendered`);
    return pane.dispatch("keydown", { target, key: keyName, ...modifiers });
  }

  return {
    content,
    pane,
    document,
    window,
    lines,
    lineById,
    key,
    dirtyMarks: () => dirtyMarks,
    isDirty: () => window.PocketNodePopoutSession.hasUnsavedChanges(),
  };
}

test("pure empty-line helper removes a middle leaf without changing neighbours", () => {
  const content = loadContent();
  const lines = [
    { id: "a", depth: 0, content: "Alpha" },
    { id: "empty", depth: 0, content: "" },
    { id: "b", depth: 0, content: "Beta" },
  ];
  const result = content.removeEmptyLine(lines, 1);
  assert.equal(result.ok, true);
  assert.deepEqual(plain(result.lines), [lines[0], lines[2]]);
  assert.deepEqual(plain(lines), [
    { id: "a", depth: 0, content: "Alpha" },
    { id: "empty", depth: 0, content: "" },
    { id: "b", depth: 0, content: "Beta" },
  ]);
});

test("pure empty-line helper removes a wrapper and promotes only its descendants one level", () => {
  const content = loadContent();
  const lines = [
    { id: "top", depth: 0, content: "Top" },
    { id: "wrapper", depth: 0, content: "" },
    { id: "child", depth: 1, content: "Child" },
    { id: "grandchild", depth: 2, content: "Grandchild" },
    { id: "sibling", depth: 0, content: "Sibling" },
    { id: "siblingChild", depth: 1, content: "Sibling child" },
  ];
  const result = content.removeEmptyLine(lines, 1);
  assert.equal(result.ok, true);
  assert.deepEqual(plain(result.lines), [
    { id: "top", depth: 0, content: "Top" },
    { id: "child", depth: 0, content: "Child" },
    { id: "grandchild", depth: 1, content: "Grandchild" },
    { id: "sibling", depth: 0, content: "Sibling" },
    { id: "siblingChild", depth: 1, content: "Sibling child" },
  ]);
});

test("pure helper rejects non-empty, sole-line and invalid targets", () => {
  const content = loadContent();
  const nonEmpty = [{ id: "a", depth: 0, content: "A" }, { id: "b", depth: 0, content: "B" }];
  assert.equal(content.removeEmptyLine(nonEmpty, 0).ok, false);
  assert.equal(content.removeEmptyLine([{ id: "only", depth: 0, content: "" }], 0).ok, false);
  assert.equal(content.removeEmptyLine(nonEmpty, -1).ok, false);
  assert.equal(content.removeEmptyLine(nonEmpty, 99).ok, false);
});

test("non-empty Backspace remains native and does not mark a PE structural mutation", () => {
  const harness = createHarness("Alpha\nBeta");
  const event = harness.key("line_0", "Backspace");
  assert.equal(event.defaultPrevented, false);
  assert.equal(harness.dirtyMarks(), 0);
  assert.equal(harness.isDirty(), false);
  assert.deepEqual(harness.lines().map(({ content, depth }) => ({ content, depth })), [
    { content: "Alpha", depth: 0 },
    { content: "Beta", depth: 0 },
  ]);
});

test("empty middle leaf Backspace removes exactly that line, dirties once, and focuses previous", () => {
  const harness = createHarness("Alpha\n\nBeta");
  const event = harness.key("line_1", "Backspace");
  assert.equal(event.defaultPrevented, true);
  assert.equal(harness.dirtyMarks(), 1);
  assert.equal(harness.isDirty(), true);
  assert.deepEqual(harness.lines().map(({ id, content, depth }) => ({ id, content, depth })), [
    { id: "line_0", content: "Alpha", depth: 0 },
    { id: "line_2", content: "Beta", depth: 0 },
  ]);
  assert.equal(harness.document.activeElement?.getAttribute("data-line-id"), "line_0");
});

test("empty first leaf Backspace removes safely and focuses the first survivor", () => {
  const harness = createHarness("\nBeta");
  const event = harness.key("line_0", "Backspace");
  assert.equal(event.defaultPrevented, true);
  assert.equal(harness.dirtyMarks(), 1);
  assert.deepEqual(harness.lines().map(({ id, content, depth }) => ({ id, content, depth })), [
    { id: "line_1", content: "Beta", depth: 0 },
  ]);
  assert.equal(harness.document.activeElement?.getAttribute("data-line-id"), "line_1");
});

test("sole empty line is retained as the usable editor surface", () => {
  const harness = createHarness("");
  const event = harness.key("line_0", "Backspace");
  assert.equal(event.defaultPrevented, false);
  assert.equal(harness.dirtyMarks(), 0);
  assert.deepEqual(harness.lines(), [{ id: "line_0", depth: 0, content: "" }]);
});

test("empty parent Backspace preserves and promotes descendants while unrelated structure stays unchanged", () => {
  const harness = createHarness("Top\n\n  Child\n    Grandchild\nSibling\n  Sibling child");
  const event = harness.key("line_1", "Backspace");
  assert.equal(event.defaultPrevented, true);
  assert.equal(harness.dirtyMarks(), 1);
  assert.deepEqual(harness.lines(), [
    { id: "line_0", depth: 0, content: "Top" },
    { id: "line_2", depth: 0, content: "Child" },
    { id: "line_3", depth: 1, content: "Grandchild" },
    { id: "line_4", depth: 0, content: "Sibling" },
    { id: "line_5", depth: 1, content: "Sibling child" },
  ]);
  assert.equal(harness.document.activeElement?.getAttribute("data-line-id"), "line_0");
});

test("read-only PE Backspace cannot mutate or intercept the empty line", () => {
  const harness = createHarness("Alpha\n\nBeta", { readOnly: true });
  const event = harness.key("line_1", "Backspace");
  assert.equal(event.defaultPrevented, false);
  assert.equal(harness.dirtyMarks(), 0);
  assert.equal(harness.isDirty(), false);
  assert.deepEqual(harness.lines().map(({ content, depth }) => ({ content, depth })), [
    { content: "Alpha", depth: 0 },
    { content: "", depth: 0 },
    { content: "Beta", depth: 0 },
  ]);
});

test("Backspace boundary is narrow and existing Enter, Tab and move routes remain intact", () => {
  const runtimeSource = source("js/pocket-node-popout-runtime.js");
  assert.match(runtimeSource, /if\(ev\.key==="Backspace"&&!ev\.altKey&&!ev\.metaKey&&!ev\.ctrlKey\)\{/);
  assert.match(runtimeSource, /lines\[index\]\.content===""&&lines\.length>1&&lineElement\(lines\[index\]\.id\)===text/);
  assert.match(runtimeSource, /joinPlainLineAtStart\(index,text,backspaceCaretOffset\)/);
  assert.match(runtimeSource, /if\(ev\.key==="Enter"&&!ev\.altKey&&!ev\.metaKey&&!ev\.ctrlKey\)\{var caretOffset=collapsedCaretOffset\(text\);ev\.preventDefault\(\);insertAfter\(index,caretOffset\);return;\}/);
  assert.match(runtimeSource, /if\(ev\.key==="Tab"\)\{ev\.preventDefault\(\);indentBranch\(index,ev\.shiftKey\?-1:1\);return;\}/);
  assert.match(runtimeSource, /if\(\(ev\.metaKey\|\|ev\.ctrlKey\)&&!ev\.shiftKey&&!ev\.altKey&&\(ev\.key==="ArrowUp"\|\|ev\.key==="ArrowDown"\)\)\{ev\.preventDefault\(\);moveBranch\(index,ev\.key==="ArrowUp"\?"up":"down"\);return;\}/);
  assert.equal((runtimeSource.match(/ev\.key==="Backspace"/g) || []).length, 1);
});
