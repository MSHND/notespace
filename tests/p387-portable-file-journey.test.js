"use strict";
/*
 P387 disposable core–shell–platform file boundary experiment.
 TEST ONLY: loads accepted Pocket editor, document, Save-owner and file IO.
 Browser-style memory handle versus independently persisted real temporary
 filesystem handle; both use the existing FileSystemFileHandle-shaped edge.
 Not a native app, OS credential solution, or live encrypted Sync proof.
*/
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const fsp = require("node:fs/promises");
const path = require("node:path");
const os = require("node:os");
const vm = require("node:vm");
const { createRequire } = require("node:module");

const ROOT = path.resolve(__dirname, "..");
const TEST_HARNESS = path.join(__dirname, "device-changes-resolution.test.js");
const TEXT = "A thought that belongs to the same Pocket everywhere.";
const START = "2026-07-01T00:00:00.000Z";

function loadPocket() {
  let code = fs.readFileSync(TEST_HARNESS, "utf8");
  const declaration = 'const test = require("node:test");';
  assert.ok(code.includes(declaration));
  code = code.replace(declaration, "const test = () => {};");
  code += "\nmodule.exports = { createIntegrationContext };\n";
  const m = { exports: {} };
  new Function("require", "module", "exports", "__filename", "__dirname", code)(
    createRequire(TEST_HARNESS), m, m.exports, TEST_HARNESS, __dirname
  );
  return m.exports.createIntegrationContext;
}
const createContext = loadPocket();

function seed() {
  const nodes = [
    { id: "idea", parentId: "root", label: "Same idea", details: "Before",
      order: 1001, updatedAt: START, source: "manual" },
    { id: "other", parentId: "root", label: "Other idea",
      details: "Do not change", order: 1002, updatedAt: START, source: "manual" },
  ];
  return { schema: "portal.export.v1", writtenAt: START,
    mainThoughtTree: nodes, mainThoughtTreeTombstones: [],
    data: { mainThoughtTree: nodes, mainThoughtTreeTombstones: [] } };
}

function memoryFile() {
  const p = { text: JSON.stringify(seed(), null, 2) + "\n", permission: "granted",
    writes: 0, closes: 0, aborts: 0, opened: 0, onWrite: null, fail: false, version: 1 };
  return {
    p,
    getHandle() {
      return {
        name: "p387-memory.pocket",
        async queryPermission() { return p.permission; },
        async requestPermission() { return p.permission; },
        async getFile() { return {
          name: "p387-memory.pocket", lastModified: p.version,
          async text() { return p.text; },
        }; },
        async createWritable() {
          p.opened += 1;
          let staged = "";
          return {
            async write(data) {
              p.writes += 1;
              staged = String(data);
              if (p.onWrite) await p.onWrite();
              if (p.fail) throw new Error("synthetic write failure");
            },
            async close() { p.closes += 1; p.text = staged; p.version += 1; },
            async abort() { p.aborts += 1; },
          };
        },
      };
    },
    async read() { return p.text; },
    async replace(data) { p.text = data; p.version += 1; },
    async close() {},
  };
}

/* Test-only OS translator. All writes stay inside an owned temporary directory.
   A failed or aborted write never renames the staging file into saved truth. */
async function osFile() {
  const dir = await fsp.mkdtemp(path.join(os.tmpdir(), "pocket-p387-"));
  const filename = path.join(dir, "p387-os.pocket");
  await fsp.writeFile(filename, JSON.stringify(seed(), null, 2) + "\n",
    { mode: 0o600 });
  const p = { permission: "granted", writes: 0, closes: 0,
    aborts: 0, opened: 0, onWrite: null, fail: false, ordinal: 0 };
  return {
    p,
    getHandle() {
      return {
        name: "p387-os.pocket",
        async queryPermission() { return p.permission; },
        async requestPermission() { return p.permission; },
        async getFile() {
          const [bytes, stat] = await Promise.all([
            fsp.readFile(filename, "utf8"), fsp.stat(filename),
          ]);
          return { name: "p387-os.pocket", lastModified: stat.mtimeMs,
            async text() { return bytes; } };
        },
        async createWritable() {
          p.opened += 1;
          const stage = path.join(dir, ".stage-" + (++p.ordinal));
          let staged = false;
          return {
            async write(data) {
              p.writes += 1;
              await fsp.writeFile(stage, String(data), { flag: "wx", mode: 0o600 });
              staged = true;
              if (p.onWrite) await p.onWrite();
              if (p.fail) throw new Error("synthetic write failure");
            },
            async close() {
              if (!staged) throw new Error("nothing staged");
              await fsp.rename(stage, filename);
              staged = false;
              p.closes += 1;
            },
            async abort() {
              p.aborts += 1;
              if (staged) await fsp.rm(stage, { force: true });
              staged = false;
            },
          };
        },
      };
    },
    async read() { return fsp.readFile(filename, "utf8"); },
    async replace(data) { await fsp.writeFile(filename, data); },
    async close() { await fsp.rm(dir, { recursive: true, force: true }); },
  };
}

async function withAdapter(kind, execute) {
  const adapter = kind === "browser" ? memoryFile() : await osFile();
  try { await execute(adapter); } finally { await adapter.close(); }
}
function nodes(context) {
  return vm.runInContext("state", context).nodes;
}
function pending(context) {
  return vm.runInContext("state", context).ops;
}
async function open(context, adapter) {
  const handle = adapter.getHandle();
  assert.equal(await context.loadFromFileHandle(handle, { displayName: handle.name }),
    true);
  assert.equal(nodes(context).find(n => n.id === "idea").details, "Before");
}
function edit(context) {
  const node = nodes(context).find(n => n.id === "idea");
  const original = context.PocketNodePopoutModel.buildPayload(node);
  assert.equal(original.text, "Before");
  const outcome = context.PocketNodePopoutEditor.apply(
    { ...original, text: TEXT, body: TEXT }, { returnDetails: true, quiet: true }
  );
  assert.equal(outcome.ok, true, JSON.stringify(outcome));
  assert.equal(outcome.changed, true);
  assert.equal(nodes(context).find(n => n.id === "idea").details, TEXT);
}

