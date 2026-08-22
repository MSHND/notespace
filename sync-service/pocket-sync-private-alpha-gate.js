"use strict";

const { createHash, createHmac, randomBytes, timingSafeEqual } = require("node:crypto");
const { PRIVATE_ALPHA_CSP } = require("./pocket-sync-production-security-policy.js");

const COOKIE_NAME = "__Host-pocket-alpha-access";
const ACCESS_PATH = "/pocket-alpha";
const SUBMIT_PATH = "/pocket-alpha/access";
const TOKEN_VERSION = "v1";
const TOKEN_LIFETIME_SECONDS = 7 * 24 * 60 * 60;
const FORM_BODY_LIMIT_BYTES = 1024;
const FORM_CONTENT_TYPE = /^application\/x-www-form-urlencoded(?:\s*;\s*charset=utf-8)?\s*$/i;
const TOKEN_PATTERN = /^v1\.([1-9][0-9]{0,11})\.([A-Za-z0-9_-]{32})\.([A-Za-z0-9_-]{43})$/;
const FORM_HTML = "<!doctype html><html lang=\"en\"><head><meta charset=\"utf-8\"><meta name=\"viewport\" content=\"width=device-width,initial-scale=1\"><title>Private alpha access</title></head><body><main><h1>Private alpha access</h1><form method=\"post\" action=\"/pocket-alpha/access\"><label for=\"accessCode\">Access code</label><input id=\"accessCode\" name=\"accessCode\" type=\"password\" autocomplete=\"off\" required><button type=\"submit\">Continue</button></form></main></body></html>";

function gateError() {
  const error = new Error("Pocket private-alpha admission failed.");
  error.code = "pocket-alpha-admission-failed";
  return error;
}

