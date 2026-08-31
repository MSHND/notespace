/* Dormant exact-Seal semantic authority. It authenticates an already-audited
   logical Placement relation without making the shared Sync AES key extractable. */
(function (global) {
  "use strict";

  const SCHEMA = "pocket.starling.semantic-validity.v1",
    ALGORITHM = "HMAC-SHA-256",
    PLACEMENT_GENERATION = "pocket.starling.placement-relation.v1",
    SEQUENCE_SCHEMA = "pocket.starling.sequence-page.v2",
    AUTHORITY_SALT_DOMAIN = "pocket.starling.semantic-authority-salt.v1",
    AUTHORITY_KEY_DOMAIN = "pocket.starling.semantic-authority-key.v1",
    ATTESTATION_FIELDS = Object.freeze([
      "schema", "algorithm", "syncedPocketId", "logicalSealRef", "logicalRootRef",
      "previousLogicalSealRef", "logicalSealSchema", "logicalRootSchema",
      "logicalObjectSchema", "sequenceSchema", "placementGeneration", "tag",
    ]),
    authorities = new WeakMap(),
    issuedProofs = new WeakMap(),
    baseProofs = new WeakMap(),
    textEncoder = new global.TextEncoder();

  function failure(reason) { return Object.freeze({ ok: false, reason }); }

  function exact(value, fields) {
    return value && typeof value === "object" && !Array.isArray(value) &&
      Object.keys(value).length === fields.length &&
      fields.every((field) => Object.prototype.hasOwnProperty.call(value, field));
  }

  function identifier(value) {
    return typeof value === "string" && value.length > 0 && value.length <= 160 && value === value.trim();
  }

  function dependencies() {
    const sync = global.PocketSyncCrypto,
      logical = global.PocketStarlingObjectSealShadow,
      edits = global.PocketStarlingLogicalEditShadow;
    if (!sync || !logical || typeof sync.encodeBase64Url !== "function" ||
      typeof logical.semanticAuditBinding !== "function") return null;
    return { sync, logical, edits };
  }

  function hmacKey(value) {
    const usages = value && value.usages ? Array.from(value.usages) : [];
    return value && value.type === "secret" && value.extractable === false &&
      value.algorithm && value.algorithm.name === "HMAC" &&
      value.algorithm.length === 256 && value.algorithm.hash &&
      value.algorithm.hash.name === "SHA-256" && usages.length === 2 &&
      usages.includes("sign") && usages.includes("verify");
  }

  function transcript(binding) {
    return textEncoder.encode(JSON.stringify([
      SCHEMA, binding.syncedPocketId, binding.logicalSealRef, binding.logicalRootRef,
      binding.previousLogicalSealRef, binding.logicalSealSchema, binding.logicalRootSchema,
      binding.logicalObjectSchema, binding.sequenceSchema, binding.placementGeneration,
    ]));
  }

  function bindingValid(binding) {
    const deps = dependencies();
    return !!deps && exact(binding, [
      "syncedPocketId", "logicalSealRef", "logicalRootRef", "previousLogicalSealRef",
      "logicalSealSchema", "logicalRootSchema", "logicalObjectSchema", "sequenceSchema",
      "placementGeneration",
    ]) && identifier(binding.syncedPocketId) && identifier(binding.logicalSealRef) &&
      identifier(binding.logicalRootRef) &&
      (binding.previousLogicalSealRef === null || identifier(binding.previousLogicalSealRef)) &&
      binding.logicalSealSchema === deps.logical.SEAL_SCHEMA &&
      binding.logicalRootSchema === deps.logical.ROOT_SCHEMA &&
      binding.logicalObjectSchema === deps.logical.OBJECT_SCHEMA &&
      binding.sequenceSchema === SEQUENCE_SCHEMA && binding.placementGeneration === PLACEMENT_GENERATION;
  }

  function sameBinding(left, right) {
    return bindingValid(left) && bindingValid(right) &&
      left.syncedPocketId === right.syncedPocketId &&
      left.logicalSealRef === right.logicalSealRef && left.logicalRootRef === right.logicalRootRef &&
      left.previousLogicalSealRef === right.previousLogicalSealRef &&
      left.logicalSealSchema === right.logicalSealSchema &&
      left.logicalRootSchema === right.logicalRootSchema &&
      left.logicalObjectSchema === right.logicalObjectSchema &&
      left.sequenceSchema === right.sequenceSchema &&
      left.placementGeneration === right.placementGeneration;
  }

  function recordFor(binding, tag) {
    return Object.freeze({ schema: SCHEMA, algorithm: ALGORITHM, syncedPocketId: binding.syncedPocketId,
      logicalSealRef: binding.logicalSealRef, logicalRootRef: binding.logicalRootRef,
      previousLogicalSealRef: binding.previousLogicalSealRef,
      logicalSealSchema: binding.logicalSealSchema, logicalRootSchema: binding.logicalRootSchema,
      logicalObjectSchema: binding.logicalObjectSchema, sequenceSchema: binding.sequenceSchema,
      placementGeneration: binding.placementGeneration, tag });
  }

  function bindingFromRecord(record) {
    if (!exact(record, ATTESTATION_FIELDS) || record.schema !== SCHEMA || record.algorithm !== ALGORITHM ||
      typeof record.tag !== "string" || !record.tag) return null;
    const binding = {
      syncedPocketId: record.syncedPocketId, logicalSealRef: record.logicalSealRef,
      logicalRootRef: record.logicalRootRef, previousLogicalSealRef: record.previousLogicalSealRef,
      logicalSealSchema: record.logicalSealSchema, logicalRootSchema: record.logicalRootSchema,
      logicalObjectSchema: record.logicalObjectSchema, sequenceSchema: record.sequenceSchema,
      placementGeneration: record.placementGeneration,
    };
    return bindingValid(binding) ? Object.freeze(binding) : null;
  }

  async function deriveAuthority(rawMasterKey, syncedPocketId) {
    if (!(rawMasterKey instanceof global.Uint8Array) || rawMasterKey.byteLength !== 32 || !identifier(syncedPocketId))
      throw new Error("Pocket Starling semantic authority input invalid.");
    const crypto = global.crypto;
    if (!crypto || !crypto.subtle) throw new Error("Pocket Starling semantic authority crypto unavailable.");
    const copied = new global.Uint8Array(rawMasterKey),
      saltInput = textEncoder.encode(JSON.stringify([AUTHORITY_SALT_DOMAIN, syncedPocketId])),
      info = textEncoder.encode(JSON.stringify([AUTHORITY_KEY_DOMAIN, syncedPocketId]));
    let salt = null;
    try {
      salt = new global.Uint8Array(await crypto.subtle.digest("SHA-256", saltInput));
      const base = await crypto.subtle.importKey("raw", copied, "HKDF", false, ["deriveKey"]),
        key = await crypto.subtle.deriveKey(
          { name: "HKDF", hash: "SHA-256", salt, info }, base,
          { name: "HMAC", hash: "SHA-256", length: 256 }, false, ["sign", "verify"],
        );
      if (!hmacKey(key)) throw new Error("Pocket Starling semantic authority key invalid.");
      const authority = Object.freeze({});
      authorities.set(authority, Object.freeze({ key, syncedPocketId }));
      return authority;
    } finally {
      copied.fill(0); saltInput.fill(0); info.fill(0); if (salt) salt.fill(0);
    }
  }

  async function issue(authority, binding) {
    const state = authorities.get(authority), deps = dependencies();
    if (!state || !deps || !bindingValid(binding) || binding.syncedPocketId !== state.syncedPocketId)
      return failure("semantic-validity-invalid");
    const bytes = transcript(binding);
    try {
      const tag = new global.Uint8Array(await global.crypto.subtle.sign("HMAC", state.key, bytes)),
        proof = Object.freeze({}), record = recordFor(binding, deps.sync.encodeBase64Url(tag));
      tag.fill(0);
      issuedProofs.set(proof, Object.freeze({ authority, binding: Object.freeze({ ...binding }), record }));
      return Object.freeze({ ok: true, proof });
    } catch (_error) { return failure("semantic-validity-invalid"); }
    finally { bytes.fill(0); }
  }

  async function issueInitial({ authority, auditProof } = {}) {
    const deps = dependencies();
    if (!deps) return failure("semantic-validity-invalid");
    const raw = deps.logical.semanticAuditBinding(auditProof), state = authorities.get(authority);
    if (!raw || !state || raw.syncedPocketId !== null) return failure("semantic-validity-invalid");
    const binding = Object.freeze({ ...raw, syncedPocketId: state.syncedPocketId });
    return issue(authority, binding);
  }

  async function issueSuccessor({ authority, semanticBaseProof, candidate } = {}) {
    const deps = dependencies();
    if (!deps || !deps.edits || typeof deps.edits.semanticTransitionBinding !== "function")
      return failure("semantic-validity-invalid");
    const binding = deps.edits.semanticTransitionBinding(candidate, authority, semanticBaseProof);
    return binding ? issue(authority, binding) : failure("semantic-validity-invalid");
  }

  function attestationForStage({ authority, proof, binding } = {}) {
    const issued = issuedProofs.get(proof);
    return issued && issued.authority === authority && sameBinding(issued.binding, binding)
      ? issued.record : null;
  }

  async function authenticate({ authority, semanticValidity, binding } = {}) {
    const state = authorities.get(authority), recordBinding = bindingFromRecord(semanticValidity);
    if (!state || !recordBinding || !sameBinding(recordBinding, binding) ||
      recordBinding.syncedPocketId !== state.syncedPocketId) return failure("semantic-validity-invalid");
    const deps = dependencies();
    let tag, bytes;
    try {
      tag = deps.sync.decodeBase64Url
        ? deps.sync.decodeBase64Url(semanticValidity.tag, "semantic-validity-invalid")
        : null;
      if (!tag || tag.byteLength !== 32) return failure("semantic-validity-invalid");
      bytes = transcript(recordBinding);
      const valid = await global.crypto.subtle.verify("HMAC", state.key, tag, bytes);
      if (!valid) return failure("semantic-validity-invalid");
      const proof = Object.freeze({});
      baseProofs.set(proof, Object.freeze({ authority, binding: recordBinding }));
      return Object.freeze({ ok: true, semanticBaseProof: proof });
    } catch (_error) { return failure("semantic-validity-invalid"); }
    finally { if (tag) tag.fill(0); if (bytes) bytes.fill(0); }
  }

  function validSemanticBase({ authority, semanticBaseProof, binding } = {}) {
    const base = baseProofs.get(semanticBaseProof);
    return !!base && base.authority === authority && sameBinding(base.binding, binding);
  }

  global.PocketStarlingSemanticAuthorityShadow = Object.freeze({
    SCHEMA, ALGORITHM, PLACEMENT_GENERATION, SEQUENCE_SCHEMA,
    deriveAuthority, issueInitial, issueSuccessor, attestationForStage,
    authenticate, validSemanticBase,
  });
})(typeof window !== "undefined" ? window : globalThis);
