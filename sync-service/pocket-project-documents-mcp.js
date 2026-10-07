"use strict";

const { Server } = require("@modelcontextprotocol/sdk/server/index.js");
const {
  CallToolRequestSchema,
  ErrorCode,
  ListToolsRequestSchema,
  McpError,
} = require("@modelcontextprotocol/sdk/types.js");
const { z } = require("zod/v4");
const {
  MAX_CONTENT_BYTES,
  MAX_NAME_LENGTH,
  MAX_SAFE_REVISION,
  NAME_PATTERN,
} = require("./pocket-project-documents-postgres-store.js");
const { hasScope } = require("./pocket-project-documents-auth.js");

const TOOL_NAMES = Object.freeze([
  "list_project_documents",
  "read_project_document",
  "create_project_document",
  "update_project_document",
]);

const nameSchema = z.string().min(1).max(MAX_NAME_LENGTH).regex(NAME_PATTERN);
const contentSchema = z.string().max(MAX_CONTENT_BYTES).refine(
  (value) => Buffer.byteLength(value, "utf8") <= MAX_CONTENT_BYTES,
  "content exceeds byte limit"
);
const revisionSchema = z.number().int().min(1).max(MAX_SAFE_REVISION);

const INPUT_SCHEMAS = Object.freeze({
  list_project_documents: z.object({}).strict(),
  read_project_document: z.object({ name: nameSchema }).strict(),
  create_project_document: z.object({ name: nameSchema, content: contentSchema }).strict(),
  update_project_document: z.object({
    name: nameSchema,
    expected_revision: revisionSchema,
    content: contentSchema,
  }).strict(),
});

const NAME_JSON_SCHEMA = Object.freeze({
  type: "string",
  minLength: 1,
  maxLength: MAX_NAME_LENGTH,
  pattern: "^[a-z][a-z0-9]*(?:[.-][a-z0-9]+)*$",
});
const CONTENT_JSON_SCHEMA = Object.freeze({
  type: "string",
  maxLength: MAX_CONTENT_BYTES,
  description: `UTF-8 content; maximum ${MAX_CONTENT_BYTES} bytes. The server enforces the byte limit.`,
});
const REVISION_JSON_SCHEMA = Object.freeze({
  type: "integer",
  minimum: 1,
  maximum: MAX_SAFE_REVISION,
});

const DOCUMENT_METADATA_OUTPUT = Object.freeze({
  type: "object",
  additionalProperties: false,
  properties: {
    name: NAME_JSON_SCHEMA,
    revision: REVISION_JSON_SCHEMA,
    updated_at: Object.freeze({ type: "string", format: "date-time" }),
  },
  required: ["name", "revision", "updated_at"],
});
const DOCUMENT_OUTPUT = Object.freeze({
  type: "object",
  additionalProperties: false,
  properties: {
    name: NAME_JSON_SCHEMA,
    content: CONTENT_JSON_SCHEMA,
    revision: REVISION_JSON_SCHEMA,
    updated_at: Object.freeze({ type: "string", format: "date-time" }),
  },
  required: ["name", "content", "revision", "updated_at"],
});

function inputObject(properties, required = []) {
  return Object.freeze({
    type: "object",
    additionalProperties: false,
    properties: Object.freeze(properties),
    ...(required.length > 0 ? { required: Object.freeze(required.slice()) } : {}),
  });
}

function oauthScheme(scope) {
  return Object.freeze([{ type: "oauth2", scopes: Object.freeze([scope]) }]);
}

function readAnnotations() {
  return Object.freeze({
    readOnlyHint: true,
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint: false,
  });
}

function writeAnnotations(destructiveHint) {
  return Object.freeze({
    readOnlyHint: false,
    destructiveHint,
    idempotentHint: false,
    openWorldHint: false,
  });
}

function projectDocumentToolDefinitions(config) {
  if (!config || typeof config.readScope !== "string" || typeof config.writeScope !== "string") {
    throw new Error("Pocket project documents MCP config invalid.");
  }
  return Object.freeze([
    Object.freeze({
      name: "list_project_documents",
      title: "List Pocket project documents",
      description: "List stable Pocket project-document names with revision and updated timestamp.",
      inputSchema: inputObject({}),
      outputSchema: Object.freeze({
        type: "object",
        additionalProperties: false,
        properties: Object.freeze({
          documents: Object.freeze({ type: "array", items: DOCUMENT_METADATA_OUTPUT }),
        }),
        required: Object.freeze(["documents"]),
      }),
      annotations: readAnnotations(),
      securitySchemes: oauthScheme(config.readScope),
    }),
    Object.freeze({
      name: "read_project_document",
      title: "Read Pocket project document",
      description: "Read one Pocket project document by its stable machine name.",
      inputSchema: inputObject({ name: NAME_JSON_SCHEMA }, ["name"]),
      outputSchema: Object.freeze({
        type: "object",
        additionalProperties: false,
        properties: Object.freeze({ document: DOCUMENT_OUTPUT }),
        required: Object.freeze(["document"]),
      }),
      annotations: readAnnotations(),
      securitySchemes: oauthScheme(config.readScope),
    }),
    Object.freeze({
      name: "create_project_document",
      title: "Create Pocket project document",
      description: "Create a new Pocket project document at revision 1. Existing names fail closed.",
      inputSchema: inputObject({ name: NAME_JSON_SCHEMA, content: CONTENT_JSON_SCHEMA }, ["name", "content"]),
      outputSchema: Object.freeze({
        type: "object",
        additionalProperties: false,
        properties: Object.freeze({ document: DOCUMENT_OUTPUT }),
        required: Object.freeze(["document"]),
      }),
      annotations: writeAnnotations(false),
      securitySchemes: oauthScheme(config.writeScope),
    }),
    Object.freeze({
      name: "update_project_document",
      title: "Update Pocket project document",
      description: "Replace one Pocket project document only when expected_revision exactly matches.",
      inputSchema: inputObject({
        name: NAME_JSON_SCHEMA,
        expected_revision: REVISION_JSON_SCHEMA,
        content: CONTENT_JSON_SCHEMA,
      }, ["name", "expected_revision", "content"]),
      outputSchema: Object.freeze({
        type: "object",
        additionalProperties: false,
        properties: Object.freeze({ document: DOCUMENT_OUTPUT }),
        required: Object.freeze(["document"]),
      }),
      annotations: writeAnnotations(true),
      securitySchemes: oauthScheme(config.writeScope),
    }),
  ]);
}

