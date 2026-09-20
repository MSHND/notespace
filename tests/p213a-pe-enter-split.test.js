"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { createPeTestDom } = require("./helpers/pe-test-dom");

const ROOT = path.resolve(__dirname, "..");
function source(relativePath) { return fs.readFileSync(path.join(ROOT, relativePath), "utf8"); }

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
  let clearCount = 0;
  let savedPayload = null;
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

  const owner = {
    applyAndSaveFromOwnedPopup(_ownerToken, _popupToken, outgoing) {
      savedPayload = JSON.parse(JSON.stringify(outgoing));
      return {
        ok: true,
        exported: true,
        applied: true,
        nodeUpdatedAt: "2026-09-20T00:00:00.000Z",
        sourceIdentity: {
          fileSessionId: 7,
          sourceFileName: "p213a-test.pocket",
          sourcePipSession: false,
          sourceOwnerKind: "json",
          sourceVaultSessionId: "",
        },
      };
    },
    cancelPendingOpen() {},
    completeCloseFromOwnedPopup() { return true; },
  };

  const window = {
    document,
    navigator: {},
    opener: { closed: false, PocketNodePopoutWindow: owner },
    getSelection() { return selection; },
    setTimeout(callback) { if (typeof callback === "function") callback(); return 1; },
    addEventListener() {},
    close() {},
  };

  const payload = {
    id: "p213a",
    title: "P213a",
    text,
    body: text,
    readOnly: false,
    popupOwnerToken: "owner-token",
    popupInstanceToken: "popup-token",
    fileSessionId: 7,
    sourceFileName: "p213a-test.pocket",
    sourcePipSession: false,
    sourceOwnerKind: "json",
    sourceVaultSessionId: "",
    originalUpdatedAt: "2026-09-20T00:00:00.000Z",
  };

  assert.equal(runtime.initialise(payload, {
    window,
    document,
    content,
    getSelection() { return selection; },
    requestAnimationFrame(callback) { if (typeof callback === "function") callback(); return 1; },
  }), true);

  function rowById(id) {
    return pane.children.find((row) => row.getAttribute("data-line-id") === id) || null;
  }
  function lineById(id) {
    return pane.querySelectorAll(".lineText[data-line-id]").find((line) => line.getAttribute("data-line-id") === id) || null;
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
  function pressEnter(id) {
    const target = lineById(id);
    assert.ok(target, `expected ${id}`);
    return pane.dispatch("keydown", { target, key: "Enter" });
  }
  function activeCaretOffset() {
    const active = document.activeElement;
    if (!active || selection.rangeCount !== 1) return null;
    const range = selection.getRangeAt(0);
    return absoluteOffset(active, range.startContainer, range.startOffset);
  }
  function saveAndReadPayload() {
    controls.get("saveBtn").dispatch("click");
    return savedPayload;
  }

  return {
    pane,
    document,
    selection,
    rowById,
    lineById,
    setCaret,
    pressEnter,
    activeCaretOffset,
    saveAndReadPayload,
    clearCount: () => clearCount,
  };
}

test("P213a actual plain-row Enter keydown path splits at collapsed caret for end, middle and beginning", () => {
  const cases = [
    { name: "end", offset: 5, source: "Alpha", next: "", serialised: "Alpha\n\nTail" },
    { name: "middle", offset: 2, source: "Al", next: "pha", serialised: "Al\npha\nTail" },
    { name: "beginning", offset: 0, source: "", next: "Alpha", serialised: "\nAlpha\nTail" },
  ];

  for (const scenario of cases) {
    const h = createHarness("Alpha\nTail");
    const sourceRow = h.rowById("line_0");
    const tailRow = h.rowById("line_1");
    const beforeRows = [...h.pane.children];

    h.setCaret("line_0", scenario.offset);
    const event = h.pressEnter("line_0");

    assert.equal(event.defaultPrevented, true, scenario.name);
    assert.equal(h.pane.children.length, beforeRows.length + 1, scenario.name);
    assert.equal(h.rowById("line_0"), sourceRow, scenario.name);
    assert.equal(h.rowById("line_1"), tailRow, scenario.name);

    const insertedRow = h.pane.children[1];
    const insertedId = insertedRow.getAttribute("data-line-id");
    assert.ok(insertedId && !["line_0", "line_1"].includes(insertedId), scenario.name);
    assert.equal(h.lineById("line_0").textContent, scenario.source, scenario.name);
    assert.equal(h.lineById(insertedId).textContent, scenario.next, scenario.name);
    assert.equal(h.document.activeElement?.getAttribute("data-line-id"), insertedId, scenario.name);
    assert.equal(h.selection.getRangeAt(0).collapsed, true, scenario.name);
    assert.equal(h.activeCaretOffset(), 0, scenario.name);
    assert.equal(h.clearCount(), 0, scenario.name);

    const saved = h.saveAndReadPayload();
    assert.ok(saved, scenario.name);
    assert.equal(saved.text, scenario.serialised, scenario.name);
    assert.equal(saved.body, scenario.serialised, scenario.name);
  }
});

