"use strict";

async function semanticBase(c, { acceptedSealRef, resolveLogical, syncedPocketId }) {
  const sync = c.PocketSyncCrypto, semantic = c.PocketStarlingSemanticAuthorityShadow,
    rawSeal = resolveLogical(acceptedSealRef), seal = typeof rawSeal === "string" ? JSON.parse(rawSeal) : rawSeal;
  if (!sync || !semantic || !seal || !seal.rootRef) throw new Error("semantic test fixture unavailable");
  const wrappingKey = await sync.generateDeviceWrappingKey(), envelopeContext = {
      syncedPocketId, envelopeId: "semantic-test-device", envelopeKind: "device", envelopeVersion: 1,
    }, bundle = await sync.createMasterKeyBundle([{ context: envelopeContext, wrappingKey }], { semanticAuthority: true }),
    audit = c.PocketStarlingObjectSealShadow.auditCandidateSeal(acceptedSealRef, resolveLogical),
    auditProof = c.PocketStarlingObjectSealShadow.semanticAuditProvenance(audit),
    issued = await semantic.issueInitial({ authority: bundle.semanticAuthority, auditProof }),
    rawRoot = resolveLogical(seal.rootRef), root = typeof rawRoot === "string" ? JSON.parse(rawRoot) : rawRoot,
    binding = Object.freeze({
      syncedPocketId, logicalSealRef: acceptedSealRef, logicalRootRef: seal.rootRef,
      previousLogicalSealRef: seal.previousSealRef, logicalSealSchema: "pocket.starling.candidate-seal.v1",
      logicalRootSchema: "pocket.starling.logical-root.v1", logicalObjectSchema: "pocket.starling.logical-object.v1",
      sequenceSchema: "pocket.starling.sequence-page.v2", placementGeneration: "pocket.starling.placement-relation.v1",
    }), semanticValidity = semantic.attestationForStage({ authority: bundle.semanticAuthority, proof: issued.proof, binding }),
    authenticated = await semantic.authenticate({ authority: bundle.semanticAuthority, semanticValidity, binding });
  if (!audit.ok || !auditProof || !issued.ok || !semanticValidity || !authenticated.ok)
    throw new Error("semantic test fixture authentication failed");
  if (!root || root.schema !== binding.logicalRootSchema) throw new Error("semantic test fixture root unavailable");
  return Object.freeze({ syncedPocketId, semanticAuthority: bundle.semanticAuthority,
    semanticBaseProof: authenticated.semanticBaseProof, semanticValidityProof: issued.proof, masterKey: bundle.masterKey,
    envelope: Object.freeze({ wrappingKey, envelopeContext, record: bundle.envelopes[0].record }) });
}

async function createBase(c, input) {
  const semantic = await semanticBase(c, input);
  return c.PocketStarlingLogicalEditShadow.createBase({ ...input, ...semantic });
}

async function authenticateResolver(c, { resolver, accepted, authority, syncedPocketId }) {
  const semanticValidity = resolver.semanticValidity(), binding = Object.freeze({
      syncedPocketId, logicalSealRef: resolver.acceptedSealRef, logicalRootRef: accepted.handle.seal.rootRef,
      previousLogicalSealRef: accepted.handle.seal.previousSealRef, logicalSealSchema: "pocket.starling.candidate-seal.v1",
      logicalRootSchema: "pocket.starling.logical-root.v1", logicalObjectSchema: "pocket.starling.logical-object.v1",
      sequenceSchema: "pocket.starling.sequence-page.v2", placementGeneration: "pocket.starling.placement-relation.v1",
    }), authenticated = await c.PocketStarlingSemanticAuthorityShadow.authenticate({
      authority, semanticValidity, binding,
    });
  if (!semanticValidity || !authenticated.ok) throw new Error("semantic resolver authentication failed");
  return authenticated.semanticBaseProof;
}

module.exports = { semanticBase, createBase, authenticateResolver };
