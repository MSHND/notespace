"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { EventEmitter } = require("node:events");
const fs = require("node:fs");
const Module = require("node:module");
const path = require("node:path");
const { Readable } = require("node:stream");

const { createLocalServerConfig, createUnavailableRecoveryProofVerifier } = require("../sync-service/pocket-sync-server-config.js");
const { verifyPocketSyncSchema } = require("../sync-service/pocket-sync-postgres-schema.js");

const ROOT = path.resolve(__dirname, "..");
const RUNTIME_PATH = require.resolve("../sync-service/pocket-sync-server-runtime.js");
const VERIFIER_PATH = require.resolve("../sync-service/pocket-sync-webauthn-verifier.js");
const MIGRATION_PATH = require.resolve("../sync-service/pocket-sync-db-migrate.js");
const ORIGIN = "https://sync.pocket.example";
const SERVICE_ROOT = "/pocket-sync/v1";

function source(file) {
  return fs.readFileSync(path.join(ROOT, file), "utf8");
}

function b64(bytes) {
  return Buffer.from(bytes).toString("base64url");
}

function bytes(length, start = 1) {
  return Uint8Array.from({ length }, (_value, index) => (start + index) & 255);
}

function registrationCredential() {
  const id = b64(bytes(32, 121));
  return {
    id, rawId: id, type: "public-key", authenticatorAttachment: "platform",
    response: {
      clientDataJSON: b64(bytes(17, 2)), attestationObject: b64(bytes(24, 4)),
      authenticatorData: b64(bytes(19, 6)), transports: ["internal"],
      publicKey: b64(bytes(23, 8)), publicKeyAlgorithm: -7,
    },
    clientExtensionResults: { prf: { enabled: true } },
  };
}

function encryptedRecord() {
  return {
    format: "pocket.sync.content.opaque", version: 1, algorithm: "AES-GCM-256",
    nonce: b64(bytes(12, 31)), ciphertext: b64(bytes(32, 61)),
  };
}

function copy(value) {
  return value === undefined ? undefined : JSON.parse(JSON.stringify(value));
}

function key(collection, recordKey) {
  return `${collection}\u0000${recordKey}`;
}

