"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const ROOT = path.resolve(__dirname, "..");
const OPENING_PATH = path.join(ROOT, "js/pocket-file-opening.js");
const VAULT_KIND = "pocket.vault.v1";

function plainPayload(label = "P206d") {
  return {
    schema: "portal.export.v1",
    mainThoughtTree: [{ id: "p206d", label }],
    mainThoughtTreeTombstones: [],
    data: {
      mainThoughtTree: [{ id: "p206d", label }],
      mainThoughtTreeTombstones: [],
    },
  };
}

function createHarness(options = {}) {
  const session = { id: 206, ownerKind: "json" };
  const statuses = [];
  const loads = [];
  const vaultOpens = [];
  const pickerCalls = [];
  let current = true;

  const name = options.name || "P206d-control.pocket";
  const raw = options.raw !== undefined
    ? options.raw
    : JSON.stringify(options.parsed !== undefined ? options.parsed : plainPayload());
  const file = {
    name,
    async text() { return raw; },
  };
  const handle = {
    name,
    async getFile() { return file; },
  };

  const context = {
    Object, Array, String, Boolean, Number, Error, Promise, JSON,
    PocketOutlinePersistencePolicy: { LIMITS: { localFileChars: 1_000_000 } },
    cleanText(value, max = 120) { return String(value || "").trim().slice(0, max); },
    isPocketPayloadShape(value) {
      return !!value
        && typeof value === "object"
        && value.schema === "portal.export.v1"
        && Array.isArray(value.mainThoughtTree);
    },
    PocketCrypto: {
      FORMAT: { kind: VAULT_KIND },
      isVaultEnvelope(value) { return value?.kind === VAULT_KIND; },
      validateEnvelope(value) {
        if (value?.valid !== true) throw new Error("damaged vault");
        return true;
      },
    },
    PocketVaultRecovery: { isFlowOpen() { return false; } },
    isPocketFilePermissionPromptOpen() { return false; },
    isPocketDeviceChangesDecisionOpen() { return false; },
    capturePocketFileSaveSession() { return session; },
    isPocketFileSaveSessionCurrent(value) { return current && value === session; },
    async showOpenFilePicker(pickerOptions) {
      pickerCalls.push(JSON.parse(JSON.stringify(pickerOptions)));
      if (options.cancel === true) {
        const error = new Error("synthetic cancellation");
        error.name = "AbortError";
        throw error;
      }
      if (options.staleAfterPicker === true) current = false;
      return [handle];
    },
    async loadFromFileHandle(openedHandle, loadOptions) {
      loads.push({ handle: openedHandle, options: loadOptions });
      return true;
    },
    PocketVaultBrowserIo: {
      async openVaultFile(openedHandle, sourceSession) {
        vaultOpens.push({ handle: openedHandle, sourceSession });
        return true;
      },
    },
    setStatus(message, kind) { statuses.push({ message, kind }); },
  };
  context.window = context;
  context.globalThis = context;
  vm.createContext(context);
  vm.runInContext(fs.readFileSync(OPENING_PATH, "utf8"), context, {
    filename: "pocket-file-opening.js",
  });
  return {
    context,
    handle,
    session,
    statuses,
    loads,
    vaultOpens,
    pickerCalls,
    setCurrent(value) { current = value; },
  };
}

test("P206d ordinary existing-file picker accepts only .json, .pocket and .vault", () => {
  const harness = createHarness();
  const options = JSON.parse(JSON.stringify(harness.context.PocketFileOpening.pickerOptions()));
  assert.deepEqual(options, {
    types: [{
      description: "Pocket file",
      accept: { "application/json": [".json", ".pocket", ".vault"] },
    }],
    multiple: false,
  });
});

test("P206d opens valid plain Pocket JSON under .pocket through the same path as .json", async () => {
  for (const name of ["existing-pocket.json", "existing-pocket.pocket"]) {
    const harness = createHarness({ name, parsed: plainPayload(name) });
    assert.equal(await harness.context.PocketFileOpening.chooseAndOpen(), true, name);
    assert.equal(harness.loads.length, 1, name);
    assert.equal(harness.vaultOpens.length, 0, name);
    assert.equal(harness.loads[0].handle, harness.handle, name);
    assert.equal(harness.loads[0].options.displayName, name, name);
    assert.equal(harness.loads[0].options.sourceSession, harness.session, name);
  }
});

test("P206d rejects malformed or unsupported .pocket contents before adoption", async () => {
  const malformed = createHarness({ name: "broken.pocket", raw: "{not-json" });
  assert.equal(await malformed.context.PocketFileOpening.chooseAndOpen(), false);
  assert.equal(malformed.loads.length, 0);
  assert.equal(malformed.vaultOpens.length, 0);
  assert.equal(malformed.statuses.length, 1);

  const unsupported = createHarness({
    name: "unsupported.pocket",
    parsed: { schema: "something.else", hello: "world" },
  });
  assert.equal(await unsupported.context.PocketFileOpening.chooseAndOpen(), false);
  assert.equal(unsupported.loads.length, 0);
  assert.equal(unsupported.vaultOpens.length, 0);
  assert.equal(unsupported.statuses.length, 1);
});

test("P206d leaves encrypted Vault classification and opening unchanged", async () => {
  const harness = createHarness({
    name: "existing.vault",
    parsed: { kind: VAULT_KIND, valid: true, ciphertext: "unchanged" },
  });
  assert.equal(await harness.context.PocketFileOpening.chooseAndOpen(), true);
  assert.equal(harness.vaultOpens.length, 1);
  assert.equal(harness.loads.length, 0);
  assert.equal(harness.vaultOpens[0].handle, harness.handle);
  assert.equal(harness.vaultOpens[0].sourceSession, harness.session);
});

test("P206d preserves picker cancellation and stale-session fail-closed behaviour", async () => {
  const cancelled = createHarness({ cancel: true });
  assert.equal(await cancelled.context.PocketFileOpening.chooseAndOpen(), false);
  assert.equal(cancelled.loads.length, 0);
  assert.equal(cancelled.vaultOpens.length, 0);
  assert.equal(cancelled.statuses.length, 0);

  const stale = createHarness({ staleAfterPicker: true });
  assert.equal(await stale.context.PocketFileOpening.chooseAndOpen(), false);
  assert.equal(stale.loads.length, 0);
  assert.equal(stale.vaultOpens.length, 0);
  assert.equal(stale.statuses.length, 0);
});
