"use strict";

/* Provider-neutral HTTP/session boundary for the dormant Sync service core. */

const CLIENT_ROUTES = Object.freeze({
  beginRegistration: "/account/passkeys/registration/begin",
  finishRegistration: "/account/passkeys/registration/finish",
  beginAuthentication: "/account/passkeys/authentication/begin",
  finishAuthentication: "/account/passkeys/authentication/finish",
  readSyncedPocket: "/account/synced-pocket/read",
  readRevision: "/pockets/revision/read",
  downloadEncryptedRecord: "/pockets/content/download",
  conditionalUpload: "/pockets/content/conditional-upload",
  listEnvelopes: "/pockets/envelopes/list",
  downloadEnvelope: "/pockets/envelopes/download",
  addEnvelope: "/pockets/envelopes/add",
  revokeEnvelope: "/pockets/envelopes/revoke",
  initialiseRecovery: "/account/recovery/initialise",
  beginRecovery: "/account/recovery/begin",
  finishRecovery: "/account/recovery/finish",
  rotateRecovery: "/account/recovery/rotate",
});

const POLICY = Object.freeze({
  apiVersion: 1,
  sessionCookieName: "__Host-pocket-sync-session",
  smallJsonLimitBytes: 262144,
  contentJsonLimitBytes: 16777216,
});

const FACTORY_FIELDS = Object.freeze([
  "core",
  "trustedOrigin",
  "serviceRoot",
  "Response",
  "Headers",
  "TextEncoder",
  "TextDecoder",
]);
const CORE_METHODS = Object.freeze(Object.keys(CLIENT_ROUTES));
const IDENTIFIER_PATTERN = /^[A-Za-z0-9_-]{1,160}$/;
const JSON_CONTENT_TYPE = /^application\/json(?:\s*;\s*charset=utf-8)?\s*$/i;

