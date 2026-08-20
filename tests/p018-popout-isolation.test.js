"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const REPO_ROOT = path.resolve(__dirname, "..");

function source(relativePath) {
  return fs.readFileSync(path.join(REPO_ROOT, relativePath), "utf8");
}

function runScript(context, relativePath) {
  vm.runInContext(source(relativePath), context, { filename: relativePath });
}

function editorPayload(id, overrides = {}) {
  return {
    id,
    title: `Item ${id}`,
    body: "",
    mode: "text",
    outline: null,
    path: `Root / Item ${id}`,
    openedAt: "2026-07-27T00:00:00.000Z",
    updatedAt: "2026-07-27T00:00:00.000Z",
    fileSessionId: 7,
    sourceFileName: "disposable.json",
    sourcePipSession: false,
    originalUpdatedAt: "2026-07-27T00:00:00.000Z",
    ...overrides,
  };
}

class SyntheticPopup {
  constructor(opener, options = {}) {
    this.opener = Object.hasOwn(options, "opener") ? options.opener : opener;
    this.closed = false;
    this.name = "";
    this.PocketNodePopoutSession = options.session || null;
    this.calls = {
      documentOpen: 0,
      documentWrite: 0,
      documentClose: 0,
      focus: 0,
      close: 0,
      identity: 0,
      dirty: 0,
      unsavedDialog: 0,
      ownedClose: 0,
    };
    this.html = "";
    this.identity = null;
    this.dirty = false;
    this.autoSession = options.autoSession !== false;
    const popup = this;
    this.document = {
      open() {
        popup.calls.documentOpen += 1;
      },
      write(value) {
        popup.calls.documentWrite += 1;
        popup.html += String(value);
      },
      close() {
        popup.calls.documentClose += 1;
        if (popup.autoSession) popup.installSession();
      },
    };
  }

  installSession() {
    const owner = this.opener && this.opener.PocketNodePopoutWindow;
    const identity = owner && typeof owner.getCurrentSessionIdentity === "function"
      ? owner.getCurrentSessionIdentity()
      : null;
    if (!identity) return;
    this.identity = {
      ownerToken: identity.ownerToken,
      popupToken: identity.popupToken,
    };
    const popup = this;
    this.PocketNodePopoutSession = Object.freeze({
      getIdentity() {
        popup.calls.identity += 1;
        return {
          ownerToken: popup.identity.ownerToken,
          popupToken: popup.identity.popupToken,
        };
      },
      matches(ownerToken, popupToken) {
        return ownerToken === popup.identity.ownerToken
          && popupToken === popup.identity.popupToken;
      },
      hasUnsavedChanges() {
        popup.calls.dirty += 1;
        return popup.dirty === true;
      },
      requestUnsavedProtection(ownerToken, popupToken) {
        if (ownerToken !== popup.identity.ownerToken
            || popupToken !== popup.identity.popupToken
            || popup.dirty !== true) {
          return false;
        }
        popup.calls.unsavedDialog += 1;
        return true;
      },
      requestOwnedClose(ownerToken, popupToken) {
        popup.calls.ownedClose += 1;
        if (ownerToken !== popup.identity.ownerToken
            || popupToken !== popup.identity.popupToken
            || popup.dirty === true) {
          return false;
        }
        popup.close();
        return true;
      },
    });
  }

  focus() {
    this.calls.focus += 1;
  }

  close() {
    this.calls.close += 1;
    this.closed = true;
  }
}

function createPopupBroker() {
  const broker = {
    openCalls: [],
    popups: [],
    nextPopup: null,
    open(opener, url, target, features) {
      const popup = broker.nextPopup || new SyntheticPopup(opener);
      broker.nextPopup = null;
      broker.openCalls.push({ opener, url, target, features, popup });
      broker.popups.push(popup);
      return popup;
    },
  };
  return broker;
}

