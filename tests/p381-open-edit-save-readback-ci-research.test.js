"use strict";

/*
 * Pocket | S1 research only | automated production-shaped Open/Edit/Save/Readback
 * Added only on research/pocket-open-edit-save-readback-20261116.
 *
 * This is a bounded aggregator of existing source-integrated tests, not a
 * substitute for a real hosted cross-device browser or a Gate 1 acceptance.
 * Runs against synthetic test records, memory-backed offsite-store analogues
 * and the actual repository client and Sync source. No real accounts, service,
 * Postgres, credentials, permissions, deployments or production writes.
 */
const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const ROOT = path.resolve(__dirname, "..");
const SOURCE_SUITES = Object.freeze([
  "tests/p176-production-composition.test.js",
  "tests/p180-main-save-cutover.test.js",
  "tests/p190-starling-save-observability-and-reentry.test.js",
  "tests/p052-additional-device.test.js",
]);
const REQUIRED_OBSERVATIONS = Object.freeze([
  "P176 exact production fresh activation bootstraps H, adopts authority, then saves dirty payload only through Starling",
  "P180 real Main migration never falls back to whole-record R2",
  "P190 production-shaped ordinary post-reentry Main Save advances H2 to remotely proved H3, retires the witness, cleans Main and never writes R",
  "P052b accepts a production Device A activation, Device B adoption and ordinary Device B Save",
  "P052a opens a real P029 content record with its authenticated content context and continues from device B's envelope",
]);

test("P381 automated synthetic source-integrated Open -> Edit -> Save -> independent remote readback and Device B control", { timeout: 480000 }, () => {
  // Node sets NODE_TEST_CONTEXT for its test-worker children. Passing it to a
  // nested test runner causes Node to silently skip the requested suites.
  const childEnv = { ...process.env, POCKET_P381_RESEARCH_DISPOSABLE: "1" };
  delete childEnv.NODE_TEST_CONTEXT;
  const run = spawnSync(process.execPath, [
    "--test", "--test-reporter=tap", "--test-concurrency=1", ...SOURCE_SUITES,
  ], {
    cwd: ROOT,
    encoding: "utf8",
    maxBuffer: 16 * 1024 * 1024,
    timeout: 450000,
    env: childEnv,
  });

  const output = String(run.stdout || "");
  const errors = String(run.stderr || "");
  const shortEvidence = (output + "\n" + errors).slice(-18000);

  assert.equal(run.error, undefined, "Synthetic child run error: " + String(run.error) + "\n" + shortEvidence);
  assert.equal(run.signal, null, "Synthetic child run terminated by signal\n" + shortEvidence);
  assert.equal(run.status, 0, "Synthetic source suites must all pass\n" + shortEvidence);
  for (const witness of REQUIRED_OBSERVATIONS) {
    assert.ok(output.includes("# Subtest: " + witness),
      "Required source-integrated witness missing: " + witness + "\n" + shortEvidence);
  }

  const count = (key) => {
    const values = [...output.matchAll(new RegExp("^# " + key + " (\\d+)$", "gm"))];
    assert.ok(values.length > 0, "Missing TAP total " + key);
    return Number(values[values.length - 1][1]);
  };
  const totals = Object.fromEntries(["tests", "pass", "fail", "cancelled", "skipped", "todo"]
    .map((key) => [key, count(key)]));
  assert.ok(totals.tests >= REQUIRED_OBSERVATIONS.length);
  assert.equal(totals.pass, totals.tests, "No failed, skipped, cancelled or todo source witnesses");
  assert.equal(totals.fail + totals.cancelled + totals.skipped + totals.todo, 0);

  console.info("POCKET_P381_BOUNDARY=synthetic-source-integrated-no-live-service");
  console.info("POCKET_P381_REQUIRED_WITNESSES=" + REQUIRED_OBSERVATIONS.length);
  console.info("POCKET_P381_TOTALS=" + JSON.stringify(totals));
  console.info("POCKET_P381_CLAIM=existing-repository-tests-ran-with-real-client-and-Sync-modules-but-memory-backed-test-service");
  console.info("POCKET_P381_NOT_PROVED=real-deployed-HTTPS-browser-WebAuthn-Postgres-cross-device-Gate1");
});
