/* Dormant P108 compositional-root experiment. Digests are deterministic proof
   machinery only, not cryptographic authentication or a persistence format. */
(function (global) {
  "use strict";
  const SCHEMA = "pocket.starling.root-shadow.v1";
  const memo = new WeakMap(),
    proved = new WeakSet();
  const fail = (reason) => ({ ok: false, reason });
  const empty = trie(false, null, []);

  function trie(hasValue, value, children) {
    return Object.freeze({
      hasValue,
      value,
      children: Object.freeze(children.map((p) => Object.freeze(p))),
    });
  }
  function child(node, key) {
    const pair = node.children.find((p) => p[0] === key);
    return pair ? pair[1] : null;
  }
  function get(node, key) {
    let at = node;
    for (let i = 0; i < key.length; i += 1) {
      at = child(at, key[i]);
      if (!at) return null;
    }
    return at.hasValue ? at.value : null;
  }
  function set(node, key, value, at = 0) {
    if (at === key.length) return trie(true, value, node.children);
    const k = key[at],
      next = set(child(node, k) || empty, key, value, at + 1),
      children = node.children.filter((p) => p[0] !== k);
    children.push([k, next]);
    children.sort((a, b) => a[0].localeCompare(b[0]));
    return trie(node.hasValue, node.value, children);
  }
  function entries(node, prefix = "", out = []) {
    if (node.hasValue) out.push([prefix, node.value]);
    for (const [k, v] of node.children) entries(v, prefix + k, out);
    return out;
  }

  function cloneFreeze(value, ancestors = new Set()) {
    if (
      value === null ||
      typeof value === "string" ||
      typeof value === "boolean"
    )
      return { ok: true, value };
    if (typeof value === "number")
      return Number.isFinite(value)
        ? { ok: true, value }
        : fail("unsupported-digest-material");
    if (
      typeof value !== "object" ||
      ancestors.has(value) ||
      (!Array.isArray(value) &&
        Object.prototype.toString.call(value) !== "[object Object]")
    )
      return fail("unsupported-digest-material");
    ancestors.add(value);
    const out = Array.isArray(value) ? [] : {};
    for (const key of Object.keys(value)) {
      const copied = cloneFreeze(value[key], ancestors);
      if (!copied.ok) return copied;
      out[key] = copied.value;
    }
    ancestors.delete(value);
    return { ok: true, value: Object.freeze(out) };
  }
  function hash(text) {
    let h = 2166136261;
    for (let i = 0; i < text.length; i += 1) {
      h ^= text.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    return (h >>> 0).toString(16).padStart(8, "0");
  }
  function digest(value, stats, stack = new Set()) {
    if (value === null) return { ok: true, digest: "null" };
    const type = typeof value;
    if (type === "string")
      return { ok: true, digest: hash("s:" + value.length + ":" + value) };
    if (type === "boolean")
      return { ok: true, digest: value ? "bool:1" : "bool:0" };
    if (type === "number")
      return Number.isFinite(value)
        ? { ok: true, digest: hash("n:" + String(value)) }
        : fail("unsupported-digest-material");
    if (type !== "object" || stack.has(value))
      return fail("unsupported-digest-material");
    if (memo.has(value)) {
      stats.cacheHits += 1;
      return { ok: true, digest: memo.get(value) };
    }
    stack.add(value);
    let parts = [];
    if (Array.isArray(value)) {
      for (const item of value) {
        const d = digest(item, stats, stack);
        if (!d.ok) return d;
        parts.push(d.digest);
      }
      parts = ["array", String(value.length), ...parts];
    } else {
      for (const key of Object.keys(value).sort()) {
        const d = digest(value[key], stats, stack);
        if (!d.ok) return d;
        parts.push(hash("key:" + key), d.digest);
      }
      parts = ["object", ...parts];
    }
    stack.delete(value);
    const result = hash(parts.join("|"));
    memo.set(value, result);
    stats.newlyDigestedObjects += 1;
    return { ok: true, digest: result };
  }
  function witness(components) {
    const stats = { newlyDigestedObjects: 0, cacheHits: 0 },
      parts = [
        ["content", "contentDigest"],
        ["placements", "placementDigest"],
        ["children", "childrenDigest"],
        ["preservation", "preservationDigest"],
      ],
      digests = {};
    for (const [component, field] of parts) {
      const d = digest(components[component], stats);
      if (!d.ok) return d;
      digests[field] = d.digest;
    }
    const root = Object.freeze({
      schema: SCHEMA,
      capacity: components.capacity,
      ...digests,
      rootDigest: hash(
        [
          SCHEMA,
          components.capacity,
          ...parts.map((part) => digests[part[1]]),
        ].join("|"),
      ),
    });
    return { ok: true, root, diagnostics: stats };
  }
  function stateFor(content, structural, preservation, root) {
    const state = Object.freeze({
      schema: SCHEMA,
      capacity: structural.capacity,
      content,
      structural,
      preservation,
      root,
    });
    proved.add(state);
    return state;
  }
  function deps() {
    const bridge = global.PocketStarlingBridgeShadow,
      placement = global.PocketStarlingPlacementShadow;
    return bridge && placement ? { bridge, placement } : null;
  }
  function build(bridge) {
    const d = deps();
    if (!d) return fail("root-dependency-unavailable");
    const checked = d.bridge.audit(bridge);
    if (!checked.ok) return checked;
    let content = empty;
    const payloads = new Map(
      bridge.compatibility.payloads.map((r) => [r.nodeId, r.value]),
    );
    for (const identity of bridge.compatibility.identities) {
      const payload = cloneFreeze(payloads.get(identity.nodeId));
      if (!payload.ok) return payload;
      content = set(
        content,
        identity.nodeId,
        Object.freeze({ nodeId: identity.nodeId, payload: payload.value }),
      );
    }
    const preservation = cloneFreeze({
      source: bridge.compatibility.source,
      tombstones: bridge.compatibility.tombstones,
      rootExtras: bridge.compatibility.rootExtras,
      dataExtras: bridge.compatibility.dataExtras,
    });
    if (!preservation.ok) return preservation;
    const components = {
        capacity: bridge.capacity,
        content,
        placements: bridge.structural.placements,
        children: bridge.structural.children,
        preservation: preservation.value,
      },
      rooted = witness(components);
    if (!rooted.ok) return rooted;
    const state = stateFor(
        content,
        bridge.structural,
        preservation.value,
        rooted.root,
      ),
      audit = auditCandidate(state);
    if (!audit.ok) return audit;
    return { ok: true, state, diagnostics: rooted.diagnostics };
  }
  function getContent(state, nodeId) {
    return state && get(state.content, nodeId);
  }
  function auditCandidate(candidate) {
    const d = deps();
    if (!d) return fail("root-dependency-unavailable");
    if (
      !candidate ||
      candidate.schema !== SCHEMA ||
      !candidate.content ||
      !candidate.structural ||
      !candidate.preservation ||
      !candidate.root
    )
      return fail("invalid-root-candidate");
    const relation = d.placement.audit(candidate.structural);
    if (!relation.ok) return relation;
    const contentIds = entries(candidate.content).map((e) => e[0]),
      structuralIds = relation.relation.nodeIds;
    if (
      contentIds.length !== structuralIds.length ||
      contentIds.some((id) => !structuralIds.includes(id))
    )
      return fail("root-membership-mismatch");
    const computed = witness({
      capacity: candidate.capacity,
      content: candidate.content,
      placements: candidate.structural.placements,
      children: candidate.structural.children,
      preservation: candidate.preservation,
    });
    if (!computed.ok) return computed;
    for (const key of Object.keys(computed.root))
      if (candidate.root[key] !== computed.root[key])
        return fail(
          key === "rootDigest"
            ? "root-digest-mismatch"
            : "component-digest-mismatch",
        );
    return { ok: true, diagnostics: computed.diagnostics };
  }
  function mutate(state, structural, content, preservation) {
    const rooted = witness({
      capacity: state.capacity,
      content,
      placements: structural.placements,
      children: structural.children,
      preservation,
    });
    if (!rooted.ok) return rooted;
    return {
      ok: true,
      state: stateFor(content, structural, preservation, rooted.root),
      diagnostics: rooted.diagnostics,
    };
  }
  function trusted(state) {
    return proved.has(state) ? null : fail("unproved-root-state");
  }
  function editPayload(state, nodeId, payload) {
    const bad = trusted(state);
    if (bad) return bad;
    const current = get(state.content, nodeId);
    if (!current) return fail("unknown-node");
    const copied = cloneFreeze(payload);
    if (!copied.ok) return copied;
    return mutate(
      state,
      state.structural,
      set(
        state.content,
        nodeId,
        Object.freeze({ nodeId, payload: copied.value }),
      ),
      state.preservation,
    );
  }
  function reorder(state, nodeId, fromIndex, toIndex) {
    const bad = trusted(state);
    if (bad) return bad;
    const result = deps().placement.reorder(
      state.structural,
      nodeId,
      fromIndex,
      toIndex,
    );
    return result.ok
      ? mutate(state, result.model, state.content, state.preservation)
      : result;
  }
  function move(state, nodeId, fromIndex, parentId, toIndex) {
    const bad = trusted(state);
    if (bad) return bad;
    const result = deps().placement.move(
      state.structural,
      nodeId,
      fromIndex,
      parentId,
      toIndex,
    );
    return result.ok
      ? mutate(state, result.model, state.content, state.preservation)
      : result;
  }
  function diagnosticRootFor(components) {
    return witness(components);
  }
  global.PocketStarlingRootShadow = Object.freeze({
    SCHEMA,
    build,
    auditCandidate,
    diagnosticRootFor,
    getContent,
    editPayload,
    reorder,
    move,
  });
})(typeof window !== "undefined" ? window : globalThis);
