"use strict";

// Dormant storage codec. The existing encrypted object and its reference are
// the wire contract. The backing store must publish all parts as one record.
const { referenceForRecord } = require("./pocket-sync-object-head-postgres-store.js");
const { POLICY } = require("./pocket-sync-http-adapter.js");

const SCHEMA = "pocket.opaque-record-fragments.v1";
const FRAGMENT_CHARS = 4096; // Base64url symbols, in complete four-symbol groups.
const MAX_CHARS = POLICY.contentJsonLimitBytes;
const MAX_PARTS = Math.ceil(MAX_CHARS / FRAGMENT_CHARS);

function invalid() {
  return Object.assign(new Error("Invalid opaque record fragments."), { code: "opaque-fragment-invalid" });
}

function verify(ref, record) {
  const ciphertext = record?.ciphertext;
  if (typeof ciphertext !== "string" || ciphertext.length > MAX_CHARS) throw invalid();
  let calculated;
  try { calculated = referenceForRecord(record); } catch { throw invalid(); }
  if (calculated !== ref) throw invalid();
  return record;
}

function splitRecord(ref, record) {
  const { ciphertext, ...header } = verify(ref, record);
  const parts = [];
  for (let offset = 0; offset < ciphertext.length; offset += FRAGMENT_CHARS) {
    parts.push(ciphertext.slice(offset, offset + FRAGMENT_CHARS));
  }
  return Object.freeze({ schema: SCHEMA, header: Object.freeze(header), parts: Object.freeze(parts) });
}

function joinRecord(ref, stored) {
  if (stored?.format) return verify(ref, stored);
  if (stored?.schema !== SCHEMA || Object.keys(stored).length !== 3
      || !stored.header || Object.hasOwn(stored.header, "ciphertext")
      || !Array.isArray(stored.parts) || stored.parts.length < 1 || stored.parts.length > MAX_PARTS) {
    throw invalid();
  }
  for (const [index, part] of stored.parts.entries()) {
    if (typeof part !== "string" || !part || part.length > FRAGMENT_CHARS
        || (index < stored.parts.length - 1 && part.length !== FRAGMENT_CHARS)) throw invalid();
  }
  return verify(ref, { ...stored.header, ciphertext: stored.parts.join("") });
}

module.exports = Object.freeze({ FRAGMENT_CHARS, splitRecord, joinRecord });
