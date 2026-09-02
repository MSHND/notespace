/* Dormant P146 accepted-document compatibility materialisation. */
(function (global) {
  "use strict";
  function fail(reason) { return Object.freeze({ ok: false, reason }); }
  function exact(value, fields) { return value && typeof value === "object" && !Array.isArray(value) && Object.keys(value).length === fields.length && fields.every((field) => Object.prototype.hasOwnProperty.call(value, field)); }
  function plainObject(value) { return value && typeof value === "object" && !Array.isArray(value) && Object.prototype.toString.call(value) === "[object Object]"; }
  function dependencies() { const logical = global.PocketStarlingObjectSealShadow; return logical && typeof logical.canonical === "function" && typeof logical.refFor === "function" ? logical : null; }
  function validSession(value) { return value && typeof value === "object" && typeof value.acceptedSealRef === "string" && value.acceptedSealRef && typeof value.resolveLogical === "function" && typeof value.readContent === "function" && typeof value.readPlacement === "function"; }
  function validSeal(logical, value) { return exact(value, ["schema", "kind", "rootRef", "previousSealRef"]) && value.schema === logical.SEAL_SCHEMA && value.kind === "candidate-seal" && typeof value.rootRef === "string" && (value.previousSealRef === null || typeof value.previousSealRef === "string"); }
  function validRoot(logical, value) { return exact(value, ["schema", "kind", "capacity", "contentRef", "placementRef", "childrenRef", "preservationRef"]) && value.schema === logical.ROOT_SCHEMA && value.kind === "pocket-root" && Number.isInteger(value.capacity) && value.capacity >= 3 && [value.contentRef, value.placementRef, value.childrenRef, value.preservationRef].every((ref) => typeof ref === "string"); }
  function validProjection(value) { return exact(value, ["source", "tombstones", "rootExtras", "dataExtras"]) && exact(value.source, ["schema", "writtenAt"]) && typeof value.source.schema === "string" && typeof value.source.writtenAt === "string" && Array.isArray(value.tombstones) && plainObject(value.rootExtras) && plainObject(value.dataExtras); }
  function validPreservation(logical, value) { return exact(value, ["schema", "kind", "value"]) && value.schema === logical.OBJECT_SCHEMA && value.kind === "preservation" && validProjection(value.value); }
  function validTrie(logical, value, kind) { if (!exact(value, ["schema", "kind", "hasValue", "valueRef", "children"]) || value.schema !== logical.OBJECT_SCHEMA || value.kind !== kind || typeof value.hasValue !== "boolean" || !((value.hasValue && typeof value.valueRef === "string") || (!value.hasValue && value.valueRef === null)) || !Array.isArray(value.children)) return false; const seen = new Set(), keys = []; for (const edge of value.children) { if (!exact(edge, ["key", "ref"]) || typeof edge.key !== "string" || edge.key.length !== 1 || typeof edge.ref !== "string" || seen.has(edge.key)) return false; seen.add(edge.key); keys.push(edge.key); } const sorted = keys.slice().sort((a, b) => a.localeCompare(b)); return keys.every((key, index) => key === sorted[index]); }
  function sequenceKind(ref) { const match = /^proof-ref:v1:(sequence-leaf|sequence-branch):[0-9a-f]{8}$/.exec(ref); return match ? match[1] : null; }
  function clone(logical, value) { const canonical = logical.canonical(value); if (!canonical.ok) return null; try { return JSON.parse(canonical.bytes); } catch (_error) { return null; } }
  async function materializeAccepted(session) {
    const logical = dependencies();
    if (!logical || !validSession(session)) return fail("invalid-materialize-session");
    const cache = new Map();
    async function load(ref, kind) {
      if (cache.has(ref)) { const cached = cache.get(ref); return cached.kind === kind ? { ok: true, object: cached.object } : fail("logical-kind-mismatch"); }
      let bytes;
      try { bytes = await session.resolveLogical(ref); } catch (_error) { return fail("logical-resolution-failed"); }
      if (typeof bytes !== "string") return fail("missing-logical-object");
      if (logical.refFor(kind, bytes) !== ref) return fail("logical-ref-mismatch");
      let object;
      try { object = JSON.parse(bytes); } catch (_error) { return fail("invalid-logical-bytes"); }
      const canonical = logical.canonical(object);
      if (!canonical.ok || canonical.bytes !== bytes) return fail("noncanonical-logical-object");
      cache.set(ref, { kind, object });
      return { ok: true, object };
    }
    async function trieValue(rootRef, kind, nodeId) {
      if (typeof nodeId !== "string" || !nodeId) return fail("invalid-node-id");
      let ref = rootRef;
      for (let index = 0; ; index += 1) {
        const loaded = await load(ref, kind);
        if (!loaded.ok) return loaded;
        if (!validTrie(logical, loaded.object, kind)) return fail("invalid-trie-object");
        if (index === nodeId.length) return loaded.object.hasValue ? { ok: true, ref: loaded.object.valueRef } : { ok: true, absent: true };
        const edge = loaded.object.children.find((entry) => entry.key === nodeId[index]);
        if (!edge) return { ok: true, absent: true };
        ref = edge.ref;
      }
    }
    async function sequenceItems(ref, capacity) {
      const seen = new Set(), pages = new Map(), items = [], stack = [{ type: "enter", ref, root: true, depth: 0 }]; let leafDepth = null;
      while (stack.length) {
        const frame = stack.pop();
        if (frame.type === "finish") {
          const page = pages.get(frame.ref), total = page.childRefs.reduce((sum, childRef) => sum + pages.get(childRef).count, 0);
          if (page.count !== total || page.childRefs.some((childRef) => pages.get(childRef).count <= 0)) return fail("invalid-sequence-count");
          continue;
        }
        if (seen.has(frame.ref)) return fail("duplicate-or-cyclic-sequence-page");
        seen.add(frame.ref);
        const kind = sequenceKind(frame.ref);
        if (!kind) return fail("invalid-sequence-object");
        const loaded = await load(frame.ref, kind);
        if (!loaded.ok) return loaded.reason === "logical-kind-mismatch" ? fail("invalid-sequence-object") : loaded;
        const value = loaded.object;
        if (kind === "sequence-leaf") {
          if (!exact(value, ["schema", "kind", "capacity", "count", "items"]) || value.schema !== logical.SEQUENCE_SCHEMA || value.kind !== kind || value.capacity !== capacity || !Number.isInteger(value.count) || value.count < 0 || !Array.isArray(value.items) || value.count !== value.items.length || value.items.length > capacity || (!frame.root && value.items.length < Math.ceil(capacity / 2)) || !value.items.every((item) => typeof item === "string" && item)) return fail("invalid-sequence-object");
          if (leafDepth === null) leafDepth = frame.depth; else if (leafDepth !== frame.depth) return fail("invalid-sequence-object");
          pages.set(frame.ref, { count: value.count }); items.push(...value.items);
          continue;
        }
        if (!exact(value, ["schema", "kind", "capacity", "count", "childRefs"]) || value.schema !== logical.SEQUENCE_SCHEMA || value.kind !== kind || value.capacity !== capacity || !Number.isInteger(value.count) || value.count < 0 || !Array.isArray(value.childRefs) || value.childRefs.length < (frame.root ? 2 : Math.ceil(capacity / 2)) || value.childRefs.length > capacity || !value.childRefs.every((childRef) => typeof childRef === "string")) return fail("invalid-sequence-object");
        pages.set(frame.ref, { count: value.count, childRefs: value.childRefs }); stack.push({ type: "finish", ref: frame.ref }); for (let index = value.childRefs.length - 1; index >= 0; index -= 1) stack.push({ type: "enter", ref: value.childRefs[index], root: false, depth: frame.depth + 1 });
      }
      return { ok: true, items };
    }
    try {
      const seal = await load(session.acceptedSealRef, "candidate-seal");
      if (!seal.ok) return seal;
      if (!validSeal(logical, seal.object)) return fail("invalid-seal");
      const root = await load(seal.object.rootRef, "pocket-root");
      if (!root.ok) return root;
      if (!validRoot(logical, root.object)) return fail("invalid-root");
      const preservation = await load(root.object.preservationRef, "preservation");
      if (!preservation.ok) return preservation;
      if (!validPreservation(logical, preservation.object)) return fail("invalid-preservation");
      const owner = clone(logical, preservation.object.value);
      if (!owner) return fail("invalid-preservation");
      const nodes = [], current = new Set(), stack = [{ type: "parent", parentId: "root" }];
      while (stack.length) {
        const frame = stack.pop();
        if (frame.type === "parent") {
          const located = await trieValue(root.object.childrenRef, "children-trie", frame.parentId);
          if (!located.ok) return located;
          if (located.absent) continue;
          const sequence = await sequenceItems(located.ref, root.object.capacity);
          if (!sequence.ok) return sequence;
          for (let index = sequence.items.length - 1; index >= 0; index -= 1) stack.push({ type: "node", parentId: frame.parentId, nodeId: sequence.items[index], order: index });
          continue;
        }
        if (current.has(frame.nodeId)) return fail("duplicate-or-cyclic-current-node");
        current.add(frame.nodeId);
        let placement, content;
        try { placement = await session.readPlacement(frame.nodeId); content = await session.readContent(frame.nodeId); } catch (_error) { return fail("session-read-failed"); }
        if (!placement || placement.ok !== true || placement.nodeId !== frame.nodeId || placement.parentId !== frame.parentId) return fail("placement-parent-disagreement");
        if (!content || content.ok !== true || content.nodeId !== frame.nodeId || !plainObject(content.payload)) return fail("invalid-content-record");
        if (["id", "parentId", "order"].some((key) => Object.prototype.hasOwnProperty.call(content.payload, key))) return fail("reserved-content-payload-key");
        const payload = clone(logical, content.payload);
        if (!payload || !plainObject(payload)) return fail("invalid-content-payload");
        nodes.push({ id: frame.nodeId, parentId: frame.parentId, order: frame.order, ...payload }); stack.push({ type: "parent", parentId: frame.nodeId });
      }
      return Object.freeze({ ok: true, document: { schema: owner.source.schema, writtenAt: owner.source.writtenAt, nodes, tombstones: owner.tombstones, rootExtras: owner.rootExtras, dataExtras: owner.dataExtras } });
    } catch (_error) { return fail("materialize-failed"); }
  }
  global.PocketStarlingMaterializeShadow = Object.freeze({ materializeAccepted });
})(typeof window !== "undefined" ? window : globalThis);
