"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.resolve(__dirname, "..");
const source = (name) => fs.readFileSync(path.join(ROOT, name), "utf8");

function section(text, start, end) {
  const from = text.indexOf(start);
  const to = text.indexOf(end, from + start.length);
  assert.ok(from >= 0 && to > from, `missing section ${start}`);
  return text.slice(from, to);
}

test("P062 no-owner and open-owner shells expose only their intended permanent choices", () => {
  const index = source("index.html");
  const topbar = section(index, '<div class="topbar">', '<p id="vaultRecoveryNotice"');
  const treeHead = section(index, '<div class="panelHead treeHead">', '<div id="treeWrap"');
  const css = source("topbar.css");
  const history = source("js/pocket-history-status.js");
  const render = source("js/pocket-render.js");

  assert.match(index, /<body class="pocketShellClosed">/);
  assert.match(history, /classList\.toggle\("pocketShellOpen", shellOpen\)/);
  assert.match(history, /classList\.toggle\("pocketShellClosed", !shellOpen\)/);
  assert.match(css, /body\.pocketShellClosed:not\(\.pipMode\) \.topbar\s*\{[^}]*display: none !important;/s);
  assert.match(topbar, /<div class="title">pocket<\/div>/);
  assert.match(topbar, /id="search"[^>]*class="[^"]*topbarSearch/);
  assert.match(topbar, /id="btnExportTree"[^>]*>save<\/button>/);
  assert.match(topbar, /id="btnMore"[^>]*>⋯<\/button>/);
  assert.doesNotMatch(treeHead, /id="search"/);
  assert.match(treeHead, /id="focusPath"/);
  assert.match(treeHead, /id="modePill"/);
  assert.match(render, /addAction\("Open"/);
  assert.match(render, /addAction\("New"/);

  for (const id of [
    "btnLoad", "btnOpenSynced", "btnUnfoldAll", "btnAddPrimary", "btnMovePrimary",
    "btnRenamePrimary", "btnDeletePrimary", "btnOpenPrimary", "btnPip", "btnPhoneMode",
  ]) {
    assert.match(topbar, new RegExp(`id="${id}"[^>]*hidden`), id);
    assert.match(css, new RegExp(`#${id.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`), id);
  }
});

test("P068 open shell balances Find and Save while the ordinary tree header stays metadata-only", () => {
  const index = source("index.html");
  const topbar = section(index, '<div class="topbar">', '<p id="vaultRecoveryNotice"');
  const treeHead = section(index, '<div class="panelHead treeHead">', '<div id="treeWrap"');
  const css = source("topbar.css");
  const baseCss = source("styles.css");

  assert.equal((topbar.match(/id="search"/g) || []).length, 1);
  assert.doesNotMatch(treeHead, /class="[^"]*treeSearch/);
  assert.match(topbar, /id="search"[^>]*aria-label="Filter Pocket"/);
  assert.match(topbar, /id="btnExportTree"[^>]*>save<\/button>/);
  assert.match(topbar, /id="btnMore"[^>]*>⋯<\/button>/);
  assert.match(css, /body\.pocketShellOpen:not\(\.pipMode\) \.topbar \{[\s\S]*?display: grid !important;/);
  assert.match(css, /grid-template-columns: repeat\(4, minmax\(0, 1fr\)\)/);
  assert.match(css, /body:not\(\.pipMode\) \.topbar \.grow \{[\s\S]*?flex: 1 1 auto !important;/);
  assert.match(css, /body\.pocketShellOpen\.focusedView \.panelHead\.treeHead/);
  assert.match(css, /body\.pocketShellOpen\.moveModeActive \.panelHead\.treeHead/);
  assert.match(baseCss, /body:not\(.focusedView\):not\(.moveModeActive\) \.panelHead\.treeHead \{[\s\S]*?height: 0;/);
});

test("P069 keeps blank leaf gutters grabbable and Find visibly anchored without focus reflow", () => {
  const css = source("styles.css");
  const topbar = source("topbar.css");
  const actions = source("js/pocket-tree-actions.js");

  assert.match(css, /\.twisty\s*\{[\s\S]*?min-width: 18px;[\s\S]*?min-height: 24px;[\s\S]*?height: 24px;/);
  assert.match(css, /\.twisty\.empty\s*\{[^}]*color: transparent;/);
  assert.match(actions, /recordOp\(\{ type: direction < 0 \? "move_up"[\s\S]*?refreshSaveState\(\)/);
  assert.match(actions, /recordOp\(\{ type: "drag_branch"[\s\S]*?refreshSaveState\(\)/);
  assert.match(topbar, /body\.pocketShellOpen:not\(\.pipMode\) \.topbar #search\s*\{[\s\S]*?border: 1px solid/);
  assert.match(topbar, /#search:focus,[\s\S]*?#search:not\(:placeholder-shown\)[\s\S]*?width: min\(150px, 100%\)/);
});

test("P062 app menu contains Pocket actions only and reuses established doorways", () => {
  const index = source("index.html");
  const appMenu = section(index, '<div id="commandOverlay"', '<div id="pocketOpenOverlay"');
  const openMenu = section(index, '<div id="pocketOpenOverlay"', '<div id="storageOverlay"');
  const storageMenu = section(index, '<div id="storageOverlay"', '<div id="filePermissionOverlay"');
  const overlays = source("js/pocket-overlays-init.js");

  for (const id of ["cmdOpenPocket", "cmdNewPocket", "cmdStorage", "cmdHelp"]) {
    assert.match(appMenu, new RegExp(`id="${id}"`));
  }
  for (const id of ["cmdAddChild", "cmdAddSibling", "cmdRename", "cmdEdit", "cmdMove", "cmdFocus", "cmdSearch", "cmdSave", "cmdHealth", "cmdRestoreRecent"]) {
    assert.doesNotMatch(appMenu, new RegExp(`id="${id}"`), id);
  }
  assert.match(openMenu, /id="cmdOpenFile"/);
  assert.match(openMenu, /id="cmdOpenSyncedPocket"/);
  assert.match(storageMenu, /id="cmdCreateVault"/);
  assert.match(storageMenu, /id="cmdExportVaultJson"/);
  assert.match(storageMenu, /id="cmdSync"/);
  assert.doesNotMatch(storageMenu, /Health check|earlier device version/i);
  assert.match(overlays, /typeof openPocketFile === "function"/);
  assert.match(overlays, /typeof createNewPocketFile === "function"/);
  assert.match(overlays, /el\.btnOpenSynced\?\.click\?\.\(\)/);
  assert.match(overlays, /PocketVaultBrowserIo\?\.createActiveVault/);
  assert.match(overlays, /PocketVaultBrowserIo\?\.convertActiveVaultToJson/);
  assert.match(overlays, /else if \(action === "help"\) showQuickKeys\(\)/);
});

test("P062 search, Save and safety gates retain their established owners", () => {
  const overlays = source("js/pocket-overlays-init.js");
  const io = source("js/pocket-io-browser.js");

  assert.match(overlays, /if \(key === "f"\)[\s\S]*?el\.search\.focus/);
  assert.match(overlays, /el\.btnExportTree\.addEventListener\("click", saveCurrentContext\)/);
  assert.match(overlays, /isPocketVaultRecoveryFlowOpen/);
  assert.match(overlays, /isPocketFilePermissionPromptOpen/);
  assert.match(overlays, /isPocketDeviceChangesDecisionOpen/);
  assert.match(io, /async function openPocketFile\(\)/);
  assert.match(io, /async function createNewPocketFile\(\)/);
  assert.match(io, /function payloadForNewPocketFile\(\)/);
});

test("P062 phone and build plumbing remain available without visible shell controls", () => {
  const index = source("index.html");
  const css = source("topbar.css");
  const build = source("js/pocket-build-label.js");
  const phone = source("js/pocket-phone-mode.js");
  const more = source("js/pocket-more-button.js");

  assert.match(index, /id="btnPhoneMode"[^>]*hidden/);
  assert.match(css, /#btnPhoneMode/);
  assert.match(css, /\.pocketBuildLabel,[\s\S]*display: none !important;/);
  assert.match(build, /global\.POCKET_BUILD/);
  assert.match(build, /label\.hidden = true/);
  assert.match(phone, /global\.PocketPhoneMode = Object\.freeze/);
  assert.match(phone, /more\.id = "btnMore"/);
  assert.match(more, /button\.id = "btnMore"/);
  assert.doesNotMatch(more, /createElement\("button"\)[\s\S]*btnPhoneMode/);
});
