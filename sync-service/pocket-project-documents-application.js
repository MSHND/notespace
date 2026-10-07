"use strict";

const { StreamableHTTPServerTransport } = require("@modelcontextprotocol/sdk/server/streamableHttp.js");
const {
  challenge,
  createProjectDocumentsMcpServer,
} = require("./pocket-project-documents-mcp.js");

function applicationError() {
  const error = new Error("Pocket project documents application failed.");
  error.code = "project-documents-application-failed";
  return error;
}

function singleHeader(request, name) {
  const wanted = String(name).toLowerCase();
  if (Array.isArray(request?.rawHeaders) && request.rawHeaders.length % 2 === 0) {
    const values = [];
    for (let index = 0; index < request.rawHeaders.length; index += 2) {
      if (String(request.rawHeaders[index]).toLowerCase() === wanted) values.push(request.rawHeaders[index + 1]);
    }
    return values.length === 1 && typeof values[0] === "string" ? values[0] : null;
  }
  const raw = request?.headers?.[wanted];
  if (Array.isArray(raw)) return raw.length === 1 && typeof raw[0] === "string" ? raw[0] : null;
  return typeof raw === "string" ? raw : null;
}

function requestPath(request) {
  if (!request || typeof request.url !== "string" || !request.url.startsWith("/") || request.url.startsWith("//")) {
    return null;
  }
  try {
    const parsed = new URL(request.url, "https://pocket.invalid");
    return parsed.search ? null : parsed.pathname;
  } catch (_error) { return null; }
}

function safeHeaders(response, contentType = null) {
  response.setHeader("Cache-Control", "no-store");
  response.setHeader("X-Content-Type-Options", "nosniff");
  if (contentType) response.setHeader("Content-Type", contentType);
}

function empty(response, status) {
  response.statusCode = status;
  safeHeaders(response);
  response.end();
}

function json(response, status, value, headOnly = false) {
  const body = Buffer.from(JSON.stringify(value), "utf8");
  response.statusCode = status;
  safeHeaders(response, "application/json; charset=utf-8");
  response.setHeader("Content-Length", body.byteLength);
  if (headOnly) response.end();
  else response.end(body);
}

function comparableResource(value) {
  let parsed;
  try { parsed = value instanceof URL ? value : new URL(value); } catch (_error) { return null; }
  parsed.hash = "";
  const text = parsed.href.replace(/\/$/, "");
  return text;
}

function validAuthInfo(value, config) {
  if (!value || typeof value !== "object" || Array.isArray(value)
      || typeof value.token !== "string" || value.token.length < 1
      || typeof value.clientId !== "string" || value.clientId.length < 1
      || !Array.isArray(value.scopes)
      || !Number.isFinite(value.expiresAt) || value.expiresAt <= Date.now() / 1000
      || comparableResource(value.resource) !== comparableResource(config.resourceUrl)) return false;
  return value.scopes.every((scope) => typeof scope === "string" && scope.length > 0);
}

function bearerToken(request) {
  const header = singleHeader(request, "authorization");
  if (!header) return null;
  const match = /^Bearer ([^\s]+)$/.exec(header);
  return match && match[1].length <= 16384 ? match[1] : null;
}

function unauthorized(response, config, description = "A valid access token is required") {
  response.statusCode = 401;
  safeHeaders(response, "application/json; charset=utf-8");
  response.setHeader("WWW-Authenticate", challenge(
    config,
    config.readScope,
    "invalid_token",
    description
  ));
  const body = Buffer.from(JSON.stringify({
    error: "invalid_token",
    error_description: "A valid access token is required.",
  }), "utf8");
  response.setHeader("Content-Length", body.byteLength);
  response.end(body);
}

function createProjectDocumentsApplication(input) {
  if (!input || typeof input !== "object" || Array.isArray(input)
      || Object.keys(input).length !== 3
      || !input.config || typeof input.config.mcpRoot !== "string"
      || typeof input.config.resourceMetadataUrl !== "string"
      || !input.store || ["list", "read", "create", "update"].some((name) => typeof input.store[name] !== "function")
      || !input.tokenVerifier || typeof input.tokenVerifier.verifyAccessToken !== "function") {
    throw applicationError();
  }
  const config = input.config;
  let metadataPath;
  try {
    const metadata = new URL(config.resourceMetadataUrl);
    const resource = new URL(config.resourceUrl);
    if (metadata.origin !== resource.origin) throw applicationError();
    metadataPath = metadata.pathname;
  } catch (_error) { throw applicationError(); }

  function matches(request) {
    const path = requestPath(request);
    return path === config.mcpRoot || path === metadataPath;
  }

  async function handle(request, response) {
    const path = requestPath(request);
    if (path === metadataPath) {
      if (!["GET", "HEAD"].includes(request.method)) {\n        empty(response, 405);\n        return true;\n      }
      response.setHeader("Access-Control-Allow-Origin", "*");
      return json(response, 200, {
        resource: config.resourceUrl,
        authorization_servers: [config.issuer],
        scopes_supported: [config.readScope, config.writeScope],
        bearer_methods_supported: ["header"],
      }, request.method === "HEAD");
    }
    if (path !== config.mcpRoot) return false;

    const token = bearerToken(request);
    if (!token) {
      unauthorized(response, config);
      return true;
    }

    let authInfo;
    try { authInfo = await input.tokenVerifier.verifyAccessToken(token); }
    catch (_error) {
      unauthorized(response, config);
      return true;
    }
    if (!validAuthInfo(authInfo, config)) {
      unauthorized(response, config);
      return true;
    }

    const priorAuth = request.auth;
    request.auth = authInfo;
    const server = createProjectDocumentsMcpServer({ store: input.store, authInfo, config });
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
    try {
      await server.connect(transport);
      await transport.handleRequest(request, response);
    } finally {
      request.auth = priorAuth;
      try { await server.close(); } catch (_error) {}
    }
    return true;
  }

  return Object.freeze({
    matches,
    handle,
    metadataPath,
    mcpRoot: config.mcpRoot,
  });
}

module.exports = Object.freeze({
  bearerToken,
  createProjectDocumentsApplication,
  validAuthInfo,
});
