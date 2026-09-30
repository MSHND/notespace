"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const ROOT = path.resolve(__dirname, "..");

function source(relativePath) {
  return fs.readFileSync(path.join(ROOT, relativePath), "utf8");
}

function scriptSources() {
  return [...source("index.html").matchAll(/<script\s+src="([^"]+)"/g)].map((match) => match[1]);
}

test("P300 admits first-create and ownerless draft exactly once in dependency-safe production order", () => {
  const scripts = scriptSources();
  const expectedOnce = [
    "js/pocket-sync-first-create.js",
    "js/pocket-sync-ownerless-activation-draft.js",
  ];
  for (const script of expectedOnce) {
    assert.equal(scripts.filter((value) => value === script).length, 1, script);
  }

  const order = [
    "js/pocket-sync-account-client.js",
    "js/pocket-sync-remote-client.js",
    "js/pocket-sync-first-create.js",
    "js/pocket-sync-ownerless-activation-draft.js",
    "js/pocket-sync-activation.js",
    "js/pocket-sync-owner-controller.js",
    "js/pocket-owner-save-boundary.js",
    "js/pocket-sync-activation-owner-bridge.js",
    "js/pocket-sync-browser-runtime.js",
  ].map((script) => scripts.indexOf(script));

  assert.ok(order.every((index) => index >= 0));
  assert.deepEqual([...order].sort((a, b) => a - b), order);
});

test("P300 loading the admitted support modules defines contracts only and performs zero browser/account/remote/file work", () => {
  const calls = {
    fetch: 0,
    credentials: 0,
    indexedDb: 0,
    picker: 0,
  };
  const context = {
    Object,
    Array,
    Number,
    String,
    Boolean,
    JSON,
    Date,
    Error,
    TypeError,
    Promise,
    Set,
    Uint8Array,
    ArrayBuffer,
    TextEncoder,
    TextDecoder,
    atob(value) { return Buffer.from(value, "base64").toString("binary"); },
    btoa(value) { return Buffer.from(value, "binary").toString("base64"); },
    fetch() { calls.fetch += 1; throw new Error("unexpected fetch"); },
    navigator: {
      credentials: {
        create() { calls.credentials += 1; throw new Error("unexpected credential create"); },
        get() { calls.credentials += 1; throw new Error("unexpected credential get"); },
      },
    },
    indexedDB: {
      open() { calls.indexedDb += 1; throw new Error("unexpected IndexedDB open"); },
    },
    showOpenFilePicker() { calls.picker += 1; throw new Error("unexpected picker"); },
    showSaveFilePicker() { calls.picker += 1; throw new Error("unexpected picker"); },
  };
  context.window = context;
  context.globalThis = context;
  vm.createContext(context);

  assert.doesNotThrow(() => vm.runInContext(
    source("js/pocket-sync-first-create.js"),
    context,
    { filename: "js/pocket-sync-first-create.js" }
  ));
  assert.doesNotThrow(() => vm.runInContext(
    source("js/pocket-sync-ownerless-activation-draft.js"),
    context,
    { filename: "js/pocket-sync-ownerless-activation-draft.js" }
  ));

  assert.deepEqual(calls, { fetch: 0, credentials: 0, indexedDb: 0, picker: 0 });
  assert.deepEqual(Object.keys(context.PocketSyncFirstCreate), ["createConductor"]);
  assert.deepEqual(
    Object.keys(context.PocketSyncOwnerlessActivationDraft),
    [
      "POLICY",
      "validate",
      "buildInitialDraft",
      "buildRegistrationStarted",
      "buildRegistrationPending",
      "buildAccountReady",
      "buildContentUploadPending",
      "buildContentConflict",
      "buildContentCommitted",
      "buildDeviceEnvelopePending",
      "buildDeviceEnvelopeConflict",
      "buildDeviceEnvelopeCommitted",
      "buildPrfEnvelopePending",
      "buildPrfEnvelopeConflict",
      "buildPrfEnvelopeCommitted",
      "buildPrfEnvelopeSkipped",
      "buildRecoveryInitialisationPending",
      "buildRecoveryConflict",
      "buildRecoveryInitialised",
      "buildRecoveryCopyPending",
      "buildReadyForAdoption",
      "buildAdopted",
      "classifyReadyForAdoption",
      "classifyAdopted",
      "classifyDiscoveryCandidate",
    ]
  );
});

test("P300 leaves browser runtime public surface and ownerless reachability unchanged", () => {
  const runtimeSource = source("js/pocket-sync-browser-runtime.js");
  const context = {
    Object,
    Array,
    Number,
    String,
    Boolean,
    JSON,
    Date,
    Error,
    Promise,
  };
  context.window = context;
  context.globalThis = context;
  vm.createContext(context);
  assert.doesNotThrow(() => vm.runInContext(runtimeSource, context));

  assert.deepEqual(Object.keys(context.PocketSyncBrowserRuntime), ["createRuntime"]);
  assert.equal(Object.isFrozen(context.PocketSyncBrowserRuntime), true);
  assert.doesNotMatch(
    runtimeSource,
    /ownerless-first-create|PocketSyncOwnerlessActivationDraft|PocketSyncFirstCreate|findOwnerlessActivation/
  );

  const index = source("index.html");
  assert.doesNotMatch(index, /ownerless-first-create|PocketSyncOwnerlessActivationDraft|PocketSyncFirstCreate/);
  for (const uiPath of [
    "js/pocket-sync-ui.js",
    "js/pocket-doorway-capabilities.js",
    "js/pocket-sync-local-integration.js",
  ]) {
    assert.doesNotMatch(
      source(uiPath),
      /ownerless-first-create|PocketSyncOwnerlessActivationDraft|PocketSyncFirstCreate|findOwnerlessActivation/
    );
  }
});

test("P300 preserves current service-worker shell-cache policy for Sync modules", () => {
  const sw = source("sw.js");
  assert.doesNotMatch(sw, /pocket-sync-first-create\.js/);
  assert.doesNotMatch(sw, /pocket-sync-ownerless-activation-draft\.js/);
  assert.doesNotMatch(sw, /pocket-sync-activation\.js/);
  assert.match(sw, /const CACHE_NAME = "pocket-shell-v11";/);
});
