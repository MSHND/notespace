"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { createHash } = require("node:crypto");

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

function referencedBrowserAssets(index, worker, additionalAssets = []) {
  const assets = new Set(["/index.html", "/sw.js"]);
  const add = (candidate, strict = false) => {
    if (typeof candidate !== "string" || candidate.includes("://") || candidate.startsWith("//")) {
      if (strict) throw staticError();
      return;
    }
    const item = browserPath(`/${candidate.replace(/^\.\//, "").replace(/^\//, "")}`);
    if (!item || item === "/") {
      if (strict) throw staticError();
      return;
    }
    assets.add(item);
  };
  for (const source of [index, worker]) {
    const matches = source.matchAll(/["']((?:\.\/)?(?:js|icons|assets)\/[A-Za-z0-9._/-]+\.(?:js|css|png|svg|webp|ico)|(?:\.\/)?[A-Za-z0-9._-]+\.(?:css|json|png|svg|webp|ico))["']/g);
    for (const match of matches) add(match[1]);
  }
  for (const asset of additionalAssets) add(asset, true);
  return Object.freeze([...assets].sort());
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

function validateInput(input) {
  if (!input || typeof input !== "object" || Array.isArray(input)
      || Object.keys(input).some((key) => !["browserRoot", "additionalAssets", "transformIndex"].includes(key))
      || typeof input.browserRoot !== "string"
      || (input.additionalAssets !== undefined && !Array.isArray(input.additionalAssets))
      || (input.transformIndex !== undefined && typeof input.transformIndex !== "function")) {
    throw staticError();
  }
}

function createReviewedStaticBundle(input) {
  validateInput(input);
  let root;
  try { root = fs.realpathSync(path.resolve(input.browserRoot)); } catch (_error) { throw staticError(); }
  const rootPrefix = `${root}${path.sep}`;
  const transformIndex = input.transformIndex || ((value) => value);
  const load = (asset) => {
    const type = contentType(asset);
    const filename = path.resolve(root, `.${asset}`);
    if (!type || !filename.startsWith(rootPrefix)) throw staticError();
    let real;
    let body;
    try {
      real = fs.realpathSync(filename);
      if (!real.startsWith(rootPrefix)) throw staticError();
      body = fs.readFileSync(real);
    } catch (_error) {
      throw staticError();
    }
    return Object.freeze({ type, body });
  };

  const decode = (body) => {
    try { return new TextDecoder("utf-8", { fatal: true }).decode(body); }
    catch (_error) { throw staticError(); }
  };
  const indexSource = decode(load("/index.html").body);
  const workerSource = decode(load("/sw.js").body);
  const assets = referencedBrowserAssets(indexSource, workerSource, input.additionalAssets || []);
  const bodies = new Map();
  const manifest = [];
  for (const asset of assets) {
    const loaded = load(asset);
    let body = loaded.body;
    if (asset === "/index.html") {
      const transformed = transformIndex(indexSource);
      if (typeof transformed !== "string") throw staticError();
      body = Buffer.from(transformed, "utf8");
    }
    bodies.set(asset, Object.freeze({ type: loaded.type, body }));
    manifest.push(Object.freeze({
      path: asset,
      bytes: body.byteLength,
      sha256: createHash("sha256").update(body).digest("hex"),
    }));
  }
  const frozenManifest = Object.freeze(manifest);

  const handler = Object.freeze(async function serveStatic(request, response) {
    if (request.method !== "GET" && request.method !== "HEAD") return safeResponse(response, 405);
    const pathname = staticRequestPath(request);
    const target = pathname === "/" ? "/index.html" : pathname;
    const asset = target ? bodies.get(target) : null;
    if (!asset) return safeResponse(response, 404);
    response.statusCode = 200;
    response.setHeader("Content-Type", asset.type);
    response.setHeader("Cache-Control", "no-store");
    response.setHeader("X-Content-Type-Options", "nosniff");
    response.setHeader("Content-Length", asset.body.byteLength);
    if (request.method === "HEAD") return response.end();
    return response.end(asset.body);
  });
  return Object.freeze({ handler, manifest: frozenManifest });
}

function createReviewedStaticHandler(input) {
  return createReviewedStaticBundle(input).handler;
}

function createReviewedStaticManifest(input) {
  return createReviewedStaticBundle(input).manifest;
}

module.exports = Object.freeze({ createReviewedStaticHandler, createReviewedStaticManifest });
