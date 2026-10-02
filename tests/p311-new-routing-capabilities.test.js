"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const ROOT = path.resolve(__dirname, "..");
const CAP = "js/pocket-doorway-capabilities.js";
const source = (file) => fs.readFileSync(path.join(ROOT, file), "utf8");

function readCaps(options = {}) {
  const context = { Object, Boolean, Error };
  context.window = context;
  context.globalThis = context;
  if (options.localOpen) context.showOpenFilePicker = () => {};
  if (options.localNew) context.showSaveFilePicker = () => {};
  context.PocketSyncUi = {
    canOpenExisting() { return options.syncedOpen === true; },
    canCreateNew() {
      if (options.throwNew) throw new Error("synthetic capability failure");
      return options.syncedNew === true;
    },
  };
  vm.createContext(context);
  vm.runInContext(source(CAP), context, { filename: CAP });
  return JSON.parse(JSON.stringify(context.PocketDoorwayCapabilities.read()));
}

test("P311 capability matrix derives syncedNew, anyNew and anyAction", () => {
  for (const [localNew, syncedNew, anyNew] of [
    [false, false, false],
    [true, false, true],
    [false, true, true],
    [true, true, true],
  ]) {
    const got = readCaps({ localNew, syncedNew });
    assert.equal(got.localNew, localNew);
    assert.equal(got.syncedNew, syncedNew);
    assert.equal(got.anyNew, anyNew);
    assert.equal(got.anyAction, anyNew);
    assert.equal(got.anyOpen, false);
  }
  const open = readCaps({ syncedOpen: true });
  assert.equal(open.anyOpen, true);
  assert.equal(open.anyNew, false);
  assert.equal(open.anyAction, true);
});

test("P311 canCreateNew failure fails closed without changing Open truth", () => {
  const got = readCaps({ localOpen: true, syncedOpen: true, syncedNew: true, throwNew: true });
  assert.equal(got.localOpen, true);
  assert.equal(got.syncedOpen, true);
  assert.equal(got.syncedNew, false);
  assert.equal(got.anyOpen, true);
  assert.equal(got.anyNew, false);
  assert.equal(got.anyAction, true);
});

test("P311 capability and New routing surfaces contain no platform sniffing", () => {
  const capabilities = source(CAP);
  const overlays = source("js/pocket-overlays-init.js");
  const start = overlays.indexOf("function closePocketNewDoorway");
  const end = overlays.indexOf("\nfunction closeStorageMenu", start);
  assert.ok(start >= 0 && end > start);
  const doorway = overlays.slice(start, end);
  assert.match(capabilities, /canCreateNew/);
  assert.doesNotMatch(capabilities + doorway, /navigator\.|userAgent|platform|iPad|iPhone|Safari|Chrome|Android/i);
});

test("P311 ordinary New entry points use the one New doorway owner and gate uses anyNew copy", () => {
  const overlays = source("js/pocket-overlays-init.js");
  const actionStart = overlays.indexOf('} else if (action === "new_pocket")');
  const actionEnd = overlays.indexOf('} else if (action === "storage")', actionStart);
  const action = overlays.slice(actionStart, actionEnd);
  assert.match(action, /openPocketNewDoorway\(\)/);
  assert.doesNotMatch(action, /createNewPocketFile|beginCreateNew/);

  const render = source("js/pocket-render.js");
  const gateStart = render.indexOf("function buildPocketFileGateState");
  const gateEnd = render.indexOf("\nlet rowActionMenuEl", gateStart);
  const gate = render.slice(gateStart, gateEnd);
  assert.match(gate, /capabilities\.anyNew/);
  assert.match(gate, /openPocketNewDoorway/);
  assert.match(gate, /capabilities\.anyOpen && capabilities\.anyNew/);
  assert.match(gate, /Start a new Pocket to continue/);
});

test("P311 Doorway stays routing-only", () => {
  const overlays = source("js/pocket-overlays-init.js");
  const start = overlays.indexOf("function closePocketNewDoorway");
  const end = overlays.indexOf("\nfunction closeStorageMenu", start);
  const doorway = overlays.slice(start, end);
  assert.match(doorway, /createNewPocketFile/);
  assert.match(doorway, /beginCreateNew/);
  assert.doesNotMatch(doorway, /accountPath|activationId|ownerless|passkey|syncedPocketId|recoveryPackage|startOwnerlessFirstCreate|continueOwnerlessFirstCreate/i);
});


