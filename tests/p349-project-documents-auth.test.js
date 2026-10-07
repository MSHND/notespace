"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");

const {
  createProjectDocumentsApplication,
} = require("../sync-service/pocket-project-documents-application.js");
const {
  createProjectDocumentsTokenVerifier,
} = require("../sync-service/pocket-project-documents-auth.js");
const {
  createProjectDocumentsConfig,
} = require("../sync-service/pocket-project-documents-config.js");

function environment() {
  return {
    POCKET_PROJECT_DOCS_MCP_ROOT: "/project-docs/mcp",
    POCKET_PROJECT_DOCS_RESOURCE_URL: "https://pocket.example/project-docs/mcp",
    POCKET_PROJECT_DOCS_OAUTH_ISSUER: "https://auth.example",
    POCKET_PROJECT_DOCS_OAUTH_AUDIENCE: "pocket-project-documents",
    POCKET_PROJECT_DOCS_OAUTH_JWKS_URL: "https://auth.example/.well-known/jwks.json",
    POCKET_PROJECT_DOCS_OAUTH_READ_SCOPE: "pocket.project-documents.read",
    POCKET_PROJECT_DOCS_OAUTH_WRITE_SCOPE: "pocket.project-documents.write",
  };
}

function response() {
  const headers = new Map();
  return {
    statusCode: 0,
    headers,
    body: Buffer.alloc(0),
    setHeader(name, value) { headers.set(String(name).toLowerCase(), value); },
    getHeader(name) { return headers.get(String(name).toLowerCase()); },
    end(body) { this.body = body ? Buffer.from(body) : Buffer.alloc(0); },
  };
}

function request(url, headers = {}, method = "POST") {
  const rawHeaders = [];
  for (const [name, value] of Object.entries(headers)) rawHeaders.push(name, value);
  return { url, method, rawHeaders, headers: Object.fromEntries(
    Object.entries(headers).map(([key, value]) => [key.toLowerCase(), value])
  ) };
}

function noTouchStore(counter) {
  return Object.freeze({
    async list() { counter.count += 1; return []; },
    async read() { counter.count += 1; return { ok: false, reason: "not-found" }; },
    async create() { counter.count += 1; return { ok: false }; },
    async update() { counter.count += 1; return { ok: false }; },
  });
}

test("P349 project-document configuration is optional but partial configuration fails closed", () => {
  assert.equal(createProjectDocumentsConfig({ environment: {} }), null);
  assert.throws(
    () => createProjectDocumentsConfig({ environment: { POCKET_PROJECT_DOCS_MCP_ROOT: "/project-docs/mcp" } }),
    (error) => error?.code === "project-documents-config-invalid"
  );

  const config = createProjectDocumentsConfig({ environment: environment() });
  assert.equal(config.mcpRoot, "/project-docs/mcp");
  assert.equal(config.resourceUrl, "https://pocket.example/project-docs/mcp");
  assert.equal(
    config.resourceMetadataUrl,
    "https://pocket.example/.well-known/oauth-protected-resource/project-docs/mcp"
  );
  assert.notEqual(config.readScope, config.writeScope);
});

test("P349 injected token verifier enforces issuer, audience, expiry and scopes", async () => {
  const config = createProjectDocumentsConfig({ environment: environment() });
  const base = {
    iss: config.issuer,
    aud: config.audience,
    exp: Math.floor(Date.now() / 1000) + 300,
    sub: "project-client",
    scope: config.readScope,
  };

  const valid = createProjectDocumentsTokenVerifier({
    config,
    async verifyJwt() { return base; },
  });
  const info = await valid.verifyAccessToken("token");
  assert.equal(info.clientId, "project-client");
  assert.deepEqual([...info.scopes], [config.readScope]);
  assert.equal(info.resource.href, config.resourceUrl);

  for (const payload of [
    { ...base, iss: "https://other.example" },
    { ...base, aud: "wrong-audience" },
    { ...base, exp: Math.floor(Date.now() / 1000) - 1 },
  ]) {
    const verifier = createProjectDocumentsTokenVerifier({ config, async verifyJwt() { return payload; } });
    await assert.rejects(
      () => verifier.verifyAccessToken("token"),
      (error) => error?.code === "project-documents-auth-invalid"
    );
  }
});

test("P349 protected-resource metadata is public and bounded while MCP requires bearer auth before store access", async () => {
  const config = createProjectDocumentsConfig({ environment: environment() });
  const calls = { count: 0 };
  const application = createProjectDocumentsApplication({
    config,
    store: noTouchStore(calls),
    tokenVerifier: { async verifyAccessToken() { throw new Error("invalid"); } },
  });

  const metadataResponse = response();
  assert.equal(await application.handle(
    request(new URL(config.resourceMetadataUrl).pathname, {}, "GET"),
    metadataResponse
  ), true);
  assert.equal(metadataResponse.statusCode, 200);
  const metadata = JSON.parse(metadataResponse.body.toString("utf8"));
  assert.equal(metadata.resource, config.resourceUrl);
  assert.deepEqual(metadata.authorization_servers, [config.issuer]);
  assert.deepEqual(metadata.scopes_supported, [config.readScope, config.writeScope]);
  assert.equal(calls.count, 0);

  const missing = response();
  assert.equal(await application.handle(request(config.mcpRoot), missing), true);
  assert.equal(missing.statusCode, 401);
  assert.match(String(missing.getHeader("www-authenticate")), /resource_metadata=/);
  assert.equal(calls.count, 0);

  const invalid = response();
  assert.equal(await application.handle(
    request(config.mcpRoot, { Authorization: "Bearer bad-token" }),
    invalid
  ), true);
  assert.equal(invalid.statusCode, 401);
  assert.equal(calls.count, 0);
});

test("P349 wrong resource binding is rejected before MCP/store access", async () => {
  const config = createProjectDocumentsConfig({ environment: environment() });
  const calls = { count: 0 };
  const application = createProjectDocumentsApplication({
    config,
    store: noTouchStore(calls),
    tokenVerifier: {
      async verifyAccessToken(token) {
        return {
          token,
          clientId: "client",
          scopes: [config.readScope, config.writeScope],
          expiresAt: Math.floor(Date.now() / 1000) + 300,
          resource: new URL("https://pocket.example/wrong-resource"),
        };
      },
    },
  });

  const res = response();
  assert.equal(await application.handle(
    request(config.mcpRoot, { Authorization: "Bearer valid-looking" }),
    res
  ), true);
  assert.equal(res.statusCode, 401);
  assert.equal(calls.count, 0);
});