function createMainPage(broker, pageId, options = {}) {
  let uuidCall = 0;
  const metrics = {
    applyAndSaveCalls: [],
    truthWrites: 0,
    statuses: [],
    localStorageWrites: [],
    indexedDbCalls: 0,
  };
  const context = {
    Array,
    Date,
    JSON,
    Map,
    Math,
    Object,
    Promise,
    Set,
    Uint32Array,
    console: { log() {}, info() {}, warn() {}, error() {} },
    crypto: Object.hasOwn(options, "crypto") ? options.crypto : {
      randomUUID() {
        uuidCall += 1;
        return `${pageId}-${String(uuidCall).padStart(4, "0")}-4abc-8def-0123456789ab`;
      },
    },
    screen: { availWidth: 1440, availHeight: 900 },
    document: {},
    state: {
      nodes: [editorPayload(`${pageId}_state`)],
      recovery: { capturedAt: "2026-07-27T00:00:00.000Z" },
    },
    localStorage: {
      getItem() { return null; },
      setItem(key, value) {
        metrics.localStorageWrites.push({ key: String(key), value: String(value) });
      },
      removeItem() {},
    },
    indexedDB: {
      open() {
        metrics.indexedDbCalls += 1;
        throw new Error("P018 must not use IndexedDB for popup ownership.");
      },
    },
    setTimeout(handler) {
      if (typeof handler === "function") handler();
      return 1;
    },
    clearTimeout() {},
    open(url, target, features) {
      return broker.open(this, url, target, features);
    },
    setStatus(message, kind, statusOptions) {
      metrics.statuses.push({ message, kind, options: statusOptions || null });
    },
  };
  context.PocketNodePopoutEditor = {
    async applyAndSave(payload) {
      metrics.applyAndSaveCalls.push(payload);
      metrics.truthWrites += 1;
      if (typeof options.applyAndSave === "function") {
        return options.applyAndSave(payload, metrics.applyAndSaveCalls.length);
      }
      return {
        ok: true,
        applied: true,
        changed: true,
        exported: true,
        reason: "exported",
        nodeUpdatedAt: "2026-07-27T00:00:01.000Z",
        sourceIdentity: {
          fileSessionId: payload.fileSessionId,
          sourceFileName: payload.sourceFileName,
          sourcePipSession: payload.sourcePipSession,
        },
      };
    },
  };
  context.window = context;
  context.globalThis = context;
  vm.createContext(context);
  runScript(context, "js/pocket-node-popout-template.js");
  runScript(context, "js/pocket-node-popout-runtime.js");
  runScript(context, "js/pocket-node-popout-window.js");
  return {
    context,
    metrics,
    reloadOwner() {
      runScript(context, "js/pocket-node-popout-window.js");
    },
  };
}

function currentIdentity(page) {
  return page.context.PocketNodePopoutWindow.getCurrentSessionIdentity();
}

test("P018 gives every main page one transient owner token without persisting it", () => {
  const broker = createPopupBroker();
  const normal = createMainPage(broker, "normal");
  const incognito = createMainPage(broker, "incognito");
  const normalOwner = normal.context.PocketNodePopoutWindow.getOwnerToken();
  const incognitoOwner = incognito.context.PocketNodePopoutWindow.getOwnerToken();
  const payload = editorPayload("transient");
  const before = JSON.stringify(payload);

  assert.notEqual(normalOwner, incognitoOwner);
  assert.equal(normal.context.PocketNodePopoutWindow.open(payload), true);
  assert.equal(JSON.stringify(payload), before);
  assert.equal(Object.hasOwn(payload, "popupOwnerToken"), false);
  assert.equal(Object.hasOwn(payload, "popupInstanceToken"), false);
  assert.equal(JSON.stringify(normal.context.state).includes(normalOwner), false);
  assert.equal(normal.metrics.localStorageWrites.length, 0);
  assert.equal(normal.metrics.indexedDbCalls, 0);
});

