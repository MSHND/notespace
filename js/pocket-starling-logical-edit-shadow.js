/* Dormant P114 fresh logical working-set experiment. It path-copies only an
   authenticated content path and emits an unadopted P109 logical frontier. */
(function (global) {
  "use strict";

  const baseStates = new WeakMap();

  function fail(reason, extra = {}) {
    return { ok: false, reason, ...extra };
  }

  function dependencies() {
    const logical = global.PocketStarlingObjectSealShadow;
    return logical &&
      typeof logical.canonical === "function" &&
      typeof logical.refFor === "function"
      ? { ok: true, logical }
      : fail("logical-dependency-unavailable");
  }

  function exact(value, fields) {
    return (
      value &&
      typeof value === "object" &&
      !Array.isArray(value) &&
      Object.keys(value).length === fields.length &&
      fields.every((field) =>
        Object.prototype.hasOwnProperty.call(value, field),
      )
    );
  }

  function diagnosticsFor(state) {
    return Object.freeze({
      logicalFetches: state.stats.logicalFetches,
      logicalCacheHits: state.stats.logicalCacheHits,
    });
  }

  async function load(state, ref, expectedKind) {
    if (state.cache.has(ref)) {
      state.stats.logicalCacheHits += 1;
      const cached = state.cache.get(ref);
      return cached.expectedKind === expectedKind
        ? { ok: true, ...cached }
        : fail("logical-ref-mismatch", { ref });
    }
    let bytes;
    state.stats.logicalFetches += 1;
    try {
      bytes = await state.resolveLogical(ref);
    } catch (_error) {
      return fail("logical-resolution-failed", { ref });
    }
    if (typeof bytes !== "string")
      return fail("missing-logical-object", { ref });
    if (state.logical.refFor(expectedKind, bytes) !== ref)
      return fail("logical-ref-mismatch", { ref });
    let object;
    try {
      object = JSON.parse(bytes);
    } catch (_error) {
      return fail("invalid-logical-bytes", { ref });
    }
    const recanonical = state.logical.canonical(object);
    if (!recanonical.ok || recanonical.bytes !== bytes)
      return fail("noncanonical-logical-object", { ref });
    const loaded = { expectedKind, bytes, object };
    state.cache.set(ref, loaded);
    return { ok: true, ...loaded };
  }

  function validSeal(logical, value) {
    return (
      exact(value, ["schema", "kind", "rootRef", "previousSealRef"]) &&
      value.schema === logical.SEAL_SCHEMA &&
      value.kind === "candidate-seal" &&
      typeof value.rootRef === "string" &&
      (value.previousSealRef === null ||
        typeof value.previousSealRef === "string")
    );
  }

  function validRoot(logical, value) {
    return (
      exact(value, [
        "schema",
        "kind",
        "capacity",
        "contentRef",
        "placementRef",
        "childrenRef",
        "preservationRef",
      ]) &&
      value.schema === logical.ROOT_SCHEMA &&
      value.kind === "pocket-root" &&
      Number.isInteger(value.capacity) &&
      value.capacity >= 2 &&
      [
        value.contentRef,
        value.placementRef,
        value.childrenRef,
        value.preservationRef,
      ].every((ref) => typeof ref === "string")
    );
  }

  function validContentTrie(logical, value) {
    if (
      !exact(value, ["schema", "kind", "hasValue", "valueRef", "children"]) ||
      value.schema !== logical.OBJECT_SCHEMA ||
      value.kind !== "content-trie" ||
      typeof value.hasValue !== "boolean" ||
      !(
        (value.hasValue && typeof value.valueRef === "string") ||
        (!value.hasValue && value.valueRef === null)
      ) ||
      !Array.isArray(value.children)
    )
      return false;
    const keys = [],
      seen = new Set();
    for (const edge of value.children) {
      if (
        !exact(edge, ["key", "ref"]) ||
        typeof edge.key !== "string" ||
        edge.key.length !== 1 ||
        typeof edge.ref !== "string" ||
        seen.has(edge.key)
      )
        return false;
      seen.add(edge.key);
      keys.push(edge.key);
    }
    const sorted = keys
      .slice()
      .sort((left, right) => left.localeCompare(right));
    return keys.every((key, index) => key === sorted[index]);
  }

  function validContentRecord(logical, value, nodeId) {
    return (
      exact(value, ["schema", "kind", "nodeId", "payload"]) &&
      value.schema === logical.OBJECT_SCHEMA &&
      value.kind === "content-record" &&
      value.nodeId === nodeId
    );
  }

  async function createBase(input) {
    const dependency = dependencies();
    if (!dependency.ok) return dependency;
    if (
      !input ||
      typeof input !== "object" ||
      typeof input.acceptedSealRef !== "string" ||
      typeof input.resolveLogical !== "function"
    )
      return fail("invalid-logical-base");
    const state = {
        logical: dependency.logical,
        acceptedSealRef: input.acceptedSealRef,
        resolveLogical: input.resolveLogical,
        cache: new Map(),
        stats: { logicalFetches: 0, logicalCacheHits: 0 },
        seal: null,
        root: null,
      },
      seal = await load(state, input.acceptedSealRef, "candidate-seal");
    if (!seal.ok) return seal;
    if (!validSeal(state.logical, seal.object)) return fail("invalid-seal");
    const root = await load(state, seal.object.rootRef, "pocket-root");
    if (!root.ok) return root;
    if (!validRoot(state.logical, root.object)) return fail("invalid-root");
    state.seal = seal.object;
    state.root = root.object;
    const base = Object.freeze({});
    baseStates.set(base, state);
    return Object.freeze({
      ok: true,
      base,
      diagnostics: diagnosticsFor(state),
    });
  }

  function materialise(state, frontier, kind, object) {
    const encoded = state.logical.canonical(object);
    if (!encoded.ok) return fail("unsupported-payload-material");
    const ref = state.logical.refFor(kind, encoded.bytes),
      existingNew = frontier.get(ref),
      existingBase = state.cache.get(ref);
    if (
      (existingNew !== undefined && existingNew !== encoded.bytes) ||
      (existingBase && existingBase.bytes !== encoded.bytes)
    )
      return fail("logical-ref-collision", { ref });
    if (existingNew === undefined) frontier.set(ref, encoded.bytes);
    return { ok: true, ref, bytes: encoded.bytes };
  }

  function copiedChildren(children, key = null, replacementRef = null) {
    return children.map((edge) => ({
      key: edge.key,
      ref: edge.key === key ? replacementRef : edge.ref,
    }));
  }

  async function editPayload(base, nodeId, newPayload) {
    const state = baseStates.get(base);
    if (!state) return fail("invalid-base-token");
    if (typeof nodeId !== "string" || nodeId.length === 0)
      return fail("invalid-node-id");
    const payload = state.logical.canonical(newPayload);
    if (!payload.ok) return fail("unsupported-payload-material");
    const clonedPayload = JSON.parse(payload.bytes),
      path = [];
    let ref = state.root.contentRef;
    for (let offset = 0; ; offset += 1) {
      const loaded = await load(state, ref, "content-trie");
      if (!loaded.ok) return loaded;
      if (!validContentTrie(state.logical, loaded.object))
        return fail("invalid-content-trie", { ref });
      path.push({ ref, object: loaded.object });
      if (offset === nodeId.length) break;
      const edge = loaded.object.children.find(
        (item) => item.key === nodeId[offset],
      );
      if (!edge) return fail("unknown-node");
      ref = edge.ref;
    }
    const terminal = path[path.length - 1].object;
    if (!terminal.hasValue) return fail("unknown-node");
    const record = await load(state, terminal.valueRef, "content-record");
    if (!record.ok) return record;
    if (!validContentRecord(state.logical, record.object, nodeId))
      return fail("invalid-content-record");
    const priorPayload = state.logical.canonical(record.object.payload);
    if (!priorPayload.ok) return fail("invalid-content-record");
    if (priorPayload.bytes === payload.bytes)
      return Object.freeze({ ok: true, changed: false, reason: "no-change" });

    const frontier = new Map(),
      changedRecord = materialise(state, frontier, "content-record", {
        schema: state.logical.OBJECT_SCHEMA,
        kind: "content-record",
        nodeId,
        payload: clonedPayload,
      });
    if (!changedRecord.ok) return changedRecord;
    let changedTrie = materialise(state, frontier, "content-trie", {
      schema: state.logical.OBJECT_SCHEMA,
      kind: "content-trie",
      hasValue: true,
      valueRef: changedRecord.ref,
      children: copiedChildren(terminal.children),
    });
    if (!changedTrie.ok) return changedTrie;
    for (let index = path.length - 2; index >= 0; index -= 1) {
      const old = path[index].object;
      changedTrie = materialise(state, frontier, "content-trie", {
        schema: state.logical.OBJECT_SCHEMA,
        kind: "content-trie",
        hasValue: old.hasValue,
        valueRef: old.valueRef,
        children: copiedChildren(
          old.children,
          nodeId[index],
          changedTrie.ref,
        ),
      });
      if (!changedTrie.ok) return changedTrie;
    }
    const root = materialise(state, frontier, "pocket-root", {
      schema: state.logical.ROOT_SCHEMA,
      kind: "pocket-root",
      capacity: state.root.capacity,
      contentRef: changedTrie.ref,
      placementRef: state.root.placementRef,
      childrenRef: state.root.childrenRef,
      preservationRef: state.root.preservationRef,
    });
    if (!root.ok) return root;
    const seal = materialise(state, frontier, "candidate-seal", {
      schema: state.logical.SEAL_SCHEMA,
      kind: "candidate-seal",
      rootRef: root.ref,
      previousSealRef: state.acceptedSealRef,
    });
    if (!seal.ok) return seal;
    const newLogicalRefs = Object.freeze(Array.from(frontier.keys())),
      resolveLogical = (logicalRef) => frontier.get(logicalRef),
      candidate = Object.freeze({
        rootRef: root.ref,
        sealRef: seal.ref,
        newLogicalRefs,
        resolveLogical,
        diagnostics: Object.freeze({
          logicalFetches: state.stats.logicalFetches,
          logicalCacheHits: state.stats.logicalCacheHits,
          pathObjectCount: path.length + 1,
          newLogicalObjectCount: newLogicalRefs.length,
        }),
      });
    return Object.freeze({ ok: true, changed: true, candidate });
  }

  function diagnostics(base) {
    const state = baseStates.get(base);
    return state ? diagnosticsFor(state) : fail("invalid-base-token");
  }

  global.PocketStarlingLogicalEditShadow = Object.freeze({
    createBase,
    editPayload,
    diagnostics,
  });
})(typeof window !== "undefined" ? window : globalThis);
