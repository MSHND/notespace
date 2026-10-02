"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const ROOT = path.resolve(__dirname, "..");

function source(file) {
  return fs.readFileSync(path.join(ROOT, file), "utf8");
}

function section(text, startMarker, endMarker) {
  const start = text.indexOf(startMarker);
  const end = text.indexOf(endMarker, start + startMarker.length);
  assert.ok(start >= 0 && end > start, `extractable: ${startMarker}`);
  return text.slice(start, end);
}

function makeShortcutHarness({ moreOpen = false, helpOpen = false } = {}) {
  const overlays = source("js/pocket-overlays-init.js");
  const start = overlays.indexOf("  const handleGlobalShortcuts = (ev) => {");
  const end = overlays.indexOf('\n  window.addEventListener("keydown", handleGlobalShortcuts', start);
  assert.ok(start >= 0 && end > start, "global shortcut owner is extractable");
  const chunk = overlays.slice(start, end);

  class HTMLElement {
    constructor(tagName = "DIV") {
      this.tagName = String(tagName).toUpperCase();
      this.isContentEditable = false;
      this.hidden = true;
      this.classList = { contains() { return false; } };
    }
    closest() { return null; }
  }

  let currentMoreOpen = moreOpen;
  let currentHelpOpen = helpOpen;
  const counters = {
    help: 0,
    more: 0,
    closeMore: 0,
  };

  const context = {
    HTMLElement,
    HTMLInputElement: HTMLElement,
    window: null,
    document: {},
    el: {
      pocketOpenOverlay: null,
      storageOverlay: null,
      search: new HTMLElement("INPUT"),
    },
    state: {
      moveMode: false,
      focusRootId: "",
      selectedId: "node-A",
    },
    cleanText(value, max = 120) { return String(value || "").trim().slice(0, max); },
    isControlsHelpOpen() { return currentHelpOpen; },
    isCommandPaletteOpen() { return currentMoreOpen; },
    openControlsHelp() {
      counters.help += 1;
      currentHelpOpen = true;
      return true;
    },
    openCommandPalette() {
      counters.more += 1;
      currentMoreOpen = true;
      return true;
    },
    closeCommandPalette() {
      counters.closeMore += 1;
      currentMoreOpen = false;
      return true;
    },
    closePocketOpenDoorway() {},
    closeStorageMenu() {},
    closeControlsHelp() { currentHelpOpen = false; },
    activePendingDeleteNodeId() { return ""; },
    cancelPendingDeleteGuard() {},
    isDetailsEditorOpen() { return false; },
    closeDetailsEditor() {},
    toggleMoveMode() {},
    clearFilterAndReturnHome() {},
    clearFocusAndReturnHome() {},
    undoMostRecentTreeMutation() {},
    refocusTreeNavigation() {},
    saveCurrentContext() {},
    sortNodesForParent() { return []; },
    shouldCopyOnSingleClick() { return false; },
    copyText() { return Promise.resolve(true); },
    nodeMap() { return new Map(); },
  };
  context.window = context;
  context.window.isPocketVaultRecoveryFlowOpen = () => false;
  context.window.isPocketDeviceChangesDecisionOpen = () => false;
  context.window.settlePocketPendingFilterRender = () => false;

  vm.createContext(context);
  vm.runInContext(`${chunk}\nglobalThis.__handleGlobalShortcuts = handleGlobalShortcuts;`, context, {
    filename: "js/pocket-overlays-init.js",
  });

  function event(key, options = {}) {
    return {
      key,
      target: options.target || new HTMLElement("DIV"),
      shiftKey: options.shiftKey === true,
      metaKey: options.metaKey === true,
      ctrlKey: options.ctrlKey === true,
      altKey: options.altKey === true,
      defaultPrevented: false,
      propagationStopped: false,
      preventDefault() { this.defaultPrevented = true; },
      stopPropagation() { this.propagationStopped = true; },
    };
  }

  return {
    context,
    counters,
    HTMLElement,
    event,
    dispatch(ev) { context.__handleGlobalShortcuts(ev); return ev; },
    moreOpen() { return currentMoreOpen; },
    helpOpen() { return currentHelpOpen; },
  };
}

test("P315a question mark opens the existing Help owner directly and does not steal editable input", () => {
  const h = makeShortcutHarness();
  const question = h.dispatch(h.event("?", { shiftKey: true }));

  assert.equal(question.defaultPrevented, true);
  assert.equal(question.propagationStopped, true);
  assert.equal(h.counters.help, 1);
  assert.equal(h.counters.more, 0);
  assert.equal(h.helpOpen(), true);

  const editable = makeShortcutHarness();
  const input = new editable.HTMLElement("INPUT");
  const typedQuestion = editable.dispatch(editable.event("?", { shiftKey: true, target: input }));

  assert.equal(typedQuestion.defaultPrevented, false);
  assert.equal(typedQuestion.propagationStopped, false);
  assert.equal(editable.counters.help, 0);
  assert.equal(editable.counters.more, 0);

  const contentEditable = makeShortcutHarness();
  const editableDiv = new contentEditable.HTMLElement("DIV");
  editableDiv.isContentEditable = true;
  const contentQuestion = contentEditable.dispatch(contentEditable.event("?", {
    shiftKey: true,
    target: editableDiv,
  }));

  assert.equal(contentQuestion.defaultPrevented, false);
  assert.equal(contentEditable.counters.help, 0);
});

