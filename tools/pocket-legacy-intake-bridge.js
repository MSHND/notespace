"use strict";

// Dormant Node research adapter for the exact legacy source and an isolated
// Starling genesis. The existing bootstrap owns publication and readback.
// The adapter gates its own callers. A shared target needs separate writer
// admission before accepting this representation from a mixed-version fleet.
const { createHash } = require("node:crypto");
const { isDeepStrictEqual: equal } = require("node:util");
const { POLICY } = require("../sync-service/pocket-sync-http-adapter.js");
const { parseSource } = require("./pocket-legacy-migration-preflight.js");

const SCHEMA = "pocket.legacy-intake.v1";
const CAPSULE = "peMigrationLegacySourcePreserved";
const ORIGINAL_ORDER = "pocketLegacySourceOrder";
const PROVENANCE = "pocketLegacyIntake";
// Reserve room for JSON framing, encryption and base64 at both layers.
const RECORD_BUDGET = Math.floor(POLICY.contentJsonLimitBytes / 4);
const fail = reason => Object.freeze({ ok: false, reason });
const object = value => value !== null && typeof value === "object" && !Array.isArray(value);
const digest = text => createHash("sha256").update(text, "utf8").digest("hex");
const id = value => typeof value === "string" && value.length > 0 && value.length <= 80
  && value.isWellFormed() && value === value.trim() && value !== "__proto__";
const timestamp = value => typeof value === "string" && Number.isFinite(Date.parse(value));
const bounded = value => Buffer.byteLength(JSON.stringify(value), "utf8") <= RECORD_BUDGET;

// JSON has already passed the strict parser. Locate just the capsule objects
// in the authoritative top-level array to preserve their exact source bytes.
function originalCapsules(text) {
  const capsules = new Map();
  let depth = 0, inTree = false, index = -1, start = null, previous = "", key = "";
  for (const { 0: token, index: offset } of text.matchAll(/"(?:\\[\s\S]|[^"\\])*"|[{}\[\]:,]/g)) {
    if (token === "{" || token === "[") {
      if (depth === 1 && key === "mainThoughtTree" && token === "[") inTree = true;
      if (inTree && depth === 2 && token === "{") index += 1;
      if (inTree && depth === 3 && key === CAPSULE && token === "{") start = offset;
      depth += 1;
    } else if (token === "}" || token === "]") {
      depth -= 1;
      if (inTree && depth === 3 && start !== null) {
        capsules.set(index, text.slice(start, offset + 1));
        start = null;
      }
      if (depth === 1) inTree = false;
    }
    key = token === ":" ? JSON.parse(previous) : "";
    previous = token;
  }
  return capsules;
}

function capsuleContext(syncedPocketId, sourceSha256, nodeId) {
  return { syncedPocketId: SCHEMA + ":" + digest(JSON.stringify([syncedPocketId, sourceSha256, nodeId])) };
}

async function openSourceCapsule(pocket, { capsule, capsuleKey, syncedPocketId, sourceSha256, nodeId }) {
  if (capsule?.schema !== SCHEMA) return fail("source-unavailable");
  try {
    const json = await pocket.PocketStarlingCryptoShadow.openObject(
      capsule.record, capsule.ref, capsuleKey, capsuleContext(syncedPocketId, sourceSha256, nodeId),
    );
    return { ok: true, json };
  } catch {
    return fail("source-unavailable");
  }
}

