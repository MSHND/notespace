"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { Readable } = require("node:stream");
const { spawnSync } = require("node:child_process");

const {
  createProductionIntegrationHandler,
  createProductionReleaseManifest,
  createProductionServer,
} = require("../sync-service/pocket-sync-production-server.js");
const {
  PRIVATE_ALPHA_CSP,
  PRODUCTION_CSP,
  createProductionSecurityPolicy,
} = require("../sync-service/pocket-sync-production-security-policy.js");
const {
  createReviewedStaticHandler,
  createReviewedStaticManifest,
} = require("../sync-service/pocket-sync-static-assets.js");

const ROOT = path.resolve(__dirname, "..");
const ORIGIN = "https://pocket.murrayhenderson.com.au";
const SERVICE_ROOT = "/pocket-sync/v1";
const TEST_SECRET = "test-only-private-alpha-code-0123456789";

function response() {
  return {
    statusCode: 0,
    headers: {},
    body: null,
    setHeader(name, value) { this.headers[String(name).toLowerCase()] = value; },
    end(value) { this.body = value === undefined ? null : Buffer.from(value); },
  };
}

function request(method, url, options = {}) {
  const body = options.body === undefined ? Buffer.alloc(0) : Buffer.from(options.body, "utf8");
  const stream = Readable.from(body.byteLength > 0 ? [body] : []);
  stream.method = method;
  stream.url = url;
  stream.headers = {};
  stream.rawHeaders = [];
  for (const [name, value] of Object.entries(options.headers || {})) {
    stream.headers[name.toLowerCase()] = value;
    stream.rawHeaders.push(name, value);
  }
  if (options.body !== undefined && stream.headers["content-length"] === undefined) {
    stream.headers["content-length"] = String(body.byteLength);
    stream.rawHeaders.push("Content-Length", String(body.byteLength));
  }
  return stream;
}

async function send(handler, input) {
  const result = response();
  await handler(input, result);
  return result;
}

function assertCommonHeaders(result, csp = PRODUCTION_CSP) {
  assert.equal(result.headers["strict-transport-security"], "max-age=31536000");
  assert.doesNotMatch(result.headers["strict-transport-security"], /includeSubDomains|preload/i);
  assert.equal(result.headers["x-content-type-options"], "nosniff");
  assert.equal(result.headers["referrer-policy"], "same-origin");
  assert.equal(result.headers["x-frame-options"], "DENY");
  assert.equal(result.headers["cross-origin-opener-policy"], "same-origin");
  assert.equal(result.headers["cross-origin-resource-policy"], "same-origin");
  assert.equal(result.headers["permissions-policy"], "camera=(), microphone=(), geolocation=(), payment=(), usb=()");
  assert.doesNotMatch(result.headers["permissions-policy"], /publickey-credentials/i);
  assert.equal(result.headers["content-security-policy"], csp);
}

function productionHarness() {
  const application = {
    async handle(input, result) {
      result.statusCode = input.url.endsWith("/error") ? 400 : 204;
      result.end();
    },
    async preflight() {},
    async close() {},
  };
  return createProductionServer({
    application,
    browserRoot: ROOT,
    serviceRoot: SERVICE_ROOT,
    listen: { host: "0.0.0.0", port: 3000 },
    privateAlpha: { accessSecret: TEST_SECRET, trustedOrigin: ORIGIN },
    http: { createServer() { return { listen() {}, close(callback) { callback(); } }; } },
  }).handler;
}

async function admissionCookie(handler) {
  const body = `accessCode=${encodeURIComponent(TEST_SECRET)}`;
  const accepted = await send(handler, request("POST", "/pocket-alpha/access", {
    body,
    headers: { Origin: ORIGIN, "Content-Type": "application/x-www-form-urlencoded" },
  }));
  assert.equal(accepted.statusCode, 303);
  assertCommonHeaders(accepted);
  return String(accepted.headers["set-cookie"]).split(";", 1)[0];
}

