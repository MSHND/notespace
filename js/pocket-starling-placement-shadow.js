/* Dormant P107a2 placement proof. It is not loaded by the live Pocket runtime. */
(function (global) {
  "use strict";

  const ROOT = "root";
  const RETAINED_PARENT = "";
  const EMPTY = freezeTrie(false, null, []);

  function fail(reason) {
    return { ok: false, reason };
  }

  function freezeTrie(hasValue, value, children) {
    return Object.freeze({
      hasValue,
      value,
      children: Object.freeze(children.map(([key, child]) => Object.freeze([key, child])))
    });
  }

  function childAt(node, key) {
    for (const pair of node.children) {
      if (pair[0] === key) return pair[1];
    }
    return null;
  }

  function trieGet(node, key) {
    if (typeof key !== "string") return null;
    let cursor = node;
    for (let offset = 0; offset < key.length; offset += 1) {
      cursor = childAt(cursor, key[offset]);
      if (!cursor) return null;
    }
    return cursor.hasValue ? cursor.value : null;
  }

  function trieSet(node, key, value, offset = 0) {
    if (offset === key.length) return freezeTrie(true, value, node.children);

    const character = key[offset];
    const existing = childAt(node, character) || EMPTY;
    const replacement = trieSet(existing, key, value, offset + 1);
    const children = node.children.filter((pair) => pair[0] !== character);
    children.push([character, replacement]);
    children.sort((left, right) => left[0].localeCompare(right[0]));
    return freezeTrie(node.hasValue, node.value, children);
  }

  function trieEntries(node, prefix = "", entries = []) {
    if (node.hasValue) entries.push([prefix, node.value]);
    for (const [character, child] of node.children) {
      trieEntries(child, prefix + character, entries);
    }
    return entries;
  }

  function nodeIdIsValid(nodeId) {
    return typeof nodeId === "string" && nodeId.length > 0 && nodeId !== ROOT;
  }

  function own(object, key) {
    return Object.prototype.hasOwnProperty.call(object, key);
  }

  function validate(relation) {
    if (!relation || !Array.isArray(relation.nodeIds) || !relation.parents || !relation.children) {
      return fail("invalid-relation");
    }

    const nodeIds = new Set();
    for (const nodeId of relation.nodeIds) {
      if (!nodeIdIsValid(nodeId) || nodeIds.has(nodeId)) return fail("duplicate-or-invalid-node");
      nodeIds.add(nodeId);
    }

    for (const nodeId of Object.keys(relation.parents)) {
      if (!nodeIds.has(nodeId)) return fail("unknown-placement-node");
    }

    const membership = new Map();
    for (const [parentId, children] of Object.entries(relation.children)) {
      if (
        parentId !== ROOT &&
        parentId !== RETAINED_PARENT &&
        !nodeIds.has(parentId)
      )
        return fail("unknown-parent");
      if (!Array.isArray(children)) return fail("invalid-child-sequence");
      for (const nodeId of children) {
        if (!nodeIds.has(nodeId)) return fail("unknown-child");
        if (membership.has(nodeId)) return fail("duplicate-ordered-membership");
        membership.set(nodeId, parentId);
      }
    }

    for (const nodeId of nodeIds) {
      if (!own(relation.parents, nodeId)) return fail("invalid-parent-placement");
      const parentId = relation.parents[nodeId];
      if (typeof parentId !== "string") return fail("invalid-parent-placement");
      if (
        parentId !== ROOT &&
        parentId !== RETAINED_PARENT &&
        !nodeIds.has(parentId)
      )
        return fail("unknown-parent");
      if (membership.get(nodeId) !== parentId) return fail("placement-membership-mismatch");
    }

    for (const nodeId of nodeIds) {
      const seen = new Set([nodeId]);
      let cursor = relation.parents[nodeId];
      while (cursor !== ROOT && cursor !== RETAINED_PARENT) {
        if (seen.has(cursor)) return fail("parent-cycle");
        seen.add(cursor);
        cursor = relation.parents[cursor];
        if (typeof cursor !== "string") return fail("invalid-parent-placement");
      }
    }

    return { ok: true };
  }

  function sequenceApi() {
    return global.PocketStarlingSequenceShadow || null;
  }

  function emptySequence(capacity) {
    const sequence = sequenceApi();
    if (!sequence) return null;
    return sequence.build([], { capacity }).root;
  }

  function modelFrom(capacity, placements, children) {
    return Object.freeze({ capacity, placements, children });
  }

  function getPlacement(model, nodeId) {
    return model && trieGet(model.placements, nodeId);
  }

  function getChildrenRoot(model, parentId) {
    return model && trieGet(model.children, parentId);
  }

  function domainForNode(model, nodeId) {
    const seen = new Set();
    let cursor = nodeId;
    while (true) {
      if (seen.has(cursor)) return null;
      seen.add(cursor);
      const record = getPlacement(model, cursor);
      if (!record || typeof record.parentId !== "string") return null;
      if (record.parentId === ROOT || record.parentId === RETAINED_PARENT)
        return record.parentId;
      cursor = record.parentId;
    }
  }

  function sourceAdmission(model, nodeId) {
    if (!getPlacement(model, nodeId)) return "unknown-node";
    const domain = domainForNode(model, nodeId);
    if (domain === RETAINED_PARENT) return "retained-node-not-current";
    return domain === ROOT ? null : "unknown-node";
  }

  function parentAdmission(model, parentId) {
    if (parentId === ROOT) return null;
    if (parentId === RETAINED_PARENT) return "retained-parent-not-current";
    if (!getPlacement(model, parentId)) return "unknown-parent";
    const domain = domainForNode(model, parentId);
    if (domain === RETAINED_PARENT) return "retained-parent-not-current";
    return domain === ROOT ? null : "unknown-parent";
  }

  function itemAt(root, index) {
    if (!Number.isInteger(index) || index < 0 || index >= root.count) return null;
    let page = root;
    let offset = index;
    while (page.kind === "branch") {
      let child = 0;
      while (child < page.children.length - 1 && offset >= page.children[child].count) {
        offset -= page.children[child].count;
        child += 1;
      }
      page = page.children[child];
    }
    return page.items[offset];
  }

  function destinationIndex(index, count) {
    if (!Number.isInteger(index)) return count;
    return Math.max(0, Math.min(index, count));
  }

  function build(relation, options = {}) {
    const checked = validate(relation);
    if (!checked.ok) return checked;
    const sequence = sequenceApi();
    if (!sequence) return fail("sequence-unavailable");

    const capacity = Number.isInteger(options.capacity) && options.capacity >= 2 ? options.capacity : 4;
    let placements = EMPTY;
    let children = EMPTY;

    for (const nodeId of relation.nodeIds) {
      const record = Object.freeze({ nodeId, parentId: relation.parents[nodeId] });
      placements = trieSet(placements, nodeId, record);
    }
    for (const [parentId, nodeIds] of Object.entries(relation.children)) {
      children = trieSet(children, parentId, sequence.build(nodeIds, { capacity }).root);
    }

    return { ok: true, model: modelFrom(capacity, placements, children) };
  }

  function materialise(model) {
    if (!model || !Number.isInteger(model.capacity) || !model.placements || !model.children) {
      return fail("invalid-model");
    }
    const sequence = sequenceApi();
    if (!sequence) return fail("sequence-unavailable");

    const parents = Object.create(null);
    const nodeIds = [];
    for (const [nodeId, record] of trieEntries(model.placements)) {
      nodeIds.push(nodeId);
      parents[nodeId] = record.parentId;
    }
    const children = Object.create(null);
    for (const [parentId, root] of trieEntries(model.children)) {
      children[parentId] = sequence.materialise(root);
    }
    const relation = { nodeIds, parents, children };
    const checked = validate(relation);
    return checked.ok ? { ok: true, relation } : checked;
  }

  function insert(model, nodeId, parentId, index) {
    if (!model || !nodeIdIsValid(nodeId)) return fail("invalid-node-id");
    if (getPlacement(model, nodeId)) return fail("duplicate-node-id");
    const parentProblem = parentAdmission(model, parentId);
    if (parentProblem) return fail(parentProblem);

    const sequence = sequenceApi();
    if (!sequence) return fail("sequence-unavailable");
    const current = getChildrenRoot(model, parentId) || emptySequence(model.capacity);
    const nextSequence = sequence.insertAt(
      current,
      destinationIndex(index, current.count),
      nodeId
    );
    if (!nextSequence.ok) return nextSequence;

    const record = Object.freeze({ nodeId, parentId });
    return {
      ok: true,
      model: modelFrom(
        model.capacity,
        trieSet(model.placements, nodeId, record),
        trieSet(model.children, parentId, nextSequence.root)
      )
    };
  }

  function reorder(model, nodeId, fromIndex, toIndex) {
    const record = getPlacement(model, nodeId);
    if (!record) return fail("unknown-node");
    const sourceProblem = sourceAdmission(model, nodeId);
    if (sourceProblem) return fail(sourceProblem);

    const sequence = sequenceApi();
    if (!sequence) return fail("sequence-unavailable");
    const current = getChildrenRoot(model, record.parentId);
    if (!current || itemAt(current, fromIndex) !== nodeId) return fail("placement-membership-mismatch");

    const removed = sequence.removeAt(current, fromIndex);
    if (!removed.ok) return removed;
    const requested = destinationIndex(toIndex, current.count);
    const adjusted = requested > fromIndex ? requested - 1 : requested;
    const inserted = sequence.insertAt(removed.root, adjusted, nodeId);
    if (!inserted.ok) return inserted;

    return {
      ok: true,
      model: modelFrom(model.capacity, model.placements, trieSet(model.children, record.parentId, inserted.root))
    };
  }

  function move(model, nodeId, fromIndex, newParentId, toIndex) {
    const record = getPlacement(model, nodeId);
    if (!record) return fail("unknown-node");
    const sourceProblem = sourceAdmission(model, nodeId);
    if (sourceProblem) return fail(sourceProblem);
    const parentProblem = parentAdmission(model, newParentId);
    if (parentProblem) return fail(parentProblem);
    if (newParentId === record.parentId) return reorder(model, nodeId, fromIndex, toIndex);

    const sequence = sequenceApi();
    if (!sequence) return fail("sequence-unavailable");
    const source = getChildrenRoot(model, record.parentId);
    if (!source || itemAt(source, fromIndex) !== nodeId) return fail("placement-membership-mismatch");

    let cursor = newParentId;
    while (cursor !== ROOT) {
      if (cursor === nodeId) return fail("move-would-cycle");
      const ancestor = getPlacement(model, cursor);
      if (!ancestor) return fail("unknown-parent");
      cursor = ancestor.parentId;
    }

    const removed = sequence.removeAt(source, fromIndex);
    if (!removed.ok) return removed;
    const destination = getChildrenRoot(model, newParentId) || emptySequence(model.capacity);
    const inserted = sequence.insertAt(
      destination,
      destinationIndex(toIndex, destination.count),
      nodeId
    );
    if (!inserted.ok) return inserted;

    const moved = Object.freeze({ nodeId, parentId: newParentId });
    const children = trieSet(
      trieSet(model.children, record.parentId, removed.root),
      newParentId,
      inserted.root
    );
    return { ok: true, model: modelFrom(model.capacity, trieSet(model.placements, nodeId, moved), children) };
  }

  global.PocketStarlingPlacementShadow = Object.freeze({
    ROOT,
    RETAINED_PARENT,
    build,
    validate,
    materialise,
    audit: materialise,
    getPlacement,
    getChildrenRoot,
    insert,
    reorder,
    move
  });
})(typeof window !== "undefined" ? window : globalThis);
