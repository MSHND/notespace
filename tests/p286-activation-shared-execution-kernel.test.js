"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const ROOT = path.resolve(__dirname, "..");
const MODULE = "js/pocket-sync-activation.js";

function source(file) {
  return fs.readFileSync(path.join(ROOT, file), "utf8");
}

function methodObject(names, extras = {}) {
  const value = { ...extras };
  for (const name of names) value[name] = () => {};
  return value;
}

function loadActivation() {
  const context = {
    Object, Array, Number, String, Boolean, JSON, Date, Error, TypeError, Promise,
    Uint8Array, ArrayBuffer, Set,
  };
  context.window = context;
  context.globalThis = context;
  vm.createContext(context);
  vm.runInContext(source(MODULE), context, { filename: MODULE });
  return context.PocketSyncActivation;
}

function createMinimalOrchestrator(activation) {
  const securityContract = methodObject([
    "validateActivationReadiness",
    "buildRecoveryPackage",
    "validateOpaqueEncryptedRecord",
    "validateOpaqueMasterKeyEnvelopeRecord",
  ]);
  const crypto = methodObject([
    "encodeBase64Url",
    "generateDeviceWrappingKey",
    "createDerivedWrappingKey",
    "createRecoveryAuthorisationKeyPair",
    "createMasterKeyBundle",
    "openMasterKeyBundle",
    "sealContent",
    "openContent",
    "validateContentRecord",
    "validateMasterKeyEnvelope",
  ], { FORMAT: { contentType: "portal.export.v1+json" } });
  const deviceStore = methodObject([
    "open", "readPocket", "readActivation", "createPocket", "replacePocket",
    "reservePocketEncryptionUsage",
  ], {
    FORMAT: {
      recordKind: "pocket.sync.device-state",
      recordSchemaVersion: 5,
    },
  });
  return activation.createActivationOrchestrator({
    securityContract,
    crypto,
    deviceStore,
    accountClient: methodObject([
      "registerPasskey", "finishRegistration", "authenticatePasskey",
    ]),
    contentService: methodObject(["conditionalUpload"]),
    envelopeService: methodObject(["addEnvelope"]),
    recoveryService: methodObject(["initialiseRecovery"]),
    randomBytes() { return new Uint8Array(32); },
    now() { return 0; },
  });
}

test("P286 preserves the exact public activation and orchestrator surfaces", () => {
  const activation = loadActivation();
  assert.deepEqual(Object.keys(activation), [
    "POLICY",
    "createActivationOrchestrator",
    "createStrandedActivationClassifier",
  ]);
  assert.equal(Object.isFrozen(activation), true);
  const orchestrator = createMinimalOrchestrator(activation);
  assert.deepEqual(Object.keys(orchestrator), ["activate", "resume"]);
  assert.equal(Object.isFrozen(orchestrator), true);
});

test("P286 has one execution currentness seam and one execution draft-contract seam", () => {
  const text = source(MODULE);
  assert.match(text, /currentGuard: null/);
  assert.match(text, /execution\.currentGuard = \(\) => execution\.dependencies\.isSourceSessionCurrent\(sourceSession\)/);
  assert.match(text, /typeof execution\.currentGuard === "function"[\s\S]*execution\.currentGuard\(\)/);
  assert.match(text, /async function checked\(execution, promise\)[\s\S]*await ensureCurrent\(execution\)/);

  assert.match(text, /draftContract: \(input\) => validateDraft\(input, config\)/);
  assert.match(text, /const nextDraft = execution\.draftContract\(/);
  assert.match(text, /execution\.draft = execution\.draftContract\(found\.draft\)/);

  const directValidateCalls = [...text.matchAll(/validateDraft\(/g)].length;
  assert.equal(directValidateCalls, 3);
  assert.match(text, /draft\.schemaVersion !== 1/);
});

test("P286 keeps one shared local-material construction path as later modes reuse it", () => {
  const text = source(MODULE);
  assert.match(text, /function buildV1InitialDraft\(input\)/);
  assert.match(text, /async function constructLocalMaterial\(execution, input\)/);
  assert.equal([...text.matchAll(/async function constructLocalMaterial\(/g)].length, 1);
  assert.match(text, /draftBuilder: buildV1InitialDraft/);
  assert.match(text, /schemaVersion: 1/);
  assert.doesNotMatch(text, /schemaVersion:\s*2/);
  assert.doesNotMatch(text, /function\s+(?:prepareOwnerless|activateV2|resumeV2|stageOwnerless)\s*\(/);
});

test("P286 shared-kernel evolution still leaves ownerless runtime and UI wiring dormant", () => {
  assert.doesNotMatch(source("js/pocket-sync-browser-runtime.js"),
    /findOwnerlessActivation|PocketSyncOwnerlessActivationDraft|ownerless-first-create/);
  assert.doesNotMatch(source("index.html"), /pocket-sync-ownerless-activation-draft\.js/);
  assert.doesNotMatch(source("sw.js"), /pocket-sync-ownerless-activation-draft\.js/);
});
