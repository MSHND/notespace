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

function createHarness(text, options = {}) {
  const { content, runtime } = loadModules();
  const controls = new Map();
  let clearCount = 0;
  let dirtyMarks = 0;
  let savedPayload = null;
  const peDom = createPeTestDom({
    onInnerHTMLClear() { clearCount += 1; },
    onClassToggle(name, force) {
      if (name === "isDirty" && force === true) dirtyMarks += 1;
    },
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
    editable.contentEditable = options.readOnly === true ? "false" : "true";
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
          sourceFileName: "p223-test.pocket",
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
    id: "p223",
    title: "P223",
    text,
    body: text,
    readOnly: options.readOnly === true,
    popupOwnerToken: "owner-token",
    popupInstanceToken: "popup-token",
    fileSessionId: 7,
    sourceFileName: "p223-test.pocket",
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
  function setSelection(id, start, end) {
    const target = lineById(id);
    assert.ok(target, `expected ${id}`);
    const startPoint = pointForOffset(target, start);
    const endPoint = pointForOffset(target, end);
    const range = new Range();
    range.setStart(startPoint.container, startPoint.offset);
    range.setEnd(endPoint.container, endPoint.offset);
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
  function saveAndReadPayload() {
    controls.get("saveBtn").dispatch("click");
    return savedPayload;
  }
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

  return {
    pane,
    document,
    selection,
    rowById,
    lineById,
    setCaret,
    setSelection,
    press,
    activeCaretOffset,
    saveAndReadPayload,
    rowSnapshot,
    clearCount: () => clearCount,
    dirtyMarks: () => dirtyMarks,
    isDirty: () => window.PocketNodePopoutSession.hasUnsavedChanges(),
  };
}

test("P223 Enter then Backspace is an exact local inverse for a middle plain-row split", () => {
  const h = createHarness("Alpha\nTail");
  const alphaRow = h.rowById("line_0");
  const tailRow = h.rowById("line_1");

  h.setCaret("line_0", 2);
  assert.equal(h.press("line_0", "Enter").defaultPrevented, true);
  const insertedRow = h.pane.children[1];
  const insertedId = insertedRow.getAttribute("data-line-id");
  assert.ok(insertedId && !["line_0", "line_1"].includes(insertedId));
  assert.equal(h.lineById("line_0").textContent, "Al");
  assert.equal(h.lineById(insertedId).textContent, "pha");

  h.setCaret(insertedId, 0);
  const backspace = h.press(insertedId, "Backspace");
  assert.equal(backspace.defaultPrevented, true);
  assert.equal(h.rowById("line_0"), alphaRow);
  assert.equal(h.rowById(insertedId), null);
  assert.equal(h.rowById("line_1"), tailRow);
  assert.deepEqual(h.rowSnapshot(), [
    { id: "line_0", depth: 0, content: "Alpha" },
    { id: "line_1", depth: 0, content: "Tail" },
  ]);
  assert.equal(h.document.activeElement?.getAttribute("data-line-id"), "line_0");
  assert.equal(h.activeCaretOffset(), 2);
  assert.equal(h.clearCount(), 0);
  assert.equal(h.saveAndReadPayload().text, "Alpha\nTail");
});

test("P223 Enter then Backspace is an exact local inverse for a beginning plain-row split", () => {
  const h = createHarness("Alpha\nTail");
  const alphaRow = h.rowById("line_0");
  const tailRow = h.rowById("line_1");

  h.setCaret("line_0", 0);
  assert.equal(h.press("line_0", "Enter").defaultPrevented, true);
  const insertedId = h.pane.children[1].getAttribute("data-line-id");
  assert.equal(h.lineById("line_0").textContent, "");
  assert.equal(h.lineById(insertedId).textContent, "Alpha");

  h.setCaret(insertedId, 0);
  assert.equal(h.press(insertedId, "Backspace").defaultPrevented, true);
  assert.equal(h.rowById("line_0"), alphaRow);
  assert.equal(h.rowById(insertedId), null);
  assert.equal(h.rowById("line_1"), tailRow);
  assert.deepEqual(h.rowSnapshot(), [
    { id: "line_0", depth: 0, content: "Alpha" },
    { id: "line_1", depth: 0, content: "Tail" },
  ]);
  assert.equal(h.document.activeElement?.getAttribute("data-line-id"), "line_0");
  assert.equal(h.activeCaretOffset(), 0);
  assert.equal(h.clearCount(), 0);
  assert.equal(h.saveAndReadPayload().text, "Alpha\nTail");
});

test("P223 end split keeps accepted P207 empty-row Backspace as the inverse", () => {
  const h = createHarness("Alpha\nTail");
  const alphaRow = h.rowById("line_0");
  const tailRow = h.rowById("line_1");

  h.setCaret("line_0", 5);
  assert.equal(h.press("line_0", "Enter").defaultPrevented, true);
  const insertedId = h.pane.children[1].getAttribute("data-line-id");
  assert.equal(h.lineById(insertedId).textContent, "");

  h.setCaret(insertedId, 0);
  assert.equal(h.press(insertedId, "Backspace").defaultPrevented, true);
  assert.equal(h.rowById("line_0"), alphaRow);
  assert.equal(h.rowById(insertedId), null);
  assert.equal(h.rowById("line_1"), tailRow);
  assert.deepEqual(h.rowSnapshot(), [
    { id: "line_0", depth: 0, content: "Alpha" },
    { id: "line_1", depth: 0, content: "Tail" },
  ]);
  assert.equal(h.document.activeElement?.getAttribute("data-line-id"), "line_0");
  assert.equal(h.activeCaretOffset(), 5);
  assert.equal(h.clearCount(), 0);
  assert.equal(h.saveAndReadPayload().text, "Alpha\nTail");
});

test("P223 direct plain join preserves survivor identity, unrelated row objects and local rendering", () => {
  const h = createHarness("Alpha\nBeta\nTail");
  const alphaRow = h.rowById("line_0");
  const betaRow = h.rowById("line_1");
  const tailRow = h.rowById("line_2");

  h.setCaret("line_1", 0);
  const event = h.press("line_1", "Backspace");
  assert.equal(event.defaultPrevented, true);
  assert.equal(h.rowById("line_0"), alphaRow);
  assert.equal(h.rowById("line_1"), null);
  assert.equal(betaRow.parentNode, null);
  assert.equal(h.rowById("line_2"), tailRow);
  assert.deepEqual(h.rowSnapshot(), [
    { id: "line_0", depth: 0, content: "AlphaBeta" },
    { id: "line_2", depth: 0, content: "Tail" },
  ]);
  assert.equal(h.document.activeElement?.getAttribute("data-line-id"), "line_0");
  assert.equal(h.activeCaretOffset(), 5);
  assert.equal(h.dirtyMarks(), 1);
  assert.equal(h.isDirty(), true);
  assert.equal(h.clearCount(), 0);
});

test("P223 fail-closes to native Backspace outside a collapsed offset-zero plain boundary", () => {
  {
    const h = createHarness("Alpha\nBeta");
    const rows = [...h.pane.children];
    h.setCaret("line_1", 1);
    assert.equal(h.press("line_1", "Backspace").defaultPrevented, false);
    assert.deepEqual([...h.pane.children], rows);
    assert.equal(h.dirtyMarks(), 0);
  }
  {
    const h = createHarness("Alpha\nBeta");
    const rows = [...h.pane.children];
    h.setSelection("line_1", 0, 1);
    assert.equal(h.press("line_1", "Backspace").defaultPrevented, false);
    assert.deepEqual([...h.pane.children], rows);
    assert.equal(h.dirtyMarks(), 0);
  }
  {
    const h = createHarness("Alpha\n  Beta\nTail");
    const rows = [...h.pane.children];
    h.setCaret("line_1", 0);
    assert.equal(h.press("line_1", "Backspace").defaultPrevented, false);
    assert.deepEqual([...h.pane.children], rows);
    assert.equal(h.dirtyMarks(), 0);
  }
  {
    const h = createHarness("Alpha\nBeta\n  Child\nTail");
    const rows = [...h.pane.children];
    h.setCaret("line_1", 0);
    assert.equal(h.press("line_1", "Backspace").defaultPrevented, false);
    assert.deepEqual([...h.pane.children], rows);
    assert.equal(h.dirtyMarks(), 0);
  }
  for (const text of ["1. One\nTwo", "One\n- Two", "1. One\n2. "]) {
    const h = createHarness(text);
    const rows = [...h.pane.children];
    h.setCaret("line_1", 0);
    assert.equal(h.press("line_1", "Backspace").defaultPrevented, false, text);
    assert.deepEqual([...h.pane.children], rows, text);
    assert.equal(h.dirtyMarks(), 0, text);
  }
  {
    const h = createHarness("Alpha\nBeta");
    const rows = [...h.pane.children];
    h.setCaret("line_0", 0);
    assert.equal(h.press("line_0", "Backspace").defaultPrevented, false);
    assert.deepEqual([...h.pane.children], rows);
    assert.equal(h.dirtyMarks(), 0);
  }
});

test("P223 read-only, modified and composition Backspace variants stay outside the new join", () => {
  {
    const h = createHarness("Alpha\nBeta", { readOnly: true });
    const rows = [...h.pane.children];
    h.setCaret("line_1", 0);
    assert.equal(h.press("line_1", "Backspace").defaultPrevented, false);
    assert.deepEqual([...h.pane.children], rows);
    assert.equal(h.dirtyMarks(), 0);
    assert.equal(h.isDirty(), false);
  }

  const variants = [
    { shiftKey: true },
    { altKey: true },
    { metaKey: true },
    { ctrlKey: true },
    { isComposing: true },
    { keyCode: 229 },
  ];
  for (const modifiers of variants) {
    const h = createHarness("Alpha\nBeta");
    const rows = [...h.pane.children];
    h.setCaret("line_1", 0);
    assert.equal(h.press("line_1", "Backspace", modifiers).defaultPrevented, false, JSON.stringify(modifiers));
    assert.deepEqual([...h.pane.children], rows, JSON.stringify(modifiers));
    assert.equal(h.dirtyMarks(), 0, JSON.stringify(modifiers));
  }
});

test("P223 keeps one PE-row Backspace owner and the join path contains no full-pane rebuild", () => {
  const runtime = source("js/pocket-node-popout-runtime.js");
  const keydownStart = runtime.indexOf('pane.addEventListener("keydown"');
  const keydownEnd = runtime.indexOf('pane.addEventListener("dragstart"', keydownStart);
  assert.ok(keydownStart >= 0 && keydownEnd > keydownStart);
  const paneKeydown = runtime.slice(keydownStart, keydownEnd);
  assert.equal((paneKeydown.match(/ev\.key==="Backspace"/g) || []).length, 1);
  assert.match(paneKeydown, /joinPlainLineAtStart\(index,text,backspaceCaretOffset\)/);
  assert.equal((runtime.match(/ev\.key==="Backspace"/g) || []).length, 1);

  const documentKeydownStart = runtime.indexOf('document.addEventListener("keydown"');
  const documentKeydownEnd = runtime.indexOf('if(typeof window.addEventListener', documentKeydownStart);
  assert.ok(documentKeydownStart >= 0 && documentKeydownEnd > documentKeydownStart);
  assert.doesNotMatch(runtime.slice(documentKeydownStart, documentKeydownEnd), /Backspace/);

  const joinStart = runtime.indexOf("function joinPlainLineAtStart(");
  const joinEnd = runtime.indexOf("function insertAfter(", joinStart);
  assert.ok(joinStart >= 0 && joinEnd > joinStart);
  const joinBody = runtime.slice(joinStart, joinEnd);
  assert.doesNotMatch(joinBody, /pane\.innerHTML/);
  assert.match(joinBody, /content\.parseMarker/);
  assert.match(joinBody, /subtreeEnd\(index - 1\) !== index/);
  assert.match(joinBody, /hasChildren\(index\)/);
});