function isObject(value) {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function frozen(value) {
  if (Array.isArray(value)) return Object.freeze(value.map(frozen));
  if (isObject(value)) {
    const copy = {};
    Object.keys(value).forEach((field) => { copy[field] = frozen(value[field]); });
    return Object.freeze(copy);
  }
  return value;
}

function adapterError(code, status) {
  const error = new Error(`Pocket Sync HTTP adapter ${code}.`);
  error.code = code;
  error.status = status;
  return error;
}

function exactObject(value, fields, required, code) {
  if (!isObject(value)
      || Object.keys(value).some((field) => !fields.includes(field))
      || required.some((field) => !Object.prototype.hasOwnProperty.call(value, field))) {
    throw adapterError(code, 500);
  }
  return value;
}

function normaliseTrustedOrigin(value) {
  if (typeof value !== "string" || value.length < 9 || value !== value.trim()) {
    throw adapterError("http-adapter-invalid", 500);
  }
  let parsed;
  try { parsed = new URL(value); } catch (_error) { throw adapterError("http-adapter-invalid", 500); }
  if (parsed.protocol !== "https:"
      || parsed.username
      || parsed.password
      || parsed.pathname !== "/"
      || parsed.search
      || parsed.hash
      || parsed.origin !== value) {
    throw adapterError("http-adapter-invalid", 500);
  }
  return value;
}

function normaliseServiceRoot(value) {
  if (typeof value !== "string"
      || value.length < 2
      || value !== value.trim()
      || !value.startsWith("/")
      || value.startsWith("//")
      || value.includes("//")
      || /[:?#\\@%]/.test(value)) {
    throw adapterError("http-adapter-invalid", 500);
  }
  const normalised = value.endsWith("/") ? value.slice(0, -1) : value;
  if (normalised.length < 2
      || normalised.split("/").some((segment, index) => index > 0 && ["", ".", ".."].includes(segment))) {
    throw adapterError("http-adapter-invalid", 500);
  }
  return normalised;
}

function limitsFor(routeName) {
  return frozen({
    request: routeName === "conditionalUpload"
      ? POLICY.contentJsonLimitBytes : POLICY.smallJsonLimitBytes,
    response: routeName === "downloadEncryptedRecord"
      ? POLICY.contentJsonLimitBytes : POLICY.smallJsonLimitBytes,
    statuses: ["conditionalUpload", "addEnvelope", "revokeEnvelope", "initialiseRecovery", "rotateRecovery"].includes(routeName)
      ? Object.freeze([200, 409]) : Object.freeze([200]),
  });
}

function validIdentifier(value) {
  return typeof value === "string" && IDENTIFIER_PATTERN.test(value);
}

function sessionCookie(value) {
  if (value === null || value === undefined || value === "") return null;
  if (typeof value !== "string") throw adapterError("http-cookie-invalid", 400);
  let session = null;
  value.split(";").forEach((part) => {
    const trimmed = part.trim();
    const separator = trimmed.indexOf("=");
    if (separator < 1) return;
    const name = trimmed.slice(0, separator);
    if (name !== POLICY.sessionCookieName) return;
    const candidate = trimmed.slice(separator + 1);
    if (session !== null || !validIdentifier(candidate)) {
      throw adapterError("http-cookie-invalid", 400);
    }
    session = candidate;
  });
  return session;
}

function declaredLength(headers, limit) {
  const value = headers.get("Content-Length");
  if (value === null || value === "") return;
  if (!/^(0|[1-9][0-9]*)$/.test(value)) throw adapterError("http-content-length-invalid", 400);
  const length = Number(value);
  if (!Number.isSafeInteger(length) || length > limit) {
    throw adapterError("http-request-too-large", 413);
  }
}

async function readBody(request, limit, Decoder) {
  const body = request.body;
  if (!body || typeof body.getReader !== "function") throw adapterError("http-body-invalid", 400);
  let reader;
  try { reader = body.getReader(); } catch (_error) { throw adapterError("http-body-invalid", 400); }
  if (!reader || typeof reader.read !== "function") throw adapterError("http-body-invalid", 400);
  const chunks = [];
  let length = 0;
  while (true) {
    let item;
    try { item = await reader.read(); } catch (_error) { throw adapterError("http-body-invalid", 400); }
    if (!isObject(item) || typeof item.done !== "boolean") throw adapterError("http-body-invalid", 400);
    if (item.done) break;
    if (!(item.value instanceof Uint8Array)) throw adapterError("http-body-invalid", 400);
    length += item.value.byteLength;
    if (length > limit) {
      try { await reader.cancel?.(); } catch (_error) {}
      throw adapterError("http-request-too-large", 413);
    }
    chunks.push(new Uint8Array(item.value));
  }
  if (length === 0) throw adapterError("http-body-invalid", 400);
  const bytes = new Uint8Array(length);
  let offset = 0;
  chunks.forEach((chunk) => { bytes.set(chunk, offset); offset += chunk.byteLength; });
  let text;
  try { text = new Decoder("utf-8", { fatal: true }).decode(bytes); }
  catch (_error) { throw adapterError("http-body-invalid", 400); }
  let bodyValue;
  try { bodyValue = JSON.parse(text); } catch (_error) { throw adapterError("http-body-invalid", 400); }
  if (!isObject(bodyValue)) throw adapterError("http-body-invalid", 400);
  return bodyValue;
}

function isoTimestamp(value) {
  if (typeof value !== "string") return null;
  const milliseconds = Date.parse(value);
  if (!Number.isFinite(milliseconds) || new Date(milliseconds).toISOString() !== value) return null;
  return new Date(milliseconds);
}

function validateSessionInstruction(value, presentedSession) {
  const instruction = exactObject(value, ["action", "sessionId", "expiresAt", "replaceSessionId"], [
    "action", "sessionId", "expiresAt", "replaceSessionId",
  ], "http-core-result-invalid");
  if (instruction.action !== "set"
      || !validIdentifier(instruction.sessionId)
      || !isoTimestamp(instruction.expiresAt)
      || (instruction.replaceSessionId !== null && !validIdentifier(instruction.replaceSessionId))
      || (instruction.replaceSessionId !== null && instruction.replaceSessionId !== presentedSession)) {
    throw adapterError("http-core-result-invalid", 500);
  }
  return instruction;
}

function sessionSetCookie(instruction) {
  const expires = isoTimestamp(instruction.expiresAt);
  return `${POLICY.sessionCookieName}=${instruction.sessionId}; Path=/; Secure; HttpOnly; SameSite=Strict; Expires=${expires.toUTCString()}`;
}

function sessionClearCookie() {
  return `${POLICY.sessionCookieName}=; Path=/; Secure; HttpOnly; SameSite=Strict; Max-Age=0; Expires=Thu, 01 Jan 1970 00:00:00 GMT`;
}

function createHttpAdapter(input) {
  exactObject(input, FACTORY_FIELDS, ["core", "trustedOrigin", "serviceRoot"], "http-adapter-invalid");
  const trustedOrigin = normaliseTrustedOrigin(input.trustedOrigin);
  const serviceRoot = normaliseServiceRoot(input.serviceRoot);
  const ResponseClass = input.Response === undefined ? globalThis.Response : input.Response;
  const HeadersClass = input.Headers === undefined ? globalThis.Headers : input.Headers;
  const Encoder = input.TextEncoder === undefined ? globalThis.TextEncoder : input.TextEncoder;
  const Decoder = input.TextDecoder === undefined ? globalThis.TextDecoder : input.TextDecoder;
  if (typeof ResponseClass !== "function" || typeof HeadersClass !== "function"
      || typeof Encoder !== "function" || typeof Decoder !== "function"
      || !isObject(input.core)
      || Object.keys(input.core).length !== CORE_METHODS.length
      || CORE_METHODS.some((method) => typeof input.core[method] !== "function")) {
    throw adapterError("http-adapter-invalid", 500);
  }
  const core = input.core;
  const routes = Object.freeze(Object.fromEntries(CORE_METHODS.map((name) => [
    `${serviceRoot}${CLIENT_ROUTES[name]}`, name,
  ])));
  const encoder = new Encoder();

  function response(status, body, cookie) {
    const text = JSON.stringify(body);
    const headers = new HeadersClass({
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
    });
    if (cookie) headers.append("Set-Cookie", cookie);
    return new ResponseClass(text, { status, headers });
  }

  function rejection(error) {
    const status = Number.isSafeInteger(error?.status) && error.status >= 400 && error.status <= 599
      ? error.status : 500;
    const body = { apiVersion: POLICY.apiVersion, ok: false,
      reason: typeof error?.code === "string" && /^[a-z0-9-]{1,80}$/.test(error.code)
        ? error.code : "http-internal-error" };
    if (error?.retryable === true) body.retryable = true;
    return response(status, body, error?.clearSession === true ? sessionClearCookie() : null);
  }

  async function handle(request) {
    try {
      if (!request || typeof request !== "object" || typeof request.url !== "string"
          || typeof request.method !== "string" || !request.headers || typeof request.headers.get !== "function") {
        throw adapterError("http-request-invalid", 400);
      }
      let url;
      try { url = new URL(request.url); } catch (_error) { throw adapterError("http-request-invalid", 400); }
      if (request.method !== "POST") throw adapterError("http-method-rejected", 405);
      if (url.origin !== trustedOrigin || url.search || url.hash
          || request.url !== `${trustedOrigin}${url.pathname}`
          || !Object.prototype.hasOwnProperty.call(routes, url.pathname)) {
        throw adapterError("http-route-rejected", 404);
      }
      const routeName = routes[url.pathname];
      const origin = request.headers.get("Origin");
      const fetchSite = request.headers.get("Sec-Fetch-Site");
      const contentType = request.headers.get("Content-Type");
      const contentEncoding = request.headers.get("Content-Encoding");
      if (origin !== trustedOrigin || fetchSite !== "same-origin") throw adapterError("http-origin-rejected", 403);
      if (typeof contentType !== "string" || !JSON_CONTENT_TYPE.test(contentType)) {
        throw adapterError("http-content-type-rejected", 415);
      }
      if (contentEncoding !== null && contentEncoding.trim().toLowerCase() !== "identity" && contentEncoding.trim() !== "") {
        throw adapterError("http-content-encoding-rejected", 415);
      }
      if (request.headers.get("Authorization") !== null) {
        throw adapterError("http-authorization-rejected", 400);
      }
      const sessionId = sessionCookie(request.headers.get("Cookie"));
      const limits = limitsFor(routeName);
      declaredLength(request.headers, limits.request);
      const body = await readBody(request, limits.request, Decoder);
      const result = await core[routeName](frozen({
        context: frozen({ method: request.method, origin, fetchSite, contentType, sessionId }),
        body,
      }));
      const value = exactObject(result, ["status", "body", "session"], ["status", "body", "session"], "http-core-result-invalid");
      if (!limits.statuses.includes(value.status) || !isObject(value.body)
          || (value.session !== null && !isObject(value.session))) {
        throw adapterError("http-core-result-invalid", 500);
      }
      const instruction = value.session === null ? null : validateSessionInstruction(value.session, sessionId);
      const text = JSON.stringify(value.body);
      if (typeof text !== "string" || encoder.encode(text).byteLength > limits.response
          || (instruction && text.includes(instruction.sessionId))) {
        throw adapterError("http-core-result-invalid", 500);
      }
      return response(value.status, value.body, instruction ? sessionSetCookie(instruction) : null);
    } catch (error) {
      return rejection(error);
    }
  }

  return Object.freeze({ handle });
}

module.exports = Object.freeze({ POLICY, ROUTES: CLIENT_ROUTES, createHttpAdapter });