function createPoolClass(state) {
  return class ControlledPool {
    constructor(options) {
      state.options.push(copy(options));
    }

    async query(sql) {
      state.preflight.push(sql);
      if (sql.includes("information_schema.columns")) {
        return { rowCount: 6, rows: [
          { table_name: "pocket_sync_records", column_name: "collection", data_type: "text", is_nullable: "NO" },
          { table_name: "pocket_sync_records", column_name: "record_key", data_type: "text", is_nullable: "NO" },
          { table_name: "pocket_sync_records", column_name: "store_version", data_type: "bigint", is_nullable: "NO" },
          { table_name: "pocket_sync_records", column_name: "record", data_type: "jsonb", is_nullable: "NO" },
          { table_name: "pocket_sync_schema", column_name: "schema_name", data_type: "text", is_nullable: "NO" },
          { table_name: "pocket_sync_schema", column_name: "schema_version", data_type: "integer", is_nullable: "NO" },
        ] };
      }
      if (sql.includes("FROM pg_constraint")) {
        const checks = ["CHECK (length(record_key)>0)", "CHECK (store_version>0 AND store_version<=9007199254740991)", "CHECK (collection IN ('accounts','credentials','sessions','ceremonies','pockets','operations','keySets','envelopes','recoveryLocators','recoveryCeremonies','keyOperations'))", "CHECK (jsonb_typeof(record)='object')", "CHECK (jsonb_typeof(record->'storeVersion')='number' AND record->>'storeVersion' ~ '^[1-9][0-9]*$' AND (record->>'storeVersion')::NUMERIC=store_version)"];
        return { rowCount: 8, rows: [
          { relation: "public.pocket_sync_records", contype: "p", definition: "PRIMARY KEY (collection, record_key)" },
          ...checks.map((definition) => ({ relation: "public.pocket_sync_records", contype: "c", definition })),
          { relation: "public.pocket_sync_schema", contype: "p", definition: "PRIMARY KEY (schema_name)" },
        ] };
      }
      if (sql === "SELECT schema_version FROM public.pocket_sync_schema WHERE schema_name=$1") {
        return { rows: [{ schema_version: 1 }], rowCount: 1 };
      }
      if (sql !== "SELECT 1") throw new Error("unexpected pool query");
      return { rows: [{ "?column?": 1 }], rowCount: 1 };
    }

    async connect() {
      const mutations = [];
      let began = false;
      const client = {
        async query(sql, values = []) {
          state.sql.push({ sql, values: copy(values) });
          if (sql === "BEGIN" || sql === "BEGIN READ ONLY") {
            began = true;
            return { rows: [], rowCount: null };
          }
          if (sql === "COMMIT") { began = false; return { rows: [], rowCount: null }; }
          if (sql === "ROLLBACK") {
            for (let index = mutations.length - 1; index >= 0; index -= 1) {
              const mutation = mutations[index];
              if (mutation.before === undefined) state.rows.delete(mutation.key);
              else state.rows.set(mutation.key, copy(mutation.before));
            }
            began = false;
            return { rows: [], rowCount: null };
          }
          if (!began) throw new Error("query outside transaction");
          const rowKey = key(values[0], values[1]);
          if (sql.startsWith("SELECT store_version, record")) {
            const row = state.rows.get(rowKey);
            return row ? { rows: [copy(row)], rowCount: 1 } : { rows: [], rowCount: 0 };
          }
          if (sql.startsWith("INSERT INTO public.pocket_sync_records")) {
            if (state.rows.has(rowKey)) { const error = new Error("duplicate"); error.code = "23505"; throw error; }
            const after = { store_version: values[2], record: JSON.parse(values[3]) };
            mutations.push({ key: rowKey, before: undefined });
            state.rows.set(rowKey, after);
            return { rows: [], rowCount: 1 };
          }
          if (sql.startsWith("UPDATE public.pocket_sync_records")) {
            const before = state.rows.get(rowKey);
            if (!before || String(before.store_version) !== String(values[2])) return { rows: [], rowCount: 0 };
            mutations.push({ key: rowKey, before: copy(before) });
            state.rows.set(rowKey, { store_version: values[3], record: JSON.parse(values[4]) });
            return { rows: [], rowCount: 1 };
          }
          if (sql.startsWith("DELETE FROM public.pocket_sync_records")) {
            const before = state.rows.get(rowKey);
            if (!before || String(before.store_version) !== String(values[2])) return { rows: [], rowCount: 0 };
            mutations.push({ key: rowKey, before: copy(before) });
            state.rows.delete(rowKey);
            return { rows: [], rowCount: 1 };
          }
          throw new Error("unexpected SQL");
        },
        release() { state.releases += 1; },
      };
      state.connects += 1;
      return client;
    }

    async end() { state.ends += 1; }
  };
}

class ControlledServer extends EventEmitter {
  constructor(handler, state) {
    super();
    this.handler = handler;
    this.state = state;
  }

  listen(port, host, callback) {
    this.state.listens.push({ port, host });
    callback();
  }

  close(callback) {
    this.state.closes += 1;
    callback();
  }
}

class ControlledResponse extends EventEmitter {
  constructor() {
    super();
    this.headers = {};
    this.statusCode = 0;
    this.headersSent = false;
    this.chunks = [];
  }

  setHeader(name, value) { this.headers[name.toLowerCase()] = value; }
  write(chunk) { this.headersSent = true; this.chunks.push(Buffer.from(chunk)); return true; }
  end(chunk) { if (chunk) this.chunks.push(Buffer.from(chunk)); this.headersSent = true; this.emit("ended"); }
  destroy() { this.emit("ended"); }
  json() { return JSON.parse(Buffer.concat(this.chunks).toString("utf8")); }
}

