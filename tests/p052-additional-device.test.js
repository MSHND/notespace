"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { webcrypto } = require("node:crypto");
const { createServiceCore } = require("../sync-service/pocket-sync-service-core.js");
const { createRecoveryProofVerifier } = require("../sync-service/pocket-sync-recovery-proof-verifier.js");
const { createMemoryServiceStore } = require("./helpers/p034-memory-service-store.js");
const { createSharedDeviceStoreState, createMemoryDeviceStoreDriver } = require("./helpers/p030-memory-device-store-driver.js");
const fixtures = require("./helpers/p032-remote-fixtures.js");

const ROOT = path.resolve(__dirname, "..");

function source(relativePath) {
  return fs.readFileSync(path.join(ROOT, relativePath), "utf8");
}

function recoveryRegistrationCredential() {
  const native = fixtures.nativeRegistrationCredential();
  const id = Buffer.from(bytes(32, 241)).toString("base64url");
  return { getClientExtensionResults() { return native.getClientExtensionResults(); }, toJSON() {
    const value = native.toJSON(); value.id = id; value.rawId = id; return value;
  } };
}

function createP016Dom() {
  const elements = new Map();
  const classList = { add() {}, remove() {}, toggle() {}, contains() { return false; } };
  const element = (id = "", tagName = "div") => {
    const value = {
      id, tagName: String(tagName).toUpperCase(), children: [], hidden: false, disabled: false,
      classList, parentElement: null, textContent: "",
      appendChild(child) { child.parentElement = this; this.children.push(child); return child; },
      removeChild(child) { const index = this.children.indexOf(child); if (index >= 0) this.children.splice(index, 1); return child; },
      get firstChild() { return this.children[0] || null; },
      contains(child) { return child === this || this.children.some((item) => item.contains?.(child)); },
      addEventListener() {},
      querySelectorAll(selector) {
        return selector === "button:not([disabled])"
          ? this.children.filter((item) => item.tagName === "BUTTON" && !item.disabled)
          : [];
      },
      focus() { document.activeElement = this; },
    };
    if (id) elements.set(id, value);
    return value;
  };
  const body = element("body", "body");
  const background = element("p016-background", "main");
  const overlay = element("deviceChangesOverlay");
  overlay.hidden = true;
  body.appendChild(background);
  body.appendChild(overlay);
  for (const [id, tagName] of [
    ["deviceChangesCombine", "button"], ["deviceChangesNotice", "p"],
    ["deviceChangesDecisionView", "div"], ["deviceChangesReview", "section"],
    ["deviceChangesChoiceView", "section"], ["deviceChangesBack", "button"],
    ["deviceChangesReviewBtn", "button"], ["deviceChangesFileName", "strong"],
    ["deviceChangesFileTime", "span"], ["deviceChangesDeviceTime", "strong"],
    ["deviceChangesDeviceSource", "span"], ["deviceChangesReviewList", "div"],
  ]) overlay.appendChild(element(id, tagName));
  const document = {
    body, activeElement: null,
    getElementById(id) { return elements.get(String(id)) || null; },
    createElement(tagName) { return element("", tagName); },
    addEventListener() {},
  };
  return { document, overlay };
}

function loadProduction(options = {}) {
  const storage = new Map(Object.entries(options.localStorageSeed || {}).map(([key, value]) => [String(key), String(value)]));
  const storageCalls = [];
  let standalonePeDirty = options.standalonePeDirty === true;
  const p016Dom = options.p016Dom === true ? createP016Dom() : null;
  const document = p016Dom?.document || {
    body: { classList: { add() {}, remove() {}, toggle() {}, contains() { return false; } } },
    activeElement: null,
    getElementById() { return null; },
    addEventListener() {},
    createElement() { return { style: {}, classList: { add() {}, remove() {}, toggle() {} }, appendChild() {}, remove() {}, click() {} }; },
  };
  const context = { crypto: webcrypto, CryptoKey: globalThis.CryptoKey, TextEncoder, TextDecoder,
    Uint8Array, ArrayBuffer, Object, Array, Number, String, Boolean, JSON, Date, Error, TypeError, Promise, Set,
    Map, URL, Blob, structuredClone, document,
    HTMLElement: class HTMLElement {}, HTMLInputElement: class HTMLInputElement {}, HTMLTextAreaElement: class HTMLTextAreaElement {}, HTMLButtonElement: class HTMLButtonElement {},
    location: { href: "https://pocket.test/index.html" }, navigator: { clipboard: {} },
    localStorage: { getItem(key) { return storage.has(String(key)) ? storage.get(String(key)) : null; },
      setItem(key, value) { const entry = { type: "set", key: String(key), value: String(value) }; storage.set(entry.key, entry.value); storageCalls.push(entry); },
      removeItem(key) { const entry = { type: "remove", key: String(key) }; storage.delete(entry.key); storageCalls.push(entry); } },
    setTimeout() { return 1; }, clearTimeout() {}, setInterval() { return 1; }, clearInterval() {},
    requestAnimationFrame(callback) { if (typeof callback === "function") callback(); return 1; }, cancelAnimationFrame() {},
    addEventListener() {}, removeEventListener() {}, confirm() { return true; }, alert() {}, open() { return null; },
    refreshMeta() {}, renderTree() {}, refocusTreeNavigation() {}, softlyEnsureSelectionVisible() {}, repairVisibleSelectionAfterRender() {},
    collapseAllNodes() {}, expandPathToNode() {}, focusRowByNodeId() {}, stopMovePadRepeat() {}, getExpandableIds() { return []; }, getPath(id) { return String(id || ""); },
    isDetailsEditorOpen() { return false; }, hasUnsavedDetailsEditorChanges() { return false; }, saveDetailsEditor() {}, flashSaveChip() {}, setStatus() {},
    PocketNodePopoutWindow: { hasUnsavedChanges() {
      if (options.standalonePeSignalThrows === true) throw new Error("synthetic PE signal failure");
      return standalonePeDirty;
    } },
    __setStandalonePeDirty(value) { standalonePeDirty = value === true; },
    __localStorage: { values: storage, calls: storageCalls },
    btoa: (value) => Buffer.from(value, "binary").toString("base64"),
    atob: (value) => Buffer.from(value, "base64").toString("binary") };
  context.window = context; context.globalThis = context;
  vm.createContext(context);
  const browserFiles = options.browserPersistence === true ? [
    "js/pocket-state.js", "js/pocket-data.js", "js/pocket-editor-metadata.js", "js/pocket-pe-import-preserve.js",
    "js/pocket-storage.js", "js/pocket-import.js", "js/pocket-editor-copy.js", "js/pocket-history-status.js",
    "js/pocket-render.js", "js/pocket-io-browser.js", "js/pocket-device-changes.js",
  ] : [];
  for (const file of browserFiles.concat(["js/pocket-sync-security-contract.js", "js/pocket-sync-crypto.js",
    "js/pocket-sync-device-store.js", "js/pocket-sync-owner-controller.js",
    "js/pocket-sync-account-client.js", "js/pocket-sync-remote-client.js",
    "js/pocket-sync-activation.js", "js/pocket-sync-emergency-recovery.js", "js/pocket-sync-additional-device.js",
    "js/pocket-owner-save-boundary.js", "js/pocket-sync-activation-owner-bridge.js",
    "js/pocket-sync-browser-runtime.js", "js/pocket-synced-truth-handover.js"])) {
    vm.runInContext(source(file), context, { filename: file });
  }
  if (options.browserPersistence === true) {
    context.refreshMeta = () => {};
    context.renderTree = () => {};
    context.refocusTreeNavigation = () => {};
    context.softlyEnsureSelectionVisible = () => {};
    context.repairVisibleSelectionAfterRender = () => {};
    context.setStatus = () => {};
    context.flashSaveChip = () => {};
    if (options.captureSessionTransitions === true) {
      const productionSetSession = context.setPocketFileSession;
      context.__sessionTransitions = [];
      context.setPocketFileSession = (...input) => {
        context.__sessionTransitions.push(plain(input[2] || {}));
        return productionSetSession(...input);
      };
    }
  }
  context.__p016Dom = p016Dom;
  return context;
}

function bytes(length, seed = 1) {
  return Uint8Array.from({ length }, (_value, index) => (seed + index) & 255);
}

function plain(value) {
  return JSON.parse(JSON.stringify(value));
}

function createIndexedDb() {
  const records = new Map();
  let reads = 0;
  let beforeRead = null;
  let storeCreated = false;
  const store = {
    keyPath: "syncedPocketId", autoIncrement: false, indexNames: [],
    get(key) {
      const request = {};
      queueMicrotask(() => {
        reads += 1;
        request.result = beforeRead?.({ key, reads, value: records.get(key) }) ?? records.get(key);
        request.onsuccess?.();
      });
      return request;
    },
    getAll() { const request = {}; queueMicrotask(() => { request.result = [...records.values()]; request.onsuccess?.(); }); return request; },
    add(value) { if (records.has(value.syncedPocketId)) throw new Error("duplicate"); const request = {};
      queueMicrotask(() => { records.set(value.syncedPocketId, value); request.onsuccess?.(); }); return request; },
    put(value) { const request = {}; queueMicrotask(() => { records.set(value.syncedPocketId, value); request.onsuccess?.(); }); return request; },
  };
  const database = {
    version: 1, get objectStoreNames() { return storeCreated ? ["pockets"] : []; },
    createObjectStore(name, options) { if (name !== "pockets" || options?.keyPath !== "syncedPocketId") throw new Error("schema invalid"); storeCreated = true; return store; },
    transaction() { const transaction = { error: null, objectStore: () => store,
      abort() { queueMicrotask(() => transaction.onabort?.()); } }; setImmediate(() => transaction.oncomplete?.()); return transaction; },
    close() {}, onversionchange: null,
  };
  return { records, setBeforeRead(callback) { beforeRead = callback; },
    indexedDB: { open(name, version) { if (name !== "pocket.sync.device.v1" || version !== 1) throw new Error("database invalid");
      const request = { result: database, transaction: { abort() {} } };
      queueMicrotask(() => { if (!storeCreated) request.onupgradeneeded?.({ oldVersion: 0 }); request.onsuccess?.(); }); return request; } } };
}

