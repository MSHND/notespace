"use strict";

const http = require("node:http");
const path = require("node:path");
const { createProductionServerConfig } = require("./pocket-sync-server-config.js");
const { createSyncServerApplication } = require("./pocket-sync-server-runtime.js");
const { createPrivateAlphaGate } = require("./pocket-sync-private-alpha-gate.js");
const { createReviewedStaticHandler } = require("./pocket-sync-static-assets.js");

const BROWSER_ROOT = path.resolve(__dirname, "..");
const LOCAL_MODULE_PATH = "/js/pocket-sync-local-integration.js";
const ADDITIONAL_MODULE_PATH = "/js/pocket-sync-additional-device.js";
const RECOVERY_MODULE_PATH = "/js/pocket-sync-emergency-recovery.js";
const PRODUCTION_BOOTSTRAP_PATH = "/js/pocket-sync-production-bootstrap.js";
const PRODUCTION_MODULE_TAG = `<script src="${ADDITIONAL_MODULE_PATH}"></script>\n  <script src="${RECOVERY_MODULE_PATH}"></script>\n  <script src="${LOCAL_MODULE_PATH}" data-service-root="%SERVICE_ROOT%"></script>\n  <script src="${PRODUCTION_BOOTSTRAP_PATH}"></script>`;

function productionError() {
  const error = new Error("Pocket Sync production composition failed.");
  error.code = "sync-production-composition-failed";
  return error;
}

function injectedIndex(index, serviceRoot) {
  if (typeof index !== "string" || !index.includes("</body>")) throw productionError();
  return index.replace("</body>", `  ${PRODUCTION_MODULE_TAG.replace("%SERVICE_ROOT%", serviceRoot)}\n</body>`);
}

function isApiPath(request, serviceRoot) {
  if (!request || typeof request.url !== "string" || !request.url.startsWith("/") || request.url.startsWith("//")) return false;
  let parsed;
  try { parsed = new URL(request?.url, "https://pocket.invalid"); } catch (_error) { return false; }
  return parsed.pathname === serviceRoot || parsed.pathname.startsWith(`${serviceRoot}/`);
}

function createProductionIntegrationHandler(input) {
  if (!input || typeof input !== "object" || Array.isArray(input)
      || Object.keys(input).length !== 3
      || typeof input.browserRoot !== "string" || typeof input.serviceRoot !== "string"
      || !input.application || typeof input.application.handle !== "function") {
    throw productionError();
  }
  const serveStatic = createReviewedStaticHandler({
    browserRoot: input.browserRoot,
    additionalAssets: [
      LOCAL_MODULE_PATH, ADDITIONAL_MODULE_PATH, RECOVERY_MODULE_PATH, PRODUCTION_BOOTSTRAP_PATH,
    ],
    transformIndex(index) { return injectedIndex(index, input.serviceRoot); },
  });
  return async function handle(request, response) {
    if (isApiPath(request, input.serviceRoot)) return input.application.handle(request, response);
    return serveStatic(request, response);
  };
}

function createProductionServer(input) {
  const fields = Object.keys(input || {});
  if (!input || typeof input !== "object" || Array.isArray(input)
      || fields.some((key) => !["application", "browserRoot", "serviceRoot", "listen", "http", "privateAlpha"].includes(key))
      || !["application", "browserRoot", "serviceRoot", "listen", "privateAlpha"].every((field) => Object.hasOwn(input, field))
      || !input.application || typeof input.application.handle !== "function"
      || typeof input.application.preflight !== "function" || typeof input.application.close !== "function"
      || typeof input.browserRoot !== "string" || typeof input.serviceRoot !== "string"
      || !input.listen || typeof input.listen !== "object"
      || input.listen.host !== "0.0.0.0" || !Number.isSafeInteger(input.listen.port)
      || input.listen.port < 1 || input.listen.port > 65535
      || (input.http !== undefined && (!input.http || typeof input.http.createServer !== "function"))
      || !input.privateAlpha || typeof input.privateAlpha !== "object" || Array.isArray(input.privateAlpha)
      || Object.keys(input.privateAlpha).length !== 2
      || !Object.hasOwn(input.privateAlpha, "accessSecret") || !Object.hasOwn(input.privateAlpha, "trustedOrigin")) {
    throw productionError();
  }
  const integrationHandler = createProductionIntegrationHandler({
    application: input.application, browserRoot: input.browserRoot, serviceRoot: input.serviceRoot,
  });
  const handler = createPrivateAlphaGate({
    accessSecret: input.privateAlpha.accessSecret,
    trustedOrigin: input.privateAlpha.trustedOrigin,
    serviceRoot: input.serviceRoot,
    handler: integrationHandler,
  });
  const server = (input.http || http).createServer(handler);
  if (!server || typeof server.listen !== "function" || typeof server.close !== "function") throw productionError();
  let started = false;
  let serverMayBeOpen = false;
  let closing = null;
  async function listen() {
    if (started || closing) throw productionError();
    await input.application.preflight();
    try {
      await new Promise((resolve, reject) => {
        const failed = () => { server.off("error", failed); reject(productionError()); };
        server.once("error", failed);
        serverMayBeOpen = true;
        server.listen(input.listen.port, input.listen.host, () => {
          server.off("error", failed);
          resolve();
        });
      });
    } catch (error) {
      await close();
      throw error;
    }
    started = true;
  }
  function closeServer() {
    if (!serverMayBeOpen) return Promise.resolve();
    return new Promise((resolve) => {
      try { server.close(() => resolve()); } catch (_error) { resolve(); }
    });
  }
  function close() {
    if (closing) return closing;
    closing = (async () => {
      await closeServer();
      started = false;
      serverMayBeOpen = false;
      await input.application.close();
    })();
    return closing;
  }
  return Object.freeze({ listen, close, handler });
}

async function startProductionServer() {
  const config = createProductionServerConfig({ environment: process.env });
  const application = createSyncServerApplication(config.runtime);
  const server = createProductionServer({
    application, browserRoot: BROWSER_ROOT, serviceRoot: config.runtime.serviceRoot, listen: config.listen,
    privateAlpha: Object.freeze({
      accessSecret: config.productionShell.alphaAccessSecret,
      trustedOrigin: config.runtime.trustedOrigin,
    }),
  });
  try {
    await server.listen();
  } catch (error) {
    await server.close();
    throw error;
  }
  const stop = () => { server.close().catch(() => { process.exitCode = 1; }); };
  process.once("SIGINT", stop);
  process.once("SIGTERM", stop);
  return server;
}

if (require.main === module) startProductionServer().catch(() => { process.exitCode = 1; });

module.exports = Object.freeze({ createProductionIntegrationHandler, createProductionServer, startProductionServer });
