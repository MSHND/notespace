"use strict";

const { Pool } = require("pg");
const { createProjectDocumentsApplication } = require("./pocket-project-documents-application.js");
const { createProjectDocumentsJwtTokenVerifier } = require("./pocket-project-documents-auth.js");
const { verifyPocketProjectDocumentsSchema } = require("./pocket-project-documents-postgres-schema.js");
const { createProjectDocumentsPostgresStore } = require("./pocket-project-documents-postgres-store.js");

function runtimeError() {
  const error = new Error("Pocket project documents runtime failed.");
  error.code = "project-documents-runtime-failed";
  return error;
}

function createProjectDocumentsRuntime(input) {
  if (!input || typeof input !== "object" || Array.isArray(input)
      || Object.keys(input).length !== 2
      || !input.config || typeof input.config !== "object"
      || !input.postgres || typeof input.postgres.connectionString !== "string"
      || input.postgres.connectionString.length < 1
      || input.postgres.connectionString !== input.postgres.connectionString.trim()) {
    throw runtimeError();
  }

  const pool = new Pool({ connectionString: input.postgres.connectionString });
  if (!pool || typeof pool.query !== "function" || typeof pool.end !== "function") throw runtimeError();
  const store = createProjectDocumentsPostgresStore({ pool });
  const tokenVerifier = createProjectDocumentsJwtTokenVerifier(input.config);
  const application = createProjectDocumentsApplication({
    config: input.config,
    store,
    tokenVerifier,
  });

  async function preflight() {
    try {
      await pool.query("SELECT 1");
      await verifyPocketProjectDocumentsSchema(pool);
      return true;
    } catch (_error) {
      throw runtimeError();
    }
  }

  let shutdown = null;
  function close() {
    if (shutdown) return shutdown;
    shutdown = (async () => {
      try { await pool.end(); } catch (_error) { throw runtimeError(); }
    })();
    return shutdown;
  }

  return Object.freeze({
    handle: application.handle,
    matches: application.matches,
    metadataPath: application.metadataPath,
    mcpRoot: application.mcpRoot,
    preflight,
    close,
  });
}

module.exports = Object.freeze({
  createProjectDocumentsRuntime,
});
