"use strict";

// P349: DORMANT, explicitly constructed diagnostic-only MCP resource.
// Not imported by the normal Pocket production runtime. No SQL, Sync, Pocket
// accounts, document stores, owner bindings, capabilities, receipts or publish.
const { Server } = require("@modelcontextprotocol/sdk/server/index.js");
const { StreamableHTTPServerTransport } =
  require("@modelcontextprotocol/sdk/server/streamableHttp.js");
const { CallToolRequestSchema, ListToolsRequestSchema, ErrorCode, McpError } =
  require("@modelcontextprotocol/sdk/types.js");
const { createProjectDocumentsJwtTokenVerifier, hasScope } =
  require("./pocket-project-documents-auth.js");

const TOOL = "connection_identity_check";
const STATUSES = Object.freeze(["PASS", "DENY", "UNVERIFIED"]);
const TOOL_DEFINITION = Object.freeze({
  name: TOOL,
  title: "Check external OAuth identity",
  description: "Check only the verified OAuth external-principal evidence; no Pocket data or permissions.",
  inputSchema: Object.freeze({ type: "object", additionalProperties: false, properties: {} }),
  annotations: Object.freeze({
    readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false,
  }),
});
const validSubject = value => typeof value === "string" && value.length > 0
  && value.length <= 512 && value === value.trim()
  && !/[\s\x00-\x1f\x7f]/u.test(value) && !value.toLowerCase().endsWith("@clients");

function validate(input) {
  if (!input || typeof input !== "object" || Array.isArray(input)
      || Object.keys(input).length !== 3 || input.diagnosticOnly !== true
      || !input.config || !input.registeredClient) throw new TypeError("Diagnostic unavailable.");
  const { config, registeredClient } = input;
  if (!config || typeof config !== "object"
      || !["issuer", "audience", "jwksUrl", "resourceUrl", "resourceMetadataUrl", "mcpRoot", "readScope"]
        .every(key => typeof config[key] === "string" && config[key].length > 0)
      || registeredClient.verified !== true || registeredClient.thirdPartyCimd !== true
      || registeredClient.delegatedOnly !== true || registeredClient.machineGrantsDisabled !== true
      || typeof registeredClient.clientId !== "string" || !registeredClient.clientId.trim()
      || registeredClient.clientId !== registeredClient.clientId.trim()
      || registeredClient.clientId.length > 512
      || registeredClient.issuer !== config.issuer) throw new TypeError("Diagnostic unavailable.");
  let resource, metadata, issuer;
  try {
    resource = new URL(config.resourceUrl);
    metadata = new URL(config.resourceMetadataUrl);
    issuer = new URL(config.issuer);
  } catch { throw new TypeError("Diagnostic unavailable."); }
  if (resource.protocol !== "https:" || resource.href !== config.resourceUrl
      || resource.pathname !== config.mcpRoot || resource.search || resource.hash
      || metadata.origin !== resource.origin
      || metadata.pathname !== "/.well-known/oauth-protected-resource" + config.mcpRoot
      || metadata.search || metadata.hash
      || issuer.protocol !== "https:" || issuer.href !== config.issuer
      || issuer.pathname !== "/" || issuer.search || issuer.hash) {
    throw new TypeError("Diagnostic unavailable.");
  }
}

function safePath(request) {
  if (typeof request?.url !== "string" || !request.url.startsWith("/")
      || request.url.startsWith("//")) return null;
  try {
    const parsed = new URL(request.url, "https://pocket.invalid");
    return parsed.search || parsed.hash ? null : parsed.pathname;
  } catch { return null; }
}

function bearer(request) {
  // Same single-header, bounded bearer constraint as ordinary MCP.
  let headers = [];
  if (Array.isArray(request?.rawHeaders) && request.rawHeaders.length % 2 === 0) {
    for (let n = 0; n < request.rawHeaders.length; n += 2) {
      if (String(request.rawHeaders[n]).toLowerCase() === "authorization") {
        headers.push(request.rawHeaders[n + 1]);
      }
    }
  } else {
    const value = request?.headers?.authorization;
    headers = Array.isArray(value) ? value : [value];
  }
  if (headers.length !== 1 || typeof headers[0] !== "string") return null;
  const found = /^Bearer ([^\s]+)$/.exec(headers[0]);
  return found && found[1].length <= 16384 ? found[1] : null;
}

function resultOnly(result) {
  const structuredContent = Object.freeze({ result });
  return {
    content: [{ type: "text", text: JSON.stringify(structuredContent) }],
    structuredContent,
  };
}

