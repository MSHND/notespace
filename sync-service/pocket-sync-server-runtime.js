"use strict";

const https = require("node:https");
const { once } = require("node:events");
const { randomBytes } = require("node:crypto");
const { Readable } = require("node:stream");
const { Pool } = require("pg");
const { createHttpAdapter } = require("./pocket-sync-http-adapter.js");
const { createServiceCore } = require("./pocket-sync-service-core.js");
const { createPostgresStore } = require("./pocket-sync-postgres-store.js");
const { createWebAuthnVerifier } = require("./pocket-sync-webauthn-verifier.js");
const { verifyPocketSyncSchema } = require("./pocket-sync-postgres-schema.js");

const CONFIG_FIELDS = Object.freeze([
  "trustedOrigin",
  "rpId",
  "rpName",
  "serviceRoot",
  "postgres",
  "credentialAlgorithms",
  "ceremonyLifetimeMs",
  "sessionLifetimeMs",
  "recoveryProofVerifier",
  "tls",
]);

function runtimeError() {
  const error = new Error("Pocket Sync server runtime failed.");
  error.code = "sync-server-runtime-failed";
  return error;
}

function validatePlatform() {
  const major = Number.parseInt(process.versions?.node?.split(".")[0], 10);
  if (!Number.isSafeInteger(major) || major < 24
      || typeof Headers !== "function"
      || typeof Headers.prototype?.getSetCookie !== "function") {
    throw runtimeError();
  }
}