test("P018 uses random bytes when crypto.randomUUID is unavailable", () => {
  const broker = createPopupBroker();
  let randomCall = 0;
  const page = createMainPage(broker, "random_bytes", {
    crypto: {
      getRandomValues(bytes) {
        randomCall += 1;
        for (let index = 0; index < bytes.length; index += 1) {
          bytes[index] = (randomCall * 1000) + index;
        }
        return bytes;
      },
    },
  });
  const ownerToken = page.context.PocketNodePopoutWindow.getOwnerToken();
  assert.match(ownerToken, /^owner_[a-f0-9]+$/);
  assert.equal(page.context.PocketNodePopoutWindow.open(editorPayload("random_fallback")), true);
  const popupToken = currentIdentity(page).popupToken;
  assert.match(popupToken, /^popup_[a-f0-9]+$/);
  assert.notEqual(ownerToken.replace(/^owner_/, ""), popupToken.replace(/^popup_/, ""));
  assert.equal(randomCall, 2);
});

test("P018 opens simultaneous normal and Incognito-like PE windows without cross-window calls", () => {
  const broker = createPopupBroker();
  const normal = createMainPage(broker, "normal");
  const incognito = createMainPage(broker, "incognito");

  assert.equal(normal.context.PocketNodePopoutWindow.open(editorPayload("normal_a")), true);
  const normalPopup = broker.popups[0];
  const normalSnapshot = { ...normalPopup.calls };
  assert.equal(incognito.context.PocketNodePopoutWindow.open(editorPayload("incognito_a")), true);
  const incognitoPopup = broker.popups[1];

  assert.notStrictEqual(normalPopup, incognitoPopup);
  assert.notEqual(normalPopup.name, incognitoPopup.name);
  assert.equal(normalPopup.closed, false);
  assert.equal(incognitoPopup.closed, false);
  assert.deepEqual(normalPopup.calls, normalSnapshot);
  assert.equal(normal.metrics.applyAndSaveCalls.length, 0);
  assert.equal(incognito.metrics.applyAndSaveCalls.length, 0);
  assert.deepEqual(broker.openCalls.map((call) => call.target), ["_blank", "_blank"]);
});

