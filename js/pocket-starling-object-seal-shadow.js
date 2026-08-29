/* Dormant P109 logical-object experiment. "Proof refs" below provide only
   deterministic, non-cryptographic byte integrity. They are not authority,
   production crypto, ciphertext IDs, server object IDs, or a storage format. */
(function (global) {
  "use strict";
  const ROOT_SCHEMA = "pocket.starling.logical-root.v1",
    SEAL_SCHEMA = "pocket.starling.candidate-seal.v1",
    OBJECT_SCHEMA = "pocket.starling.logical-object.v1";
  const fail = (reason, extra = {}) => ({ ok: false, reason, ...extra });
  function plain(value, seen = new Set()) {
    if (
      value === null ||
      typeof value === "string" ||
      typeof value === "boolean"
    )
      return { ok: true, value };
    if (typeof value === "number")
      return Number.isFinite(value)
        ? { ok: true, value }
        : fail("unsupported-proof-material");
    if (
      typeof value !== "object" ||
      seen.has(value) ||
      (!Array.isArray(value) &&
        Object.prototype.toString.call(value) !== "[object Object]")
    )
      return fail("unsupported-proof-material");
    seen.add(value);
    const out = Array.isArray(value) ? [] : {};
    for (const key of Object.keys(value)) {
      const child = plain(value[key], seen);
      if (!child.ok) return child;
      out[key] = child.value;
    }
    seen.delete(value);
    return { ok: true, value: out };
  }
  function canonical(value) {
    const safe = plain(value);
    if (!safe.ok) return safe;
    function encode(v) {
      if (v === null) return "null";
      if (typeof v === "string") return JSON.stringify(v);
      if (typeof v === "number" || typeof v === "boolean") return String(v);
      if (Array.isArray(v)) return "[" + v.map(encode).join(",") + "]";
      return (
        "{" +
        Object.keys(v)
          .sort()
          .map((k) => JSON.stringify(k) + ":" + encode(v[k]))
          .join(",") +
        "}"
      );
    }
    return { ok: true, bytes: encode(safe.value) };
  }
  function hash(text) {
    let h = 2166136261;
    for (let i = 0; i < text.length; i += 1) {
      h ^= text.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    return (h >>> 0).toString(16).padStart(8, "0");
  }
  function refFor(kind, bytes) {
    return `proof-ref:v1:${kind}:${hash("p109|" + kind + "|" + bytes)}`;
  }
  function exact(value, keys) {
    return (
      value &&
      typeof value === "object" &&
      !Array.isArray(value) &&
      Object.keys(value).sort().join("|") === keys.slice().sort().join("|")
    );
  }
  function createStager(entries = []) {
    const store = new Map(entries),
      cache = new WeakMap();
    return Object.freeze({ store, cache });
  }
  function put(stager, kind, object, source, newRefs) {
    const encoded = canonical(object);
    if (!encoded.ok) return encoded;
    const ref = refFor(kind, encoded.bytes),
      existing = stager.store.get(ref);
    if (existing !== undefined && existing !== encoded.bytes)
      return fail("proof-ref-collision", { ref });
    if (existing === undefined) {
      stager.store.set(ref, encoded.bytes);
      newRefs.push(ref);
    }
    if (source && typeof source === "object") {
      let refs = stager.cache.get(source);
      if (!refs) {
        refs = new Map();
        stager.cache.set(source, refs);
      }
      refs.set(kind, ref);
    }
    return { ok: true, ref };
  }
  function cached(stager, source, kind) {
    if (!source || typeof source !== "object") return null;
    const refs = stager.cache.get(source);
    return refs ? refs.get(kind) : null;
  }
  function encodeRecord(stager, record, kind, newRefs, stats) {
    stats.sourceObjectVisits += 1;
    const prior = cached(stager, record, kind);
    if (prior) return { ok: true, ref: prior };
    const object =
      kind === "content-record"
        ? {
            schema: OBJECT_SCHEMA,
            kind,
            nodeId: record.nodeId,
            payload: record.payload,
          }
        : {
            schema: OBJECT_SCHEMA,
            kind,
            nodeId: record.nodeId,
            parentId: record.parentId,
          };
    return put(stager, kind, object, record, newRefs);
  }
  function encodeSequence(stager, page, newRefs, stats) {
    stats.sourceObjectVisits += 1;
    const prior = cached(stager, page, `sequence-${page.kind}`);
    if (prior) return { ok: true, ref: prior };
    let object;
    if (page.kind === "leaf")
      object = {
        schema: OBJECT_SCHEMA,
        kind: "sequence-leaf",
        capacity: page.capacity,
        count: page.count,
        items: page.items,
      };
    else {
      const childRefs = [];
      for (const child of page.children) {
        const encoded = encodeSequence(stager, child, newRefs, stats);
        if (!encoded.ok) return encoded;
        childRefs.push(encoded.ref);
      }
      object = {
        schema: OBJECT_SCHEMA,
        kind: "sequence-branch",
        capacity: page.capacity,
        count: page.count,
        childRefs,
      };
    }
    return put(stager, object.kind, object, page, newRefs);
  }
  function encodeTrie(stager, node, kind, valueEncoder, newRefs, stats) {
    stats.sourceObjectVisits += 1;
    const prior = cached(stager, node, kind);
    if (prior) return { ok: true, ref: prior };
    let valueRef = null;
    if (node.hasValue) {
      const value = valueEncoder(stager, node.value, newRefs, stats);
      if (!value.ok) return value;
      valueRef = value.ref;
    }
    const children = [];
    for (const [key, child] of node.children) {
      const encoded = encodeTrie(
        stager,
        child,
        kind,
        valueEncoder,
        newRefs,
        stats,
      );
      if (!encoded.ok) return encoded;
      children.push({ key, ref: encoded.ref });
    }
    const object = {
      schema: OBJECT_SCHEMA,
      kind,
      hasValue: node.hasValue,
      valueRef,
      children,
    };
    return put(stager, kind, object, node, newRefs);
  }
  const contentValue = (s, v, n, d) =>
      encodeRecord(s, v, "content-record", n, d),
    placementValue = (s, v, n, d) =>
      encodeRecord(s, v, "placement-record", n, d),
    childrenValue = (s, v, n, d) => encodeSequence(s, v, n, d);
  function stageCandidate(stager, state, options = {}) {
    if (
      !stager ||
      !stager.store ||
      !state ||
      !state.content ||
      !state.structural ||
      !state.preservation
    )
      return fail("invalid-stage-input");
    const previousSealRef =
      options.previousSealRef === undefined ? null : options.previousSealRef;
    if (previousSealRef !== null && typeof previousSealRef !== "string")
      return fail("invalid-previous-seal-ref");
    const newRefs = [],
      stats = { sourceObjectVisits: 0 };
    const content = encodeTrie(
      stager,
      state.content,
      "content-trie",
      contentValue,
      newRefs,
      stats,
    );
    if (!content.ok) return content;
    const placements = encodeTrie(
      stager,
      state.structural.placements,
      "placement-trie",
      placementValue,
      newRefs,
      stats,
    );
    if (!placements.ok) return placements;
    const children = encodeTrie(
      stager,
      state.structural.children,
      "children-trie",
      childrenValue,
      newRefs,
      stats,
    );
    if (!children.ok) return children;
    stats.sourceObjectVisits += 1;
    let preservationRef = cached(stager, state.preservation, "preservation");
    if (!preservationRef) {
      const stored = put(
        stager,
        "preservation",
        {
          schema: OBJECT_SCHEMA,
          kind: "preservation",
          value: state.preservation,
        },
        state.preservation,
        newRefs,
      );
      if (!stored.ok) return stored;
      preservationRef = stored.ref;
    }
    const rootObject = {
      schema: ROOT_SCHEMA,
      kind: "pocket-root",
      capacity: state.capacity,
      contentRef: content.ref,
      placementRef: placements.ref,
      childrenRef: children.ref,
      preservationRef,
    };
    const root = put(stager, "pocket-root", rootObject, null, newRefs);
    if (!root.ok) return root;
    const sealObject = {
      schema: SEAL_SCHEMA,
      kind: "candidate-seal",
      rootRef: root.ref,
      previousSealRef,
    };
    const seal = put(stager, "candidate-seal", sealObject, null, newRefs);
    if (!seal.ok) return seal;
    return {
      ok: true,
      stage: Object.freeze({
        rootRef: root.ref,
        sealRef: seal.ref,
        rootObject: Object.freeze(rootObject),
        sealObject: Object.freeze(sealObject),
        newRefs: Object.freeze(newRefs.slice()),
        diagnostics: Object.freeze({
          newObjectCount: newRefs.length,
          sourceObjectVisits: stats.sourceObjectVisits,
        }),
      }),
    };
  }
  function exportEntries(stager) {
    return Array.from(stager.store.entries()).map(([ref, bytes]) => [
      ref,
      bytes,
    ]);
  }
  function verifyNewObjectPresence(stage, hasRef, options = {}) {
    if (!stage || !Array.isArray(stage.newRefs) || typeof hasRef !== "function")
      return fail("invalid-presence-proof");
    if (
      options.baseComplete !== true &&
      stage.sealObject.previousSealRef !== null
    )
      return fail("base-completeness-required");
    for (const ref of stage.newRefs)
      if (!hasRef(ref)) return fail("missing-new-object", { ref });
    return {
      ok: true,
      checked: stage.newRefs.length,
      conditionalOnRetention: stage.sealObject.previousSealRef !== null,
    };
  }
  function kindFromRef(ref) {
    const match = /^proof-ref:v1:([^:]+):[0-9a-f]{8}$/.exec(ref);
    return match ? match[1] : null;
  }
  function loader(resolver) {
    const cache = new Map(),
      stats = { fetches: 0, cacheHits: 0 };
    function load(ref, expectedKind) {
      if (cache.has(ref)) {
        stats.cacheHits += 1;
        return { ok: true, object: cache.get(ref) };
      }
      if (typeof resolver !== "function") return fail("invalid-resolver");
      const bytes = resolver(ref);
      stats.fetches += 1;
      if (typeof bytes !== "string") return fail("missing-object", { ref });
      const kind = kindFromRef(ref);
      if (!kind || kind !== expectedKind || refFor(kind, bytes) !== ref)
        return fail("object-ref-mismatch", { ref });
      let object;
      try {
        object = JSON.parse(bytes);
      } catch (_error) {
        return fail("invalid-object-bytes", { ref });
      }
      const recanonical = canonical(object);
      if (!recanonical.ok || recanonical.bytes !== bytes)
        return fail("noncanonical-object", { ref });
      if (
        object.kind !== expectedKind ||
        object.schema !==
          (expectedKind === "pocket-root"
            ? ROOT_SCHEMA
            : expectedKind === "candidate-seal"
              ? SEAL_SCHEMA
              : OBJECT_SCHEMA)
      )
        return fail("invalid-object-kind", { ref });
      cache.set(ref, object);
      return { ok: true, object };
    }
    return { load, stats };
  }
  function validateSeal(value) {
    return (
      exact(value, ["schema", "kind", "rootRef", "previousSealRef"]) &&
      value.schema === SEAL_SCHEMA &&
      value.kind === "candidate-seal" &&
      typeof value.rootRef === "string" &&
      (value.previousSealRef === null ||
        typeof value.previousSealRef === "string")
    );
  }
  function validateRoot(value) {
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
      value.schema === ROOT_SCHEMA &&
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
  function openFromAcceptedSealRef(acceptedSealRef, resolver) {
    const io = loader(resolver),
      seal = io.load(acceptedSealRef, "candidate-seal");
    if (!seal.ok) return seal;
    if (!validateSeal(seal.object)) return fail("invalid-seal");
    const root = io.load(seal.object.rootRef, "pocket-root");
    if (!root.ok) return root;
    if (!validateRoot(root.object)) return fail("invalid-root-object");
    return {
      ok: true,
      handle: Object.freeze({
        acceptedSealRef,
        seal: seal.object,
        root: root.object,
        io,
      }),
      diagnostics: { fetches: io.stats.fetches, cacheHits: io.stats.cacheHits },
    };
  }
  function validateTrie(object, kind) {
    if (
      !exact(object, ["schema", "kind", "hasValue", "valueRef", "children"]) ||
      object.kind !== kind ||
      typeof object.hasValue !== "boolean" ||
      !(
        (object.hasValue && typeof object.valueRef === "string") ||
        (!object.hasValue && object.valueRef === null)
      ) ||
      !Array.isArray(object.children)
    )
      return false;
    const keys = [],
      seenKeys = new Set();
    for (const edge of object.children) {
      if (
        !exact(edge, ["key", "ref"]) ||
        typeof edge.key !== "string" ||
        edge.key.length !== 1 ||
        typeof edge.ref !== "string" ||
        seenKeys.has(edge.key)
      )
        return false;
      seenKeys.add(edge.key);
      keys.push(edge.key);
    }
    const sorted = keys
      .slice()
      .sort((left, right) => left.localeCompare(right));
    return keys.every((key, index) => key === sorted[index]);
  }
  function readTrie(handle, rootRef, trieKind, recordKind, nodeId) {
    if (typeof nodeId !== "string" || nodeId.length === 0)
      return fail("invalid-node-id");
    let ref = rootRef;
    for (let offset = 0; ; offset += 1) {
      const loaded = handle.io.load(ref, trieKind);
      if (!loaded.ok) return loaded;
      if (!validateTrie(loaded.object, trieKind))
        return fail("invalid-trie-object", { ref });
      if (offset === nodeId.length) {
        if (!loaded.object.hasValue) return fail("unknown-node");
        const record = handle.io.load(loaded.object.valueRef, recordKind);
        if (!record.ok) return record;
        return {
          ok: true,
          record: record.object,
          diagnostics: {
            fetches: handle.io.stats.fetches,
            cacheHits: handle.io.stats.cacheHits,
          },
        };
      }
      const edge = loaded.object.children.find(
        (item) => item.key === nodeId[offset],
      );
      if (!edge) return fail("unknown-node");
      ref = edge.ref;
    }
  }
  function readContent(handle, nodeId) {
    const result = readTrie(
      handle,
      handle.root.contentRef,
      "content-trie",
      "content-record",
      nodeId,
    );
    if (!result.ok) return result;
    if (
      !exact(result.record, ["schema", "kind", "nodeId", "payload"]) ||
      result.record.nodeId !== nodeId
    )
      return fail("invalid-content-record");
    return {
      ok: true,
      nodeId,
      payload: result.record.payload,
      diagnostics: result.diagnostics,
    };
  }
  function readPlacement(handle, nodeId) {
    const result = readTrie(
      handle,
      handle.root.placementRef,
      "placement-trie",
      "placement-record",
      nodeId,
    );
    if (!result.ok) return result;
    if (
      !exact(result.record, ["schema", "kind", "nodeId", "parentId"]) ||
      result.record.nodeId !== nodeId ||
      typeof result.record.parentId !== "string"
    )
      return fail("invalid-placement-record");
    return {
      ok: true,
      nodeId,
      parentId: result.record.parentId,
      diagnostics: result.diagnostics,
    };
  }
  function decodeSequence(io, ref, seen, capacity, isRoot = true) {
    if (seen.has(ref)) return fail("object-cycle");
    seen.add(ref);
    const kind = kindFromRef(ref);
    if (kind !== "sequence-leaf" && kind !== "sequence-branch")
      return fail("invalid-sequence-object", { ref });
    const loaded = io.load(ref, kind);
    if (!loaded.ok)
      return loaded.reason === "invalid-object-kind"
        ? fail("invalid-sequence-object", { ref })
        : loaded;
    const o = loaded.object;
    let page;
    if (
      kind === "sequence-leaf" &&
      exact(o, ["schema", "kind", "capacity", "count", "items"]) &&
      Number.isInteger(o.capacity) &&
      o.capacity >= 2 &&
      o.capacity === capacity &&
      Number.isInteger(o.count) &&
      o.count >= 0 &&
      Array.isArray(o.items) &&
      o.count === o.items.length &&
      o.items.length <= capacity &&
      (isRoot || o.items.length > 0) &&
      o.items.every((item) => typeof item === "string")
    )
      page = Object.freeze({
        kind: "leaf",
        capacity: o.capacity,
        count: o.count,
        items: Object.freeze(o.items),
      });
    else if (
      kind === "sequence-branch" &&
      exact(o, ["schema", "kind", "capacity", "count", "childRefs"]) &&
      Number.isInteger(o.capacity) &&
      o.capacity >= 2 &&
      o.capacity === capacity &&
      Number.isInteger(o.count) &&
      o.count >= 0 &&
      Array.isArray(o.childRefs) &&
      o.childRefs.length >= (isRoot ? 2 : 1) &&
      o.childRefs.length <= capacity &&
      o.childRefs.every((childRef) => typeof childRef === "string")
    ) {
      const children = [];
      for (const childRef of o.childRefs) {
        const child = decodeSequence(io, childRef, seen, capacity, false);
        if (!child.ok) return child;
        children.push(child.page);
      }
      if (o.count !== children.reduce((sum, child) => sum + child.count, 0))
        return fail("invalid-sequence-object", { ref });
      page = Object.freeze({
        kind: "branch",
        capacity: o.capacity,
        count: o.count,
        children: Object.freeze(children),
      });
    } else return fail("invalid-sequence-object", { ref });
    seen.delete(ref);
    return { ok: true, page };
  }
  function decodeTrie(io, ref, trieKind, recordKind, seen, capacity) {
    if (seen.has(ref)) return fail("object-cycle");
    seen.add(ref);
    const loaded = io.load(ref, trieKind);
    if (!loaded.ok) return loaded;
    if (!validateTrie(loaded.object, trieKind))
      return fail("invalid-trie-object", { ref });
    let value = null;
    if (loaded.object.hasValue) {
      if (recordKind === "sequence") {
        const decoded = decodeSequence(
          io,
          loaded.object.valueRef,
          new Set(),
          capacity,
        );
        if (!decoded.ok) return decoded;
        value = decoded.page;
      } else {
        const record = io.load(loaded.object.valueRef, recordKind);
        if (!record.ok) return record;
        const o = record.object;
        if (recordKind === "content-record") {
          if (!exact(o, ["schema", "kind", "nodeId", "payload"]))
            return fail("invalid-content-record");
          value = Object.freeze({
            nodeId: o.nodeId,
            payload: Object.freeze(o.payload),
          });
        } else {
          if (!exact(o, ["schema", "kind", "nodeId", "parentId"]))
            return fail("invalid-placement-record");
          value = Object.freeze({ nodeId: o.nodeId, parentId: o.parentId });
        }
      }
    }
    const children = [];
    for (const edge of loaded.object.children) {
      const child = decodeTrie(
        io,
        edge.ref,
        trieKind,
        recordKind,
        seen,
        capacity,
      );
      if (!child.ok) return child;
      children.push(Object.freeze([edge.key, child.node]));
    }
    seen.delete(ref);
    return {
      ok: true,
      node: Object.freeze({
        hasValue: loaded.object.hasValue,
        value,
        children: Object.freeze(children),
      }),
    };
  }
  function auditCandidateSeal(sealRef, resolver) {
    const opened = openFromAcceptedSealRef(sealRef, resolver);
    if (!opened.ok) return opened;
    const { handle } = opened,
      content = decodeTrie(
        handle.io,
        handle.root.contentRef,
        "content-trie",
        "content-record",
        new Set(),
        handle.root.capacity,
      );
    if (!content.ok) return content;
    const placements = decodeTrie(
      handle.io,
      handle.root.placementRef,
      "placement-trie",
      "placement-record",
      new Set(),
      handle.root.capacity,
    );
    if (!placements.ok) return placements;
    const children = decodeTrie(
      handle.io,
      handle.root.childrenRef,
      "children-trie",
      "sequence",
      new Set(),
      handle.root.capacity,
    );
    if (!children.ok) return children;
    const preservation = handle.io.load(
      handle.root.preservationRef,
      "preservation",
    );
    if (!preservation.ok) return preservation;
    if (!exact(preservation.object, ["schema", "kind", "value"]))
      return fail("invalid-preservation-object");
    const rootApi = global.PocketStarlingRootShadow;
    if (!rootApi) return fail("root-dependency-unavailable");
    const structural = Object.freeze({
        capacity: handle.root.capacity,
        placements: placements.node,
        children: children.node,
      }),
      components = {
        capacity: handle.root.capacity,
        content: content.node,
        placements: structural.placements,
        children: structural.children,
        preservation: preservation.object.value,
      },
      witness = rootApi.diagnosticRootFor(components);
    if (!witness.ok) return witness;
    const candidate = {
        schema: rootApi.SCHEMA,
        capacity: handle.root.capacity,
        content: content.node,
        structural,
        preservation: preservation.object.value,
        root: witness.root,
      },
      audited = rootApi.auditCandidate(candidate);
    return audited.ok
      ? {
          ok: true,
          candidate,
          diagnostics: {
            fetches: handle.io.stats.fetches,
            cacheHits: handle.io.stats.cacheHits,
          },
        }
      : audited;
  }
  global.PocketStarlingObjectSealShadow = Object.freeze({
    ROOT_SCHEMA,
    SEAL_SCHEMA,
    OBJECT_SCHEMA,
    canonical,
    refFor,
    createStager,
    stageCandidate,
    exportEntries,
    verifyNewObjectPresence,
    openFromAcceptedSealRef,
    readContent,
    readPlacement,
    auditCandidateSeal,
  });
})(typeof window !== "undefined" ? window : globalThis);
