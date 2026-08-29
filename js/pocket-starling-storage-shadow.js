/* Dormant P112 encrypted storage-graph experiment. Public material is limited
   to P111 opaque records and refs; logical bindings exist only in capsules. */
(function (global) {
  "use strict";

  const CAPSULE_SCHEMA = "pocket.starling.storage-capsule.v1",
    CAPSULE_FIELDS = Object.freeze([
      "schema",
      "logicalKind",
      "logicalRef",
      "logicalBytes",
      "links",
    ]),
    LINK_FIELDS = Object.freeze(["logicalRef", "storageRef"]),
    stageProofs = new WeakMap();

  function storageError(code) {
    const error = new Error(`Pocket Starling storage ${code}.`);
    error.code = code;
    return error;
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

  function dependencies() {
    const logical = global.PocketStarlingObjectSealShadow,
      crypto = global.PocketStarlingCryptoShadow,
      sync = global.PocketSyncCrypto;
    if (
      !logical ||
      !crypto ||
      !sync ||
      typeof logical.canonical !== "function" ||
      typeof logical.refFor !== "function" ||
      typeof crypto.sealObject !== "function" ||
      typeof crypto.openObject !== "function"
    )
      throw storageError("dependency-unavailable");
    return { logical, crypto, sync };
  }

  function logicalRef(value) {
    return (
      typeof value === "string" &&
      /^proof-ref:v1:[^:]+:[0-9a-f]{8}$/.test(value)
    );
  }

  function storageRef(value, crypto) {
    return (
      typeof value === "string" &&
      value.startsWith(crypto.REFERENCE_PREFIX) &&
      /^[A-Za-z0-9_-]{43}$/.test(value.slice(crypto.REFERENCE_PREFIX.length))
    );
  }

  function requireRefs(values) {
    if (!values.every(logicalRef)) throw storageError("logical-object-invalid");
    return Array.from(new Set(values)).sort((a, b) => a.localeCompare(b));
  }

  function describeLogical(logicalKind, logicalBytes) {
    const { logical } = dependencies();
    if (typeof logicalKind !== "string" || typeof logicalBytes !== "string")
      throw storageError("logical-object-invalid");
    let object;
    try {
      object = JSON.parse(logicalBytes);
    } catch (_error) {
      throw storageError("logical-object-invalid");
    }
    const canonical = logical.canonical(object);
    if (
      !canonical.ok ||
      canonical.bytes !== logicalBytes ||
      object.kind !== logicalKind
    )
      throw storageError("logical-object-invalid");
    let refs = [];
    if (logicalKind === "candidate-seal") {
      if (
        !exact(object, ["schema", "kind", "rootRef", "previousSealRef"]) ||
        object.schema !== logical.SEAL_SCHEMA ||
        !logicalRef(object.rootRef) ||
        !(object.previousSealRef === null || logicalRef(object.previousSealRef))
      )
        throw storageError("logical-object-invalid");
      refs = [object.rootRef];
      if (object.previousSealRef !== null) refs.push(object.previousSealRef);
    } else if (logicalKind === "pocket-root") {
      const fields = [
        "schema",
        "kind",
        "capacity",
        "contentRef",
        "placementRef",
        "childrenRef",
        "preservationRef",
      ];
      if (
        !exact(object, fields) ||
        object.schema !== logical.ROOT_SCHEMA ||
        !Number.isInteger(object.capacity) ||
        object.capacity < 2
      )
        throw storageError("logical-object-invalid");
      refs = [
        object.contentRef,
        object.placementRef,
        object.childrenRef,
        object.preservationRef,
      ];
    } else if (
      ["content-trie", "placement-trie", "children-trie"].includes(logicalKind)
    ) {
      const keys = Array.isArray(object.children)
        ? object.children.map((edge) => edge && edge.key)
        : [];
      if (
        !exact(object, [
          "schema",
          "kind",
          "hasValue",
          "valueRef",
          "children",
        ]) ||
        object.schema !== logical.OBJECT_SCHEMA ||
        typeof object.hasValue !== "boolean" ||
        !Array.isArray(object.children) ||
        !object.children.every(
          (edge) =>
            exact(edge, ["key", "ref"]) &&
            typeof edge.key === "string" &&
            edge.key.length === 1 &&
            logicalRef(edge.ref),
        ) ||
        new Set(keys).size !== keys.length ||
        keys.some(
          (key, index) =>
            key !== keys.slice().sort((a, b) => a.localeCompare(b))[index],
        ) ||
        !(
          (object.hasValue && logicalRef(object.valueRef)) ||
          (!object.hasValue && object.valueRef === null)
        )
      )
        throw storageError("logical-object-invalid");
      refs = object.children.map((edge) => edge.ref);
      if (object.hasValue) refs.push(object.valueRef);
    } else if (logicalKind === "sequence-branch") {
      if (
        !exact(object, ["schema", "kind", "capacity", "count", "childRefs"]) ||
        object.schema !== logical.OBJECT_SCHEMA ||
        !Number.isInteger(object.capacity) ||
        object.capacity < 2 ||
        !Number.isInteger(object.count) ||
        object.count < 0 ||
        !Array.isArray(object.childRefs) ||
        object.childRefs.length < 1 ||
        object.childRefs.length > object.capacity ||
        object.count < object.childRefs.length
      )
        throw storageError("logical-object-invalid");
      refs = object.childRefs;
    } else if (logicalKind === "sequence-leaf") {
      if (
        !exact(object, ["schema", "kind", "capacity", "count", "items"]) ||
        object.schema !== logical.OBJECT_SCHEMA ||
        !Number.isInteger(object.capacity) ||
        object.capacity < 2 ||
        !Number.isInteger(object.count) ||
        object.count < 0 ||
        object.count !== object.items?.length ||
        !Array.isArray(object.items) ||
        object.items.length > object.capacity ||
        !object.items.every((item) => typeof item === "string")
      )
        throw storageError("logical-object-invalid");
    } else if (logicalKind === "content-record") {
      if (
        !exact(object, ["schema", "kind", "nodeId", "payload"]) ||
        object.schema !== logical.OBJECT_SCHEMA ||
        typeof object.nodeId !== "string" ||
        object.nodeId.length === 0
      )
        throw storageError("logical-object-invalid");
    } else if (logicalKind === "placement-record") {
      if (
        !exact(object, ["schema", "kind", "nodeId", "parentId"]) ||
        object.schema !== logical.OBJECT_SCHEMA ||
        typeof object.nodeId !== "string" ||
        object.nodeId.length === 0 ||
        typeof object.parentId !== "string" ||
        object.parentId.length === 0
      )
        throw storageError("logical-object-invalid");
    } else if (logicalKind === "preservation") {
      if (
        !exact(object, ["schema", "kind", "value"]) ||
        object.schema !== logical.OBJECT_SCHEMA
      )
        throw storageError("logical-object-invalid");
    } else throw storageError("logical-kind-unsupported");
    return Object.freeze({
      object,
      directRefs: Object.freeze(requireRefs(refs)),
      logicalRef: logical.refFor(logicalKind, logicalBytes),
    });
  }

  function canonicalCapsule(value) {
    const result = dependencies().logical.canonical(value);
    if (!result.ok) throw storageError("capsule-invalid");
    return result.bytes;
  }

  function validateCapsuleBytes(bytes) {
    const { crypto } = dependencies();
    if (typeof bytes !== "string") throw storageError("capsule-invalid");
    let capsule;
    try {
      capsule = JSON.parse(bytes);
    } catch (_error) {
      throw storageError("capsule-invalid");
    }
    if (
      !exact(capsule, CAPSULE_FIELDS) ||
      capsule.schema !== CAPSULE_SCHEMA ||
      canonicalCapsule(capsule) !== bytes ||
      !Array.isArray(capsule.links)
    )
      throw storageError("capsule-invalid");
    const described = describeLogical(
      capsule.logicalKind,
      capsule.logicalBytes,
    );
    if (capsule.logicalRef !== described.logicalRef)
      throw storageError("capsule-logical-mismatch");
    const links = [],
      seen = new Set();
    for (const link of capsule.links) {
      if (
        !exact(link, LINK_FIELDS) ||
        !logicalRef(link.logicalRef) ||
        !storageRef(link.storageRef, crypto) ||
        seen.has(link.logicalRef)
      )
        throw storageError("capsule-links-invalid");
      seen.add(link.logicalRef);
      links.push(
        Object.freeze({
          logicalRef: link.logicalRef,
          storageRef: link.storageRef,
        }),
      );
    }
    const listed = links.map((link) => link.logicalRef),
      sorted = listed.slice().sort((a, b) => a.localeCompare(b));
    if (
      listed.some((ref, index) => ref !== sorted[index]) ||
      listed.length !== described.directRefs.length ||
      listed.some((ref, index) => ref !== described.directRefs[index])
    )
      throw storageError("capsule-links-invalid");
    return Object.freeze({
      schema: CAPSULE_SCHEMA,
      logicalKind: capsule.logicalKind,
      logicalRef: capsule.logicalRef,
      logicalBytes: capsule.logicalBytes,
      links: Object.freeze(links),
      directRefs: described.directRefs,
      object: described.object,
    });
  }

  function capsuleBytes(logicalKind, logicalRefValue, logicalBytes, links) {
    return canonicalCapsule({
      schema: CAPSULE_SCHEMA,
      logicalKind,
      logicalRef: logicalRefValue,
      logicalBytes,
      links,
    });
  }

  async function stageCandidate(input) {
    const { crypto, sync } = dependencies();
    if (
      !input ||
      typeof input !== "object" ||
      typeof input.sealRef !== "string" ||
      typeof input.resolveLogical !== "function"
    )
      throw storageError("stage-input-invalid");
    const key = sync.validateNonExtractableAesKey(input.masterKey),
      context = crypto.validateContext(input.context),
      base =
        input.baseStage === undefined || input.baseStage === null
          ? null
          : stageProofs.get(input.baseStage);
    if (input.baseStage && !base) throw storageError("base-stage-invalid");
    if (
      base &&
      (base.masterKey !== key || base.syncedPocketId !== context.syncedPocketId)
    )
      throw storageError("base-stage-mismatch");
    const entries = new Map(),
      visiting = new Set(),
      diagnostics = { newEncryptions: 0, exactReuseHits: 0 };

    function includeBase(ref) {
      const entry = base && base.entries.get(ref);
      if (!entry) return false;
      function include(value) {
        if (entries.has(value.logicalRef)) return;
        entries.set(value.logicalRef, value);
        diagnostics.exactReuseHits += 1;
        for (const link of value.links)
          include(base.entries.get(link.logicalRef));
      }
      include(entry);
      return true;
    }

    async function visit(ref) {
      if (entries.has(ref) || includeBase(ref)) return entries.get(ref);
      if (!logicalRef(ref) || visiting.has(ref))
        throw storageError("logical-cycle");
      visiting.add(ref);
      let bytes;
      try {
        bytes = input.resolveLogical(ref);
      } catch (_error) {
        throw storageError("logical-resolution-failed");
      }
      const kindMatch = /^proof-ref:v1:([^:]+):/.exec(ref),
        kind = kindMatch && kindMatch[1],
        described = describeLogical(kind, bytes);
      if (described.logicalRef !== ref)
        throw storageError("logical-ref-mismatch");
      const links = [];
      for (const childRef of described.directRefs) {
        const child = await visit(childRef);
        links.push(
          Object.freeze({
            logicalRef: childRef,
            storageRef: child.storageRef,
          }),
        );
      }
      const plaintext = capsuleBytes(kind, ref, bytes, links),
        sealed = await crypto.sealObject(plaintext, key, context),
        entry = Object.freeze({
          logicalRef: ref,
          logicalKind: kind,
          logicalBytes: bytes,
          storageRef: sealed.ref,
          record: sealed.record,
          links: Object.freeze(links),
        });
      entries.set(ref, entry);
      visiting.delete(ref);
      diagnostics.newEncryptions += 1;
      return entry;
    }

    const seal = await visit(input.sealRef);
    if (seal.logicalKind !== "candidate-seal")
      throw storageError("candidate-seal-required");
    const previousSealRef = JSON.parse(seal.logicalBytes).previousSealRef;
    if (previousSealRef !== (base ? base.sealLogicalRef : null))
      throw storageError("candidate-lineage-mismatch");
    const records = Object.freeze(
        Array.from(entries.values())
          .map((entry) =>
            Object.freeze({
              storageRef: entry.storageRef,
              record: entry.record,
            }),
          )
          .sort((a, b) => a.storageRef.localeCompare(b.storageRef)),
      ),
      stage = Object.freeze({
        sealStorageRef: seal.storageRef,
        records,
        diagnostics: Object.freeze({ ...diagnostics }),
      });
    stageProofs.set(stage, {
      stage,
      entries,
      sealLogicalRef: input.sealRef,
      masterKey: key,
      syncedPocketId: context.syncedPocketId,
    });
    return stage;
  }

  async function createResolver(input) {
    const { crypto, logical, sync } = dependencies();
    if (
      !input ||
      typeof input !== "object" ||
      !storageRef(input.acceptedSealStorageRef, crypto) ||
      typeof input.resolveStorage !== "function"
    )
      throw storageError("resolver-input-invalid");
    const key = sync.validateNonExtractableAesKey(input.masterKey),
      context = crypto.validateContext(input.context),
      bindings = new Map(),
      logicalCache = new Map(),
      storageCache = new Map(),
      stats = { physicalFetches: 0, decryptions: 0, cacheHits: 0 };

    function bind(capsule, physicalRef) {
      const proposals = [
        [capsule.logicalRef, physicalRef],
        ...capsule.links.map((link) => [link.logicalRef, link.storageRef]),
      ];
      for (const [ref, target] of proposals)
        if (bindings.has(ref) && bindings.get(ref) !== target)
          throw storageError("binding-conflict");
      for (const [ref, target] of proposals) bindings.set(ref, target);
    }

    async function loadStorage(physicalRef, expectedLogicalRef = null) {
      if (storageCache.has(physicalRef)) {
        stats.cacheHits += 1;
        const cached = storageCache.get(physicalRef);
        if (expectedLogicalRef && cached.logicalRef !== expectedLogicalRef)
          throw storageError("capsule-logical-mismatch");
        return cached;
      }
      stats.physicalFetches += 1;
      const record = await input.resolveStorage(physicalRef),
        plaintext = await crypto.openObject(record, physicalRef, key, context),
        capsule = validateCapsuleBytes(plaintext);
      stats.decryptions += 1;
      if (expectedLogicalRef && capsule.logicalRef !== expectedLogicalRef)
        throw storageError("capsule-logical-mismatch");
      bind(capsule, physicalRef);
      storageCache.set(physicalRef, capsule);
      logicalCache.set(capsule.logicalRef, capsule.logicalBytes);
      return capsule;
    }

    const accepted = await loadStorage(input.acceptedSealStorageRef);
    if (accepted.logicalKind !== "candidate-seal")
      throw storageError("candidate-seal-required");

    async function resolveLogical(ref) {
      if (logicalCache.has(ref)) {
        stats.cacheHits += 1;
        return logicalCache.get(ref);
      }
      const physicalRef = bindings.get(ref);
      if (!physicalRef) throw storageError("logical-binding-missing");
      return (await loadStorage(physicalRef, ref)).logicalBytes;
    }

    function logicalResolver(ref) {
      return logicalCache.get(ref);
    }

    async function settle(operation) {
      for (;;) {
        const result = operation();
        if (result.ok || result.reason !== "missing-object" || !result.ref)
          return result;
        await resolveLogical(result.ref);
      }
    }

    async function openAccepted() {
      return settle(() =>
        logical.openFromAcceptedSealRef(accepted.logicalRef, logicalResolver),
      );
    }

    return Object.freeze({
      acceptedSealRef: accepted.logicalRef,
      logicalResolver,
      resolveLogical,
      openAccepted,
      readContent: (handle, nodeId) =>
        settle(() => logical.readContent(handle, nodeId)),
      readPlacement: (handle, nodeId) =>
        settle(() => logical.readPlacement(handle, nodeId)),
      diagnostics: () => Object.freeze({ ...stats }),
    });
  }

  global.PocketStarlingStorageShadow = Object.freeze({
    CAPSULE_SCHEMA,
    describeLogical,
    canonicalCapsule,
    validateCapsuleBytes,
    stageCandidate,
    createResolver,
  });
})(typeof window !== "undefined" ? window : globalThis);