test("P311 New doorway branch grammar has exactly the four required routing outcomes", () => {
  const overlays = source("js/pocket-overlays-init.js");
  const start = overlays.indexOf("function openPocketNewDoorway()");
  const end = overlays.indexOf("\nfunction closeStorageMenu", start);
  const doorway = overlays.slice(start, end);
  assert.ok(start >= 0 && end > start);
  assert.match(doorway, /if \(!capabilities\.anyNew\) return false/);
  assert.match(doorway, /capabilities\.localNew && !capabilities\.syncedNew/);
  assert.match(doorway, /createNewPocketFile\(\)/);
  assert.match(doorway, /!capabilities\.localNew && capabilities\.syncedNew/);
  assert.match(doorway, /PocketSyncUi\?\.beginCreateNew\?\.\(\) === true/);
  assert.match(doorway, /el\.pocketNewOverlay\.hidden = false/);
  assert.match(doorway, /querySelector\("\.commandBtn:not\(\[disabled\]\):not\(\[hidden\]\)"\)/);
});

test("P311 chooser actions close first and invoke only their selected owner", () => {
  const overlays = source("js/pocket-overlays-init.js");
  const start = overlays.indexOf('el.cmdNewFile?.addEventListener("click"');
  const end = overlays.indexOf('el.cmdStorageClose?.addEventListener("click"', start);
  const bindings = overlays.slice(start, end);
  assert.ok(start >= 0 && end > start);
  assert.match(bindings, /cmdNewFile[\s\S]*closePocketNewDoorway\(\{ restoreFocus: false \}\)[\s\S]*createNewPocketFile\(\)/);
  assert.match(bindings, /cmdNewSyncedPocket[\s\S]*closePocketNewDoorway\(\{ restoreFocus: false \}\)[\s\S]*PocketSyncUi\?\.beginCreateNew\?\.\(\)/);
  assert.match(bindings, /cmdNewCancel[\s\S]*closePocketNewDoorway\(\{ restoreFocus: true \}\)/);
});

test("P311 chooser Cancel and Escape are zero-creation focus-return paths", () => {
  const overlays = source("js/pocket-overlays-init.js");
  const start = overlays.indexOf('el.pocketNewOverlay?.addEventListener("click"');
  const end = overlays.indexOf('document.addEventListener("pointerdown"', start);
  const dismissal = overlays.slice(start, end);
  assert.ok(start >= 0 && end > start);
  assert.match(dismissal, /ev\.key === "Escape"/);
  assert.match(dismissal, /closePocketNewDoorway\(\{ restoreFocus: true \}\)/);
  assert.doesNotMatch(dismissal, /createNewPocketFile|beginCreateNew/);

  const closeStart = overlays.indexOf("function closePocketNewDoorway");
  const closeEnd = overlays.indexOf("\nfunction openPocketNewDoorway", closeStart);
  const close = overlays.slice(closeStart, closeEnd);
  assert.match(close, /el\.btnMore instanceof HTMLElement \? el\.btnMore : el\.treeWrap/);
  assert.match(close, /focus\?\.\(\{ preventScroll: true \}\)/);
});

test("P311 New chooser has the exact routing-only visible choices", () => {
  const index = source("index.html");
  const start = index.indexOf('<div id="pocketNewOverlay"');
  const end = index.indexOf('<div id="storageOverlay"', start);
  const chooser = index.slice(start, end);
  assert.ok(start >= 0 && end > start);
  assert.match(chooser, /class="commandOverlay"/);
  assert.match(chooser, /New a Pocket/);
  assert.match(chooser, /Pocket file…/);
  assert.match(chooser, /Synced Pocket…/);
  assert.match(chooser, />Cancel</);
  assert.doesNotMatch(chooser, /syncSetup|vaultDialog/);
});


test("P311 Open doorway keeps the accepted local and Synced routing branches", () => {
  const overlays = source("js/pocket-overlays-init.js");
  const start = overlays.indexOf("function openPocketDoorway()");
  const end = overlays.indexOf("\nfunction closePocketNewDoorway", start);
  const openDoorway = overlays.slice(start, end);
  assert.ok(start >= 0 && end > start);
  assert.match(openDoorway, /!capabilities\.localOpen && capabilities\.syncedOpen/);
  assert.match(openDoorway, /el\.btnOpenSynced\?\.click\?\.\(\)/);
  assert.match(openDoorway, /capabilities\.localOpen && !capabilities\.syncedOpen/);
  assert.match(openDoorway, /typeof openPocketFile === "function"/);
  assert.match(openDoorway, /capabilities\.anyOpen/);
});
