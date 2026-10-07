"use strict";

const CONFIG_ENV = Object.freeze([
  "POCKET_PROJECT_DOCS_MCP_ROOT",
  "POCKET_PROJECT_DOCS_RESOURCE_URL",
  "POCKET_PROJECT_DOCS_OAUTH_ISSUER",
  "POCKET_PROJECT_DOCS_OAUTH_AUDIENCE",
  "POCKET_PROJECT_DOCS_OAUTH_JWKS_URL",
  "POCKET_PROJECT_DOCS_OAUTH_READ_SCOPE",
  "POCKET_PROJECT_DOCS_OAUTH_WRITE_SCOPE",
]);

function projectDocumentsConfigError() {
  const error = new Error("Pocket project documents configuration is invalid.");
  error.code = "project-documents-config-invalid";
  return error;
}

function isObject(value) {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function validateRoot(value) {
  if (typeof value !== "string" || value.length < 2 || value !== value.trim()
      || !value.startsWith("/") || value.startsWith("//") || value.includes("//")
      || value.endsWith("/") || /[:?#\\@%]/.test(value)
      || value.split("/").some((segment, index) => index > 0 && ["", ".", ".."].includes(segment))) {
    throw projectDocumentsConfigError();
  }
  return value;
}

function httpsUrl(value) {
  let parsed;
  try { parsed = new URL(value); } catch (_error) { throw projectDocumentsConfigError(); }
  if (typeof value !== "string" || value !== value.trim() || parsed.protocol !== "https:"
      || parsed.username || parsed.password || parsed.hash || parsed.search
      || parsed.origin === "null") {
    throw projectDocumentsConfigError();
  }
  return parsed;
}

function scope(value) {
  if (typeof value !== "string" || value.length < 1 || value.length > 160
      || value !== value.trim() || /\s/.test(value)) throw projectDocumentsConfigError();
  return value;
}

function required(environment, key) {
  const value = environment[key];
  if (typeof value !== "string" || value.length < 1 || value !== value.trim()) {
    throw projectDocumentsConfigError();
  }
  return value;
}

function protectedResourceMetadataUrl(resource) {
  return `${resource.origin}/.well-known/oauth-protected-resource${resource.pathname}`;
}

function createProjectDocumentsConfig(input) {
  if (!isObject(input) || Object.keys(input).length !== 1 || !Object.hasOwn(input, "environment")
      || !isObject(input.environment)) throw projectDocumentsConfigError();
  const environment = input.environment;
  const supplied = CONFIG_ENV.filter((name) => environment[name] !== undefined);
  if (supplied.length === 0) return null;
  if (supplied.length !== CONFIG_ENV.length) throw projectDocumentsConfigError();

  const mcpRoot = validateRoot(required(environment, "POCKET_PROJECT_DOCS_MCP_ROOT"));
  const resource = httpsUrl(required(environment, "POCKET_PROJECT_DOCS_RESOURCE_URL"));
  if (resource.pathname !== mcpRoot) throw projectDocumentsConfigError();

  const issuer = httpsUrl(required(environment, "POCKET_PROJECT_DOCS_OAUTH_ISSUER"));
  const jwks = httpsUrl(required(environment, "POCKET_PROJECT_DOCS_OAUTH_JWKS_URL"));
  const audience = required(environment, "POCKET_PROJECT_DOCS_OAUTH_AUDIENCE");
  if (audience.length > 512 || /\s/.test(audience)) throw projectDocumentsConfigError();

  const readScope = scope(required(environment, "POCKET_PROJECT_DOCS_OAUTH_READ_SCOPE"));
  const writeScope = scope(required(environment, "POCKET_PROJECT_DOCS_OAUTH_WRITE_SCOPE"));
  if (readScope === writeScope) throw projectDocumentsConfigError();

  return Object.freeze({
    mcpRoot,
    resourceUrl: resource.href,
    resourceMetadataUrl: protectedResourceMetadataUrl(resource),
    issuer: issuer.href.replace(/\/$/, ""),
    audience,
    jwksUrl: jwks.href,
    readScope,
    writeScope,
  });
}

module.exports = Object.freeze({
  CONFIG_ENV,
  createProjectDocumentsConfig,
  projectDocumentsConfigError,
  protectedResourceMetadataUrl,
});
