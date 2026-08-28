/* Dormant P107 reference model. Page capacity is a test-only proof parameter,
   not a storage or production tuning decision. */
(function (global) {
  "use strict";
  const ROOT = "root";
  function fail(reason) { return { ok: false, reason }; }
  function clone(value) { return JSON.parse(JSON.stringify(value)); }
  function pageId(kind, items) { return `${kind}:${items.map((item) => encodeURIComponent(String(item))).join("|")}`; }
  function sequence(children, capacity) {
    const pages = [];
    for (let i = 0; i < children.length; i += capacity) {
      const items = children.slice(i, i + capacity);
      pages.push({ id: pageId("leaf", items), kind: "leaf", items });
    }
    return { pages, branchPages: pages.reduce((out, page, index) => {
      if (index % capacity === 0) out.push([]);
      out[out.length - 1].push(page.id);
      return out;
    }, []).map((items) => ({ id: pageId("branch", items), kind: "branch", items })) };
  }
  function materialiseSequence(seq) { return seq.pages.flatMap((page) => page.items); }
  function validate(relation) {
    if (!relation || !Array.isArray(relation.nodeIds) || !relation.parents || !relation.children) return fail("invalid-relation");
    const ids = new Set();
    for (const id of relation.nodeIds) {
      if (typeof id !== "string" || !id || id === ROOT || ids.has(id)) return fail("duplicate-or-invalid-node");
      ids.add(id);
    }
    const membership = new Map();
    for (const [parent, children] of Object.entries(relation.children)) {
      if (parent !== ROOT && !ids.has(parent)) return fail("unknown-parent");
      if (!Array.isArray(children)) return fail("invalid-child-sequence");
      for (const id of children) {
        if (!ids.has(id)) return fail("unknown-child");
        if (membership.has(id)) return fail("duplicate-ordered-membership");
        membership.set(id, parent);
      }
    }
    for (const id of ids) {
      const parent = relation.parents[id];
      if (typeof parent !== "string" || (parent !== ROOT && !ids.has(parent))) return fail("invalid-parent-placement");
      if (membership.get(id) !== parent) return fail("placement-membership-mismatch");
      const seen = new Set([id]); let cursor = parent;
      while (cursor !== ROOT) { if (seen.has(cursor)) return fail("parent-cycle"); seen.add(cursor); cursor = relation.parents[cursor]; if (typeof cursor !== "string") return fail("invalid-parent-placement"); }
    }
    return { ok: true };
  }
  function build(relation, options = {}) {
    const checked = validate(relation); if (!checked.ok) return checked;
    const capacity = Number.isInteger(options.capacity) && options.capacity >= 2 ? options.capacity : 4;
    const children = {}; for (const [parent, items] of Object.entries(relation.children)) children[parent] = sequence(items, capacity);
    return { ok: true, model: { capacity, nodeIds: relation.nodeIds.slice(), parents: clone(relation.parents), children } };
  }
  function relationFrom(model) {
    const children = {}; for (const [parent, seq] of Object.entries(model.children)) children[parent] = materialiseSequence(seq);
    return { nodeIds: model.nodeIds.slice(), parents: clone(model.parents), children };
  }
  function materialise(model) { const relation = relationFrom(model); const checked = validate(relation); return checked.ok ? { ok: true, relation } : checked; }
  function update(model, relation) { return build(relation, { capacity: model.capacity }); }
  function insert(model, nodeId, parentId, index) {
    const relation = relationFrom(model); if (relation.nodeIds.includes(nodeId)) return fail("duplicate-node-id");
    if (parentId !== ROOT && !relation.nodeIds.includes(parentId)) return fail("unknown-parent");
    const list = relation.children[parentId] || []; const at = Number.isInteger(index) && index >= 0 && index <= list.length ? index : list.length;
    relation.nodeIds.push(nodeId); relation.parents[nodeId] = parentId; relation.children[parentId] = list.slice(); relation.children[parentId].splice(at, 0, nodeId);
    return update(model, relation);
  }
  function reorder(model, nodeId, index) {
    const relation = relationFrom(model); const parent = relation.parents[nodeId]; if (!parent) return fail("unknown-node");
    const list = relation.children[parent].slice(); const old = list.indexOf(nodeId); if (old < 0) return fail("placement-membership-mismatch");
    list.splice(old, 1); const at = Math.max(0, Math.min(Number.isInteger(index) ? index : list.length, list.length)); list.splice(at, 0, nodeId); relation.children[parent] = list;
    return update(model, relation);
  }
  function move(model, nodeId, parentId, index) {
    const relation = relationFrom(model); if (!relation.parents[nodeId]) return fail("unknown-node");
    if (parentId !== ROOT && !relation.nodeIds.includes(parentId)) return fail("unknown-parent");
    let cursor = parentId; while (cursor !== ROOT) { if (cursor === nodeId) return fail("move-would-cycle"); cursor = relation.parents[cursor]; }
    const from = relation.parents[nodeId]; relation.children[from] = relation.children[from].filter((id) => id !== nodeId);
    const to = relation.children[parentId] || []; const at = Math.max(0, Math.min(Number.isInteger(index) ? index : to.length, to.length)); relation.children[parentId] = to.slice(); relation.children[parentId].splice(at, 0, nodeId); relation.parents[nodeId] = parentId;
    return update(model, relation);
  }
  function pageIds(model, parentId) { const seq = model.children[parentId]; return seq ? seq.pages.map((page) => page.id) : []; }
  global.PocketStarlingPlacementShadow = Object.freeze({ ROOT, build, validate, materialise, insert, reorder, move, pageIds });
})(typeof window !== "undefined" ? window : globalThis);