async function createBrowserJourney(options = {}) {
  const a = loadProduction();
  const b = loadProduction({
    browserPersistence: options.browserPersistence === true,
    captureSessionTransitions: options.captureSessionTransitions === true,
    standalonePeDirty: options.standalonePeDirty === true,
    standalonePeSignalThrows: options.standalonePeSignalThrows === true,
    p016Dom: options.p016Dom === true,
    localStorageSeed: options.localStorageSeed,
  });
  const serviceDriver = createMemoryServiceStore();
  const origin = "https://sync.pocket.example";
  const now = Date.parse("2041-01-01T00:00:00.000Z");
  let serviceRandom = 0;
  const core = createServiceCore({
    store: serviceDriver.store,
    webAuthnVerifier: {
      async verifyRegistration(input) { return { credentialId: input.credential.id,
        publicKey: Buffer.from(bytes(64, 101)).toString("base64url"), publicKeyAlgorithm: -7,
        signCount: 0, transports: ["internal"], backupEligible: true, backedUp: false }; },
      async verifyAuthentication(input) { return { credentialId: input.credential.id,
        signCount: input.storedCredential.signCount + 1, backedUp: true }; },
    },
    recoveryProofVerifier: createRecoveryProofVerifier(),
    randomBytes(length) { serviceRandom += 1; return bytes(length, serviceRandom * 7); },
    now: () => now, trustedOrigin: origin, rpId: "sync.pocket.example", rpName: "Pocket",
    credentialAlgorithms: [-7], ceremonyLifetimeMs: 300000, sessionLifetimeMs: 2592000000,
  });
  let aSessionId = null;
  let bSessionId = null;
  const remoteCalls = [];
  let serverDeviceInvalid = false;
  let failReadRevision = false;
  function transportFor(readSession, writeSession) { return Object.freeze({ async request(route, body) {
    remoteCalls.push({ route, body: plain(body), sessionId: readSession() });
    if (failReadRevision && route === "readRevision") throw new Error("synthetic revision read failure");
    const response = await core[route]({ context: { method: "POST", origin, fetchSite: "same-origin",
      contentType: "application/json", sessionId: readSession() }, body: plain(body) });
    if (response.session?.action === "set") writeSession(response.session.sessionId);
    const responseBody = serverDeviceInvalid && route === "listEnvelopes"
      ? Object.assign({}, response.body, { envelopes: response.body.envelopes.filter((item) => item.envelopeKind !== "device") })
      : response.body;
    return { status: response.status, body: responseBody };
  } }); }
  const aTransport = transportFor(() => aSessionId, (value) => { aSessionId = value; });
  const bTransport = transportFor(() => bSessionId, (value) => { bSessionId = value; });
  const aRemote = a.PocketSyncRemoteClient;
  const recoveryPackages = [];
  const aDeviceStore = a.PocketSyncDeviceStore.createStore(createMemoryDeviceStoreDriver(createSharedDeviceStoreState()));
  let activationRandom = 0;
  const activateA = a.PocketSyncActivation.createActivationOrchestrator({
    securityContract: a.PocketSyncSecurityContract, crypto: a.PocketSyncCrypto, deviceStore: aDeviceStore,
    accountClient: a.PocketSyncAccountClient.createClient({
      accountService: aRemote.createAccountService({ transport: aTransport, now: () => now }),
      webAuthn: { async createCredential() { return fixtures.nativeRegistrationCredential(); }, async getCredential() {} }, now: () => now,
    }),
    contentService: aRemote.createContentService({ transport: aTransport }), envelopeService: aRemote.createEnvelopeService({ transport: aTransport }),
    recoveryService: aRemote.createRecoveryService({ transport: aTransport, now: () => now }),
    randomBytes(length) { activationRandom += 1; return bytes(length, 151 + activationRandom); }, now: () => now,
  });
  const source = Object.freeze({ ownerKind: "json", continuityId: "device-a-source" });
  const created = await activateA.activate({
    captureSourceSession: () => source, isSourceSessionCurrent: (value) => value === source,
    hasUnsavedSourceChanges: () => false, async saveLocalSource() { return { ok: true }; },
    async freezePayload() {
      if (options.browserPersistence === true) {
        const sentinel = options.remoteSentinel || "P052c readable Device A content";
        return {
          schema: "portal.export.v1",
          mainThoughtTree: [{ id: "p052h1-remote", label: sentinel, details: sentinel, children: [] }],
          mainThoughtTreeTombstones: [],
          data: { mainThoughtTree: [{ id: "p052h1-remote", label: sentinel, details: sentinel, children: [] }], mainThoughtTreeTombstones: [] },
        };
      }
      return { schema: "portal.export.v1", notes: [options.remoteSentinel || "P052c readable Device A content"] };
    },
    async prepareRecoveryCopyDestination() { return { ok: true, destination: { kind: "test" } }; },
    async buildRecoveryPackage(input) { return a.PocketSyncSecurityContract.buildRecoveryPackage({ ...plain(input), checksum: "p052c" }); },
    async writeRecoveryCopy({ recoveryPackage }) { recoveryPackages.push(plain(recoveryPackage)); return { ok: true }; }, async adoptSyncedOwner() { return { ok: true }; },
  }, { syncedPocketId: "pocket-p052c-browser", deviceId: "device-a-p052c" });
  assert.equal(created.ok, true, JSON.stringify(created));

  const idb = createIndexedDb();
  const activationRecord = options.sameDeviceReopen === true || options.advanceRemoteBeforeOpen === true
    ? await aDeviceStore.readPocket(created.owner.syncedPocketId)
    : null;
  if (options.sameDeviceReopen === true) {
    idb.records.set(activationRecord.syncedPocketId, activationRecord);
  }
  if (options.unrelatedPartial === true) {
    idb.records.set("unrelated-partial", { kind: "pocket.sync.device-state", schemaVersion: 5 });
  }
  if (options.advanceRemoteBeforeOpen === true) {
    const owner = a.PocketSyncOwnerController.createSyncedOwnerController({
      crypto: a.PocketSyncCrypto, deviceStore: aDeviceStore,
      contentService: aRemote.createContentService({ transport: aTransport }),
      randomBytes(length) { return bytes(length, 219); },
    });
    const bundle = await a.PocketSyncCrypto.openMasterKeyBundle(
      activationRecord.deviceEnvelope.record, activationRecord.deviceWrappingKey,
      activationRecord.deviceEnvelope.context, []
    );
    assert.equal((await owner.adoptSyncedOwner({
      syncedPocketId: activationRecord.syncedPocketId, masterKey: bundle.masterKey,
    })).ok, true);
    assert.equal((await owner.saveSyncedOwner({ async freezePayload() {
      return { schema: "portal.export.v1", notes: ["P085 refreshed remote content"] };
    } })).ok, true);
  }
  let ownerKind = options.ownerKind || "detached";
  let continuity = 61;
  let visible = null;
  let commits = 0;
  let detachedDirty = options.detachedDirty === true;
  let dirtyBeforeCommit = options.dirtyBeforeCommit === true;
  let targetChangesBeforeCommit = options.targetChangesBeforeCommit === true;
  let commitFails = options.commitFails === true;
  let installFails = options.installFails === true;
  let ownerAdoptionFailsAfterCommit = options.ownerAdoptionFailsAfterCommit === true;
  let prfUnavailable = false;
  let dirtySignalThrows = options.dirtySignalThrows === true;
  if (options.browserPersistence !== true) {
    b.capturePocketFileSaveSession = () => ({ id: continuity, ownerKind });
    b.isPocketFileSaveSessionCurrent = (session) => !!session && session.id === continuity && session.ownerKind === ownerKind;
    if (options.dirtySignalMissing !== true) {
      b.hasPocketUnsavedChanges = () => {
        if (dirtySignalThrows) throw new Error("synthetic dirty signal failure");
        return detachedDirty;
      };
    }
    b.setPocketFileSession = () => {
      if (installFails) throw new Error("synthetic boundary install failure");
      ownerKind = "synced"; continuity += 1;
    };
    b.isPocketPayloadShape = (payload) => payload?.schema === "portal.export.v1";
    b.normaliseInput = (payload) => payload;
    b.commitPreparedPocketDocument = (payload, _metadata, guard) => {
      commits += 1;
      if (dirtyBeforeCommit) detachedDirty = true;
      if (targetChangesBeforeCommit) continuity += 1;
      if (ownerAdoptionFailsAfterCommit) {
        idb.setBeforeRead(({ value }) => value && Object.assign({}, value, {
          content: Object.assign({}, value.content, { context: Object.assign({}, value.content.context, { revision: 99 }) }),
        }));
      }
      if (commitFails || guard.canContinue() !== true) return { ok: false };
      visible = plain(payload);
      return { ok: true };
    };
  }
  const bRemote = b.PocketSyncRemoteClient;
  function createBrowserEnvironment() {
    return {
      crypto: webcrypto, indexedDB: idb.indexedDB, now: () => now,
      PublicKeyCredential: { parseCreationOptionsFromJSON(value) { return value; } },
      navigator: { credentials: { async create() {
        if (options.recovery === true) return recoveryRegistrationCredential();
        throw new Error("not used"); },
        async get() {
          if (!prfUnavailable) return fixtures.nativeAuthenticationCredential();
          const credential = fixtures.nativeAuthenticationCredential();
          return { getClientExtensionResults() { return {}; }, toJSON() {
            const json = credential.toJSON(); json.clientExtensionResults = {}; return json;
          } };
        } } },
      async showOpenFilePicker() {
        if (options.recovery !== true) throw new Error("not used");
        return [{ async getFile() { return { async text() { return JSON.stringify(recoveryPackages[0]); } }; } }];
      },
      async showSaveFilePicker() {
        if (options.recovery !== true) throw new Error("not used");
        return { async createWritable() { return { async write() {}, async close() {}, async abort() {} }; } };
      },
    };
  }
  const environment = createBrowserEnvironment();
  if (options.localJsonTarget === true && options.browserPersistence === true) {
    b.setPocketFileSession({ name: "p104-local-source.json" }, "p104-local-source.json", {
      ownerKind: "json", forceNewSession: true,
    });
    const localState = vm.runInContext("state", b);
    const localLabel = options.localSentinel || "P104 LOCAL SOURCE";
    localState.nodes = [{ id: "p104-local-source", label: localLabel, details: localLabel, children: [] }];
    localState.tombstones = [];
    localState.ops = [];
    if (options.localJsonDirty === true) b.recordOp({ type: "p104b-local-edit", id: "p104-local-source" });
  }
  if (options.peDirtyBeforeCommit === true && options.browserPersistence === true) {
    const commitPrepared = b.commitPreparedPocketDocument;
    b.commitPreparedPocketDocument = (...input) => {
      b.__setStandalonePeDirty(true);
      return commitPrepared(...input);
    };
  }
  const runtime = b.PocketSyncBrowserRuntime.createRuntime({
    accountService: bRemote.createAccountService({ transport: bTransport, now: () => now }),
    contentService: bRemote.createContentService({ transport: bTransport }), envelopeService: bRemote.createEnvelopeService({ transport: bTransport }),
    recoveryService: bRemote.createRecoveryService({ transport: bTransport, now: () => now }),
    discoveryService: bRemote.createPocketDiscoveryService({ transport: bTransport }), environment,
  });
  const bSessionBeforeOpen = bSessionId;
  const opened = options.skipOpenExisting === true ? null : await runtime.openExisting();
  return { b, core, idb, opened, remoteCalls, runtime, serviceDriver, recoveryPackage: recoveryPackages[0],
    readRemoteRevision: () => bRemote.createContentService({ transport: bTransport }).readRevision({
      apiVersion: 1, operationId: "p052h2-read-revision", syncedPocketId: "pocket-p052c-browser",
    }),
    openExisting: (input) => runtime.openExisting(input), clearFaults() { targetChangesBeforeCommit = false; commitFails = false;
      installFails = false; ownerAdoptionFailsAfterCommit = false; idb.setBeforeRead(null); }, setPrfUnavailable(value) { prfUnavailable = value === true; },
    setDetachedDirty(value) { detachedDirty = value === true; }, setDirtyBeforeCommit(value) { dirtyBeforeCommit = value === true; },
    setDirtySignalThrows(value) { dirtySignalThrows = value === true; },
    setStandalonePeDirty(value) { b.__setStandalonePeDirty(value); },
    setReadRevisionFailure(value) { failReadRevision = value === true; },
    setServerDeviceInvalid(value) { serverDeviceInvalid = value === true; },
    get ownerKind() { return options.browserPersistence === true ? b.capturePocketFileSaveSession().ownerKind : ownerKind; },
    get visible() { return options.browserPersistence === true ? plain(vm.runInContext("state.nodes", b)) : visible; },
    get commits() { return commits; },
    get aSessionId() { return aSessionId; },
    get bSessionId() { return bSessionId; },
    get bSessionBeforeOpen() { return bSessionBeforeOpen; },
    createFreshBrowserRuntime() {
      const fresh = loadProduction({ browserPersistence: true, captureSessionTransitions: true });
      let freshSessionId = null;
      const freshTransport = transportFor(() => freshSessionId, (value) => { freshSessionId = value; });
      const freshRemote = fresh.PocketSyncRemoteClient;
      const freshRuntime = fresh.PocketSyncBrowserRuntime.createRuntime({
        accountService: freshRemote.createAccountService({ transport: freshTransport, now: () => now }),
        contentService: freshRemote.createContentService({ transport: freshTransport }),
        envelopeService: freshRemote.createEnvelopeService({ transport: freshTransport }),
        recoveryService: freshRemote.createRecoveryService({ transport: freshTransport, now: () => now }),
        discoveryService: freshRemote.createPocketDiscoveryService({ transport: freshTransport }),
        environment: createBrowserEnvironment(),
      });
      return {
        context: fresh,
        openExisting: () => freshRuntime.openExisting(),
        readRemoteRevision: () => freshRemote.createContentService({ transport: freshTransport }).readRevision({
          apiVersion: 1, operationId: "p103-read-revision", syncedPocketId: "pocket-p052c-browser",
        }),
        get sessionId() { return freshSessionId; },
      };
    } };
}

test("P052 remains dormant until explicitly created and a new device without PRF requires recovery before mutation", async () => {
  const calls = [];
  const context = { Object, Array, Number, String, Boolean, Error, Promise, Uint8Array, Date };
  context.window = context; context.globalThis = context;
  vm.createContext(context);
  vm.runInContext(fs.readFileSync(path.join(ROOT, "js/pocket-sync-additional-device.js"), "utf8"), context);
  assert.deepEqual(calls, []);
  const opener = context.PocketSyncAdditionalDevice.createAdditionalDeviceOpener({
    crypto: { FORMAT: { contentType: "portal.export.v1+json" }, generateDeviceWrappingKey() {}, deriveWrappingKey() {}, openMasterKeyBundle() {}, openContent() {}, sealContent() {}, encodeBase64Url() { return "opaque"; }, validateNonExtractableAesKey() {} },
    deviceStore: { open() {}, readPocket() {}, createPocket() {}, replacePocket() {}, reservePocketEncryptionUsage() {} },
    accountClient: { async authenticatePasskey() { calls.push("authenticate"); return { ok: true, accountAuthenticated: true, contentUnlocked: false, accountId: "account", credentialId: "credential", prf: { status: "unavailable" } }; } },
    discoveryService: { async readSyncedPocket() { calls.push("discovery"); return { status: "ready", syncedPocketId: "pocket" }; } },
    contentService: { async readRevision() {}, async downloadEncryptedRecord() {} },
    envelopeService: { async listEnvelopes() {}, async downloadEnvelope() {}, async addEnvelope() { calls.push("add"); } },
    randomBytes() { return new Uint8Array(32); }, now: () => 0,
  });
  const result = await opener.openExisting({
    captureTarget: () => ({ ownerKind: "none", id: 1 }), isTargetCurrent: () => true,
    validatePayload: () => true, adoptOpenedPocket: async () => true,
  });
  assert.equal(result.reason, "recovery-required");
  assert.deepEqual(calls, ["authenticate", "discovery"]);
});

test("P054b uses real Pocket document and file-session adoption for recovery", async () => {
  const journey = await createBrowserJourney({ browserPersistence: true, skipOpenExisting: true, recovery: true });
  const before = journey.b.capturePocketFileSaveSession();
  const recovered = await journey.runtime.recoverExisting();
  assert.equal(recovered.ok, true, JSON.stringify(recovered));
  const after = journey.b.capturePocketFileSaveSession();
  assert.equal(after.ownerKind, "synced");
  assert.notEqual(after.id, before.id);
  const saved = await journey.b.PocketOwnerSaveBoundary.save({
    expectedSession: after,
    freezePayload: async () => ({ schema: "portal.export.v1", mainThoughtTree: [], mainThoughtTreeTombstones: [], data: { mainThoughtTree: [], mainThoughtTreeTombstones: [] } }),
  });
  assert.equal(saved.ok, true, JSON.stringify(saved));
});

test("P054b refuses a real dirty detached target before recovery", async () => {
  const journey = await createBrowserJourney({ browserPersistence: true, skipOpenExisting: true, recovery: true });
  journey.b.setPocketFileSession(null, "Detached recovery target", {
    ownerKind: "detached", detachedDeviceChanges: true, forceNewSession: true,
  });
  const before = journey.b.capturePocketFileSaveSession();
  const recovered = await journey.runtime.recoverExisting();
  assert.equal(recovered.ok, false, JSON.stringify(recovered));
  assert.equal(recovered.reason, "recovery-target-dirty");
  assert.equal(journey.b.capturePocketFileSaveSession().id, before.id);
  assert.equal(journey.b.capturePocketFileSaveSession().ownerKind, "detached");
});