function request(pathname, body, overrides = {}) {
  const stream = Readable.from([Buffer.from(JSON.stringify(body))]);
  stream.method = overrides.method || "POST";
  stream.url = pathname;
  stream.rawHeaders = [
    "Origin", overrides.origin || ORIGIN,
    "Sec-Fetch-Site", overrides.fetchSite || "same-origin",
    "Content-Type", "application/json",
    ...(overrides.cookie ? ["Cookie", overrides.cookie] : []),
  ];
  return stream;
}

function runtimeConfig(recoveryProofVerifier = createUnavailableRecoveryProofVerifier()) {
  return {
    trustedOrigin: ORIGIN, rpId: "sync.pocket.example", rpName: "Pocket", serviceRoot: SERVICE_ROOT,
    postgres: { connectionString: "postgres://operator:secret@127.0.0.1/pocket" }, credentialAlgorithms: [-7],
    ceremonyLifetimeMs: 300000, sessionLifetimeMs: 2592000000, recoveryProofVerifier,
    tls: { cert: new Uint8Array([1]), key: new Uint8Array([2]) },
  };
}

async function withRuntime(callback) {
  const state = { options: [], preflight: [], sql: [], rows: new Map(), connects: 0, releases: 0, ends: 0, listens: [], closes: 0 };
  let server;
  const originalLoad = Module._load;
  const cachedRuntime = require.cache[RUNTIME_PATH];
  const cachedVerifier = require.cache[VERIFIER_PATH];
  const Pool = createPoolClass(state);
  const library = Object.freeze({
    async verifyRegistrationResponse() {
      return { verified: true, registrationInfo: { userVerified: true,
        credential: { id: b64(bytes(32, 121)), publicKey: new Uint8Array([9, 8, 7]), counter: 0, transports: ["internal"] },
        credentialDeviceType: "singleDevice", credentialBackedUp: false } };
    },
    async verifyAuthenticationResponse() { throw new Error("not used"); },
  });
  const helpers = Object.freeze({ decodeCredentialPublicKey() { return new Map([[3, -7]]); }, cose: Object.freeze({ COSEKEYS: Object.freeze({ alg: 3 }) }) });
  Module._load = function patchedLoad(name, parent, isMain) {
    if (name === "pg") return { Pool };
    if (name === "node:https") return { createServer(_tls, handler) { server = new ControlledServer(handler, state); return server; } };
    if (name === "@simplewebauthn/server") return library;
    if (name === "@simplewebauthn/server/helpers") return helpers;
    return originalLoad.call(this, name, parent, isMain);
  };
  delete require.cache[RUNTIME_PATH];
  delete require.cache[VERIFIER_PATH];
  try {
    await callback({ createSyncServerRuntime: require(RUNTIME_PATH).createSyncServerRuntime, state, get server() { return server; } });
  } finally {
    Module._load = originalLoad;
    require.cache[RUNTIME_PATH] = cachedRuntime;
    require.cache[VERIFIER_PATH] = cachedVerifier;
  }
}

async function send(server, value) {
  const response = new ControlledResponse();
  const done = new Promise((resolve) => response.once("ended", resolve));
  server.handler(value.request, response);
  await done;
  return response;
}

