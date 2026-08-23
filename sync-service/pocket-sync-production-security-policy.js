"use strict";

const PRODUCTION_CSP = [
  "default-src 'none'",
  "script-src 'self'",
  "connect-src 'self'",
  "worker-src 'self'",
  // Pocket's existing drag, pop-out and outline owners create runtime style elements/attributes.
  // Keep this exception confined to styles; executable script remains external and same-origin only.
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self'",
  "manifest-src 'self'",
  "object-src 'none'",
  "base-uri 'none'",
  "frame-ancestors 'none'",
  "form-action 'self'",
].join("; ");

const PRIVATE_ALPHA_CSP = "default-src 'none'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'";

const REQUIRED_HEADERS = Object.freeze({
  "strict-transport-security": Object.freeze({ name: "Strict-Transport-Security", value: "max-age=31536000" }),
  "x-content-type-options": Object.freeze({ name: "X-Content-Type-Options", value: "nosniff" }),
  "referrer-policy": Object.freeze({ name: "Referrer-Policy", value: "same-origin" }),
  "x-frame-options": Object.freeze({ name: "X-Frame-Options", value: "DENY" }),
  "cross-origin-opener-policy": Object.freeze({ name: "Cross-Origin-Opener-Policy", value: "same-origin" }),
  "cross-origin-resource-policy": Object.freeze({ name: "Cross-Origin-Resource-Policy", value: "same-origin" }),
  "permissions-policy": Object.freeze({
    name: "Permissions-Policy",
    value: "camera=(), microphone=(), geolocation=(), payment=(), usb=()",
  }),
  "content-security-policy": Object.freeze({ name: "Content-Security-Policy", value: PRODUCTION_CSP }),
});

function policyError() {
  const error = new Error("Pocket production security policy failed.");
  error.code = "sync-production-security-policy-failed";
  return error;
}

function validateFixedPolicy() {
  const headers = Object.values(REQUIRED_HEADERS);
  if (headers.length !== 8 || new Set(headers.map((entry) => entry.name.toLowerCase())).size !== headers.length
      || REQUIRED_HEADERS["strict-transport-security"].value !== "max-age=31536000"
      || /includeSubDomains|preload/i.test(REQUIRED_HEADERS["strict-transport-security"].value)
      || !PRODUCTION_CSP.includes("script-src 'self'")
      || /script-src[^;]*(?:'unsafe-inline'|'unsafe-eval'|https?:)/.test(PRODUCTION_CSP)
      || !PRODUCTION_CSP.includes("style-src 'self' 'unsafe-inline'")
      || !PRODUCTION_CSP.includes("connect-src 'self'") || !PRODUCTION_CSP.includes("worker-src 'self'")
      || !PRODUCTION_CSP.includes("object-src 'none'") || !PRODUCTION_CSP.includes("base-uri 'none'")
      || !PRODUCTION_CSP.includes("frame-ancestors 'none'") || !PRODUCTION_CSP.includes("form-action 'self'")
      || !PRIVATE_ALPHA_CSP.includes("default-src 'none'")
      || !PRIVATE_ALPHA_CSP.includes("frame-ancestors 'none'")) throw policyError();
}

function protectedValue(name, value) {
  const key = String(name).toLowerCase();
  const required = REQUIRED_HEADERS[key];
  if (!required) return true;
  if (typeof value !== "string") return false;
  if (value === required.value) return true;
  return key === "content-security-policy" && value === PRIVATE_ALPHA_CSP;
}

function headerEntries(headers) {
  if (headers === undefined) return [];
  if (Array.isArray(headers)) {
    if (headers.length % 2 !== 0) throw policyError();
    const entries = [];
    for (let index = 0; index < headers.length; index += 2) entries.push([headers[index], headers[index + 1]]);
    return entries;
  }
  if (!headers || typeof headers !== "object") throw policyError();
  return Object.entries(headers);
}

function secureResponse(response) {
  if (!response || typeof response !== "object" || typeof response.setHeader !== "function"
      || typeof response.end !== "function") throw policyError();
  const setHeader = response.setHeader.bind(response);
  for (const entry of Object.values(REQUIRED_HEADERS)) setHeader(entry.name, entry.value);
  let selectedCsp = PRODUCTION_CSP;
  const requireProtectedValue = (name, value) => {
    if (!protectedValue(name, value)) throw policyError();
    if (String(name).toLowerCase() === "content-security-policy") {
      if (selectedCsp === PRIVATE_ALPHA_CSP && value !== PRIVATE_ALPHA_CSP) throw policyError();
      selectedCsp = value;
    }
  };

  return new Proxy(response, {
    get(target, property) {
      if (property === "setHeader") {
        return (name, value) => {
          requireProtectedValue(name, value);
          return target.setHeader(name, value);
        };
      }
      if (property === "appendHeader") {
        return (name, value) => {
          if (REQUIRED_HEADERS[String(name).toLowerCase()]) throw policyError();
          if (typeof target.appendHeader !== "function") throw policyError();
          return target.appendHeader(name, value);
        };
      }
      if (property === "removeHeader") {
        return (name) => {
          if (REQUIRED_HEADERS[String(name).toLowerCase()]) throw policyError();
          if (typeof target.removeHeader !== "function") throw policyError();
          return target.removeHeader(name);
        };
      }
      if (property === "writeHead") {
        return (statusCode, statusMessage, headers) => {
          let message = statusMessage;
          let values = headers;
          if (typeof statusMessage !== "string") {
            values = statusMessage;
            message = undefined;
          }
          for (const [name, value] of headerEntries(values)) {
            requireProtectedValue(name, value);
          }
          if (message !== undefined) return target.writeHead(statusCode, message, values);
          return values === undefined ? target.writeHead(statusCode) : target.writeHead(statusCode, values);
        };
      }
      const value = Reflect.get(target, property, target);
      return typeof value === "function" ? value.bind(target) : value;
    },
    set(target, property, value) {
      return Reflect.set(target, property, value, target);
    },
  });
}

function createProductionSecurityPolicy(handler) {
  validateFixedPolicy();
  if (typeof handler !== "function") throw policyError();
  return Object.freeze(async function productionSecurityPolicy(request, response) {
    return handler(request, secureResponse(response));
  });
}

module.exports = Object.freeze({
  PRIVATE_ALPHA_CSP,
  PRODUCTION_CSP,
  createProductionSecurityPolicy,
});