test("P315a slash and Ctrl/Cmd+K remain More while question mark from More converges to Help", () => {
  const slash = makeShortcutHarness();
  const slashEvent = slash.dispatch(slash.event("/"));
  assert.equal(slashEvent.defaultPrevented, true);
  assert.equal(slash.counters.more, 1);
  assert.equal(slash.counters.help, 0);

  const commandK = makeShortcutHarness();
  const kEvent = commandK.dispatch(commandK.event("k", { ctrlKey: true }));
  assert.equal(kEvent.defaultPrevented, true);
  assert.equal(commandK.counters.more, 1);
  assert.equal(commandK.counters.help, 0);

  const fromMore = makeShortcutHarness({ moreOpen: true });
  const helpEvent = fromMore.dispatch(fromMore.event("?", { shiftKey: true }));
  assert.equal(helpEvent.defaultPrevented, true);
  assert.equal(fromMore.counters.closeMore, 1);
  assert.equal(fromMore.counters.help, 1);
  assert.equal(fromMore.moreOpen(), false);
  assert.equal(fromMore.helpOpen(), true);
});

test("P315a visible Help and More share the fourth semantic topbar column", () => {
  const index = source("index.html");
  const css = source("topbar.css");
  const state = source("js/pocket-state.js");
  const overlays = source("js/pocket-overlays-init.js");

  const topbar = section(index, '<div class="topbar">', '<p id="vaultRecoveryNotice"');
  const utilities = section(topbar, '<div class="topbarUtilities"', "</div>");

  assert.match(utilities, /id="btnHelp"[^>]*>\?<\/button>/);
  assert.match(utilities, /id="btnMore"[^>]*>⋯<\/button>/);
  assert.match(state, /btnHelp: document\.getElementById\("btnHelp"\)/);
  assert.match(overlays, /el\.btnHelp\?\.addEventListener\("click", openControlsHelp\)/);

  assert.match(css, /grid-template-columns: repeat\(4, minmax\(0, 1fr\)\) !important/);
  assert.doesNotMatch(css, /grid-template-columns: repeat\(5,/);
  assert.match(
    css,
    /\.topbar \.topbarUtilities \{[\s\S]*?grid-column: 4;[\s\S]*?display: inline-flex !important;[\s\S]*?justify-content: flex-end !important;/,
  );
  assert.doesNotMatch(css, /\.topbarUtilities[\s\S]{0,220}position:\s*absolute/);
});

test("P315a More > Help and visible Help converge on the same existing controls owner", () => {
  const overlays = source("js/pocket-overlays-init.js");

  assert.match(overlays, /function openControlsHelp\(\)/);
  assert.match(overlays, /function showQuickKeys\(\) \{\s*openControlsHelp\(\);\s*\}/);
  assert.match(overlays, /else if \(action === "help"\) showQuickKeys\(\)/);
  assert.match(overlays, /el\.cmdHelp\?\.addEventListener\("click", \(\) => runCommandPaletteAction\("help"\)\)/);
  assert.match(overlays, /el\.btnHelp\?\.addEventListener\("click", openControlsHelp\)/);
  assert.equal((overlays.match(/function openControlsHelp\(/g) || []).length, 1);
});

test("P315a Help copy is current, compact and no longer teaches retired period or Space behaviour", () => {
  const index = source("index.html");
  const help = section(index, '<div id="controlsOverlay"', '<div id="detailOverlay"');

  assert.doesNotMatch(help, /row actions live on right-click \/ \./i);
  assert.doesNotMatch(help, /Right-click \/ \.<\/span>/i);
  assert.doesNotMatch(help, /Space<\/span><span class="controlMeaning">fold or unfold children/i);

  for (const expected of [
    "open Help / controls",
    "Type · Backspace · Esc",
    "Ctrl/Cmd + F",
    "+ / =",
    "Enter / Double-click",
    "Arrow keys / Ctrl/Cmd + Arrow",
    "Ctrl/Cmd + C",
    "Shift + F",
    "Delete / -",
    "Enter or Space confirms while armed; Esc cancels",
    "Ctrl/Cmd + , / .",
    "fold all / unfold all",
    "Right-click / Context Menu / Shift+F10",
    "/ · Ctrl/Cmd + K",
    "Ctrl/Cmd + S",
  ]) {
    assert.ok(help.includes(expected), expected);
  }
});
