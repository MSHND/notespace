"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const ROOT = path.resolve(__dirname, "..");
const OWNER = "js/pocket-native-file-picker-activity.js";
const OVERLAYS = "js/pocket-overlays-init.js";
const IO = "js/pocket-io-browser.js";
const VAULT = "js/pocket-vault-io-browser.js";
const SYNC = "js/pocket-sync-browser-runtime.js";
const OPENING = "js/pocket-file-opening.js";

function source(file) {
  return fs.readFileSync(path.join(ROOT, file), "utf8");
}

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((nextResolve, nextReject) => {
    resolve = nextResolve;
    reject = nextReject;
  });
  return { promise, resolve, reject };
}

function ownerRuntime() {
  const context = { Object, Promise, TypeError, Math };
  context.window = context;
  context.globalThis = context;
  vm.createContext(context);
  vm.runInContext(source(OWNER), context, { filename: OWNER });
  return context;
}

function extractNamedFunction(text, name) {
  const start = text.indexOf(`function ${name}(`);
  assert.ok(start >= 0, `${name} must exist`);
  const open = text.indexOf("{", start);
  assert.ok(open > start, `${name} body must exist`);
  let depth = 0;
  for (let index = open; index < text.length; index += 1) {
    if (text[index] === "{") depth += 1;
    else if (text[index] === "}") {
      depth -= 1;
      if (depth === 0) return text.slice(start, index + 1);
    }
  }
  throw new Error(`${name} body did not close`);
}

test("P257d shared owner is inactive initially, active synchronously while pending, and clears after success", async () => {
  const context = ownerRuntime();
  const owner = context.PocketNativeFilePickerActivity;
  const pending = deferred();

  assert.equal(owner.isActive(), false);
  const resultPromise = owner.run(() => pending.promise);
  assert.equal(owner.isActive(), true);

  pending.resolve("saved");
  assert.equal(await resultPromise, "saved");
  assert.equal(owner.isActive(), false);
});

test("P257d shared owner clears after AbortError and non-abort failure", async () => {
  for (const name of ["AbortError", "NotAllowedError"]) {
    const context = ownerRuntime();
    const owner = context.PocketNativeFilePickerActivity;
    const error = new Error(name);
    error.name = name;

    const resultPromise = owner.run(async () => { throw error; });
    assert.equal(owner.isActive(), true, name);
    await assert.rejects(resultPromise, (caught) => caught?.name === name);
    assert.equal(owner.isActive(), false, name);
  }
});

test("P257d nested picker activity cannot clear ownership early", async () => {
  const context = ownerRuntime();
  const owner = context.PocketNativeFilePickerActivity;
  const first = deferred();
  const second = deferred();

  const firstPromise = owner.run(() => first.promise);
  const secondPromise = owner.run(() => second.promise);
  assert.equal(owner.isActive(), true);

  first.resolve("first");
  assert.equal(await firstPromise, "first");
  assert.equal(owner.isActive(), true, "second pending owner must keep activity active");

  second.resolve("second");
  assert.equal(await secondPromise, "second");
  assert.equal(owner.isActive(), false);
});

test("P257d cause proof: pending picker suppresses actual window-focus tree restoration", async () => {
  let focusCalls = 0;
  let rafCalls = 0;
  class HTMLElement {
    focus() { focusCalls += 1; }
  }

  const context = {
    Object, Promise, TypeError, Math,
    HTMLElement,
    el: { treeWrap: new HTMLElement() },
    isDetailsEditorOpen() { return false; },
    requestAnimationFrame(callback) {
      rafCalls += 1;
      callback();
      return rafCalls;
    },
  };
  context.window = context;
  context.globalThis = context;
  context.isPocketVaultRecoveryFlowOpen = () => false;
  context.isPocketDeviceChangesDecisionOpen = () => false;
  vm.createContext(context);
  vm.runInContext(source(OWNER), context, { filename: OWNER });
  vm.runInContext(extractNamedFunction(source(OVERLAYS), "handleWindowFocusToTree"), context, {
    filename: OVERLAYS,
  });

  const pending = deferred();
  const pickerPromise = context.PocketNativeFilePickerActivity.run(() => pending.promise);
  assert.equal(context.PocketNativeFilePickerActivity.isActive(), true);

  context.handleWindowFocusToTree();
  assert.equal(rafCalls, 0, "active native picker must prevent scheduling tree focus");
  assert.equal(focusCalls, 0);

  pending.resolve("handle");
  await pickerPromise;
  assert.equal(context.PocketNativeFilePickerActivity.isActive(), false);

  context.handleWindowFocusToTree();
  assert.equal(rafCalls, 1, "ordinary focus restoration must remain after picker settles");
  assert.equal(focusCalls, 1);
});