test("P052i1 rejects a bootstrap account mismatch before discovery or local mutation", async () => {
  const calls = [];
  const context = { Object, Array, Number, String, Boolean, Error, Promise, Uint8Array, Date };
  context.window = context; context.globalThis = context; vm.createContext(context);
  vm.runInContext(source("js/pocket-sync-additional-device.js"), context);
  const opener = context.PocketSyncAdditionalDevice.createAdditionalDeviceOpener({
    crypto: { FORMAT: { contentType: "portal.export.v1+json" }, generateDeviceWrappingKey() {}, deriveWrappingKey() {},
      openMasterKeyBundle() {}, openContent() {}, sealContent() {}, encodeBase64Url() { return "opaque"; },
      validateNonExtractableAesKey() {} },
    deviceStore: { open() { calls.push("open"); }, readPocket() {}, createPocket() {}, replacePocket() {}, reservePocketEncryptionUsage() {} },
    accountClient: { async authenticatePasskey() {
      calls.push("authenticate");
      return calls.filter((value) => value === "authenticate").length === 1
        ? { ok: true, bootstrap: true, accountAuthenticated: true, contentUnlocked: false,
          accountId: "account-a", credentialId: "credential-a", prf: { status: "not-requested" } }
        : { ok: true, accountAuthenticated: true, contentUnlocked: false,
          accountId: "account-b", credentialId: "credential-b", prf: { status: "available", outputBytes: new Uint8Array(32) } };
    } },
    discoveryService: { async readSyncedPocket() { calls.push("discovery"); } },
    contentService: { async readRevision() {}, async downloadEncryptedRecord() {} },
    envelopeService: { async listEnvelopes() {}, async downloadEnvelope() {}, async addEnvelope() {} },
    randomBytes() { return new Uint8Array(32); }, now: () => 0,
  });
  const result = await opener.openExisting({ captureTarget: () => ({ ownerKind: "none", id: 1 }),
    isTargetCurrent: () => true, validatePayload: () => true, adoptOpenedPocket: async () => true });
  assert.equal(result.reason, "additional-device-open-failed");
  assert.deepEqual(calls, ["authenticate", "authenticate"]);
});

test("P052a opens a real P029 content record with its authenticated content context and continues from device B's envelope", async () => {
  const context = loadProduction();
  const crypto = context.PocketSyncCrypto;
  const syncedPocketId = "pocket-p052a-real";
  const credentialId = "credential-p052a-real";
  const prf = Uint8Array.from({ length: 32 }, (_value, index) => index + 1);
  const prfContext = { syncedPocketId, envelopeId: "prf-envelope", envelopeKind: "passkey-prf", envelopeVersion: 1 };
  const salt = Uint8Array.from({ length: 32 }, (_value, index) => index + 41);
  const prfWrappingKey = await crypto.deriveWrappingKey(prf, Buffer.from(salt).toString("base64url"), prfContext);
  const original = await crypto.createMasterKeyBundle([{ context: prfContext, wrappingKey: prfWrappingKey }]);
  const payload = { schema: "portal.export.v1", thoughts: ["P052a real encrypted content"] };
  const contentContext = { syncedPocketId, revision: 1, contentType: crypto.FORMAT.contentType };
  const encryptedRecord = await crypto.sealContent(payload, original.masterKey, contentContext);
  const store = context.PocketSyncDeviceStore.createStore(createMemoryDeviceStoreDriver());
  let randomCounter = 1;
  let added = null;
  const transientMasterKeys = new Set();
  let masterKeyBundleCalls = 0;
  let initialMasterKeyWasUsed = false;
  const openerCrypto = Object.freeze({ ...crypto,
    async openMasterKeyBundle(...input) {
      const bundle = await crypto.openMasterKeyBundle(...input);
      masterKeyBundleCalls += 1;
      if (masterKeyBundleCalls === 1) transientMasterKeys.add(bundle.masterKey);
      return bundle;
    },
    async openContent(record, key, content) {
      if (transientMasterKeys.has(key)) {
        if (initialMasterKeyWasUsed) throw new Error("discarded initial PRF master key");
        initialMasterKeyWasUsed = true;
      }
      return crypto.openContent(record, key, content);
    },
  });
  const opener = context.PocketSyncAdditionalDevice.createAdditionalDeviceOpener({
    crypto: openerCrypto,
    deviceStore: { open: () => store.open(), readPocket: (value) => store.readPocket(value),
      createPocket: async (value) => { try { return await store.createPocket(value); }
        catch (error) { throw new Error(`create:${error.code}`); } },
      replacePocket: (id, revision, value) => store.replacePocket(id, revision, value),
      reservePocketEncryptionUsage: (...input) => store.reservePocketEncryptionUsage(...input) },
    accountClient: { async authenticatePasskey() { return { ok: true, accountAuthenticated: true,
      contentUnlocked: false, accountId: "account-p052a-real", credentialId,
      prf: { status: "available", outputBytes: Uint8Array.from(prf) } }; } },
    discoveryService: { async readSyncedPocket() { return { status: "ready", syncedPocketId }; } },
    contentService: { async readRevision() { return { recordPresent: true, revision: 1 }; },
      async downloadEncryptedRecord() { return { syncedPocketId, revision: 1, encryptedRecord }; } },
    envelopeService: { async listEnvelopes() { return { keySetVersion: 1, envelopes: [{
      envelopeId: "prf-envelope", envelopeKind: "passkey-prf", envelopeVersion: 1,
      deviceId: null, credentialId, kdf: "HKDF-SHA-256", kdfSalt: Buffer.from(salt).toString("base64url"), derivationVersion: 1, status: "active" }] }; },
      async downloadEnvelope() { return { keySetVersion: 1, envelope: { envelopeId: "prf-envelope",
        envelopeKind: "passkey-prf", envelopeVersion: 1, deviceId: null, credentialId, kdf: "HKDF-SHA-256",
        kdfSalt: Buffer.from(salt).toString("base64url"), derivationVersion: 1, encryptedEnvelope: original.envelopes[0].record } }; },
      async addEnvelope(request) { added = request; return { status: "committed", keySetVersion: 2,
        masterKeyGeneration: 1, masterKeyContentEncryptionLimit: 2 ** 20 }; } },
    randomBytes(length) { const value = new Uint8Array(length); value.fill(randomCounter++); return value; },
    now: () => Date.parse("2035-01-01T00:00:00.000Z"),
  });
  const result = await opener.openExisting({ captureTarget: () => ({ ownerKind: "detached", id: 7 }),
    isTargetCurrent: () => true, validatePayload: (value) => value?.schema === "portal.export.v1",
    adoptOpenedPocket: async ({ masterKey, payload: received }) => {
      assert.deepEqual(received, payload);
      await crypto.openContent(encryptedRecord, masterKey, contentContext);
      return true;
    } });
  assert.equal(result.ok, true, JSON.stringify(result));
  assert.equal(added.attemptKind, "new-change");
  const record = await store.readPocket(syncedPocketId);
  assert.equal(record.usage.deviceWrappingKeyEncryptions, 2);
  assert.equal(record.usage.masterKeyContentEncryptionLimit, 2 ** 20);
  const durable = await crypto.openMasterKeyBundle(record.deviceEnvelope.record,
    record.deviceWrappingKey, record.deviceEnvelope.context, []);
  assert.deepEqual(await crypto.openContent(record.content.record, durable.masterKey, record.content.context), payload);
});

test("P052a replays an ambiguous durable device-envelope mutation exactly once", async () => {
  const context = { Object, Array, Number, String, Boolean, Error, Promise, Uint8Array, Date };
  context.window = context; context.globalThis = context; vm.createContext(context);
  vm.runInContext(source("js/pocket-sync-additional-device.js"), context);
  let next = 0;
  const calls = [];
  let record = null;
  let createCount = 0;
  let failGrantPersistence = true;
  const masterKey = { key: "master" };
  const crypto = {
    FORMAT: { contentType: "portal.export.v1+json" },
    encodeBase64Url() { next += 1; return `id-${next}`; }, randomBytes() { return new Uint8Array(32); },
    async generateDeviceWrappingKey() { return { key: "device" }; },
    async deriveWrappingKey() { return { key: "prf" }; },
    validateNonExtractableAesKey() {},
    async openMasterKeyBundle(_record, _key, _context, plans) {
      return { masterKey, envelopes: plans.map((plan) => ({ context: plan.context, record: { wrapped: plan.context.envelopeId } })) };
    },
    async openContent(value) { return value.value || value; },
    async sealContent(value) { return { value }; },
  };
  const opener = context.PocketSyncAdditionalDevice.createAdditionalDeviceOpener({
    crypto,
    deviceStore: { async open() {}, async readPocket() { return record; },
      async createPocket(value) { createCount += 1; record = value; return value; },
      async replacePocket(_id, _revision, value) {
        if (failGrantPersistence) { failGrantPersistence = false; throw new Error("local persistence unavailable"); }
        record = value; return value;
      }, async reservePocketEncryptionUsage() {} },
    accountClient: { async authenticatePasskey() { return { ok: true, accountAuthenticated: true,
      contentUnlocked: false, accountId: "account", credentialId: "credential",
      prf: { status: "available", outputBytes: new Uint8Array(32) } }; } },
    discoveryService: { async readSyncedPocket() { return { status: "ready", syncedPocketId: "pocket" }; } },
    contentService: { async readRevision() { return { recordPresent: true, revision: 1 }; },
      async downloadEncryptedRecord() { return { syncedPocketId: "pocket", revision: 1,
        encryptedRecord: { value: { schema: "portal.export.v1" } } }; } },
    envelopeService: { async listEnvelopes() { return { keySetVersion: 1, envelopes: [{
      envelopeId: "prf", envelopeKind: "passkey-prf", envelopeVersion: 1, deviceId: null,
      credentialId: "credential", kdf: "HKDF-SHA-256", kdfSalt: "salt", derivationVersion: 1, status: "active" }] }; },
      async downloadEnvelope() { return { keySetVersion: 1, envelope: { envelopeId: "prf",
        envelopeKind: "passkey-prf", envelopeVersion: 1, deviceId: null, credentialId: "credential",
        kdf: "HKDF-SHA-256", kdfSalt: "salt", derivationVersion: 1, encryptedEnvelope: { wrapped: "prf" } } }; },
      async addEnvelope(request) { calls.push(request); return { status: "committed", keySetVersion: 2,
        masterKeyGeneration: 1, masterKeyContentEncryptionLimit: 2 ** 20 }; } },
    randomBytes() { return new Uint8Array(32); }, now: () => 0,
  });
  const dependencies = { captureTarget: () => ({ ownerKind: "detached", id: "target" }),
    isTargetCurrent: () => true, validatePayload: () => true, adoptOpenedPocket: async () => true };
  assert.equal((await opener.openExisting(dependencies)).reason, "additional-device-open-failed");
  const staged = record;
  assert.notEqual(staged, null);
  assert.equal((await opener.openExisting(dependencies)).ok, true);
  assert.equal(createCount, 1);
  assert.deepEqual(calls.map((request) => request.attemptKind), ["new-change", "idempotent-retry"]);
  assert.equal(calls[0].operationId, calls[1].operationId);
  assert.equal(calls[0].logicalChangeId, calls[1].logicalChangeId);
  assert.deepEqual(calls[0].envelope, calls[1].envelope);
  assert.equal(record.usage.masterKeyContentEncryptionLimit, 2 ** 20);
});

test("P052b maps a wrong real P029 PRF unlock to recovery-required before device mutation", async () => {
  const context = loadProduction();
  const crypto = context.PocketSyncCrypto;
  const syncedPocketId = "pocket-p052b-prf";
  const prfContext = { syncedPocketId, envelopeId: "prf-envelope", envelopeKind: "passkey-prf", envelopeVersion: 1 };
  const correctPrf = Uint8Array.from({ length: 32 }, (_value, index) => index + 1);
  const wrongPrf = Uint8Array.from({ length: 32 }, (_value, index) => index + 71);
  const salt = Buffer.from(Uint8Array.from({ length: 32 }, (_value, index) => index + 31)).toString("base64url");
  const key = await crypto.deriveWrappingKey(correctPrf, salt, prfContext);
  const bundle = await crypto.createMasterKeyBundle([{ context: prfContext, wrappingKey: key }]);
  let mutations = 0;
  const opener = context.PocketSyncAdditionalDevice.createAdditionalDeviceOpener({
    crypto,
    deviceStore: { async open() {}, async readPocket() { return null; }, async createPocket() { mutations += 1; }, async replacePocket() { mutations += 1; }, async reservePocketEncryptionUsage() {} },
    accountClient: { async authenticatePasskey() { return { ok: true, accountAuthenticated: true,
      contentUnlocked: false, accountId: "account-p052b-prf", credentialId: "credential-p052b-prf",
      prf: { status: "available", outputBytes: wrongPrf } }; } },
    discoveryService: { async readSyncedPocket() { return { status: "ready", syncedPocketId }; } },
    contentService: { async readRevision() { throw new Error("must not read content"); }, async downloadEncryptedRecord() { throw new Error("must not download"); } },
    envelopeService: { async listEnvelopes() { return { keySetVersion: 1, envelopes: [{
      envelopeId: "prf-envelope", envelopeKind: "passkey-prf", envelopeVersion: 1, deviceId: null,
      credentialId: "credential-p052b-prf", kdf: "HKDF-SHA-256", kdfSalt: salt, derivationVersion: 1, status: "active" }] }; },
      async downloadEnvelope() { return { keySetVersion: 1, envelope: { envelopeId: "prf-envelope",
        envelopeKind: "passkey-prf", envelopeVersion: 1, deviceId: null, credentialId: "credential-p052b-prf",
        kdf: "HKDF-SHA-256", kdfSalt: salt, derivationVersion: 1, encryptedEnvelope: bundle.envelopes[0].record } }; },
      async addEnvelope() { mutations += 1; } },
    randomBytes(length) { return new Uint8Array(length); }, now: () => 0,
  });
  const result = await opener.openExisting({ captureTarget: () => ({ ownerKind: "detached", id: "prf" }),
    isTargetCurrent: () => true, validatePayload: () => true, adoptOpenedPocket: async () => true });
  assert.equal(result.reason, "recovery-required");
  assert.equal(mutations, 0);
});

