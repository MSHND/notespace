/* Dormant, lossless bridge between today's normalised Pocket document and an
   inspectable Starling shadow. This is deliberately not a persistence format
   or live truth owner. nodeSequence preserves current array order only so the
   present format can be reconstructed exactly. */
(function initialisePocketStarlingShadow(global) {
  "use strict";

  const SHADOW_SCHEMA = "pocket.starling.shadow.v1";
  const DOCUMENT_KEYS = ["schema", "writtenAt", "nodes", "tombstones", "rootExtras", "dataExtras"];
  const SHADOW_KEYS = ["schema", "source", "nodeSequence", "identities", "placements", "payloads", "tombstones", "rootExtras", "dataExtras"];

  function resultFailure(reason) {
    return { ok: false, reason };
  }

  function isPlainObject(value) {
    return value !== null
      && typeof value === "object"
      && !Array.isArray(value)
      && Object.prototype.toString.call(value) === "[object Object]";
  }

  function hasExactKeys(value, keys) {
    if (!isPlainObject(value)) return false;
    const actual = Object.keys(value);
    if (actual.length !== keys.length) return false;
    return keys.every((key) => Object.prototype.hasOwnProperty.call(value, key));
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
          : resultFailure("json-incompatible-value");
      }
      if (typeof current !== "object" || ancestors.has(current)) {
        return resultFailure("json-incompatible-value");
      }
      if (!Array.isArray(current) && !isPlainObject(current)) {
        return resultFailure("json-incompatible-value");
      }

      ancestors.add(current);
      const output = Array.isArray(current) ? [] : {};
      try {
        const keys = Array.isArray(current)
          ? Array.from({ length: current.length }, (_unused, index) => String(index))
          : Object.keys(current);
        for (const key of keys) {
          const child = clone(current[key]);
          if (!child.ok) return child;
          if (Array.isArray(output)) output.push(child.value);
          else Object.defineProperty(output, key, {
            value: child.value,
            enumerable: true,
            writable: true,
            configurable: true,
          });
        }
      } catch (_error) {
        return resultFailure("json-incompatible-value");
      } finally {
        ancestors.delete(current);
      }
      return { ok: true, value: output };
    }

    return clone(value);
  }

  function cloneRequired(value) {
    const cloned = cloneJsonCompatible(value);
    return cloned.ok ? cloned : resultFailure(cloned.reason || "json-incompatible-value");
  }

  function readNormalisedDocument(norm) {
    if (!hasExactKeys(norm, DOCUMENT_KEYS) || !Array.isArray(norm.nodes) || !Array.isArray(norm.tombstones)) {
      return resultFailure("invalid-normalised-document");
    }
    if (typeof norm.schema !== "string" || typeof norm.writtenAt !== "string") {
      return resultFailure("invalid-normalised-document");
    }
    const cloned = cloneRequired(norm);
    if (!cloned.ok) return cloned;
    return { ok: true, value: cloned.value };
  }

  function encode(norm) {
    const documentResult = readNormalisedDocument(norm);
    if (!documentResult.ok) return documentResult;
    const document = documentResult.value;
    const seenIds = new Set();
    const nodeSequence = [];
    const identities = [];
    const placements = [];
    const payloads = [];

    for (const node of document.nodes) {
      if (!isPlainObject(node) || !Object.prototype.hasOwnProperty.call(node, "id")) {
        return resultFailure("invalid-node-identity");
      }
      const nodeId = node.id;
      if (typeof nodeId !== "string" || !nodeId || seenIds.has(nodeId)) {
        return resultFailure(seenIds.has(nodeId) ? "duplicate-node-id" : "invalid-node-identity");
      }
      if (!Object.prototype.hasOwnProperty.call(node, "parentId") || !Object.prototype.hasOwnProperty.call(node, "order")) {
        return resultFailure("missing-node-placement");
      }

      const payload = {};
      for (const key of Object.keys(node)) {
        if (key === "id" || key === "parentId" || key === "order") continue;
        const value = cloneRequired(node[key]);
        if (!value.ok) return value;
        payload[key] = value.value;
      }
      const parentId = cloneRequired(node.parentId);
      const order = cloneRequired(node.order);
      if (!parentId.ok) return parentId;
      if (!order.ok) return order;

      seenIds.add(nodeId);
      nodeSequence.push(nodeId);
      identities.push({ nodeId });
      placements.push({ nodeId, parentId: parentId.value, order: order.value });
      payloads.push({ nodeId, value: payload });
    }

    return {
      ok: true,
      shadow: {
        schema: SHADOW_SCHEMA,
        source: { schema: document.schema, writtenAt: document.writtenAt },
        nodeSequence,
        identities,
        placements,
        payloads,
        tombstones: document.tombstones,
        rootExtras: document.rootExtras,
        dataExtras: document.dataExtras,
      },
    };
  }

  function mapRecords(records, expectedKeys, duplicateReason) {
    if (!Array.isArray(records)) return resultFailure("invalid-shadow-record-set");
    const mapped = new Map();
    for (const record of records) {
      if (!hasExactKeys(record, expectedKeys) || typeof record.nodeId !== "string" || !record.nodeId) {
        return resultFailure("invalid-shadow-record");
      }
      if (mapped.has(record.nodeId)) return resultFailure(duplicateReason);
      const cloned = cloneRequired(record);
      if (!cloned.ok) return cloned;
      mapped.set(record.nodeId, cloned.value);
    }
    return { ok: true, value: mapped };
  }

  function decode(shadow) {
    if (!hasExactKeys(shadow, SHADOW_KEYS) || shadow.schema !== SHADOW_SCHEMA
        || !hasExactKeys(shadow.source, ["schema", "writtenAt"])
        || typeof shadow.source.schema !== "string" || typeof shadow.source.writtenAt !== "string") {
      return resultFailure("invalid-shadow");
    }
    const safeShadow = cloneRequired(shadow);
    if (!safeShadow.ok) return safeShadow;
    const value = safeShadow.value;
    if (!Array.isArray(value.nodeSequence)) return resultFailure("invalid-node-sequence");

    const identities = mapRecords(value.identities, ["nodeId"], "duplicate-identity");
    const placements = mapRecords(value.placements, ["nodeId", "parentId", "order"], "duplicate-placement");
    const payloads = mapRecords(value.payloads, ["nodeId", "value"], "duplicate-payload");
    if (!identities.ok) return identities;
    if (!placements.ok) return placements;
    if (!payloads.ok) return payloads;

    const sequence = new Set();
    for (const nodeId of value.nodeSequence) {
      if (typeof nodeId !== "string" || !nodeId || sequence.has(nodeId)) {
        return resultFailure("invalid-node-sequence");
      }
      sequence.add(nodeId);
    }
    if (sequence.size !== identities.value.size || sequence.size !== placements.value.size || sequence.size !== payloads.value.size) {
      return resultFailure("shadow-membership-mismatch");
    }

    const nodes = [];
    for (const nodeId of value.nodeSequence) {
      const identity = identities.value.get(nodeId);
      const placement = placements.value.get(nodeId);
      const payload = payloads.value.get(nodeId);
      if (!identity || !placement || !payload) return resultFailure("shadow-membership-mismatch");
      if (!isPlainObject(payload.value)
          || Object.prototype.hasOwnProperty.call(payload.value, "id")
          || Object.prototype.hasOwnProperty.call(payload.value, "parentId")
          || Object.prototype.hasOwnProperty.call(payload.value, "order")) {
        return resultFailure("invalid-node-payload");
      }
      nodes.push({
        id: identity.nodeId,
        parentId: placement.parentId,
        order: placement.order,
        ...payload.value,
      });
    }

    return {
      ok: true,
      norm: {
        schema: value.source.schema,
        writtenAt: value.source.writtenAt,
        nodes,
        tombstones: value.tombstones,
        rootExtras: value.rootExtras,
        dataExtras: value.dataExtras,
      },
    };
  }

  global.PocketStarlingShadow = Object.freeze({
    SHADOW_SCHEMA,
    encode,
    decode,
  });
})(typeof window !== "undefined" ? window : globalThis);
