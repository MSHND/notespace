/* Dormant P132e persistent implicit-index B+ sequence. */
(function (global) {
  "use strict";
  const fail = (reason) => ({ ok: false, reason });
  const validCapacity = (capacity) => Number.isInteger(capacity) && capacity >= 3;
  const capacityFor = (options = {}) => {
    if (!Object.prototype.hasOwnProperty.call(options, "capacity")) return { ok: true, capacity: 4 };
    return validCapacity(options.capacity) ? { ok: true, capacity: options.capacity } : fail("invalid-capacity");
  };
  const minimum = (capacity) => Math.ceil(capacity / 2);
  const count = (page) => page.count;
  const leaf = (items, capacity) => Object.freeze({ kind: "leaf", items: Object.freeze(items), count: items.length, capacity });
  const branch = (children, capacity) => Object.freeze({ kind: "branch", children: Object.freeze(children), count: children.reduce((n, child) => n + count(child), 0), capacity });
  const entries = (page) => page.kind === "leaf" ? page.items : page.children;
  const make = (page, values, capacity) => page.kind === "leaf" ? leaf(values, capacity) : branch(values, capacity);
  const occupancy = (page) => page.kind === "leaf" ? page.items.length : page.children.length;
  const underfull = (page, capacity) => occupancy(page) < minimum(capacity);
  function group(values, capacity, constructor) {
    const groupCount = Math.ceil(values.length / capacity), base = Math.floor(values.length / groupCount), extra = values.length % groupCount;
    const pages = []; let offset = 0;
    for (let index = 0; index < groupCount; index += 1) {
      const size = base + (index < extra ? 1 : 0);
      pages.push(constructor(values.slice(offset, offset + size), capacity)); offset += size;
    }
    return pages;
  }
  function build(items, options = {}) {
    if (!Array.isArray(items) || !items.every((item) => typeof item === "string")) return fail("invalid-items");
    const chosen = capacityFor(options); if (!chosen.ok) return chosen;
    const capacity = chosen.capacity;
    if (items.length <= capacity) return { ok: true, root: leaf(items.slice(), capacity), capacity };
    let level = group(items, capacity, leaf);
    while (level.length > capacity) level = group(level, capacity, branch);
    return { ok: true, root: branch(level, capacity), capacity };
  }
  function materialise(page, out = []) { if (page.kind === "leaf") out.push(...page.items); else page.children.forEach((child) => materialise(child, out)); return out; }
  function audit(root) {
    if (!root || typeof root !== "object" || !validCapacity(root.capacity)) return fail("invalid-sequence");
    const capacity = root.capacity, seen = new Set(), active = new Set(); let leafDepth = null;
    function visit(page, isRoot, depth) {
      if (!page || typeof page !== "object" || active.has(page) || seen.has(page)) return fail("invalid-sequence");
      if (page.capacity !== capacity || !Number.isInteger(page.count) || page.count < 0) return fail("invalid-sequence");
      active.add(page); seen.add(page); let result;
      if (page.kind === "leaf") {
        if (!Array.isArray(page.items) || !page.items.every((item) => typeof item === "string") || page.count !== page.items.length || page.items.length > capacity || (!isRoot && page.items.length < minimum(capacity))) result = fail("invalid-sequence");
        else if (leafDepth !== null && leafDepth !== depth) result = fail("invalid-sequence");
        else { leafDepth = depth; result = { ok: true, count: page.count }; }
      } else if (page.kind === "branch") {
        const size = Array.isArray(page.children) ? page.children.length : -1, min = isRoot ? 2 : minimum(capacity);
        if (size < min || size > capacity) result = fail("invalid-sequence");
        else {
          let total = 0; result = { ok: true };
          for (const child of page.children) {
            const checked = visit(child, false, depth + 1);
            if (!checked.ok) { result = checked; break; }
            if (checked.count <= 0) { result = fail("invalid-sequence"); break; }
            total += checked.count;
          }
          if (result.ok && total !== page.count) result = fail("invalid-sequence");
          if (result.ok) result.count = total;
        }
      } else result = fail("invalid-sequence");
      active.delete(page); return result;
    }
    const checked = visit(root, true, 0); return checked.ok ? { ok: true, count: checked.count, height: leafDepth } : checked;
  }
  function insertPage(page, index, item, capacity) {
    if (page.kind === "leaf") {
      const items = page.items.slice(); items.splice(index, 0, item);
      if (items.length <= capacity) return [leaf(items, capacity)];
      const middle = Math.ceil(items.length / 2); return [leaf(items.slice(0, middle), capacity), leaf(items.slice(middle), capacity)];
    }
    let child = 0, at = index;
    while (child < page.children.length - 1 && at > count(page.children[child])) { at -= count(page.children[child]); child += 1; }
    const replacement = insertPage(page.children[child], at, item, capacity), children = page.children.slice();
    children.splice(child, 1, ...replacement);
    if (children.length <= capacity) return [branch(children, capacity)];
    const middle = Math.ceil(children.length / 2); return [branch(children.slice(0, middle), capacity), branch(children.slice(middle), capacity)];
  }
  function insertAt(page, index, item) {
    if (!page || !validCapacity(page.capacity) || !Number.isInteger(index) || index < 0 || index > count(page) || typeof item !== "string") return fail("invalid-index");
    const replacement = insertPage(page, index, item, page.capacity), root = replacement.length === 1 ? replacement[0] : branch(replacement, page.capacity);
    return { ok: true, root, capacity: page.capacity };
  }
  function rebalance(children, childIndex, capacity) {
    const min = minimum(capacity), child = children[childIndex], left = childIndex > 0 ? children[childIndex - 1] : null, right = childIndex + 1 < children.length ? children[childIndex + 1] : null;
    if (!underfull(child, capacity)) return children;
    if (left && occupancy(left) > min) {
      const leftEntries = entries(left).slice(), childEntries = entries(child).slice(); childEntries.unshift(leftEntries.pop());
      children.splice(childIndex - 1, 2, make(left, leftEntries, capacity), make(child, childEntries, capacity)); return children;
    }
    if (right && occupancy(right) > min) {
      const childEntries = entries(child).slice(), rightEntries = entries(right).slice(); childEntries.push(rightEntries.shift());
      children.splice(childIndex, 2, make(child, childEntries, capacity), make(right, rightEntries, capacity)); return children;
    }
    if (left) { children.splice(childIndex - 1, 2, make(left, entries(left).concat(entries(child)), capacity)); return children; }
    children.splice(childIndex, 2, make(child, entries(child).concat(entries(right)), capacity)); return children;
  }
  function removePage(page, index, capacity) {
    if (page.kind === "leaf") { const items = page.items.slice(); items.splice(index, 1); return leaf(items, capacity); }
    let child = 0, at = index;
    while (child < page.children.length - 1 && at >= count(page.children[child])) { at -= count(page.children[child]); child += 1; }
    const children = page.children.slice(); children[child] = removePage(children[child], at, capacity);
    return branch(rebalance(children, child, capacity), capacity);
  }
  function removeAt(page, index) {
    if (!page || !validCapacity(page.capacity) || !Number.isInteger(index) || index < 0 || index >= count(page)) return fail("invalid-index");
    const capacity = page.capacity; let root = removePage(page, index, capacity);
    while (root.kind === "branch" && root.children.length === 1) root = root.children[0];
    return { ok: true, root, capacity };
  }
  function pages(page, out = []) { out.push(page); if (page.kind === "branch") page.children.forEach((child) => pages(child, out)); return out; }
  function height(page) { return page.kind === "leaf" ? 0 : 1 + height(page.children[0]); }
  global.PocketStarlingSequenceShadow = Object.freeze({ build, materialise, insertAt, removeAt, pages, height, audit });
})(typeof window !== "undefined" ? window : globalThis);
