/* Payload building, local safety, cache, startup restore, health/restore helpers. */

const syncedDiscardSafetyTokens = new Map();
let nextSyncedDiscardSafetyToken = 0;

function isPocketVaultStoragePrivate() {
  try {
    return typeof window.isPocketVaultOwnerActive === "function"
      && window.isPocketVaultOwnerActive() === true;
  } catch {
    return true;
  }
}

function pocketBrowserStoragePrivacyMode() {
  try {
    const session = typeof window.capturePocketFileSaveSession === "function"
      ? window.capturePocketFileSaveSession()
      : null;
    if (session?.ownerKind === "synced" || session?.storagePrivacy === "synced") return "synced";
    if (isPocketVaultStoragePrivate()) return "vault";
    return "";
  } catch {
    return "vault";
  }
}

function isPocketBrowserStoragePrivate() {
  return pocketBrowserStoragePrivacyMode() !== "";
}

window.pocketBrowserStoragePrivacyMode = pocketBrowserStoragePrivacyMode;
window.isPocketBrowserStoragePrivate = isPocketBrowserStoragePrivate;

function makeId(prefix = "pl") {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 9)}`;
}

function saveWorkspaceState() {
  if (isPocketBrowserStoragePrivate()) return false;
  try {
    const payload = {
      savedAt: nowIso(),
      source: {
        schema: cleanText(state.source?.schema, 80),
        fileName: cleanText(state.source?.fileName, 120),
        writtenAt: cleanText(state.source?.writtenAt, 40),
      },
      selectedId: cleanText(state.selectedId, 80),
      focusRootId: cleanText(state.focusRootId, 80),
      collapsedIds: Array.from(state.collapsed || new Set()).map((id) => cleanText(id, 80)).filter(Boolean),
    };
    localStorage.setItem(WORKSPACE_STATE_KEY, JSON.stringify(payload));
    return true;
  } catch {
    return false;
  }
}

function restoreWorkspaceState() {
  if (isPocketBrowserStoragePrivate()) return false;
  try {
    const raw = localStorage.getItem(WORKSPACE_STATE_KEY);
    if (!raw) return false;
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return false;
    const ids = new Set(state.nodes.map((node) => cleanText(node?.id, 80)).filter(Boolean));
    const selectedId = cleanText(parsed.selectedId, 80);
    const focusRootId = cleanText(parsed.focusRootId, 80);
    const collapsedIds = Array.isArray(parsed.collapsedIds)
      ? parsed.collapsedIds.map((id) => cleanText(id, 80)).filter((id) => id && ids.has(id))
      : null;

    if (Array.isArray(collapsedIds)) {
      state.collapsed = new Set(collapsedIds);
    }
    if (focusRootId && ids.has(focusRootId)) {
      state.focusRootId = focusRootId;
      state.collapsed.delete(focusRootId);
    }
    if (selectedId && ids.has(selectedId)) {
      state.selectedId = selectedId;
      expandPathToNode(selectedId);
    }
    return Array.isArray(collapsedIds) || !!state.focusRootId || !!state.selectedId;
  } catch {
    return false;
  }
}

function buildCanonicalPocketPayload(norm, options = {}) {
  if (!norm || typeof norm !== "object" || Array.isArray(norm)) return null;
  let treeNodes;
  let treeTombstones;
  let rootExtras;
  let dataExtras;
  let pocketGuard = null;
  try {
    treeNodes = JSON.parse(JSON.stringify(Array.isArray(norm.nodes) ? norm.nodes : []));
    treeTombstones = JSON.parse(JSON.stringify(Array.isArray(norm.tombstones) ? norm.tombstones : []));
    rootExtras = JSON.parse(JSON.stringify(norm.rootExtras || {}));
    dataExtras = JSON.parse(JSON.stringify(norm.dataExtras || {}));
    if (options.pocketGuard && typeof options.pocketGuard === "object") {
      pocketGuard = JSON.parse(JSON.stringify(options.pocketGuard));
    }
  } catch {
    return null;
  }
  const writtenAt = cleanText(options.writtenAt || norm.writtenAt, 40);
  return {
    ...rootExtras,
    ...(pocketGuard ? { pocketGuard } : {}),
    schema: "portal.export.v1",
    exportedAt: writtenAt,
    writtenAt,
    mainThoughtTree: treeNodes,
    mainThoughtTreeTombstones: treeTombstones,
    data: {
      ...dataExtras,
      ...(pocketGuard ? { pocketGuard } : {}),
      mainThoughtTree: treeNodes,
      mainThoughtTreeTombstones: treeTombstones,
    },
  };
}

function buildPocketPayload(writtenAt = nowIso()) {
  const pocketGuard = {
    schema: "pocket.guard.v1",
    instanceId: getPocketInstanceId(),
    sourceFileName: cleanText(state.source?.fileName, 120),
    sourceWrittenAt: cleanText(state.source?.writtenAt, 40),
    backupWrittenAt: writtenAt,
  };
  return buildCanonicalPocketPayload({
    nodes: state.nodes,
    tombstones: state.tombstones,
    rootExtras: state.rootExtras,
    dataExtras: state.dataExtras,
  }, { writtenAt, pocketGuard });
}

function pocketDeviceChangesOwner() {
  const owner = window.PocketDeviceChanges;
  return owner && typeof owner.coerceDocument === "function" ? owner : null;
}

function pocketDocumentSourceLabels(sourceInfo = {}) {
  return {
    schema: cleanText(sourceInfo.schema, 80),
    fileName: cleanText(sourceInfo.fileName, 120),
    writtenAt: cleanText(sourceInfo.writtenAt, 40),
  };
}

function establishPocketDocumentBaseline(input, sourceInfo = {}) {
  const owner = pocketDeviceChangesOwner();
  if (!owner) return false;
  const coerced = owner.coerceDocument(input);
  if (!coerced || !coerced.ok) return false;
  const fingerprint = owner.fingerprintDocument(coerced.document);
  const cloned = owner.cloneJsonCompatible(coerced.document);
  if (!fingerprint || !cloned || !cloned.ok) return false;
  state.documentBaseline = {
    payload: cloned.value,
    fingerprint,
    source: pocketDocumentSourceLabels(sourceInfo),
  };
  state.detachedSafetyBase = null;
  if (typeof resetPocketOperationAnchor === "function") {
    resetPocketOperationAnchor(cloned.value);
  }
  return true;
}

function capturePocketDocumentBaseline() {
  const owner = pocketDeviceChangesOwner();
  const baseline = state.documentBaseline;
  if (!owner || !baseline || typeof baseline !== "object") return null;
  const cloned = owner.cloneJsonCompatible(baseline);
  return cloned && cloned.ok ? cloned.value : null;
}

function normaliseStoredPocketBaseline(value) {
  const owner = pocketDeviceChangesOwner();
  if (!owner || !value || typeof value !== "object" || Array.isArray(value)) return null;
  const payload = value.payload && typeof value.payload === "object" ? value.payload : null;
  const fingerprint = cleanText(value.fingerprint, 120);
  if (!payload || !fingerprint || owner.fingerprintDocument(payload) !== fingerprint) return null;
  const coerced = owner.coerceDocument(payload);
  if (!coerced || !coerced.ok) return null;
  const cloned = owner.cloneJsonCompatible(coerced.document);
  if (!cloned || !cloned.ok) return null;
  return {
    payload: cloned.value,
    fingerprint,
    source: pocketDocumentSourceLabels(value.source || {}),
  };
}

function currentPocketSafetyBaseline() {
  const detached = normaliseStoredPocketBaseline(state.detachedSafetyBase);
  if (state.pocketFile?.detachedDeviceChanges === true) return detached;
  if (detached) return detached;
  return normaliseStoredPocketBaseline(state.documentBaseline);
}

function buildLocalSafetyEntry(reason, capturedAt, options = {}) {
  const source = options.source && typeof options.source === "object"
    ? options.source
    : state.source;
  const ops = Object.prototype.hasOwnProperty.call(options, "ops")
    ? options.ops
    : state.ops;
  const preparedOps = typeof normalisePocketOperations === "function"
    ? normalisePocketOperations(ops, options.operationHighWater || state.operationHighWater)
    : {
        operations: JSON.parse(JSON.stringify(ops || [])),
        highestSequence: 0,
      };
  if (ops === state.ops) state.ops = preparedOps.operations;
  const baseline = options.includeBase === false
    ? null
    : (Object.prototype.hasOwnProperty.call(options, "base")
      ? normaliseStoredPocketBaseline(options.base)
      : currentPocketSafetyBaseline());
  const entry = {
    schema: "pocket.localSafety.v1",
    capturedAt,
    reason: cleanText(reason, 40),
    source: {
      schema: cleanText(source?.schema, 80),
      fileName: cleanText(source?.fileName, 120),
      writtenAt: cleanText(source?.writtenAt, 40),
    },
    selectedId: cleanText(options.selectedId ?? state.selectedId, 80),
    focusRootId: cleanText(options.focusRootId ?? state.focusRootId, 80),
    collapsedIds: Array.from(options.collapsedIds || state.collapsed || new Set()).map((id) => cleanText(id, 80)).filter(Boolean),
    ops: JSON.parse(JSON.stringify(preparedOps.operations || [])),
    operationHighWater: (preparedOps.operations || []).reduce((max, operation) => {
      const sequence = Number(operation?.seq);
      return Number.isSafeInteger(sequence) && sequence > max ? sequence : max;
    }, 0),
    payload: options.payload || buildPocketPayload(capturedAt),
  };
  if (baseline) entry.base = baseline;
  if (options.includeDeviceChanges !== false && typeof capturePocketDeviceChangeSet === "function") {
    const captured = capturePocketDeviceChangeSet(
      capturedAt,
      source,
      baseline,
      preparedOps.operations
    );
    if (captured && typeof captured === "object") entry.deviceChanges = captured;
  }
  return entry;
}

function localSafetyEntryWithoutChangeMetadata(value, options = {}) {
  try {
    const entry = JSON.parse(JSON.stringify(value));
    if (options.keepBase !== true) delete entry.base;
    delete entry.deviceChanges;
    delete entry.operationHighWater;
    entry.ops = (Array.isArray(entry.ops) ? entry.ops : []).map((operation) => {
      if (!operation || typeof operation !== "object" || Array.isArray(operation)) return operation;
      const copy = { ...operation };
      delete copy.change;
      delete copy.changes;
      return copy;
    });
    return entry;
  } catch {
    return null;
  }
}

function isLocalStorageQuotaError(error) {
  if (!error || typeof error !== "object") return false;
  const name = typeof error.name === "string" ? error.name : "";
  const code = Number(error.code);
  return name === "QuotaExceededError"
    || name === "NS_ERROR_DOM_QUOTA_REACHED"
    || code === 22
    || code === 1014;
}

function storeLocalSafetyEntry(entry) {
  if (isPocketBrowserStoragePrivate()) {
    return { ok: false, baseStored: false, deviceChangesStored: false, entry: null };
  }
  const candidates = [];
  const addCandidate = (candidate) => {
    if (!candidate) return;
    const serialised = JSON.stringify(candidate);
    if (candidates.some((item) => item.serialised === serialised)) return;
    candidates.push({ entry: candidate, serialised });
  };
  try {
    addCandidate(JSON.parse(JSON.stringify(entry)));
    if (Object.prototype.hasOwnProperty.call(entry, "base")) {
      const withoutBase = JSON.parse(JSON.stringify(entry));
      delete withoutBase.base;
      addCandidate(withoutBase);
    }
    addCandidate(localSafetyEntryWithoutChangeMetadata(entry, { keepBase: false }));
  } catch {}

  function pruneOneLocalSafetyTrailEntry() {
    let raw;
    try { raw = localStorage.getItem(LOCAL_SAFETY_TRAIL_KEY); } catch { return false; }
    if (raw === null) return false;
    let trail = [];
    try {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) trail = parsed;
    } catch {}
    if (!trail.length) {
      try {
        localStorage.removeItem(LOCAL_SAFETY_TRAIL_KEY);
        return true;
      } catch {
        return false;
      }
    }
    for (let length = trail.length - 1; length >= 0; length -= 1) {
      try {
        localStorage.setItem(LOCAL_SAFETY_TRAIL_KEY, JSON.stringify(trail.slice(0, length)));
        return true;
      } catch {}
    }
    try {
      localStorage.removeItem(LOCAL_SAFETY_TRAIL_KEY);
      return true;
    } catch {
      return false;
    }
  }

  let storedEntry = null;
  for (const candidate of candidates) {
    while (true) {
      try {
        localStorage.setItem(LOCAL_SAFETY_KEY, candidate.serialised);
        storedEntry = candidate.entry;
        break;
      } catch (error) {
        if (!isLocalStorageQuotaError(error)) {
          return { ok: false, baseStored: false, deviceChangesStored: false, entry: null };
        }
        if (!pruneOneLocalSafetyTrailEntry()) break;
      }
    }
    if (storedEntry) break;
  }
  if (!storedEntry) {
    return { ok: false, baseStored: false, deviceChangesStored: false, entry: null };
  }

  let trailStored = appendLocalSafetyTrail(storedEntry);
  if (!trailStored) {
    for (const candidate of candidates) {
      if (candidate.entry === storedEntry) continue;
      if (appendLocalSafetyTrail(candidate.entry)) {
        trailStored = true;
        break;
      }
    }
  }
  return {
    ok: true,
    baseStored: Object.prototype.hasOwnProperty.call(storedEntry, "base"),
    deviceChangesStored: Object.prototype.hasOwnProperty.call(storedEntry, "deviceChanges"),
    entry: storedEntry,
    trailStored,
  };
}

function saveLocalSafetySnapshot(reason = "change") {
  if (pocketBrowserStoragePrivacyMode() === "vault") {
    return window.PocketVaultRecovery?.scheduleCapture?.(reason) === true;
  }
  if (isPocketBrowserStoragePrivate()) return false;
  if (!Array.isArray(state.nodes)) return false;
  const capturedAt = nowIso();
  let entry;
  try {
    entry = buildLocalSafetyEntry(reason, capturedAt, { includeBase: true });
  } catch {
    return false;
  }
  return storeLocalSafetyEntry(entry).ok === true;
}

function saveDetachedPocketSafetySnapshot(documentInput, base, options = {}) {
  if (isPocketBrowserStoragePrivate()) return { ok: false, baseStored: false };
  const owner = pocketDeviceChangesOwner();
  if (!owner) return { ok: false, baseStored: false };
  const coerced = owner.coerceDocument(documentInput);
  if (!coerced || !coerced.ok || !Array.isArray(coerced.document.nodes)) {
    return { ok: false, baseStored: false };
  }
  const capturedAt = cleanText(options.capturedAt, 40) || nowIso();
  let entry;
  try {
    const document = coerced.document;
    const nodes = JSON.parse(JSON.stringify(document.nodes));
    const tombstones = JSON.parse(JSON.stringify(document.tombstones));
    const payload = {
      ...JSON.parse(JSON.stringify(document.rootExtras || {})),
      schema: "portal.export.v1",
      exportedAt: capturedAt,
      writtenAt: capturedAt,
      mainThoughtTree: nodes,
      mainThoughtTreeTombstones: tombstones,
      data: {
        ...JSON.parse(JSON.stringify(document.dataExtras || {})),
        mainThoughtTree: nodes,
        mainThoughtTreeTombstones: tombstones,
      },
    };
    entry = buildLocalSafetyEntry(options.reason || "detached-device-changes", capturedAt, {
      payload,
      source: options.source || {},
      ops: options.ops || [],
      operationHighWater: options.operationHighWater || 0,
      selectedId: options.selectedId || "",
      focusRootId: options.focusRootId || "",
      collapsedIds: options.collapsedIds || [],
      base,
      includeBase: true,
    });
  } catch {
    return { ok: false, baseStored: false };
  }
  return storeLocalSafetyEntry(entry);
}

function normalisePocketSafetyPayload(payload) {
  return normaliseInput(payload);
}

function hasPocketSafetyTree(payload) {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return false;
  return Array.isArray(payload.mainThoughtTree)
    || (
      payload.data
      && typeof payload.data === "object"
      && !Array.isArray(payload.data)
      && Array.isArray(payload.data.mainThoughtTree)
    );
}

function readLocalSafetySnapshot() {
  if (isPocketBrowserStoragePrivate()) return null;
  try {
    const raw = localStorage.getItem(LOCAL_SAFETY_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return null;
    const payload = parsed.payload && typeof parsed.payload === "object" ? parsed.payload : null;
    if (!hasPocketSafetyTree(payload)) return null;
    const norm = normalisePocketSafetyPayload(payload);
    if (!Array.isArray(norm.nodes)) return null;
    const capturedAt = cleanText(parsed.capturedAt || norm.writtenAt, 40);
    const capturedMs = Number.isFinite(Date.parse(capturedAt)) ? Date.parse(capturedAt) : 0;
    if (capturedMs <= 0) return null;
    return {
      parsed,
      norm,
      capturedAt,
      capturedMs,
      base: normaliseStoredPocketBaseline(parsed.base),
      deviceChanges: parsed.deviceChanges && typeof parsed.deviceChanges === "object"
        ? parsed.deviceChanges
        : null,
    };
  } catch {
    return null;
  }
}

function captureJsonSafetyForSyncedDiscard() {
  const session = typeof window.capturePocketFileSaveSession === "function"
    ? window.capturePocketFileSaveSession()
    : null;
  if (session?.ownerKind !== "json" || isPocketBrowserStoragePrivate()) return null;
  const snapshot = readLocalSafetySnapshot();
  if (!snapshot?.parsed) return null;
  let raw;
  let entry;
  try {
    raw = localStorage.getItem(LOCAL_SAFETY_KEY);
    if (!raw) return null;
    entry = JSON.parse(raw);
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) return null;
  } catch {
    return null;
  }
  const tokenId = `pocket-synced-discard-${Date.now().toString(36)}-${(++nextSyncedDiscardSafetyToken).toString(36)}`;
  syncedDiscardSafetyTokens.set(tokenId, { raw, entry });
  return Object.freeze({ schema: "pocket.syncedDiscardSafety.v1", tokenId });
}

function validSyncedDiscardSafetyToken(token) {
  if (!token || typeof token !== "object" || Array.isArray(token)
      || token.schema !== "pocket.syncedDiscardSafety.v1"
      || typeof token.tokenId !== "string" || token.tokenId.length < 1) return null;
  return syncedDiscardSafetyTokens.get(token.tokenId) || null;
}

function releaseJsonSafetyForSyncedDiscard(token) {
  if (!token || typeof token !== "object" || typeof token.tokenId !== "string") return false;
  return syncedDiscardSafetyTokens.delete(token.tokenId);
}

function canUseLocalSafetyTrail(options = {}) {
  if (!isPocketBrowserStoragePrivate()) return true;
  const token = options && typeof options === "object" ? options.syncedDiscardSafetyToken : null;
  return pocketBrowserStoragePrivacyMode() === "synced"
    && !!validSyncedDiscardSafetyToken(token);
}

function hasExactLocalSafetyTrailEntry(entry, options = {}) {
  let expected;
  try { expected = JSON.stringify(entry); } catch { return false; }
  if (!expected) return false;
  return readLocalSafetyTrail(options).some((candidate) => {
    try { return JSON.stringify(candidate.parsed) === expected; } catch { return false; }
  });
}

function retireJsonSafetyForSyncedDiscard(token) {
  const captured = validSyncedDiscardSafetyToken(token);
  if (!captured) return false;
  try {
    const current = localStorage.getItem(LOCAL_SAFETY_KEY);
    if (current !== captured.raw) return false;
    const trailAccess = { syncedDiscardSafetyToken: token };
    if (!hasExactLocalSafetyTrailEntry(captured.entry, trailAccess)) {
      if (!appendLocalSafetyTrail(captured.entry, trailAccess)) return false;
      if (!hasExactLocalSafetyTrailEntry(captured.entry, trailAccess)) return false;
    }
    if (localStorage.getItem(LOCAL_SAFETY_KEY) !== captured.raw) return false;
    localStorage.removeItem(LOCAL_SAFETY_KEY);
    return true;
  } catch {
    return false;
  } finally {
    syncedDiscardSafetyTokens.delete(token.tokenId);
  }
}

function readLocalSafetyTrail(options = {}) {
  if (!canUseLocalSafetyTrail(options)) return [];
  try {
    const raw = localStorage.getItem(LOCAL_SAFETY_TRAIL_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    const arr = Array.isArray(parsed) ? parsed : [];
    const out = [];
    for (const item of arr) {
      if (!item || typeof item !== "object") continue;
      const payload = item.payload && typeof item.payload === "object" ? item.payload : null;
      if (!hasPocketSafetyTree(payload)) continue;
      const norm = normalisePocketSafetyPayload(payload);
      if (!Array.isArray(norm.nodes)) continue;
      const capturedAt = cleanText(item.capturedAt || norm.writtenAt, 40);
      const capturedMs = Number.isFinite(Date.parse(capturedAt)) ? Date.parse(capturedAt) : 0;
      if (capturedMs <= 0) continue;
      out.push({
        parsed: item,
        norm,
        capturedAt,
        capturedMs,
        base: normaliseStoredPocketBaseline(item.base),
        deviceChanges: item.deviceChanges && typeof item.deviceChanges === "object"
          ? item.deviceChanges
          : null,
      });
    }
    out.sort((a, b) => b.capturedMs - a.capturedMs);
    return out.slice(0, LOCAL_SAFETY_TRAIL_MAX);
  } catch {
    return [];
  }
}

function writeLocalSafetyTrail(entries, options = {}) {
  if (!canUseLocalSafetyTrail(options)) return false;
  try {
    const arr = (Array.isArray(entries) ? entries : [])
      .map((entry) => entry && entry.parsed ? entry.parsed : entry)
      .filter((entry) => entry && typeof entry === "object")
      .slice(0, LOCAL_SAFETY_TRAIL_MAX);
    if (!arr.length) {
      localStorage.setItem(LOCAL_SAFETY_TRAIL_KEY, JSON.stringify(arr));
      return true;
    }
    for (let length = arr.length; length >= 1; length -= 1) {
      try {
        localStorage.setItem(LOCAL_SAFETY_TRAIL_KEY, JSON.stringify(arr.slice(0, length)));
        return true;
      } catch {}
    }
    return false;
  } catch {
    return false;
  }
}

function readLastBackupMeta() {
  if (isPocketBrowserStoragePrivate()) return null;
  try {
    const raw = localStorage.getItem(LAST_BACKUP_META_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return null;
    const exportedAt = cleanText(parsed.exportedAt, 40);
    const exportedMs = Number.isFinite(Date.parse(exportedAt)) ? Date.parse(exportedAt) : 0;
    if (exportedMs <= 0) return null;
    const nodeCountRaw = Number(parsed.nodeCount);
    return {
      exportedAt,
      exportedMs,
      label: cleanText(parsed.label, 40) || formatSaveClockLabel(new Date(exportedMs)),
      nodeCount: Number.isFinite(nodeCountRaw) ? Math.max(0, Math.round(nodeCountRaw)) : 0,
      sourceFileName: cleanText(parsed.sourceFileName, 120),
    };
  } catch {
    return null;
  }
}

function writeLastBackupMeta(payload) {
  if (isPocketBrowserStoragePrivate()) return null;
  try {
    const exportedAt = cleanText(payload?.writtenAt || payload?.exportedAt, 40) || nowIso();
    const exportedMs = Number.isFinite(Date.parse(exportedAt)) ? Date.parse(exportedAt) : Date.now();
    const label = formatSaveClockLabel(new Date(exportedMs));
    const nodeCount = Array.isArray(payload?.mainThoughtTree)
      ? payload.mainThoughtTree.length
      : (Array.isArray(state.nodes) ? state.nodes.length : 0);
    const entry = {
      schema: "pocket.lastBackup.meta.v1",
      exportedAt: new Date(exportedMs).toISOString(),
      label,
      nodeCount,
      sourceFileName: cleanText(state.source?.fileName, 120),
    };
    localStorage.setItem(LAST_BACKUP_META_KEY, JSON.stringify(entry));
    return entry;
  } catch {
    return null;
  }
}

function backupProofLabel(meta = readLastBackupMeta()) {
  if (!meta) return "Backup unknown";
  const count = Number(meta.nodeCount) || 0;
  return `Backed up ${meta.label}${count ? ` · ${count} node${count === 1 ? "" : "s"}` : ""}`;
}

function parseDateMs(value) {
  const ms = Date.parse(cleanText(value, 40));
  return Number.isFinite(ms) ? ms : 0;
}

function getPocketInstanceId() {
  try {
    const existing = cleanText(localStorage.getItem(LOCAL_INSTANCE_ID_KEY), 80);
    if (existing) return existing;
    const next = makeId("pocket");
    localStorage.setItem(LOCAL_INSTANCE_ID_KEY, next);
    return next;
  } catch {
    return "pocket_ephemeral";
  }
}

function normaliseGuardMeta(value) {
  if (!value || typeof value !== "object") return null;
  const source = value;
  const backupWrittenAt = cleanText(source.backupWrittenAt || source.writtenAt || source.exportedAt, 40);
  const sourceWrittenAt = cleanText(source.sourceWrittenAt, 40);
  const instanceId = cleanText(source.instanceId, 80);
  const sourceFileName = cleanText(source.sourceFileName, 120);
  if (!backupWrittenAt && !sourceWrittenAt && !instanceId && !sourceFileName) return null;
  return { backupWrittenAt, sourceWrittenAt, instanceId, sourceFileName };
}

function guardMetaFromPayload(payload) {
  if (!payload || typeof payload !== "object") return null;
  return normaliseGuardMeta(payload.pocketGuard)
    || normaliseGuardMeta(payload.data && payload.data.pocketGuard)
    || null;
}

function normaliseSourceFileName(value) {
  return cleanText(value, 120).toLowerCase();
}

function loadedSourceFileName(norm = {}, sourceInfo = {}) {
  const guard = guardMetaFromPayload(norm);
  return cleanText(sourceInfo.fileName || guard?.sourceFileName || norm.sourceFileName, 120);
}

function safetySnapshotSourceFileName(snapshot) {
  const parsed = snapshot && snapshot.parsed && typeof snapshot.parsed === "object" ? snapshot.parsed : {};
  const guard = guardMetaFromPayload(parsed.payload);
  return cleanText(parsed.source?.fileName || guard?.sourceFileName, 120);
}

function sameSourceFileName(left, right) {
  const a = normaliseSourceFileName(left);
  const b = normaliseSourceFileName(right);
  return !!a && !!b && a === b;
}

function assessStaleFileRisk(norm = {}, sourceInfo = {}) {
  const loadedAt = cleanText(sourceInfo.writtenAt || norm.writtenAt, 40);
  const loadedMs = parseDateMs(loadedAt);
  const sourceName = loadedSourceFileName(norm, sourceInfo);
  const latestSafety = readLocalSafetySnapshot();
  const backupMeta = readLastBackupMeta();
  const safetyMs = latestSafety && sameSourceFileName(safetySnapshotSourceFileName(latestSafety), sourceName)
    ? latestSafety.capturedMs
    : 0;
  const backupMs = backupMeta && sameSourceFileName(backupMeta.sourceFileName, sourceName)
    ? backupMeta.exportedMs
    : 0;
  const newerMs = Math.max(safetyMs, backupMs);
  if (newerMs <= 0 || loadedMs <= 0 || newerMs <= loadedMs + 1000) {
    return { active: false, reason: "", loadedAt, newerAt: "" };
  }
  const newerAt = new Date(newerMs).toISOString();
  const reason = safetyMs >= backupMs
    ? "local safety copy is newer than this file"
    : "last backup record is newer than this file";
  return { active: true, reason, loadedAt, newerAt };
}

function updateConflictGuardForLoadedSource(norm = {}, sourceInfo = {}) {
  const risk = assessStaleFileRisk(norm, sourceInfo);
  state.conflictGuard = risk;
  pendingStaleExportConfirmExpiresAt = 0;
  return risk;
}

function clearConflictGuard() {
  state.conflictGuard = { active: false, reason: "", loadedAt: "", newerAt: "" };
  pendingStaleExportConfirmExpiresAt = 0;
}

function conflictGuardLabel() {
  const guard = state.conflictGuard || {};
  if (!guard.active) return "conflict clear";
  return `possible stale file: ${formatAgoLabel(guard.newerAt)} newer copy`;
}

function startupConfidenceText(prefix = "Welcome back") {
  const nodeCount = Array.isArray(state.nodes) ? state.nodes.length : 0;
  const nodeText = `${nodeCount} node${nodeCount === 1 ? "" : "s"}`;
  const guard = state.conflictGuard || {};
  if (guard.active) return `${prefix} · ${nodeText} · check backup`;
  if (hasUnsavedPocketLiteChanges()) return `${prefix} · ${nodeText} · backup needed`;
  const backupMeta = readLastBackupMeta();
  if (backupMeta) return `${prefix} · ${nodeText} · backed up ${backupMeta.label}`;
  return `${prefix} · ${nodeText} · backup unknown`;
}

function startupConfidenceKind() {
  const guard = state.conflictGuard || {};
  return (guard.active || hasUnsavedPocketLiteChanges()) ? "warn" : "ok";
}


function appendLocalSafetyTrail(entry, options = {}) {
  if (!canUseLocalSafetyTrail(options)) return false;
  if (!entry || typeof entry !== "object") return false;
  const capturedAt = cleanText(entry.capturedAt, 40);
  const capturedMs = Number.isFinite(Date.parse(capturedAt)) ? Date.parse(capturedAt) : 0;
  if (capturedMs <= 0) return false;
  try {
    const trail = readLocalSafetyTrail(options);
    const latest = trail[0] || null;
    const latestMs = latest ? latest.capturedMs : 0;
    const compactEntry = safeJsonClone(entry, 900000);
    if (!compactEntry) return false;
    const nextEntry = { parsed: compactEntry, norm: normalisePocketSafetyPayload(compactEntry.payload), capturedAt, capturedMs };
    if (latest && Math.abs(capturedMs - latestMs) < 30000) {
      trail[0] = nextEntry;
    } else {
      trail.unshift(nextEntry);
    }
    return writeLocalSafetyTrail(trail, options);
  } catch {
    return false;
  }
}

function clearLocalSafetySnapshot(options = {}) {
  const storagePrivacy = pocketBrowserStoragePrivacyMode();
  if (storagePrivacy === "synced") return false;
  if (storagePrivacy === "vault" && options.coveredDetachedVaultAdoption !== true) {
    void window.PocketVaultRecovery?.clearActiveVaultRecoveryIfClean?.();
    return true;
  }
  try {
    localStorage.removeItem(LOCAL_SAFETY_KEY);
    return true;
  } catch {
    return false;
  }
}

function localSafetySnapshotMatches(left, right) {
  const owner = pocketDeviceChangesOwner();
  if (!left || !right) return false;
  const leftParsed = left.parsed || left;
  const rightParsed = right.parsed || right;
  if (cleanText(leftParsed?.capturedAt, 40) !== cleanText(rightParsed?.capturedAt, 40)) return false;
  if (owner) return owner.documentsEqual(leftParsed?.payload, rightParsed?.payload);
  try {
    return JSON.stringify(leftParsed?.payload) === JSON.stringify(rightParsed?.payload);
  } catch {
    return false;
  }
}

function buildDetachedPocketAdoptionDocument(snapshot) {
  if (!snapshot || !snapshot.norm) return null;
  const document = {
    nodes: snapshot.norm.nodes,
    tombstones: snapshot.norm.tombstones,
    rootExtras: snapshot.norm.rootExtras,
    dataExtras: snapshot.norm.dataExtras,
  };
  const owner = pocketDeviceChangesOwner();
  const raw = owner && snapshot.parsed?.payload
    ? owner.coerceDocument(snapshot.parsed.payload)
    : null;
  if (raw && raw.ok && raw.ambiguousTreeCopies !== true) {
    document.dataExtras = normaliseRootExtras(raw.document.dataExtras) || {};
  }
  try {
    return JSON.parse(JSON.stringify(document));
  } catch {
    return null;
  }
}

function prepareLocalSafetySnapshotForDetachedAdoption(snapshot) {
  if (!snapshot || !snapshot.norm) return { ok: false, baseStored: false };
  const parsed = snapshot.parsed || {};
  const adoptionDocument = buildDetachedPocketAdoptionDocument(snapshot);
  if (!adoptionDocument) return { ok: false, baseStored: false };
  const prepared = saveDetachedPocketSafetySnapshot(
    adoptionDocument,
    snapshot.base,
    {
      reason: "device-changes-opened",
      capturedAt: snapshot.capturedAt,
      source: parsed.source || {},
      ops: parsed.ops || [],
      operationHighWater: parsed.operationHighWater || 0,
      selectedId: parsed.selectedId || "",
      focusRootId: parsed.focusRootId || "",
      collapsedIds: parsed.collapsedIds || [],
    }
  );
  if (prepared && prepared.ok) return prepared;
  const current = readLocalSafetySnapshot();
  const canonicalSnapshot = {
    parsed: {
      capturedAt: snapshot.capturedAt,
      payload: adoptionDocument,
    },
  };
  if (localSafetySnapshotMatches(current, canonicalSnapshot)) {
    return { ok: true, baseStored: !!current.base, entry: current.parsed };
  }
  return { ok: false, baseStored: false };
}

function restoreLocalSafetySnapshot(snapshot = readLocalSafetySnapshot(), options = {}) {
  if (isPocketBrowserStoragePrivate()) return false;
  if (!snapshot || !snapshot.norm) return false;
  const parsed = snapshot.parsed || {};
  if (typeof setDetachedPocketDocumentSession !== "function") return false;
  const prepared = options.preparedSafety && options.preparedSafety.ok === true
    ? options.preparedSafety
    : prepareLocalSafetySnapshotForDetachedAdoption(snapshot);
  if (!prepared || prepared.ok !== true) {
    setStatus("Pocket couldn’t keep those device changes safe enough to open them. Nothing was changed.", "warn", { durationMs: 7200 });
    return false;
  }
  const adoptionDocument = buildDetachedPocketAdoptionDocument(snapshot);
  if (!adoptionDocument) return false;
  const adoptionNorm = {
    ...snapshot.norm,
    ...adoptionDocument,
  };
  setDetachedPocketDocumentSession("Device changes");
  applyLoadedState(adoptionNorm, {
    schema: adoptionNorm.schema,
    fileName: cleanText(parsed?.source?.fileName, 120) || "Device changes",
    writtenAt: snapshot.capturedAt || adoptionNorm.writtenAt,
  }, { clearOps: false, skipLocalSafetyCheck: true });
  state.detachedSafetyBase = prepared.baseStored === true && snapshot.base
    ? JSON.parse(JSON.stringify(snapshot.base))
    : null;
  if (typeof adoptPocketOperations === "function") {
    const storedEntry = prepared.entry && typeof prepared.entry === "object"
      ? prepared.entry
      : parsed;
    adoptPocketOperations(
      storedEntry.ops,
      storedEntry.operationHighWater,
      { anchor: adoptionDocument }
    );
  } else {
    try {
      state.ops = Array.isArray(parsed.ops) ? JSON.parse(JSON.stringify(parsed.ops)) : [];
    } catch {
      state.ops = [];
    }
  }
  if (state.ops.length === 0) {
    if (typeof recordOp === "function") recordOp({ type: "device_changes_opened" });
    else state.ops.push({ type: "device_changes_opened", at: nowIso() });
  }
  const ids = new Set(state.nodes.map((node) => cleanText(node?.id, 80)).filter(Boolean));
  const selectedId = cleanText(parsed.selectedId, 80);
  const focusRootId = cleanText(parsed.focusRootId, 80);
  if (focusRootId && ids.has(focusRootId)) state.focusRootId = focusRootId;
  if (selectedId && ids.has(selectedId)) state.selectedId = selectedId;
  if (Array.isArray(parsed.collapsedIds)) {
    state.collapsed = new Set(parsed.collapsedIds.map((id) => cleanText(id, 80)).filter((id) => id && ids.has(id)));
  }
  if (state.selectedId) expandPathToNode(state.selectedId);
  clearConflictGuard();
  refreshMeta();
  renderTree();
  persistPipSnapshot();
  requestAnimationFrame(() => {
    refocusTreeNavigation(state.selectedId);
    softlyEnsureSelectionVisible();
  });
  setStatus("Device changes opened. Save when ready.", "ok", { durationMs: 5200 });
  return true;
}

function formatAgoLabel(value) {
  const ms = Number.isFinite(Date.parse(value)) ? Date.parse(value) : 0;
  if (ms <= 0) return "none";
  const diffMs = Math.max(0, Date.now() - ms);
  const mins = Math.round(diffMs / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  return `${days}d ago`;
}

function showPocketHealth() {
  const latestSafety = readLocalSafetySnapshot();
  const trail = readLocalSafetyTrail();
  const sourceName = cleanText(state.source?.fileName, 80) || "no file yet";
  const unsavedCount = Array.isArray(state.ops) ? state.ops.length : 0;
  const backupMeta = readLastBackupMeta();
  const backupText = backupMeta ? `${formatAgoLabel(backupMeta.exportedAt)} · ${backupMeta.nodeCount} node${backupMeta.nodeCount === 1 ? "" : "s"}` : "unknown";
  const health = `${state.nodes.length} nodes · ${unsavedCount} unbacked · local ${formatAgoLabel(latestSafety?.capturedAt)} · backup ${backupText} · ${trail.length} recovery version${trail.length === 1 ? "" : "s"} · ${conflictGuardLabel()} · ${sourceName}`;
  setStatus(`Health: ${health}`, "ok", { durationMs: 12000 });
  refocusTreeNavigation(state.selectedId);
}

function restorePreviousLocalSafetyVersion() {
  if (isPocketBrowserStoragePrivate()) return false;
  const trail = readLocalSafetyTrail();
  const latest = readLocalSafetySnapshot();
  const latestMs = latest ? latest.capturedMs : 0;
  const previous = trail.find((item) => item && item.capturedMs > 0 && (!latestMs || item.capturedMs < latestMs - 1000));
  if (!previous) {
    setStatus("No earlier device version found yet.", "warn", { durationMs: 5200 });
    refocusTreeNavigation(state.selectedId);
    return false;
  }
  if (typeof window.openPocketDeviceChangesDecision !== "function") {
    setStatus("Device-change review is still loading.", "warn", { durationMs: 5200 });
    return false;
  }
  return window.openPocketDeviceChangesDecision(previous, {
    origin: "manual-trail",
    candidateKind: "trail",
  });
}

function maybeOfferLocalSafetyRestore(sourceInfo = {}, options = {}) {
  if (isPocketBrowserStoragePrivate()) return false;
  if (options && options.skipLocalSafetyCheck) return false;
  const snapshot = readLocalSafetySnapshot();
  if (!snapshot) return false;
  if (typeof window.openPocketDeviceChangesDecision !== "function") return false;
  return window.openPocketDeviceChangesDecision(snapshot, {
    origin: "file-load",
    candidateKind: "current-safety",
    sourceInfo,
    fileDocument: options.comparisonDocument || null,
  });
}

function capturePocketDocumentStateForAdoption() {
  return {
    nodes: state.nodes,
    tombstones: state.tombstones,
    rootExtras: state.rootExtras,
    dataExtras: state.dataExtras,
    selectedId: state.selectedId,
    focusRootId: state.focusRootId,
    collapsed: state.collapsed,
    urgentCollectorExpanded: state.urgentCollectorExpanded,
    ops: state.ops,
    operationHighWater: state.operationHighWater,
    operationDocumentAnchor: state.operationDocumentAnchor,
    activeSaveOperationCeiling: state.activeSaveOperationCeiling,
    source: state.source,
    documentBaseline: state.documentBaseline,
    detachedSafetyBase: state.detachedSafetyBase,
    conflictGuard: state.conflictGuard,
    inlineEdit: state.inlineEdit,
    moveMode: state.moveMode,
    detailsEdit: state.detailsEdit,
    captureRhythm: state.captureRhythm,
    typeJump: state.typeJump,
    navigationMemory: state.navigationMemory,
    rowMiniMenuOpen: state.rowMiniMenuOpen,
    rowMiniMenuNodeId: state.rowMiniMenuNodeId,
    lastDeleteUndoSnapshot,
    lastMoveUndoSnapshot,
    lastEditUndoSnapshot,
    lastTreeUndoKind,
    pendingDeleteConfirmNodeId,
    pendingDeleteConfirmExpiresAt,
    pendingPathImport,
  };
}

function restorePocketDocumentStateAfterFailedAdoption(snapshot) {
  if (!snapshot || typeof snapshot !== "object") return false;
  state.nodes = snapshot.nodes;
  state.tombstones = snapshot.tombstones;
  state.rootExtras = snapshot.rootExtras;
  state.dataExtras = snapshot.dataExtras;
  state.selectedId = snapshot.selectedId;
  state.focusRootId = snapshot.focusRootId;
  state.collapsed = snapshot.collapsed;
  state.urgentCollectorExpanded = snapshot.urgentCollectorExpanded;
  state.ops = snapshot.ops;
  state.operationHighWater = snapshot.operationHighWater;
  state.operationDocumentAnchor = snapshot.operationDocumentAnchor;
  state.activeSaveOperationCeiling = snapshot.activeSaveOperationCeiling;
  state.source = snapshot.source;
  state.documentBaseline = snapshot.documentBaseline;
  state.detachedSafetyBase = snapshot.detachedSafetyBase;
  state.conflictGuard = snapshot.conflictGuard;
  state.inlineEdit = snapshot.inlineEdit;
  state.moveMode = snapshot.moveMode;
  state.detailsEdit = snapshot.detailsEdit;
  state.captureRhythm = snapshot.captureRhythm;
  state.typeJump = snapshot.typeJump;
  state.navigationMemory = snapshot.navigationMemory;
  state.rowMiniMenuOpen = snapshot.rowMiniMenuOpen;
  state.rowMiniMenuNodeId = snapshot.rowMiniMenuNodeId;
  lastDeleteUndoSnapshot = snapshot.lastDeleteUndoSnapshot;
  lastMoveUndoSnapshot = snapshot.lastMoveUndoSnapshot;
  lastEditUndoSnapshot = snapshot.lastEditUndoSnapshot;
  lastTreeUndoKind = snapshot.lastTreeUndoKind;
  pendingDeleteConfirmNodeId = snapshot["pendingDeleteConfirmNodeId"];
  pendingDeleteConfirmExpiresAt = snapshot["pendingDeleteConfirmExpiresAt"];
  pendingPathImport = snapshot["pendingPathImport"];
  return true;
}

function resetPocketDocumentTransientsForAdoption() {
  if (typeof cancelPendingCopyClick === "function") {
    cancelPendingCopyClick();
  } else if (pendingCopyClickTimer) {
    clearTimeout(pendingCopyClickTimer);
    pendingCopyClickTimer = null;
  }
  if (importRevealTimer) {
    clearTimeout(importRevealTimer);
    importRevealTimer = null;
  }
  if (typeof clearMoveModeIdleTimer === "function") clearMoveModeIdleTimer();
  if (typeof stopMovePadRepeat === "function") stopMovePadRepeat();
  state.inlineEdit = {
    id: "",
    isNew: false,
    originalLabel: "",
    afterId: "",
    parentId: "",
    autoFocus: false,
  };
  state.moveMode = false;
  state.detailsEdit = {
    id: "",
    originalLabel: "",
    originalDetails: "",
    originalUrgent: false,
    originalCopyContext: false,
    draftOpRecorded: false,
    draftOperationSequence: 0,
    draftHadCoveredSave: false,
    opsStartLength: 0,
  };
  state.captureRhythm = { parentId: "", lastAddedId: "", expiresAt: 0 };
  state.typeJump = { query: "", cycle: 0, lastAt: 0 };
  state.navigationMemory = {
    filterSelectedId: "",
    filterFocusRootId: "",
    preFocusSelectedId: "",
  };
  state.rowMiniMenuOpen = false;
  state.rowMiniMenuNodeId = "";
  lastDeleteUndoSnapshot = null;
  lastMoveUndoSnapshot = null;
  lastEditUndoSnapshot = null;
  lastTreeUndoKind = "";
  pendingDeleteConfirmNodeId = "";
  pendingDeleteConfirmExpiresAt = 0;
  pendingPathImport = null;
  if (el.detailOverlay instanceof HTMLElement) el.detailOverlay.hidden = true;
  if (el.detailEditorLabel && "value" in el.detailEditorLabel) el.detailEditorLabel.value = "";
  if (el.detailEditorBody && "value" in el.detailEditorBody) el.detailEditorBody.value = "";
  if (el.detailEditorUrgent && "checked" in el.detailEditorUrgent) el.detailEditorUrgent.checked = false;
  if (el.detailEditorCopyContext && "checked" in el.detailEditorCopyContext) el.detailEditorCopyContext.checked = false;
  if (el.detailEditorTitle) el.detailEditorTitle.textContent = "";
  if (el.detailEditorPath) el.detailEditorPath.textContent = "";
  if (typeof closeRowMiniMenu === "function") closeRowMiniMenu({ restoreFocus: false });
  return true;
}

function finishLoadedStateAdoption(norm, sourceInfo = {}, options = {}) {
  const storagePrivate = options.storagePrivate === "vault" || options.storagePrivate === "synced"
    ? options.storagePrivate
    : pocketBrowserStoragePrivacyMode();
  resetPocketDocumentTransientsForAdoption();
  if (storagePrivate) {
    if (typeof clearConflictGuard === "function") clearConflictGuard();
    else state.conflictGuard = { active: false, reason: "", loadedAt: "", newerAt: "" };
  } else {
    updateConflictGuardForLoadedSource(norm, state.source);
  }
  const restoredWorkspace = storagePrivate ? false : restoreWorkspaceState();
  const baselinePayload = {
    ...(state.rootExtras || {}),
    schema: "portal.export.v1",
    exportedAt: nowIso(),
    writtenAt: nowIso(),
    mainThoughtTree: state.nodes,
    mainThoughtTreeTombstones: state.tombstones,
    data: {
      ...(state.dataExtras || {}),
      mainThoughtTree: state.nodes,
      mainThoughtTreeTombstones: state.tombstones,
    },
  };
  if (!storagePrivate) saveLastSaveSnapshot(baselinePayload);
  refreshMeta();
  renderTree();
  if (restoredWorkspace && state.selectedId) {
    requestAnimationFrame(() => {
      refocusTreeNavigation(state.selectedId);
      softlyEnsureSelectionVisible();
    });
  }
  if (!storagePrivate) {
    persistPipSnapshot();
    maybeOfferLocalSafetyRestore(state.source, options);
  }
  return true;
}

function applyLoadedState(norm, sourceInfo = {}, options = {}) {
  const clearOps = options.clearOps !== false;
  state.nodes = Array.isArray(norm.nodes) ? norm.nodes : [];
  state.tombstones = Array.isArray(norm.tombstones) ? norm.tombstones : [];
  state.rootExtras = (norm.rootExtras && typeof norm.rootExtras === "object" && !Array.isArray(norm.rootExtras)) ? norm.rootExtras : {};
  state.dataExtras = (norm.dataExtras && typeof norm.dataExtras === "object" && !Array.isArray(norm.dataExtras)) ? norm.dataExtras : {};
  if (clearOps) {
    if (typeof adoptPocketOperations === "function") {
      adoptPocketOperations([], 0, { resetAnchor: false });
    } else {
      state.ops = [];
    }
  }
  collapseAllNodes();
  state.selectedId = "";
  state.focusRootId = "";
  state.source = {
    schema: cleanText(sourceInfo.schema || norm.schema, 80),
    fileName: cleanText(sourceInfo.fileName, 120),
    writtenAt: cleanText(sourceInfo.writtenAt || norm.writtenAt, 40),
  };
  if (options.establishDocumentBaseline === true) {
    const baselineInput = options.baselinePayload || {
      nodes: state.nodes,
      tombstones: state.tombstones,
      rootExtras: state.rootExtras,
      dataExtras: state.dataExtras,
    };
    establishPocketDocumentBaseline(baselineInput, state.source);
  }
  if (typeof resetPocketOperationAnchor === "function") resetPocketOperationAnchor();
  if (options.deferEffects === true) return true;
  return finishLoadedStateAdoption(norm, sourceInfo, options);
}

function saveAutoCache(norm, sourceInfo = {}) {
  if (isPocketBrowserStoragePrivate()) return false;
  try {
    const payload = {
      ...(state.rootExtras || {}),
      cachedAt: nowIso(),
      source: {
        schema: cleanText(sourceInfo.schema || norm.schema, 80),
        fileName: cleanText(sourceInfo.fileName, 120),
        writtenAt: cleanText(sourceInfo.writtenAt || norm.writtenAt, 40),
      },
      data: {
        ...(state.dataExtras || {}),
        mainThoughtTree: Array.isArray(norm.nodes) ? norm.nodes : [],
        mainThoughtTreeTombstones: Array.isArray(norm.tombstones) ? norm.tombstones : [],
      },
    };
    localStorage.setItem(AUTO_CACHE_KEY, JSON.stringify(payload));
    return true;
  } catch {
    return false;
  }
}

function saveLastSaveSnapshot(payload) {
  if (isPocketBrowserStoragePrivate()) return false;
  if (!payload || typeof payload !== "object") return false;
  const clone = safeJsonClone(payload, 5000000);
  if (!clone) return false;
  try {
    const entry = {
      schema: "pocket.save.snapshot.v1",
      capturedAt: nowIso(),
      source: {
        schema: cleanText(state.source?.schema, 80),
        fileName: cleanText(state.source?.fileName, 120),
        writtenAt: cleanText(state.source?.writtenAt, 40),
      },
      payload: clone,
    };
    localStorage.setItem("pocketLite.lastSaveSnapshot.v1", JSON.stringify(entry));
    return true;
  } catch {
    return false;
  }
}

function snapshotCurrentTreeForRestore() {
  if (!Array.isArray(state.nodes)) return false;
  const payload = {
    ...(state.rootExtras || {}),
    schema: "portal.export.v1",
    exportedAt: nowIso(),
    writtenAt: nowIso(),
    mainThoughtTree: state.nodes,
    mainThoughtTreeTombstones: state.tombstones,
    data: {
      ...(state.dataExtras || {}),
      mainThoughtTree: state.nodes,
      mainThoughtTreeTombstones: state.tombstones,
    },
  };
  const ok = saveLastSaveSnapshot(payload);
  return ok;
}

function restoreAutoCache() {
  if (isPocketBrowserStoragePrivate()) return null;
  try {
    const raw = localStorage.getItem(AUTO_CACHE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return null;
    const norm = normaliseInput({
      ...parsed,
      schema: "portal.mtt.web.v1",
      writtenAt: parsed?.source?.writtenAt || "",
      data: parsed.data && typeof parsed.data === "object" ? parsed.data : {},
    });
    if (!Array.isArray(norm.nodes) || norm.nodes.length === 0) return null;
    return {
      norm,
      source: {
        schema: cleanText(parsed?.source?.schema, 80) || "portal.mtt.web.v1",
        fileName: cleanText(parsed?.source?.fileName, 120) || "JSONs/pocket-data.json (cached)",
        writtenAt: cleanText(parsed?.source?.writtenAt, 40),
      },
    };
  } catch {
    return null;
  }
}

async function readSourceText(sourcePath) {
  const direct = cleanText(sourcePath, 320);
  const absolute = (() => {
    try {
      return new URL(direct, window.location.href).toString();
    } catch {
      return "";
    }
  })();
  const candidates = [direct, absolute].filter(Boolean);
  let lastErr = null;

  for (const candidate of candidates) {
    try {
      const resp = await fetch(candidate, { cache: "no-store" });
      if (resp && resp.ok) {
        return await resp.text();
      }
    } catch (err) {
      lastErr = err;
    }
  }

  for (const candidate of candidates) {
    try {
      const text = await new Promise((resolve, reject) => {
        const xhr = new XMLHttpRequest();
        xhr.open("GET", candidate, true);
        xhr.responseType = "text";
        xhr.onload = () => {
          const status = Number(xhr.status || 0);
          if ((status >= 200 && status < 300) || status === 0) {
            resolve(String(xhr.responseText || ""));
          } else {
            reject(new Error(`XHR status ${status}`));
          }
        };
        xhr.onerror = () => reject(new Error("XHR error"));
        xhr.onabort = () => reject(new Error("XHR aborted"));
        xhr.send();
      });
      if (text && String(text).trim()) return String(text);
    } catch (err) {
      lastErr = err;
    }
  }

  throw lastErr || new Error("Could not read source");
}
