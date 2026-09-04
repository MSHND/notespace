/* P172 real-truth Starling cutover and pre-CAS semantic admission. */
(function initialisePocketStarlingRealTruthAdmission(global) {
  "use strict";

  const baseControllerApi = global.PocketSyncOwnerController;
  const baseLogicalEditApi = global.PocketStarlingLogicalEditShadow;
  const baseRemoteEditApi = global.PocketStarlingRemoteEditShadow;
  const basePublicationApi = global.PocketStarlingDurablePublication;
  const logical = global.PocketStarlingObjectSealShadow;
  const bridge = global.PocketStarlingBridgeShadow;
  const placement = global.PocketStarlingPlacementShadow;
  const remote = global.PocketSyncRemoteClient;
  const syncCrypto = global.PocketSyncCrypto;
  if (!baseControllerApi || typeof baseControllerApi.createSyncedOwnerController !== "function"
      || !baseLogicalEditApi || typeof baseLogicalEditApi.compose !== "function"
      || !baseRemoteEditApi || typeof baseRemoteEditApi.createEditor !== "function"
      || !basePublicationApi || typeof basePublicationApi.createCoordinator !== "function"
      || typeof basePublicationApi.validateDescriptor !== "function"
      || !logical || typeof logical.canonical !== "function" || typeof logical.refFor !== "function"
      || !bridge || typeof bridge.encode !== "function"
      || !placement || typeof placement.audit !== "function"
      || !remote || typeof remote.createBrowserJsonTransport !== "function"
      || typeof remote.createPersistenceAuthorityService !== "function"
      || !syncCrypto || typeof syncCrypto.encodeBase64Url !== "function") return;

  const HEAD_SCHEMA = "pocket.starling.head.v1";
  const FINGERPRINT = /^sha256:[A-Za-z0-9_-]{43}$/;
  let activeAdmission = null;
  let serial = Promise.resolve();
  let starlingUndoGuard = false;

  function isObject(value) { return !!value && typeof value === "object" && !Array.isArray(value); }
  function exact(value, fields) {
    return isObject(value) && Object.keys(value).length === fields.length
      && fields.every((field) => Object.prototype.hasOwnProperty.call(value, field));
  }
  function safeHead(value) {
    return isObject(value) && value.schema === HEAD_SCHEMA && Number.isSafeInteger(value.revision)
      && value.revision >= 1 && typeof value.sealRef === "string" && value.sealRef
      ? Object.freeze({ schema: value.schema, revision: value.revision, sealRef: value.sealRef }) : null;
  }
  function sameHead(left, right) {
    return !!left && !!right && left.schema === right.schema
      && left.revision === right.revision && left.sealRef === right.sealRef;
  }
  function currentServiceRoot() {
    const value = global.document?.currentScript?.dataset?.serviceRoot;
    return typeof value === "string" && value.startsWith("/") && !value.startsWith("//")
      && !value.includes("\\") && !value.includes("?") && !value.includes("#") ? value : null;
  }
  function operationId(kind) {
    try {
      const bytes = new Uint8Array(24);
      global.crypto.getRandomValues(bytes);
      return `p172-${kind}-${syncCrypto.encodeBase64Url(bytes)}`;
    } catch (_error) { return null; }
  }

  const serviceRoot = currentServiceRoot();
  let authorityService = null;
  let objectHeadService = null;
  if (serviceRoot) {
    try {
      const transport = remote.createBrowserJsonTransport({ serviceRoot });
      authorityService = remote.createPersistenceAuthorityService({ transport });
      objectHeadService = typeof remote.createObjectHeadService === "function"
        ? remote.createObjectHeadService({ transport }) : null;
    } catch (_error) { authorityService = null; objectHeadService = null; }
  }

  async function readAuthority(syncedPocketId) {
    const id = operationId("authority-read");
    if (!authorityService || typeof syncedPocketId !== "string" || !syncedPocketId || !id) return null;
    try {
      const result = await authorityService.read({ apiVersion: 1, operationId: id, syncedPocketId });
      const value = result?.authority;
      if (!isObject(value) || !Number.isSafeInteger(value.authorityRevision) || value.authorityRevision < 1
          || !["whole-record", "starling"].includes(value.currentMode)) return null;
      return value;
    } catch (_error) { return null; }
  }

  async function readHead(syncedPocketId) {
    const id = operationId("head-read");
    if (!objectHeadService || typeof objectHeadService.readShadowHead !== "function"
        || typeof syncedPocketId !== "string" || !syncedPocketId || !id) return null;
    try {
      const result = await objectHeadService.readShadowHead({ apiVersion: 1, operationId: id, syncedPocketId });
      return safeHead(result?.head);
    } catch (_error) { return null; }
  }

  function canonicalIntended(payload) {
    if (!isObject(payload) || payload.schema !== "portal.export.v1"
        || typeof global.normaliseInput !== "function"
        || typeof global.normaliseRootExtras !== "function") return null;
    try {
      const parsed = global.normaliseInput(payload);
      const dataExtras = global.normaliseRootExtras(isObject(payload.data) ? payload.data : {});
      if (!isObject(parsed) || typeof parsed.schema !== "string" || !parsed.schema
          || typeof parsed.writtenAt !== "string" || !parsed.writtenAt
          || !Array.isArray(parsed.nodes) || !Array.isArray(parsed.tombstones)) return null;
      const document = {
        schema: parsed.schema,
        writtenAt: parsed.writtenAt,
        nodes: parsed.nodes,
        tombstones: parsed.tombstones,
        rootExtras: isObject(parsed.rootExtras) ? parsed.rootExtras : {},
        dataExtras: isObject(dataExtras) ? dataExtras : {},
      };
      const encoded = bridge.encode(document, { capacity: 4 });
      if (!encoded || encoded.ok !== true || !encoded.bridge) return null;
      const relation = placement.audit(encoded.bridge.structural);
      if (!relation || relation.ok !== true || !relation.relation) return null;
      const byId = new Map(document.nodes.map((node) => [node.id, node]));
      if (byId.size !== document.nodes.length) return null;
      const nodes = [], seen = new Set();
      const visit = (parentId) => {
        const children = relation.relation.children[parentId] || [];
        for (let index = 0; index < children.length; index += 1) {
          const nodeId = children[index], node = byId.get(nodeId);
          if (!node || seen.has(nodeId)) return false;
          seen.add(nodeId);
          const nodePayload = {};
          for (const key of Object.keys(node)) {
            if (key !== "id" && key !== "parentId" && key !== "order") nodePayload[key] = node[key];
          }
          nodes.push({ id: nodeId, parentId, order: index, ...nodePayload });
          if (!visit(nodeId)) return false;
        }
        return true;
      };
      if (!visit("root") || seen.size !== document.nodes.length) return null;
      const canonical = logical.canonical({
        schema: document.schema, writtenAt: document.writtenAt, nodes,
        tombstones: document.tombstones, rootExtras: document.rootExtras, dataExtras: document.dataExtras,
      });
      return canonical?.ok === true && typeof canonical.bytes === "string" ? canonical.bytes : null;
    } catch (_error) { return null; }
  }

  async function fingerprint(bytes) {
    if (typeof bytes !== "string" || !global.crypto?.subtle?.digest) return null;
    try {
      const digest = new Uint8Array(await global.crypto.subtle.digest("SHA-256", new TextEncoder().encode(bytes)));
      return `sha256:${syncCrypto.encodeBase64Url(digest)}`;
    } catch (_error) { return null; }
  }

  function sequenceKind(ref) {
    const match = /^proof-ref:v1:(sequence-leaf|sequence-branch):[0-9a-f]{8}$/.exec(ref);
    return match ? match[1] : null;
  }
  function validTrie(value, kind) {
    if (!exact(value, ["schema", "kind", "hasValue", "valueRef", "children"])
        || value.schema !== logical.OBJECT_SCHEMA || value.kind !== kind
        || typeof value.hasValue !== "boolean"
        || !((value.hasValue && typeof value.valueRef === "string") || (!value.hasValue && value.valueRef === null))
        || !Array.isArray(value.children)) return false;
    const seen = new Set();
    for (const edge of value.children) {
      if (!exact(edge, ["key", "ref"]) || typeof edge.key !== "string" || edge.key.length !== 1
          || typeof edge.ref !== "string" || seen.has(edge.key)) return false;
      seen.add(edge.key);
    }
    const keys = value.children.map((edge) => edge.key);
    return keys.every((key, index) => key === keys.slice().sort((a, b) => a.localeCompare(b))[index]);
  }

  async function materializeCandidate(candidate, baseSession) {
    if (!candidate || typeof candidate.sealRef !== "string" || typeof candidate.resolveLogical !== "function"
        || !baseSession || typeof baseSession.resolveLogical !== "function") return null;
    const cache = new Map();
    async function load(ref, kind) {
      if (cache.has(ref)) {
        const found = cache.get(ref);
        return found.kind === kind ? found.object : null;
      }
      let bytes = candidate.resolveLogical(ref);
      if (typeof bytes !== "string") {
        try { bytes = await baseSession.resolveLogical(ref); } catch (_error) { return null; }
      }
      if (typeof bytes !== "string" || logical.refFor(kind, bytes) !== ref) return null;
      let object;
      try { object = JSON.parse(bytes); } catch (_error) { return null; }
      const canonical = logical.canonical(object);
      if (!canonical?.ok || canonical.bytes !== bytes) return null;
      cache.set(ref, { kind, object });
      return object;
    }
    async function trieValue(rootRef, kind, key) {
      if (typeof key !== "string" || !key) return null;
      let ref = rootRef;
      for (let offset = 0; ; offset += 1) {
        const object = await load(ref, kind);
        if (!object || !validTrie(object, kind)) return null;
        if (offset === key.length) return object.hasValue ? { found: true, ref: object.valueRef } : { found: false };
        const edge = object.children.find((item) => item.key === key[offset]);
        if (!edge) return { found: false };
        ref = edge.ref;
      }
    }
    async function sequenceItems(ref, capacity) {
      const seen = new Set();
      async function walk(current, isRoot) {
        if (seen.has(current)) return null;
        seen.add(current);
        const kind = sequenceKind(current);
        if (!kind) return null;
        const value = await load(current, kind);
        if (!value || value.schema !== logical.SEQUENCE_SCHEMA || value.kind !== kind
            || value.capacity !== capacity || !Number.isSafeInteger(value.count) || value.count < 0) return null;
        if (kind === "sequence-leaf") {
          if (!exact(value, ["schema", "kind", "capacity", "count", "items"])
              || !Array.isArray(value.items) || value.items.length !== value.count
              || value.items.length > capacity || (!isRoot && value.items.length < Math.ceil(capacity / 2))
              || value.items.some((item) => typeof item !== "string" || !item)) return null;
          return value.items.slice();
        }
        if (!exact(value, ["schema", "kind", "capacity", "count", "childRefs"])
            || !Array.isArray(value.childRefs) || value.childRefs.length < (isRoot ? 2 : Math.ceil(capacity / 2))
            || value.childRefs.length > capacity || value.childRefs.some((item) => typeof item !== "string")) return null;
        const output = [];
        for (const childRef of value.childRefs) {
          const child = await walk(childRef, false);
          if (!child) return null;
          output.push(...child);
        }
        return output.length === value.count ? output : null;
      }
      return walk(ref, true);
    }
    async function record(rootRef, trieKind, recordKind, nodeId) {
      const located = await trieValue(rootRef, trieKind, nodeId);
      if (!located?.found) return null;
      return load(located.ref, recordKind);
    }
    try {
      const seal = await load(candidate.sealRef, "candidate-seal");
      if (!seal || !exact(seal, ["schema", "kind", "rootRef", "previousSealRef"])
          || seal.schema !== logical.SEAL_SCHEMA || seal.kind !== "candidate-seal") return null;
      const root = await load(seal.rootRef, "pocket-root");
      if (!root || !exact(root, ["schema", "kind", "capacity", "contentRef", "placementRef", "childrenRef", "preservationRef"])
          || root.schema !== logical.ROOT_SCHEMA || root.kind !== "pocket-root"
          || !Number.isSafeInteger(root.capacity) || root.capacity < 3) return null;
      const preservation = await load(root.preservationRef, "preservation");
      if (!preservation || !exact(preservation, ["schema", "kind", "value"])
          || preservation.schema !== logical.OBJECT_SCHEMA || preservation.kind !== "preservation") return null;
      const owner = preservation.value;
      if (!exact(owner, ["source", "tombstones", "rootExtras", "dataExtras"])
          || !exact(owner.source, ["schema", "writtenAt"])
          || typeof owner.source.schema !== "string" || typeof owner.source.writtenAt !== "string"
          || !Array.isArray(owner.tombstones) || !isObject(owner.rootExtras) || !isObject(owner.dataExtras)) return null;
      const nodes = [], seen = new Set();
      async function visit(parentId) {
        const located = await trieValue(root.childrenRef, "children-trie", parentId);
        if (!located) return false;
        if (!located.found) return true;
        const children = await sequenceItems(located.ref, root.capacity);
        if (!children) return false;
        for (let index = 0; index < children.length; index += 1) {
          const nodeId = children[index];
          if (seen.has(nodeId)) return false;
          seen.add(nodeId);
          const place = await record(root.placementRef, "placement-trie", "placement-record", nodeId);
          const content = await record(root.contentRef, "content-trie", "content-record", nodeId);
          if (!place || !exact(place, ["schema", "kind", "nodeId", "parentId"])
              || place.schema !== logical.OBJECT_SCHEMA || place.kind !== "placement-record"
              || place.nodeId !== nodeId || place.parentId !== parentId
              || !content || !exact(content, ["schema", "kind", "nodeId", "payload"])
              || content.schema !== logical.OBJECT_SCHEMA || content.kind !== "content-record"
              || content.nodeId !== nodeId || !isObject(content.payload)
              || ["id", "parentId", "order"].some((key) => Object.prototype.hasOwnProperty.call(content.payload, key))) return false;
          nodes.push({ id: nodeId, parentId, order: index, ...content.payload });
          if (!await visit(nodeId)) return false;
        }
        return true;
      }
      if (!await visit("root")) return null;
      const canonical = logical.canonical({
        schema: owner.source.schema, writtenAt: owner.source.writtenAt, nodes,
        tombstones: owner.tombstones, rootExtras: owner.rootExtras, dataExtras: owner.dataExtras,
      });
      return canonical?.ok === true && typeof canonical.bytes === "string" ? canonical.bytes : null;
    } catch (_error) { return null; }
  }

  global.PocketStarlingLogicalEditShadow = Object.freeze({
    ...baseLogicalEditApi,
    async compose(...args) {
      const result = await baseLogicalEditApi.compose(...args);
      if (activeAdmission && result?.ok === true && result.changed === true && result.candidate) {
        activeAdmission.candidate = result.candidate;
      }
      return result;
    },
  });

  global.PocketStarlingRemoteEditShadow = Object.freeze({
    ...baseRemoteEditApi,
    async createEditor(input) {
      if (activeAdmission && input?.opened?.session) {
        activeAdmission.baseSession = input.opened.session;
        activeAdmission.expectedHead = safeHead(input.opened.head);
      }
      const editor = await baseRemoteEditApi.createEditor(input);
      if (!editor || typeof editor.prepareWorkingSet !== "function") return editor;
      return Object.freeze({
        ...editor,
        async prepareWorkingSet(...args) {
          if (activeAdmission) activeAdmission.candidate = null;
          const prepared = await editor.prepareWorkingSet(...args);
          if (!activeAdmission || prepared?.outcome !== "prepared") return prepared;
          const bytes = await materializeCandidate(activeAdmission.candidate, activeAdmission.baseSession);
          if (!bytes || bytes !== activeAdmission.expectedBytes) {
            return Object.freeze({ outcome: "admission-rejected", reason: "semantic-equivalence-mismatch" });
          }
          const semanticFingerprint = await fingerprint(bytes);
          if (!semanticFingerprint || semanticFingerprint !== activeAdmission.expectedFingerprint) {
            return Object.freeze({ outcome: "admission-rejected", reason: "semantic-equivalence-mismatch" });
          }
          const result = { ...prepared };
          if (Array.isArray(prepared.p170DeleteRetentions)) {
            Object.defineProperty(result, "p170DeleteRetentions", {
              value: prepared.p170DeleteRetentions, enumerable: false, configurable: false, writable: false,
            });
          }
          Object.defineProperty(result, "p172SemanticFingerprint", {
            value: semanticFingerprint, enumerable: false, configurable: false, writable: false,
          });
          return Object.freeze(result);
        },
      });
    },
  });

  function legacyDescriptor(input) {
    if (!isObject(input)) return input;
    return {
      schema: input.schema,
      syncedPocketId: input.syncedPocketId,
      expectedHead: input.expectedHead,
      candidateSealStorageRef: input.candidateSealStorageRef,
      newRecords: input.newRecords,
    };
  }

  function validateExtendedDescriptor(input) {
    const hasSemantic = isObject(input) && Object.prototype.hasOwnProperty.call(input, "semanticFingerprint");
    if (hasSemantic && (!FINGERPRINT.test(input.semanticFingerprint)
        || Object.keys(input).length !== 6)) throw new Error("P172 durable descriptor invalid.");
    const checked = basePublicationApi.validateDescriptor(hasSemantic ? legacyDescriptor(input) : input);
    return hasSemantic ? Object.freeze({ ...checked, semanticFingerprint: input.semanticFingerprint }) : checked;
  }

  function descriptorFromPrepared(prepared) {
    const checked = basePublicationApi.descriptorFromPrepared(prepared);
    const semanticFingerprint = prepared?.p172SemanticFingerprint;
    return FINGERPRINT.test(semanticFingerprint || "")
      ? Object.freeze({ ...checked, semanticFingerprint }) : checked;
  }

  global.PocketStarlingDurablePublication = Object.freeze({
    ...basePublicationApi,
    validateDescriptor: validateExtendedDescriptor,
    descriptorFromPrepared,
    createCoordinator(input) {
      const coordinator = basePublicationApi.createCoordinator(input);
      if (!coordinator || typeof coordinator.attemptHead !== "function") return coordinator;
      return Object.freeze({
        ...coordinator,
        async ensureObjects(descriptorInput) {
          const descriptor = validateExtendedDescriptor(descriptorInput);
          return coordinator.ensureObjects(legacyDescriptor(descriptor));
        },
        async attemptHead(descriptorInput, expectedAuthorityRevision = null) {
          const descriptor = validateExtendedDescriptor(descriptorInput);
          if (expectedAuthorityRevision !== null) {
            if (!activeAdmission || !FINGERPRINT.test(descriptor.semanticFingerprint || "")
                || descriptor.semanticFingerprint !== activeAdmission.expectedFingerprint
                || !sameHead(descriptor.expectedHead, activeAdmission.expectedHead)) {
              const error = new Error("P172 semantic admission rejected.");
              error.code = "starling-semantic-admission-rejected";
              throw error;
            }
          }
          return coordinator.attemptHead(legacyDescriptor(descriptor), expectedAuthorityRevision);
        },
        async reconcile(inputValue) {
          const descriptor = validateExtendedDescriptor(inputValue?.descriptor);
          return coordinator.reconcile({ ...inputValue, descriptor: legacyDescriptor(descriptor) });
        },
      });
    },
  });

  function controllerSessionId(controller) {
    try {
      const session = controller.captureSyncedOwnerSaveSession?.();
      return session && typeof session.syncedPocketId === "string" ? session.syncedPocketId : null;
    } catch (_error) { return null; }
  }
  async function refreshUndoGuard(controller) {
    const syncedPocketId = controllerSessionId(controller);
    if (!syncedPocketId) { starlingUndoGuard = false; return null; }
    const authority = await readAuthority(syncedPocketId);
    if (authority) starlingUndoGuard = authority.currentMode === "starling" && authority.transition === null;
    return authority;
  }

  function wrapController(controller) {
    async function adoptAndRefresh(method, args) {
      const result = await controller[method](...args);
      if (result?.ok === true) await refreshUndoGuard(controller);
      return result;
    }
    async function saveSyncedOwner(input) {
      if (!input || typeof input.freezePayload !== "function") return controller.saveSyncedOwner(input);
      const run = async () => {
        let frozenPayload = null, frozen = false;
        const once = async () => {
          if (!frozen) { frozenPayload = await input.freezePayload(); frozen = true; }
          return frozenPayload;
        };
        let payload;
        try { payload = await once(); } catch (_error) { return controller.saveSyncedOwner({ freezePayload: once }); }
        const expectedBytes = canonicalIntended(payload);
        const expectedFingerprint = expectedBytes && await fingerprint(expectedBytes);
        if (!expectedBytes || !expectedFingerprint) return controller.saveSyncedOwner({ freezePayload: once });
        const syncedPocketId = controllerSessionId(controller);
        const authority = syncedPocketId ? await readAuthority(syncedPocketId) : null;
        if (authority?.currentMode === "whole-record" && authority.transition === null
            && typeof controller.getStarlingBootstrapState === "function"
            && typeof controller.bootstrapInitialStarlingBase === "function") {
          let ready = null;
          try { ready = controller.getStarlingBootstrapState(); } catch (_error) { ready = null; }
          if (!ready) {
            try { await controller.bootstrapInitialStarlingBase(); } catch (_error) {}
          }
        }
        const context = {
          expectedBytes, expectedFingerprint, expectedHead: syncedPocketId ? await readHead(syncedPocketId) : null,
          candidate: null, baseSession: null,
        };
        activeAdmission = context;
        try { return await controller.saveSyncedOwner({ freezePayload: once }); }
        finally {
          activeAdmission = null;
          await refreshUndoGuard(controller);
        }
      };
      const prior = serial;
      let release;
      serial = new Promise((resolve) => { release = resolve; });
      await prior;
      try { return await run(); } finally { release(); }
    }
    return Object.freeze({
      ...controller,
      saveSyncedOwner,
      ...(typeof controller.adoptSyncedOwner === "function" ? {
        adoptSyncedOwner: (...args) => adoptAndRefresh("adoptSyncedOwner", args),
      } : {}),
      ...(typeof controller.adoptReadyActivation === "function" ? {
        adoptReadyActivation: (...args) => adoptAndRefresh("adoptReadyActivation", args),
      } : {}),
      ...(typeof controller.adoptReadyRecovery === "function" ? {
        adoptReadyRecovery: (...args) => adoptAndRefresh("adoptReadyRecovery", args),
      } : {}),
      ...(typeof controller.releaseSyncedOwner === "function" ? {
        releaseSyncedOwner(...args) { starlingUndoGuard = false; return controller.releaseSyncedOwner(...args); },
      } : {}),
    });
  }

  global.PocketSyncOwnerController = Object.freeze({
    ...baseControllerApi,
    createSyncedOwnerController(configuration) {
      return wrapController(baseControllerApi.createSyncedOwnerController(configuration));
    },
  });

  function exactImmediateInsertCancellation(snapshot) {
    const witness = snapshot?.kind === "add" ? snapshot.p153InsertUndoWitness : null;
    if (!witness || witness.forwardSemanticCaptured !== true
        || !Number.isSafeInteger(witness.operationSequence) || witness.operationSequence < 1
        || typeof witness.nodeId !== "string" || !witness.nodeId) return false;
    try {
      if (typeof state === "undefined" || state.operationHighWater !== witness.operationSequence
          || Number(state.activeSaveOperationCeiling) >= witness.operationSequence
          || !Array.isArray(state.ops)
          || !state.ops.some((operation) => operation?.seq === witness.operationSequence)
          || typeof nodeMap !== "function" || !nodeMap().has(witness.nodeId)
          || typeof freezePocketStarlingOwnerWorkingSetThrough !== "function") return false;
      const frozen = freezePocketStarlingOwnerWorkingSetThrough(witness.operationSequence);
      return !!frozen && Array.isArray(frozen.operations)
        && frozen.operations.some((operation) => operation?.type === "insert"
          && operation.input?.nodeId === witness.nodeId);
    } catch (_error) { return false; }
  }

  const originalUndoEdit = global.undoLastEditAction;
  if (typeof originalUndoEdit === "function") {
    global.undoLastEditAction = function p172GuardedUndoEdit(...args) {
      if (starlingUndoGuard) {
        let snapshot = null;
        try { snapshot = lastEditUndoSnapshot; } catch (_error) { snapshot = null; }
        if (snapshot?.kind === "add" && !exactImmediateInsertCancellation(snapshot)) {
          try { global.setStatus?.("Undo is unavailable after this Insert has become Synced truth.", "warn"); } catch (_error) {}
          return false;
        }
      }
      return originalUndoEdit.apply(this, args);
    };
  }

  const originalUndoDelete = global.undoLastDeleteAction;
  if (typeof originalUndoDelete === "function") {
    global.undoLastDeleteAction = function p172GuardedUndoDelete(...args) {
      if (starlingUndoGuard) {
        let snapshot = null;
        try { snapshot = lastDeleteUndoSnapshot; } catch (_error) { snapshot = null; }
        if (snapshot?.kind === "delete" && !snapshot.p155DeleteUndoWitness) {
          try { global.setStatus?.("Bulk Delete undo is unavailable after Starling authority.", "warn"); } catch (_error) {}
          return false;
        }
      }
      return originalUndoDelete.apply(this, args);
    };
  }

  global.PocketStarlingRealTruthAdmission = Object.freeze({
    isStarlingUndoGuardActive: () => starlingUndoGuard === true,
  });
})(typeof window !== "undefined" ? window : globalThis);