test("P076 applies one minimum production policy to every representative response class", async () => {
  const handler = productionHarness();
  const alpha = await send(handler, request("GET", "/pocket-alpha"));
  assert.equal(alpha.statusCode, 200);
  assertCommonHeaders(alpha, PRIVATE_ALPHA_CSP);
  assert.equal(PRIVATE_ALPHA_CSP.includes("default-src 'none'"), true);

  const redirect = await send(handler, request("GET", "/"));
  assert.equal(redirect.statusCode, 303);
  assertCommonHeaders(redirect);

  const wrongBody = "accessCode=wrong-test-only-private-alpha-code-012345";
  const denial = await send(handler, request("POST", "/pocket-alpha/access", {
    body: wrongBody,
    headers: { Origin: ORIGIN, "Content-Type": "application/x-www-form-urlencoded" },
  }));
  assert.equal(denial.statusCode, 403);
  assertCommonHeaders(denial, PRIVATE_ALPHA_CSP);

  const cookie = await admissionCookie(handler);
  const admitted = { headers: { Cookie: cookie } };
  const cases = [
    ["Pocket HTML", request("GET", "/", admitted), 200],
    ["static asset", request("GET", "/styles.css", admitted), 200],
    ["API success", request("POST", `${SERVICE_ROOT}/success`, admitted), 204],
    ["API error", request("POST", `${SERVICE_ROOT}/error`, admitted), 400],
    ["production 404", request("GET", "/package.json", admitted), 404],
    ["production 405", request("POST", "/", admitted), 405],
  ];
  for (const [label, input, status] of cases) {
    const result = await send(handler, input);
    assert.equal(result.statusCode, status, label);
    assertCommonHeaders(result);
  }
});

test("P076 CSP permits current same-origin code paths without inline script or passkey denial", async () => {
  assert.match(PRODUCTION_CSP, /(?:^|; )default-src 'none'(?:;|$)/);
  assert.match(PRODUCTION_CSP, /(?:^|; )script-src 'self'(?:;|$)/);
  assert.match(PRODUCTION_CSP, /(?:^|; )connect-src 'self'(?:;|$)/);
  assert.match(PRODUCTION_CSP, /(?:^|; )worker-src 'self'(?:;|$)/);
  assert.match(PRODUCTION_CSP, /(?:^|; )style-src 'self' 'unsafe-inline'(?:;|$)/);
  assert.match(PRODUCTION_CSP, /(?:^|; )img-src 'self'(?:;|$)/);
  assert.match(PRODUCTION_CSP, /(?:^|; )manifest-src 'self'(?:;|$)/);
  assert.doesNotMatch(PRODUCTION_CSP, /script-src[^;]*(?:'unsafe-inline'|'unsafe-eval'|https?:)/);
  assert.equal((PRODUCTION_CSP.match(/'unsafe-inline'/g) || []).length, 1);

  const handler = createProductionIntegrationHandler({
    application: { async handle() {} }, browserRoot: ROOT, serviceRoot: SERVICE_ROOT,
  });
  const index = await send(handler, request("GET", "/"));
  const html = index.body.toString("utf8");
  assert.doesNotMatch(html, /<script(?![^>]*\bsrc=)[^>]*>/i);
  assert.doesNotMatch(html, /\son[a-z]+\s*=|javascript:/i);
  for (const match of html.matchAll(/<script\b[^>]*\bsrc="([^"]+)"[^>]*>/gi)) {
    assert.match(match[1], /^(?:\/)?js\/[A-Za-z0-9._/-]+\.js$/);
  }
  assert.match(html, /<script src="\/js\/pocket-sync-production-bootstrap\.js"><\/script>/);
});

test("P076 policy rejects weaker protected headers and remains absent from local static composition", async () => {
  const weakened = createProductionSecurityPolicy(async (_input, result) => {
    result.setHeader("Strict-Transport-Security", "max-age=0");
    result.end();
  });
  await assert.rejects(() => send(weakened, request("GET", "/")),
    (error) => error?.code === "sync-production-security-policy-failed");
  const downgraded = createProductionSecurityPolicy(async (_input, result) => {
    result.setHeader("Content-Security-Policy", PRIVATE_ALPHA_CSP);
    result.setHeader("Content-Security-Policy", PRODUCTION_CSP);
    result.end();
  });
  await assert.rejects(() => send(downgraded, request("GET", "/")),
    (error) => error?.code === "sync-production-security-policy-failed");
  assert.throws(() => createProductionSecurityPolicy(null),
    (error) => error?.code === "sync-production-security-policy-failed");

  const localStatic = createReviewedStaticHandler({ browserRoot: ROOT });
  const localIndex = await send(localStatic, request("GET", "/"));
  assert.equal(localIndex.statusCode, 200);
  assert.equal(Object.hasOwn(localIndex.headers, "strict-transport-security"), false);
  assert.equal(Object.hasOwn(localIndex.headers, "content-security-policy"), false);
});