function challenge(config, scope, error = "insufficient_scope", description = "Required OAuth scope is missing") {
  const safeDescription = String(description).replace(/[\r\n"\\]/g, " ").slice(0, 160);
  return `Bearer resource_metadata="${config.resourceMetadataUrl}", scope="${scope}", error="${error}", error_description="${safeDescription}"`;
}

function errorResult(message, meta = null) {
  const result = {
    content: [{ type: "text", text: String(message).slice(0, 400) }],
    isError: true,
  };
  if (meta) result._meta = meta;
  return result;
}

function successResult(structuredContent) {
  return Object.freeze({
    content: Object.freeze([{ type: "text", text: JSON.stringify(structuredContent) }]),
    structuredContent: Object.freeze(structuredContent),
  });
}

function externalDocument(document) {
  return Object.freeze({
    name: document.name,
    content: document.content,
    revision: document.revision,
    updated_at: document.updatedAt,
  });
}

function externalMetadata(document) {
  return Object.freeze({
    name: document.name,
    revision: document.revision,
    updated_at: document.updatedAt,
  });
}

function parseToolInput(name, value) {
  const schema = INPUT_SCHEMAS[name];
  if (!schema) throw new McpError(ErrorCode.MethodNotFound, "Unknown Pocket project document tool.");
  const parsed = schema.safeParse(value ?? {});
  if (!parsed.success) throw new McpError(ErrorCode.InvalidParams, "Invalid Pocket project document tool arguments.");
  return parsed.data;
}

function createProjectDocumentsMcpServer(input) {
  if (!input || typeof input !== "object" || Array.isArray(input)
      || Object.keys(input).length !== 3
      || !Object.hasOwn(input, "store") || !Object.hasOwn(input, "authInfo") || !Object.hasOwn(input, "config")
      || !input.store || ["list", "read", "create", "update"].some((name) => typeof input.store[name] !== "function")
      || !input.authInfo || !Array.isArray(input.authInfo.scopes)
      || !input.config || typeof input.config.readScope !== "string" || typeof input.config.writeScope !== "string"
      || typeof input.config.resourceMetadataUrl !== "string") {
    throw new Error("Pocket project documents MCP input invalid.");
  }

  const definitions = projectDocumentToolDefinitions(input.config);
  const server = new Server(
    { name: "pocket-project-documents", version: "1.0.0" },
    { capabilities: { tools: {} } }
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: definitions,
  }));

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const toolName = request.params.name;
    if (!TOOL_NAMES.includes(toolName)) {
      throw new McpError(ErrorCode.MethodNotFound, "Unknown Pocket project document tool.");
    }
    const requiredScope = ["list_project_documents", "read_project_document"].includes(toolName)
      ? input.config.readScope : input.config.writeScope;
    if (!hasScope(input.authInfo, requiredScope)) {
      return errorResult("Authentication required for this Pocket project document action.", {
        "mcp/www_authenticate": [challenge(input.config, requiredScope)],
      });
    }

    const args = parseToolInput(toolName, request.params.arguments);
    if (toolName === "list_project_documents") {
      const documents = await input.store.list();
      return successResult({ documents: documents.map(externalMetadata) });
    }
    if (toolName === "read_project_document") {
      const result = await input.store.read(args.name);
      if (!result?.ok) return errorResult("Pocket project document not found.");
      return successResult({ document: externalDocument(result.document) });
    }
    if (toolName === "create_project_document") {
      const result = await input.store.create(args.name, args.content);
      if (!result?.ok && result?.reason === "already-exists") {
        return errorResult("Pocket project document already exists.");
      }
      if (!result?.ok) return errorResult("Pocket project document could not be created.");
      return successResult({ document: externalDocument(result.document) });
    }

    const result = await input.store.update(args.name, args.expected_revision, args.content);
    if (!result?.ok && result?.reason === "not-found") {
      return errorResult("Pocket project document not found.");
    }
    if (!result?.ok && result?.reason === "revision-conflict") {
      return errorResult(`Pocket project document revision conflict. Current revision is ${result.currentRevision}.`);
    }
    if (!result?.ok) return errorResult("Pocket project document could not be updated.");
    return successResult({ document: externalDocument(result.document) });
  });

  return server;
}

module.exports = Object.freeze({
  INPUT_SCHEMAS,
  TOOL_NAMES,
  challenge,
  createProjectDocumentsMcpServer,
  projectDocumentToolDefinitions,
});
