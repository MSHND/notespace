"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const {
  PROJECT_DOCUMENTS_PRODUCTION_ENABLED,
  createProductionProjectDocuments,
} = require("../sync-service/pocket-sync-production-server.js");

const ROOT = path.resolve(__dirname, "..");
const SERVICE_ROOT = "/pocket-sync/v1";
const POSTGRES = Object.freeze({ connectionString: "postgres://p349c.invalid/pocket" });

function validEnvironment() {
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

test("P349k production source owns one explicit project-document activation gate and keeps it ON", () => {
  assert.equal(PROJECT_DOCUMENTS_PRODUCTION_ENABLED, true);
  const source = fs.readFileSync(
    path.join(ROOT, "sync-service", "pocket-sync-production-server.js"),
    "utf8"
  );
  assert.match(source, /const PROJECT_DOCUMENTS_PRODUCTION_ENABLED = true;/);
  assert.match(source, /enabled: PROJECT_DOCUMENTS_PRODUCTION_ENABLED,/);
});

test("P349c OFF ignores absent, complete, partial and malformed project-document env without parsing or runtime construction", () => {
  const environments = [
    {},
    validEnvironment(),
    { POCKET_PROJECT_DOCS_MCP_ROOT: "/project-docs/mcp" },
    {
      ...validEnvironment(),
      POCKET_PROJECT_DOCS_MCP_ROOT: "not-a-root",
      POCKET_PROJECT_DOCS_OAUTH_ISSUER: "not-a-url",
    },
  ];

  for (const environment of environments) {
    let configCalls = 0;
    let runtimeCalls = 0;
    const result = createProductionProjectDocuments({
      enabled: false,
      environment,
      postgres: null,
      serviceRoot: null,
    }, {
      createConfig() {
        configCalls += 1;
        throw new Error("config parser must not run while OFF");
      },
      createRuntime() {
        runtimeCalls += 1;
        throw new Error("runtime must not be constructed while OFF");
      },
    });

    assert.equal(result, null);
    assert.equal(configCalls, 0);
    assert.equal(runtimeCalls, 0);
  }
});

test("P349c focused ON seam preserves P349 fail-closed config authority", () => {
  assert.throws(
    () => createProductionProjectDocuments({
      enabled: true,
      environment: {},
      postgres: POSTGRES,
      serviceRoot: SERVICE_ROOT,
    }),
    (error) => error?.code === "sync-production-composition-failed"
  );

  assert.throws(
    () => createProductionProjectDocuments({
      enabled: true,
      environment: { POCKET_PROJECT_DOCS_MCP_ROOT: "/project-docs/mcp" },
      postgres: POSTGRES,
      serviceRoot: SERVICE_ROOT,
    }),
    (error) => error?.code === "project-documents-config-invalid"
  );

  assert.throws(
    () => createProductionProjectDocuments({
      enabled: true,
      environment: {
        ...validEnvironment(),
        POCKET_PROJECT_DOCS_RESOURCE_URL: "http://pocket.example/project-docs/mcp",
      },
      postgres: POSTGRES,
      serviceRoot: SERVICE_ROOT,
    }),
    (error) => error?.code === "project-documents-config-invalid"
  );
});

test("P349c focused ON seam constructs exactly one existing project-document runtime for valid config", () => {
  const expectedRuntime = Object.freeze({
    matches() { return false; },
    async handle() { return false; },
    async preflight() { return true; },
    async close() { return true; },
  });
  let runtimeCalls = 0;
  let captured = null;

  const runtime = createProductionProjectDocuments({
    enabled: true,
    environment: validEnvironment(),
    postgres: POSTGRES,
    serviceRoot: SERVICE_ROOT,
  }, {
    createRuntime(input) {
      runtimeCalls += 1;
      captured = input;
      return expectedRuntime;
    },
  });

  assert.equal(runtime, expectedRuntime);
  assert.equal(runtimeCalls, 1);
  assert.equal(captured.config.mcpRoot, "/project-docs/mcp");
  assert.equal(captured.config.resourceUrl, "https://pocket.example/project-docs/mcp");
  assert.equal(captured.postgres, POSTGRES);
});
