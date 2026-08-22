"use strict";

const fs = require("node:fs");
const https = require("node:https");
const path = require("node:path");
const { createLocalServerConfig } = require("./pocket-sync-server-config.js");
const { createSyncServerApplication, validateSyncServerTls } = require("./pocket-sync-server-runtime.js");
const { createReviewedStaticHandler } = require("./pocket-sync-static-assets.js");

const BROWSER_ROOT = path.resolve(__dirname, "..");
const LOCAL_MODULE_PATH = "/js/pocket-sync-local-integration.js";
const ADDITIONAL_MODULE_PATH = "/js/pocket-sync-additional-device.js";
const RECOVERY_MODULE_PATH = "/js/pocket-sync-emergency-recovery.js";
const LOCAL_MODULE_TAG = `<script src="${ADDITIONAL_MODULE_PATH}"></script>\n  <script src="${RECOVERY_MODULE_PATH}"></script>\n  <script src="${LOCAL_MODULE_PATH}" data-service-root="%SERVICE_ROOT%"></script>\n  <script>window.PocketSyncLocalIntegration.create();</script>`;

function localError() {
  const error = new Error("Pocket Sync local integration failed.");
  error.code = "sync-local-integration-failed";
  return error;
}

function injectedIndex(index, serviceRoot) {
  const tag = LOCAL_MODULE_TAG.replace("%SERVICE_ROOT%", serviceRoot);
  if (!index.includes("</body>")) throw localError();
  return index.replace("</body>", `  ${tag}\n</body>`);
}

function isApiPath(request, serviceRoot) {
  if (!request || typeof request.url !== "string" || !request.url.startsWith("/") || request.url.startsWith("//")) return false;
  let parsed;
  try { parsed = new URL(request.url, "https://local.invalid"); } catch (_error) { return false; }
  return parsed.pathname === serviceRoot || parsed.pathname.startsWith(`${serviceRoot}/`);
}

function createLocalIntegrationHandler(input) {
  if (!input || typeof input !== "object" || Array.isArray(input)
      || Object.keys(input).length !== 3
      || typeof input.browserRoot !== "string" || typeof input.serviceRoot !== "string"
      || !input.application || typeof input.application.handle !== "function") {
    throw localError();
  }
  const serveStatic = createReviewedStaticHandler({
    browserRoot: input.browserRoot,
    additionalAssets: [LOCAL_MODULE_PATH, ADDITIONAL_MODULE_PATH, RECOVERY_MODULE_PATH],
    transformIndex(index) { return injectedIndex(index, input.serviceRoot); },
  });

  return async function handle(request, response) {
    if (isApiPath(request, input.serviceRoot)) return input.application.handle(request, response);
    return serveStatic(request, response);
  };
}

async function startLocalIntegrationServer() {
  const config = createLocalServerConfig({ environment: process.env, readFile: fs.readFileSync });
  const application = createSyncServerApplication(config.runtime);
  const handler = createLocalIntegrationHandler({
    application,
    browserRoot: BROWSER_ROOT,
    serviceRoot: config.runtime.serviceRoot,
  });
  const server = https.createServer(validateSyncServerTls(config.tls), handler);
  if (!server || typeof server.listen !== "function" || typeof server.close !== "function") throw localError();
  try {
    await application.preflight();
    await new Promise((resolve, reject) => {
      const failed = () => { server.off("error", failed); reject(localError()); };
      server.once("error", failed);
      server.listen(config.listen.port, config.listen.host, () => {
        server.off("error", failed);
        resolve();
      });
    });
  } catch (error) {
    await application.close();
    throw error;
  }
  let closing = null;
  const close = () => {
    if (closing) return closing;
    closing = (async () => {
      await new Promise((resolve) => {
        try { server.close(() => resolve()); } catch (_error) { resolve(); }
      });
      await application.close();
    })();
    return closing;
  };
  const stop = () => { close().catch(() => { process.exitCode = 1; }); };
  process.once("SIGINT", stop);
  process.once("SIGTERM", stop);
  return Object.freeze({ close });
}

if (require.main === module) {
  startLocalIntegrationServer().catch(() => { process.exitCode = 1; });
}

module.exports = Object.freeze({ createLocalIntegrationHandler, startLocalIntegrationServer });
