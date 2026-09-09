"use strict";

const serviceCore = require("./pocket-sync-service-core.js");

const ELIGIBLE_COLLECTIONS = Object.freeze([
  serviceCore.COLLECTIONS.sessions,
  serviceCore.COLLECTIONS.ceremonies,
  serviceCore.COLLECTIONS.recoveryCeremonies,
]);
const MAX_DELETIONS = 100;

function retentionError(code) {
  const error = new Error("Pocket Sync expired-record retention failed.");
  error.code = code;
  return error;
}

function isObject(value) {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function validateInput(input) {
  if (!isObject(input) || Object.keys(input).length !== 2
      || !Object.prototype.hasOwnProperty.call(input, "store")
      || !Object.prototype.hasOwnProperty.call(input, "cutoffMilliseconds")
      || !isObject(input.store) || typeof input.store.transact !== "function"
      || !Number.isSafeInteger(input.cutoffMilliseconds)) {
    throw retentionError("retention-input-invalid");
  }
  let cutoff;
  try { cutoff = new Date(input.cutoffMilliseconds).toISOString(); }
  catch (_error) { throw retentionError("retention-input-invalid"); }
  return Object.freeze({ store: input.store, cutoffMilliseconds: input.cutoffMilliseconds, cutoff });
}

function result(counts) {
  return Object.freeze({
    deleted: counts.sessions + counts.ceremonies + counts.recoveryCeremonies,
    byCollection: Object.freeze({
      sessions: counts.sessions,
      ceremonies: counts.ceremonies,
      recoveryCeremonies: counts.recoveryCeremonies,
    }),
  });
}

async function removeExpiredEphemeralRecords(input) {
  const config = validateInput(input);
  try {
    return await config.store.transact("readwrite", async (transaction) => {
      if (!isObject(transaction)
          || typeof transaction.remove !== "function"
          || typeof transaction.selectExpiredCandidates !== "function") {
        throw retentionError("retention-store-invalid");
      }
      const candidates = await transaction.selectExpiredCandidates(
        ELIGIBLE_COLLECTIONS,
        config.cutoff,
        MAX_DELETIONS
      );
      if (!Array.isArray(candidates) || candidates.length > MAX_DELETIONS) {
        throw retentionError("retention-store-invalid");
      }
      const counts = { sessions: 0, ceremonies: 0, recoveryCeremonies: 0 };
      for (const candidate of candidates) {
        if (!isObject(candidate)
            || !ELIGIBLE_COLLECTIONS.includes(candidate.collection)
            || typeof candidate.key !== "string"
            || !Number.isSafeInteger(candidate.storeVersion)
            || candidate.storeVersion < 1) {
          throw retentionError("retention-state-invalid");
        }
        let record;
        try {
          record = serviceCore.validateStoredRecord(
            candidate.collection,
            candidate.record,
            candidate.key
          );
        } catch (_error) {
          throw retentionError("retention-state-invalid");
        }
        if (record.storeVersion !== candidate.storeVersion
            || Date.parse(record.expiresAt) > config.cutoffMilliseconds) {
          throw retentionError("retention-state-invalid");
        }
        await transaction.remove(candidate.collection, candidate.key, record.storeVersion);
        counts[candidate.collection] += 1;
      }
      return result(counts);
    });
  } catch (error) {
    if (error && typeof error.code === "string" && error.code.startsWith("retention-")) {
      throw error;
    }
    throw retentionError("retention-failed");
  }
}

module.exports = Object.freeze({
  ELIGIBLE_COLLECTIONS,
  MAX_DELETIONS,
  removeExpiredEphemeralRecords,
});
