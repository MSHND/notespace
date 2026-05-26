/* pocket outline model foundation

Purpose:
- Add structured collapsible outline capacity for editor bodies.
- Keep old node.details text untouched for compatibility.
- Keep this file pure/model-only: no DOM, no UI, no storage writes.

Data shape target:
node.editor = {
  mode: "outline",
  outline: {
    schema: "pocket.outline.v1",
    blocks: [
      { id, parentId, type, text, collapsed, order }
    ]
  }
}
*/

(function initialisePocketOutlineModel(global) {
  "use strict";

  const OUTLINE_SCHEMA = "pocket.outline.v1";
  const ROOT_PARENT_ID = "root";
  const VALID_TYPES = new Set(["text", "heading", "note", "task"]);

  function clean(value, max = 4000) {
    return String(value == null ? "" : value).replace(/\r\n?/g, "\n").slice(0, max);
  }

  function makeOutlineId(prefix = "block") {
    if (typeof global.makeId === "function") return global.makeId(prefix);
    return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 9)}`;
  }

  function normaliseBlock(raw = {}, index = 0) {
    const id = clean(raw.id, 80) || makeOutlineId();
    const parentId = clean(raw.parentId, 80) || ROOT_PARENT_ID;
    const type = VALID_TYPES.has(raw.type) ? raw.type : "text";
    const orderNumber = Number(raw.order);
    return {
      id,
      parentId: parentId === id ? ROOT_PARENT_ID : parentId,
      type,
      text: clean(raw.text, 4000),
      collapsed: !!raw.collapsed,
      order: Number.isFinite(orderNumber) ? orderNumber : (index + 1) * 1000
    };
  }

  function normaliseOutline(raw = {}) {
    const blocks = Array.isArray(raw.blocks) ? raw.blocks : [];
    const seen = new Set();
    const normalised = [];

    blocks.forEach((block, index) => {
      const next = normaliseBlock(block, index);
      if (seen.has(next.id)) next.id = makeOutlineId();
      seen.add(next.id);
      normalised.push(next);
    });

    const ids = new Set(normalised.map((block) => block.id));
    normalised.forEach((block) => {
      if (block.parentId !== ROOT_PARENT_ID && !ids.has(block.parentId)) {
        block.parentId = ROOT_PARENT_ID;
      }
    });

    return {
      schema: OUTLINE_SCHEMA,
      blocks: sortBlocks(normalised)
    };
  }

  function emptyOutline() {
    return {
      schema: OUTLINE_SCHEMA,
      blocks: []
    };
  }

  function outlineFromPlainText(text = "") {
    const lines = clean(text, 200000).split("\n");
    const blocks = lines.map((line, index) => ({
      id: makeOutlineId(),
      parentId: ROOT_PARENT_ID,
      type: /^#{1,6}\s+/.test(line) ? "heading" : "text",
      text: line.replace(/^#{1,6}\s+/, ""),
      collapsed: false,
      order: (index + 1) * 1000
    }));
    return normaliseOutline({ blocks });
  }

  function outlineToPlainText(outline = {}) {
    return sortBlocks(normaliseOutline(outline).blocks)
      .map((block) => block.text || "")
      .join("\n");
  }

  function sortBlocks(blocks = []) {
    return [...blocks].sort((a, b) => {
      const parentCompare = String(a.parentId || ROOT_PARENT_ID).localeCompare(String(b.parentId || ROOT_PARENT_ID));
      if (parentCompare !== 0) return parentCompare;
      const orderCompare = (Number(a.order) || 0) - (Number(b.order) || 0);
      if (orderCompare !== 0) return orderCompare;
      return String(a.id || "").localeCompare(String(b.id || ""));
    });
  }

  function childrenMap(outline = {}) {
    const map = new Map();
    for (const block of normaliseOutline(outline).blocks) {
      const parentId = block.parentId || ROOT_PARENT_ID;
      if (!map.has(parentId)) map.set(parentId, []);
      map.get(parentId).push(block);
    }
    for (const [key, blocks] of map.entries()) {
      map.set(key, sortBlocks(blocks));
    }
    return map;
  }

  function blockMap(outline = {}) {
    const map = new Map();
    for (const block of normaliseOutline(outline).blocks) {
      map.set(block.id, block);
    }
    return map;
  }

  function addBlock(outline = {}, partial = {}, options = {}) {
    const current = normaliseOutline(outline);
    const parentId = clean(partial.parentId || options.parentId, 80) || ROOT_PARENT_ID;
    const siblings = current.blocks.filter((block) => block.parentId === parentId);
    const maxOrder = siblings.reduce((max, block) => Math.max(max, Number(block.order) || 0), 0);
    const block = normaliseBlock({
      ...partial,
      id: partial.id || makeOutlineId(),
      parentId,
      order: partial.order || maxOrder + 1000
    });
    return normaliseOutline({ blocks: [...current.blocks, block] });
  }

  function updateBlock(outline = {}, blockId = "", patch = {}) {
    const id = clean(blockId, 80);
    const current = normaliseOutline(outline);
    return normaliseOutline({
      blocks: current.blocks.map((block) => block.id === id ? normaliseBlock({ ...block, ...patch }) : block)
    });
  }

  function removeBlock(outline = {}, blockId = "", options = {}) {
    const id = clean(blockId, 80);
    const current = normaliseOutline(outline);
    const removeChildren = options.removeChildren !== false;
    const removing = new Set([id]);

    if (removeChildren) {
      let changed = true;
      while (changed) {
        changed = false;
        for (const block of current.blocks) {
          if (removing.has(block.parentId) && !removing.has(block.id)) {
            removing.add(block.id);
            changed = true;
          }
        }
      }
    }

    return normaliseOutline({
      blocks: current.blocks
        .filter((block) => !removing.has(block.id))
        .map((block) => block.parentId === id ? { ...block, parentId: ROOT_PARENT_ID } : block)
    });
  }

  function toggleCollapsed(outline = {}, blockId = "") {
    const map = blockMap(outline);
    const block = map.get(clean(blockId, 80));
    if (!block) return normaliseOutline(outline);
    return updateBlock(outline, block.id, { collapsed: !block.collapsed });
  }

  function indentBlock(outline = {}, blockId = "") {
    const id = clean(blockId, 80);
    const current = normaliseOutline(outline);
    const block = current.blocks.find((item) => item.id === id);
    if (!block) return current;
    const siblings = sortBlocks(current.blocks.filter((item) => item.parentId === block.parentId));
    const index = siblings.findIndex((item) => item.id === id);
    const previous = index > 0 ? siblings[index - 1] : null;
    if (!previous) return current;
    return updateBlock(current, id, { parentId: previous.id });
  }

  function outdentBlock(outline = {}, blockId = "") {
    const id = clean(blockId, 80);
    const current = normaliseOutline(outline);
    const map = blockMap(current);
    const block = map.get(id);
    if (!block || block.parentId === ROOT_PARENT_ID) return current;
    const parent = map.get(block.parentId);
    return updateBlock(current, id, { parentId: parent ? parent.parentId : ROOT_PARENT_ID });
  }

  global.PocketOutlineModel = Object.freeze({
    OUTLINE_SCHEMA,
    ROOT_PARENT_ID,
    emptyOutline,
    normaliseOutline,
    normaliseBlock,
    outlineFromPlainText,
    outlineToPlainText,
    sortBlocks,
    childrenMap,
    blockMap,
    addBlock,
    updateBlock,
    removeBlock,
    toggleCollapsed,
    indentBlock,
    outdentBlock
  });
})(window);