test("P052c keeps tampered PRF envelopes recoverable but local derivation failures local", async () => {
  const context = loadProduction();
  const crypto = context.PocketSyncCrypto;
  const syncedPocketId = "pocket-p052c-prf";
  const credentialId = "credential-p052c-prf";
  const prfContext = { syncedPocketId, envelopeId: "prf-envelope", envelopeKind: "passkey-prf", envelopeVersion: 1 };
  const prf = Uint8Array.from({ length: 32 }, (_value, index) => index + 1);
  const salt = Buffer.from(Uint8Array.from({ length: 32 }, (_value, index) => index + 41)).toString("base64url");
  const wrappingKey = await crypto.deriveWrappingKey(prf, salt, prfContext);
  const bundle = await crypto.createMasterKeyBundle([{ context: prfContext, wrappingKey }]);
  async function openWith(cryptoInput, encryptedEnvelope) {
    let mutations = 0;
    const opener = context.PocketSyncAdditionalDevice.createAdditionalDeviceOpener({
      crypto: cryptoInput,
      deviceStore: { async open() {}, async readPocket() { return null; }, async createPocket() { mutations += 1; }, async replacePocket() { mutations += 1; }, async reservePocketEncryptionUsage() {} },
      accountClient: { async authenticatePasskey() { return { ok: true, accountAuthenticated: true,
        contentUnlocked: false, accountId: "account-p052c-prf", credentialId,
        prf: { status: "available", outputBytes: Uint8Array.from(prf) } }; } },
      discoveryService: { async readSyncedPocket() { return { status: "ready", syncedPocketId }; } },
      contentService: { async readRevision() { throw new Error("must not read content"); }, async downloadEncryptedRecord() { throw new Error("must not download"); } },
      envelopeService: { async listEnvelopes() { return { keySetVersion: 1, envelopes: [{
        envelopeId: "prf-envelope", envelopeKind: "passkey-prf", envelopeVersion: 1, deviceId: null, credentialId, kdf: "HKDF-SHA-256", kdfSalt: salt, derivationVersion: 1, status: "active" }] }; },
        async downloadEnvelope() { return { keySetVersion: 1, envelope: { envelopeId: "prf-envelope",
          envelopeKind: "passkey-prf", envelopeVersion: 1, deviceId: null, credentialId, kdf: "HKDF-SHA-256", kdfSalt: salt, derivationVersion: 1, encryptedEnvelope } }; },
        async addEnvelope() { mutations += 1; } },
      randomBytes(length) { return new Uint8Array(length); }, now: () => 0,
    });
    const result = await opener.openExisting({ captureTarget: () => ({ ownerKind: "detached", id: "prf" }),
      isTargetCurrent: () => true, validatePayload: () => true, adoptOpenedPocket: async () => true });
    return { result, mutations };
  }
  const tampered = Object.assign({}, bundle.envelopes[0].record, {
    ciphertext: `${bundle.envelopes[0].record.ciphertext[0] === "A" ? "B" : "A"}${bundle.envelopes[0].record.ciphertext.slice(1)}`,
  });
  const tamperedResult = await openWith(crypto, tampered);
  assert.equal(tamperedResult.result.reason, "recovery-required");
  assert.equal(tamperedResult.mutations, 0);
  const localCrypto = Object.freeze({ ...crypto, async deriveWrappingKey() {
    const error = new Error("synthetic local derivation failure"); error.code = "wrapping-key-derivation-failed"; throw error;
  } });
  const localResult = await openWith(localCrypto, bundle.envelopes[0].record);
  assert.equal(localResult.result.reason, "additional-device-open-failed");
  assert.equal(localResult.result.reason === "recovery-required", false);
  assert.equal(localResult.mutations, 0);
});

test("P052b preserves a reviewed irreversible adoption partial state", async () => {
  const context = { Object, Array, Number, String, Boolean, Error, Promise, Uint8Array, Date };
  context.window = context; context.globalThis = context; vm.createContext(context);
  vm.runInContext(source("js/pocket-sync-additional-device.js"), context);
  const masterKey = {};
  const crypto = { FORMAT: { contentType: "portal.export.v1+json" }, encodeBase64Url: () => "id",
    async generateDeviceWrappingKey() { return {}; }, async deriveWrappingKey() { return {}; },
    validateNonExtractableAesKey() {}, async sealContent(value) { return { value }; },
    async openContent(value) { return value.value || { schema: "portal.export.v1" }; },
    async openMasterKeyBundle(_record, _key, _context, plans) { return { masterKey,
      envelopes: plans.map((plan) => ({ context: plan.context, record: { value: {} } })) }; } };
  let record = null;
  const opener = context.PocketSyncAdditionalDevice.createAdditionalDeviceOpener({ crypto,
    deviceStore: { async open() {}, async readPocket() { return record; }, async createPocket(value) { record = value; },
      async replacePocket(_id, _revision, value) { record = value; return value; }, async reservePocketEncryptionUsage() {} },
    accountClient: { async authenticatePasskey() { return { ok: true, accountAuthenticated: true, contentUnlocked: false,
      accountId: "account", credentialId: "credential", prf: { status: "available", outputBytes: new Uint8Array(32) } }; } },
    discoveryService: { async readSyncedPocket() { return { status: "ready", syncedPocketId: "pocket" }; } },
    contentService: { async readRevision() { return { recordPresent: true, revision: 1 }; },
      async downloadEncryptedRecord() { return { syncedPocketId: "pocket", revision: 1, encryptedRecord: { value: { schema: "portal.export.v1" } } }; } },
    envelopeService: { async listEnvelopes() { return { keySetVersion: 1, envelopes: [{ envelopeId: "prf", envelopeKind: "passkey-prf", envelopeVersion: 1, deviceId: null, credentialId: "credential", kdf: "HKDF-SHA-256", kdfSalt: "salt", derivationVersion: 1, status: "active" }] }; },
      async downloadEnvelope() { return { keySetVersion: 1, envelope: { envelopeId: "prf", envelopeKind: "passkey-prf", envelopeVersion: 1, deviceId: null, credentialId: "credential", kdf: "HKDF-SHA-256", kdfSalt: "salt", derivationVersion: 1, encryptedEnvelope: {} } }; },
      async addEnvelope() { return { status: "committed", keySetVersion: 2, masterKeyGeneration: 1, masterKeyContentEncryptionLimit: 2 ** 20 }; } },
    randomBytes() { return new Uint8Array(32); }, now: () => 0 });
  const result = await opener.openExisting({ captureTarget: () => ({ ownerKind: "detached", id: "partial" }),
    isTargetCurrent: () => true, validatePayload: () => true,
    adoptOpenedPocket: async () => ({ ok: false, partialState: "visible-payload-committed-detached" }) });
  assert.deepEqual(JSON.parse(JSON.stringify(result)), { ok: false, reason: "owner-adoption-failed", adopted: false,
    partialState: "visible-payload-committed-detached" });
});

test("P052b accepts a production Device A activation, Device B adoption and ordinary Device B Save", async () => {
  const context = loadProduction();
  const serviceDriver = createMemoryServiceStore();
  const origin = "https://sync.pocket.example";
  const now = Date.parse("2040-01-01T00:00:00.000Z");
  let random = 0;
  const core = createServiceCore({
    store: serviceDriver.store,
    webAuthnVerifier: {
      async verifyRegistration(input) { return { credentialId: input.credential.id,
        publicKey: Buffer.from(bytes(64, 91)).toString("base64url"), publicKeyAlgorithm: -7,
        signCount: 0, transports: ["internal"], backupEligible: true, backedUp: false }; },
      async verifyAuthentication(input) { return { credentialId: input.credential.id,
        signCount: input.storedCredential.signCount + 1, backedUp: true }; },
    },
    recoveryProofVerifier: { async verifyRecoveryProof() { return { verified: true }; } },
    randomBytes(length) { random += 1; return bytes(length, random * 9); },
    now: () => now, trustedOrigin: origin, rpId: "sync.pocket.example", rpName: "Pocket",
    credentialAlgorithms: [-7], ceremonyLifetimeMs: 300000, sessionLifetimeMs: 2592000000,
  });
  let sessionId = null;
  const routes = [];
  const transport = Object.freeze({ async request(route, body) {
    routes.push(route);
    const response = await core[route]({ context: { method: "POST", origin, fetchSite: "same-origin",
      contentType: "application/json", sessionId }, body: plain(body) });
    if (response.session?.action === "set") sessionId = response.session.sessionId;
    return { status: response.status, body: response.body };
  } });
  const accountService = context.PocketSyncRemoteClient.createAccountService({ transport, now: () => now });
  const contentService = context.PocketSyncRemoteClient.createContentService({ transport });
  const envelopeService = context.PocketSyncRemoteClient.createEnvelopeService({ transport });
  const discoveryService = context.PocketSyncRemoteClient.createPocketDiscoveryService({ transport });
  const recoveryService = context.PocketSyncRemoteClient.createRecoveryService({ transport, now: () => now });
  const aStore = context.PocketSyncDeviceStore.createStore(createMemoryDeviceStoreDriver(createSharedDeviceStoreState()));
  let activationRandom = 0;
  const activation = context.PocketSyncActivation.createActivationOrchestrator({
    securityContract: context.PocketSyncSecurityContract, crypto: context.PocketSyncCrypto,
    deviceStore: aStore,
    accountClient: context.PocketSyncAccountClient.createClient({ accountService,
      webAuthn: { async createCredential() { return fixtures.nativeRegistrationCredential(); }, async getCredential() {} }, now: () => now }),
    contentService, envelopeService, recoveryService,
    randomBytes(length) { activationRandom += 1; return bytes(length, 181 + activationRandom); }, now: () => now,
  });
  const sourceTarget = Object.freeze({ ownerKind: "json", continuityId: "source-a" });
  const activated = await activation.activate({
    captureSourceSession: () => sourceTarget, isSourceSessionCurrent: (value) => value === sourceTarget,
    hasUnsavedSourceChanges: () => false, async saveLocalSource() { return { ok: true }; },
    async freezePayload() { return { schema: "portal.export.v1", notes: ["Device A initial content"] }; },
    async prepareRecoveryCopyDestination() { return { ok: true, destination: { kind: "test" } }; },
    async buildRecoveryPackage(input) { return context.PocketSyncSecurityContract.buildRecoveryPackage({ ...plain(input), checksum: "p052b" }); },
    async writeRecoveryCopy() { return { ok: true }; }, async adoptSyncedOwner() { return { ok: true }; },
  }, { syncedPocketId: "pocket-p052b-acceptance", deviceId: "device-a-p052b" });
  assert.equal(activated.ok, true, JSON.stringify(activated));

  const bStore = context.PocketSyncDeviceStore.createStore(createMemoryDeviceStoreDriver(createSharedDeviceStoreState()));
  let ownerRandom = 0;
  const bOwner = context.PocketSyncOwnerController.createSyncedOwnerController({
    crypto: context.PocketSyncCrypto, deviceStore: bStore, contentService,
    randomBytes(length) { ownerRandom += 1; return bytes(length, 211 + ownerRandom); },
  });
  let bRandom = 0;
  const opener = context.PocketSyncAdditionalDevice.createAdditionalDeviceOpener({
    crypto: context.PocketSyncCrypto, deviceStore: bStore,
    accountClient: context.PocketSyncAccountClient.createClient({ accountService,
      webAuthn: { async createCredential() {}, async getCredential() { return fixtures.nativeAuthenticationCredential(); } }, now: () => now }),
    discoveryService, contentService, envelopeService,
    randomBytes(length) { bRandom += 1; return bytes(length, 231 + bRandom); }, now: () => now,
  });
  const bTarget = Object.freeze({ ownerKind: "detached", id: "device-b-view" });
  let visible = null;
  const opened = await opener.openExisting({ captureTarget: () => bTarget, isTargetCurrent: () => true,
    validatePayload: (payload) => payload?.schema === "portal.export.v1",
    async adoptOpenedPocket(input) {
      visible = input.payload;
      return bOwner.adoptSyncedOwner({ syncedPocketId: input.syncedPocketId, masterKey: input.masterKey });
    },
  });
  assert.equal(opened.ok, true, JSON.stringify(opened));
  assert.deepEqual(plain(visible), { schema: "portal.export.v1", notes: ["Device A initial content"] });
  const saved = await bOwner.saveSyncedOwner({ async freezePayload() {
    return { schema: "portal.export.v1", notes: ["Device B ordinary Save"] };
  } });
  assert.equal(saved.ok, true, JSON.stringify(saved));
  assert.equal(saved.confirmedRemoteRevision, 2);
  assert.deepEqual(plain((await bOwner.getSyncedOwnerState())), {
    syncedPocketId: "pocket-p052b-acceptance", confirmedRemoteRevision: 2,
    knownRemoteRevision: 2, pending: false, generation: 1,
  });
  const remoteText = JSON.stringify(serviceDriver.snapshot());
  assert.doesNotMatch(remoteText, /Device A initial content|Device B ordinary Save/);
  assert.deepEqual(routes.filter((route) => route === "conditionalUpload"), ["conditionalUpload", "conditionalUpload"]);
});

test("P052c public browser Device B adoption joins visible truth, owner authority and boundary Save", async () => {
  const journey = await createBrowserJourney();
  assert.deepEqual(plain(journey.opened), {
    ok: true, reason: "synced-pocket-opened", confirmedRemoteRevision: 1,
  });
  const authentications = journey.remoteCalls.filter((call) => call.route === "beginAuthentication");
  assert.equal(authentications.length, 2);
  assert.notEqual(journey.aSessionId, null);
  assert.equal(journey.bSessionBeforeOpen, null);
  assert.notEqual(journey.bSessionId, null);
  assert.notEqual(journey.aSessionId, journey.bSessionId);
  assert.deepEqual(Object.keys(authentications[0].body).sort(), ["apiVersion", "operationId"]);
  assert.equal(authentications[0].sessionId, null);
  assert.notEqual(authentications[1].sessionId, null);
  assert.notEqual(authentications[1].sessionId, journey.aSessionId);
  assert.equal(authentications[1].body.accountLocator, undefined);
  const finishIndex = journey.remoteCalls.findIndex((call) => call.route === "finishAuthentication");
  assert.ok(finishIndex >= 0);
  assert.ok(journey.remoteCalls.findIndex((call, index) => index > finishIndex
    && call.route === "beginAuthentication") > finishIndex);
  assert.deepEqual(journey.visible, { schema: "portal.export.v1", notes: ["P052c readable Device A content"] });
  assert.equal(journey.commits, 1);
  assert.equal(journey.ownerKind, "synced");
  assert.equal(journey.b.PocketOwnerSaveBoundary.hasSyncedOwner(), true);
  const before = [...journey.idb.records.values()][0];
  assert.equal(before.schemaVersion, 5);
  assert.equal(before.usage.masterKeyContentEncryptionLimit, 2 ** 20);
  const addCalls = journey.remoteCalls.filter((call) => call.route === "addEnvelope");
  assert.equal(addCalls.length, 3);
  const saved = await journey.b.PocketOwnerSaveBoundary.save({
    expectedSession: journey.b.capturePocketFileSaveSession(),
    async freezePayload() { return { schema: "portal.export.v1", notes: ["P052c Device B boundary Save"] }; },
  });
  assert.deepEqual(plain(saved), {
    ownerKind: "synced", target: "synced", ok: true, reason: "saved", confirmedRemoteRevision: 2,
  });
  const after = [...journey.idb.records.values()][0];
  assert.equal(after.usage.masterKeyContentEncryptions, before.usage.masterKeyContentEncryptions + 1);
  assert.equal(after.usage.masterKeyContentEncryptionLimit, 2 ** 20);
  assert.equal(journey.remoteCalls.filter((call) => call.route === "addEnvelope").length, 3);
  const remoteText = JSON.stringify(journey.serviceDriver.snapshot());
  const requests = JSON.stringify(journey.remoteCalls);
  assert.doesNotMatch(remoteText, /P052c readable Device A content|P052c Device B boundary Save|"masterKey":|"deviceWrappingKey":/);
  assert.doesNotMatch(requests, /P052c readable Device A content|P052c Device B boundary Save/);
  assert.deepEqual(Object.keys(plain(journey.opened)), ["ok", "reason", "confirmedRemoteRevision"]);
});

