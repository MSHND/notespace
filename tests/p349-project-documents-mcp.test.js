"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");

const { Client } = require("@modelcontextprotocol/sdk/client/index.js");
const { InMemoryTransport } = require("@modelcontextprotocol/sdk/inMemory.js");
const {
  createProjectDocumentsMcpServer,
  projectDocumentToolDefinitions,
} = require("../sync-service/pocket-project-documents-mcp.js");

function config() {
  return {
    readScope: "pocket.project-documents.read",
    writeScope: "pocket.project-documents.write",
    resourceMetadataUrl: "https://pocket.example/.well-known/oauth-protected-resource/project-docs/mcp",
  };
}

function auth(scopes) {
  return {
    token: "token",
    clientId: "client",
    scopes,
    expiresAt: Math.floor(Date.now() / 1000) + 300,
    resource: new URL("https://pocket.example/project-docs/mcp"),
  };
}

function store() {
  const docs = new Map([
    ["start-here", { name: "start-here", content: "Start", revision: 1, updatedAt: "2026-10-07T12:00:00.000Z" }],
  ]);
  const calls = [];
  return {
    calls,
    docs,
    async list() {
      calls.push(["list"]);
      return [...docs.values()]
        .sort((a, b) => a.name.localeCompare(b.name))
        .map(({ name, revision, updatedAt }) => ({ name, revision, updatedAt }));
    },
    async read(name) {
      calls.push(["read", name]);
      const document = docs.get(name);
      return document ? { ok: true, document } : { ok: false, reason: "not-found" };
    },
    async create(name, content) {
      calls.push(["create", name, content]);
      if (docs.has(name)) return { ok: false, reason: "already-exists" };
      const document = { name, content, revision: 1, updatedAt: "2026-10-07T12:01:00.000Z" };
      docs.set(name, document);
      return { ok: true, document };
    },
    async update(name, expectedRevision, content) {
      calls.push(["update", name, expectedRevision, content]);
      const current = docs.get(name);
      if (!current) return { ok: false, reason: "not-found" };
      if (current.revision !== expectedRevision) {
        return { ok: false, reason: "revision-conflict", currentRevision: current.revision };
      }
      const document = {
        name,
        content,
        revision: current.revision + 1,
        updatedAt: "2026-10-07T12:02:00.000Z",
      };
      docs.set(name, document);
      return { ok: true, document };
    },
  };
}

async function harness(scopes) {
  const database = store();
  const server = createProjectDocumentsMcpServer({
    store: database,
    authInfo: auth(scopes),
    config: config(),
  });
  const client = new Client({ name: "p349-test-client", version: "1.0.0" });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  await client.connect(clientTransport);
  return {
    database,
    server,
    client,
    async close() {
      try { await client.close(); } catch (_error) {}
      try { await server.close(); } catch (_error) {}
    },
  };
}

test("P349 MCP advertises exactly four bounded OAuth tools with truthful annotations", async (t) => {
  const definitions = projectDocumentToolDefinitions(config());
  assert.deepEqual(definitions.map((tool) => tool.name), [
    "list_project_documents",
    "read_project_document",
    "create_project_document",
    "update_project_document",
  ]);
  assert.equal(definitions.some((tool) => /delete|sql|execute/i.test(tool.name)), false);

  assert.deepEqual(definitions[0].securitySchemes, [{
    type: "oauth2",
    scopes: [config().readScope],
  }]);
  assert.deepEqual(definitions[2].securitySchemes, [{
    type: "oauth2",
    scopes: [config().writeScope],
  }]);
  assert.equal(definitions[0].annotations.readOnlyHint, true);
  assert.equal(definitions[1].annotations.readOnlyHint, true);
  assert.equal(definitions[2].annotations.readOnlyHint, false);
  assert.equal(definitions[2].annotations.destructiveHint, false);
  assert.equal(definitions[3].annotations.destructiveHint, true);
  assert.equal(definitions.every((tool) => tool.annotations.openWorldHint === false), true);

  const h = await harness([config().readScope, config().writeScope]);
  t.after(() => h.close());
  const listed = await h.client.listTools();
  assert.deepEqual(listed.tools.map((tool) => tool.name), definitions.map((tool) => tool.name));
  assert.equal(listed.tools.length, 4);
});

