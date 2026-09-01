/* Dormant P114/P115/P116 fresh logical working-set experiment. It path-copies only
   an authenticated mutation neighbourhood into an unadopted P109 frontier. */
(function (global) {
  "use strict";

  const baseStates = new WeakMap(),
    semanticTransitions = new WeakMap();

  function fail(reason, extra = {}) {
    return { ok: false, reason, ...extra };
  }

  function dependencies() {
    const logical = global.PocketStarlingObjectSealShadow,
      semantic = global.PocketStarlingSemanticAuthorityShadow;
    return logical &&
      typeof logical.canonical === "function" &&
      typeof logical.refFor === "function" && semantic &&
      typeof semantic.validSemanticBase === "function"
      ? { ok: true, logical, semantic }
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
      value.capacity >= 3 &&
      [
        value.contentRef,
        value.placementRef,
        value.childrenRef,
        value.preservationRef,
      ].every((ref) => typeof ref === "string")
    );
  }

  function validTrie(logical, value, kind) {
    if (
      !exact(value, ["schema", "kind", "hasValue", "valueRef", "children"]) ||
      value.schema !== logical.OBJECT_SCHEMA ||
      value.kind !== kind ||
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

  function validContentTrie(logical, value) {
    return validTrie(logical, value, "content-trie");
  }

  function validContentRecord(logical, value, nodeId) {
    return (
      exact(value, ["schema", "kind", "nodeId", "payload"]) &&
      value.schema === logical.OBJECT_SCHEMA &&
      value.kind === "content-record" &&
      value.nodeId === nodeId
    );
  }

  function validPlacementRecord(logical, value, nodeId) {
    return (
      exact(value, ["schema", "kind", "nodeId", "parentId"]) &&
      value.schema === logical.OBJECT_SCHEMA &&
      value.kind === "placement-record" &&
      value.nodeId === nodeId &&
      typeof value.parentId === "string"
    );
  }

  async function createBase(input) {
    const dependency = dependencies();
    if (!dependency.ok) return dependency;
    if (
      !input ||
      typeof input !== "object" ||
      typeof input.acceptedSealRef !== "string" ||
      typeof input.resolveLogical !== "function" ||
      typeof input.syncedPocketId !== "string" || !input.syncedPocketId ||
      !input.semanticAuthority || !input.semanticBaseProof
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
    const semanticBinding = Object.freeze({
      syncedPocketId: input.syncedPocketId,
      logicalSealRef: input.acceptedSealRef,
      logicalRootRef: seal.object.rootRef,
      previousLogicalSealRef: seal.object.previousSealRef,
      logicalSealSchema: state.logical.SEAL_SCHEMA,
      logicalRootSchema: state.logical.ROOT_SCHEMA,
      logicalObjectSchema: state.logical.OBJECT_SCHEMA,
      sequenceSchema: state.logical.SEQUENCE_SCHEMA,
      placementGeneration: "pocket.starling.placement-relation.v1",
    });
    if (!dependency.semantic.validSemanticBase({
      authority: input.semanticAuthority,
      semanticBaseProof: input.semanticBaseProof,
      binding: semanticBinding,
    })) return fail("invalid-semantic-base");
    state.seal = seal.object;
    state.root = root.object;
    state.semanticAuthority = input.semanticAuthority;
    state.semanticBaseProof = input.semanticBaseProof;
    state.semanticBinding = semanticBinding;
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

  function registerSemanticTransition(state, candidate) {
    const binding = Object.freeze({
      syncedPocketId: state.semanticBinding.syncedPocketId,
      logicalSealRef: candidate.sealRef,
      logicalRootRef: candidate.rootRef,
      previousLogicalSealRef: state.acceptedSealRef,
      logicalSealSchema: state.logical.SEAL_SCHEMA,
      logicalRootSchema: state.logical.ROOT_SCHEMA,
      logicalObjectSchema: state.logical.OBJECT_SCHEMA,
      sequenceSchema: state.logical.SEQUENCE_SCHEMA,
      placementGeneration: "pocket.starling.placement-relation.v1",
    });
    semanticTransitions.set(candidate, Object.freeze({
      authority: state.semanticAuthority,
      semanticBaseProof: state.semanticBaseProof,
      baseSealRef: state.acceptedSealRef,
      binding,
    }));
    return candidate;
  }

  function copiedChildren(children, key = null, replacementRef = null) {
    return children.map((edge) => ({
      key: edge.key,
      ref: edge.key === key ? replacementRef : edge.ref,
    }));
  }

  async function readTrieValue(state, rootRef, kind, key) {
    let ref = rootRef;
    for (let offset = 0; ; offset += 1) {
      const loaded = await load(state, ref, kind);
      if (!loaded.ok) return loaded;
      if (!validTrie(state.logical, loaded.object, kind))
        return fail(`invalid-${kind}`, { ref });
      if (offset === key.length)
        return loaded.object.hasValue
          ? { ok: true, found: true, valueRef: loaded.object.valueRef }
          : { ok: true, found: false };
      const edge = loaded.object.children.find(
        (item) => item.key === key[offset],
      );
      if (!edge) return { ok: true, found: false };
      ref = edge.ref;
    }
  }

  async function readPlacement(state, nodeId, missingReason) {
    const located = await readTrieValue(
      state,
      state.root.placementRef,
      "placement-trie",
      nodeId,
    );
    if (!located.ok) return located;
    if (!located.found) return fail(missingReason);
    const record = await load(state, located.valueRef, "placement-record");
    if (!record.ok) return record;
    return validPlacementRecord(state.logical, record.object, nodeId)
      ? { ok: true, record: record.object }
      : fail("invalid-placement-record");
  }

  async function placementDomain(state, nodeId, record, cycleNode = null) {
    const seen = new Set([nodeId]);
    let current = record,
      ancestryReads = 0;
    while (true) {
      const parentId = current.parentId;
      if (parentId === "root" || parentId === "")
        return { ok: true, terminal: parentId, ancestryReads };
      if (parentId === cycleNode) return fail("move-would-cycle");
      if (seen.has(parentId)) return fail("invalid-parent-chain");
      seen.add(parentId);
      const parent = await readPlacement(state, parentId, "unknown-parent");
      if (!parent.ok) return parent;
      current = parent.record;
      ancestryReads += 1;
    }
  }

  async function currentNode(state, nodeId, record) {
    const domain = await placementDomain(state, nodeId, record);
    if (!domain.ok) return domain;
    return domain.terminal === ""
      ? fail("retained-node-not-current")
      : { ok: true, record, ancestryReads: domain.ancestryReads };
  }

  async function currentParent(state, parentId, cycleNode = null) {
    if (parentId === "root") return { ok: true, ancestryReads: 0 };
    if (parentId === "") return fail("retained-parent-not-current");
    if (typeof parentId !== "string") return fail("unknown-parent");
    if (parentId === cycleNode) return fail("move-would-cycle");
    const parent = await readPlacement(state, parentId, "unknown-parent");
    if (!parent.ok) return parent;
    const domain = await placementDomain(
      state,
      parentId,
      parent.record,
      cycleNode,
    );
    if (!domain.ok) return domain;
    return domain.terminal === ""
      ? fail("retained-parent-not-current")
      : {
          ok: true,
          record: parent.record,
          ancestryReads: domain.ancestryReads + 1,
        };
  }

  async function readChildrenRef(state, parentId) {
    return readTrieValue(
      state,
      state.root.childrenRef,
      "children-trie",
      parentId,
    );
  }

  async function loadWorkingTrie(state, frontier, ref, kind) {
    if (!frontier.has(ref)) return load(state, ref, kind);
    const bytes = frontier.get(ref),
      object = JSON.parse(bytes);
    return { ok: true, expectedKind: kind, bytes, object };
  }

  function emptyTrieObject(state, kind) {
    return {
      schema: state.logical.OBJECT_SCHEMA,
      kind,
      hasValue: false,
      valueRef: null,
      children: [],
    };
  }

  async function copyTrieValue(
    state,
    frontier,
    rootRef,
    kind,
    key,
    valueRef,
  ) {
    async function copy(ref, offset) {
      let object;
      if (ref === null) object = emptyTrieObject(state, kind);
      else {
        const loaded = await loadWorkingTrie(state, frontier, ref, kind);
        if (!loaded.ok) return loaded;
        if (!validTrie(state.logical, loaded.object, kind))
          return fail(`invalid-${kind}`, { ref });
        object = loaded.object;
      }
      if (offset === key.length)
        return materialise(state, frontier, kind, {
          schema: state.logical.OBJECT_SCHEMA,
          kind,
          hasValue: true,
          valueRef,
          children: copiedChildren(object.children),
        });
      const character = key[offset],
        edge = object.children.find((item) => item.key === character),
        child = await copy(edge ? edge.ref : null, offset + 1);
      if (!child.ok) return child;
      const children = object.children
        .filter((item) => item.key !== character)
        .map((item) => ({ key: item.key, ref: item.ref }));
      children.push({ key: character, ref: child.ref });
      children.sort((left, right) => left.key.localeCompare(right.key));
      return materialise(state, frontier, kind, {
        schema: state.logical.OBJECT_SCHEMA,
        kind,
        hasValue: object.hasValue,
        valueRef: object.valueRef,
        children,
      });
    }
    return copy(rootRef, 0);
  }

  function kindFromRef(ref) {
    const match = /^proof-ref:v1:([^:]+):[0-9a-f]{8}$/.exec(ref);
    return match ? match[1] : null;
  }

  async function sequenceHeader(state, ref, isRoot) {
    const kind = kindFromRef(ref);
    if (kind !== "sequence-leaf" && kind !== "sequence-branch")
      return fail("invalid-sequence-object", { ref });
    const loaded = await load(state, ref, kind);
    if (!loaded.ok) return loaded;
    const value = loaded.object,
      capacity = state.root.capacity;
    if (
      kind === "sequence-leaf" &&
      exact(value, ["schema", "kind", "capacity", "count", "items"]) &&
      value.schema === state.logical.SEQUENCE_SCHEMA &&
      value.kind === kind &&
      value.capacity === capacity &&
      Number.isInteger(value.count) &&
      value.count >= 0 &&
      Array.isArray(value.items) &&
      value.count === value.items.length &&
      value.items.length <= capacity &&
      (isRoot || value.items.length >= Math.ceil(capacity / 2)) &&
      value.items.every((item) => typeof item === "string")
    )
      return {
        ok: true,
        page: { ref, kind, count: value.count, object: value, children: null },
      };
    if (
      kind === "sequence-branch" &&
      exact(value, [
        "schema",
        "kind",
        "capacity",
        "count",
        "childRefs",
      ]) &&
      value.schema === state.logical.SEQUENCE_SCHEMA &&
      value.kind === kind &&
      value.capacity === capacity &&
      Number.isInteger(value.count) &&
      value.count >= 0 &&
      Array.isArray(value.childRefs) &&
      value.childRefs.length >= (isRoot ? 2 : Math.ceil(capacity / 2)) &&
      value.childRefs.length <= capacity &&
      value.childRefs.every((childRef) => typeof childRef === "string")
    )
      return {
        ok: true,
        page: { ref, kind, count: value.count, object: value },
      };
    return fail("invalid-sequence-object", { ref });
  }

  async function sequencePage(state, page) {
    if (!page) return fail("invalid-sequence-object");
    const header = page;
    if (header.kind === "sequence-leaf")
      return { ok: true, page: header };
    if (Array.isArray(header.children)) return { ok: true, page: header };
    const children = [];
    for (const childRef of header.object.childRefs) {
      const child = await sequenceHeader(state, childRef, false);
      if (!child.ok) return child;
      children.push(child.page);
    }
    if (
      header.count !== children.reduce((sum, child) => sum + child.count, 0)
    )
      return fail("invalid-sequence-object", { ref: header.ref });
    return { ok: true, page: { ...header, children } };
  }

  async function sequenceRoot(state, ref) {
    const header = await sequenceHeader(state, ref, true);
    if (!header.ok) return header;
    return sequencePage(state, header.page);
  }

  function emptySequence(state) {
    return {
      ref: null,
      kind: "sequence-leaf",
      count: 0,
      object: {
        schema: state.logical.SEQUENCE_SCHEMA,
        kind: "sequence-leaf",
        capacity: state.root.capacity,
        count: 0,
        items: [],
      },
      children: null,
    };
  }

  function sequenceLeaf(state, frontier, items) {
    const stored = materialise(state, frontier, "sequence-leaf", {
      schema: state.logical.SEQUENCE_SCHEMA,
      kind: "sequence-leaf",
      capacity: state.root.capacity,
      count: items.length,
      items,
    });
    return stored.ok
      ? {
          ok: true,
          page: {
            ref: stored.ref,
            kind: "sequence-leaf",
            count: items.length,
            object: JSON.parse(stored.bytes),
            children: null,
          },
        }
      : stored;
  }

  function sequenceBranch(state, frontier, children) {
    const count = children.reduce((sum, child) => sum + child.count, 0),
      stored = materialise(state, frontier, "sequence-branch", {
        schema: state.logical.SEQUENCE_SCHEMA,
        kind: "sequence-branch",
        capacity: state.root.capacity,
        count,
        childRefs: children.map((child) => child.ref),
      });
    return stored.ok
      ? {
          ok: true,
          page: {
            ref: stored.ref,
            kind: "sequence-branch",
            count,
            object: JSON.parse(stored.bytes),
            children,
          },
        }
      : stored;
  }

  async function expandedPage(state, page) {
    return page.kind === "sequence-branch" && !Array.isArray(page.children)
      ? sequencePage(state, page)
      : { ok: true, page };
  }

  async function sequenceItemAt(state, root, index) {
    if (!Number.isInteger(index) || index < 0 || index >= root.count)
      return { ok: true, item: null };
    let page = root,
      offset = index;
    while (page.kind === "sequence-branch") {
      const expanded = await expandedPage(state, page);
      if (!expanded.ok) return expanded;
      page = expanded.page;
      let child = 0;
      while (
        child < page.children.length - 1 &&
        offset >= page.children[child].count
      ) {
        offset -= page.children[child].count;
        child += 1;
      }
      page = page.children[child];
    }
    return { ok: true, item: page.object.items[offset] };
  }

  function sequenceEntries(page) {
    return page.kind === "sequence-leaf" ? page.object.items : page.children;
  }

  function sequenceOccupancy(page) {
    return page.kind === "sequence-leaf" ? page.object.items.length : page.children.length;
  }

  async function sequenceWithEntries(state, frontier, page, values) {
    return page.kind === "sequence-leaf"
      ? sequenceLeaf(state, frontier, values)
      : sequenceBranch(state, frontier, values);
  }

  async function expandedSibling(state, page) {
    return page.kind === "sequence-branch" ? expandedPage(state, page) : { ok: true, page };
  }

  async function rebalanceSequenceChildren(state, frontier, children, childIndex) {
    const minimum = Math.ceil(state.root.capacity / 2), childExpanded = await expandedSibling(state, children[childIndex]);
    if (!childExpanded.ok) return childExpanded;
    children[childIndex] = childExpanded.page;
    const child = children[childIndex], leftIndex = childIndex - 1, rightIndex = childIndex + 1;
    if (sequenceOccupancy(child) >= minimum) return { ok: true, children };
    if (leftIndex >= 0) {
      const leftExpanded = await expandedSibling(state, children[leftIndex]);
      if (!leftExpanded.ok) return leftExpanded;
      children[leftIndex] = leftExpanded.page;
      if (sequenceOccupancy(leftExpanded.page) > minimum) {
        const left = sequenceEntries(leftExpanded.page).slice(), moved = left.pop(), values = sequenceEntries(child).slice();
        values.unshift(moved);
        const nextLeft = await sequenceWithEntries(state, frontier, leftExpanded.page, left), nextChild = await sequenceWithEntries(state, frontier, child, values);
        if (!nextLeft.ok) return nextLeft; if (!nextChild.ok) return nextChild;
        children.splice(leftIndex, 2, nextLeft.page, nextChild.page);
        return { ok: true, children };
      }
    }
    if (rightIndex < children.length) {
      const rightExpanded = await expandedSibling(state, children[rightIndex]);
      if (!rightExpanded.ok) return rightExpanded;
      children[rightIndex] = rightExpanded.page;
      if (sequenceOccupancy(rightExpanded.page) > minimum) {
        const values = sequenceEntries(child).slice(), right = sequenceEntries(rightExpanded.page).slice();
        values.push(right.shift());
        const nextChild = await sequenceWithEntries(state, frontier, child, values), nextRight = await sequenceWithEntries(state, frontier, rightExpanded.page, right);
        if (!nextChild.ok) return nextChild; if (!nextRight.ok) return nextRight;
        children.splice(childIndex, 2, nextChild.page, nextRight.page);
        return { ok: true, children };
      }
    }
    if (leftIndex >= 0) {
      const merged = await sequenceWithEntries(state, frontier, children[leftIndex], sequenceEntries(children[leftIndex]).concat(sequenceEntries(child)));
      if (!merged.ok) return merged;
      children.splice(leftIndex, 2, merged.page);
    } else {
      const merged = await sequenceWithEntries(state, frontier, child, sequenceEntries(child).concat(sequenceEntries(children[rightIndex])));
      if (!merged.ok) return merged;
      children.splice(childIndex, 2, merged.page);
    }
    return { ok: true, children };
  }

  async function removeSequencePage(state, frontier, page, index) {
    const expanded = await expandedPage(state, page);
    if (!expanded.ok) return expanded;
    page = expanded.page;
    if (page.kind === "sequence-leaf") {
      const items = page.object.items.slice(); items.splice(index, 1);
      return sequenceLeaf(state, frontier, items);
    }
    let child = 0, offset = index;
    while (child < page.children.length - 1 && offset >= page.children[child].count) { offset -= page.children[child].count; child += 1; }
    const replacement = await removeSequencePage(state, frontier, page.children[child], offset);
    if (!replacement.ok) return replacement;
    const children = page.children.slice(); children[child] = replacement.page;
    const repaired = await rebalanceSequenceChildren(state, frontier, children, child);
    if (!repaired.ok) return repaired;
    return sequenceBranch(state, frontier, repaired.children);
  }

  async function removeSequenceItem(state, frontier, root, index) {
    const removed = await removeSequencePage(state, frontier, root, index);
    if (!removed.ok) return removed;
    let next = removed.page;
    while (next.kind === "sequence-branch") {
      const expanded = await expandedPage(state, next);
      if (!expanded.ok) return expanded;
      next = expanded.page;
      if (next.children.length !== 1) break;
      next = next.children[0];
    }
    return { ok: true, page: next };
  }

  async function addSequencePage(state, frontier, page, index, item) {
    const expanded = await expandedPage(state, page);
    if (!expanded.ok) return expanded;
    page = expanded.page;
    if (page.kind === "sequence-leaf") {
      const items = page.object.items.slice();
      items.splice(index, 0, item);
      if (items.length <= state.root.capacity) {
        const leaf = sequenceLeaf(state, frontier, items);
        return leaf.ok ? { ok: true, pages: [leaf.page] } : leaf;
      }
      const middle = Math.ceil(items.length / 2),
        left = sequenceLeaf(state, frontier, items.slice(0, middle)),
        right = sequenceLeaf(state, frontier, items.slice(middle));
      if (!left.ok) return left;
      if (!right.ok) return right;
      return { ok: true, pages: [left.page, right.page] };
    }
    let child = 0,
      offset = index;
    while (
      child < page.children.length - 1 &&
      offset > page.children[child].count
    ) {
      offset -= page.children[child].count;
      child += 1;
    }
    const replacement = await addSequencePage(
      state,
      frontier,
      page.children[child],
      offset,
      item,
    );
    if (!replacement.ok) return replacement;
    const children = page.children.slice();
    children.splice(child, 1, ...replacement.pages);
    if (children.length <= state.root.capacity) {
      const branch = sequenceBranch(state, frontier, children);
      return branch.ok ? { ok: true, pages: [branch.page] } : branch;
    }
    const middle = Math.ceil(children.length / 2),
      left = sequenceBranch(state, frontier, children.slice(0, middle)),
      right = sequenceBranch(state, frontier, children.slice(middle));
    if (!left.ok) return left;
    if (!right.ok) return right;
    return { ok: true, pages: [left.page, right.page] };
  }

  async function addSequenceItem(state, frontier, root, index, item) {
    const added = await addSequencePage(
      state,
      frontier,
      root,
      index,
      item,
    );
    if (!added.ok) return added;
    if (added.pages.length === 1) return { ok: true, page: added.pages[0] };
    const branch = sequenceBranch(state, frontier, added.pages);
    return branch.ok ? { ok: true, page: branch.page } : branch;
  }

  function destinationIndex(index, count) {
    return Number.isInteger(index) ? Math.max(0, Math.min(index, count)) : count;
  }

  function directFrontierRefs(object) {
    if (object.kind === "candidate-seal")
      return [object.rootRef, object.previousSealRef].filter(Boolean);
    if (object.kind === "pocket-root")
      return [
        object.contentRef,
        object.placementRef,
        object.childrenRef,
        object.preservationRef,
      ];
    if (
      ["content-trie", "placement-trie", "children-trie"].includes(
        object.kind,
      )
    )
      return [
        ...object.children.map((edge) => edge.ref),
        ...(object.hasValue ? [object.valueRef] : []),
      ];
    if (object.kind === "sequence-branch") return object.childRefs;
    return [];
  }

  function reachableFrontier(frontier, sealRef) {
    const reachable = new Set(),
      pending = [sealRef];
    while (pending.length) {
      const ref = pending.pop();
      if (reachable.has(ref) || !frontier.has(ref)) continue;
      reachable.add(ref);
      const object = JSON.parse(frontier.get(ref));
      for (const childRef of directFrontierRefs(object)) pending.push(childRef);
    }
    return new Map([...frontier].filter(([ref]) => reachable.has(ref)));
  }

  async function freshNode(base, input) {
    const state = baseStates.get(base);
    if (!state) return fail("invalid-base-token");
    if (!exact(input, ["nodeId", "parentId", "toIndex", "payload"]))
      return fail("invalid-insert-input");
    const { nodeId, parentId, toIndex } = input;
    if (
      typeof nodeId !== "string" ||
      nodeId.length === 0 ||
      nodeId === "root"
    )
      return fail("invalid-node-id");
    if (typeof parentId !== "string")
      return fail("unknown-parent");
    const payload = state.logical.canonical(input.payload);
    if (!payload.ok) return fail("unsupported-payload-material");
    const content = await readTrieValue(
      state,
      state.root.contentRef,
      "content-trie",
      nodeId,
    );
    if (!content.ok) return content;
    if (content.found) {
      const record = await load(state, content.valueRef, "content-record");
      if (!record.ok) return record;
      if (!validContentRecord(state.logical, record.object, nodeId))
        return fail("invalid-content-record");
      return fail("duplicate-node-id");
    }
    const placementTruth = await readTrieValue(
      state,
      state.root.placementRef,
      "placement-trie",
      nodeId,
    );
    if (!placementTruth.ok) return placementTruth;
    if (placementTruth.found) {
      const record = await load(
        state,
        placementTruth.valueRef,
        "placement-record",
      );
      if (!record.ok) return record;
      if (!validPlacementRecord(state.logical, record.object, nodeId))
        return fail("invalid-placement-record");
      return fail("duplicate-node-id");
    }
    const parent = await currentParent(state, parentId);
    if (!parent.ok) return parent;
    const destinationLocated = await readChildrenRef(state, parentId);
    if (!destinationLocated.ok) return destinationLocated;
    let destination;
    if (destinationLocated.found) {
      const loaded = await sequenceRoot(state, destinationLocated.valueRef);
      if (!loaded.ok) return loaded;
      destination = loaded.page;
    } else destination = emptySequence(state);

    const frontier = new Map(),
      contentRecord = materialise(state, frontier, "content-record", {
        schema: state.logical.OBJECT_SCHEMA,
        kind: "content-record",
        nodeId,
        payload: JSON.parse(payload.bytes),
      });
    if (!contentRecord.ok) return contentRecord;
    const changedContent = await copyTrieValue(
      state,
      frontier,
      state.root.contentRef,
      "content-trie",
      nodeId,
      contentRecord.ref,
    );
    if (!changedContent.ok) return changedContent;
    const placementRecord = materialise(state, frontier, "placement-record", {
      schema: state.logical.OBJECT_SCHEMA,
      kind: "placement-record",
      nodeId,
      parentId,
    });
    if (!placementRecord.ok) return placementRecord;
    const changedPlacement = await copyTrieValue(
      state,
      frontier,
      state.root.placementRef,
      "placement-trie",
      nodeId,
      placementRecord.ref,
    );
    if (!changedPlacement.ok) return changedPlacement;
    const added = await addSequenceItem(
      state,
      frontier,
      destination,
      destinationIndex(toIndex, destination.count),
      nodeId,
    );
    if (!added.ok) return added;
    const changedChildren = await copyTrieValue(
      state,
      frontier,
      state.root.childrenRef,
      "children-trie",
      parentId,
      added.page.ref,
    );
    if (!changedChildren.ok) return changedChildren;
    const root = materialise(state, frontier, "pocket-root", {
      schema: state.logical.ROOT_SCHEMA,
      kind: "pocket-root",
      capacity: state.root.capacity,
      contentRef: changedContent.ref,
      placementRef: changedPlacement.ref,
      childrenRef: changedChildren.ref,
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
    const published = reachableFrontier(frontier, seal.ref),
      newLogicalRefs = Object.freeze(Array.from(published.keys())),
      resolveLogical = (logicalRef) => published.get(logicalRef),
      candidate = Object.freeze({
        rootRef: root.ref,
        sealRef: seal.ref,
        newLogicalRefs,
        resolveLogical,
        diagnostics: Object.freeze({
          logicalFetches: state.stats.logicalFetches,
          logicalCacheHits: state.stats.logicalCacheHits,
          destinationAncestryReads: 0,
          descendantReads: 0,
          newLogicalObjectCount: newLogicalRefs.length,
        }),
      });
    registerSemanticTransition(state, candidate);
    return Object.freeze({ ok: true, candidate });
  }

  async function move(base, nodeId, fromIndex, newParentId, toIndex) {
    const state = baseStates.get(base);
    if (!state) return fail("invalid-base-token");
    if (
      typeof nodeId !== "string" ||
      nodeId.length === 0 ||
      nodeId === "root"
    )
      return fail("invalid-node-id");
    const moved = await readPlacement(state, nodeId, "unknown-node");
    if (!moved.ok) return moved;
    const oldParentId = moved.record.parentId;
    if (newParentId === oldParentId || newParentId === nodeId) {
      const sourceDomain = await currentNode(state, nodeId, moved.record);
      if (!sourceDomain.ok) return sourceDomain;
    }
    if (newParentId === oldParentId)
      return fail("same-parent-reorder-not-in-scope");
    if (newParentId === nodeId) return fail("move-would-cycle");
    const destinationDomain = await currentParent(state, newParentId, nodeId);
    if (!destinationDomain.ok) return destinationDomain;
    const sourceDomain = await currentNode(state, nodeId, moved.record);
    if (!sourceDomain.ok) return sourceDomain;
    const ancestryReads = destinationDomain.ancestryReads;

    const sourceLocated = await readChildrenRef(state, oldParentId);
    if (!sourceLocated.ok) return sourceLocated;
    if (!sourceLocated.found) return fail("placement-membership-mismatch");
    const source = await sequenceRoot(state, sourceLocated.valueRef);
    if (!source.ok) return source;
    const membership = await sequenceItemAt(state, source.page, fromIndex);
    if (!membership.ok) return membership;
    if (membership.item !== nodeId)
      return fail("placement-membership-mismatch");
    const destinationLocated = await readChildrenRef(state, newParentId);
    if (!destinationLocated.ok) return destinationLocated;
    let destination;
    if (destinationLocated.found) {
      const loaded = await sequenceRoot(state, destinationLocated.valueRef);
      if (!loaded.ok) return loaded;
      destination = loaded.page;
    } else destination = emptySequence(state);

    const frontier = new Map(),
      removed = await removeSequenceItem(
        state,
        frontier,
        source.page,
        fromIndex,
      );
    if (!removed.ok) return removed;
    const added = await addSequenceItem(
      state,
      frontier,
      destination,
      destinationIndex(toIndex, destination.count),
      nodeId,
    );
    if (!added.ok) return added;
    const placementRecord = materialise(
      state,
      frontier,
      "placement-record",
      {
        schema: state.logical.OBJECT_SCHEMA,
        kind: "placement-record",
        nodeId,
        parentId: newParentId,
      },
    );
    if (!placementRecord.ok) return placementRecord;
    const placement = await copyTrieValue(
      state,
      frontier,
      state.root.placementRef,
      "placement-trie",
      nodeId,
      placementRecord.ref,
    );
    if (!placement.ok) return placement;
    const sourceChildren = await copyTrieValue(
      state,
      frontier,
      state.root.childrenRef,
      "children-trie",
      oldParentId,
      removed.page.ref,
    );
    if (!sourceChildren.ok) return sourceChildren;
    const children = await copyTrieValue(
      state,
      frontier,
      sourceChildren.ref,
      "children-trie",
      newParentId,
      added.page.ref,
    );
    if (!children.ok) return children;
    const root = materialise(state, frontier, "pocket-root", {
      schema: state.logical.ROOT_SCHEMA,
      kind: "pocket-root",
      capacity: state.root.capacity,
      contentRef: state.root.contentRef,
      placementRef: placement.ref,
      childrenRef: children.ref,
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
    const published = reachableFrontier(frontier, seal.ref),
      newLogicalRefs = Object.freeze(Array.from(published.keys())),
      resolveLogical = (logicalRef) => published.get(logicalRef),
      candidate = Object.freeze({
        rootRef: root.ref,
        sealRef: seal.ref,
        newLogicalRefs,
        resolveLogical,
        diagnostics: Object.freeze({
          logicalFetches: state.stats.logicalFetches,
          logicalCacheHits: state.stats.logicalCacheHits,
          destinationAncestryReads: ancestryReads,
          descendantReads: 0,
          newLogicalObjectCount: newLogicalRefs.length,
        }),
      });
    registerSemanticTransition(state, candidate);
    return Object.freeze({ ok: true, candidate });
  }

  async function deleteBranch(base, nodeId, fromIndex) {
    const state = baseStates.get(base);
    if (!state) return fail("invalid-base-token");
    if (
      typeof nodeId !== "string" ||
      nodeId.length === 0 ||
      nodeId === "root"
    )
      return fail("invalid-node-id");
    const moved = await readPlacement(state, nodeId, "unknown-node");
    if (!moved.ok) return moved;
    const sourceDomain = await currentNode(state, nodeId, moved.record);
    if (!sourceDomain.ok) return sourceDomain;
    const sourceParentId = moved.record.parentId,
      sourceLocated = await readChildrenRef(state, sourceParentId);
    if (!sourceLocated.ok) return sourceLocated;
    if (!sourceLocated.found) return fail("placement-membership-mismatch");
    const source = await sequenceRoot(state, sourceLocated.valueRef);
    if (!source.ok) return source;
    const membership = await sequenceItemAt(state, source.page, fromIndex);
    if (!membership.ok) return membership;
    if (membership.item !== nodeId)
      return fail("placement-membership-mismatch");
    const retainedLocated = await readChildrenRef(state, "");
    if (!retainedLocated.ok) return retainedLocated;
    let retained;
    if (retainedLocated.found) {
      const loaded = await sequenceRoot(state, retainedLocated.valueRef);
      if (!loaded.ok) return loaded;
      retained = loaded.page;
    } else retained = emptySequence(state);

    const frontier = new Map(),
      removed = await removeSequenceItem(
        state,
        frontier,
        source.page,
        fromIndex,
      );
    if (!removed.ok) return removed;
    const appended = await addSequenceItem(
      state,
      frontier,
      retained,
      retained.count,
      nodeId,
    );
    if (!appended.ok) return appended;
    const placementRecord = materialise(state, frontier, "placement-record", {
      schema: state.logical.OBJECT_SCHEMA,
      kind: "placement-record",
      nodeId,
      parentId: "",
    });
    if (!placementRecord.ok) return placementRecord;
    const placement = await copyTrieValue(
      state,
      frontier,
      state.root.placementRef,
      "placement-trie",
      nodeId,
      placementRecord.ref,
    );
    if (!placement.ok) return placement;
    const sourceChildren = await copyTrieValue(
      state,
      frontier,
      state.root.childrenRef,
      "children-trie",
      sourceParentId,
      removed.page.ref,
    );
    if (!sourceChildren.ok) return sourceChildren;
    const children = await copyTrieValue(
      state,
      frontier,
      sourceChildren.ref,
      "children-trie",
      "",
      appended.page.ref,
    );
    if (!children.ok) return children;
    const root = materialise(state, frontier, "pocket-root", {
      schema: state.logical.ROOT_SCHEMA,
      kind: "pocket-root",
      capacity: state.root.capacity,
      contentRef: state.root.contentRef,
      placementRef: placement.ref,
      childrenRef: children.ref,
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
    const published = reachableFrontier(frontier, seal.ref),
      newLogicalRefs = Object.freeze(Array.from(published.keys())),
      resolveLogical = (logicalRef) => published.get(logicalRef),
      candidate = Object.freeze({
        rootRef: root.ref,
        sealRef: seal.ref,
        newLogicalRefs,
        resolveLogical,
        diagnostics: Object.freeze({
          logicalFetches: state.stats.logicalFetches,
          logicalCacheHits: state.stats.logicalCacheHits,
          sourceAncestryReads: sourceDomain.ancestryReads,
          descendantReads: 0,
          newLogicalObjectCount: newLogicalRefs.length,
        }),
      });
    registerSemanticTransition(state, candidate);
    return Object.freeze({ ok: true, candidate });
  }

  async function reorderWithinParent(base, nodeId, fromIndex, toIndex) {
    const state = baseStates.get(base);
    if (!state) return fail("invalid-base-token");
    if (
      typeof nodeId !== "string" ||
      nodeId.length === 0 ||
      nodeId === "root"
    )
      return fail("invalid-node-id");
    const moved = await readPlacement(state, nodeId, "unknown-node");
    if (!moved.ok) return moved;
    const sourceDomain = await currentNode(state, nodeId, moved.record);
    if (!sourceDomain.ok) return sourceDomain;
    const parentId = moved.record.parentId,
      located = await readChildrenRef(state, parentId);
    if (!located.ok) return located;
    if (!located.found) return fail("placement-membership-mismatch");
    const current = await sequenceRoot(state, located.valueRef);
    if (!current.ok) return current;
    const membership = await sequenceItemAt(state, current.page, fromIndex);
    if (!membership.ok) return membership;
    if (membership.item !== nodeId)
      return fail("placement-membership-mismatch");

    const requested = destinationIndex(toIndex, current.page.count),
      adjusted = requested > fromIndex ? requested - 1 : requested;
    if (adjusted === fromIndex)
      return Object.freeze({ ok: true, changed: false, reason: "no-change" });

    const frontier = new Map(),
      removed = await removeSequenceItem(
        state,
        frontier,
        current.page,
        fromIndex,
      );
    if (!removed.ok) return removed;
    const added = await addSequenceItem(
      state,
      frontier,
      removed.page,
      adjusted,
      nodeId,
    );
    if (!added.ok) return added;
    if (added.page.ref === current.page.ref)
      return Object.freeze({ ok: true, changed: false, reason: "no-change" });

    const children = await copyTrieValue(
      state,
      frontier,
      state.root.childrenRef,
      "children-trie",
      parentId,
      added.page.ref,
    );
    if (!children.ok) return children;
    const root = materialise(state, frontier, "pocket-root", {
      schema: state.logical.ROOT_SCHEMA,
      kind: "pocket-root",
      capacity: state.root.capacity,
      contentRef: state.root.contentRef,
      placementRef: state.root.placementRef,
      childrenRef: children.ref,
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
    const published = reachableFrontier(frontier, seal.ref),
      newLogicalRefs = Object.freeze(Array.from(published.keys())),
      resolveLogical = (logicalRef) => published.get(logicalRef),
      candidate = Object.freeze({
        rootRef: root.ref,
        sealRef: seal.ref,
        newLogicalRefs,
        resolveLogical,
        diagnostics: Object.freeze({
          logicalFetches: state.stats.logicalFetches,
          logicalCacheHits: state.stats.logicalCacheHits,
          destinationAncestryReads: 0,
          descendantReads: 0,
          newLogicalObjectCount: newLogicalRefs.length,
        }),
      });
    registerSemanticTransition(state, candidate);
    return Object.freeze({ ok: true, changed: true, candidate });
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
    const placement = await readPlacement(state, nodeId, "unknown-node");
    if (!placement.ok) return placement;
    const sourceDomain = await currentNode(state, nodeId, placement.record);
    if (!sourceDomain.ok) return sourceDomain;
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
    registerSemanticTransition(state, candidate);
    return Object.freeze({ ok: true, changed: true, candidate });
  }

  function diagnostics(base) {
    const state = baseStates.get(base);
    return state ? diagnosticsFor(state) : fail("invalid-base-token");
  }

  function semanticTransitionBinding(candidate, authority, semanticBaseProof) {
    const transition = semanticTransitions.get(candidate);
    return transition && transition.authority === authority &&
      transition.semanticBaseProof === semanticBaseProof &&
      candidate && candidate.sealRef === transition.binding.logicalSealRef &&
      candidate.rootRef === transition.binding.logicalRootRef &&
      transition.binding.previousLogicalSealRef === transition.baseSealRef
      ? transition.binding : null;
  }

  global.PocketStarlingLogicalEditShadow = Object.freeze({
    createBase,
    insert: freshNode,
    editPayload,
    move,
    deleteBranch,
    reorder: reorderWithinParent,
    diagnostics,
    semanticTransitionBinding,
  });
})(typeof window !== "undefined" ? window : globalThis);