test("P076 release manifest exactly hashes the frozen production static bytes", async () => {
  const manifest = createProductionReleaseManifest({ browserRoot: ROOT, serviceRoot: SERVICE_ROOT });
  assert.deepEqual(manifest.map((entry) => entry.path), [...manifest.map((entry) => entry.path)].sort());
  assert.ok(manifest.length > 60);
  for (const required of [
    "/index.html", "/sw.js", "/styles.css", "/manifest.json",
    "/js/pocket-node-popout-runtime.js",
    "/js/pocket-sync-production-bootstrap.js", "/js/pocket-sync-additional-device.js",
    "/js/pocket-sync-emergency-recovery.js", "/js/pocket-sync-local-integration.js",
  ]) assert.ok(manifest.some((entry) => entry.path === required), required);
  assert.equal(manifest.some((entry) => /package\.json|tests|docs|secret/i.test(entry.path)), false);

  const handler = createProductionIntegrationHandler({
    application: { async handle() { throw new Error("unexpected API call"); } },
    browserRoot: ROOT,
    serviceRoot: SERVICE_ROOT,
  });
  for (const entry of manifest) {
    const served = await send(handler, request("GET", entry.path));
    assert.equal(served.statusCode, 200, entry.path);
    assert.equal(served.body.byteLength, entry.bytes, entry.path);
    assert.equal(crypto.createHash("sha256").update(served.body).digest("hex"), entry.sha256, entry.path);
  }
  const indexEntry = manifest.find((entry) => entry.path === "/index.html");
  const sourceIndex = fs.readFileSync(path.join(ROOT, "index.html"));
  assert.notEqual(indexEntry.sha256, crypto.createHash("sha256").update(sourceIndex).digest("hex"));

  const command = spawnSync(process.execPath, [path.join(ROOT, "sync-service/pocket-sync-production-manifest.js")], {
    cwd: ROOT, encoding: "utf8", env: { ...process.env, POCKET_SYNC_SERVICE_ROOT: SERVICE_ROOT },
  });
  assert.equal(command.status, 0, command.stderr);
  assert.equal(command.stderr, "");
  assert.deepEqual(JSON.parse(command.stdout), { version: 1, assets: manifest });
});

test("P076 manifest is deterministic and fails closed for unsafe inventory entries", async (t) => {
  const fixture = fs.mkdtempSync(path.join(os.tmpdir(), "p076-assets-"));
  const outside = fs.mkdtempSync(path.join(os.tmpdir(), "p076-outside-"));
  t.after(() => {
    fs.rmSync(fixture, { recursive: true, force: true });
    fs.rmSync(outside, { recursive: true, force: true });
  });
  fs.mkdirSync(path.join(fixture, "js"));
  fs.writeFileSync(path.join(fixture, "index.html"), "<!doctype html><link rel=\"stylesheet\" href=\"styles.css\"><script src=\"js/app.js\"></script></body></html>");
  fs.writeFileSync(path.join(fixture, "sw.js"), "const FILES = ['./manifest.json'];");
  fs.writeFileSync(path.join(fixture, "styles.css"), "body { color: black; }\n");
  fs.writeFileSync(path.join(fixture, "manifest.json"), "{}\n");
  fs.writeFileSync(path.join(fixture, "js/app.js"), "globalThis.ready = true;\n");
  const options = { browserRoot: fixture, transformIndex(value) { return value.replace("</body>", "<p>production</p></body>"); } };

  const first = createReviewedStaticManifest(options);
  const second = createReviewedStaticManifest(options);
  assert.deepEqual(first, second);
  assert.deepEqual(first.map((entry) => entry.path), [...first.map((entry) => entry.path)].sort());
  fs.writeFileSync(path.join(fixture, "js/app.js"), "globalThis.ready = false;\n");
  const changed = createReviewedStaticManifest(options);
  assert.notEqual(
    first.find((entry) => entry.path === "/js/app.js").sha256,
    changed.find((entry) => entry.path === "/js/app.js").sha256,
  );
  for (const additionalAsset of ["/js/missing.js", "/../escape.js", "/unsupported.txt"]) {
    assert.throws(() => createReviewedStaticManifest({ ...options, additionalAssets: [additionalAsset] }),
      (error) => error?.code === "sync-static-assets-failed");
  }
  fs.writeFileSync(path.join(outside, "escape.js"), "outside\n");
  fs.symlinkSync(path.join(outside, "escape.js"), path.join(fixture, "js/escape.js"));
  assert.throws(() => createReviewedStaticManifest({ ...options, additionalAssets: ["/js/escape.js"] }),
    (error) => error?.code === "sync-static-assets-failed");
  assert.throws(() => createProductionReleaseManifest({ browserRoot: fixture, serviceRoot: "/bad?root" }),
    (error) => error?.code === "sync-production-composition-failed");

  const handler = createReviewedStaticHandler(options);
  for (const unsafe of ["/package.json", "/../package.json", "/%2e%2e/package.json", "/index.html?file=package.json"]) {
    assert.equal((await send(handler, request("GET", unsafe))).statusCode, 404, unsafe);
  }
});