async function stageLegacyIntake(pocket, input = {}) {
  if (!object(input)) return fail("unsupported-writer");
  const { writerSchema, text, sourceSha256, instanceId, syncedPocketId, capsuleKey, hasSourceAuthority } = input;
  if (writerSchema !== SCHEMA) return fail("unsupported-writer");
  const permission = Object.freeze({ writerSchema, sourceSha256, instanceId, syncedPocketId });
  const current = async () => {
    try { return await hasSourceAuthority(permission) === true; } catch { return false; }
  };
  if (!await current()) return fail("source-unavailable");
  if (!pocket?.PocketOutlinePersistencePolicy?.allowsLocalFileText(text) || !text.isWellFormed()) {
    return fail("unsupported-file-size-or-encoding");
  }
  if (digest(text) !== sourceSha256) return fail("source-integrity-mismatch");

  try {
    const parsed = parseSource(text);
    if (!parsed.ok) return fail(parsed.reason);
    const source = parsed.parsed;
    if (!object(source) || !object(source.data) || source.schema !== "portal.export.v1") return fail("invalid-envelope");
    const {
      schema, writtenAt, exportedAt, mainThoughtTree: nodes, mainThoughtTreeTombstones: tombstones, data, ...rootExtras
    } = source;
    const { mainThoughtTree: mirror, mainThoughtTreeTombstones: mirrorTombstones, ...dataExtras } = data;
    if (![nodes, tombstones, mirror, mirrorTombstones].every(Array.isArray)
        || !timestamp(writtenAt) || !timestamp(exportedAt)) return fail("invalid-envelope");
    const max = pocket.PocketDeviceChanges.MAX_COMPARISON_NODES;
    if (nodes.length > max || tombstones.length > max) return fail("too-many-records");
    if (!equal(nodes, mirror) || !equal(tombstones, mirrorTombstones)
        || !equal(rootExtras.pocketGuard, dataExtras.pocketGuard)) return fail("mirror-mismatch");
    const guard = pocket.normaliseGuardMeta(rootExtras.pocketGuard);
    if (!id(instanceId) || instanceId !== guard?.instanceId
        || !equal(rootExtras.pocketGuard, { schema: "pocket.guard.v1", ...guard })
        || Object.hasOwn(rootExtras, PROVENANCE) || Object.hasOwn(dataExtras, PROVENANCE)) return fail("invalid-guard");

    const ids = new Set(), orders = new Map();
    for (const node of nodes) {
      if (!object(node) || !id(node.id) || node.id === "root" || ids.has(node.id) || !id(node.parentId)
          || !Number.isSafeInteger(node.order) || !timestamp(node.updatedAt)
          || typeof node.source !== "string" || !node.source.trim()
          || (Object.hasOwn(node, "details") && typeof node.details !== "string")
          || typeof node.label !== "string" || !node.label.trim() || !node.label.isWellFormed()
          || Object.hasOwn(node, "pe") || Object.hasOwn(node, ORIGINAL_ORDER)
          || (Object.hasOwn(node, CAPSULE) && !object(node[CAPSULE]))) return fail("invalid-node");
      if (!orders.has(node.parentId)) orders.set(node.parentId, new Set());
      const siblings = orders.get(node.parentId);
      if (siblings.has(node.order)) return fail("ambiguous-order");
      if (!bounded(node)) return fail("oversized-record");
      siblings.add(node.order);
      ids.add(node.id);
    }
    for (const entry of tombstones) {
      if (!object(entry) || !id(entry.id) || entry.id === "root" || ids.has(entry.id)
          || !timestamp(entry.deletedAt)) return fail("invalid-tombstone");
      ids.add(entry.id);
    }
    rootExtras[PROVENANCE] = { schema: SCHEMA, sourceSha256, exportedAt };
    if (!bounded({ tombstones, rootExtras, dataExtras })) return fail("oversized-record");

    const norm = { schema, writtenAt, nodes, tombstones, rootExtras, dataExtras };
    const relation = pocket.PocketStarlingBridgeShadow.relationFrom(norm, pocket.compareSiblingOrder);
    if (!relation.ok || !pocket.PocketStarlingPlacementShadow.build(relation.relation, { capacity: 4 }).ok) {
      return fail("invalid-placement");
    }
    const ranks = new Map();
    for (const siblings of Object.values(relation.relation.children)) {
      siblings.forEach((nodeId, rank) => ranks.set(nodeId, rank));
    }
    const originals = originalCapsules(text);
    const crypto = pocket.PocketStarlingCryptoShadow;
    crypto.validateContext({ syncedPocketId });
    norm.nodes = nodes.map(node => ({ ...node }));
    for (const [index, node] of norm.nodes.entries()) {
      if (ranks.get(node.id) !== node.order) node[ORIGINAL_ORDER] = node.order;
      if (!Object.hasOwn(node, CAPSULE)) continue;
      const json = originals.get(index);
      if (!json || !equal(JSON.parse(json), node[CAPSULE])) return fail("source-integrity-mismatch");
      const sealed = await crypto.sealObject(json, capsuleKey, capsuleContext(syncedPocketId, sourceSha256, node.id));
      node[CAPSULE] = { schema: SCHEMA, ...sealed };
      if (!bounded(node)) return fail("oversized-record");
    }
    if (!await current()) return fail("source-unavailable");

    async function save({ masterKey, semanticAuthority, objectHeadService, operationIdFactory } = {}) {
      if (masterKey === capsuleKey || !await current()) return fail("source-unavailable");
      try {
        const result = await pocket.PocketStarlingOwnerBootstrap.composeInitialBootstrap({
          objectHeadService, operationIdFactory,
          normaliseInput: () => norm,
          normaliseRootExtras: () => dataExtras,
        }, { payload: source, syncedPocketId, masterKey, semanticAuthority, sourceGuard: current });
        return result.ok ? { ok: true, outcome: "verified", head: result.head } : fail(result.reason);
      } catch {
        return fail("bootstrap-unavailable");
      }
    }
    return Object.freeze({ ok: true, outcome: "staged", save });
  } catch {
    return fail("unsupported-document");
  }
}

module.exports = { SCHEMA, stageLegacyIntake, openSourceCapsule };
