"use strict";

// Opt-in, read-only preflight for the local format of mirrored legacy Pocket exports.
// Run with Node 24: node tools/pocket-legacy-migration-preflight.js <file>
const fs = require("node:fs");
const path = require("node:path");
const { isDeepStrictEqual: equal } = require("node:util");
const vm = require("node:vm");

const pocket = vm.createContext({ TextEncoder });
pocket.window = pocket;
for (const name of ["outline-persistence-policy", "node-content", "editor-metadata",
  "data", "import", "storage", "device-changes"]) {
  const filename = path.join(__dirname, "..", "js", `pocket-${name}.js`);
  vm.runInContext(fs.readFileSync(filename, "utf8"), pocket, { filename });
}

const files = pocket.PocketOutlinePersistencePolicy;
const structure = pocket.PocketDeviceChanges;
const object = value => value !== null && typeof value === "object" && !Array.isArray(value);
const reject = reason => ({ ok: false, reason });

function decimalValue(text) {
  const [, integer, fraction = "", exponent = "0"] = /^(-?\d+)(?:\.(\d+))?(?:[eE]([+-]?\d+))?$/.exec(text);
  const digits = integer.replace(/^-/, "") + fraction;
  const significant = digits.replace(/0+$/, "");
  const power = Number(exponent) + digits.length - significant.length - fraction.length;
  return significant ? `${text.startsWith("-") ? "-" : ""}${significant.replace(/^0+/, "")}e${power}` : "0";
}

function parseSource(text) {
  let members = 0;
  let unsupported = false;
  let parsed;
  try {
    parsed = JSON.parse(text, (key, value, token) => {
      if (object(value)) members += Object.keys(value).length;
      if (key.trim() === "__proto__") unsupported = true;
      if (typeof value === "number") {
        const saved = String(value);
        if (!Number.isFinite(value) || Object.is(value, -0)
            || (Number.isInteger(value) && !Number.isSafeInteger(value))
            || (token.source !== saved && decimalValue(token.source) !== decimalValue(saved))) {
          unsupported = true;
        }
      }
      return value;
    });
  } catch {
    return reject("invalid-json");
  }
  // Each string token is consumed as a whole, including escapes. In valid JSON
  // only property names can be followed by a colon outside the token.
  let sourceMembers = 0;
  try {
    for (const token of text.matchAll(/"(?:\\[\s\S]|[^"\\])*"(\s*:)?/g)) {
      if (token[1]) sourceMembers += 1;
    }
  } catch {
    return reject("unsupported-document");
  }
  if (sourceMembers !== members) return reject("duplicate-json-key");
  if (unsupported) return reject("unsupported-json-value");
  return { ok: true, parsed };
}

function firstNodeLoss(original, restored) {
  if (original.label !== restored?.label) return "label-would-change";
  if (!equal(original.peMigrationLegacySourcePreserved, restored.peMigrationLegacySourcePreserved)) {
    return "source-capsule-would-change";
  }
  if (original.details !== restored.details || !equal(original.editor, restored.editor)) return "body-would-change";
  if (!equal(original, restored)) return "node-metadata-would-change";
  return null;
}

function preflightLegacyMigration(text) {
  if (!files.allowsLocalFileText(text)) return reject("unsupported-file-size");
  const source = parseSource(text);
  if (!source.ok) return source;
  const input = source.parsed;
  if (!object(input) || input.schema !== "portal.export.v1" || !object(input.data)) {
    return reject("invalid-envelope");
  }
  const nodes = input.mainThoughtTree, tombstones = input.mainThoughtTreeTombstones;
  const nested = input.data;
  if (![nodes, tombstones, nested.mainThoughtTree, nested.mainThoughtTreeTombstones].every(Array.isArray)) {
    return reject("invalid-envelope");
  }
  if (nodes.length > structure.MAX_COMPARISON_NODES || tombstones.length > structure.MAX_COMPARISON_NODES) {
    return reject("too-many-records");
  }
  try {
    if (!equal(nodes, nested.mainThoughtTree) || !equal(tombstones, nested.mainThoughtTreeTombstones)
        || !equal(input.pocketGuard, nested.pocketGuard)) return reject("mirror-mismatch");
    const guard = pocket.normaliseGuardMeta(input.pocketGuard);
    if (!guard?.instanceId || !equal(input.pocketGuard, { schema: "pocket.guard.v1", ...guard })) {
      return reject("invalid-guard");
    }
    if (tombstones.some(record => !object(record) || typeof record.id !== "string" || !record.id
        || record.id === "root" || pocket.cleanText(record.id, 80) !== record.id
        || typeof record.deletedAt !== "string" || !Number.isFinite(Date.parse(record.deletedAt)))) {
      return reject("invalid-tombstone");
    }
    for (const [nodeIndex, node] of nodes.entries()) {
      if (!object(node)) return reject("invalid-node");
      if (typeof node.label !== "string" || !node.label || pocket.cleanText(node.label) !== node.label) {
        return { ...reject("label-would-change"), nodeIndex };
      }
    }
    const assessment = structure.validateStructure(input);
    // The comparison owner ignores some fields and collapses distinct causes
    // of normalisation loss. Compare every persisted field ourselves below.
    const structuralError = assessment.errors.find(reason => reason !== "lossy-normalisation");
    if (structuralError) return reject(structuralError);
    const normal = pocket.normaliseInput(input);
    const restored = structuredClone(normal.nodes);
    if (nodes.length !== restored.length) return reject("node-count-would-change");
    for (const [nodeIndex, original] of nodes.entries()) {
      const reason = firstNodeLoss(original, restored[nodeIndex]);
      if (reason) return { ...reject(reason), nodeIndex };
    }
    const payload = pocket.buildCanonicalPocketPayload(normal, { pocketGuard: normal.rootExtras?.pocketGuard });
    if (!equal(input, structuredClone(payload))) return reject("envelope-would-change");
    if (JSON.stringify(payload, null, 2).length + 1 > files.LIMITS.localFileChars) {
      return reject("unsupported-save-size");
    }
    if (!assessment.ok) return reject(assessment.reason);
    return { ok: true, nodes: nodes.length, tombstones: tombstones.length };
  } catch {
    return reject("unsupported-document");
  }
}

function inspectFile(filename) {
  const maxBytes = files.LIMITS.localFileChars * 3;
  const fd = fs.openSync(filename, fs.constants.O_RDONLY | fs.constants.O_NONBLOCK);
  try {
    const stat = fs.fstatSync(fd);
    if (!stat.isFile()) return reject("not-a-regular-file");
    if (stat.size > maxBytes) return reject("unsupported-file-size");
    const bytes = Buffer.allocUnsafe(stat.size + 1);
    let length = 0, count;
    while (length < bytes.length && (count = fs.readSync(fd, bytes, length, bytes.length - length)) > 0) {
      length += count;
    }
    if (length > maxBytes) return reject("unsupported-file-size");
    if (length !== stat.size) return reject("file-changed-during-read");
    return preflightLegacyMigration(new TextDecoder("utf-8", { fatal: true, ignoreBOM: true })
      .decode(bytes.subarray(0, length)));
  } finally {
    fs.closeSync(fd);
  }
}

if (require.main === module) {
  let result;
  try {
    result = process.argv.length === 3 ? inspectFile(process.argv[2]) : reject("provide-one-file");
  } catch {
    result = reject("unreadable-file");
  }
  console.log(JSON.stringify(result));
  process.exitCode = result.ok ? 0 : 1;
}

module.exports = { preflightLegacyMigration };
