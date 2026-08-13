"use strict";

const fs = require("node:fs");
const https = require("node:https");
const path = require("node:path");
const { createLocalServerConfig } = require("./pocket-sync-server-config.js");
const { createSyncServerApplication } = require("./pocket-sync-server-runtime.js");

const BROWSER_ROOT = path.resolve(__dirname, "..");
const LOCAL_MODULE_PATH = "/js/pocket-sync-local-integration.js";
const ADDITIONAL_MODULE_PATH = "/js/pocket-sync-additional-device.js";
const LOCAL_MODULE_TAG = `<script src="${ADDITIONAL_MODULE_PATH}"></script>\n  <script src="${LOCAL_MODULE_PATH}" data-service-root="%SERVICE_ROOT%"></script>`;

function localError() {
  const error = new Error("Pocket Sync local integration failed.");
  error.code = "sync-local-integration-failed";
  return error;
}

function safeResponse(response, status) {
  response.statusCode = status;
  response.setHeader("Cache-Control", "no-store");
  response.setHeader("X-Content-Type-Options", "nosniff");
  response.end();
}

function browserPath(value) {
  if (typeof value !== "string" || !value.startsWith("/") || value.includes("\\")
      || value.includes("\u0000") || /%(?:2e|5c|00)/i.test(value)) return null;
  let decoded;
  try { decoded = decodeURIComponent(value); } catch (_error) { return null; }
  if (decoded.includes("\\") || decoded.includes("\u0000")
      || decoded.split("/").some((part) => part === "." || part === "..")) return null;
  return decoded;
}

function referencedBrowserAssets(browserRoot) {
  let index;
  let worker = "";
  try {
    index = fs.readFileSync(path.join(browserRoot, "index.html"), "utf8");
    worker = fs.readFileSync(path.join(browserRoot, "sw.js"), "utf8");
  } catch (_error) {
    throw localError();
  }
  const assets = new Set(["/index.html", "/sw.js", LOCAL_MODULE_PATH, ADDITIONAL_MODULE_PATH]);
  const add = (candidate) => {
    if (typeof candidate !== "string" || candidate.includes("://") || candidate.startsWith("//")) return;
    const item = browserPath(`/${candidate.replace(/^\.\//, "").replace(/^\//, "")}`);
    if (item) assets.add(item);
  };
  for (const source of [index, worker]) {
    const matches = source.matchAll(/["']((?:\.\/)?(?:js|icons|assets)\/[A-Za-z0-9._/-]+\.(?:js|css|png|svg|webp|ico)|(?:\.\/)?[A-Za-z0-9._-]+\.(?:css|json|png|svg|webp|ico))["']/g);
    for (const match of matches) add(match[1]);
  }
  return Object.freeze({ index, assets: Object.freeze(assets) });
}

function contentType(file) {
  if (file.endsWith(".html")) return "text/html; charset=utf-8";
  if (file.endsWith(".css")) return "text/css; charset=utf-8";
  if (file.endsWith(".js")) return "text/javascript; charset=utf-8";
  if (file.endsWith(".json")) return "application/json; charset=utf-8";
  if (file.endsWith(".svg")) return "image/svg+xml";
  if (file.endsWith(".png")) return "image/png";
  if (file.endsWith(".webp")) return "image/webp";
  if (file.endsWith(".ico")) return "image/x-icon";
  return null;
}

function injectedIndex(index, serviceRoot) {
  const tag = LOCAL_MODULE_TAG.replace("%SERVICE_ROOT%", serviceRoot);
  if (!index.includes("</body>")) throw localError();
  return index.replace("</body>", `  ${tag}\n</body>`);
}

function staticRequestPath(request) {
  if (!request || typeof request.url !== "string") return null;
  const rawPath = request.url.split(/[?#]/, 1)[0];
  if (!rawPath.startsWith("/")) return null;
  return browserPath(rawPath);
}

function isApiPath(request, serviceRoot) {
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
  const root = path.resolve(input.browserRoot);
  const rootPrefix = `${root}${path.sep}`;
  const browser = referencedBrowserAssets(root);

  async function serveStatic(request, response) {
    if (request.method !== "GET" && request.method !== "HEAD") return safeResponse(response, 405);
    let pathname = staticRequestPath(request);
    if (pathname === "/") pathname = "/index.html";
    if (!pathname || !browser.assets.has(pathname)) return safeResponse(response, 404);
    const type = contentType(pathname);
    const filename = path.resolve(root, `.${pathname}`);
    if (!type || !filename.startsWith(rootPrefix)) return safeResponse(response, 404);
    let body;
    try {
      body = pathname === "/index.html"
        ? Buffer.from(injectedIndex(browser.index, input.serviceRoot), "utf8")
        : fs.readFileSync(filename);
    } catch (_error) {
      return safeResponse(response, 404);
    }
    response.statusCode = 200;
    response.setHeader("Content-Type", type);
    response.setHeader("Cache-Control", "no-store");
    response.setHeader("X-Content-Type-Options", "nosniff");
    response.setHeader("Content-Length", body.byteLength);
    if (request.method === "HEAD") return response.end();
    return response.end(body);
  }

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
  const server = https.createServer(config.runtime.tls, handler);
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
