/* Dormant P107a3 migration proof. Never loaded by the live Pocket runtime. */
(function (global) {
  "use strict";
  const SCHEMA = "pocket.starling.bridge.v1";
  const ROOT = "root";
  const fail = (reason) => ({ ok: false, reason });

  function dependencies() {
    const { PocketStarlingShadow: shadow, PocketStarlingPlacementShadow: placement, compareSiblingOrder: compare } = global;
    return shadow && placement && typeof compare === "function" ? { shadow, placement, compare } : null;
  }

  function relationFrom(norm, compare) {
    if (!norm || !Array.isArray(norm.nodes)) return fail("invalid-normalised-document");
    const nodeIds = [], parents = Object.create(null), grouped = Object.create(null);
    for (const node of norm.nodes) {
      if (!node || typeof node.id !== "string" || !node.id || node.id === ROOT || Object.prototype.hasOwnProperty.call(parents, node.id)) return fail("invalid-node-identity");
      const parentId = typeof node.parentId === "string" && node.parentId ? node.parentId : ROOT;
      nodeIds.push(node.id); parents[node.id] = parentId;
      (grouped[parentId] || (grouped[parentId] = [])).push(node);
    }
    const children = Object.create(null);
    for (const [parentId, nodes] of Object.entries(grouped)) children[parentId] = nodes.slice().sort((left, right) => compare(left, right, parentId)).map((node) => node.id);
    return { ok: true, relation: { nodeIds, parents, children } };
  }

  function encode(norm, options = {}) {
    const deps = dependencies(); if (!deps) return fail("bridge-dependency-unavailable");
    const compatibility = deps.shadow.encode(norm); if (!compatibility.ok) return compatibility;
    const derived = relationFrom(norm, deps.compare); if (!derived.ok) return derived;
    const capacity = Object.prototype.hasOwnProperty.call(options, "capacity") ? options.capacity : 4;
    if (!Number.isInteger(capacity) || capacity < 3) return fail("invalid-capacity");
    const structural = deps.placement.build(derived.relation, { capacity }); if (!structural.ok) return structural;
    return { ok: true, bridge: Object.freeze({ schema: SCHEMA, capacity, compatibility: compatibility.shadow, structural: structural.model }) };
  }

  function sameMembership(left, right) {
    if (left.length !== right.length) return false;
    const seen = new Set(left); return seen.size === left.length && right.every((id) => seen.has(id));
  }

  function audit(bridge) {
    const deps = dependencies(); if (!deps) return fail("bridge-dependency-unavailable");
    if (!bridge || bridge.schema !== SCHEMA || !bridge.compatibility || !bridge.structural) return fail("invalid-bridge");
    const decoded = deps.shadow.decode(bridge.compatibility); if (!decoded.ok) return decoded;
    const expected = relationFrom(decoded.norm, deps.compare); if (!expected.ok) return expected;
    const actual = deps.placement.audit(bridge.structural); if (!actual.ok) return actual;
    if (!sameMembership(expected.relation.nodeIds, actual.relation.nodeIds)) return fail("bridge-membership-mismatch");
    for (const nodeId of expected.relation.nodeIds) if (expected.relation.parents[nodeId] !== actual.relation.parents[nodeId]) return fail("bridge-parent-mismatch");
    const parents = new Set([...Object.keys(expected.relation.children), ...Object.keys(actual.relation.children)]);
    for (const parentId of parents) {
      const left = expected.relation.children[parentId] || [], right = actual.relation.children[parentId] || [];
      if (!sameMembership(left, right)) return fail("bridge-membership-mismatch");
      if (left.length !== right.length || left.some((id, index) => id !== right[index])) return fail("bridge-order-mismatch");
    }
    return { ok: true };
  }

  function decodeExact(bridge) {
    const checked = audit(bridge); if (!checked.ok) return checked;
    return dependencies().shadow.decode(bridge.compatibility);
  }

  global.PocketStarlingBridgeShadow = Object.freeze({ SCHEMA, ROOT, encode, build: encode, audit, decodeExact, relationFrom });
})(typeof window !== "undefined" ? window : globalThis);
