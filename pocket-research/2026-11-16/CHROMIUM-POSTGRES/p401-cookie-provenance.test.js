"use strict";
// P401 source-only diagnostic. Run ORIGINAL strict browser/PG tests unchanged.
// Their existing P396 probes emit ONLY classified cookie/PG state and first-begin
// statuses. A RED strict oracle remains RED. Never echo raw subprocess output.
const assert = require("node:assert/strict");
const { spawnSync } = require("node:child_process");
const path = require("node:path");
const test = require("node:test");

const cases = Object.freeze([
  "p387-authority-repeat-recovery.test.js",
  "p390-superseded-lineage.test.js",
  "p398-valid-session-pending-contract.test.js",
  "p398-valid-session-h4-contract.test.js",
]);
const states = new Set(["absent", "unknown-session", "revoked-and-replaced-session",
  "revoked-session", "inactive-session", "expired-session", "active-unexpired-session"]);

function isolatedEnvironment() {
  assert.ok(process.env.POCKET_SYNC_DATABASE_URL && process.env.CHROME_BIN
    && process.env.POCKET_P382_CERT && process.env.POCKET_P382_KEY,
  "P401 requires a disposable local Chromium/PostgreSQL test fixture");
  const db = new URL(process.env.POCKET_SYNC_DATABASE_URL);
  assert.ok(["localhost", "127.0.0.1"].includes(db.hostname)
    && ["/pocket_p382_research", "/pocket_p383_research"].includes(db.pathname),
  "P401 refuses non-loopback or non-research PostgreSQL");
}

function prefixedLines(stream, prefix) {
  return stream.split(/\r?\n/)
    .map(line => line.replace(/^\s*#\s?/, "").trimStart()) // node --test TAP comment prefix
    .filter(line => line.startsWith(prefix))
    .map(line => JSON.parse(line.slice(prefix.length)));
}

for (const filename of cases) {
  test("P401 redacted first-Open provenance; preserve strict " + filename, {
    timeout: 230000, concurrency: false,
  }, () => {
    isolatedEnvironment();
    const child = spawnSync(process.execPath,
      ["--test", "--test-reporter=tap", path.join(__dirname, filename)], {
        env: process.env, encoding: "utf8", timeout: 215000,
        maxBuffer: 8 * 1024 * 1024,
      });
    assert.ifError(child.error);
    const stdout = child.stdout || "";
    const befores = prefixedLines(stdout, "P396_SESSION_BEFORE=");
    const traces = prefixedLines(stdout, "P396_AUTH_BEGIN=");
    // Never emit cookie value, SQL row key, account, credential, stage or content.
    const sanitised = { strictFile: filename, exit: child.status,
      before: befores.map(x => ({ state: x.state, cookieCount: x.cookieCount })),
      begin: traces.flatMap(x => x.requests || []).map(x => ({
        status: x.status, reason: x.reason, clearedByServer: x.clearedByServer,
      })),
      originalStrictPassed: child.status === 0 };
    console.info("P401_REDACTED_PROVENANCE=" + JSON.stringify(sanitised));
    assert.ok(befores.length > 0,
      "Original strict witness failed before a classified pre-Open observation");
    for (const item of befores) {
      assert.ok(states.has(item.state));
      assert.ok(item.cookieCount === 0 || item.cookieCount === 1);
      assert.equal(item.cookieCount === 0, item.state === "absent");
    }
    // Preserve the protected strict exit, including currently RED expectations.
    assert.equal(child.status, 0,
      "Original strict oracle remains RED; never convert to a diagnostic PASS");
    assert.ok(traces.length > 0, "The first begin response was not observed");
  });
}