test("P049 composes the real adapter, core, P047 store and P048 verifier through a loopback Node bridge", async () => {
  await withRuntime(async (context) => {
    const { createSyncServerRuntime, state } = context;
    const runtime = createSyncServerRuntime(runtimeConfig());
    assert.deepEqual(Object.keys(runtime), ["listen", "close"]);
    assert.equal(Object.isFrozen(runtime), true);
    await runtime.listen({ host: "127.0.0.1", port: 8443 });
    assert.deepEqual(state.options, [{ connectionString: "postgres://operator:secret@127.0.0.1/pocket" }]);
    assert.equal(state.preflight[0], "SELECT 1");
    assert.deepEqual(state.listens, [{ host: "127.0.0.1", port: 8443 }]);

    const begin = await send(context.server, { request: request(`${SERVICE_ROOT}/account/passkeys/registration/begin`, {
      apiVersion: 1, operationId: "register-operation", accountIntent: "create-or-add-credential", deviceId: "device-opaque",
    }) });
    assert.equal(begin.statusCode, 200);
    assert.equal(Object.hasOwn(begin.headers, "set-cookie"), false);
    const ceremonyId = begin.json().ceremonyId;
    assert.equal(state.sql.some((entry) => entry.sql.startsWith("INSERT INTO public.pocket_sync_records") && entry.values[0] === "ceremonies"), true);

    const beforeRejected = state.connects;
    const rejected = await send(context.server, { request: request(`${SERVICE_ROOT}/account/passkeys/registration/begin`, {}, { origin: "https://wrong.example" }) });
    assert.equal(rejected.statusCode, 403);
    assert.equal(rejected.json().reason, "http-origin-rejected");
    assert.equal(state.connects, beforeRejected);

    const beforeOversized = state.connects;
    const oversized = await send(context.server, { request: request(`${SERVICE_ROOT}/account/passkeys/registration/begin`, {
      payload: "x".repeat(262144),
    }) });
    assert.equal(oversized.statusCode, 413);
    assert.equal(oversized.json().reason, "http-request-too-large");
    assert.equal(state.connects, beforeOversized);

    const finished = await send(context.server, { request: request(`${SERVICE_ROOT}/account/passkeys/registration/finish`, {
      apiVersion: 1, operationId: "register-operation", ceremonyId, deviceId: "device-opaque", credential: registrationCredential(),
    }) });
    assert.equal(finished.statusCode, 200);
    const cookie = finished.headers["set-cookie"][0];
    assert.match(cookie, /^__Host-pocket-sync-session=[A-Za-z0-9_-]+; Path=\/; Secure; HttpOnly; SameSite=Strict;/);
    assert.equal(JSON.stringify(finished.json()).includes(cookie.split(";")[0].slice(28)), false);

    const upload = await send(context.server, { request: request(`${SERVICE_ROOT}/pockets/content/conditional-upload`, {
      apiVersion: 1, syncedPocketId: "pocket-opaque", expectedRevision: 0, operationId: "upload-operation",
      logicalChangeId: "upload-change", attemptKind: "new-change", encryptedRecord: encryptedRecord(),
    }, { cookie: cookie.split(";")[0] }) });
    assert.equal(upload.statusCode, 200);
    assert.equal(upload.json().revision, 1);
    const stale = await send(context.server, { request: request(`${SERVICE_ROOT}/pockets/content/conditional-upload`, {
      apiVersion: 1, syncedPocketId: "pocket-opaque", expectedRevision: 0, operationId: "stale-operation",
      logicalChangeId: "stale-change", attemptKind: "new-change", encryptedRecord: encryptedRecord(),
    }, { cookie: cookie.split(";")[0] }) });
    assert.equal(stale.statusCode, 409);
    assert.equal(stale.json().status, "conflict");
    await runtime.close();
    await runtime.close();
    assert.equal(state.closes, 1);
    assert.equal(state.ends, 1);
  });
});