test("P085 reopens the same adopted device record after refresh without another Sync mutation", async () => {
  const journey = await createBrowserJourney({ sameDeviceReopen: true, unrelatedPartial: true, ownerKind: "none" });
  assert.deepEqual(plain(journey.opened), {
    ok: true, reason: "synced-pocket-opened", confirmedRemoteRevision: 1,
  });
  assert.equal(journey.ownerKind, "synced");
  assert.equal(journey.b.PocketOwnerSaveBoundary.hasSyncedOwner(), true);
  assert.equal(journey.remoteCalls.filter((call) => call.route === "addEnvelope").length, 2);
  assert.equal(journey.remoteCalls.filter((call) => ["beginRegistration", "finishRegistration"].includes(call.route)).length, 2);
  assert.equal(journey.remoteCalls.filter((call) => call.route === "conditionalUpload").length, 1);
});

test("P085 rejects corrupt, pre-adoption, pending, and mismatched adopted-draft candidates", async () => {
  for (const mutate of [
    (record) => Object.assign({}, record, { activationDraft: Object.assign({}, record.activationDraft, {
      record: Object.assign({}, record.activationDraft.record, { ciphertext: "corrupt" }),
    }) }),
    async (record, crypto) => {
      const draft = await crypto.openContent(record.activationDraft.record,
        record.deviceWrappingKey, record.activationDraft.context);
      Object.assign(draft, { stage: "ready-for-adoption", adopted: false });
      return Object.assign({}, record, { activationDraft: { context: record.activationDraft.context,
        record: await crypto.sealContent(draft, record.deviceWrappingKey, record.activationDraft.context) } });
    },
    async (record, crypto) => {
      const draft = await crypto.openContent(record.activationDraft.record,
        record.deviceWrappingKey, record.activationDraft.context);
      draft.pendingOperation = "content-upload";
      return Object.assign({}, record, { activationDraft: { context: record.activationDraft.context,
        record: await crypto.sealContent(draft, record.deviceWrappingKey, record.activationDraft.context) } });
    },
    async (record, crypto) => {
      const draft = await crypto.openContent(record.activationDraft.record,
        record.deviceWrappingKey, record.activationDraft.context);
      draft.deviceId = "mismatched-device";
      return Object.assign({}, record, { activationDraft: { context: record.activationDraft.context,
        record: await crypto.sealContent(draft, record.deviceWrappingKey, record.activationDraft.context) } });
    },
  ]) {
    const journey = await createBrowserJourney({ sameDeviceReopen: true, ownerKind: "none", skipOpenExisting: true });
    const beforeMutations = journey.remoteCalls.filter((call) => call.route === "addEnvelope").length;
    const [record] = [...journey.idb.records.values()];
    journey.idb.records.set(record.syncedPocketId, await mutate(record, journey.b.PocketSyncCrypto));
    const rejected = await journey.openExisting();
    assert.equal(rejected.ok, false);
    assert.equal(journey.ownerKind, "none");
    assert.equal(journey.b.PocketOwnerSaveBoundary.hasSyncedOwner(), false);
    assert.equal(journey.remoteCalls.filter((call) => call.route === "addEnvelope").length, beforeMutations);
  }
});

test("P104g-a classifies exact stranded activation before completed-device remote work", async () => {
  const fieldState = async (record, crypto) => {
    const draft = await crypto.openContent(record.activationDraft.record,
      record.deviceWrappingKey, record.activationDraft.context);
    const recoveryAuthorisation = await crypto.createRecoveryAuthorisationKeyPair();
    Object.assign(draft, {
      stage: "device-staged", pendingOperation: "account-registration", sourceOwnerKind: "json",
      sourceSaved: true, recoveryCopyStored: false, adopted: false,
      confirmedRemoteRevision: 0, keySetVersion: 0, recoveryVersion: 0,
      account: null, registrationContinuation: null, accountLocator: null,
      prfEnvelope: null, prfStatus: "pending", recoveryPackage: null,
      recoveryRoot: crypto.encodeBase64Url(bytes(32, 41)),
      recoveryAuthorisation: recoveryAuthorisation.recoveryAuthorisation,
      recoveryVerifier: recoveryAuthorisation.recoveryVerifier,
    });
    return Object.assign({}, record, {
      content: Object.assign({}, record.content, { context: Object.assign({}, record.content.context, { revision: 0 }) }),
      remote: { confirmedRevision: 0, pending: null, conflict: null },
      activationDraft: { context: record.activationDraft.context,
        record: await crypto.sealContent(draft, record.deviceWrappingKey, record.activationDraft.context) },
    });
  };
  const undecryptableDraft = async (record, crypto) => {
    const draft = await crypto.openContent(record.activationDraft.record,
      record.deviceWrappingKey, record.activationDraft.context);
    return Object.assign({}, record, { activationDraft: { context: record.activationDraft.context,
      record: await crypto.sealContent(draft, await crypto.generateDeviceWrappingKey(), record.activationDraft.context) } });
  };
  const malformedStrandedDraft = async (record, crypto, mutate) => {
    const stranded = await fieldState(record, crypto);
    const draft = await crypto.openContent(stranded.activationDraft.record,
      stranded.deviceWrappingKey, stranded.activationDraft.context);
    mutate(draft);
    return Object.assign({}, stranded, { activationDraft: { context: stranded.activationDraft.context,
      record: await crypto.sealContent(draft, stranded.deviceWrappingKey, stranded.activationDraft.context) } });
  };
  const possibleRemoteProgress = async (record, crypto) => {
    const draft = await crypto.openContent(record.activationDraft.record,
      record.deviceWrappingKey, record.activationDraft.context);
    Object.assign(draft, { stage: "ready-for-adoption", adopted: false, pendingOperation: null });
    return Object.assign({}, record, { activationDraft: { context: record.activationDraft.context,
      record: await crypto.sealContent(draft, record.deviceWrappingKey, record.activationDraft.context) } });
  };
  for (const [name, expectedReason, mutate] of [
    ["exact stranded field state", "local-activation-attention", fieldState],
    ["undecryptable activation draft", "additional-device-state-invalid", undecryptableDraft],
    ["malformed device envelope", "additional-device-state-invalid", (record, crypto) => malformedStrandedDraft(record, crypto, (draft) => { draft.deviceEnvelope.encryptedEnvelope = {}; })],
    ["malformed recovery verifier", "additional-device-state-invalid", (record, crypto) => malformedStrandedDraft(record, crypto, (draft) => { draft.recoveryVerifier.publicKey = "not-base64url"; })],
    ["malformed recovery authorisation", "additional-device-state-invalid", (record, crypto) => malformedStrandedDraft(record, crypto, (draft) => { draft.recoveryAuthorisation.privateKey = "not-base64url"; })],
    ["malformed recovery root", "additional-device-state-invalid", (record, crypto) => malformedStrandedDraft(record, crypto, (draft) => { draft.recoveryRoot = "not-base64url"; })],
    ["malformed content context", "additional-device-state-invalid", (record, crypto) => malformedStrandedDraft(record, crypto, (draft) => { draft.content.context.revision = 2; })],
    ["malformed content record", "additional-device-state-invalid", (record, crypto) => malformedStrandedDraft(record, crypto, (draft) => { draft.content.record = {}; })],
    ["well-formed activation with possible remote progress", "additional-device-state-invalid", possibleRemoteProgress],
  ]) {
    const journey = await createBrowserJourney({ sameDeviceReopen: true, ownerKind: "none", skipOpenExisting: true });
    const [record] = [...journey.idb.records.values()];
    journey.idb.records.set(record.syncedPocketId, await mutate(record, journey.b.PocketSyncCrypto));
    const beforeRecord = plain([...journey.idb.records.values()][0]);
    const callsBefore = journey.remoteCalls.length;
    const result = await journey.openExisting();
    const calls = journey.remoteCalls.slice(callsBefore).map((call) => call.route);
    assert.equal(result.reason, expectedReason, name);
    assert.equal(journey.ownerKind, "none");
    assert.equal(journey.visible, null);
    assert.equal(journey.b.PocketOwnerSaveBoundary.hasSyncedOwner(), false);
    assert.deepEqual(plain([...journey.idb.records.values()][0]), beforeRecord);
    assert.deepEqual(calls.filter((route) => ["listEnvelopes", "downloadEnvelope", "readRevision",
      "downloadEncryptedRecord", "addEnvelope", "conditionalUpload", "beginRegistration",
      "finishRegistration", "initialiseRecovery"].includes(route)), []);
  }
});

test("P085 refreshes the existing adopted record without creating another device identity", async () => {
  const journey = await createBrowserJourney({ sameDeviceReopen: true, advanceRemoteBeforeOpen: true, ownerKind: "none" });
  assert.deepEqual(plain(journey.opened), {
    ok: true, reason: "synced-pocket-opened", confirmedRemoteRevision: 2,
  });
  const [record] = [...journey.idb.records.values()];
  assert.equal(record.remote.confirmedRevision, 2);
  assert.equal(journey.remoteCalls.filter((call) => call.route === "addEnvelope").length, 2);
  assert.equal(journey.remoteCalls.filter((call) => call.route === "conditionalUpload").length, 2);
});

test("P052h1 public Device B adoption uses production browser storage privacy through ordinary Save", async () => {
  const legacySentinel = "P052H1 LEGACY JSON SAFETY";
  const remoteSentinel = "P052H1 REMOTE SENTINEL";
  const editedSentinel = "P052H1 EDITED SENTINEL";
  const legacySafetyRaw = JSON.stringify({
    schema: "pocket.localSafety.v1",
    capturedAt: "2040-01-01T00:00:00.000Z",
    reason: "ordinary-json-change",
    source: { schema: "portal.export.v1", fileName: "ordinary.json", writtenAt: "2040-01-01T00:00:00.000Z" },
    selectedId: "legacy-node",
    focusRootId: "",
    collapsedIds: [],
    ops: [],
    operationHighWater: 0,
    payload: {
      schema: "portal.export.v1",
      mainThoughtTree: [{ id: "legacy-node", label: legacySentinel, details: legacySentinel, children: [] }],
      mainThoughtTreeTombstones: [],
      data: { mainThoughtTree: [{ id: "legacy-node", label: legacySentinel, details: legacySentinel, children: [] }], mainThoughtTreeTombstones: [] },
    },
  });
  const legacyProbe = loadProduction({ browserPersistence: true,
    localStorageSeed: { "pocketLite.localSafety.snapshot.v1": legacySafetyRaw } });
  assert.equal(legacyProbe.readLocalSafetySnapshot().norm.nodes[0].label, legacySentinel);
  const journey = await createBrowserJourney({
    browserPersistence: true,
    captureSessionTransitions: true,
    remoteSentinel,
    localStorageSeed: {
      "pocketLite.localSafety.snapshot.v1": legacySafetyRaw,
      "pocketLite.localSafety.trail.v1": legacySentinel,
      "pocketLite.pipSnapshot.v1": legacySentinel,
      "pocketLite.autoCache.v1": legacySentinel,
    },
  });
  assert.equal(journey.opened.ok, true, JSON.stringify(journey.opened));
  assert.equal(journey.ownerKind, "synced");
  assert.deepEqual(plain(journey.b.capturePocketFileSaveSession()).storagePrivacy, "synced");
  assert.equal(journey.b.PocketOwnerSaveBoundary.hasSyncedOwner(), true);
  assert.equal(journey.b.__sessionTransitions.filter((entry) => entry.ownerKind === "synced").length, 1);
  assert.equal(journey.visible.some((node) => node.label === remoteSentinel), true);
  assert.equal(JSON.stringify(journey.visible).includes(legacySentinel), false);
  assert.equal(journey.b.__localStorage.values.get("pocketLite.localSafety.snapshot.v1"), legacySafetyRaw);
  assert.equal(journey.b.clearLocalSafetySnapshot(), false);
  assert.equal(journey.b.__pocketLiteExportSessionState(), null);
  let popupCalls = 0;
  journey.b.open = () => { popupCalls += 1; return null; };
  await journey.b.openPipWindow();
  assert.equal(popupCalls, 0);
  const grantsBeforeSave = journey.remoteCalls.filter((call) => call.route === "addEnvelope").length;
  const state = vm.runInContext("state", journey.b);
  state.nodes.push({ id: "p052h1-edit", label: editedSentinel, children: [] });
  journey.b.recordOp({ type: "p052h1-edit", id: "p052h1-edit", changed: editedSentinel });
  const saved = await journey.b.exportTree({ returnDetails: true, downloadFallback: false });
  assert.equal(saved.ok, true, JSON.stringify(saved));
  assert.equal(saved.reason, "synced-save");
  const remoteRevision = await journey.readRemoteRevision();
  assert.equal(remoteRevision.recordPresent, true);
  assert.equal(remoteRevision.revision, 2);
  assert.equal(journey.remoteCalls.filter((call) => call.route === "addEnvelope").length, grantsBeforeSave);
  const writes = JSON.stringify(journey.b.__localStorage.calls);
  assert.equal(writes.includes(remoteSentinel), false);
  assert.equal(writes.includes(editedSentinel), false);
  assert.doesNotMatch(writes, /masterKey|deviceWrappingKey|prf|recovery/i);
  assert.equal(journey.b.__localStorage.values.get("pocketLite.localSafety.snapshot.v1"), legacySafetyRaw);
  assert.equal(journey.b.__localStorage.values.get("pocketLite.localSafety.trail.v1"), legacySentinel);
  assert.equal(journey.b.__localStorage.values.get("pocketLite.pipSnapshot.v1"), legacySentinel);
  assert.equal(journey.b.__localStorage.values.get("pocketLite.autoCache.v1"), legacySentinel);
});