function isObject(value) {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function exactInput(value) {
  const allowed = ["accessSecret", "trustedOrigin", "serviceRoot", "handler", "now", "randomBytes"];
  if (!isObject(value)
      || Object.keys(value).some((field) => !allowed.includes(field))
      || !["accessSecret", "trustedOrigin", "serviceRoot", "handler"].every((field) => Object.hasOwn(value, field))) {
    throw gateError();
  }
  return value;
}

function validateTrustedOrigin(value) {
  let parsed;
  try { parsed = new URL(value); } catch (_error) { throw gateError(); }
  if (typeof value !== "string" || parsed.protocol !== "https:" || parsed.username || parsed.password
      || parsed.pathname !== "/" || parsed.search || parsed.hash || parsed.origin !== value) throw gateError();
  return value;
}

function validateServiceRoot(value) {
  if (typeof value !== "string" || value.length < 2 || value !== value.trim()
      || !value.startsWith("/") || value.startsWith("//") || value.includes("//")
      || /[:?#\\@%]/.test(value) || value.endsWith("/")) throw gateError();
  if (value.split("/").some((segment, index) => index > 0 && ["", ".", ".."].includes(segment))) throw gateError();
  return value;
}

function headerValues(request, name) {
  const wanted = name.toLowerCase();
  if (Array.isArray(request?.rawHeaders) && request.rawHeaders.length % 2 === 0) {
    const values = [];
    for (let index = 0; index < request.rawHeaders.length; index += 2) {
      if (String(request.rawHeaders[index]).toLowerCase() === wanted) values.push(request.rawHeaders[index + 1]);
    }
    if (values.length > 0) return values.every((value) => typeof value === "string") ? values : [];
  }
  const headers = request?.headers;
  if (headers && typeof headers.get === "function") {
    const value = headers.get(name);
    return value === null ? [] : [value];
  }
  const value = headers?.[wanted];
  if (value === undefined) return [];
  return Array.isArray(value) ? value.slice() : [value];
}

function singleHeader(request, name) {
  const values = headerValues(request, name);
  return values.length === 1 && typeof values[0] === "string" ? values[0] : null;
}

function alphaCookie(request) {
  const values = headerValues(request, "Cookie");
  if (values.length === 0) return null;
  if (values.length !== 1 || typeof values[0] !== "string" || values[0].length > 4096) return null;
  let found = null;
  for (const part of values[0].split(";")) {
    const trimmed = part.trim();
    const separator = trimmed.indexOf("=");
    if (separator < 1 || trimmed.slice(0, separator) !== COOKIE_NAME) continue;
    const candidate = trimmed.slice(separator + 1);
    if (found !== null || candidate.length < 1 || candidate.length > 160) return null;
    found = candidate;
  }
  return found;
}

function safeHeaders(response, contentType = null) {
  response.setHeader("Cache-Control", "no-store");
  response.setHeader("X-Content-Type-Options", "nosniff");
  if (contentType) response.setHeader("Content-Type", contentType);
}

function emptyResponse(response, status) {
  response.statusCode = status;
  safeHeaders(response);
  response.end();
}

function redirect(response, location) {
  response.statusCode = 303;
  safeHeaders(response);
  response.setHeader("Location", location);
  response.end();
}

function formResponse(request, response, status = 200) {
  const body = Buffer.from(FORM_HTML, "utf8");
  response.statusCode = status;
  safeHeaders(response, "text/html; charset=utf-8");
  response.setHeader("Content-Security-Policy", PRIVATE_ALPHA_CSP);
  response.setHeader("Content-Length", body.byteLength);
  if (request.method === "HEAD") response.end();
  else response.end(body);
}

async function readFormBody(request) {
  const declared = singleHeader(request, "Content-Length");
  if (declared !== null) {
    if (!/^(0|[1-9][0-9]*)$/.test(declared)) throw gateError();
    const length = Number(declared);
    if (!Number.isSafeInteger(length) || length > FORM_BODY_LIMIT_BYTES) throw gateError();
  } else if (headerValues(request, "Content-Length").length > 0) {
    throw gateError();
  }
  if (!request || typeof request[Symbol.asyncIterator] !== "function") throw gateError();
  const chunks = [];
  let length = 0;
  for await (const chunk of request) {
    const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    length += bytes.byteLength;
    if (length > FORM_BODY_LIMIT_BYTES) throw gateError();
    chunks.push(bytes);
  }
  if (declared !== null && Number(declared) !== length) throw gateError();
  try { return new TextDecoder("utf-8", { fatal: true }).decode(Buffer.concat(chunks)); }
  catch (_error) { throw gateError(); }
}

function parseAccessCode(body) {
  if (typeof body !== "string" || body.length < 1 || /%(?![0-9A-Fa-f]{2})/.test(body)) throw gateError();
  const entries = [...new URLSearchParams(body).entries()];
  if (entries.length !== 1 || entries[0][0] !== "accessCode" || typeof entries[0][1] !== "string") throw gateError();
  return entries[0][1];
}

function createPrivateAlphaGate(rawInput) {
  const input = exactInput(rawInput);
  if (typeof input.accessSecret !== "string" || input.accessSecret !== input.accessSecret.trim()) throw gateError();
  const secretLength = Buffer.byteLength(input.accessSecret, "utf8");
  if (secretLength < 32 || secretLength > 512 || typeof input.handler !== "function"
      || (input.now !== undefined && typeof input.now !== "function")
      || (input.randomBytes !== undefined && typeof input.randomBytes !== "function")) throw gateError();
  const trustedOrigin = validateTrustedOrigin(input.trustedOrigin);
  const serviceRoot = validateServiceRoot(input.serviceRoot);
  const now = input.now || Date.now;
  const random = input.randomBytes || randomBytes;
  const accessDigest = createHash("sha256").update(input.accessSecret, "utf8").digest();
  const signingKey = createHash("sha256").update("Pocket private alpha v1\u0000", "utf8").update(input.accessSecret, "utf8").digest();

  function signature(payload) {
    return createHmac("sha256", signingKey).update(payload, "utf8").digest();
  }

  function issueToken() {
    const issuedAt = Math.floor(now() / 1000);
    const nonce = random(24);
    if (!Number.isSafeInteger(issuedAt) || issuedAt < 1 || !(nonce instanceof Uint8Array) || nonce.byteLength !== 24) {
      throw gateError();
    }
    const payload = `${TOKEN_VERSION}.${issuedAt}.${Buffer.from(nonce).toString("base64url")}`;
    return `${payload}.${signature(payload).toString("base64url")}`;
  }

  function validToken(token) {
    if (typeof token !== "string") return false;
    const match = TOKEN_PATTERN.exec(token);
    if (!match) return false;
    const issuedAt = Number(match[1]);
    const current = Math.floor(now() / 1000);
    if (!Number.isSafeInteger(issuedAt) || !Number.isSafeInteger(current)
        || issuedAt < 1 || current < issuedAt || current - issuedAt > TOKEN_LIFETIME_SECONDS) return false;
    const payload = `${TOKEN_VERSION}.${match[1]}.${match[2]}`;
    let supplied;
    try { supplied = Buffer.from(match[3], "base64url"); } catch (_error) { return false; }
    const expected = signature(payload);
    return supplied.toString("base64url") === match[3]
      && supplied.byteLength === expected.byteLength && timingSafeEqual(supplied, expected);
  }

  function admitted(request) {
    return validToken(alphaCookie(request));
  }

  function apiPath(request) {
    if (typeof request?.url !== "string" || !request.url.startsWith("/") || request.url.startsWith("//")) return false;
    let parsed;
    try { parsed = new URL(request.url, "https://pocket.invalid"); } catch (_error) { return false; }
    return parsed.pathname === serviceRoot || parsed.pathname.startsWith(`${serviceRoot}/`);
  }

  async function submit(request, response) {
    if (request.method !== "POST") return emptyResponse(response, 405);
    if (singleHeader(request, "Origin") !== trustedOrigin
        || singleHeader(request, "Content-Type") === null
        || !FORM_CONTENT_TYPE.test(singleHeader(request, "Content-Type"))) {
      return emptyResponse(response, 403);
    }
    let candidate;
    try { candidate = parseAccessCode(await readFormBody(request)); }
    catch (_error) { return emptyResponse(response, 400); }
    const suppliedDigest = createHash("sha256").update(candidate, "utf8").digest();
    if (!timingSafeEqual(accessDigest, suppliedDigest)) return formResponse(request, response, 403);
    let token;
    try { token = issueToken(); } catch (_error) { return emptyResponse(response, 500); }
    const expires = new Date(now() + TOKEN_LIFETIME_SECONDS * 1000);
    if (!Number.isFinite(expires.getTime())) return emptyResponse(response, 500);
    response.statusCode = 303;
    safeHeaders(response);
    response.setHeader("Set-Cookie", `${COOKIE_NAME}=${token}; Path=/; Secure; HttpOnly; SameSite=Strict; Max-Age=${TOKEN_LIFETIME_SECONDS}; Expires=${expires.toUTCString()}`);
    response.setHeader("Location", "/");
    response.end();
  }

  async function handle(request, response) {
    if (request?.url === SUBMIT_PATH) return submit(request, response);
    if (request?.url === ACCESS_PATH) {
      if (request.method !== "GET" && request.method !== "HEAD") return emptyResponse(response, 405);
      if (admitted(request)) return redirect(response, "/");
      return formResponse(request, response);
    }
    if (admitted(request)) return input.handler(request, response);
    if (request?.url === "/" || request?.url === "/index.html") {
      if (request.method === "GET" || request.method === "HEAD") return redirect(response, ACCESS_PATH);
    }
    if (apiPath(request)) return emptyResponse(response, 404);
    return input.handler(request, response);
  }

  return Object.freeze(handle);
}

module.exports = Object.freeze({ createPrivateAlphaGate });