test("P213a real keydown path preserves numbered and bulleted continuation plus list exit behaviour", () => {
  for (const scenario of [
    { source: "1. Item", offset: 7, next: "2. ", serialised: "1. Item\n2. \nTail" },
    { source: "- Item", offset: 6, next: "- ", serialised: "- Item\n- \nTail" },
  ]) {
    const h = createHarness(`${scenario.source}\nTail`);
    const sourceRow = h.rowById("line_0");
    const tailRow = h.rowById("line_1");
    h.setCaret("line_0", scenario.offset);
    const event = h.pressEnter("line_0");
    assert.equal(event.defaultPrevented, true);
    assert.equal(h.rowById("line_0"), sourceRow);
    assert.equal(h.rowById("line_1"), tailRow);
    assert.equal(h.pane.children.length, 3);
    const insertedId = h.pane.children[1].getAttribute("data-line-id");
    assert.equal(h.lineById("line_0").textContent, scenario.source);
    assert.equal(h.lineById(insertedId).textContent, scenario.next);
    assert.equal(h.document.activeElement?.getAttribute("data-line-id"), insertedId);
    assert.equal(h.clearCount(), 0);
    assert.equal(h.saveAndReadPayload().text, scenario.serialised);
  }

  const exit = createHarness("1. \nTail");
  const sourceRow = exit.rowById("line_0");
  const tailRow = exit.rowById("line_1");
  exit.setCaret("line_0", 3);
  const event = exit.pressEnter("line_0");
  assert.equal(event.defaultPrevented, true);
  assert.equal(exit.pane.children.length, 2);
  assert.equal(exit.rowById("line_0"), sourceRow);
  assert.equal(exit.rowById("line_1"), tailRow);
  assert.equal(exit.lineById("line_0").textContent, "");
  assert.equal(exit.document.activeElement?.getAttribute("data-line-id"), "line_0");
  assert.equal(exit.clearCount(), 0);
  assert.equal(exit.saveAndReadPayload().text, "\nTail");
});

test("P213a source invariant keeps one PE-row Enter owner and passes collapsed caret offset into semantic insertion", () => {
  const runtime = source("js/pocket-node-popout-runtime.js");
  const keydownStart = runtime.indexOf('pane.addEventListener("keydown"');
  const keydownEnd = runtime.indexOf('pane.addEventListener("dragstart"', keydownStart);
  assert.ok(keydownStart >= 0 && keydownEnd > keydownStart);
  const paneKeydown = runtime.slice(keydownStart, keydownEnd);
  assert.equal((paneKeydown.match(/ev\.key==="Enter"/g) || []).length, 1);
  assert.match(paneKeydown, /var caretOffset=collapsedCaretOffset\(text\);ev\.preventDefault\(\);insertAfter\(index,caretOffset\)/);
  assert.match(runtime, /function insertAfter\(index, caretOffset\)/);
  const start = runtime.indexOf("function insertAfter(");
  const end = runtime.indexOf("function applyReadOnlyState", start);
  assert.ok(start >= 0 && end > start);
  assert.doesNotMatch(runtime.slice(start, end), /pane\.innerHTML/);
});