test("P049 local configuration fails closed and the recovery proof verifier cannot succeed", async () => {
  const base = {
    POCKET_SYNC_DATABASE_URL: "postgres://operator:secret@127.0.0.1/pocket",
    POCKET_SYNC_TLS_CERT_FILE: "cert.pem", POCKET_SYNC_TLS_KEY_FILE: "key.pem",
    POCKET_SYNC_TRUSTED_ORIGIN: ORIGIN, POCKET_SYNC_RP_ID: "sync.pocket.example",
  };
  const readFile = (file) => new Uint8Array(file === "cert.pem" ? [1] : [2]);
  const config = createLocalServerConfig({ environment: base, readFile });
  assert.deepEqual(config.listen, { host: "127.0.0.1", port: 8443 });
  await assert.rejects(config.runtime.recoveryProofVerifier.verifyRecoveryProof({}), (error) => error && error.code === "recovery-proof-unavailable");
  for (const environment of [
    { ...base, POCKET_SYNC_DATABASE_URL: "" },
    { ...base, POCKET_SYNC_TRUSTED_ORIGIN: "http://sync.pocket.example" },
    { ...base, POCKET_SYNC_RP_ID: "pocket.example" },
    { ...base, POCKET_SYNC_PORT: "0" },
    { ...base, POCKET_SYNC_TLS_KEY_FILE: "missing.pem" },
  ]) {
    assert.throws(() => createLocalServerConfig({ environment, readFile(file) { if (file === "missing.pem") throw new Error("private path"); return readFile(file); } }),
      (error) => error && error.code === "sync-server-config-invalid" && !error.message.includes("secret"));
  }
});

test("P049b rejects metadata-only PostgreSQL schemas with an unsafe collection allowlist", async () => {
  const pool = {
    async query(sql) {
      if (sql.includes("information_schema.columns")) return { rows: [
        { table_name: "pocket_sync_records", column_name: "collection", data_type: "text", is_nullable: "NO" },
        { table_name: "pocket_sync_records", column_name: "record_key", data_type: "text", is_nullable: "NO" },
        { table_name: "pocket_sync_records", column_name: "store_version", data_type: "bigint", is_nullable: "NO" },
        { table_name: "pocket_sync_records", column_name: "record", data_type: "jsonb", is_nullable: "NO" },
        { table_name: "pocket_sync_schema", column_name: "schema_name", data_type: "text", is_nullable: "NO" },
        { table_name: "pocket_sync_schema", column_name: "schema_version", data_type: "integer", is_nullable: "NO" },
      ] };
      if (sql.includes("FROM pg_constraint")) return { rows: [
        { relation: "public.pocket_sync_records", contype: "p", definition: "PRIMARY KEY (collection, record_key)" },
        { relation: "public.pocket_sync_records", contype: "c", definition: "CHECK (length(record_key)>0)" },
        { relation: "public.pocket_sync_records", contype: "c", definition: "CHECK (store_version>0 AND store_version<=9007199254740991)" },
        { relation: "public.pocket_sync_records", contype: "c", definition: "CHECK (collection IN ('accounts','credentials','sessions','ceremonies','pockets','operations','keySets','envelopes','recoveryLocators','recoveryCeremonies','unsafeExtra'))" },
        { relation: "public.pocket_sync_records", contype: "c", definition: "CHECK (jsonb_typeof(record)='object')" },
        { relation: "public.pocket_sync_records", contype: "c", definition: "CHECK (jsonb_typeof(record->'storeVersion')='number' AND record->>'storeVersion' ~ '^[1-9][0-9]*$' AND (record->>'storeVersion')::NUMERIC=store_version)" },
        { relation: "public.pocket_sync_schema", contype: "p", definition: "PRIMARY KEY (schema_name)" },
      ] };
      return { rowCount: 1, rows: [{ schema_version: 1 }] };
    },
  };
  await assert.rejects(verifyPocketSyncSchema(pool), (error) => error?.code === "sync-server-schema-invalid");
});

