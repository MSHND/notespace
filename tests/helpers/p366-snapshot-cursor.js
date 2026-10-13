"use strict";

/* Test-only P366 scoped reader.  It deliberately consumes an already
   authenticated P124 session and has no production owner. */

function failure(code) {
  const error = new Error(`P366 snapshot cursor ${code}.`);
  error.code = code;
  return error;
}

function exact(value, fields) {
  return value && typeof value === "object" && !Array.isArray(value)
    && Object.keys(value).length === fields.length
    && fields.every((field) => Object.prototype.hasOwnProperty.call(value, field));
}

function plainObject(value) {
  return value && typeof value === "object" && !Array.isArray(value)
    && Object.prototype.toString.call(value) === "[object Object]";
}

function deepFreeze(value) {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
  Object.freeze(value);
  for (const child of Object.values(value)) deepFreeze(child);
  return value;
}

function snapshot(logical, value, code) {
  const canonical = logical.canonical(value);
  if (!canonical || canonical.ok !== true) throw failure(code);
  try { return deepFreeze(JSON.parse(canonical.bytes)); }
  catch (_error) { throw failure(code); }
}

function validSession(session) {
  return session && typeof session === "object"
    && typeof session.acceptedSealRef === "string" && session.acceptedSealRef
    && typeof session.resolveLogical === "function"
    && typeof session.readContent === "function"
    && typeof session.readPlacement === "function";
}

function validSeal(logical, value) {
  return exact(value, ["schema", "kind", "rootRef", "previousSealRef"])
    && value.schema === logical.SEAL_SCHEMA && value.kind === "candidate-seal"
    && typeof value.rootRef === "string"
    && (value.previousSealRef === null || typeof value.previousSealRef === "string");
}

function validRoot(logical, value) {
  return exact(value, ["schema", "kind", "capacity", "contentRef", "placementRef", "childrenRef", "preservationRef"])
    && value.schema === logical.ROOT_SCHEMA && value.kind === "pocket-root"
    && Number.isInteger(value.capacity) && value.capacity >= 3
    && [value.contentRef, value.placementRef, value.childrenRef, value.preservationRef]
      .every((ref) => typeof ref === "string");
}

function validProjection(value) {
  return exact(value, ["source", "tombstones", "rootExtras", "dataExtras"])
    && exact(value.source, ["schema", "writtenAt"])
    && typeof value.source.schema === "string" && typeof value.source.writtenAt === "string"
    && Array.isArray(value.tombstones) && plainObject(value.rootExtras) && plainObject(value.dataExtras);
}

function validPreservation(logical, value) {
  return exact(value, ["schema", "kind", "value"])
    && value.schema === logical.OBJECT_SCHEMA && value.kind === "preservation"
    && validProjection(value.value);
}

function validTrie(logical, value, kind) {
  if (!exact(value, ["schema", "kind", "hasValue", "valueRef", "children"])
    || value.schema !== logical.OBJECT_SCHEMA || value.kind !== kind
    || typeof value.hasValue !== "boolean"
    || !((value.hasValue && typeof value.valueRef === "string") || (!value.hasValue && value.valueRef === null))
    || !Array.isArray(value.children)) return false;
  const seen = new Set(), keys = [];
  for (const edge of value.children) {
    if (!exact(edge, ["key", "ref"]) || typeof edge.key !== "string" || edge.key.length !== 1
      || typeof edge.ref !== "string" || seen.has(edge.key)) return false;
    seen.add(edge.key);
    keys.push(edge.key);
  }
  const sorted = keys.slice().sort((left, right) => left.localeCompare(right));
  return keys.every((key, index) => key === sorted[index]);
}

function sequenceKind(ref) {
  const match = /^proof-ref:v1:(sequence-leaf|sequence-branch):[0-9a-f]{8}$/.exec(ref);
  return match ? match[1] : null;
}