test("P103 desktop Synced Pocket saves through exportTree and reopens the same durable device truth", async () => {
  const remoteSentinel = "P103 REMOTE START";
  const firstEdit = "P103 FIRST DESKTOP EDIT";
  const secondEdit = "P103 SECOND DESKTOP EDIT";
  const journey = await createBrowserJourney({
    browserPersistence: true, captureSessionTransitions: true, sameDeviceReopen: true,
    ownerKind: "none", remoteSentinel,
  });
  assert.deepEqual(plain(journey.opened), {
    ok: true, reason: "synced-pocket-opened", confirmedRemoteRevision: 1,
  });
  assert.equal(journey.ownerKind, "synced");
  assert.equal(journey.b.PocketOwnerSaveBoundary.hasSyncedOwner(), true);
  assert.equal(journey.b.hasPocketUnsavedChanges(), false);
  assert.equal(journey.visible.some((node) => node.label === remoteSentinel), true);
  const [openedRecord] = [...journey.idb.records.values()];
  assert.equal(openedRecord.remote.confirmedRevision, 1);
  assert.equal(openedRecord.remote.pending, null);
  assert.equal(openedRecord.remote.conflict, null);
  const deviceId = openedRecord.deviceId;
  const deviceEnvelopeMetadata = plain(openedRecord.deviceEnvelope.metadata);
  const grantsBeforeSave = journey.remoteCalls.filter((call) => call.route === "addEnvelope").length;

  const firstState = vm.runInContext("state", journey.b);
  firstState.nodes.push({ id: "p103-first-edit", label: firstEdit, children: [] });
  journey.b.recordOp({ type: "p103-first-edit", id: "p103-first-edit", changed: firstEdit });
  assert.equal(journey.b.hasPocketUnsavedChanges(), true);
  assert.equal(JSON.stringify(plain(journey.b.buildPocketPayload())).includes(firstEdit), true);
  const firstSaved = await journey.b.exportTree({ returnDetails: true, downloadFallback: false });
  assert.deepEqual(plain(firstSaved), {
    ok: true, reason: "synced-save", target: "synced", sourceIdentity: plain(firstSaved.sourceIdentity),
  });
  assert.equal(journey.b.hasPocketUnsavedChanges(), false);
  const [savedRecord] = [...journey.idb.records.values()];
  assert.equal(savedRecord.remote.confirmedRevision, 2);
  assert.equal(savedRecord.remote.pending, null);
  assert.equal(savedRecord.remote.conflict, null);
  assert.equal((await journey.readRemoteRevision()).revision, 2);
  assert.equal(journey.remoteCalls.filter((call) => call.route === "addEnvelope").length, grantsBeforeSave);
  assert.doesNotMatch(JSON.stringify(journey.serviceDriver.snapshot()), new RegExp(`${remoteSentinel}|${firstEdit}`));
  assert.doesNotMatch(JSON.stringify(journey.remoteCalls), new RegExp(`${remoteSentinel}|${firstEdit}`));

  const fresh = journey.createFreshBrowserRuntime();
  assert.equal(fresh.context.capturePocketFileSaveSession().ownerKind, "none");
  assert.equal(fresh.context.PocketOwnerSaveBoundary.hasSyncedOwner(), false);
  const recoveryCallsBeforeReopen = journey.remoteCalls.filter((call) => /recovery/i.test(call.route)).length;
  const reopened = await fresh.openExisting();
  assert.deepEqual(plain(reopened), {
    ok: true, reason: "synced-pocket-opened", confirmedRemoteRevision: 2,
  });
  assert.notEqual(fresh.sessionId, null);
  assert.equal(fresh.context.capturePocketFileSaveSession().ownerKind, "synced");
  assert.equal(fresh.context.PocketOwnerSaveBoundary.hasSyncedOwner(), true);
  assert.equal(fresh.context.hasPocketUnsavedChanges(), false);
  assert.equal(plain(vm.runInContext("state.nodes", fresh.context)).some((node) => node.label === firstEdit), true);
  assert.equal(JSON.stringify(plain(fresh.context.buildPocketPayload())).includes(firstEdit), true);
  const [reopenedRecord] = [...journey.idb.records.values()];
  assert.equal(reopenedRecord.deviceId, deviceId);
  assert.deepEqual(plain(reopenedRecord.deviceEnvelope.metadata), deviceEnvelopeMetadata);
  assert.equal(reopenedRecord.remote.confirmedRevision, 2);
  assert.equal(reopenedRecord.remote.pending, null);
  assert.equal(reopenedRecord.remote.conflict, null);
  assert.equal(journey.remoteCalls.filter((call) => call.route === "addEnvelope").length, grantsBeforeSave);
  assert.equal(journey.remoteCalls.filter((call) => /recovery/i.test(call.route)).length, recoveryCallsBeforeReopen);

  const secondState = vm.runInContext("state", fresh.context);
  secondState.nodes.push({ id: "p103-second-edit", label: secondEdit, children: [] });
  fresh.context.recordOp({ type: "p103-second-edit", id: "p103-second-edit", changed: secondEdit });
  assert.equal(fresh.context.hasPocketUnsavedChanges(), true);
  const secondSaved = await fresh.context.exportTree({ returnDetails: true, downloadFallback: false });
  assert.equal(secondSaved.ok, true, JSON.stringify(secondSaved));
  assert.equal(secondSaved.reason, "synced-save");
  assert.equal(secondSaved.target, "synced");
  assert.equal(fresh.context.hasPocketUnsavedChanges(), false);
  assert.equal((await fresh.readRemoteRevision()).revision, 3);
  const [finalRecord] = [...journey.idb.records.values()];
  assert.equal(finalRecord.deviceId, deviceId);
  assert.equal(finalRecord.remote.confirmedRevision, 3);
  assert.equal(finalRecord.remote.pending, null);
  assert.equal(finalRecord.remote.conflict, null);
  assert.equal(journey.remoteCalls.filter((call) => call.route === "addEnvelope").length, grantsBeforeSave);
  assert.doesNotMatch(JSON.stringify(journey.serviceDriver.snapshot()), new RegExp(`${remoteSentinel}|${firstEdit}|${secondEdit}`));
  assert.doesNotMatch(JSON.stringify(journey.remoteCalls), new RegExp(`${remoteSentinel}|${firstEdit}|${secondEdit}`));
});

test("P104 opens existing Synced truth over a clean local JSON without a refresh, and preserves that local truth if opening fails", async () => {
  const remoteSentinel = "P104 EXISTING SYNCED TRUTH";
  const localSentinel = "P104 LOCAL JSON TRUTH";
  const opened = await createBrowserJourney({
    browserPersistence: true, sameDeviceReopen: true, ownerKind: "none", skipOpenExisting: true,
    remoteSentinel, localJsonTarget: true, localSentinel,
  });
  const grantsBeforeOpen = opened.remoteCalls.filter((call) => call.route === "addEnvelope").length;
  const before = opened.b.capturePocketFileSaveSession();
  assert.equal(before.ownerKind, "json");
  assert.equal(opened.b.hasPocketUnsavedChanges(), false);
  assert.equal(opened.visible.some((node) => node.label === localSentinel), true);
  assert.equal((await opened.openExisting({ discardTarget: {
    ownerKind: "json", continuityId: String(before.id),
  } })).reason, "additional-device-target-dirty");
  assert.deepEqual(plain(await opened.openExisting()), {
    ok: true, reason: "synced-pocket-opened", confirmedRemoteRevision: 1,
  });
  assert.equal(opened.b.capturePocketFileSaveSession().ownerKind, "synced");
  assert.equal(opened.b.PocketOwnerSaveBoundary.hasSyncedOwner(), true);
  assert.equal(opened.b.hasPocketUnsavedChanges(), false);
  assert.equal(opened.visible.some((node) => node.label === remoteSentinel), true);
  assert.equal(opened.visible.some((node) => node.label === localSentinel), false);
  assert.equal(opened.remoteCalls.filter((call) => call.route === "addEnvelope").length, grantsBeforeOpen);

  const failed = await createBrowserJourney({
    browserPersistence: true, sameDeviceReopen: true, ownerKind: "none", skipOpenExisting: true,
    remoteSentinel, localJsonTarget: true, localSentinel,
  });
  const failedGrantsBefore = failed.remoteCalls.filter((call) => call.route === "addEnvelope").length;
  failed.setServerDeviceInvalid(true);
  const failedResult = await failed.openExisting();
  assert.equal(failedResult.ok, false);
  assert.equal(failed.b.capturePocketFileSaveSession().ownerKind, "json");
  assert.equal(failed.b.PocketOwnerSaveBoundary.hasSyncedOwner(), false);
  assert.equal(failed.visible.some((node) => node.label === localSentinel), true);
  assert.equal(failed.b.hasPocketUnsavedChanges(), false);
  assert.equal(failed.remoteCalls.filter((call) => call.route === "addEnvelope").length, failedGrantsBefore);
});

test("P104b allows an explicit matching dirty-JSON discard permit only for the transactional Synced adoption", async () => {
  const remoteSentinel = "P104b EXISTING SYNCED TRUTH";
  const localSentinel = "P104b DIRTY LOCAL JSON";
  const opened = await createBrowserJourney({
    browserPersistence: true, sameDeviceReopen: true, ownerKind: "none", skipOpenExisting: true,
    remoteSentinel, localJsonTarget: true, localJsonDirty: true, localSentinel,
  });
  const before = opened.b.capturePocketFileSaveSession();
  assert.equal(opened.b.hasPocketUnsavedChanges(), true);
  assert.deepEqual(plain(await opened.openExisting({ discardTarget: {
    ownerKind: "json", continuityId: String(before.id),
  } })), { ok: true, reason: "synced-pocket-opened", confirmedRemoteRevision: 1 });
  assert.equal(opened.b.capturePocketFileSaveSession().ownerKind, "synced");
  assert.equal(opened.visible.some((node) => node.label === remoteSentinel), true);

  const failed = await createBrowserJourney({
    browserPersistence: true, sameDeviceReopen: true, ownerKind: "none", skipOpenExisting: true,
    remoteSentinel, localJsonTarget: true, localJsonDirty: true, localSentinel,
  });
  const failedBefore = failed.b.capturePocketFileSaveSession();
  failed.setServerDeviceInvalid(true);
  const rejected = await failed.openExisting({ discardTarget: {
    ownerKind: "json", continuityId: String(failedBefore.id),
  } });
  assert.equal(rejected.ok, false);
  assert.equal(failed.b.capturePocketFileSaveSession().ownerKind, "json");
  assert.equal(failed.b.hasPocketUnsavedChanges(), true);
  assert.equal(failed.visible.some((node) => node.label === localSentinel), true);
});

test("P104i retires dirty JSON current safety only after the final Synced owner hand-off", async () => {
  const journey = await createBrowserJourney({
    browserPersistence: true, sameDeviceReopen: true, ownerKind: "none", skipOpenExisting: true,
    localJsonTarget: true, localJsonDirty: true, remoteSentinel: "P104i SYNCED TRUTH",
  });
  const currentKey = "pocketLite.localSafety.snapshot.v1";
  const trailKey = "pocketLite.localSafety.trail.v1";
  const previousSafety = journey.b.__localStorage.values.get(currentKey);
  assert.ok(previousSafety);
  let retirementBoundary = null;
  const retireSafety = journey.b.retireJsonSafetyForSyncedDiscard;
  journey.b.retireJsonSafetyForSyncedDiscard = (token) => {
    retirementBoundary = {
      session: plain(journey.b.capturePocketFileSaveSession()),
      hasSyncedOwner: journey.b.PocketOwnerSaveBoundary.hasSyncedOwner(),
      currentSafety: journey.b.__localStorage.values.get(currentKey),
    };
    return retireSafety(token);
  };
  let jsonWrites = 0;
  const writeTruthFile = journey.b.writeTruthFile;
  journey.b.writeTruthFile = async (...input) => {
    jsonWrites += 1;
    return writeTruthFile(...input);
  };
  const before = journey.b.capturePocketFileSaveSession();
  const opened = await journey.openExisting({ discardTarget: {
    ownerKind: "json", continuityId: String(before.id),
  } });

  assert.equal(opened.ok, true, JSON.stringify(opened));
  assert.equal(jsonWrites, 0);
  assert.deepEqual(retirementBoundary, {
    session: {
      id: retirementBoundary.session.id,
      handle: null,
      ownerKind: "synced",
      storagePrivacy: "synced",
      vaultSessionId: "",
      displayName: "Synced Pocket",
      writable: true,
      pipSession: false,
      detachedDeviceChanges: false,
    },
    hasSyncedOwner: true,
    currentSafety: previousSafety,
  });
  assert.equal(journey.b.__localStorage.values.has(currentKey), false);
  assert.ok(JSON.parse(journey.b.__localStorage.values.get(trailKey))
    .some((entry) => JSON.stringify(entry) === previousSafety));
  assert.equal(journey.b.capturePocketFileSaveSession().ownerKind, "synced");
  assert.equal(journey.b.capturePocketFileSaveSession().storagePrivacy, "synced");
  assert.equal(journey.b.PocketOwnerSaveBoundary.hasSyncedOwner(), true);
});

test("P104i-a suppresses the real pre-transition P016 check only through its explicit loaded-state flag", async () => {
  const journey = await createBrowserJourney({
    browserPersistence: true, sameDeviceReopen: true, ownerKind: "none", skipOpenExisting: true,
    localJsonTarget: true, localJsonDirty: true, p016Dom: true,
  });
  const currentKey = "pocketLite.localSafety.snapshot.v1";
  const before = journey.b.capturePocketFileSaveSession();
  const localState = vm.runInContext("state", journey.b);
  localState.nodes[0].details = "P104i-a live JSON differs from its captured safety";
  const originalCommit = journey.b.commitPreparedPocketDocument;
  let controlOpened = false;
  let suppressedAttempt = true;
  journey.b.commitPreparedPocketDocument = (norm, sourceInfo, options) => {
    const loadedStateOptions = options?.loadedStateOptions;
    assert.equal(loadedStateOptions?.skipLocalSafetyCheck, true);
    const withoutSuppression = { ...loadedStateOptions };
    delete withoutSuppression.skipLocalSafetyCheck;
    controlOpened = journey.b.maybeOfferLocalSafetyRestore(localState.source, withoutSuppression);
    assert.equal(controlOpened, true);
    assert.equal(journey.b.__p016Dom.overlay.hidden, false);
    assert.equal(journey.b.isPocketDeviceChangesDecisionOpen(), true);
    journey.b.__p016Dom.overlay.hidden = true;
    suppressedAttempt = journey.b.maybeOfferLocalSafetyRestore(localState.source, loadedStateOptions);
    assert.equal(suppressedAttempt, false);
    return originalCommit(norm, sourceInfo, options);
  };
  const opened = await journey.openExisting({ discardTarget: {
    ownerKind: "json", continuityId: String(before.id),
  } });

  assert.equal(opened.ok, true, JSON.stringify(opened));
  assert.equal(controlOpened, true);
  assert.equal(suppressedAttempt, false);
  assert.equal(journey.b.__localStorage.values.has(currentKey), false);
  assert.equal(journey.b.capturePocketFileSaveSession().ownerKind, "synced");
});