test("P049 keeps the migration explicit, fixed-path and safely closed", async () => {
  const originalLoad = Module._load;
  const cached = require.cache[MIGRATION_PATH];
  const calls = [];
  let ended = 0;
  class Pool {
    constructor(options) { calls.push(options); }
    async query(sql) {
      calls.push(sql);
      if (sql.includes("information_schema.columns")) return { rowCount: 6, rows: [
        { table_name: "pocket_sync_records", column_name: "collection", data_type: "text", is_nullable: "NO" }, { table_name: "pocket_sync_records", column_name: "record_key", data_type: "text", is_nullable: "NO" }, { table_name: "pocket_sync_records", column_name: "store_version", data_type: "bigint", is_nullable: "NO" }, { table_name: "pocket_sync_records", column_name: "record", data_type: "jsonb", is_nullable: "NO" }, { table_name: "pocket_sync_schema", column_name: "schema_name", data_type: "text", is_nullable: "NO" }, { table_name: "pocket_sync_schema", column_name: "schema_version", data_type: "integer", is_nullable: "NO" },
      ] };
      if (sql.includes("FROM pg_constraint")) return { rowCount: 8, rows: [
        { relation: "public.pocket_sync_records", contype: "p", definition: "PRIMARY KEY (collection, record_key)" }, { relation: "public.pocket_sync_records", contype: "c", definition: "CHECK (length(record_key)>0)" }, { relation: "public.pocket_sync_records", contype: "c", definition: "CHECK (store_version>0 AND store_version<=9007199254740991)" }, { relation: "public.pocket_sync_records", contype: "c", definition: "CHECK (collection IN ('accounts','credentials','sessions','ceremonies','pockets','operations','keySets','envelopes','recoveryLocators','recoveryCeremonies','keyOperations'))" }, { relation: "public.pocket_sync_records", contype: "c", definition: "CHECK (jsonb_typeof(record)='object')" }, { relation: "public.pocket_sync_records", contype: "c", definition: "CHECK (jsonb_typeof(record->'storeVersion')='number' AND record->>'storeVersion' ~ '^[1-9][0-9]*$' AND (record->>'storeVersion')::NUMERIC=store_version)" }, { relation: "public.pocket_sync_schema", contype: "p", definition: "PRIMARY KEY (schema_name)" },
      ] };
      if (sql.includes("SELECT schema_version FROM public")) return { rows: [{ schema_version: 1 }], rowCount: 1 };
      return { rows: [], rowCount: null };
    }
    async end() { ended += 1; }
  }
  Module._load = function patchedLoad(name, parent, isMain) {
    if (name === "pg") return { Pool };
    return originalLoad.call(this, name, parent, isMain);
  };
  delete require.cache[MIGRATION_PATH];
  try {
    const { applyLocalMigration } = require(MIGRATION_PATH);
    await applyLocalMigration("postgres://operator:secret@127.0.0.1/pocket");
    assert.deepEqual(calls[0], { connectionString: "postgres://operator:secret@127.0.0.1/pocket" });
    assert.equal(calls[1], source("sync-service/migrations/001-pocket-sync-store.sql"));
    assert.equal(ended, 1);
    Pool.prototype.query = async () => { throw new Error("native connection detail"); };
    await assert.rejects(applyLocalMigration("postgres://operator:secret@127.0.0.1/pocket"),
      (error) => error && error.code === "sync-server-migration-failed" && !error.message.includes("secret"));
    assert.equal(ended, 2);
  } finally {
    Module._load = originalLoad;
    require.cache[MIGRATION_PATH] = cached;
  }
});

test("P049 server-only sources retain the reviewed security boundary", () => {
  const production = [
    source("sync-service/pocket-sync-server-runtime.js"), source("sync-service/pocket-sync-server-config.js"),
    source("sync-service/pocket-sync-server.js"), source("sync-service/pocket-sync-db-migrate.js"),
  ].join("\n");
  assert.doesNotMatch(production, /express|fastify|access-control-allow-origin|x-forwarded|forwarded|math\.random|verified:\s*true|neon|supabase|aws|rds|vercel|retry/i);
  assert.doesNotMatch(source("index.html"), /pocket-sync-server|pocket-sync-db-migrate/);
  assert.doesNotMatch(source("sw.js"), /pocket-sync-server|pocket-sync-db-migrate/);
});