async function createSnapshotCursor({ session, logical } = {}) {
  if (!validSession(session) || !logical || typeof logical.canonical !== "function"
    || typeof logical.refFor !== "function") throw failure("invalid-cursor-input");

  const logicalCache = new Map(), childrenCache = new Map(), nodes = new Map(), parentByNode = new Map();
  const counters = {
    logicalResolutions: 0,
    logicalCacheHits: 0,
    childrenPageReads: 0,
    contentReads: 0,
    placementReads: 0,
    requestedNodesReturned: 0,
  };

  async function load(ref, kind) {
    const cached = logicalCache.get(ref);
    if (cached) {
      counters.logicalCacheHits += 1;
      if (cached.kind !== kind) throw failure("logical-kind-mismatch");
      return cached.object;
    }
    counters.logicalResolutions += 1;
    let bytes;
    try { bytes = await session.resolveLogical(ref); }
    catch (_error) { throw failure("logical-resolution-failed"); }
    if (typeof bytes !== "string") throw failure("missing-logical-object");
    let observed;
    try { observed = logical.refFor(kind, bytes); }
    catch (_error) { throw failure("logical-ref-mismatch"); }
    if (observed !== ref) throw failure("logical-ref-mismatch");
    let object;
    try { object = JSON.parse(bytes); }
    catch (_error) { throw failure("invalid-logical-bytes"); }
    const canonical = logical.canonical(object);
    if (!canonical || canonical.ok !== true || canonical.bytes !== bytes)
      throw failure("noncanonical-logical-object");
    logicalCache.set(ref, { kind, object });
    return object;
  }

  async function trieValue(rootRef, kind, nodeId) {
    if (typeof nodeId !== "string" || !nodeId) throw failure("invalid-node-id");
    let ref = rootRef;
    for (let index = 0; ; index += 1) {
      const object = await load(ref, kind);
      if (!validTrie(logical, object, kind)) throw failure("invalid-trie-object");
      if (index === nodeId.length) return object.hasValue ? object.valueRef : null;
      const edge = object.children.find((entry) => entry.key === nodeId[index]);
      if (!edge) return null;
      ref = edge.ref;
    }
  }

  async function sequenceItems(ref, capacity) {
    const seen = new Set(), pages = new Map(), items = [];
    const stack = [{ type: "enter", ref, root: true, depth: 0 }];
    let leafDepth = null;
    while (stack.length) {
      const frame = stack.pop();
      if (frame.type === "finish") {
        const page = pages.get(frame.ref);
        const total = page.childRefs.reduce((sum, childRef) => sum + pages.get(childRef).count, 0);
        if (page.count !== total || page.childRefs.some((childRef) => pages.get(childRef).count <= 0))
          throw failure("invalid-sequence-count");
        continue;
      }
      if (seen.has(frame.ref)) throw failure("duplicate-or-cyclic-sequence-page");
      seen.add(frame.ref);
      const kind = sequenceKind(frame.ref);
      if (!kind) throw failure("invalid-sequence-object");
      counters.childrenPageReads += 1;
      const value = await load(frame.ref, kind);
      if (kind === "sequence-leaf") {
        if (!exact(value, ["schema", "kind", "capacity", "count", "items"])
          || value.schema !== logical.SEQUENCE_SCHEMA || value.kind !== kind || value.capacity !== capacity
          || !Number.isInteger(value.count) || value.count < 0 || !Array.isArray(value.items)
          || value.count !== value.items.length || value.items.length > capacity
          || (!frame.root && value.items.length < Math.ceil(capacity / 2))
          || !value.items.every((item) => typeof item === "string" && item))
          throw failure("invalid-sequence-object");
        if (leafDepth === null) leafDepth = frame.depth;
        else if (leafDepth !== frame.depth) throw failure("invalid-sequence-object");
        pages.set(frame.ref, { count: value.count });
        items.push(...value.items);
        continue;
      }
      if (!exact(value, ["schema", "kind", "capacity", "count", "childRefs"])
        || value.schema !== logical.SEQUENCE_SCHEMA || value.kind !== kind || value.capacity !== capacity
        || !Number.isInteger(value.count) || value.count < 0 || !Array.isArray(value.childRefs)
        || value.childRefs.length < (frame.root ? 2 : Math.ceil(capacity / 2))
        || value.childRefs.length > capacity || !value.childRefs.every((childRef) => typeof childRef === "string"))
        throw failure("invalid-sequence-object");
      pages.set(frame.ref, { count: value.count, childRefs: value.childRefs });
      stack.push({ type: "finish", ref: frame.ref });
      for (let index = value.childRefs.length - 1; index >= 0; index -= 1)
        stack.push({ type: "enter", ref: value.childRefs[index], root: false, depth: frame.depth + 1 });
    }
    if (new Set(items).size !== items.length) throw failure("duplicate-children");
    return items;
  }

  const seal = await load(session.acceptedSealRef, "candidate-seal");
  if (!validSeal(logical, seal)) throw failure("invalid-seal");
  const root = await load(seal.rootRef, "pocket-root");
  if (!validRoot(logical, root)) throw failure("invalid-root");
  const preservation = await load(root.preservationRef, "preservation");
  if (!validPreservation(logical, preservation)) throw failure("invalid-preservation");
  snapshot(logical, preservation.value, "invalid-preservation");

  function reachableParent(parentId) {
    return parentId === "root" || nodes.has(parentId);
  }

  function introducesCycle(parentId, nodeId) {
    for (let current = parentId; current !== "root"; current = parentByNode.get(current)) {
      if (current === nodeId || !parentByNode.has(current)) return true;
    }
    return false;
  }

  async function childIdsFor(parentId) {
    const ref = await trieValue(root.childrenRef, "children-trie", parentId);
    return ref === null ? [] : sequenceItems(ref, root.capacity);
  }

  async function readRecord(nodeId, parentId, order) {
    counters.contentReads += 1;
    counters.placementReads += 1;
    let content, placement;
    try { [content, placement] = await Promise.all([session.readContent(nodeId), session.readPlacement(nodeId)]); }
    catch (_error) { throw failure("session-read-failed"); }
    if (!placement || placement.ok !== true || placement.nodeId !== nodeId || placement.parentId !== parentId)
      throw failure("placement-parent-disagreement");
    if (!content || content.ok !== true || content.nodeId !== nodeId || !plainObject(content.payload))
      throw failure("invalid-content-record");
    if (["id", "parentId", "order"].some((key) => Object.prototype.hasOwnProperty.call(content.payload, key)))
      throw failure("reserved-content-payload-key");
    const payload = snapshot(logical, content.payload, "invalid-content-payload");
    return deepFreeze({ id: nodeId, parentId, order, ...payload });
  }

  async function readChildren(parentId) {
    if (typeof parentId !== "string" || !parentId || !reachableParent(parentId))
      throw failure("unreachable-parent");
    const cached = childrenCache.get(parentId);
    if (cached) {
      counters.requestedNodesReturned += cached.length;
      return cached.map((node) => snapshot(logical, node, "cached-node-invalid"));
    }
    const ids = await childIdsFor(parentId);
    const staged = [];
    for (let order = 0; order < ids.length; order += 1) {
      const nodeId = ids[order];
      if (nodes.has(nodeId) || parentByNode.has(nodeId) || introducesCycle(parentId, nodeId))
        throw failure("duplicate-or-cyclic-current-node");
      staged.push(await readRecord(nodeId, parentId, order));
    }
    const frozen = deepFreeze(staged.slice());
    for (const node of frozen) {
      nodes.set(node.id, node);
      parentByNode.set(node.id, parentId);
    }
    childrenCache.set(parentId, frozen);
    counters.requestedNodesReturned += frozen.length;
    return frozen.map((node) => snapshot(logical, node, "cached-node-invalid"));
  }

  async function readRequestedNode(nodeId) {
    if (typeof nodeId !== "string" || !nodeId || !nodes.has(nodeId))
      throw failure("unreachable-node");
    counters.requestedNodesReturned += 1;
    return snapshot(logical, nodes.get(nodeId), "cached-node-invalid");
  }

  function diagnostics() {
    const sessionStats = typeof session.diagnostics === "function" ? session.diagnostics() : null;
    return deepFreeze({
      acceptedSealRef: session.acceptedSealRef,
      rootRef: seal.rootRef,
      ...counters,
      sessionPhysicalFetches: sessionStats && Number.isInteger(sessionStats.physicalFetches)
        ? sessionStats.physicalFetches : null,
      sessionCacheHits: sessionStats && Number.isInteger(sessionStats.cacheHits)
        ? sessionStats.cacheHits : null,
    });
  }

  return Object.freeze({ readChildren, readRequestedNode, diagnostics });
}

module.exports = Object.freeze({ createSnapshotCursor });