test("P104i preserves JSON safety across early, prepared, and final-owner hand-off failures", async () => {
  const currentKey = "pocketLite.localSafety.snapshot.v1";
  for (const options of [
    { serverDeviceInvalid: true },
    { peDirtyBeforeCommit: true },
    { installFails: true },
  ]) {
    const journey = await createBrowserJourney({
      browserPersistence: true, sameDeviceReopen: true, ownerKind: "none", skipOpenExisting: true,
      localJsonTarget: true, localJsonDirty: true, ...options,
    });
    const originalSafety = journey.b.__localStorage.values.get(currentKey);
    const originalSession = plain(journey.b.capturePocketFileSaveSession());
    const originalVisible = plain(journey.visible);
    let jsonWrites = 0;
    const writeTruthFile = journey.b.writeTruthFile;
    journey.b.writeTruthFile = async (...input) => {
      jsonWrites += 1;
      return writeTruthFile(...input);
    };
    if (options.serverDeviceInvalid === true) journey.setServerDeviceInvalid(true);
    if (options.installFails === true) {
      const setSession = journey.b.setPocketFileSession;
      journey.b.setPocketFileSession = (...input) => {
        if (input[2]?.ownerKind === "synced") throw new Error("synthetic final owner install failure");
        return setSession(...input);
      };
    }
    const result = await journey.openExisting({ discardTarget: {
      ownerKind: "json", continuityId: String(originalSession.id),
    } });
    assert.equal(result.ok, false, JSON.stringify(options));
    assert.deepEqual(plain(journey.b.capturePocketFileSaveSession()), originalSession, JSON.stringify(options));
    assert.deepEqual(plain(journey.visible), originalVisible, JSON.stringify(options));
    assert.equal(journey.b.__localStorage.values.get(currentKey), originalSafety, JSON.stringify(options));
    assert.equal(journey.b.PocketOwnerSaveBoundary.hasSyncedOwner(), false, JSON.stringify(options));
    assert.equal(jsonWrites, 0, JSON.stringify(options));
  }
});

test("P104i keeps the installed Synced owner when post-success safety retirement fails", async () => {
  const journey = await createBrowserJourney({
    browserPersistence: true, sameDeviceReopen: true, ownerKind: "none", skipOpenExisting: true,
    localJsonTarget: true, localJsonDirty: true,
  });
  const currentKey = "pocketLite.localSafety.snapshot.v1";
  const trailKey = "pocketLite.localSafety.trail.v1";
  const previousSafety = journey.b.__localStorage.values.get(currentKey);
  const retireSafety = journey.b.retireJsonSafetyForSyncedDiscard;
  journey.b.retireJsonSafetyForSyncedDiscard = (token) => {
    journey.b.__localStorage.values.delete(trailKey);
    const setItem = journey.b.localStorage.setItem;
    journey.b.localStorage.setItem = (key, value) => {
      if (key === trailKey) throw new Error("synthetic post-success archive failure");
      return setItem(key, value);
    };
    try { return retireSafety(token); }
    finally { journey.b.localStorage.setItem = setItem; }
  };
  const before = journey.b.capturePocketFileSaveSession();
  const opened = await journey.openExisting({ discardTarget: {
    ownerKind: "json", continuityId: String(before.id),
  } });
  assert.equal(opened.ok, true, JSON.stringify(opened));
  assert.equal(journey.b.capturePocketFileSaveSession().ownerKind, "synced");
  assert.equal(journey.b.PocketOwnerSaveBoundary.hasSyncedOwner(), true);
  assert.equal(journey.b.__localStorage.values.get(currentKey), previousSafety);
});

test("P104c rejects dirty standalone PE work before replacement, including an otherwise valid discard permit", async () => {
  const localSentinel = "P104c LOCAL JSON";
  for (const localJsonDirty of [false, true]) {
    const journey = await createBrowserJourney({
      browserPersistence: true, sameDeviceReopen: true, ownerKind: "none", skipOpenExisting: true,
      localJsonTarget: true, localJsonDirty, localSentinel, standalonePeDirty: true,
    });
    const before = journey.b.capturePocketFileSaveSession();
    const callsBefore = journey.remoteCalls.length;
    const input = localJsonDirty ? { discardTarget: { ownerKind: "json", continuityId: String(before.id) } } : undefined;
    const rejected = await journey.openExisting(input);
    assert.equal(rejected.reason, "additional-device-target-dirty");
    assert.equal(journey.remoteCalls.length, callsBefore);
    assert.equal(journey.b.capturePocketFileSaveSession().ownerKind, "json");
    assert.equal(journey.b.hasPocketUnsavedChanges(), localJsonDirty);
    assert.equal(journey.visible.some((node) => node.label === localSentinel), true);
  }
  const failedSignal = await createBrowserJourney({
    browserPersistence: true, sameDeviceReopen: true, ownerKind: "none", skipOpenExisting: true,
    localJsonTarget: true, localSentinel, standalonePeSignalThrows: true,
  });
  assert.equal((await failedSignal.openExisting()).reason, "additional-device-target-dirty");
  assert.equal(failedSignal.b.capturePocketFileSaveSession().ownerKind, "json");

  const vault = await createBrowserJourney({ ownerKind: "vault", skipOpenExisting: true, standalonePeDirty: true });
  const vaultCallsBefore = vault.remoteCalls.length;
  assert.equal((await vault.openExisting()).reason, "additional-device-target-dirty");
  assert.equal(vault.ownerKind, "vault");
  assert.equal(vault.commits, 0);
  assert.equal(vault.remoteCalls.length, vaultCallsBefore);
});

test("P104c fails closed when standalone PE work becomes dirty before the final local replacement", async () => {
  const localSentinel = "P104c RACE LOCAL JSON";
  const journey = await createBrowserJourney({
    browserPersistence: true, sameDeviceReopen: true, ownerKind: "none", skipOpenExisting: true,
    localJsonTarget: true, localJsonDirty: true, localSentinel, peDirtyBeforeCommit: true,
  });
  const before = journey.b.capturePocketFileSaveSession();
  const rejected = await journey.openExisting({ discardTarget: {
    ownerKind: "json", continuityId: String(before.id),
  } });
  assert.equal(rejected.reason, "additional-device-target-dirty");
  assert.equal(journey.b.capturePocketFileSaveSession().ownerKind, "json");
  assert.equal(journey.b.hasPocketUnsavedChanges(), true);
  assert.equal(journey.visible.some((node) => node.label === localSentinel), true);
});

test("P104a persists canonical selected truth through the existing Synced owner and reopens it as an ordinary healthy Pocket", async () => {
  const remoteSentinel = "P104a REMOTE BEFORE HANDOVER";
  const handoverSentinel = "P104a CANONICAL HANDOVER TRUTH";
  const reopenedEdit = "P104a REOPENED ORDINARY EDIT";
  const journey = await createBrowserJourney({
    browserPersistence: true, captureSessionTransitions: true, sameDeviceReopen: true,
    ownerKind: "none", remoteSentinel,
  });
  assert.equal(journey.opened.ok, true);
  assert.equal(journey.ownerKind, "synced");
  assert.equal(journey.visible.some((node) => node.label === remoteSentinel), true);
  const [before] = [...journey.idb.records.values()];
  const deviceId = before.deviceId;
  const deviceEnvelopeMetadata = plain(before.deviceEnvelope.metadata);
  const grantsBefore = journey.remoteCalls.filter((call) => call.route === "addEnvelope").length;
  const recoveryBefore = journey.remoteCalls.filter((call) => /recovery/i.test(call.route)).length;
  let sourceWrites = 0;
  const sourcePayload = {
    sourceRootExtra: "P104a root extra",
    schema: "portal.export.v1",
    exportedAt: "2041-01-01T00:00:00.000Z",
    writtenAt: "2041-01-01T00:00:00.000Z",
    mainThoughtTree: [{ id: "p104a-selected", label: handoverSentinel, details: handoverSentinel, children: [] }],
    mainThoughtTreeTombstones: [],
    data: {
      sourceDataExtra: "P104a data extra",
      mainThoughtTree: [{ id: "p104a-selected", label: handoverSentinel, details: handoverSentinel, children: [] }],
      mainThoughtTreeTombstones: [],
    },
  };
  journey.b.PocketFileOpening = {
    async chooseExistingFile() {
      return {
        ok: true, kind: "json", fileName: "p104a-selected.json", payload: sourcePayload,
        handle: { async createWritable() { sourceWrites += 1; throw new Error("selected source must remain untouched"); } },
      };
    },
  };
  assert.equal(await journey.b.PocketSyncedTruthHandover.begin(), true);
  assert.equal(sourceWrites, 0);
  assert.equal((await journey.readRemoteRevision()).revision, 2);
  const [handedOver] = [...journey.idb.records.values()];
  assert.equal(handedOver.deviceId, deviceId);
  assert.deepEqual(plain(handedOver.deviceEnvelope.metadata), deviceEnvelopeMetadata);
  assert.equal(handedOver.remote.confirmedRevision, 2);
  assert.equal(handedOver.remote.pending, null);
  assert.equal(handedOver.remote.conflict, null);
  assert.equal(journey.b.capturePocketFileSaveSession().ownerKind, "synced");
  assert.equal(journey.b.hasPocketUnsavedChanges(), false);
  assert.equal(journey.visible.some((node) => node.label === handoverSentinel), true);
  assert.equal(journey.remoteCalls.filter((call) => call.route === "addEnvelope").length, grantsBefore);
  assert.equal(journey.remoteCalls.filter((call) => /recovery/i.test(call.route)).length, recoveryBefore);
  assert.doesNotMatch(JSON.stringify(journey.serviceDriver.snapshot()), new RegExp(`${remoteSentinel}|${handoverSentinel}`));
  assert.doesNotMatch(JSON.stringify(journey.remoteCalls), new RegExp(`${remoteSentinel}|${handoverSentinel}`));

  const fresh = journey.createFreshBrowserRuntime();
  assert.deepEqual(plain(await fresh.openExisting()), {
    ok: true, reason: "synced-pocket-opened", confirmedRemoteRevision: 2,
  });
  assert.equal(fresh.context.capturePocketFileSaveSession().ownerKind, "synced");
  assert.equal(fresh.context.hasPocketUnsavedChanges(), false);
  assert.equal(plain(vm.runInContext("state.nodes", fresh.context)).some((node) => node.label === handoverSentinel), true);
  assert.equal(vm.runInContext("state.rootExtras.sourceRootExtra", fresh.context), "P104a root extra");
  const [reopened] = [...journey.idb.records.values()];
  assert.equal(reopened.deviceId, deviceId);
  assert.deepEqual(plain(reopened.deviceEnvelope.metadata), deviceEnvelopeMetadata);
  assert.equal(journey.remoteCalls.filter((call) => call.route === "addEnvelope").length, grantsBefore);
  assert.equal(journey.remoteCalls.filter((call) => /recovery/i.test(call.route)).length, recoveryBefore);

  const freshState = vm.runInContext("state", fresh.context);
  freshState.nodes.push({ id: "p104a-reopened-edit", label: reopenedEdit, children: [] });
  fresh.context.recordOp({ type: "p104a-reopened-edit", id: "p104a-reopened-edit", changed: reopenedEdit });
  const saved = await fresh.context.exportTree({ returnDetails: true, downloadFallback: false });
  assert.equal(saved.ok, true, JSON.stringify(saved));
  assert.equal(saved.reason, "synced-save");
  assert.equal((await fresh.readRemoteRevision()).revision, 3);
  assert.equal(fresh.context.hasPocketUnsavedChanges(), false);
  assert.doesNotMatch(JSON.stringify(journey.serviceDriver.snapshot()), new RegExp(`${remoteSentinel}|${handoverSentinel}|${reopenedEdit}`));
  assert.doesNotMatch(JSON.stringify(journey.remoteCalls), new RegExp(`${remoteSentinel}|${handoverSentinel}|${reopenedEdit}`));
});

test("P052c production browser adoption keeps visible truth and authority coherent across final transition failures", async () => {
  const targetChanged = await createBrowserJourney({ targetChangesBeforeCommit: true });
  assert.equal(targetChanged.opened.ok, false);
  assert.equal(targetChanged.visible, null);
  assert.equal(targetChanged.ownerKind, "detached");
  assert.equal(targetChanged.b.PocketOwnerSaveBoundary.hasSyncedOwner(), false);

  const commitFailed = await createBrowserJourney({ commitFails: true });
  assert.equal(commitFailed.opened.ok, false);
  assert.equal(commitFailed.visible, null);
  assert.equal(commitFailed.b.PocketOwnerSaveBoundary.hasSyncedOwner(), false);

  const adoptionFailed = await createBrowserJourney({ ownerAdoptionFailsAfterCommit: true });
  assert.deepEqual(plain(adoptionFailed.opened), {
    ok: false, reason: "owner-adoption-failed", adopted: false,
    partialState: "visible-payload-committed-detached",
  });
  assert.notEqual(adoptionFailed.visible, null);
  assert.equal(adoptionFailed.b.PocketOwnerSaveBoundary.hasSyncedOwner(), false);

  const installFailed = await createBrowserJourney({ installFails: true });
  assert.deepEqual(plain(installFailed.opened), {
    ok: false, reason: "owner-adoption-failed", adopted: false,
    partialState: "visible-payload-committed-detached",
  });
  assert.notEqual(installFailed.visible, null);
  assert.equal(installFailed.b.PocketOwnerSaveBoundary.hasSyncedOwner(), false);
});