test("P065 opens concurrent PE windows and writes each fresh popup document once", () => {
  const ownerSource = source("js/pocket-node-popout-window.js");
  const retiredTarget = ["pocket", "Node", "Popout", "Editor"].join("");
  const broker = createPopupBroker();
  const page = createMainPage(broker, "target");

  assert.equal(ownerSource.includes(retiredTarget), false);
  assert.match(ownerSource, /global\.open\("", "_blank"/);
  assert.equal(page.context.PocketNodePopoutWindow.open(editorPayload("first")), true);
  const first = broker.popups[0];
  assert.deepEqual(
    [first.calls.documentOpen, first.calls.documentWrite, first.calls.documentClose],
    [1, 1, 1],
  );
  assert.equal(page.context.PocketNodePopoutWindow.open(editorPayload("second")), true);
  const second = broker.popups[1];
  assert.notEqual(first.name, second.name);
  assert.equal(first.calls.ownedClose, 0);
  assert.equal(first.calls.close, 0);
  assert.equal(first.closed, false);
  assert.equal(first.calls.documentWrite, 1);
  assert.deepEqual(
    [second.calls.documentOpen, second.calls.documentWrite, second.calls.documentClose],
    [1, 1, 1],
  );
});

test("P065 keeps one page's dirty PE private while another page opens concurrent PEs", () => {
  const broker = createPopupBroker();
  const pageA = createMainPage(broker, "page_a");
  const pageB = createMainPage(broker, "page_b");
  pageA.context.PocketNodePopoutWindow.open(editorPayload("a"));
  const popupA = broker.popups[0];
  popupA.dirty = true;
  const before = { ...popupA.calls };

  pageB.context.PocketNodePopoutWindow.open(editorPayload("b_first"));
  const firstB = broker.popups[1];
  pageB.context.PocketNodePopoutWindow.open(editorPayload("b_second"));

  assert.deepEqual(popupA.calls, before);
  assert.equal(popupA.closed, false);
  assert.equal(firstB.closed, false);
  assert.equal(pageA.metrics.truthWrites, 0);
  assert.equal(pageB.metrics.truthWrites, 0);
  assert.equal(broker.popups.length, 3);
});

test("P065 allows a dirty PE to coexist with a newly opened PE and reports owner dirtiness", () => {
  const broker = createPopupBroker();
  const page = createMainPage(broker, "concurrent");
  assert.equal(page.context.PocketNodePopoutWindow.open(editorPayload("a")), true);
  const popupA = broker.popups[0];
  popupA.dirty = true;
  const beforeA = { ...popupA.calls };

  assert.equal(page.context.PocketNodePopoutWindow.open(editorPayload("b")), true);
  const popupB = broker.popups[1];
  assert.equal(popupA.closed, false);
  assert.equal(popupB.closed, false);
  assert.notEqual(popupA.name, popupB.name);
  assert.deepEqual(popupA.calls, beforeA);
  assert.equal(page.context.PocketNodePopoutWindow.hasUnsavedChanges(), true);
  assert.equal(popupA.calls.unsavedDialog, 0);
  popupA.dirty = false;
  assert.equal(page.context.PocketNodePopoutWindow.hasUnsavedChanges(), false);
});

test("P065 keeps cancel compatibility local and closing one PE leaves another untouched", () => {
  const broker = createPopupBroker();
  const page = createMainPage(broker, "close_one");
  page.context.PocketNodePopoutWindow.open(editorPayload("a"));
  const popupA = broker.popups[0];
  page.context.PocketNodePopoutWindow.open(editorPayload("b"));
  const popupB = broker.popups[1];
  const identityA = popupA.identity;
  const beforeB = { ...popupB.calls };

  assert.equal(page.context.PocketNodePopoutWindow.cancelPendingOpen(identityA.ownerToken, identityA.popupToken, popupA), true);
  assert.equal(page.context.PocketNodePopoutWindow.completeCloseFromOwnedPopup(identityA.ownerToken, identityA.popupToken, popupA), true);
  assert.equal(popupA.closed, true);
  assert.equal(popupB.closed, false);
  assert.deepEqual(popupB.calls, beforeB);
  assert.equal(page.context.PocketNodePopoutWindow.hasUnsavedChanges(), false);
});

test("P065 independently authenticates and saves each live PE", async () => {
  const broker = createPopupBroker();
  const page = createMainPage(broker, "save_both");
  page.context.PocketNodePopoutWindow.open(editorPayload("a"));
  page.context.PocketNodePopoutWindow.open(editorPayload("b"));
  const popupA = broker.popups[0];
  const popupB = broker.popups[1];
  const identityA = popupA.identity;
  const identityB = popupB.identity;

  const resultA = await page.context.PocketNodePopoutWindow.applyAndSaveFromOwnedPopup(identityA.ownerToken, identityA.popupToken, editorPayload("a", { body: "A saved" }), popupA);
  const resultB = await page.context.PocketNodePopoutWindow.applyAndSaveFromOwnedPopup(identityB.ownerToken, identityB.popupToken, editorPayload("b", { body: "B saved" }), popupB);
  assert.equal(resultA.exported, true);
  assert.equal(resultB.exported, true);
  assert.equal(page.metrics.truthWrites, 2);
  assert.deepEqual(page.metrics.applyAndSaveCalls.map((payload) => payload.body), ["A saved", "B saved"]);
  assert.equal(page.context.PocketNodePopoutWindow.completeCloseFromOwnedPopup(identityA.ownerToken, identityA.popupToken, popupA), true);
  assert.equal(popupA.closed, true);
  assert.equal(popupB.closed, false);
});

test("P065 rejects wrong owner, wrong popup, foreign caller, and unregistered popup before save delegation", async () => {
  const broker = createPopupBroker();
  const page = createMainPage(broker, "bridge");
  page.context.PocketNodePopoutWindow.open(editorPayload("bridge_a"));
  page.context.PocketNodePopoutWindow.open(editorPayload("bridge_b"));
  const first = broker.popups[0];
  const second = broker.popups[1];
  const firstIdentity = first.identity;
  const secondIdentity = second.identity;
  const outgoing = editorPayload("bridge_a", { body: "Must stay local" });
  const wrongCalls = [
    ["owner_wrong", firstIdentity.popupToken, first],
    [firstIdentity.ownerToken, "popup_wrong", first],
    [firstIdentity.ownerToken, firstIdentity.popupToken, {}],
  ];
  for (const args of wrongCalls) {
    const rejected = await page.context.PocketNodePopoutWindow.applyAndSaveFromOwnedPopup(
      args[0],
      args[1],
      outgoing,
      args[2],
    );
    assert.equal(rejected.reason, "popup-session-changed");
    assert.equal(rejected.applied, false);
    assert.equal(rejected.exported, false);
  }
  assert.equal(page.metrics.truthWrites, 0);

  assert.equal(page.context.PocketNodePopoutWindow.completeCloseFromOwnedPopup(firstIdentity.ownerToken, firstIdentity.popupToken, first), true);
  const replaced = await page.context.PocketNodePopoutWindow.applyAndSaveFromOwnedPopup(
    firstIdentity.ownerToken,
    firstIdentity.popupToken,
    outgoing,
    first,
  );
  assert.equal(replaced.reason, "popup-session-changed");
  assert.equal(page.metrics.truthWrites, 0);

  const accepted = await page.context.PocketNodePopoutWindow.applyAndSaveFromOwnedPopup(
    secondIdentity.ownerToken,
    secondIdentity.popupToken,
    editorPayload("bridge_b"),
    second,
  );
  assert.equal(accepted.ok, true);
  assert.equal(page.metrics.truthWrites, 1);
});

test("P018 rejects an arbitrary window returned for popup creation without write, focus, close, or retry", () => {
  const broker = createPopupBroker();
  const page = createMainPage(broker, "foreign");
  const foreign = new SyntheticPopup({ notTheOwner: true }, { autoSession: false });
  foreign.html = "foreign document";
  broker.nextPopup = foreign;

  assert.equal(page.context.PocketNodePopoutWindow.open(editorPayload("must_not_open")), false);
  assert.equal(broker.openCalls.length, 1);
  assert.equal(foreign.html, "foreign document");
  assert.equal(foreign.calls.documentOpen, 0);
  assert.equal(foreign.calls.documentWrite, 0);
  assert.equal(foreign.calls.documentClose, 0);
  assert.equal(foreign.calls.focus, 0);
  assert.equal(foreign.calls.close, 0);
  assert.match(page.metrics.statuses.at(-1).message, /private editor window/i);
});

test("P018 page reload creates a new owner and rejects the old popup without mutation or write", async () => {
  const broker = createPopupBroker();
  const page = createMainPage(broker, "reload");
  page.context.PocketNodePopoutWindow.open(editorPayload("before_reload"));
  const oldPopup = broker.popups[0];
  const oldIdentity = currentIdentity(page);
  oldPopup.dirty = true;
  page.reloadOwner();
  const newOwner = page.context.PocketNodePopoutWindow.getOwnerToken();

  assert.notEqual(newOwner, oldIdentity.ownerToken);
  const rejected = await page.context.PocketNodePopoutWindow.applyAndSaveFromOwnedPopup(
    oldIdentity.ownerToken,
    oldIdentity.popupToken,
    editorPayload("before_reload", { body: "Stale draft" }),
    oldPopup,
  );
  assert.equal(rejected.reason, "popup-session-changed");
  assert.equal(page.metrics.truthWrites, 0);
  assert.equal(oldPopup.dirty, true);
  assert.equal(oldPopup.closed, false);
  assert.equal(page.context.PocketNodePopoutWindow.open(editorPayload("after_reload")), true);
  assert.equal(broker.popups.length, 2);
  assert.notEqual(oldPopup.name, broker.popups[1].name);
});

test("P018 isolates same-filename sessions because filenames never establish popup ownership", async () => {
  const broker = createPopupBroker();
  const pageA = createMainPage(broker, "same_name_a");
  const pageB = createMainPage(broker, "same_name_b");
  const payloadA = editorPayload("same_a", { sourceFileName: "same.json" });
  const payloadB = editorPayload("same_b", { sourceFileName: "same.json" });
  pageA.context.PocketNodePopoutWindow.open(payloadA);
  pageB.context.PocketNodePopoutWindow.open(payloadB);
  const popupA = broker.popups[0];
  const popupB = broker.popups[1];
  const identityA = currentIdentity(pageA);
  const identityB = currentIdentity(pageB);

  const crossRejected = await pageB.context.PocketNodePopoutWindow.applyAndSaveFromOwnedPopup(
    identityA.ownerToken,
    identityA.popupToken,
    payloadA,
    popupA,
  );
  assert.equal(crossRejected.reason, "popup-session-changed");
  assert.equal(pageB.metrics.truthWrites, 0);

  assert.equal((await pageA.context.PocketNodePopoutWindow.applyAndSaveFromOwnedPopup(
    identityA.ownerToken,
    identityA.popupToken,
    payloadA,
    popupA,
  )).ok, true);
  assert.equal((await pageB.context.PocketNodePopoutWindow.applyAndSaveFromOwnedPopup(
    identityB.ownerToken,
    identityB.popupToken,
    payloadB,
    popupB,
  )).ok, true);
  assert.equal(pageA.metrics.truthWrites, 1);
  assert.equal(pageB.metrics.truthWrites, 1);
});

test("P018 generated runtime compiles with identity validation and no direct editor Save call", () => {
  const context = vm.createContext({ window: {} });
  runScript(context, "js/pocket-node-popout-runtime.js");
  const program = context.window.PocketNodePopoutRuntime.build(JSON.stringify(editorPayload("runtime", {
    popupOwnerToken: "owner_runtime",
    popupInstanceToken: "popup_runtime",
  })));

  assert.doesNotThrow(() => new Function(program));
  assert.equal(program.includes("popupOwnerToken"), true);
  assert.equal(program.includes("popupInstanceToken"), true);
  assert.equal(program.includes("applyAndSaveFromOwnedPopup"), true);
  assert.equal(program.includes("completeCloseFromOwnedPopup"), true);
  assert.equal(program.includes("window.opener.PocketNodePopoutEditor"), false);
  assert.equal((program.match(/addEventListener\("beforeunload"/g) || []).length, 1);
});

test("P018 PE opening remains blocked by the existing P017 and P016 main-page gates", () => {
  for (const scenario of [
    { label: "P017 file-permission modal", permissionOpen: true, decisionOpen: false },
    { label: "P016 file/device decision", permissionOpen: false, decisionOpen: true },
  ]) {
    let openCalls = 0;
    const context = {
      console: { log() {}, info() {}, warn() {}, error() {} },
      state: { selectedId: "gated" },
      requirePocketFileForChanges() {
        return !scenario.permissionOpen && !scenario.decisionOpen;
      },
      PocketNodePopoutWindow: {
        open() {
          openCalls += 1;
          return true;
        },
      },
    };
    context.window = context;
    vm.createContext(context);
    runScript(context, "js/pocket-node-popout-editor.js");
    assert.equal(context.PocketNodePopoutEditor.open("gated"), false, scenario.label);
    assert.equal(openCalls, 0, scenario.label);
  }
});