for (const kind of ["browser", "filesystem"]) {
  test("P387 " + kind + " actual PE -> explicit Save -> restart reopens identical thought",
    async () => withAdapter(kind, async (adapter) => {
      const initial = await adapter.read();
      const context = createContext();
      await open(context, adapter);
      edit(context);
      assert.equal(await adapter.read(), initial, "working edit cannot auto-save");
      assert.equal(adapter.p.opened, 0);
      const receipt = await context.exportTree({ returnDetails: true });
      assert.equal(receipt.ok, true, JSON.stringify(receipt));
      assert.equal(adapter.p.closes, 1);
      assert.equal(pending(context).length, 0);
      const bytes = await adapter.read();
      const saved = JSON.parse(bytes);
      assert.equal(saved.mainThoughtTree.find(n => n.id === "idea").details, TEXT);
      assert.equal(saved.mainThoughtTree.find(n => n.id === "other").details,
        "Do not change");
      const fresh = createContext();
      const newHandle = adapter.getHandle();
      assert.equal(await fresh.loadFromFileHandle(newHandle,
        { displayName: newHandle.name }), true);
      assert.equal(nodes(fresh).find(n => n.id === "idea").details, TEXT);
      assert.equal(nodes(fresh).find(n => n.id === "idea").id, "idea");
      assert.equal(nodes(fresh).find(n => n.id === "other").details,
        "Do not change");
      assert.equal(await adapter.read(), bytes, "Open must not rewrite file");
    })
  );

  test("P387 " + kind + " external file edit stops stale overwrite",
    async () => withAdapter(kind, async (adapter) => {
      const context = createContext();
      await open(context, adapter);
      edit(context);
      const outside = JSON.parse(await adapter.read());
      outside.mainThoughtTree[0].details = "External change";
      outside.data.mainThoughtTree[0].details = "External change";
      const outsideBytes = JSON.stringify(outside, null, 2) + "\n";
      await adapter.replace(outsideBytes);
      const receipt = await context.exportTree({ returnDetails: true });
      assert.equal(receipt.ok, false);
      assert.equal(receipt.reason, "external-file-changed");
      assert.equal(adapter.p.opened, 0);
      assert.equal(await adapter.read(), outsideBytes);
      assert.equal(nodes(context).find(n => n.id === "idea").details, TEXT);
      assert.ok(pending(context).length > 0);
    })
  );

  test("P387 " + kind + " denied permission produces no Save receipt",
    async () => withAdapter(kind, async (adapter) => {
      const context = createContext();
      await open(context, adapter);
      edit(context);
      const unchanged = await adapter.read();
      adapter.p.permission = "denied";
      const receipt = await context.exportTree({ returnDetails: true });
      assert.equal(receipt.ok, false);
      assert.equal(adapter.p.opened, 0);
      assert.equal(await adapter.read(), unchanged);
      assert.ok(pending(context).length > 0);
    })
  );

  test("P387 " + kind + " stale owner during staged write aborts",
    async () => withAdapter(kind, async (adapter) => {
      const context = createContext();
      await open(context, adapter);
      edit(context);
      const unchanged = await adapter.read();
      adapter.p.onWrite = () => context.clearPocketFileSession();
      const receipt = await context.exportTree({ returnDetails: true });
      assert.equal(receipt.ok, false);
      assert.equal(receipt.reason, "file-session-changed");
      assert.equal(adapter.p.closes, 0);
      assert.equal(adapter.p.aborts, 1);
      assert.equal(await adapter.read(), unchanged);
    })
  );

  test("P387 " + kind + " interrupted staged write cannot overwrite saved file",
    async () => withAdapter(kind, async (adapter) => {
      const context = createContext();
      await open(context, adapter);
      edit(context);
      const unchanged = await adapter.read();
      adapter.p.fail = true;
      const receipt = await context.exportTree({ returnDetails: true });
      assert.equal(receipt.ok, false);
      assert.equal(adapter.p.closes, 0);
      assert.equal(adapter.p.aborts, 1);
      assert.equal(await adapter.read(), unchanged);
      assert.ok(pending(context).length > 0);
    })
  );
}

test("P387 unsupported credential and foreign-origin transport refuse without remote call",
  async () => {
    const sandbox = {
      Date, Math, JSON, Object, Array, Uint8Array, ArrayBuffer,
      TextEncoder, TextDecoder, Promise, Set, Map, Error, TypeError, URL,
    };
    sandbox.window = sandbox;
    sandbox.globalThis = sandbox;
    vm.createContext(sandbox);
    for (const filename of [
      "js/pocket-sync-account-client.js", "js/pocket-sync-remote-client.js",
    ]) {
      vm.runInContext(fs.readFileSync(path.join(ROOT, filename), "utf8"),
        sandbox, { filename });
    }
    const credentials = sandbox.PocketSyncAccountClient
      .createBrowserWebAuthnAdapter({ navigator: { credentials: {} } });
    await assert.rejects(credentials.getCredential({}),
      error => error?.code === "passkey-api-unavailable");
    let remoteCalls = 0;
    assert.throws(
      () => sandbox.PocketSyncRemoteClient.createBrowserJsonTransport({
        serviceRoot: "https://foreign.invalid",
        fetch: async () => { remoteCalls += 1; },
      }),
      error => error?.code === "remote-service-root-invalid"
    );
    assert.equal(remoteCalls, 0);
  }
);