function createPocketConnectionDiagnostic(input) {
  validate(input);
  // Copy the validated primitive security policy into privately owned objects.
  // Never freeze or subsequently consult the caller's mutable objects.
  const config = Object.freeze({ ...input.config });
  const registeredClient = Object.freeze({ ...input.registeredClient });
  // Validate the exact snapshots consumed by the verifier and MCP handler.
  validate({ diagnosticOnly: true, config, registeredClient });
  // Private verified claims, keyed by the exact frozen authInfo object.
  const provenance = new WeakMap();
  const verifier = createProjectDocumentsJwtTokenVerifier(config, {
    requireRs256: true,
    verifiedSubjectObserver(auth, claims) {
      if (!Object.isFrozen(auth) || !Object.isFrozen(claims)) {
        throw new TypeError("Diagnostic unavailable.");
      }
      provenance.set(auth, claims);
    },
  });

  async function checkToken(token) {
    let auth;
    try { auth = await verifier.verifyAccessToken(token); }
    catch { return "DENY"; }
    const claims = provenance.get(auth);
    provenance.delete(auth);
    if (!claims || claims.issuer !== config.issuer || claims.audience !== config.audience
        || claims.resourceUrl !== config.resourceUrl || claims.apiOnlyAudience !== true
        || !hasScope(auth, config.readScope)
        || !Number.isSafeInteger(claims.expiresAt)
        || claims.expiresAt <= Math.floor(Date.now() / 1000)
        || (claims.issuedAt !== undefined
            && (!Number.isSafeInteger(claims.issuedAt)
              || claims.issuedAt > Math.floor(Date.now() / 1000)))
        || (claims.notBefore !== undefined
            && (!Number.isSafeInteger(claims.notBefore)
              || claims.notBefore > Math.floor(Date.now() / 1000)))
        || !validSubject(claims.subject)) return "DENY";
    if (claims.tokenUse !== undefined && claims.tokenUse !== "access") return "DENY";

    // Presence or absence of a client ID is NOT proof of end-user identity.
    // Match only signed azp/client_id to independently approved registration.
    const ids = [claims.authorizedParty, claims.signedClientId]
      .filter(value => value !== undefined);
    if (ids.length === 0 || ids.some(x => typeof x !== "string" || x.length === 0)
        || (ids.length === 2 && ids[0] !== ids[1])) return "UNVERIFIED";
    if (ids.some(x => x !== registeredClient.clientId)) return "DENY";

    const grants = [claims.grantType, claims.oauthGrantType]
      .filter(value => value !== undefined);
    if (grants.some(x => x === "client_credentials" || x === "client-credentials"
        || x === "password")) return "DENY";
    if (grants.some(x => typeof x !== "string"
        || !["authorization_code", "refresh_token"].includes(x))
        || (grants.length === 2 && grants[0] !== grants[1])) return "UNVERIFIED";

    // When grant type is omitted, the trusted registration's strict,
    // delegated-only and machine-disabled constraints are necessary
    // corroboration; no subject spelling or client_id fallback suffices.
    return "PASS";
  }

  function matches(request) {
    const path = safePath(request);
    return path === config.mcpRoot || path === new URL(config.resourceMetadataUrl).pathname;
  }

  async function handle(request, response) {
    const path = safePath(request);
    response.setHeader("Cache-Control", "no-store");
    response.setHeader("X-Content-Type-Options", "nosniff");
    if (path === new URL(config.resourceMetadataUrl).pathname
        && (request.method === "GET" || request.method === "HEAD")) {
      const payload = JSON.stringify({
        resource: config.resourceUrl, authorization_servers: [config.issuer],
        scopes_supported: [config.readScope], bearer_methods_supported: ["header"],
      });
      response.statusCode = 200;
      response.setHeader("Content-Type", "application/json; charset=utf-8");
      response.end(request.method === "HEAD" ? "" : payload);
      return true;
    }
    if (path !== config.mcpRoot || request.method !== "POST") {
      response.statusCode = 405;
      response.end();
      return true;
    }

    const token = bearer(request);
    const classification = token ? await checkToken(token) : "DENY";
    if (!token || classification === "DENY") {
      // HTTP OAuth challenges are protocol-level exceptions to tool output.
      response.statusCode = 401;
      response.setHeader("Content-Type", "application/json; charset=utf-8");
      response.setHeader("WWW-Authenticate",
        'Bearer resource_metadata="' + config.resourceMetadataUrl
        + '", scope="' + config.readScope + '", error="invalid_token"');
      response.end(JSON.stringify({ error: "invalid_token" }));
      return true;
    }

    // The only MCP capability is one inert, result-only tool.
    // No ordinary Project Documents definitions or store is reachable.
    const server = new Server({ name: "pocket-connection-diagnostic", version: "1.0.0" },
      { capabilities: { tools: {} } });
    server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: [TOOL_DEFINITION] }));
    server.setRequestHandler(CallToolRequestSchema, async request => {
      if (request.params.name !== TOOL) {
        throw new McpError(ErrorCode.MethodNotFound, "Unknown diagnostic tool.");
      }
      const args = request.params.arguments ?? {};
      if (!args || typeof args !== "object" || Array.isArray(args)
          || Object.keys(args).length !== 0) {
        throw new McpError(ErrorCode.InvalidParams, "Invalid diagnostic arguments.");
      }
      return resultOnly(classification);
    });
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
    try {
      await server.connect(transport);
      await transport.handleRequest(request, response);
    } finally {
      try { await server.close(); } catch {}
    }
    return true;
  }
  return Object.freeze({ matches, handle, checkToken });
}

module.exports = Object.freeze({ createPocketConnectionDiagnostic, STATUSES });