test("P349 read tools return provider-neutral structured document metadata/content", async (t) => {
  const h = await harness([config().readScope]);
  t.after(() => h.close());
  await h.client.listTools();

  const listed = await h.client.callTool({ name: "list_project_documents", arguments: {} });
  assert.deepEqual(listed.structuredContent, {
    documents: [{ name: "start-here", revision: 1, updated_at: "2026-10-07T12:00:00.000Z" }],
  });

  const read = await h.client.callTool({
    name: "read_project_document",
    arguments: { name: "start-here" },
  });
  assert.deepEqual(read.structuredContent, {
    document: {
      name: "start-here",
      content: "Start",
      revision: 1,
      updated_at: "2026-10-07T12:00:00.000Z",
    },
  });

  const missing = await h.client.callTool({
    name: "read_project_document",
    arguments: { name: "missing-doc" },
  });
  assert.equal(missing.isError, true);
  assert.match(missing.content[0].text, /not found/i);
});

test("P349 read scope cannot invoke writes and challenge occurs before store", async (t) => {
  const h = await harness([config().readScope]);
  t.after(() => h.close());
  await h.client.listTools();
  const before = h.database.calls.length;

  const result = await h.client.callTool({
    name: "create_project_document",
    arguments: { name: "new-doc", content: "No" },
  });
  assert.equal(result.isError, true);
  assert.equal(h.database.calls.length, before);
  assert.ok(Array.isArray(result._meta?.["mcp/www_authenticate"]));
  assert.match(result._meta["mcp/www_authenticate"][0], /scope="pocket\.project-documents\.write"/);
});

test("P349 write scope creates and exact-revision updates while conflicts remain non-destructive", async (t) => {
  const h = await harness([config().writeScope]);
  t.after(() => h.close());
  await h.client.listTools();

  const created = await h.client.callTool({
    name: "create_project_document",
    arguments: { name: "current-task", content: "v1" },
  });
  assert.equal(created.structuredContent.document.revision, 1);
  assert.equal(created.structuredContent.document.content, "v1");

  const duplicate = await h.client.callTool({
    name: "create_project_document",
    arguments: { name: "current-task", content: "replacement" },
  });
  assert.equal(duplicate.isError, true);
  assert.equal(h.database.docs.get("current-task").content, "v1");

  const updated = await h.client.callTool({
    name: "update_project_document",
    arguments: { name: "current-task", expected_revision: 1, content: "v2" },
  });
  assert.equal(updated.structuredContent.document.revision, 2);
  assert.equal(updated.structuredContent.document.content, "v2");

  const stale = await h.client.callTool({
    name: "update_project_document",
    arguments: { name: "current-task", expected_revision: 1, content: "stale" },
  });
  assert.equal(stale.isError, true);
  assert.match(stale.content[0].text, /revision conflict/i);
  assert.equal(h.database.docs.get("current-task").content, "v2");
  assert.equal(h.database.docs.get("current-task").revision, 2);
});

test("P349 MCP schemas reject invalid names/revisions/content before store calls", async (t) => {
  const h = await harness([config().writeScope]);
  t.after(() => h.close());
  await h.client.listTools();

  const before = h.database.calls.length;
  await assert.rejects(
    () => h.client.callTool({
      name: "create_project_document",
      arguments: { name: "Pocket — START HERE", content: "bad" },
    }),
    /Invalid/
  );
  await assert.rejects(
    () => h.client.callTool({
      name: "update_project_document",
      arguments: { name: "start-here", expected_revision: 0, content: "bad" },
    }),
    /Invalid/
  );
  assert.equal(h.database.calls.length, before);
});
