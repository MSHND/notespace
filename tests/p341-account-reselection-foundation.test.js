"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.resolve(__dirname, "..");
const source = (file) => fs.readFileSync(path.join(ROOT, file), "utf8");

test("P341/P345 reselection authority stays in ordinary Open while UI composes only selector intent", () => {
  const runtime = source("js/pocket-sync-browser-runtime.js");
  const openStart = runtime.indexOf("async function openExisting(input = {})");
  const openEnd = runtime.indexOf("async function recoverExisting()", openStart);
  assert.ok(openStart >= 0 && openEnd > openStart);
  const open = runtime.slice(openStart, openEnd);
  const outsideOpen = runtime.slice(0, openStart) + runtime.slice(openEnd);

  assert.match(open, /accountSelection/);
  assert.match(open, /"choose-another"/);
  assert.match(open, /additionalDevice\.openExisting/);
  assert.doesNotMatch(outsideOpen, /accountSelection|"choose-another"/);

  for (const file of [
    "js/pocket-sync-first-create.js",
    "js/pocket-sync-activation.js",
    "js/pocket-sync-emergency-recovery.js",
    "js/pocket-sync-owner-controller.js",
  ]) {
    const text = source(file);
    assert.doesNotMatch(text, /accountSelection|"choose-another"/, file);
  }

  const ui = source("js/pocket-sync-ui.js");
  assert.match(ui, /integration\.openExisting\(openExistingInput \|\| undefined\)/);
  assert.match(ui, /accountSelection: "choose-another"/);
  assert.doesNotMatch(ui, /authenticatePasskey|registerPasskey|accountLocator|credentialId|document\.cookie/);
});

test("P341 adds no browser-owned account authority, logout route, or cookie manipulation", () => {
  for (const file of [
    "js/pocket-sync-account-client.js",
    "js/pocket-sync-additional-device.js",
    "js/pocket-sync-browser-runtime.js",
    "js/pocket-sync-local-integration.js",
  ]) {
    const text = source(file);
    assert.doesNotMatch(
      text,
      /document\.cookie|localStorage|sessionStorage/,
      file
    );
  }
  const adapter = source("sync-service/pocket-sync-http-adapter.js");
  assert.doesNotMatch(adapter, /choose-another|accountSelection|logout|switch-account/i);
  assert.match(adapter, /__Host-pocket-sync-session/);
  assert.match(adapter, /Secure; HttpOnly; SameSite=Strict/);
});

test("P341 preserves ownerless pinned-account and discovery vocabulary", () => {
  const firstCreate = source("js/pocket-sync-first-create.js");
  const runtime = source("js/pocket-sync-browser-runtime.js");
  assert.match(firstCreate, /status === "ready"/);
  assert.match(firstCreate, /onAccountReady/);
  assert.match(runtime, /accountLocator: pinnedAccountId/);
  assert.match(runtime, /binding\.status === "not-configured"/);
  assert.match(runtime, /binding\.syncedPocketId !== draft\.syncedPocketId/);
});