test("P257d scheduled focus rechecks picker ownership before touching the tree", async () => {
  let focusCalls = 0;
  const callbacks = [];
  class HTMLElement {
    focus() { focusCalls += 1; }
  }
  const context = {
    Object, Promise, TypeError, Math,
    HTMLElement,
    el: { treeWrap: new HTMLElement() },
    isDetailsEditorOpen() { return false; },
    requestAnimationFrame(callback) {
      callbacks.push(callback);
      return callbacks.length;
    },
  };
  context.window = context;
  context.globalThis = context;
  context.isPocketVaultRecoveryFlowOpen = () => false;
  context.isPocketDeviceChangesDecisionOpen = () => false;
  vm.createContext(context);
  vm.runInContext(source(OWNER), context, { filename: OWNER });
  vm.runInContext(extractNamedFunction(source(OVERLAYS), "handleWindowFocusToTree"), context, {
    filename: OVERLAYS,
  });

  context.handleWindowFocusToTree();
  assert.equal(callbacks.length, 1);

  const pending = deferred();
  const pickerPromise = context.PocketNativeFilePickerActivity.run(() => pending.promise);
  callbacks.shift()();
  assert.equal(focusCalls, 0, "a picker that starts before the queued frame must still own focus");

  pending.resolve(true);
  await pickerPromise;
  assert.equal(context.PocketNativeFilePickerActivity.isActive(), false);
});

test("P257d every production native picker invocation is inside the shared activity boundary", () => {
  const jsDir = path.join(ROOT, "js");
  const files = fs.readdirSync(jsDir)
    .filter((name) => name.endsWith(".js"))
    .map((name) => `js/${name}`);

  const invocation = /(?:window|global)\.show(?:Open|Save)FilePicker\s*\(/g;
  const seen = [];
  for (const file of files) {
    const text = source(file);
    for (const match of text.matchAll(invocation)) {
      const before = text.slice(Math.max(0, match.index - 260), match.index);
      assert.match(
        before,
        /run(?:Pocket)?NativeFilePicker\s*\([\s\S]*$/,
        `${file} native picker invocation must be owned`
      );
      seen.push(`${file}:${match.index}`);
    }
  }
  assert.ok(seen.length >= 8, "expected all current direct production picker invocations");

  const io = source(IO);
  assert.match(io, /return runPocketNativeFilePicker\(\(\) => picker\(\{[\s\S]{0,220}suggestedName: "pocket-data\.json"/);

  const sync = source(SYNC);
  assert.equal((sync.match(/runNativeFilePicker\(\(\) => select\.call\(environment,/g) || []).length, 2);

  const index = source("index.html");
  const ownerIndex = index.indexOf('js/pocket-native-file-picker-activity.js');
  assert.ok(ownerIndex >= 0);
  for (const script of [IO, VAULT, SYNC, OPENING, OVERLAYS]) {
    assert.ok(index.indexOf(script) > ownerIndex, `${script} must load after native picker owner`);
  }
  assert.match(source("sw.js"), /\.\/js\/pocket-native-file-picker-activity\.js/);
});

test("P257d New .pocket picker contract remains unchanged", () => {
  const io = source(IO);
  const start = io.indexOf("function newPocketFilePickerOptions()");
  const end = io.indexOf("\nfunction ", start + 20);
  assert.ok(start >= 0 && end > start);
  const options = io.slice(start, end);
  assert.match(options, /suggestedName:\s*"Pocket\.pocket"/);
  assert.match(options, /description:\s*"Pocket file"/);
  assert.match(options, /"application\/json":\s*\["\.pocket"\]/);
  assert.match(options, /excludeAcceptAllOption:\s*true/);

  const createStart = io.indexOf("async function createNewPocketFile()");
  assert.ok(createStart >= 0);
  const createSource = io.slice(createStart);
  assert.match(createSource, /runPocketNativeFilePicker\([\s\S]{0,160}showSaveFilePicker\(newPocketFilePickerOptions\(\)\)/);
  assert.match(createSource, /\/\\\.pocket\$\/i\.test\(pickedName\)/);
});
