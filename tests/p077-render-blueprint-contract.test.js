"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.resolve(__dirname, "..");
const blueprint = fs.readFileSync(path.join(ROOT, "render.yaml"), "utf8");

function occurrences(pattern) {
  return [...blueprint.matchAll(pattern)].length;
}

function envBlock(key) {
  const marker = `      - key: ${key}\n`;
  const start = blueprint.indexOf(marker);
  if (start < 0) return "";
  const next = blueprint.indexOf("      - key: ", start + marker.length);
  return blueprint.slice(start, next < 0 ? blueprint.length : next);
}

test("P077 Render Blueprint declares one manual private-alpha service and paid private database", () => {
  assert.equal(blueprint.includes("\t"), false);
  assert.equal(occurrences(/^databases:$/gm), 1);
  assert.equal(occurrences(/^services:$/gm), 1);
  assert.equal(occurrences(/^  - /gm), 2);
  assert.equal(occurrences(/^  - name: pocket-postgres$/gm), 1);
  assert.equal(occurrences(/^  - type: web$/gm), 1);
  assert.equal(occurrences(/^    name: pocket$/gm), 1);
  assert.equal(occurrences(/^    runtime: node$/gm), 1);
  assert.equal(occurrences(/^    region: singapore$/gm), 2);
  assert.equal(occurrences(/^    plan: starter$/gm), 1);
  assert.equal(occurrences(/^    plan: basic-256mb$/gm), 1);
  assert.equal(occurrences(/^    postgresMajorVersion: "18"$/gm), 1);
  assert.equal(occurrences(/^    ipAllowList: \[\]$/gm), 1);
  assert.doesNotMatch(blueprint, /\bfree\b/i);

  assert.equal(occurrences(/^    repo: https:\/\/github\.com\/MSHND\/notespace$/gm), 1);
  assert.equal(occurrences(/^    branch: main$/gm), 1);
  assert.equal(occurrences(/^    autoDeployTrigger: off$/gm), 1);
  assert.equal(occurrences(/^    buildCommand: npm ci && npm run check && npm run sync:production:manifest >\/dev\/null$/gm), 1);
  assert.equal(occurrences(/^    preDeployCommand: npm run sync:db:migrate$/gm), 1);
  assert.equal(occurrences(/^    startCommand: npm run sync:production$/gm), 1);
  assert.equal(occurrences(/^    domains:\n      - pocket\.murrayhenderson\.com\.au$/gm), 1);
  assert.doesNotMatch(blueprint, /healthCheckPath|^    (?:deployHook|deployCommand):|render\s+deploy|disable[^\n]*subdomain/im);
});

test("P077 Blueprint pins the exact non-secret production environment contract", () => {
  assert.deepEqual(
    [...blueprint.matchAll(/^      - key: ([A-Z0-9_]+)$/gm)].map((match) => match[1]),
    [
      "NODE_VERSION",
      "NODE_ENV",
      "POCKET_SYNC_TRUSTED_ORIGIN",
      "POCKET_SYNC_RP_ID",
      "POCKET_SYNC_RP_NAME",
      "POCKET_SYNC_SERVICE_ROOT",
      "POCKET_SYNC_DATABASE_URL",
      "POCKET_ALPHA_ACCESS_SECRET",
    ],
  );
  assert.equal(envBlock("NODE_VERSION"), "      - key: NODE_VERSION\n        value: 24.14.1\n");
  assert.equal(envBlock("NODE_ENV"), "      - key: NODE_ENV\n        value: production\n");
  assert.equal(envBlock("POCKET_SYNC_TRUSTED_ORIGIN"),
    "      - key: POCKET_SYNC_TRUSTED_ORIGIN\n        value: https://pocket.murrayhenderson.com.au\n");
  assert.equal(envBlock("POCKET_SYNC_RP_ID"),
    "      - key: POCKET_SYNC_RP_ID\n        value: pocket.murrayhenderson.com.au\n");
  assert.equal(envBlock("POCKET_SYNC_RP_NAME"), "      - key: POCKET_SYNC_RP_NAME\n        value: Pocket\n");
  assert.equal(envBlock("POCKET_SYNC_SERVICE_ROOT"),
    "      - key: POCKET_SYNC_SERVICE_ROOT\n        value: /pocket-sync/v1\n");
});

test("P077 Blueprint keeps database and alpha secrets provider-owned and absent", () => {
  assert.equal(envBlock("POCKET_SYNC_DATABASE_URL"), [
    "      - key: POCKET_SYNC_DATABASE_URL",
    "        fromDatabase:",
    "          name: pocket-postgres",
    "          property: connectionString",
    "",
  ].join("\n"));
  assert.equal(envBlock("POCKET_ALPHA_ACCESS_SECRET"),
    "      - key: POCKET_ALPHA_ACCESS_SECRET\n        sync: false\n");
  assert.doesNotMatch(blueprint, /postgres(?:ql)?:\/\//i);
  assert.doesNotMatch(blueprint, /^      - key: (?:PORT|POCKET_SYNC_TLS_CERT_FILE|POCKET_SYNC_TLS_KEY_FILE)$/gm);
  assert.doesNotMatch(envBlock("POCKET_ALPHA_ACCESS_SECRET"), /value:/);
  assert.doesNotMatch(blueprint, /api[_-]?key|access[_-]?token|private[_-]?key/i);
});
