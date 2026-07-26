/* FILE / DEVICE comparison, three-way combination and decision UI owner. */

(function initialisePocketDeviceChanges(global) {
  "use strict";

  const MODULE_SCHEMA = "pocket.deviceChanges.v1";
  const PLAN_SCHEMA = "pocket.deviceChanges.plan.v1";
  const FINGERPRINT_SCHEMA = "pocket.baseFingerprint.fnv1a32.v1";
  const MAX_COMPARISON_CHARS = 5000000;
  const MAX_COMPARISON_NODES = 10000;
  const NO_BASE_MESSAGE = "Pocket doesn’t have the earlier shared version needed to combine these safely.";
  const UNSAFE_COMBINATION_MESSAGE = "Pocket can’t safely combine these versions automatically. You can still use either version or review the differences.";
  const MISSING = Symbol("missing");
  const ROOT_TRANSPORT_KEYS = new Set([
    "schema",
    "exportedAt",
    "writtenAt",
    "cachedAt",
    "mainThoughtTree",
    "mainThoughtTreeTombstones",
    "data",
    "snapshot",
    "source",
    "summary",
    "operations",
    "pocketGuard"
  ]);
  const DATA_TRANSPORT_KEYS = new Set([
    "mainThoughtTree",
    "mainThoughtTreeTombstones",
    "pocketGuard"
  ]);
  const NODE_VOLATILE_KEYS = new Set(["updatedAt", "pe"]);
  const NODE_METADATA_KEYS = new Set(["source", "task", "profile", "system", "status"]);

  function isPlainObject(value) {
    if (!value || typeof value !== "object" || Array.isArray(value)) return false;
    const tag = Object.prototype.toString.call(value);
    return tag === "[object Object]";
  }

  function cloneJsonCompatible(value) {
    const ancestors = new Set();

    function clone(current) {
      if (current === null || typeof current === "string" || typeof current === "boolean") {
        return { ok: true, value: current };
      }
      if (typeof current === "number") {
        return Number.isFinite(current)
          ? { ok: true, value: current }
          : { ok: false, reason: "non-finite-number" };
      }
      if (typeof current !== "object" || ancestors.has(current)) {
        return { ok: false, reason: ancestors.has(current) ? "cyclic-value" : "non-json-value" };
      }

      ancestors.add(current);
      const output = Array.isArray(current) ? [] : {};
      const keys = Array.isArray(current)
        ? Array.from({ length: current.length }, function (_unused, index) { return String(index); })
        : Object.keys(current);
      for (const key of keys) {
        const child = clone(current[key]);
        if (!child.ok) {
          ancestors.delete(current);
          return child;
        }
        if (Array.isArray(output)) {
          output.push(child.value);
        } else {
          Object.defineProperty(output, key, {
            value: child.value,
            enumerable: true,
            writable: true,
            configurable: true
          });
        }
      }
      ancestors.delete(current);
      return { ok: true, value: output };
    }

    try {
      return clone(value);
    } catch (_error) {
      return { ok: false, reason: "clone-failed" };
    }
  }

  function stableStringify(value) {
    const ancestors = new Set();

    function serialise(current) {
      if (current === null) return "null";
      if (typeof current === "string") return JSON.stringify(current);
      if (typeof current === "boolean") return current ? "true" : "false";
      if (typeof current === "number") {
        if (!Number.isFinite(current)) throw new TypeError("Non-finite numbers are not JSON-compatible.");
        return Object.is(current, -0) ? "0" : JSON.stringify(current);
      }
      if (typeof current !== "object" || ancestors.has(current)) {
        throw new TypeError(ancestors.has(current) ? "Cyclic values are not supported." : "Non-JSON values are not supported.");
      }

      ancestors.add(current);
      let output;
      if (Array.isArray(current)) {
        output = "[" + current.map(serialise).join(",") + "]";
      } else {
        output = "{" + Object.keys(current)
          .sort()
          .map(function (key) { return JSON.stringify(key) + ":" + serialise(current[key]); })
          .join(",") + "}";
      }
      ancestors.delete(current);
      return output;
    }

    return serialise(value);
  }

  function equalValue(left, right) {
    if (left === MISSING || right === MISSING) return left === right;
    try {
      return stableStringify(left) === stableStringify(right);
    } catch (_error) {
      return false;
    }
  }

  function cloneValue(value) {
    if (value === MISSING) return MISSING;
    const cloned = cloneJsonCompatible(value);
    if (!cloned.ok) throw new TypeError("Pocket could not safely copy comparison data.");
    return cloned.value;
  }

  function objectWithoutKeys(source, omittedKeys) {
    const output = {};
    if (!isPlainObject(source)) return output;
    for (const key of Object.keys(source)) {
      if (omittedKeys.has(key)) continue;
      const cloned = cloneJsonCompatible(source[key]);
      if (!cloned.ok) throw new TypeError("Pocket could not safely copy comparison metadata.");
      Object.defineProperty(output, key, {
        value: cloned.value,
        enumerable: true,
        writable: true,
        configurable: true
      });
    }
    return output;
  }

  function semanticNode(node) {
    const output = {};
    for (const key of Object.keys(node || {}).sort()) {
      if (NODE_VOLATILE_KEYS.has(key)) continue;
      const cloned = cloneJsonCompatible(node[key]);
      if (!cloned.ok) throw new TypeError("Pocket could not safely compare an item.");
      Object.defineProperty(output, key, {
        value: cloned.value,
        enumerable: true,
        writable: true,
        configurable: true
      });
    }
    return output;
  }

  function semanticNodeArray(nodes) {
    return (Array.isArray(nodes) ? nodes : [])
      .map(semanticNode)
      .sort(function (left, right) {
        return String(left.id || "").localeCompare(String(right.id || ""));
      });
  }

  function documentNodeMap(documentValue) {
    return new Map((Array.isArray(documentValue?.nodes) ? documentValue.nodes : [])
      .filter(function (node) { return isPlainObject(node) && String(node.id || ""); })
      .map(function (node) { return [String(node.id), node]; }));
  }

  function nodePath(documentValue, nodeId) {
    const map = documentNodeMap(documentValue);
    const parts = [];
    const seen = new Set();
    let current = map.get(String(nodeId || ""));
    while (current && !seen.has(String(current.id || ""))) {
      const id = String(current.id || "");
      seen.add(id);
      parts.unshift(String(current.label || id || "Item"));
      const parentId = String(current.parentId || "root");
      current = parentId && parentId !== "root" ? map.get(parentId) : null;
    }
    return parts.join(" / ");
  }

  function nodeChangeKind(key) {
    if (key === "label") return "title";
    if (key === "details") return "notes";
    if (key === "editor") return "outline";
    if (key === "parentId") return "move";
    if (key === "order") return "order";
    if (key === "urgent") return "urgent";
    if (key === "copyContext") return "copy-context";
    return NODE_METADATA_KEYS.has(key) ? "metadata" : "extra";
  }

  function tombstoneIdentity(value) {
    if (isPlainObject(value) && String(value.id || "")) return "id:" + String(value.id);
    try {
      return "value:" + stableStringify(value);
    } catch (_error) {
      return "";
    }
  }

  function describeDocumentTransition(beforeInput, afterInput, options) {
    const beforeResult = coerceDocument(beforeInput);
    const afterResult = coerceDocument(afterInput);
    if (!beforeResult.ok || !afterResult.ok) {
      return { ok: false, reason: "invalid-document", records: [] };
    }
    const before = beforeResult.document;
    const after = afterResult.document;
    const beforeMap = documentNodeMap(before);
    const afterMap = documentNodeMap(after);
    const records = [];
    const operationType = String(options?.operationType || options?.type || "");
    const deletedIds = new Set(Array.from(beforeMap.keys()).filter(function (id) {
      return !afterMap.has(id);
    }));

    for (const id of Array.from(new Set([...beforeMap.keys(), ...afterMap.keys()])).sort()) {
      const beforeNode = beforeMap.get(id);
      const afterNode = afterMap.get(id);
      if (!beforeNode && afterNode) {
        records.push({
          scope: "node",
          kind: "add",
          id,
          title: String(afterNode.label || id),
          pathAfter: nodePath(after, id),
          operationType
        });
        continue;
      }
      if (beforeNode && !afterNode) {
        const deletedDescendants = Array.from(deletedIds).filter(function (candidateId) {
          if (candidateId === id) return false;
          let current = beforeMap.get(candidateId);
          const seen = new Set();
          while (current && !seen.has(String(current.id || ""))) {
            const currentId = String(current.id || "");
            seen.add(currentId);
            const parentId = String(current.parentId || "root");
            if (parentId === id) return true;
            current = parentId && parentId !== "root" ? beforeMap.get(parentId) : null;
          }
          return false;
        });
        records.push({
          scope: deletedDescendants.length > 0 ? "subtree" : "node",
          kind: "delete",
          id,
          title: String(beforeNode.label || id),
          pathBefore: nodePath(before, id),
          parentIdBefore: String(beforeNode.parentId || "root"),
          orderBefore: Number.isFinite(Number(beforeNode.order)) ? Number(beforeNode.order) : null,
          descendantIds: deletedDescendants.sort(),
          operationType
        });
        continue;
      }
      if (!beforeNode || !afterNode) continue;
      const beforeSemantic = semanticNode(beforeNode);
      const afterSemantic = semanticNode(afterNode);
      const keys = Array.from(new Set([
        ...Object.keys(beforeSemantic),
        ...Object.keys(afterSemantic)
      ])).filter(function (key) {
        return key !== "id" && !NODE_VOLATILE_KEYS.has(key);
      }).sort();
      for (const key of keys) {
        const beforeValue = Object.prototype.hasOwnProperty.call(beforeSemantic, key)
          ? beforeSemantic[key]
          : MISSING;
        const afterValue = Object.prototype.hasOwnProperty.call(afterSemantic, key)
          ? afterSemantic[key]
          : MISSING;
        if (equalValue(beforeValue, afterValue)) continue;
        records.push({
          scope: "node",
          kind: nodeChangeKind(key),
          id,
          field: key,
          title: String(afterNode.label || beforeNode.label || id),
          pathBefore: nodePath(before, id),
          pathAfter: nodePath(after, id),
          operationType
        });
      }
    }

    for (const [scope, beforeObject, afterObject] of [
      ["root", before.rootExtras || {}, after.rootExtras || {}],
      ["data", before.dataExtras || {}, after.dataExtras || {}]
    ]) {
      const keys = Array.from(new Set([
        ...Object.keys(beforeObject),
        ...Object.keys(afterObject)
      ])).sort();
      for (const key of keys) {
        const beforeValue = Object.prototype.hasOwnProperty.call(beforeObject, key)
          ? beforeObject[key]
          : MISSING;
        const afterValue = Object.prototype.hasOwnProperty.call(afterObject, key)
          ? afterObject[key]
          : MISSING;
        if (equalValue(beforeValue, afterValue)) continue;
        records.push({ scope, kind: "field", id: key, field: key, operationType });
      }
    }

    const beforeTombstones = new Map((before.tombstones || []).map(function (item) {
      return [tombstoneIdentity(item), item];
    }).filter(function (entry) { return entry[0]; }));
    const afterTombstones = new Map((after.tombstones || []).map(function (item) {
      return [tombstoneIdentity(item), item];
    }).filter(function (entry) { return entry[0]; }));
    for (const key of Array.from(new Set([
      ...beforeTombstones.keys(),
      ...afterTombstones.keys()
    ])).sort()) {
      const beforeValue = beforeTombstones.has(key) ? beforeTombstones.get(key) : MISSING;
      const afterValue = afterTombstones.has(key) ? afterTombstones.get(key) : MISSING;
      if (equalValue(beforeValue, afterValue)) continue;
      records.push({
        scope: "tombstone",
        kind: beforeValue === MISSING ? "add" : (afterValue === MISSING ? "delete" : "change"),
        id: key.startsWith("id:") ? key.slice(3) : key,
        operationType
      });
    }

    return { ok: true, records };
  }

  function sortedTombstones(tombstones) {
    return (Array.isArray(tombstones) ? tombstones : [])
      .map(function (item) {
        const cloned = cloneJsonCompatible(item);
        if (!cloned.ok) throw new TypeError("Pocket could not safely compare deleted-item records.");
        return cloned.value;
      })
      .sort(function (left, right) {
        return stableStringify(left).localeCompare(stableStringify(right));
      });
  }

  function extractRawDocument(input) {
    if (Array.isArray(input)) {
      return {
        ok: true,
        document: {
          nodes: input,
          tombstones: [],
          rootExtras: {},
          dataExtras: {}
        },
        ambiguousTreeCopies: false
      };
    }
    if (!isPlainObject(input)) return { ok: false, reason: "invalid-document" };

    if (Array.isArray(input.nodes)) {
      return {
        ok: true,
        document: {
          nodes: input.nodes,
          tombstones: Array.isArray(input.tombstones) ? input.tombstones : [],
          rootExtras: objectWithoutKeys(input.rootExtras, new Set(["pocketGuard"])),
          dataExtras: objectWithoutKeys(input.dataExtras, new Set(["pocketGuard"]))
        },
        ambiguousTreeCopies: false
      };
    }

    const nestedData = isPlainObject(input.data) ? input.data : {};
    const snapshotData = isPlainObject(input.snapshot) && isPlainObject(input.snapshot.data)
      ? input.snapshot.data
      : {};
    let nodes = null;
    let tombstones = [];
    let dataSource = null;

    if ((input.schema === "portal.mtt.web.v1" || input.schema === "portal.sync.v1") && Array.isArray(nestedData.mainThoughtTree)) {
      nodes = nestedData.mainThoughtTree;
      tombstones = Array.isArray(nestedData.mainThoughtTreeTombstones) ? nestedData.mainThoughtTreeTombstones : [];
      dataSource = nestedData;
    } else if (input.schema === "portal.pocketlite.changes.v1" && Array.isArray(snapshotData.mainThoughtTree)) {
      nodes = snapshotData.mainThoughtTree;
      tombstones = Array.isArray(snapshotData.mainThoughtTreeTombstones) ? snapshotData.mainThoughtTreeTombstones : [];
      dataSource = snapshotData;
    } else if (Array.isArray(input.mainThoughtTree)) {
      nodes = input.mainThoughtTree;
      tombstones = Array.isArray(input.mainThoughtTreeTombstones) ? input.mainThoughtTreeTombstones : [];
      dataSource = nestedData;
    }

    if (!Array.isArray(nodes)) return { ok: false, reason: "missing-tree" };

    let ambiguousTreeCopies = false;
    if (Array.isArray(input.mainThoughtTree) && Array.isArray(nestedData.mainThoughtTree)) {
      try {
        const topTombstones = Array.isArray(input.mainThoughtTreeTombstones)
          ? input.mainThoughtTreeTombstones
          : [];
        const nestedTombstones = Array.isArray(nestedData.mainThoughtTreeTombstones)
          ? nestedData.mainThoughtTreeTombstones
          : [];
        ambiguousTreeCopies = stableStringify(semanticNodeArray(input.mainThoughtTree))
            !== stableStringify(semanticNodeArray(nestedData.mainThoughtTree))
          || stableStringify(sortedTombstones(topTombstones))
            !== stableStringify(sortedTombstones(nestedTombstones));
      } catch (_error) {
        ambiguousTreeCopies = true;
      }
    }

    return {
      ok: true,
      document: {
        nodes,
        tombstones,
        rootExtras: objectWithoutKeys(input, ROOT_TRANSPORT_KEYS),
        dataExtras: objectWithoutKeys(dataSource, DATA_TRANSPORT_KEYS)
      },
      ambiguousTreeCopies
    };
  }

  function coerceDocument(input) {
    let extracted;
    try {
      extracted = extractRawDocument(input);
    } catch (_error) {
      return { ok: false, reason: "non-json-document" };
    }
    if (!extracted.ok) return extracted;

    const cloned = cloneJsonCompatible(extracted.document);
    if (!cloned.ok) return { ok: false, reason: cloned.reason || "non-json-document" };
    const document = cloned.value;
    document.rootExtras = objectWithoutKeys(document.rootExtras, new Set(["pocketGuard"]));
    document.dataExtras = objectWithoutKeys(document.dataExtras, new Set(["pocketGuard"]));
    document.nodes = document.nodes.map(function (node) {
      if (!isPlainObject(node)) return node;
      const copy = {};
      for (const key of Object.keys(node)) {
        if (key === "pe") continue;
        Object.defineProperty(copy, key, {
          value: node[key],
          enumerable: true,
          writable: true,
          configurable: true
        });
      }
      return copy;
    });
    return {
      ok: true,
      document,
      ambiguousTreeCopies: extracted.ambiguousTreeCopies === true
    };
  }

  function meaningfulDocument(input) {
    const coerced = coerceDocument(input);
    if (!coerced.ok) return coerced;
    try {
      return {
        ok: true,
        value: {
          nodes: semanticNodeArray(coerced.document.nodes),
          tombstones: sortedTombstones(coerced.document.tombstones),
          rootExtras: objectWithoutKeys(coerced.document.rootExtras, new Set(["pocketGuard"])),
          dataExtras: objectWithoutKeys(coerced.document.dataExtras, new Set(["pocketGuard"]))
        },
        document: coerced.document,
        ambiguousTreeCopies: coerced.ambiguousTreeCopies
      };
    } catch (_error) {
      return { ok: false, reason: "non-json-document" };
    }
  }

  function documentsEqual(left, right) {
    const leftMeaningful = meaningfulDocument(left);
    const rightMeaningful = meaningfulDocument(right);
    if (!leftMeaningful.ok || !rightMeaningful.ok) return false;
    try {
      return stableStringify(leftMeaningful.value) === stableStringify(rightMeaningful.value);
    } catch (_error) {
      return false;
    }
  }

  function fnv1a32(text) {
    let hash = 0x811c9dc5;
    for (let index = 0; index < text.length; index += 1) {
      hash ^= text.charCodeAt(index);
      hash = Math.imul(hash, 0x01000193) >>> 0;
    }
    return hash >>> 0;
  }

  function fingerprintDocument(input) {
    const meaningful = meaningfulDocument(input);
    if (!meaningful.ok) return "";
    try {
      const text = stableStringify(meaningful.value);
      return FINGERPRINT_SCHEMA + ":" + fnv1a32(text).toString(16).padStart(8, "0") + ":" + text.length;
    } catch (_error) {
      return "";
    }
  }

  function mapNodes(nodes) {
    const map = new Map();
    for (const node of Array.isArray(nodes) ? nodes : []) {
      if (isPlainObject(node) && typeof node.id === "string") map.set(node.id, node);
    }
    return map;
  }

  function itemPath(nodes, nodeId) {
    const map = mapNodes(nodes);
    const labels = [];
    const seen = new Set();
    let current = map.get(nodeId);
    while (current && !seen.has(current.id) && labels.length < 80) {
      seen.add(current.id);
      labels.unshift(String(current.label || current.id || "Untitled item"));
      current = current.parentId && current.parentId !== "root" ? map.get(current.parentId) : null;
    }
    return labels.join(" / ") || String(nodeId || "Item");
  }

  function nodeChangedFields(left, right) {
    const keys = new Set(Object.keys(left || {}).concat(Object.keys(right || {})));
    keys.delete("id");
    keys.delete("updatedAt");
    keys.delete("pe");
    const fields = [];
    for (const key of Array.from(keys).sort()) {
      const leftValue = Object.prototype.hasOwnProperty.call(left || {}, key) ? left[key] : MISSING;
      const rightValue = Object.prototype.hasOwnProperty.call(right || {}, key) ? right[key] : MISSING;
      if (!equalValue(leftValue, rightValue)) fields.push(key);
    }
    return fields;
  }

  function objectChangedKeys(left, right) {
    const keys = new Set(Object.keys(left || {}).concat(Object.keys(right || {})));
    return Array.from(keys).sort().filter(function (key) {
      return !equalValue(ownValue(left, key), ownValue(right, key));
    });
  }

  function compareDocuments(leftInput, rightInput) {
    const leftCoerced = coerceDocument(leftInput);
    const rightCoerced = coerceDocument(rightInput);
    if (!leftCoerced.ok || !rightCoerced.ok) {
      return { ok: false, reason: !leftCoerced.ok ? leftCoerced.reason : rightCoerced.reason, same: false, changes: [] };
    }

    const left = leftCoerced.document;
    const right = rightCoerced.document;
    const leftMap = mapNodes(left.nodes);
    const rightMap = mapNodes(right.nodes);
    const ids = Array.from(new Set(Array.from(leftMap.keys()).concat(Array.from(rightMap.keys())))).sort();
    const changes = [];

    for (const id of ids) {
      const leftNode = leftMap.get(id);
      const rightNode = rightMap.get(id);
      if (!leftNode) {
        changes.push({ kind: "added", nodeId: id, path: itemPath(right.nodes, id), title: String(rightNode.label || id), fields: [] });
        continue;
      }
      if (!rightNode) {
        changes.push({ kind: "removed", nodeId: id, path: itemPath(left.nodes, id), title: String(leftNode.label || id), fields: [] });
        continue;
      }
      const fields = nodeChangedFields(leftNode, rightNode);
      if (!fields.length) continue;
      const moved = fields.includes("parentId") || fields.includes("order");
      changes.push({
        kind: moved ? "moved-or-changed" : "changed",
        nodeId: id,
        path: itemPath(right.nodes, id),
        title: String(rightNode.label || leftNode.label || id),
        fields
      });
    }

    const metadataPairs = [
      ["root-metadata", "Document information", left.rootExtras, right.rootExtras],
      ["data-metadata", "Pocket data information", left.dataExtras, right.dataExtras]
    ];
    for (const pair of metadataPairs) {
      if (!equalValue(pair[2], pair[3])) {
        changes.push({ kind: pair[0], nodeId: "", path: "", title: pair[1], fields: objectChangedKeys(pair[2], pair[3]) });
      }
    }
    if (!equalValue(sortedTombstones(left.tombstones), sortedTombstones(right.tombstones))) {
      changes.push({
        kind: "deleted-items",
        nodeId: "",
        path: "",
        title: "Removed items",
        fields: Array.from(new Set(left.tombstones.concat(right.tombstones).map(tombstoneKey))).sort()
      });
    }

    return {
      ok: true,
      same: changes.length === 0,
      changes,
      left: cloneValue(left),
      right: cloneValue(right)
    };
  }

  function activeNormalisationRoundTrip(document) {
    if (typeof global.normaliseNodes !== "function"
        || typeof global.normaliseRootExtras !== "function") {
      return { ok: true, checked: false };
    }
    try {
      const normalised = {
        nodes: global.normaliseNodes(cloneValue(document.nodes)),
        tombstones: cloneValue(document.tombstones),
        rootExtras: global.normaliseRootExtras(cloneValue(document.rootExtras)) || {},
        dataExtras: global.normaliseRootExtras(cloneValue(document.dataExtras)) || {}
      };
      return {
        ok: documentsEqual(document, normalised),
        checked: true,
        document: normalised
      };
    } catch (_error) {
      return { ok: false, checked: true };
    }
  }

  function validateStructure(input, options) {
    const opts = options || {};
    const maxNodes = Number.isFinite(Number(opts.maxNodes)) ? Math.max(0, Number(opts.maxNodes)) : MAX_COMPARISON_NODES;
    const maxChars = Number.isFinite(Number(opts.maxChars)) ? Math.max(0, Number(opts.maxChars)) : MAX_COMPARISON_CHARS;
    const coerced = coerceDocument(input);
    if (!coerced.ok) return { ok: false, reason: coerced.reason, errors: [coerced.reason] };
    const document = coerced.document;
    const errors = [];

    if (coerced.ambiguousTreeCopies) errors.push("ambiguous-tree-copies");
    if (document.nodes.length > maxNodes) errors.push("too-many-nodes");
    try {
      if (stableStringify(document).length > maxChars) errors.push("document-too-large");
    } catch (_error) {
      errors.push("non-json-document");
    }

    const ids = new Set();
    for (const node of document.nodes) {
      if (!isPlainObject(node)) {
        errors.push("invalid-node");
        continue;
      }
      const id = typeof node.id === "string" ? node.id : "";
      if (!id || id === "root" || id.length > 80) errors.push("invalid-node-id");
      else if (ids.has(id)) errors.push("duplicate-node-id");
      else ids.add(id);
      if (typeof node.label !== "string" || !node.label.trim() || node.label.length > 220) errors.push("invalid-node-label");
      if (typeof node.parentId !== "string" || !node.parentId) errors.push("invalid-parent-id");
      if (!Number.isFinite(node.order)) errors.push("invalid-node-order");
    }

    const map = mapNodes(document.nodes);
    for (const node of document.nodes) {
      if (!isPlainObject(node) || typeof node.id !== "string") continue;
      if (node.parentId === node.id) errors.push("self-parent");
      if (node.parentId !== "root" && !map.has(node.parentId)) errors.push("orphan-node");
      const visited = new Set([node.id]);
      let current = node;
      while (current && current.parentId && current.parentId !== "root") {
        if (visited.has(current.parentId)) {
          errors.push("parent-cycle");
          break;
        }
        visited.add(current.parentId);
        current = map.get(current.parentId);
      }
    }

    const tombstoneIds = new Set();
    for (const tombstone of document.tombstones) {
      if (!isPlainObject(tombstone)) continue;
      const id = typeof tombstone.id === "string" ? tombstone.id : "";
      if (!id) continue;
      if (tombstoneIds.has(id)) errors.push("duplicate-tombstone-id");
      tombstoneIds.add(id);
      if (ids.has(id)) errors.push("live-tombstone-id");
    }

    let normalisation = { ok: true, checked: false };
    if (errors.length === 0) {
      normalisation = activeNormalisationRoundTrip(document);
      if (!normalisation.ok) errors.push("lossy-normalisation");
    }

    return {
      ok: errors.length === 0,
      reason: errors[0] || "",
      errors: Array.from(new Set(errors)),
      document,
      normalisationChecked: normalisation.checked === true
    };
  }

  function ancestryEvidence(baseDocument, candidateDocument) {
    if (documentsEqual(baseDocument, candidateDocument)) {
      return { credible: true, exact: true, shared: 0, ratio: 1 };
    }
    const baseIds = new Set(baseDocument.nodes.map(function (node) { return node.id; }));
    const candidateEvidence = new Set(candidateDocument.nodes.map(function (node) { return node.id; }));
    for (const tombstone of candidateDocument.tombstones) {
      if (tombstone && typeof tombstone.id === "string") candidateEvidence.add(tombstone.id);
    }
    let shared = 0;
    for (const id of baseIds) {
      if (candidateEvidence.has(id)) shared += 1;
    }
    const denominator = Math.max(1, baseIds.size);
    const ratio = shared / denominator;
    const requiredShared = Math.min(3, Math.max(1, baseIds.size));
    return {
      credible: shared >= requiredShared && ratio >= 0.5,
      exact: false,
      shared,
      ratio
    };
  }

  function assessCombinationEligibility(input) {
    const request = input || {};
    if (request.combinationSafe === false) {
      return {
        eligible: false,
        reason: "unsafe-comparison",
        message: UNSAFE_COMBINATION_MESSAGE
      };
    }
    if (!request.base || !request.storedBaseFingerprint) {
      return { eligible: false, reason: "missing-base", message: NO_BASE_MESSAGE };
    }

    const baseValidation = validateStructure(request.base, request.limits);
    const fileValidation = validateStructure(request.file, request.limits);
    const deviceValidation = validateStructure(request.device, request.limits);
    if (!baseValidation.ok || !fileValidation.ok || !deviceValidation.ok) {
      return {
        eligible: false,
        reason: "unsafe-input",
        message: UNSAFE_COMBINATION_MESSAGE,
        errors: {
          base: baseValidation.errors,
          file: fileValidation.errors,
          device: deviceValidation.errors
        }
      };
    }

    const actualFingerprint = fingerprintDocument(baseValidation.document);
    if (!actualFingerprint || actualFingerprint !== request.storedBaseFingerprint) {
      return { eligible: false, reason: "base-fingerprint-mismatch", message: NO_BASE_MESSAGE };
    }

    const fileEvidence = ancestryEvidence(baseValidation.document, fileValidation.document);
    const deviceEvidence = ancestryEvidence(baseValidation.document, deviceValidation.document);
    if (!fileEvidence.credible || !deviceEvidence.credible) {
      return {
        eligible: false,
        reason: "uncertain-ancestry",
        message: UNSAFE_COMBINATION_MESSAGE,
        evidence: { file: fileEvidence, device: deviceEvidence }
      };
    }

    return {
      eligible: true,
      reason: "",
      message: "",
      fingerprint: actualFingerprint,
      evidence: { file: fileEvidence, device: deviceEvidence },
      base: baseValidation.document,
      file: fileValidation.document,
      device: deviceValidation.document
    };
  }

  function validTimestamp(value) {
    if (typeof value !== "string" || !value.trim()) return "";
    const ms = Date.parse(value);
    return Number.isFinite(ms) ? new Date(ms).toISOString() : "";
  }

  function newestTimestamp(values) {
    let newest = "";
    let newestMs = -1;
    for (const value of values) {
      const normalised = validTimestamp(value);
      const ms = normalised ? Date.parse(normalised) : -1;
      if (ms > newestMs) {
        newest = normalised;
        newestMs = ms;
      }
    }
    return newest;
  }

  function ownValue(object, key) {
    return object && Object.prototype.hasOwnProperty.call(object, key) ? object[key] : MISSING;
  }

  function setOwnValue(object, key, value) {
    if (value === MISSING) {
      delete object[key];
      return;
    }
    Object.defineProperty(object, key, {
      value: cloneValue(value),
      enumerable: true,
      writable: true,
      configurable: true
    });
  }

  function mergeAtomicField(baseValue, fileValue, deviceValue) {
    if (equalValue(fileValue, deviceValue)) {
      return {
        resolved: true,
        value: cloneValue(fileValue),
        contributors: equalValue(fileValue, baseValue) ? [] : ["file", "device"]
      };
    }
    if (equalValue(fileValue, baseValue)) return { resolved: true, value: cloneValue(deviceValue), contributors: ["device"] };
    if (equalValue(deviceValue, baseValue)) return { resolved: true, value: cloneValue(fileValue), contributors: ["file"] };
    return { resolved: false };
  }

  function nextChoiceId(plan) {
    plan.choiceSequence += 1;
    return "difference_" + plan.choiceSequence;
  }

  function publicValue(value) {
    return value === MISSING ? { missing: true } : { missing: false, value: cloneValue(value) };
  }

  function addChoice(plan, choice) {
    choice.id = nextChoiceId(plan);
    choice.resolution = "";
    plan.choices.push(choice);
    return choice;
  }

  function mergeNodeFields(plan, baseNode, fileNode, deviceNode) {
    const output = { id: baseNode.id };
    const keys = new Set(Object.keys(baseNode).concat(Object.keys(fileNode), Object.keys(deviceNode)));
    keys.delete("id");
    keys.delete("updatedAt");
    keys.delete("pe");
    const conflictingFields = [];
    let fileContributed = false;
    let deviceContributed = false;

    for (const key of Array.from(keys).sort()) {
      const merged = mergeAtomicField(ownValue(baseNode, key), ownValue(fileNode, key), ownValue(deviceNode, key));
      if (merged.resolved) {
        setOwnValue(output, key, merged.value);
        fileContributed = fileContributed || merged.contributors.includes("file");
        deviceContributed = deviceContributed || merged.contributors.includes("device");
      } else {
        conflictingFields.push(key);
        setOwnValue(output, key, ownValue(fileNode, key));
      }
    }

    const timestamp = newestTimestamp([
      fileContributed ? fileNode.updatedAt : "",
      deviceContributed ? deviceNode.updatedAt : "",
      (!fileContributed && !deviceContributed) ? baseNode.updatedAt : ""
    ]) || newestTimestamp([fileNode.updatedAt, deviceNode.updatedAt, baseNode.updatedAt]);
    if (timestamp) output.updatedAt = timestamp;

    if (conflictingFields.length) {
      addChoice(plan, {
        kind: "node-fields",
        nodeId: baseNode.id,
        path: itemPath(plan.file.nodes, baseNode.id) || itemPath(plan.device.nodes, baseNode.id),
        title: String(fileNode.label || deviceNode.label || baseNode.id),
        fields: conflictingFields,
        options: ["file", "device", "keep-both"],
        automaticContributors: [
          ...(fileContributed ? ["file"] : []),
          ...(deviceContributed ? ["device"] : [])
        ],
        base: cloneValue(baseNode),
        file: cloneValue(fileNode),
        device: cloneValue(deviceNode),
        values: conflictingFields.map(function (field) {
          return {
            field,
            base: publicValue(ownValue(baseNode, field)),
            file: publicValue(ownValue(fileNode, field)),
            device: publicValue(ownValue(deviceNode, field))
          };
        })
      });
    }
    return output;
  }

  function mergeNodes(plan) {
    const baseMap = mapNodes(plan.base.nodes);
    const fileMap = mapNodes(plan.file.nodes);
    const deviceMap = mapNodes(plan.device.nodes);
    const ids = Array.from(new Set(
      Array.from(baseMap.keys()).concat(Array.from(fileMap.keys()), Array.from(deviceMap.keys()))
    )).sort();
    const output = [];

    for (const id of ids) {
      const baseNode = baseMap.get(id);
      const fileNode = fileMap.get(id);
      const deviceNode = deviceMap.get(id);

      if (!baseNode) {
        if (fileNode && !deviceNode) {
          output.push(cloneValue(fileNode));
          continue;
        }
        if (!fileNode && deviceNode) {
          output.push(cloneValue(deviceNode));
          continue;
        }
        if (equalValue(semanticNode(fileNode), semanticNode(deviceNode))) {
          const node = cloneValue(fileNode);
          const timestamp = newestTimestamp([fileNode.updatedAt, deviceNode.updatedAt]);
          if (timestamp) node.updatedAt = timestamp;
          output.push(node);
          continue;
        }
        output.push(cloneValue(fileNode));
        addChoice(plan, {
          kind: "concurrent-add",
          nodeId: id,
          path: itemPath(plan.file.nodes, id) || itemPath(plan.device.nodes, id),
          title: String(fileNode.label || deviceNode.label || id),
          fields: nodeChangedFields(fileNode, deviceNode),
          options: ["file", "device", "keep-both"],
          base: null,
          file: cloneValue(fileNode),
          device: cloneValue(deviceNode)
        });
        continue;
      }

      if (!fileNode && !deviceNode) continue;
      if (!fileNode && deviceNode) {
        if (equalValue(semanticNode(baseNode), semanticNode(deviceNode))) continue;
        output.push(cloneValue(deviceNode));
        addChoice(plan, {
          kind: "delete-versus-edit",
          deletedSide: "file",
          nodeId: id,
          path: itemPath(plan.device.nodes, id),
          title: String(deviceNode.label || baseNode.label || id),
          fields: nodeChangedFields(baseNode, deviceNode),
          options: ["keep-item", "leave-removed"],
          base: cloneValue(baseNode),
          file: null,
          device: cloneValue(deviceNode)
        });
        continue;
      }
      if (fileNode && !deviceNode) {
        if (equalValue(semanticNode(baseNode), semanticNode(fileNode))) continue;
        output.push(cloneValue(fileNode));
        addChoice(plan, {
          kind: "delete-versus-edit",
          deletedSide: "device",
          nodeId: id,
          path: itemPath(plan.file.nodes, id),
          title: String(fileNode.label || baseNode.label || id),
          fields: nodeChangedFields(baseNode, fileNode),
          options: ["keep-item", "leave-removed"],
          base: cloneValue(baseNode),
          file: cloneValue(fileNode),
          device: null
        });
        continue;
      }

      output.push(mergeNodeFields(plan, baseNode, fileNode, deviceNode));
    }
    return output;
  }

  function mergeKeyedObject(plan, scope, baseObject, fileObject, deviceObject) {
    const output = {};
    const keys = new Set(Object.keys(baseObject || {}).concat(Object.keys(fileObject || {}), Object.keys(deviceObject || {})));
    for (const key of Array.from(keys).sort()) {
      const baseValue = ownValue(baseObject, key);
      const fileValue = ownValue(fileObject, key);
      const deviceValue = ownValue(deviceObject, key);
      const merged = mergeAtomicField(baseValue, fileValue, deviceValue);
      if (merged.resolved) {
        setOwnValue(output, key, merged.value);
        continue;
      }
      setOwnValue(output, key, fileValue);
      addChoice(plan, {
        kind: "metadata",
        scope,
        key,
        nodeId: "",
        path: "",
        title: key,
        fields: [key],
        options: ["file", "device"],
        base: publicValue(baseValue),
        file: publicValue(fileValue),
        device: publicValue(deviceValue)
      });
    }
    return output;
  }

  function tombstoneKey(tombstone) {
    if (isPlainObject(tombstone) && typeof tombstone.id === "string" && tombstone.id) return "id:" + tombstone.id;
    return "value:" + stableStringify(tombstone);
  }

  function tombstoneMap(tombstones) {
    const map = new Map();
    for (const tombstone of tombstones || []) map.set(tombstoneKey(tombstone), tombstone);
    return map;
  }

  function mergeTombstones(plan) {
    const baseMap = tombstoneMap(plan.base.tombstones);
    const fileMap = tombstoneMap(plan.file.tombstones);
    const deviceMap = tombstoneMap(plan.device.tombstones);
    const keys = Array.from(new Set(
      Array.from(baseMap.keys()).concat(Array.from(fileMap.keys()), Array.from(deviceMap.keys()))
    )).sort();
    const output = [];

    for (const key of keys) {
      const baseValue = baseMap.has(key) ? baseMap.get(key) : MISSING;
      const fileValue = fileMap.has(key) ? fileMap.get(key) : MISSING;
      const deviceValue = deviceMap.has(key) ? deviceMap.get(key) : MISSING;
      const merged = mergeAtomicField(baseValue, fileValue, deviceValue);
      if (merged.resolved) {
        if (merged.value !== MISSING) output.push(merged.value);
        continue;
      }
      if (fileValue !== MISSING) output.push(cloneValue(fileValue));
      addChoice(plan, {
        kind: "tombstone",
        scope: "tombstones",
        key,
        nodeId: "",
        path: "",
        title: key.startsWith("id:") ? key.slice(3) : "Deleted item record",
        fields: ["tombstone"],
        options: ["file", "device"],
        base: publicValue(baseValue),
        file: publicValue(fileValue),
        device: publicValue(deviceValue)
      });
    }
    return output;
  }

  function planCombination(input) {
    const eligibility = assessCombinationEligibility(input);
    if (!eligibility.eligible) {
      return {
        ok: false,
        reason: eligibility.reason,
        message: eligibility.message,
        eligibility
      };
    }

    const plan = {
      schema: PLAN_SCHEMA,
      baseFingerprint: eligibility.fingerprint,
      base: cloneValue(eligibility.base),
      file: cloneValue(eligibility.file),
      device: cloneValue(eligibility.device),
      result: {
        nodes: [],
        tombstones: [],
        rootExtras: {},
        dataExtras: {}
      },
      choices: [],
      choiceSequence: 0,
      keepBothResolutions: [],
      initialResultOrders: {},
      automaticChangeCount: 0
    };
    plan.result.nodes = mergeNodes(plan);
    plan.initialResultOrders = Object.fromEntries(plan.result.nodes.map(function (node) {
      return [node.id, node.order];
    }));
    plan.result.rootExtras = mergeKeyedObject(plan, "rootExtras", plan.base.rootExtras, plan.file.rootExtras, plan.device.rootExtras);
    plan.result.dataExtras = mergeKeyedObject(plan, "dataExtras", plan.base.dataExtras, plan.file.dataExtras, plan.device.dataExtras);
    plan.result.tombstones = mergeTombstones(plan);
    orderDependentDeleteChoices(plan);
    plan.automaticChangeCount = compareDocuments(plan.base, plan.result).changes.length;
    return {
      ok: true,
      plan,
      unresolvedCount: plan.choices.length,
      message: plan.choices.length
        ? "Pocket combined what it could."
        : "Pocket combined the changes. Nothing else needs your choice."
    };
  }

  function findResultNode(plan, nodeId) {
    return plan.result.nodes.find(function (node) { return node && node.id === nodeId; }) || null;
  }

  function replaceResultNode(plan, nodeId, replacement) {
    const index = plan.result.nodes.findIndex(function (node) { return node && node.id === nodeId; });
    if (replacement === null) {
      if (index >= 0) plan.result.nodes.splice(index, 1);
      return;
    }
    if (index >= 0) plan.result.nodes[index] = cloneValue(replacement);
    else plan.result.nodes.push(cloneValue(replacement));
  }

  function descendantsOf(nodes, rootId) {
    const children = new Map();
    for (const node of nodes) {
      if (!node || typeof node.id !== "string") continue;
      const parentId = typeof node.parentId === "string" ? node.parentId : "root";
      if (!children.has(parentId)) children.set(parentId, []);
      children.get(parentId).push(node.id);
    }
    const output = [];
    const queue = [rootId];
    const seen = new Set();
    while (queue.length) {
      const id = queue.shift();
      if (!id || seen.has(id)) continue;
      seen.add(id);
      output.push(id);
      for (const childId of children.get(id) || []) queue.push(childId);
    }
    return output;
  }

  function cleanFreshId(value) {
    return String(value || "").trim().slice(0, 80);
  }

  function nextFreshId(plan, sourceId, options, usedIds) {
    const opts = options || {};
    const factory = typeof opts.makeId === "function"
      ? opts.makeId
      : (typeof global.makeId === "function" ? global.makeId : null);
    for (let attempt = 0; attempt < 1000; attempt += 1) {
      const proposed = factory
        ? factory("node", sourceId, attempt)
        : "node_device_" + fnv1a32(sourceId + ":" + plan.baseFingerprint + ":" + attempt).toString(36);
      const id = cleanFreshId(proposed);
      if (id && id !== "root" && !usedIds.has(id)) {
        usedIds.add(id);
        return id;
      }
    }
    return "";
  }

  function labelWithDeviceSuffix(label) {
    const suffix = " (device version)";
    const source = String(label || "Untitled item").trim() || "Untitled item";
    if (source.endsWith(suffix)) return source.slice(0, 220);
    return source.slice(0, Math.max(0, 220 - suffix.length)).trimEnd() + suffix;
  }

  function restoreFileBranchTombstones(plan, affectedIds, fileMap, rootId) {
    const fileTombstones = tombstoneMap(plan.file.tombstones);
    plan.result.tombstones = plan.result.tombstones.filter(function (tombstone) {
      const key = tombstoneKey(tombstone);
      return !key.startsWith("id:") || !affectedIds.has(key.slice(3));
    });
    for (const id of affectedIds) {
      const key = "id:" + id;
      if (!fileMap.has(id) && fileTombstones.has(key)) {
        plan.result.tombstones.push(cloneValue(fileTombstones.get(key)));
      }
      for (const choice of plan.choices) {
        if (choice.kind === "tombstone" && choice.key === key) {
          choice.resolution = "covered-by-keep-both:" + rootId;
        }
      }
    }
  }

  function resolvedStructuralChoiceValue(plan, nodeId, field) {
    const choice = plan.choices.find(function (candidate) {
      return candidate.nodeId === nodeId
        && !!candidate.resolution
        && structuralChoiceFields(candidate).includes(field)
        && !String(candidate.resolution).startsWith("covered-by-");
    });
    if (!choice) return { found: false, value: MISSING };
    let source = null;
    if (choice.resolution === "device") source = choice.device;
    else if (choice.resolution === "file" || choice.resolution === "keep-both") source = choice.file;
    else if (choice.resolution === "keep-item") source = choice.file || choice.device;
    if (!source) return { found: false, value: MISSING };
    return { found: true, value: cloneValue(ownValue(source, field)) };
  }

  function reflowKeepBothSiblingOrders(plan, parentId, trackingRecord) {
    const active = plan.keepBothResolutions.filter(function (record) {
      return record.parentId === parentId;
    });
    if (!active.length) return;
    const duplicateRootIds = new Set(active.map(function (record) {
      return record.duplicatedRootId;
    }));
    const recordsByRoot = new Map();
    for (const record of active) {
      if (!recordsByRoot.has(record.rootId)) recordsByRoot.set(record.rootId, []);
      recordsByRoot.get(record.rootId).push(record);
    }
    const fileSourceOrder = new Map(plan.file.nodes.map(function (node, index) {
      return [node.id, index];
    }));
    const deviceSourceOrder = new Map(plan.device.nodes.map(function (node, index) {
      return [node.id, index];
    }));
    const fileNodeMap = mapNodes(plan.file.nodes);
    const deviceNodeMap = mapNodes(plan.device.nodes);
    const desiredOrder = function (node) {
      const resolved = resolvedStructuralChoiceValue(plan, node.id, "order");
      if (resolved.found && Number.isFinite(Number(resolved.value))) {
        return Number(resolved.value);
      }
      const fileNode = fileNodeMap.get(node.id);
      if (recordsByRoot.has(node.id)
          && fileNode
          && Number.isFinite(Number(fileNode.order))) {
        return Number(fileNode.order);
      }
      const initial = plan.initialResultOrders
        && Object.prototype.hasOwnProperty.call(plan.initialResultOrders, node.id)
        ? Number(plan.initialResultOrders[node.id])
        : NaN;
      if (Number.isFinite(initial)) return initial;
      if (fileNode && Number.isFinite(Number(fileNode.order))) return Number(fileNode.order);
      const deviceNode = deviceNodeMap.get(node.id);
      if (deviceNode && Number.isFinite(Number(deviceNode.order))) return Number(deviceNode.order);
      return Number(node.order);
    };
    const sourcePosition = function (nodeId) {
      if (fileSourceOrder.has(nodeId)) {
        return { source: 0, index: fileSourceOrder.get(nodeId) };
      }
      if (deviceSourceOrder.has(nodeId)) {
        return { source: 1, index: deviceSourceOrder.get(nodeId) };
      }
      return { source: 2, index: Number.MAX_SAFE_INTEGER };
    };
    const originals = plan.result.nodes.filter(function (node) {
      return node.parentId === parentId && !duplicateRootIds.has(node.id);
    }).sort(function (left, right) {
      const leftOrder = desiredOrder(left);
      const rightOrder = desiredOrder(right);
      if (leftOrder !== rightOrder) return leftOrder - rightOrder;
      const leftPosition = sourcePosition(left.id);
      const rightPosition = sourcePosition(right.id);
      if (leftPosition.source !== rightPosition.source) {
        return leftPosition.source - rightPosition.source;
      }
      if (leftPosition.index !== rightPosition.index) {
        return leftPosition.index - rightPosition.index;
      }
      return String(left.id || "").localeCompare(String(right.id || ""));
    });

    const rememberAdjustment = function (node) {
      if (!trackingRecord
          || duplicateRootIds.has(node.id)
          || trackingRecord.orderAdjustments.some(function (item) { return item.id === node.id; })) {
        return;
      }
      trackingRecord.orderAdjustments.push({ id: node.id, previousOrder: node.order });
    };
    let nextMinimum = null;
    for (const original of originals) {
      const desired = desiredOrder(original);
      const originalOrder = nextMinimum === null
        ? desired
        : Math.max(desired, nextMinimum);
      if (original.order !== originalOrder) {
        rememberAdjustment(original);
        original.order = originalOrder;
      }
      let cursor = originalOrder;
      for (const record of recordsByRoot.get(original.id) || []) {
        const duplicate = findResultNode(plan, record.duplicatedRootId);
        if (!duplicate) continue;
        cursor += 1;
        duplicate.order = cursor;
      }
      nextMinimum = cursor + 1;
    }
  }

  function duplicateDeviceSubtree(plan, rootId, options) {
    const deviceMap = mapNodes(plan.device.nodes);
    const fileMap = mapNodes(plan.file.nodes);
    const deviceRoot = deviceMap.get(rootId);
    const fileRoot = fileMap.get(rootId);
    if (!deviceRoot || !fileRoot) return { ok: false, reason: "keep-both-unavailable" };

    const fileSubtreeIds = new Set(descendantsOf(plan.file.nodes, rootId));
    const deviceSubtreeIds = new Set(descendantsOf(plan.device.nodes, rootId));
    const movedOutCandidates = new Set(Array.from(fileSubtreeIds).filter(function (id) {
      return id !== rootId && deviceMap.has(id) && !deviceSubtreeIds.has(id);
    }));
    const movedOutRoots = new Set(Array.from(movedOutCandidates).filter(function (id) {
      const parentId = String(deviceMap.get(id)?.parentId || "root");
      return !movedOutCandidates.has(parentId);
    }));
    const movedOutBranchIds = new Set();
    for (const movedRootId of movedOutRoots) {
      for (const id of descendantsOf(plan.device.nodes, movedRootId)) {
        movedOutBranchIds.add(id);
      }
    }
    const deviceCopyIds = new Set(
      Array.from(deviceSubtreeIds).concat(Array.from(movedOutBranchIds))
    );
    const preliminaryAffectedIds = new Set(
      Array.from(fileSubtreeIds)
        .concat(Array.from(deviceSubtreeIds), Array.from(movedOutBranchIds))
    );
    let retainedOverlapChanged = true;
    while (retainedOverlapChanged) {
      retainedOverlapChanged = false;
      for (const sourceId of Array.from(deviceCopyIds)) {
        const sourceNode = deviceMap.get(sourceId);
        const sourceParentId = String(sourceNode && sourceNode.parentId || "root");
        if (!sourceNode || sourceParentId === "root" || deviceCopyIds.has(sourceParentId)) continue;
        const existingOwner = plan.keepBothResolutions.find(function (record) {
          return !preliminaryAffectedIds.has(record.rootId)
            && record.sourceToDuplicate
            && !!record.sourceToDuplicate[sourceId]
            && !!record.sourceToDuplicate[sourceParentId]
            && !!findResultNode(plan, record.sourceToDuplicate[sourceId])
            && !!findResultNode(plan, record.sourceToDuplicate[sourceParentId]);
        });
        if (!existingOwner) continue;
        deviceCopyIds.delete(sourceId);
        retainedOverlapChanged = true;
      }
    }
    const affectedIds = new Set(
      Array.from(fileSubtreeIds)
        .concat(Array.from(deviceSubtreeIds), Array.from(movedOutBranchIds))
    );
    const supersededKeepBoth = plan.keepBothResolutions.filter(function (record) {
      return affectedIds.has(record.rootId);
    });
    const supersededRoots = new Set(supersededKeepBoth.map(function (record) {
      return record.rootId;
    }));
    const transferredDuplicateIds = new Set();
    for (const record of plan.keepBothResolutions) {
      if (supersededRoots.has(record.rootId)) continue;
      const retainedSourceIds = [];
      const retainedDuplicateIds = [];
      for (const sourceId of record.sourceIds || []) {
        const duplicateId = record.sourceToDuplicate && record.sourceToDuplicate[sourceId];
        if (deviceCopyIds.has(sourceId) && duplicateId) {
          transferredDuplicateIds.add(duplicateId);
          delete record.sourceToDuplicate[sourceId];
          continue;
        }
        retainedSourceIds.push(sourceId);
        if (duplicateId) retainedDuplicateIds.push(duplicateId);
      }
      record.sourceIds = retainedSourceIds;
      record.duplicatedIds = retainedDuplicateIds;
    }
    const supersededDuplicateIds = new Set();
    for (const record of supersededKeepBoth) {
      for (const id of record.duplicatedIds) supersededDuplicateIds.add(id);
    }
    for (const record of supersededKeepBoth.slice().reverse()) {
      for (const adjustment of (record.orderAdjustments || []).slice().reverse()) {
        const sibling = findResultNode(plan, adjustment.id);
        if (sibling && !affectedIds.has(sibling.id)) {
          const resolved = resolvedStructuralChoiceValue(plan, sibling.id, "order");
          setOwnValue(
            sibling,
            "order",
            resolved.found ? resolved.value : adjustment.previousOrder
          );
        }
      }
    }
    const supersededParents = new Set(supersededKeepBoth.map(function (record) {
      return record.parentId;
    }));
    plan.keepBothResolutions = plan.keepBothResolutions.filter(function (record) {
      return !affectedIds.has(record.rootId);
    });
    plan.result.nodes = plan.result.nodes.filter(function (node) { return !affectedIds.has(node.id); });
    plan.result.nodes = plan.result.nodes.filter(function (node) { return !supersededDuplicateIds.has(node.id); });
    plan.result.nodes = plan.result.nodes.filter(function (node) { return !transferredDuplicateIds.has(node.id); });
    for (const id of Array.from(affectedIds)) {
      if (fileMap.has(id)) {
        plan.result.nodes.push(cloneValue(fileMap.get(id)));
      }
    }
    restoreFileBranchTombstones(plan, affectedIds, fileMap, rootId);
    for (const parentId of supersededParents) {
      reflowKeepBothSiblingOrders(plan, parentId, null);
    }

    const usedIds = new Set(plan.result.nodes.map(function (node) { return node.id; }));
    const idMap = new Map();
    for (const id of deviceCopyIds) {
      const freshId = nextFreshId(plan, id, options, usedIds);
      if (!freshId) return { ok: false, reason: "fresh-id-unavailable" };
      idMap.set(id, freshId);
    }

    const duplicated = [];
    for (const sourceNode of plan.device.nodes) {
      if (!deviceCopyIds.has(sourceNode.id)) continue;
      const copy = cloneValue(sourceNode);
      copy.id = idMap.get(sourceNode.id);
      if (sourceNode.id === rootId) {
        copy.parentId = fileRoot.parentId;
        if (String(copy.label || "") === String(fileRoot.label || "")) copy.label = labelWithDeviceSuffix(copy.label);
      } else if (idMap.has(sourceNode.parentId)) {
        copy.parentId = idMap.get(sourceNode.parentId);
      }
      duplicated.push(copy);
    }

    const fileOrder = Number(fileRoot.order);
    const duplicateRoot = duplicated.find(function (node) { return node.id === idMap.get(rootId); });
    const insertionOrder = (Number.isFinite(fileOrder) ? Math.round(fileOrder) : 0) + 1;
    duplicateRoot.order = insertionOrder;
    plan.result.nodes.push.apply(plan.result.nodes, duplicated);
    const keepBothRecord = {
      rootId,
      parentId: fileRoot.parentId,
      duplicatedRootId: duplicateRoot.id,
      sourceIds: Array.from(deviceCopyIds),
      duplicatedIds: duplicated.map(function (node) { return node.id; }),
      sourceToDuplicate: Object.fromEntries(idMap),
      orderAdjustments: []
    };
    plan.keepBothResolutions.push(keepBothRecord);
    reflowKeepBothSiblingOrders(plan, fileRoot.parentId, keepBothRecord);

    for (const choice of plan.choices) {
      if (!choice.nodeId || !affectedIds.has(choice.nodeId)) continue;
      choice.resolution = choice.nodeId === rootId ? "keep-both" : "covered-by-keep-both:" + rootId;
    }
    return { ok: true, duplicatedRootId: duplicateRoot.id, idMap: Object.fromEntries(idMap) };
  }

  function unpackPublicValue(value) {
    return value && value.missing === true ? MISSING : cloneValue(value ? value.value : MISSING);
  }

  function removeLiveNodeTombstone(plan, nodeId) {
    const key = "id:" + nodeId;
    plan.result.tombstones = plan.result.tombstones.filter(function (item) {
      return tombstoneKey(item) !== key;
    });
    for (const choice of plan.choices) {
      if (choice.kind !== "tombstone" || choice.key !== key || choice.resolution) continue;
      choice.resolution = "covered-by-kept-item:" + nodeId;
    }
  }

  function requiredAncestorRestoration(plan, node, sourceDocument) {
    if (!node || !sourceDocument) return { ok: false, reason: "missing-live-item" };
    const sourceMap = mapNodes(sourceDocument.nodes);
    const resultMap = mapNodes(plan.result.nodes);
    const ancestors = [];
    const seen = new Set([String(node.id || "")]);
    let parentId = String(node.parentId || "root");

    while (parentId && parentId !== "root") {
      if (seen.has(parentId)) return { ok: false, reason: "parent-cycle" };
      seen.add(parentId);
      const existing = resultMap.get(parentId);
      const source = sourceMap.get(parentId);
      const ancestor = existing || source;
      if (!ancestor) return { ok: false, reason: "missing-required-ancestor" };
      if (!existing) {
        const restored = cloneValue(source);
        ancestors.push(restored);
        resultMap.set(parentId, restored);
      }
      parentId = String(ancestor.parentId || "root");
    }

    return { ok: true, ancestors: ancestors.reverse() };
  }

  function deleteChoiceSourceDocument(plan, choice) {
    return choice && choice.file ? plan.file : plan.device;
  }

  function ancestorIdsInDocument(document, nodeId) {
    const nodes = document && Array.isArray(document.nodes) ? document.nodes : [];
    const nodeMap = mapNodes(nodes);
    const output = [];
    const seen = new Set([String(nodeId || "")]);
    let node = nodeMap.get(nodeId);
    let parentId = String(node && node.parentId || "root");

    while (parentId && parentId !== "root") {
      if (seen.has(parentId)) break;
      seen.add(parentId);
      output.push(parentId);
      node = nodeMap.get(parentId);
      if (!node) break;
      parentId = String(node.parentId || "root");
    }
    return output;
  }

  function orderDependentDeleteChoices(plan) {
    const originalOrder = new Map(plan.choices.map(function (choice, index) {
      return [choice.id, index];
    }));
    plan.choices.sort(function (left, right) {
      const leftDelete = left.kind === "delete-versus-edit";
      const rightDelete = right.kind === "delete-versus-edit";
      if (leftDelete !== rightDelete) return leftDelete ? -1 : 1;
      if (leftDelete && rightDelete) {
        const leftDepth = ancestorIdsInDocument(
          deleteChoiceSourceDocument(plan, left),
          left.nodeId
        ).length;
        const rightDepth = ancestorIdsInDocument(
          deleteChoiceSourceDocument(plan, right),
          right.nodeId
        ).length;
        if (leftDepth !== rightDepth) return leftDepth - rightDepth;
      }
      return originalOrder.get(left.id) - originalOrder.get(right.id);
    });
  }

  function dependentDeleteAncestorChoices(plan, choice) {
    const ancestorIds = new Set(ancestorIdsInDocument(
      deleteChoiceSourceDocument(plan, choice),
      choice.nodeId
    ));
    return plan.choices.filter(function (candidate) {
      return candidate.kind === "delete-versus-edit"
        && ancestorIds.has(candidate.nodeId);
    });
  }

  function dependentDescendantChoices(plan, choice) {
    const sourceDocument = deleteChoiceSourceDocument(plan, choice);
    const deletingDocument = choice.deletedSide === "file" ? plan.file : plan.device;
    const retainedOnDeletingSide = mapNodes(deletingDocument.nodes);
    const liveDescendantIds = descendantsOf(sourceDocument.nodes, choice.nodeId).filter(function (nodeId) {
      return nodeId !== choice.nodeId;
    });
    const subtreeIds = new Set(liveDescendantIds.filter(function (nodeId) {
      return !retainedOnDeletingSide.has(nodeId);
    }));
    const retainedIds = new Set(liveDescendantIds.filter(function (nodeId) {
      return retainedOnDeletingSide.has(nodeId);
    }));
    return {
      ids: subtreeIds,
      retainedIds,
      retainedOnDeletingSide,
      choices: plan.choices.filter(function (candidate) {
        return candidate.nodeId && subtreeIds.has(candidate.nodeId);
      })
    };
  }

  function structuralChoiceFields(choice) {
    return Array.isArray(choice && choice.fields)
      ? choice.fields.filter(function (field) { return field === "parentId" || field === "order"; })
      : [];
  }

  function restoreDeletingSideDescendantPlacements(plan, ancestorChoice, dependants) {
    const resultDescendants = new Set(descendantsOf(plan.result.nodes, ancestorChoice.nodeId));
    for (const candidate of plan.choices) {
      if (!candidate.nodeId
          || !dependants.retainedIds.has(candidate.nodeId)
          || structuralChoiceFields(candidate).length === 0
          || !candidate.resolution) {
        continue;
      }
      if (resultDescendants.has(candidate.nodeId)) {
        return {
          ok: false,
          reason: "descendant-choice-conflict",
          relatedChoiceId: candidate.id
        };
      }
    }

    for (const nodeId of dependants.retainedIds) {
      const target = findResultNode(plan, nodeId);
      const deletingSideNode = dependants.retainedOnDeletingSide.get(nodeId);
      if (!target || !deletingSideNode) continue;
      setOwnValue(target, "parentId", ownValue(deletingSideNode, "parentId"));
      setOwnValue(target, "order", ownValue(deletingSideNode, "order"));

      for (const candidate of plan.choices) {
        if (candidate.nodeId !== nodeId || candidate.resolution) continue;
        const structuralFields = new Set(structuralChoiceFields(candidate));
        if (structuralFields.size === 0) continue;
        candidate.fields = candidate.fields.filter(function (field) {
          return !structuralFields.has(field);
        });
        if (Array.isArray(candidate.values)) {
          candidate.values = candidate.values.filter(function (entry) {
            return !structuralFields.has(entry && entry.field);
          });
        }
        candidate.protectedStructure = {
          ancestorId: ancestorChoice.nodeId,
          parentId: cloneValue(ownValue(deletingSideNode, "parentId")),
          order: cloneValue(ownValue(deletingSideNode, "order"))
        };
        if (candidate.fields.length === 0) {
          candidate.resolution = "covered-by-removed-ancestor:" + ancestorChoice.nodeId;
        }
      }
    }
    return { ok: true };
  }

  function resolveChoice(plan, choiceId, resolution, options) {
    if (!plan || plan.schema !== PLAN_SCHEMA) return { ok: false, reason: "invalid-plan" };
    const choice = plan.choices.find(function (item) { return item.id === choiceId; });
    if (!choice) return { ok: false, reason: "missing-choice" };
    if (choice.resolution) return { ok: false, reason: "choice-already-resolved" };
    if (!choice.options.includes(resolution)) return { ok: false, reason: "invalid-resolution" };

    if (choice.kind === "node-fields") {
      if (resolution === "keep-both") {
        const duplicated = duplicateDeviceSubtree(plan, choice.nodeId, options);
        if (!duplicated.ok) return duplicated;
        return { ok: true, plan, duplicatedRootId: duplicated.duplicatedRootId, unresolvedCount: unresolvedChoices(plan).length };
      }
      const target = findResultNode(plan, choice.nodeId);
      if (!target) return { ok: false, reason: "missing-result-node" };
      const source = resolution === "file" ? choice.file : choice.device;
      for (const field of choice.fields) setOwnValue(target, field, ownValue(source, field));
      const contributors = new Set(Array.isArray(choice.automaticContributors)
        ? choice.automaticContributors
        : []);
      contributors.add(resolution);
      const timestamp = newestTimestamp([
        contributors.has("file") ? choice.file?.updatedAt : "",
        contributors.has("device") ? choice.device?.updatedAt : "",
        contributors.size === 0 ? choice.base?.updatedAt : ""
      ]);
      if (timestamp) target.updatedAt = timestamp;
      choice.resolution = resolution;
    } else if (choice.kind === "concurrent-add") {
      if (resolution === "keep-both") {
        const duplicated = duplicateDeviceSubtree(plan, choice.nodeId, options);
        if (!duplicated.ok) return duplicated;
        return { ok: true, plan, duplicatedRootId: duplicated.duplicatedRootId, unresolvedCount: unresolvedChoices(plan).length };
      }
      if (choice.protectedStructure) {
        const target = findResultNode(plan, choice.nodeId);
        if (!target) return { ok: false, reason: "missing-result-node" };
        const source = resolution === "file" ? choice.file : choice.device;
        for (const field of choice.fields) setOwnValue(target, field, ownValue(source, field));
        setOwnValue(target, "parentId", choice.protectedStructure.parentId);
        setOwnValue(target, "order", choice.protectedStructure.order);
        if (Object.prototype.hasOwnProperty.call(source || {}, "updatedAt")) {
          setOwnValue(target, "updatedAt", ownValue(source, "updatedAt"));
        }
      } else {
        replaceResultNode(plan, choice.nodeId, resolution === "file" ? choice.file : choice.device);
      }
      choice.resolution = resolution;
    } else if (choice.kind === "delete-versus-edit") {
      if (resolution === "leave-removed") {
        const dependants = dependentDescendantChoices(plan, choice);
        const explicitlyKept = dependants.choices.find(function (candidate) {
          return candidate.resolution
            && candidate.resolution !== "leave-removed"
            && !String(candidate.resolution).startsWith("covered-by-removed-ancestor:");
        });
        if (explicitlyKept) {
          return {
            ok: false,
            reason: "descendant-choice-conflict",
            relatedChoiceId: explicitlyKept.id
          };
        }
        const restoredPlacements = restoreDeletingSideDescendantPlacements(
          plan,
          choice,
          dependants
        );
        if (!restoredPlacements.ok) return restoredPlacements;
        plan.result.nodes = plan.result.nodes.filter(function (node) {
          return !dependants.ids.has(node.id);
        });
        for (const dependant of dependants.choices) {
          if (!dependant.resolution) {
            dependant.resolution = "covered-by-removed-ancestor:" + choice.nodeId;
          }
        }
        replaceResultNode(plan, choice.nodeId, null);
      } else {
        const ancestorChoices = dependentDeleteAncestorChoices(plan, choice);
        const unresolvedAncestor = ancestorChoices.find(function (candidate) {
          return !candidate.resolution;
        });
        if (unresolvedAncestor) {
          return {
            ok: false,
            reason: "ancestor-choice-required",
            relatedChoiceId: unresolvedAncestor.id
          };
        }
        const removedAncestor = ancestorChoices.find(function (candidate) {
          return candidate.resolution === "leave-removed"
            || String(candidate.resolution).startsWith("covered-by-removed-ancestor:");
        });
        if (removedAncestor) {
          return {
            ok: false,
            reason: "ancestor-left-removed",
            relatedChoiceId: removedAncestor.id
          };
        }
        const liveNode = choice.file || choice.device;
        const sourceDocument = choice.file ? plan.file : plan.device;
        const restoration = requiredAncestorRestoration(plan, liveNode, sourceDocument);
        if (!restoration.ok) return restoration;
        replaceResultNode(plan, choice.nodeId, liveNode);
        for (const ancestor of restoration.ancestors) {
          if (!findResultNode(plan, ancestor.id)) plan.result.nodes.push(ancestor);
          removeLiveNodeTombstone(plan, ancestor.id);
        }
        removeLiveNodeTombstone(plan, choice.nodeId);
      }
      choice.resolution = resolution;
    } else if (choice.kind === "metadata") {
      const target = choice.scope === "rootExtras" ? plan.result.rootExtras : plan.result.dataExtras;
      setOwnValue(target, choice.key, unpackPublicValue(resolution === "file" ? choice.file : choice.device));
      choice.resolution = resolution;
    } else if (choice.kind === "tombstone") {
      const selected = unpackPublicValue(resolution === "file" ? choice.file : choice.device);
      plan.result.tombstones = plan.result.tombstones.filter(function (item) { return tombstoneKey(item) !== choice.key; });
      if (selected !== MISSING) plan.result.tombstones.push(selected);
      choice.resolution = resolution;
    } else {
      return { ok: false, reason: "unsupported-choice" };
    }

    return { ok: true, plan, unresolvedCount: unresolvedChoices(plan).length };
  }

  function unresolvedChoices(plan) {
    return (plan && Array.isArray(plan.choices) ? plan.choices : []).filter(function (choice) {
      return !choice.resolution;
    });
  }

  function finaliseCombination(plan, options) {
    if (!plan || plan.schema !== PLAN_SCHEMA) return { ok: false, reason: "invalid-plan" };
    const unresolved = unresolvedChoices(plan);
    if (unresolved.length) {
      return {
        ok: false,
        reason: "choices-required",
        unresolvedCount: unresolved.length,
        choices: unresolved
      };
    }
    const validation = validateStructure(plan.result, options);
    if (!validation.ok) {
      return {
        ok: false,
        reason: "invalid-combination",
        errors: validation.errors,
        message: "Pocket couldn’t safely combine these versions. Nothing was changed."
      };
    }
    return {
      ok: true,
      document: cloneValue(validation.document),
      message: "Pocket combined the changes. Nothing else needs your choice."
    };
  }

  function classifySideChange(baseNode, sideNode) {
    if (!baseNode && sideNode) return "added";
    if (baseNode && !sideNode) return "removed";
    if (!baseNode && !sideNode) return "unchanged";
    const fields = nodeChangedFields(baseNode, sideNode);
    if (!fields.length) return "unchanged";
    return fields.includes("parentId") || fields.includes("order") ? "moved" : "changed";
  }

  function classifyValueChange(baseValue, sideValue) {
    if (equalValue(baseValue, sideValue)) return "unchanged";
    if (baseValue === MISSING) return "added";
    if (sideValue === MISSING) return "removed";
    return "changed";
  }

  function addReviewItem(groups, item, fileChange, deviceChange, options) {
    const opts = options || {};
    if (fileChange === "unchanged" && deviceChange === "unchanged") return;
    item.fileChange = fileChange;
    item.deviceChange = deviceChange;
    if (fileChange !== "unchanged" && deviceChange !== "unchanged") groups.changedBoth.push(item);
    else if (opts.tombstone && fileChange === "added") groups.removedFile.push(item);
    else if (opts.tombstone && deviceChange === "added") groups.removedDevice.push(item);
    else if (fileChange === "moved" || deviceChange === "moved") groups.moved.push(item);
    else if (fileChange === "added") groups.addedFile.push(item);
    else if (deviceChange === "added") groups.addedDevice.push(item);
    else if (fileChange === "removed") groups.removedFile.push(item);
    else if (deviceChange === "removed") groups.removedDevice.push(item);
    else if (fileChange !== "unchanged") groups.changedFile.push(item);
    else groups.changedDevice.push(item);
  }

  function buildReview(input) {
    const fileCoerced = coerceDocument(input && input.file);
    const deviceCoerced = coerceDocument(input && input.device);
    if (!fileCoerced.ok || !deviceCoerced.ok) {
      return { ok: false, reason: !fileCoerced.ok ? fileCoerced.reason : deviceCoerced.reason };
    }
    const baseCoerced = input && input.base ? coerceDocument(input.base) : null;
    if (!baseCoerced || !baseCoerced.ok) {
      const direct = compareDocuments(fileCoerced.document, deviceCoerced.document);
      return {
        ok: direct.ok,
        mode: "two-version",
        groups: [{
          key: "different",
          title: "Differences between the file and device changes",
          items: direct.changes
        }],
        combineAvailable: false,
        combineMessage: NO_BASE_MESSAGE
      };
    }
    const eligibility = input && input.storedBaseFingerprint
      ? assessCombinationEligibility({
          base: baseCoerced.document,
          file: fileCoerced.document,
          device: deviceCoerced.document,
          storedBaseFingerprint: input.storedBaseFingerprint,
          limits: input.limits,
          combinationSafe: input.combinationSafe
        })
      : { eligible: false, reason: "missing-base-fingerprint", message: NO_BASE_MESSAGE };
    if (!eligibility.eligible) {
      const direct = compareDocuments(fileCoerced.document, deviceCoerced.document);
      return {
        ok: direct.ok,
        mode: "two-version",
        groups: [{
          key: "different",
          title: "Differences between the file and device changes",
          items: direct.changes
        }],
        combineAvailable: false,
        combineMessage: eligibility.message || NO_BASE_MESSAGE,
        combinationEligibility: eligibility
      };
    }

    const baseMap = mapNodes(baseCoerced.document.nodes);
    const fileMap = mapNodes(fileCoerced.document.nodes);
    const deviceMap = mapNodes(deviceCoerced.document.nodes);
    const ids = Array.from(new Set(
      Array.from(baseMap.keys()).concat(Array.from(fileMap.keys()), Array.from(deviceMap.keys()))
    )).sort();
    const groups = {
      changedFile: [],
      changedDevice: [],
      addedFile: [],
      addedDevice: [],
      removedFile: [],
      removedDevice: [],
      changedBoth: [],
      moved: []
    };

    for (const id of ids) {
      const baseNode = baseMap.get(id);
      const fileNode = fileMap.get(id);
      const deviceNode = deviceMap.get(id);
      const fileChange = classifySideChange(baseNode, fileNode);
      const deviceChange = classifySideChange(baseNode, deviceNode);
      if (fileChange === "unchanged" && deviceChange === "unchanged") continue;
      const representative = fileNode || deviceNode || baseNode;
      addReviewItem(groups, {
        nodeId: id,
        path: itemPath((fileNode ? fileCoerced.document : (deviceNode ? deviceCoerced.document : baseCoerced.document)).nodes, id),
        title: String(representative.label || id),
        fields: nodeChangedFields(fileNode || baseNode || {}, deviceNode || baseNode || {})
      }, fileChange, deviceChange);
    }

    const metadataScopes = [
      ["rootExtras", "Document information", baseCoerced.document.rootExtras, fileCoerced.document.rootExtras, deviceCoerced.document.rootExtras],
      ["dataExtras", "Pocket data information", baseCoerced.document.dataExtras, fileCoerced.document.dataExtras, deviceCoerced.document.dataExtras]
    ];
    for (const scope of metadataScopes) {
      const keys = new Set(Object.keys(scope[2]).concat(Object.keys(scope[3]), Object.keys(scope[4])));
      for (const key of Array.from(keys).sort()) {
        const baseValue = ownValue(scope[2], key);
        const fileValue = ownValue(scope[3], key);
        const deviceValue = ownValue(scope[4], key);
        addReviewItem(groups, {
          nodeId: "",
          path: scope[1],
          title: scope[1] + ": " + key,
          fields: [scope[0] + "." + key]
        }, classifyValueChange(baseValue, fileValue), classifyValueChange(baseValue, deviceValue));
      }
    }

    const baseTombstones = tombstoneMap(baseCoerced.document.tombstones);
    const fileTombstones = tombstoneMap(fileCoerced.document.tombstones);
    const deviceTombstones = tombstoneMap(deviceCoerced.document.tombstones);
    const tombstoneKeys = new Set(
      Array.from(baseTombstones.keys()).concat(Array.from(fileTombstones.keys()), Array.from(deviceTombstones.keys()))
    );
    for (const key of Array.from(tombstoneKeys).sort()) {
      const baseValue = baseTombstones.has(key) ? baseTombstones.get(key) : MISSING;
      const fileValue = fileTombstones.has(key) ? fileTombstones.get(key) : MISSING;
      const deviceValue = deviceTombstones.has(key) ? deviceTombstones.get(key) : MISSING;
      const id = key.startsWith("id:") ? key.slice(3) : "";
      const representative = baseMap.get(id) || fileMap.get(id) || deviceMap.get(id);
      addReviewItem(groups, {
        nodeId: id,
        path: representative ? itemPath(baseCoerced.document.nodes, id) : "Removed items",
        title: representative ? String(representative.label || id) : (id || "Removed item record"),
        fields: ["tombstone"]
      }, classifyValueChange(baseValue, fileValue), classifyValueChange(baseValue, deviceValue), { tombstone: true });
    }

    const definitions = [
      ["changedFile", "Changed in the file"],
      ["changedDevice", "Changed on this device"],
      ["addedFile", "Added in the file"],
      ["addedDevice", "Added on this device"],
      ["removedFile", "Removed in the file"],
      ["removedDevice", "Removed on this device"],
      ["changedBoth", "Changed in both versions"],
      ["moved", "Moved in one version"]
    ];
    return {
      ok: true,
      mode: "three-version",
      groups: definitions.map(function (definition) {
        return { key: definition[0], title: definition[1], items: groups[definition[0]] };
      }).filter(function (group) { return group.items.length > 0; }),
      combineAvailable: eligibility.eligible,
      combineMessage: eligibility.eligible ? "" : NO_BASE_MESSAGE,
      combinationEligibility: eligibility
    };
  }

  let activeResolution = null;
  let uiBound = false;
  let inertedElements = [];

  function dom(id) {
    const doc = global.document;
    return doc && typeof doc.getElementById === "function" ? doc.getElementById(id) : null;
  }

  function isResolutionOpen() {
    const overlay = dom("deviceChangesOverlay");
    return !!activeResolution && !!overlay && overlay.hidden === false;
  }

  function currentStateDocument() {
    if (typeof state !== "object" || !state) return { ok: false, reason: "state-unavailable" };
    return coerceDocument({
      nodes: Array.isArray(state.nodes) ? state.nodes : [],
      tombstones: Array.isArray(state.tombstones) ? state.tombstones : [],
      rootExtras: isPlainObject(state.rootExtras) ? state.rootExtras : {},
      dataExtras: isPlainObject(state.dataExtras) ? state.dataExtras : {}
    });
  }

  function snapshotDocument(snapshot) {
    if (!snapshot || typeof snapshot !== "object") return { ok: false, reason: "missing-device-copy" };
    const payload = snapshot.parsed && snapshot.parsed.payload;
    if (payload && typeof payload === "object") return coerceDocument(payload);
    if (snapshot.norm && typeof snapshot.norm === "object") return coerceDocument(snapshot.norm);
    return { ok: false, reason: "missing-device-copy" };
  }

  function friendlyTime(value, prefix) {
    const raw = String(value || "").trim();
    if (!raw || !Number.isFinite(Date.parse(raw))) return "";
    if (typeof global.formatAgoLabel === "function") {
      return prefix + " " + global.formatAgoLabel(raw);
    }
    try {
      return prefix + " " + new Date(raw).toLocaleString();
    } catch (_error) {
      return "";
    }
  }

  function setElementText(id, value) {
    const element = dom(id);
    if (element) element.textContent = String(value || "");
  }

  function setNotice(message) {
    setElementText("deviceChangesNotice", message);
  }

  function setView(view) {
    if (!activeResolution) return;
    activeResolution.view = view;
    const decision = dom("deviceChangesDecisionView");
    const review = dom("deviceChangesReview");
    const choice = dom("deviceChangesChoiceView");
    const back = dom("deviceChangesBack");
    const reviewButton = dom("deviceChangesReviewBtn");
    if (decision) decision.hidden = view === "choice";
    if (review) review.hidden = view !== "review";
    if (choice) choice.hidden = view !== "choice";
    if (back) back.hidden = view !== "review";
    if (reviewButton) reviewButton.hidden = view === "review";
  }

  function focusableResolutionElements() {
    const overlay = dom("deviceChangesOverlay");
    if (!overlay || typeof overlay.querySelectorAll !== "function") return [];
    return Array.from(overlay.querySelectorAll("button:not([disabled])")).filter(function (element) {
      if (!element || element.hidden) return false;
      let current = element;
      while (current && current !== overlay) {
        if (current.hidden) return false;
        current = current.parentElement;
      }
      return true;
    });
  }

  function focusFirstResolutionChoice() {
    const preferred = activeResolution && activeResolution.view === "choice"
      ? focusableResolutionElements()[0]
      : dom("deviceChangesUseFile");
    if (preferred && typeof preferred.focus === "function") {
      try { preferred.focus({ preventScroll: true }); } catch (_error) { preferred.focus(); }
    }
  }

  function setBackgroundInert(enabled) {
    const overlay = dom("deviceChangesOverlay");
    if (!overlay || !overlay.parentElement) return;
    if (enabled) {
      inertedElements = Array.from(overlay.parentElement.children || [])
        .filter(function (element) { return element !== overlay; })
        .map(function (element) {
          const previous = element.inert === true;
          element.inert = true;
          return { element, previous };
        });
      return;
    }
    for (const record of inertedElements) {
      if (record && record.element) record.element.inert = record.previous;
    }
    inertedElements = [];
  }

  function showResolutionOverlay() {
    const overlay = dom("deviceChangesOverlay");
    if (!overlay) return false;
    overlay.hidden = false;
    if (global.document && global.document.body && global.document.body.classList) {
      global.document.body.classList.add("deviceChangesOpen");
    }
    setBackgroundInert(true);
    if (typeof global.requestAnimationFrame === "function") {
      global.requestAnimationFrame(focusFirstResolutionChoice);
    } else {
      focusFirstResolutionChoice();
    }
    return true;
  }

  function closeResolutionOverlay(options) {
    const opts = options || {};
    const overlay = dom("deviceChangesOverlay");
    if (overlay) overlay.hidden = true;
    setBackgroundInert(false);
    if (global.document && global.document.body && global.document.body.classList) {
      global.document.body.classList.remove("deviceChangesOpen");
    }
    activeResolution = null;
    if (opts.restoreFocus !== false && typeof global.refocusTreeNavigation === "function") {
      global.refocusTreeNavigation(typeof state === "object" ? state.selectedId : "");
    }
  }

  function resolutionSessionStillCurrent() {
    if (!activeResolution || typeof global.isPocketFileSaveSessionCurrent !== "function") return false;
    if (global.isPocketFileSaveSessionCurrent(activeResolution.fileSession)) return true;
    closeResolutionOverlay({ restoreFocus: true });
    if (typeof global.setStatus === "function") {
      global.setStatus("Pocket changed while the difference was open. Nothing was changed. Open the file again to review it.", "warn", { durationMs: 7200 });
    }
    return false;
  }

  function resolutionInput(record) {
    return {
      base: record.base ? record.base.payload : null,
      file: record.file,
      device: record.device,
      storedBaseFingerprint: record.base ? record.base.fingerprint : "",
      combinationSafe: record.combinationSafe !== false
    };
  }

  function ensureDeviceVersionInTrail(snapshot) {
    if (!snapshot || !snapshot.parsed) return false;
    if (typeof global.appendLocalSafetyTrail === "function"
        && global.appendLocalSafetyTrail(snapshot.parsed)) {
      return true;
    }
    if (typeof global.appendLocalSafetyTrail === "function"
        && Object.prototype.hasOwnProperty.call(snapshot.parsed, "base")) {
      try {
        const withoutBase = cloneValue(snapshot.parsed);
        delete withoutBase.base;
        if (global.appendLocalSafetyTrail(withoutBase)) return true;
      } catch (_error) {}
    }
    if (typeof global.appendLocalSafetyTrail === "function"
        && typeof global.localSafetyEntryWithoutChangeMetadata === "function") {
      const deviceFirst = global.localSafetyEntryWithoutChangeMetadata(
        snapshot.parsed,
        { keepBase: false }
      );
      if (deviceFirst && global.appendLocalSafetyTrail(deviceFirst)) return true;
    }
    if (typeof global.readLocalSafetyTrail !== "function") return false;
    const expectedCapturedAt = String(snapshot.parsed.capturedAt || "");
    return global.readLocalSafetyTrail().some(function (entry) {
      try {
        const parsed = entry && entry.parsed ? entry.parsed : entry;
        return String(parsed && parsed.capturedAt || "") === expectedCapturedAt
          && documentsEqual(parsed && parsed.payload, snapshot.parsed.payload);
      } catch (_error) {
        return false;
      }
    });
  }

  function prepareResolutionIdentity(record) {
    setElementText("deviceChangesFileName", record.fileName || "Selected Pocket file");
    setElementText("deviceChangesFileTime", friendlyTime(record.fileSource.writtenAt, "Saved"));
    setElementText("deviceChangesDeviceTime", friendlyTime(record.snapshot.capturedAt, "Kept"));
    const deviceSource = String(record.snapshot.parsed?.source?.fileName || "").trim();
    setElementText("deviceChangesDeviceSource", deviceSource ? "From " + deviceSource : "");
  }

  function renderReview(record) {
    const container = dom("deviceChangesReviewList");
    if (!container || !global.document || typeof global.document.createElement !== "function") return;
    while (container.firstChild) container.removeChild(container.firstChild);
    const review = buildReview(resolutionInput(record));
    record.review = review;
    const groups = review && review.ok && Array.isArray(review.groups) ? review.groups : [];
    for (const group of groups) {
      if (!group || !Array.isArray(group.items) || group.items.length === 0) continue;
      const section = global.document.createElement("section");
      section.className = "deviceChangesReviewGroup";
      const heading = global.document.createElement("h4");
      heading.textContent = String(group.title || "Different");
      const list = global.document.createElement("ul");
      for (const item of group.items) {
        const row = global.document.createElement("li");
        const title = String(item.path || item.title || "Item");
        const fieldText = Array.isArray(item.fields) && item.fields.length
          ? " · " + item.fields.map(fieldLabel).join(", ")
          : "";
        row.textContent = title + fieldText;
        list.appendChild(row);
      }
      section.appendChild(heading);
      section.appendChild(list);
      container.appendChild(section);
    }
    if (groups.length === 0) {
      const empty = global.document.createElement("p");
      empty.textContent = "No meaningful content differences were found.";
      container.appendChild(empty);
    }
  }

  function fieldLabel(field) {
    const labels = {
      label: "title",
      details: "Notes",
      editor: "Outline",
      parentId: "location",
      order: "position",
      tombstone: "removed item"
    };
    return labels[field] || String(field || "information").replace(/^.*\./, "");
  }

  function conciseValue(value, field) {
    if (value && value.missing === true) return "Not present";
    const actual = value && Object.prototype.hasOwnProperty.call(value, "value") ? value.value : value;
    if (actual === null) return "None";
    if (field === "editor" && isPlainObject(actual)) {
      const rows = Array.isArray(actual.outline) ? actual.outline.length : 0;
      return rows ? "Outline with " + rows + " row" + (rows === 1 ? "" : "s") : "Editor information";
    }
    if (Array.isArray(actual)) return actual.length + " value" + (actual.length === 1 ? "" : "s");
    if (isPlainObject(actual)) return "Information with " + Object.keys(actual).length + " field" + (Object.keys(actual).length === 1 ? "" : "s");
    const text = String(actual === undefined ? "" : actual);
    return text.length > 800 ? text.slice(0, 797) + "..." : text;
  }

  function currentChoice(record) {
    return record.plan ? unresolvedChoices(record.plan)[0] || null : null;
  }

  function choiceSidePreview(choice, side) {
    if (!choice) return "";
    if (Array.isArray(choice.values) && choice.values.length) {
      return choice.values.map(function (entry) {
        return fieldLabel(entry.field) + ":\n" + conciseValue(entry[side], entry.field);
      }).join("\n\n");
    }
    const value = choice[side];
    if (choice.kind === "metadata" || choice.kind === "tombstone") {
      return conciseValue(value, choice.key || "information");
    }
    if (value && typeof value === "object") {
      const lines = [];
      if (value.label) lines.push("Title: " + value.label);
      if (value.details) lines.push("Notes:\n" + value.details);
      if (value.editor) lines.push(conciseValue(value.editor, "editor"));
      return lines.join("\n\n") || "Item information";
    }
    return conciseValue(value, "");
  }

  function appendChoiceButton(container, label, resolution) {
    const button = global.document.createElement("button");
    button.type = "button";
    button.textContent = label;
    button.addEventListener("click", function () {
      resolveActiveDifference(resolution);
    });
    container.appendChild(button);
  }

  function renderActiveChoice(record) {
    const choice = currentChoice(record);
    if (!choice) {
      finishCombination(record);
      return;
    }
    const remaining = unresolvedChoices(record.plan).length;
    setElementText("deviceChangesChoiceProgress", "Pocket combined what it could.\nThere are " + remaining + " difference" + (remaining === 1 ? "" : "s") + " that need your choice.");
    setElementText("deviceChangesChoicePath", choice.path || choice.title || "Document information");
    setElementText("deviceChangesChoiceFields", "Changed: " + (choice.fields || []).map(fieldLabel).join(", "));
    setElementText("deviceChangesFileValue", choiceSidePreview(choice, "file"));
    setElementText("deviceChangesDeviceValue", choiceSidePreview(choice, "device"));
    const title = dom("deviceChangesChoiceTitle");
    if (title) {
      title.textContent = choice.kind === "delete-versus-edit"
        ? "This item was changed in one version and removed in the other."
        : "This item changed in both versions.";
    }
    const actions = dom("deviceChangesChoiceActions");
    if (!actions || !global.document) return;
    while (actions.firstChild) actions.removeChild(actions.firstChild);
    if (choice.kind === "delete-versus-edit") {
      appendChoiceButton(actions, "Keep the item", "keep-item");
      appendChoiceButton(actions, "Leave it removed", "leave-removed");
    } else {
      appendChoiceButton(actions, "Use the file version", "file");
      appendChoiceButton(actions, "Use the device version", "device");
      if (choice.options.includes("keep-both")) appendChoiceButton(actions, "Keep both", "keep-both");
    }
    const back = global.document.createElement("button");
    back.type = "button";
    back.textContent = "Back";
    back.addEventListener("click", function () {
      record.plan = null;
      setView("decision");
      setNotice(record.combineMessage || "");
      focusFirstResolutionChoice();
    });
    actions.appendChild(back);
    setView("choice");
    focusFirstResolutionChoice();
  }

  function resolveActiveDifference(resolution) {
    const record = activeResolution;
    if (!record || !record.plan || !resolutionSessionStillCurrent()) return false;
    const choice = currentChoice(record);
    if (!choice) return false;
    const result = resolveChoice(record.plan, choice.id, resolution, {
      makeId: function (prefix) {
        return typeof global.makeId === "function"
          ? global.makeId(prefix || "node")
          : "node_device_" + Math.random().toString(36).slice(2, 11);
      }
    });
    if (!result.ok) {
      setNotice("Pocket couldn’t apply that choice safely. Nothing was changed.");
      return false;
    }
    if (result.unresolvedCount > 0) {
      renderActiveChoice(record);
      return true;
    }
    return finishCombination(record);
  }

  function adoptCombinedDocument(record, document) {
    if (!resolutionSessionStillCurrent()) return false;
    if (typeof global.setDetachedPocketDocumentSession !== "function"
        || typeof global.applyLoadedState !== "function"
        || typeof global.saveDetachedPocketSafetySnapshot !== "function") {
      setNotice("Pocket couldn’t open the combined changes safely. Nothing was changed.");
      return false;
    }
    const fileBase = {
      payload: cloneValue(record.file),
      fingerprint: fingerprintDocument(record.file),
      source: cloneValue(record.fileSource)
    };
    const combinedOperation = {
      type: "combined_device_changes_opened",
      at: typeof global.nowIso === "function" ? global.nowIso() : new Date().toISOString(),
      seq: typeof global.allocatePocketOperationSequence === "function"
        ? global.allocatePocketOperationSequence()
        : 1
    };
    const combinedChanges = describeDocumentTransition(record.file, document, {
      operationType: combinedOperation.type
    });
    if (combinedChanges.ok && combinedChanges.records.length > 0) {
      combinedOperation.changes = combinedChanges.records;
    }
    const combinedSource = {
      schema: "portal.export.v1",
      fileName: "Combined changes",
      writtenAt: ""
    };
    const safety = global.saveDetachedPocketSafetySnapshot(document, fileBase, {
      reason: "combined-device-changes",
      source: combinedSource,
      ops: [combinedOperation],
      selectedId: typeof state === "object" ? state.selectedId : "",
      focusRootId: typeof state === "object" ? state.focusRootId : "",
      collapsedIds: typeof state === "object" ? state.collapsed : []
    });
    if (!safety || safety.ok !== true) {
      setNotice("Pocket couldn’t keep the combined changes safe on this device. Nothing was changed.");
      return false;
    }
    closeResolutionOverlay({ restoreFocus: false });
    global.setDetachedPocketDocumentSession("Combined changes");
    global.applyLoadedState(document, combinedSource, {
      clearOps: false,
      skipLocalSafetyCheck: true
    });
    if (typeof global.adoptPocketOperations === "function") {
      global.adoptPocketOperations([combinedOperation], combinedOperation.seq, { anchor: document });
    } else {
      state.ops = [combinedOperation];
    }
    state.detachedSafetyBase = safety.baseStored === true ? fileBase : null;
    if (typeof global.clearConflictGuard === "function") global.clearConflictGuard();
    if (typeof global.refreshMeta === "function") global.refreshMeta();
    if (typeof global.renderTree === "function") global.renderTree();
    if (typeof global.persistPipSnapshot === "function") global.persistPipSnapshot();
    if (typeof global.refocusTreeNavigation === "function") global.refocusTreeNavigation(state.selectedId);
    if (typeof global.setStatus === "function") {
      global.setStatus(
        "Pocket combined the changes. Nothing else needs your choice. Combined changes opened. Save when ready.",
        "ok",
        { durationMs: 7200 }
      );
    }
    return true;
  }

  function finishCombination(record) {
    if (!record || !record.plan || !resolutionSessionStillCurrent()) return false;
    const finalised = finaliseCombination(record.plan);
    if (!finalised.ok) {
      setNotice(finalised.message || "Pocket couldn’t safely combine these versions. Nothing was changed.");
      record.plan = null;
      setView("decision");
      focusFirstResolutionChoice();
      return false;
    }
    return adoptCombinedDocument(record, finalised.document);
  }

  function beginCombination() {
    const record = activeResolution;
    if (!record || !resolutionSessionStillCurrent()) return false;
    if (!record.eligibility || !record.eligibility.eligible) {
      setNotice(NO_BASE_MESSAGE);
      return false;
    }
    const planned = planCombination(resolutionInput(record));
    if (!planned.ok) {
      setNotice(planned.message || NO_BASE_MESSAGE);
      return false;
    }
    record.plan = planned.plan;
    if (planned.unresolvedCount > 0) {
      renderActiveChoice(record);
      return true;
    }
    return finishCombination(record);
  }

  function useFileVersion() {
    const record = activeResolution;
    if (!record || !resolutionSessionStillCurrent()) return false;
    if (record.candidateKind === "current-safety") {
      if (!ensureDeviceVersionInTrail(record.snapshot)) {
        setNotice("Pocket couldn’t keep the device version in its earlier-version list. Nothing was changed. Use the device changes, or free some browser storage before choosing the file.");
        return false;
      }
      if (typeof global.clearLocalSafetySnapshot !== "function"
          || !global.clearLocalSafetySnapshot()) {
        setNotice("Pocket couldn’t finish that choice safely. Nothing was changed.");
        return false;
      }
    }
    if (typeof global.clearConflictGuard === "function") global.clearConflictGuard();
    closeResolutionOverlay({ restoreFocus: true });
    if (typeof global.setStatus === "function") global.setStatus("Opened the file.", "ok", { durationMs: 4200 });
    return true;
  }

  function useDeviceVersion() {
    const record = activeResolution;
    if (!record || !resolutionSessionStillCurrent()) return false;
    const snapshot = record.snapshot;
    if (typeof global.prepareLocalSafetySnapshotForDetachedAdoption !== "function") {
      setNotice("Pocket couldn’t open those device changes safely. Nothing was changed.");
      return false;
    }
    const prepared = global.prepareLocalSafetySnapshotForDetachedAdoption(snapshot);
    if (!prepared || prepared.ok !== true) {
      setNotice("Pocket couldn’t keep those device changes safe enough to open them. Nothing was changed.");
      return false;
    }
    closeResolutionOverlay({ restoreFocus: false });
    return typeof global.restoreLocalSafetySnapshot === "function"
      ? global.restoreLocalSafetySnapshot(snapshot, { preparedSafety: prepared })
      : false;
  }

  function openResolution(snapshot, options) {
    if (isResolutionOpen()) return true;
    if (typeof global.isPocketFilePermissionPromptOpen === "function"
        && global.isPocketFilePermissionPromptOpen()) {
      if (typeof global.showPocketFilePermissionPendingStatus === "function") {
        global.showPocketFilePermissionPendingStatus();
      }
      return false;
    }
    const opts = options || {};
    const comparisonEnvelope = isPlainObject(opts.fileDocument)
        && opts.fileDocument.schema === "pocket.deviceChanges.comparisonInput.v1"
      ? opts.fileDocument
      : null;
    const file = opts.fileDocument
      ? coerceDocument(comparisonEnvelope ? comparisonEnvelope.document : opts.fileDocument)
      : currentStateDocument();
    const device = snapshotDocument(snapshot);
    if (!file.ok || !device.ok || !Array.isArray(device.document.nodes)) return false;
    if (documentsEqual(file.document, device.document)) {
      if (opts.candidateKind === "current-safety") {
        if (typeof global.appendLocalSafetyTrail === "function") global.appendLocalSafetyTrail(snapshot.parsed);
        if (typeof global.clearLocalSafetySnapshot === "function") global.clearLocalSafetySnapshot();
      }
      if (typeof global.clearConflictGuard === "function") global.clearConflictGuard();
      return false;
    }
    if (typeof global.capturePocketFileSaveSession !== "function") return false;
    const base = snapshot.base && snapshot.base.payload
      ? {
          payload: cloneValue(snapshot.base.payload),
          fingerprint: String(snapshot.base.fingerprint || ""),
          source: cloneValue(snapshot.base.source || {})
        }
      : null;
    const normalisedDevice = snapshot && snapshot.norm
      ? coerceDocument(snapshot.norm)
      : null;
    const storedChangeSet = snapshot?.deviceChanges || snapshot?.parsed?.deviceChanges || null;
    const changeSetConsistent = !storedChangeSet || (
      isPlainObject(storedChangeSet)
      && storedChangeSet.schema === MODULE_SCHEMA
      && !!base
      && String(storedChangeSet.baseFingerprint || "") === String(base.fingerprint || "")
      && Array.isArray(storedChangeSet.records)
      && Number.isSafeInteger(Number(storedChangeSet.highestSequence))
      && Number(storedChangeSet.highestSequence) >= 0
    );
    const record = {
      origin: String(opts.origin || "device-review"),
      candidateKind: String(opts.candidateKind || "current-safety"),
      snapshot,
      file: cloneValue(file.document),
      device: cloneValue(device.document),
      base,
      fileSession: global.capturePocketFileSaveSession(),
      fileName: String(state.pocketFile?.displayName || state.source?.fileName || "Selected Pocket file"),
      fileSource: cloneValue(state.source || {}),
      view: "decision",
      review: null,
      plan: null,
      combinationSafe: (!comparisonEnvelope || comparisonEnvelope.combinationSafe === true)
        && device.ambiguousTreeCopies !== true
        && changeSetConsistent
        && (!normalisedDevice
          || (normalisedDevice.ok
            && documentsEqual(device.document, normalisedDevice.document)))
    };
    record.eligibility = assessCombinationEligibility(resolutionInput(record));
    record.combineMessage = record.eligibility.eligible
      ? ""
      : (record.eligibility.message || NO_BASE_MESSAGE);
    activeResolution = record;
    prepareResolutionIdentity(record);
    const combine = dom("deviceChangesCombine");
    if (combine) combine.disabled = !record.eligibility.eligible;
    setNotice(record.combineMessage);
    setView("decision");
    renderReview(record);
    if (!showResolutionOverlay()) {
      activeResolution = null;
      return false;
    }
    return true;
  }

  function reviewCurrentDeviceChanges(options) {
    if (typeof global.readLocalSafetySnapshot !== "function") return false;
    const snapshot = global.readLocalSafetySnapshot();
    if (!snapshot) return false;
    return openResolution(snapshot, {
      origin: String(options?.origin || "device-review"),
      candidateKind: "current-safety"
    });
  }

  function showReview() {
    if (!activeResolution || !resolutionSessionStillCurrent()) return false;
    renderReview(activeResolution);
    setView("review");
    setNotice(activeResolution.combineMessage || "");
    const back = dom("deviceChangesBack");
    if (back && typeof back.focus === "function") back.focus();
    return true;
  }

  function backToDecision() {
    if (!activeResolution) return false;
    activeResolution.plan = null;
    setView("decision");
    setNotice(activeResolution.combineMessage || "");
    focusFirstResolutionChoice();
    return true;
  }

  function handleResolutionKeydown(event) {
    if (!isResolutionOpen() || !event) return;
    const overlay = dom("deviceChangesOverlay");
    const targetInside = overlay && typeof overlay.contains === "function" ? overlay.contains(event.target) : true;
    if (event.key === "Escape") {
      event.preventDefault();
      if (typeof event.stopImmediatePropagation === "function") event.stopImmediatePropagation();
      focusFirstResolutionChoice();
      return;
    }
    if ((event.metaKey || event.ctrlKey) && String(event.key || "").toLowerCase() === "s") {
      event.preventDefault();
      if (typeof event.stopImmediatePropagation === "function") event.stopImmediatePropagation();
      return;
    }
    if (event.key === "Tab") {
      const items = focusableResolutionElements();
      if (!items.length) return;
      const current = global.document.activeElement;
      const index = items.indexOf(current);
      const next = event.shiftKey
        ? (index <= 0 ? items.length - 1 : index - 1)
        : (index < 0 || index >= items.length - 1 ? 0 : index + 1);
      event.preventDefault();
      if (typeof event.stopImmediatePropagation === "function") event.stopImmediatePropagation();
      items[next].focus();
      return;
    }
    if (!targetInside) {
      event.preventDefault();
      if (typeof event.stopImmediatePropagation === "function") event.stopImmediatePropagation();
      focusFirstResolutionChoice();
    }
  }

  function bindResolutionUi() {
    if (uiBound || !global.document) return false;
    const overlay = dom("deviceChangesOverlay");
    if (!overlay) return false;
    uiBound = true;
    dom("deviceChangesUseFile")?.addEventListener("click", useFileVersion);
    dom("deviceChangesUseDevice")?.addEventListener("click", useDeviceVersion);
    dom("deviceChangesCombine")?.addEventListener("click", beginCombination);
    dom("deviceChangesReviewBtn")?.addEventListener("click", showReview);
    dom("deviceChangesBack")?.addEventListener("click", backToDecision);
    if (typeof global.addEventListener === "function") {
      global.addEventListener("keydown", handleResolutionKeydown, true);
    }
    if (typeof global.document.addEventListener === "function") {
      global.document.addEventListener("focusin", function (event) {
        if (!isResolutionOpen()) return;
        const currentOverlay = dom("deviceChangesOverlay");
        if (currentOverlay && typeof currentOverlay.contains === "function" && currentOverlay.contains(event.target)) return;
        focusFirstResolutionChoice();
      }, true);
    }
    return true;
  }

  bindResolutionUi();

  global.PocketDeviceChanges = Object.freeze({
    MODULE_SCHEMA,
    PLAN_SCHEMA,
    FINGERPRINT_SCHEMA,
    MAX_COMPARISON_CHARS,
    MAX_COMPARISON_NODES,
    NO_BASE_MESSAGE,
    UNSAFE_COMBINATION_MESSAGE,
    cloneJsonCompatible,
    stableStringify,
    coerceDocument,
    describeDocumentTransition,
    meaningfulDocument,
    documentsEqual,
    fingerprintDocument,
    compareDocuments,
    buildReview,
    validateStructure,
    assessCombinationEligibility,
    planCombination,
    resolveChoice,
    unresolvedChoices,
    finaliseCombination,
    openResolution,
    reviewCurrentDeviceChanges,
    useFileVersion,
    useDeviceVersion,
    beginCombination,
    showReview,
    backToDecision,
    isOpen: isResolutionOpen,
    bindUi: bindResolutionUi
  });
  global.openPocketDeviceChangesDecision = openResolution;
  global.reviewCurrentPocketDeviceChanges = reviewCurrentDeviceChanges;
  global.isPocketDeviceChangesDecisionOpen = isResolutionOpen;
})(typeof window !== "undefined" ? window : globalThis);
