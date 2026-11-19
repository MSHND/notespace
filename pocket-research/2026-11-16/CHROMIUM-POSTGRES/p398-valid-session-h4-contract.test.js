"use strict";
// P398-A FICTIONAL RESEARCH ONLY: Source-integrated real Chromium/PG strict single-Open witness. Requires actual active server session; fails RED without masking original expectations.
// Do not make product/server auth changes or weaken original assertions.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const Module = require("node:module");
const filename = path.join(__dirname, "p390-superseded-lineage.test.js");
let source = fs.readFileSync(filename,"utf8");
const anchor = "  \"  console.info('P396_SESSION_BEFORE=' + JSON.stringify(p396Before));\",";
assert.equal(source.split(anchor).length,2,"P398 parent fixture drift; do not mask");
const injected = ["  assert.equal(p396Before.state, 'active-unexpired-session', 'P398 contract: only an actual active service session qualifies for strict single-Open success');","  assert.equal(p396Before.cookieCount, 1, 'P398 requires server-verified valid session cookie');"].map(line => "  " + JSON.stringify(line) + ",").join("\n");
source = source.replace(anchor,anchor + "\n" + injected);
const runner = new Module(filename,module);
runner.filename=filename;runner.paths=module.paths;
runner._compile(source,filename);
