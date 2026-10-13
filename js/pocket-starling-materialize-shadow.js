/* P368 shared accepted-snapshot structural reader. */
(function (global) {
  "use strict";
  const fail = (reason) => Object.freeze({ ok: false, reason });
  const exact = (v, fields) => v && typeof v === "object" && !Array.isArray(v)
    && Object.keys(v).length === fields.length && fields.every((f) => Object.prototype.hasOwnProperty.call(v, f));
  const plain = (v) => v && typeof v === "object" && !Array.isArray(v)
    && Object.prototype.toString.call(v) === "[object Object]";
  const deps = () => { const x = global.PocketStarlingObjectSealShadow; return x && typeof x.canonical === "function" && typeof x.refFor === "function" ? x : null; };
  const validSession = (s) => s && typeof s === "object" && typeof s.acceptedSealRef === "string" && s.acceptedSealRef && typeof s.resolveLogical === "function" && typeof s.readContent === "function" && typeof s.readPlacement === "function";
  const validSeal = (l, v) => exact(v, ["schema", "kind", "rootRef", "previousSealRef"]) && v.schema === l.SEAL_SCHEMA && v.kind === "candidate-seal" && typeof v.rootRef === "string" && (v.previousSealRef === null || typeof v.previousSealRef === "string");
  const validRoot = (l, v) => exact(v, ["schema", "kind", "capacity", "contentRef", "placementRef", "childrenRef", "preservationRef"]) && v.schema === l.ROOT_SCHEMA && v.kind === "pocket-root" && Number.isInteger(v.capacity) && v.capacity >= 3 && [v.contentRef, v.placementRef, v.childrenRef, v.preservationRef].every((r) => typeof r === "string");
  const validPreservation = (l, v) => exact(v, ["schema", "kind", "value"]) && v.schema === l.OBJECT_SCHEMA && v.kind === "preservation" && exact(v.value, ["source", "tombstones", "rootExtras", "dataExtras"]) && exact(v.value.source, ["schema", "writtenAt"]) && typeof v.value.source.schema === "string" && typeof v.value.source.writtenAt === "string" && Array.isArray(v.value.tombstones) && plain(v.value.rootExtras) && plain(v.value.dataExtras);
  function validTrie(l, v, kind) {
    if (!exact(v, ["schema", "kind", "hasValue", "valueRef", "children"]) || v.schema !== l.OBJECT_SCHEMA || v.kind !== kind || typeof v.hasValue !== "boolean" || !((v.hasValue && typeof v.valueRef === "string") || (!v.hasValue && v.valueRef === null)) || !Array.isArray(v.children)) return false;
    const seen = new Set(), keys = [];
    for (const e of v.children) { if (!exact(e, ["key", "ref"]) || typeof e.key !== "string" || e.key.length !== 1 || typeof e.ref !== "string" || seen.has(e.key)) return false; seen.add(e.key); keys.push(e.key); }
    return keys.every((k, i) => k === keys.slice().sort((a, b) => a.localeCompare(b))[i]);
  }
  const sequenceKind = (r) => (/^proof-ref:v1:(sequence-leaf|sequence-branch):[0-9a-f]{8}$/.exec(r) || [])[1] || null;
  const clone = (l, v) => { const c = l.canonical(v); if (!c.ok) return null; try { return JSON.parse(c.bytes); } catch (_) { return null; } };

  /* P172 still owns candidate admission. Its parallel structural walk is noted
     for a later, separately authorised unification, not changed here. */
  function structural(session) {
    const logical = deps(); if (!logical || !validSession(session)) return null;
    const cache = new Map(); let accepted = null;
    async function load(ref, kind) {
      if (cache.has(ref)) { const x = cache.get(ref); return x.kind === kind ? { ok: true, object: x.object } : fail("logical-kind-mismatch"); }
      let bytes; try { bytes = await session.resolveLogical(ref); } catch (_) { return fail("logical-resolution-failed"); }
      if (typeof bytes !== "string") return fail("missing-logical-object");
      try { if (logical.refFor(kind, bytes) !== ref) return fail("logical-ref-mismatch"); } catch (_) { return fail("logical-ref-mismatch"); }
      let object; try { object = JSON.parse(bytes); } catch (_) { return fail("invalid-logical-bytes"); }
      const canonical = logical.canonical(object); if (!canonical.ok || canonical.bytes !== bytes) return fail("noncanonical-logical-object");
      cache.set(ref, { kind, object }); return { ok: true, object };
    }
    async function trieValue(rootRef, kind, id) {
      if (typeof id !== "string" || !id) return fail("invalid-node-id"); let ref = rootRef;
      for (let i = 0;; i += 1) { const x = await load(ref, kind); if (!x.ok) return x; if (!validTrie(logical, x.object, kind)) return fail("invalid-trie-object"); if (i === id.length) return x.object.hasValue ? { ok: true, ref: x.object.valueRef } : { ok: true, absent: true }; const edge = x.object.children.find((e) => e.key === id[i]); if (!edge) return { ok: true, absent: true }; ref = edge.ref; }
    }
    async function sequenceItems(ref, capacity) {
      const seen = new Set(), pages = new Map(), items = [], stack = [{ type: "in", ref, root: true, depth: 0 }]; let leafDepth = null;
      while (stack.length) { const f = stack.pop(); if (f.type === "out") { const p = pages.get(f.ref), total = p.childRefs.reduce((n, r) => n + pages.get(r).count, 0); if (p.count !== total || p.childRefs.some((r) => pages.get(r).count <= 0)) return fail("invalid-sequence-count"); continue; } if (seen.has(f.ref)) return fail("duplicate-or-cyclic-sequence-page"); seen.add(f.ref); const kind = sequenceKind(f.ref); if (!kind) return fail("invalid-sequence-object"); const x = await load(f.ref, kind); if (!x.ok) return x.reason === "logical-kind-mismatch" ? fail("invalid-sequence-object") : x; const v = x.object;
        if (kind === "sequence-leaf") { if (!exact(v, ["schema", "kind", "capacity", "count", "items"]) || v.schema !== logical.SEQUENCE_SCHEMA || v.kind !== kind || v.capacity !== capacity || !Number.isInteger(v.count) || v.count < 0 || !Array.isArray(v.items) || v.count !== v.items.length || v.items.length > capacity || (!f.root && v.items.length < Math.ceil(capacity / 2)) || !v.items.every((x) => typeof x === "string" && x)) return fail("invalid-sequence-object"); if (leafDepth === null) leafDepth = f.depth; else if (leafDepth !== f.depth) return fail("invalid-sequence-object"); pages.set(f.ref, { count: v.count }); items.push(...v.items); continue; }
        if (!exact(v, ["schema", "kind", "capacity", "count", "childRefs"]) || v.schema !== logical.SEQUENCE_SCHEMA || v.kind !== kind || v.capacity !== capacity || !Number.isInteger(v.count) || v.count < 0 || !Array.isArray(v.childRefs) || v.childRefs.length < (f.root ? 2 : Math.ceil(capacity / 2)) || v.childRefs.length > capacity || !v.childRefs.every((r) => typeof r === "string")) return fail("invalid-sequence-object"); pages.set(f.ref, { count: v.count, childRefs: v.childRefs }); stack.push({ type: "out", ref: f.ref }); for (let i = v.childRefs.length - 1; i >= 0; i -= 1) stack.push({ type: "in", ref: v.childRefs[i], root: false, depth: f.depth + 1 }); }
      return { ok: true, items };
    }
    async function initialise() { if (accepted) return { ok: true, accepted }; const seal = await load(session.acceptedSealRef, "candidate-seal"); if (!seal.ok || !validSeal(logical, seal.object)) return !seal.ok ? seal : fail("invalid-seal"); const root = await load(seal.object.rootRef, "pocket-root"); if (!root.ok || !validRoot(logical, root.object)) return !root.ok ? root : fail("invalid-root"); const p = await load(root.object.preservationRef, "preservation"); if (!p.ok || !validPreservation(logical, p.object)) return !p.ok ? p : fail("invalid-preservation"); const owner = clone(logical, p.object.value); if (!owner) return fail("invalid-preservation"); accepted = Object.freeze({ seal: seal.object, root: root.object, owner }); return { ok: true, accepted }; }
    async function childrenFor(parentId) { const r = await initialise(); if (!r.ok) return r; const v = await trieValue(r.accepted.root.childrenRef, "children-trie", parentId); return !v.ok ? v : v.absent ? { ok: true, items: [] } : sequenceItems(v.ref, r.accepted.root.capacity); }
    function record(frame, placement, content) { if (!placement || placement.ok !== true || placement.nodeId !== frame.nodeId || placement.parentId !== frame.parentId) return fail("placement-parent-disagreement"); if (!content || content.ok !== true || content.nodeId !== frame.nodeId || !plain(content.payload)) return fail("invalid-content-record"); if (["id", "parentId", "order"].some((k) => Object.prototype.hasOwnProperty.call(content.payload, k))) return fail("reserved-content-payload-key"); const payload = clone(logical, content.payload); return payload && plain(payload) ? { ok: true, node: { id: frame.nodeId, parentId: frame.parentId, order: frame.order, ...payload } } : fail("invalid-content-payload"); }
    async function readRecord(frame) { let p, c; try { p = await session.readPlacement(frame.nodeId); c = await session.readContent(frame.nodeId); } catch (_) { return fail("session-read-failed"); } return record(frame, p, c); }
    return Object.freeze({ logical, initialise, childrenFor, record, readRecord });
  }

  async function materializeAccepted(session) {
    const reader = structural(session); if (!reader) return fail("invalid-materialize-session");
    try { const ready = await reader.initialise(); if (!ready.ok) return ready; const nodes = [], seen = new Set(), stack = [{ type: "parent", parentId: "root" }]; let lookahead = null;
      const guard = (f) => { try { return Promise.resolve(f()); } catch (e) { return Promise.reject(e); } };
      const work = (f) => { const placement = guard(() => session.readPlacement(f.nodeId)), content = guard(() => session.readContent(f.nodeId)), children = guard(() => reader.childrenFor(f.nodeId)); return { f, children: children.then((value) => ({ settled: true, value }), () => ({ settled: false })), settled: Promise.all([placement, content, children]).then((values) => ({ ok: true, values }), () => ({ ok: false })) }; };
      const same = (a, b) => a && b && a.type === "node" && b.type === "node" && a.parentId === b.parentId && a.nodeId === b.nodeId && a.order === b.order;
      const nextFrame = (f, children) => !children?.ok || !Array.isArray(children.items) ? null : children.items.length ? { type: "node", parentId: f.nodeId, nodeId: children.items[0], order: 0 } : stack[stack.length - 1]?.type === "node" ? stack[stack.length - 1] : null;
      while (stack.length) { const f = stack.pop(); if (f.type === "parent") { const c = await reader.childrenFor(f.parentId); if (!c.ok) return c; for (let i = c.items.length - 1; i >= 0; i -= 1) stack.push({ type: "node", parentId: f.parentId, nodeId: c.items[i], order: i }); continue; } if (seen.has(f.nodeId)) return fail("duplicate-or-cyclic-current-node"); seen.add(f.nodeId); const w = lookahead && same(lookahead.f, f) ? lookahead.w : work(f); lookahead = null; const first = await Promise.race([w.settled.then((result) => ({ kind: "settled", result })), w.children.then((result) => ({ kind: "children", result }))]); let settled; if (first.kind === "children") { if (first.result.settled) { const n = nextFrame(f, first.result.value); if (n && !seen.has(n.nodeId)) lookahead = { f: n, w: work(n) }; } settled = await w.settled; } else settled = first.result; if (!settled.ok) return fail("session-read-failed"); const [p, c, children] = settled.values; const node = reader.record(f, p, c); if (!node.ok) return node; if (!children.ok) return children; nodes.push(node.node); for (let i = children.items.length - 1; i >= 0; i -= 1) stack.push({ type: "node", parentId: f.nodeId, nodeId: children.items[i], order: i }); }
      const o = ready.accepted.owner; return Object.freeze({ ok: true, document: { schema: o.source.schema, writtenAt: o.source.writtenAt, nodes, tombstones: o.tombstones, rootExtras: o.rootExtras, dataExtras: o.dataExtras } });
    } catch (_) { return fail("materialize-failed"); }
  }
  async function createAcceptedSnapshotReader(session) {
    const reader = structural(session); if (!reader) return fail("invalid-materialize-session"); const ready = await reader.initialise(); if (!ready.ok) return ready;
    const nodes = new Map(), parents = new Map(), childCache = new Map(), stats = { childrenRequests: 0, cacheHits: 0, contentReads: 0, placementReads: 0 };
    const copy = (n) => clone(reader.logical, n), reachable = (p) => p === "root" || nodes.has(p);
    function cyclic(parent, node) { for (let current = parent; current !== "root"; current = parents.get(current)) if (current === node || !parents.has(current)) return true; return false; }
    const childResult = (parentId, rows) => Object.freeze({ ok: true, scope: "incomplete", parentId, nodes: rows.map(copy) });
    async function readChildren(parentId) { if (typeof parentId !== "string" || !parentId || !reachable(parentId)) return fail("unreachable-parent"); stats.childrenRequests += 1; const cached = childCache.get(parentId); if (cached) { stats.cacheHits += 1; return childResult(parentId, cached); } const listed = await reader.childrenFor(parentId); if (!listed.ok) return listed; const staged = [], stagedIds = new Set(); for (let order = 0; order < listed.items.length; order += 1) { const nodeId = listed.items[order]; if (stagedIds.has(nodeId) || nodes.has(nodeId) || parents.has(nodeId) || cyclic(parentId, nodeId)) return fail("duplicate-or-cyclic-current-node"); stagedIds.add(nodeId); stats.contentReads += 1; stats.placementReads += 1; const record = await reader.readRecord({ nodeId, parentId, order }); if (!record.ok) return record; staged.push(Object.freeze(record.node)); } const committed = Object.freeze(staged.slice()); for (const node of committed) { nodes.set(node.id, node); parents.set(node.id, parentId); } childCache.set(parentId, committed); return childResult(parentId, committed); }
    async function readReachedNode(nodeId) { return typeof nodeId === "string" && nodes.has(nodeId) ? Object.freeze({ ok: true, scope: "incomplete", node: copy(nodes.get(nodeId)) }) : fail("unreachable-node"); }
    function diagnostics() { const s = typeof session.diagnostics === "function" ? session.diagnostics() : null; return Object.freeze({ scope: "incomplete", acceptedSealRef: session.acceptedSealRef, rootRef: ready.accepted.seal.rootRef, ...stats, sessionPhysicalFetches: Number.isInteger(s?.physicalFetches) ? s.physicalFetches : null, sessionCacheHits: Number.isInteger(s?.cacheHits) ? s.cacheHits : null }); }
    return Object.freeze({ ok: true, scope: "incomplete", acceptedSealRef: session.acceptedSealRef, readChildren, readReachedNode, diagnostics });
  }
  global.PocketStarlingMaterializeShadow = Object.freeze({ materializeAccepted, createAcceptedSnapshotReader });
})(typeof window !== "undefined" ? window : globalThis);