test("P052d resumes completed Device B enrolment after post-grant browser failures without another grant", async () => {
  for (const [name, options] of Object.entries({
    target: { targetChangesBeforeCommit: true }, commit: { commitFails: true },
    adoption: { ownerAdoptionFailsAfterCommit: true }, install: { installFails: true },
  })) {
    const journey = await createBrowserJourney(options);
    assert.equal(journey.opened.ok, false, name);
    assert.equal(journey.b.PocketOwnerSaveBoundary.hasSyncedOwner(), false, name);
    const before = [...journey.idb.records.values()][0];
    assert.equal(before.additionalDeviceDraft, null, name);
    assert.equal(before.usage.masterKeyContentEncryptionLimit, 2 ** 20, name);
    const metadata = plain(before.deviceEnvelope.metadata);
    const grantCalls = journey.remoteCalls.filter((call) => call.route === "addEnvelope").length;
    journey.clearFaults();
    const retry = await journey.openExisting();
    assert.deepEqual(plain(retry), { ok: true, reason: "synced-pocket-opened", confirmedRemoteRevision: 1 }, name);
    const after = [...journey.idb.records.values()][0];
    assert.deepEqual(plain(after.deviceEnvelope.metadata), metadata, name);
    assert.equal(after.usage.masterKeyContentEncryptionLimit, 2 ** 20, name);
    assert.equal(journey.remoteCalls.filter((call) => call.route === "addEnvelope").length, grantCalls, name);
    assert.equal(journey.b.PocketOwnerSaveBoundary.hasSyncedOwner(), true, name);
    const saved = await journey.b.PocketOwnerSaveBoundary.save({
      expectedSession: journey.b.capturePocketFileSaveSession(),
      async freezePayload() { return { schema: "portal.export.v1", notes: [`P052d ${name} retry Save`] }; },
    });
    assert.equal(saved.ok, true, name);
    assert.equal(saved.confirmedRemoteRevision, 2, name);
  }
});

test("P052f retries a completed Device B owner-eligibility failure without another grant", async () => {
  const journey = await createBrowserJourney({ commitFails: true });
  assert.equal(journey.opened.ok, false);
  assert.equal(journey.visible, null);
  assert.equal(journey.b.PocketOwnerSaveBoundary.hasSyncedOwner(), false);
  const [before] = [...journey.idb.records.values()];
  assert.equal(before.additionalDeviceDraft, null);
  assert.equal(before.usage.masterKeyContentEncryptionLimit, 2 ** 20);
  const deviceId = before.deviceId;
  const metadata = plain(before.deviceEnvelope.metadata);
  const grants = journey.remoteCalls.filter((call) => call.route === "addEnvelope").length;
  journey.clearFaults();
  let completedReadSeen = false;
  journey.idb.setBeforeRead(({ value }) => {
    if (!completedReadSeen) { completedReadSeen = true; return value; }
    return value && Object.assign({}, value, {
      content: Object.assign({}, value.content, { context: Object.assign({}, value.content.context, { revision: 99 }) }),
    });
  });
  const rejected = await journey.openExisting();
  assert.equal(rejected.reason, "owner-adoption-failed");
  assert.equal(journey.visible, null);
  assert.equal(journey.b.PocketOwnerSaveBoundary.hasSyncedOwner(), false);
  assert.equal(journey.remoteCalls.filter((call) => call.route === "addEnvelope").length, grants);
  journey.idb.setBeforeRead(null);
  assert.equal((await journey.openExisting()).ok, true);
  const after = [...journey.idb.records.values()][0];
  assert.equal(after.deviceId, deviceId);
  assert.deepEqual(plain(after.deviceEnvelope.metadata), metadata);
  assert.equal(after.usage.masterKeyContentEncryptionLimit, 2 ** 20);
  assert.equal(journey.remoteCalls.filter((call) => call.route === "addEnvelope").length, grants);
  const saved = await journey.b.PocketOwnerSaveBoundary.save({
    expectedSession: journey.b.capturePocketFileSaveSession(),
    async freezePayload() { return { schema: "portal.export.v1", notes: ["P052f completed retry Save"] }; },
  });
  assert.equal(saved.ok, true);
  assert.equal(saved.confirmedRemoteRevision, 2);
});

test("P052e refuses a dirty detached target before any Device B mutation", async () => {
  const journey = await createBrowserJourney({ detachedDirty: true });
  assert.equal(journey.opened.reason, "additional-device-target-dirty");
  assert.equal(journey.visible, null);
  assert.equal(journey.ownerKind, "detached");
  assert.equal(journey.b.PocketOwnerSaveBoundary.hasSyncedOwner(), false);
  assert.equal(journey.idb.records.size, 0);
  assert.equal(journey.remoteCalls.filter((call) => call.route === "addEnvelope").length, 2);
});

test("P052g retries a Device B completed while detached truth became dirty during onboarding", async () => {
  const journey = await createBrowserJourney({ dirtyBeforeCommit: true });
  assert.equal(journey.opened.reason, "additional-device-target-dirty");
  assert.equal(journey.visible, null);
  assert.equal(journey.ownerKind, "detached");
  assert.equal(journey.b.PocketOwnerSaveBoundary.hasSyncedOwner(), false);
  const [before] = [...journey.idb.records.values()];
  assert.equal(before.kind, "pocket.sync.device-state");
  assert.equal(before.schemaVersion, 5);
  assert.equal(before.additionalDeviceDraft, null);
  assert.equal(before.usage.masterKeyContentEncryptionLimit, 2 ** 20);
  const deviceId = before.deviceId;
  const metadata = plain(before.deviceEnvelope.metadata);
  const grants = journey.remoteCalls.filter((call) => call.route === "addEnvelope").length;
  journey.clearFaults();
  journey.setDirtyBeforeCommit(false);
  journey.setDetachedDirty(false);
  const retry = await journey.openExisting();
  assert.equal(retry.ok, true, JSON.stringify(retry));
  const [after] = [...journey.idb.records.values()];
  assert.equal(after.deviceId, deviceId);
  assert.deepEqual(plain(after.deviceEnvelope.metadata), metadata);
  assert.equal(after.usage.masterKeyContentEncryptionLimit, 2 ** 20);
  assert.equal(journey.remoteCalls.filter((call) => call.route === "addEnvelope").length, grants);
  assert.notEqual(journey.visible, null);
  assert.equal(journey.b.PocketOwnerSaveBoundary.hasSyncedOwner(), true);
  const saved = await journey.b.PocketOwnerSaveBoundary.save({
    expectedSession: journey.b.capturePocketFileSaveSession(),
    async freezePayload() { return { schema: "portal.export.v1", notes: ["P052g dirty transition retry Save"] }; },
  });
  assert.equal(saved.ok, true);
  assert.equal(saved.confirmedRemoteRevision, 2);
});

test("P052f reports a changing detached session as stale rather than dirty", async () => {
  const journey = await createBrowserJourney({ targetChangesBeforeCommit: true });
  assert.equal(journey.opened.reason, "additional-device-target-stale");
  assert.equal(journey.visible, null);
  assert.equal(journey.ownerKind, "detached");
  assert.equal(journey.b.PocketOwnerSaveBoundary.hasSyncedOwner(), false);
});

test("P052f fails closed when the detached dirty-state signal is unavailable", async () => {
  for (const options of [{ dirtySignalMissing: true }, { dirtySignalThrows: true }]) {
    const journey = await createBrowserJourney(options);
    assert.equal(journey.opened.reason, "additional-device-target-dirty");
    assert.equal(journey.visible, null);
    assert.equal(journey.b.PocketOwnerSaveBoundary.hasSyncedOwner(), false);
    assert.equal(journey.idb.records.size, 0);
    assert.equal(journey.remoteCalls.filter((call) => call.route === "addEnvelope").length, 2);
  }
});

test("P052f keeps a none target on the public adoption and boundary Save path", async () => {
  const journey = await createBrowserJourney({ ownerKind: "none" });
  assert.equal(journey.opened.ok, true, JSON.stringify(journey.opened));
  assert.equal(journey.b.PocketOwnerSaveBoundary.hasSyncedOwner(), true);
  const saved = await journey.b.PocketOwnerSaveBoundary.save({
    expectedSession: journey.b.capturePocketFileSaveSession(),
    async freezePayload() { return { schema: "portal.export.v1", notes: ["P052f none target Save"] }; },
  });
  assert.equal(saved.ok, true);
  assert.equal(saved.confirmedRemoteRevision, 2);
});

test("P052e preserves a dirty detached partial retry without another Device B grant", async () => {
  const journey = await createBrowserJourney({ installFails: true });
  assert.equal(journey.opened.ok, false);
  const visible = plain(journey.visible);
  const grants = journey.remoteCalls.filter((call) => call.route === "addEnvelope").length;
  journey.clearFaults();
  journey.setDetachedDirty(true);
  const retry = await journey.openExisting();
  assert.equal(retry.reason, "additional-device-target-dirty");
  assert.deepEqual(plain(journey.visible), visible);
  assert.equal(journey.ownerKind, "detached");
  assert.equal(journey.b.PocketOwnerSaveBoundary.hasSyncedOwner(), false);
  assert.equal(journey.remoteCalls.filter((call) => call.route === "addEnvelope").length, grants);
});

test("P052e permits an explicit clean retry after a transient completed-state reopen failure", async () => {
  const journey = await createBrowserJourney({ targetChangesBeforeCommit: true });
  assert.equal(journey.opened.ok, false);
  const grants = journey.remoteCalls.filter((call) => call.route === "addEnvelope").length;
  journey.clearFaults();
  journey.setReadRevisionFailure(true);
  assert.equal((await journey.openExisting()).reason, "additional-device-open-failed");
  assert.equal(journey.remoteCalls.filter((call) => call.route === "addEnvelope").length, grants);
  journey.setReadRevisionFailure(false);
  assert.equal((await journey.openExisting()).ok, true);
  assert.equal(journey.remoteCalls.filter((call) => call.route === "addEnvelope").length, grants);
});

test("P052e rejects malformed completed local state without replacement identifiers", async () => {
  const journey = await createBrowserJourney({ targetChangesBeforeCommit: true });
  assert.equal(journey.opened.ok, false);
  const grants = journey.remoteCalls.filter((call) => call.route === "addEnvelope").length;
  const [record] = [...journey.idb.records.values()];
  journey.idb.records.set(record.syncedPocketId, Object.assign({}, record, {
    content: Object.assign({}, record.content, { context: Object.assign({}, record.content.context, { revision: "invalid" }) }),
  }));
  journey.clearFaults();
  const rejected = await journey.openExisting();
  assert.equal(rejected.reason, "additional-device-state-invalid");
  assert.equal(journey.visible, null);
  assert.equal(journey.b.PocketOwnerSaveBoundary.hasSyncedOwner(), false);
  assert.equal(journey.remoteCalls.filter((call) => call.route === "addEnvelope").length, grants);
});

test("P052d reopens an enrolled Device B without PRF output but keeps new devices recoverable", async () => {
  const journey = await createBrowserJourney({ targetChangesBeforeCommit: true });
  assert.equal(journey.opened.ok, false);
  const grants = journey.remoteCalls.filter((call) => call.route === "addEnvelope").length;
  journey.clearFaults();
  journey.setPrfUnavailable(true);
  const retry = await journey.openExisting();
  assert.equal(retry.ok, true, JSON.stringify(retry));
  assert.equal(journey.remoteCalls.filter((call) => call.route === "addEnvelope").length, grants);
});

test("P052d refuses a completed Device B whose active server envelope disappeared", async () => {
  const journey = await createBrowserJourney({ targetChangesBeforeCommit: true });
  assert.equal(journey.opened.ok, false);
  const grants = journey.remoteCalls.filter((call) => call.route === "addEnvelope").length;
  journey.clearFaults();
  journey.setServerDeviceInvalid(true);
  const rejected = await journey.openExisting();
  assert.equal(rejected.reason, "remote-device-state-invalid");
  assert.equal(journey.b.PocketOwnerSaveBoundary.hasSyncedOwner(), false);
  assert.equal(journey.remoteCalls.filter((call) => call.route === "addEnvelope").length, grants);
  journey.setServerDeviceInvalid(false);
  assert.equal((await journey.openExisting()).ok, true);
});

test("P052d rejects listed/downloaded PRF metadata drift before Device B mutation", async () => {
  const context = { Object, Array, Number, String, Boolean, Error, Promise, Uint8Array, Date };
  context.window = context; context.globalThis = context; vm.createContext(context);
  vm.runInContext(source("js/pocket-sync-additional-device.js"), context);
  for (const changed of ["envelopeVersion", "kdfSalt", "derivationVersion"]) {
    let mutations = 0;
    const listed = { envelopeId: "prf", envelopeKind: "passkey-prf", envelopeVersion: 1,
      deviceId: null, credentialId: "credential", kdf: "HKDF-SHA-256", kdfSalt: "salt-a", derivationVersion: 1, status: "active" };
    const downloaded = Object.assign({}, listed, { kdfSalt: "salt-a", encryptedEnvelope: {} },
      changed === "envelopeVersion" ? { envelopeVersion: 2 }
        : (changed === "kdfSalt" ? { kdfSalt: "salt-b" } : { derivationVersion: 2 }));
    const opener = context.PocketSyncAdditionalDevice.createAdditionalDeviceOpener({
      crypto: { FORMAT: { contentType: "portal.export.v1+json" }, encodeBase64Url: () => "id",
        async generateDeviceWrappingKey() {}, async deriveWrappingKey() {}, async openMasterKeyBundle() {},
        async openContent() {}, async sealContent() {}, validateNonExtractableAesKey() {} },
      deviceStore: { async open() {}, async readPocket() { return null; }, async createPocket() { mutations += 1; }, async replacePocket() { mutations += 1; }, async reservePocketEncryptionUsage() {} },
      accountClient: { async authenticatePasskey() { return { ok: true, accountAuthenticated: true,
        contentUnlocked: false, accountId: "account", credentialId: "credential",
        prf: { status: "available", outputBytes: new Uint8Array(32) } }; } },
      discoveryService: { async readSyncedPocket() { return { status: "ready", syncedPocketId: "pocket" }; } },
      contentService: { async readRevision() { throw new Error("must not read"); }, async downloadEncryptedRecord() {} },
      envelopeService: { async listEnvelopes() { return { keySetVersion: 1, envelopes: [listed] }; },
        async downloadEnvelope() { return { keySetVersion: 1, envelope: downloaded }; }, async addEnvelope() { mutations += 1; } },
      randomBytes: () => new Uint8Array(32), now: () => 0,
    });
    const result = await opener.openExisting({ captureTarget: () => ({ ownerKind: "detached", id: changed }),
      isTargetCurrent: () => true, validatePayload: () => true, adoptOpenedPocket: async () => true });
    assert.equal(result.reason, "remote-key-state-invalid", changed);
    assert.equal(mutations, 0, changed);
  }
});
