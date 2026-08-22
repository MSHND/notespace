"use strict";

const fs = require("node:fs");
const path = require("node:path");

function staticError() {
  const error = new Error("Pocket Sync static asset boundary failed.");
  error.code = "sync-static-assets-failed";
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

function referencedBrowserAssets(browserRoot, additionalAssets = []) {
  let index;
  let worker = "";
  try {
    index = fs.readFileSync(path.join(browserRoot, "index.html"), "utf8");
    worker = fs.readFileSync(path.join(browserRoot, "sw.js"), "utf8");
  } catch (_error) {
    throw staticError();
  }
  const assets = new Set(["/index.html", "/sw.js"]);
  const add = (candidate) => {
    if (typeof candidate !== "string" || candidate.includes("://") || candidate.startsWith("//")) return;
    const item = browserPath(`/${candidate.replace(/^\.\//, "").replace(/^\//, "")}`);
    if (item) assets.add(item);
  };
  for (const source of [index, worker]) {
    const matches = source.matchAll(/["']((?:\.\/)?(?:js|icons|assets)\/[A-Za-z0-9._/-]+\.(?:js|css|png|svg|webp|ico)|(?:\.\/)?[A-Za-z0-9._-]+\.(?:css|json|png|svg|webp|ico))["']/g);
    for (const match of matches) add(match[1]);
  }
  for (const asset of additionalAssets) add(asset);
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

function staticRequestPath(request) {
  if (!request || typeof request.url !== "string" || /[?#]/.test(request.url)) return null;
  return browserPath(request.url);
}

function createReviewedStaticHandler(input) {
  if (!input || typeof input !== "object" || Array.isArray(input)
      || Object.keys(input).some((key) => !["browserRoot", "additionalAssets", "transformIndex"].includes(key))
      || typeof input.browserRoot !== "string"
      || (input.additionalAssets !== undefined && !Array.isArray(input.additionalAssets))
      || (input.transformIndex !== undefined && typeof input.transformIndex !== "function")) {
    throw staticError();
  }
  const root = path.resolve(input.browserRoot);
  const rootPrefix = `${root}${path.sep}`;
  const browser = referencedBrowserAssets(root, input.additionalAssets || []);
  const transformIndex = input.transformIndex || ((value) => value);

  return async function serveStatic(request, response) {
    if (request.method !== "GET" && request.method !== "HEAD") return safeResponse(response, 405);
    const pathname = staticRequestPath(request);
    const target = pathname === "/" ? "/index.html" : pathname;
    if (!target || !browser.assets.has(target)) return safeResponse(response, 404);
    const type = contentType(target);
    const filename = path.resolve(root, `.${target}`);
    if (!type || !filename.startsWith(rootPrefix)) return safeResponse(response, 404);
    let body;
    try {
      body = target === "/index.html"
        ? Buffer.from(transformIndex(browser.index), "utf8")
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
  };
}

module.exports = Object.freeze({ createReviewedStaticHandler });
