"use strict";

// P349xy: dormant, entirely injected TWO-PASS synthetic source bracket.
// Receipt is a returned in-memory CANDIDATE, never durable custody, Google
// currentness, authenticated owner approval, release or publication authority.
const { createHash } = require("node:crypto");
const { NAMES } = require("./pocket-handover-release-witness.js");
const { projectGoogleNativeParagraphs } =
  require("./pocket-google-native-paragraph-projection.js");

const VERSION = "p349xy-length-framed-utf8-v1";
const PROJECTION = "google-native-paragraph-text-v1";
const object = x => x !== null && typeof x === "object" && !Array.isArray(x);
const exactKeys = (x, keys) => object(x) &&
  Object.keys(x).length === keys.length &&
  keys.every(k => Object.prototype.hasOwnProperty.call(x, k));
const id = x => typeof x === "string" && x.length > 0 && x.trim() === x;
const fail = reason => Object.freeze({ ok: false, reason });
const digest = bytes => createHash("sha256").update(bytes).digest("hex");

// Canonical receipt digest input (NOT JSON key order): exactly these fields,
// in this order, each framed as "UTF8_BYTE_LENGTH:VERBATIM_UTF8_VALUE":
// version, projector version, attempt ID, match statement, number of sources,
// then for each source in NAMES order: name, Google ID, tab ID, revision ID,
// decimal UTF-8 content byte count, lowercase SHA-256 content digest.
// Frame lengths count BYTES, not UTF-16 units; concatenation has no separators.
function receiptDigest(attemptId, rows) {
  const fields = [VERSION, PROJECTION, attemptId, "two-full-passes-match",
    String(NAMES.length)];
  for (const r of rows) {
    fields.push(r.name, r.documentId, r.tabId, r.revisionId,
      String(r.byteCount), r.sha256);
  }
  const framed = fields.map(x => String(Buffer.byteLength(x, "utf8")) + ":" + x).join("");
  return digest(Buffer.from(framed, "utf8"));
}

function createNineSourceBracketRehearsal({ attemptId, expectedSources, readPass } = {}) {
  if (!id(attemptId) || !Array.isArray(expectedSources)
      || expectedSources.length !== NAMES.length ||
      typeof readPass !== "function") throw new TypeError("Synthetic bracket inputs invalid");
  // Freeze independent copies: callback/test edits cannot repin expected truth.
  const pins = expectedSources.map((p, i) => {
    if (!exactKeys(p, ["name", "documentId", "tabId", "revisionId"])
        || p.name !== NAMES[i] || !id(p.documentId)
        || !id(p.tabId) || !id(p.revisionId)) {
      throw new TypeError("Synthetic nine-source identity pins invalid");
    }
    return Object.freeze({ name: p.name, documentId: p.documentId,
      tabId: p.tabId, revisionId: p.revisionId });
  });
  let state = "unused"; // terminal after one call, including failure
  async function run() {
    if (state !== "unused") return fail("attempt-not-reusable");
    state = "running"; // lock BEFORE any awaited callback
    try {
      let first = null;
      let matched = null;
      for (const pass of [1, 2]) {
        const input = await readPass(pass); // synthetic INJECTED, never Google API
        if (!Array.isArray(input) || input.length !== NAMES.length) {
          state = "aborted";
          return fail("incomplete-or-extra-source-pass");
        }
        const projected = [];
        for (let i = 0; i < NAMES.length; i++) {
          const item = input[i], pin = pins[i];
          if (!exactKeys(item, ["name", "snapshot"]) || item.name !== pin.name) {
            state = "aborted";
            return fail("missing-duplicate-or-out-of-order-source");
          }
          const result = projectGoogleNativeParagraphs({
            snapshot: item.snapshot, name: pin.name,
            documentId: pin.documentId, tabId: pin.tabId,
            revisionId: pin.revisionId,
          });
          if (!result.ok) {
            state = "aborted";
            return fail("source-identity-revision-or-structure-invalid");
          }
          // The full canonical UTF-8 bytes live only within this local run.
          const bytes = Buffer.from(result.content, "utf8");
          const row = Object.freeze({
            name: result.name, documentId: result.documentId,
            tabId: result.tabId, revisionId: result.revisionId,
            byteCount: result.utf8ByteCount, sha256: result.sha256,
          });
          if (pass === 2) {
            const prior = first[i];
            if (Object.keys(row).some(k => row[k] !== prior.row[k])
                || !bytes.equals(prior.bytes)
                || digest(bytes) !== prior.row.sha256) {
              state = "aborted";
              return fail("source-changed-between-passes");
            }
            projected.push(row);
          } else {
            projected.push({ row, bytes });
          }
        }
        if (pass === 1) first = projected;
        else matched = projected;
      }
      const orderedSources = Object.freeze(matched.map(x => Object.freeze({ ...x })));
      const receipt = Object.freeze({
        schemaVersion: 1, attemptId, projectionVersion: PROJECTION,
        encoding: VERSION, passCount: 2, passesMatch: true,
        orderedSources, sha256: receiptDigest(attemptId, orderedSources),
      });
      state = "candidate"; // NEVER "published"/"approved"/"current"
      return Object.freeze({ ok: true,
        classification: "candidate-for-future-external-attestation",
        receipt });
    } catch (_error) {
      state = "aborted";
      return fail("source-read-interrupted-or-failed");
    }
  }
  return Object.freeze({ run, state: () => state });
}
module.exports = Object.freeze({
  createNineSourceBracketRehearsal,
});