function isObject(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function exactObject(value, fields) {
  if (!isObject(value)
      || Object.keys(value).length !== fields.length
      || fields.some((field) => !Object.prototype.hasOwnProperty.call(value, field))) {
    throw runtimeError();
  }
  return value;
}

function validatePostgres(value) {
  exactObject(value, ["connectionString"]);
  if (typeof value.connectionString !== "string" || value.connectionString.length < 1
      || value.connectionString !== value.connectionString.trim()) {
    throw runtimeError();
  }
  return Object.freeze({ connectionString: value.connectionString });
}

function tlsMaterial(value) {
  return typeof value === "string" || value instanceof Uint8Array;
}

function validateTls(value) {
  exactObject(value, ["cert", "key"]);
  if (!tlsMaterial(value.cert) || !tlsMaterial(value.key)
      || value.cert.length < 1 || value.key.length < 1) {
    throw runtimeError();
  }
  return Object.freeze({ cert: value.cert, key: value.key });
}

function validateRecoveryProofVerifier(value) {
  if (!isObject(value)
      || Object.keys(value).length !== 1
      || typeof value.verifyRecoveryProof !== "function"
      || typeof value.assertSupported !== "function") {
    throw runtimeError();
  }
  return value;
}

function validateConfiguration(value) {
  exactObject(value, CONFIG_FIELDS);
  if (typeof value.trustedOrigin !== "string"
      || typeof value.rpId !== "string"
      || typeof value.rpName !== "string"
      || typeof value.serviceRoot !== "string"
      || !Array.isArray(value.credentialAlgorithms)
      || !Number.isSafeInteger(value.ceremonyLifetimeMs)
      || !Number.isSafeInteger(value.sessionLifetimeMs)) {
    throw runtimeError();
  }
  return Object.freeze({
    trustedOrigin: value.trustedOrigin,
    rpId: value.rpId,
    rpName: value.rpName,
    serviceRoot: value.serviceRoot,
    postgres: validatePostgres(value.postgres),
    credentialAlgorithms: Object.freeze(value.credentialAlgorithms.slice()),
    ceremonyLifetimeMs: value.ceremonyLifetimeMs,
    sessionLifetimeMs: value.sessionLifetimeMs,
    recoveryProofVerifier: validateRecoveryProofVerifier(value.recoveryProofVerifier),
    tls: validateTls(value.tls),
  });
}

function requestUrl(trustedOrigin, target) {
  if (typeof target !== "string" || !target.startsWith("/") || target.startsWith("//")
      || target.includes("#") || target.includes("\\")) {
    throw runtimeError();
  }
  let parsed;
  try { parsed = new URL(target, trustedOrigin); } catch (_error) { throw runtimeError(); }
  if (parsed.origin !== trustedOrigin || target !== `${parsed.pathname}${parsed.search}`) {
    throw runtimeError();
  }
  return `${trustedOrigin}${target}`;
}

function requestHeaders(request) {
  if (!Array.isArray(request.rawHeaders) || request.rawHeaders.length % 2 !== 0) throw runtimeError();
  const headers = new Headers();
  for (let index = 0; index < request.rawHeaders.length; index += 2) {
    const name = request.rawHeaders[index];
    const value = request.rawHeaders[index + 1];
    if (typeof name !== "string" || typeof value !== "string") throw runtimeError();
    headers.append(name, value);
  }
  return headers;
}

function adapterRequest(trustedOrigin, request) {
  if (!request || typeof request !== "object" || typeof request.method !== "string"
      || typeof request.url !== "string" || typeof Readable.toWeb !== "function") {
    throw runtimeError();
  }
  let body;
  try { body = Readable.toWeb(request); } catch (_error) { throw runtimeError(); }
  return Object.freeze({
    url: requestUrl(trustedOrigin, request.url),
    method: request.method,
    headers: requestHeaders(request),
    body,
  });
}

function writeSafeFailure(response) {
  const body = JSON.stringify({ apiVersion: 1, ok: false, reason: "http-internal-error" });
  response.statusCode = 500;
  response.setHeader("Content-Type", "application/json; charset=utf-8");
  response.setHeader("Cache-Control", "no-store");
  response.setHeader("X-Content-Type-Options", "nosniff");
  response.end(body);
}

async function writeResponse(adapterResponse, response) {
  response.statusCode = adapterResponse.status;
  const setCookies = typeof adapterResponse.headers.getSetCookie === "function"
    ? adapterResponse.headers.getSetCookie() : [];
  adapterResponse.headers.forEach((value, name) => {
    if (name.toLowerCase() !== "set-cookie") response.setHeader(name, value);
  });
  if (setCookies.length > 0) response.setHeader("Set-Cookie", setCookies);
  if (!adapterResponse.body) {
    response.end();
    return;
  }
  const reader = adapterResponse.body.getReader();
  while (true) {
    const item = await reader.read();
    if (item.done) break;
    if (!(item.value instanceof Uint8Array)) throw runtimeError();
    if (!response.write(Buffer.from(item.value))) await once(response, "drain");
  }
  response.end();
}

function listenOptions(value) {
  exactObject(value, ["host", "port"]);
  if (value.host !== "127.0.0.1" || !Number.isSafeInteger(value.port)
      || value.port < 1 || value.port > 65535) {
    throw runtimeError();
  }
  return value;
}

function createSyncServerRuntime(configuration) {
  validatePlatform();
  const config = validateConfiguration(configuration);
  const pool = new Pool({ connectionString: config.postgres.connectionString });
  if (!pool || typeof pool.connect !== "function" || typeof pool.query !== "function" || typeof pool.end !== "function") {
    throw runtimeError();
  }
  const store = createPostgresStore({ pool });
  const core = createServiceCore({
    store,
    webAuthnVerifier: createWebAuthnVerifier(),
    recoveryProofVerifier: config.recoveryProofVerifier,
    randomBytes(count) { return new Uint8Array(randomBytes(count)); },
    now: Date.now,
    trustedOrigin: config.trustedOrigin,
    rpId: config.rpId,
    rpName: config.rpName,
    credentialAlgorithms: config.credentialAlgorithms,
    ceremonyLifetimeMs: config.ceremonyLifetimeMs,
    sessionLifetimeMs: config.sessionLifetimeMs,
  });
  const adapter = createHttpAdapter({
    core,
    trustedOrigin: config.trustedOrigin,
    serviceRoot: config.serviceRoot,
  });
  const server = https.createServer(config.tls, async (request, response) => {
    try {
      await writeResponse(await adapter.handle(adapterRequest(config.trustedOrigin, request)), response);
    } catch (_error) {
      if (!response.headersSent) writeSafeFailure(response);
      else response.destroy();
    }
  });
  if (!server || typeof server.listen !== "function" || typeof server.close !== "function") throw runtimeError();

  let started = false;
  let serverMayBeOpen = false;
  let shutdown = null;

  async function listen(value) {
    const options = listenOptions(value);
    if (started || shutdown) throw runtimeError();
    try {
      await config.recoveryProofVerifier.assertSupported();
      await pool.query("SELECT 1");
      await verifyPocketSyncSchema(pool);
    } catch (_error) {
      await close();
      throw runtimeError();
    }
    try { await new Promise((resolve, reject) => {
      const failed = () => { server.off("error", failed); reject(runtimeError()); };
      server.once("error", failed);
      serverMayBeOpen = true;
      server.listen(options.port, options.host, () => {
        server.off("error", failed);
        resolve();
      });
    }); } catch (error) {
      await close();
      throw error;
    }
    started = true;
  }

  function closeServer() {
    if (!serverMayBeOpen) return Promise.resolve();
    return new Promise((resolve) => {
      try { server.close(() => resolve()); }
      catch (_error) { resolve(); }
    });
  }

  function close() {
    if (shutdown) return shutdown;
    shutdown = (async () => {
      await closeServer();
      started = false;
      serverMayBeOpen = false;
      try { await pool.end(); } catch (_error) { throw runtimeError(); }
    })();
    return shutdown;
  }

  return Object.freeze({ listen, close });
}

module.exports = Object.freeze({ createSyncServerRuntime });
