/* Payload building, local safety, cache, startup restore, health/restore helpers. */

function makeId(prefix = "pl") {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 9)}`;
}

function saveWorkspaceState() {
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

function buildPocketPayload(writtenAt = nowIso()) {
  const treeNodes = JSON.parse(JSON.stringify(state.nodes || []));
  const treeTombstones = JSON.parse(JSON.stringify(state.tombstones || []));
  const rootExtras = JSON.parse(JSON.stringify(state.rootExtras || {}));
  const dataExtras = JSON.parse(JSON.stringify(state.dataExtras || {}));
  const pocketGuard = {
    schema: "pocket.guard.v1",
    instanceId: getPocketInstanceId(),
    sourceFileName: cleanText(state.source?.fileName, 120),
    sourceWrittenAt: cleanText(state.source?.writtenAt, 40),
    backupWrittenAt: writtenAt,
  };
  return {
    ...rootExtras,
    pocketGuard,
    schema: "portal.export.v1",
    exportedAt: writtenAt,
    writtenAt,
    mainThoughtTree: treeNodes,
    mainThoughtTreeTombstones: treeTombstones,
    data: {
      ...dataExtras,
      pocketGuard,
      mainThoughtTree: treeNodes,
      mainThoughtTreeTombstones: treeTombstones,
    },
  };
}

function saveLocalSafetySnapshot(reason = "change") {
  if (!Array.isArray(state.nodes) || state.nodes.length === 0) return false;
  try {
    const capturedAt = nowIso();
    const entry = {
      schema: "pocket.localSafety.v1",
      capturedAt,
      reason: cleanText(reason, 40),
      source: {
        schema: cleanText(state.source?.schema, 80),
        fileName: cleanText(state.source?.fileName, 120),
        writtenAt: cleanText(state.source?.writtenAt, 40),
      },
      selectedId: cleanText(state.selectedId, 80),
      focusRootId: cleanText(state.focusRootId, 80),
      collapsedIds: Array.from(state.collapsed || new Set()).map((id) => cleanText(id, 80)).filter(Boolean),
      ops: JSON.parse(JSON.stringify(state.ops || [])),
      payload: buildPocketPayload(capturedAt),
    };
    localStorage.setItem(LOCAL_SAFETY_KEY, JSON.stringify(entry));
    appendLocalSafetyTrail(entry);
    return true;
  } catch {
    return false;
  }
}

function readLocalSafetySnapshot() {
  try {
    const raw = localStorage.getItem(LOCAL_SAFETY_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return null;
    const payload = parsed.payload && typeof parsed.payload === "object" ? parsed.payload : null;
    if (!payload) return null;
    const norm = normaliseInput(payload);
    if (!Array.isArray(norm.nodes) || norm.nodes.length === 0) return null;
    const capturedAt = cleanText(parsed.capturedAt || norm.writtenAt, 40);
    const capturedMs = Number.isFinite(Date.parse(capturedAt)) ? Date.parse(capturedAt) : 0;
    if (capturedMs <= 0) return null;
    return { parsed, norm, capturedAt, capturedMs };
  } catch {
    return null;
  }
}

function readLocalSafetyTrail() {
  try {
    const raw = localStorage.getItem(LOCAL_SAFETY_TRAIL_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    const arr = Array.isArray(parsed) ? parsed : [];
    const out = [];
    for (const item of arr) {
      if (!item || typeof item !== "object") continue;
      const payload = item.payload && typeof item === "object" ? item.payload : null;
      if (!payload) continue;
      const norm = normaliseInput(payload);
      if (!Array.isArray(norm.nodes) || norm.nodes.length === 0) continue;
      const capturedAt = cleanText(item.capturedAt || norm.writtenAt, 40);
      const capturedMs = Number.isFinite(Date.parse(capturedAt)) ? Date.parse(capturedAt) : 0;
      if (capturedMs <= 0) continue;
      out.push({ parsed: item, norm, capturedAt, capturedMs });
    }
    out.sort((a, b) => b.capturedMs - a.capturedMs);
    return out.slice(0, LOCAL_SAFETY_TRAIL_MAX);
  } catch {
    return [];
  }
}

function writeLocalSafetyTrail(entries) {
  try {
    const arr = (Array.isArray(entries) ? entries : [])
      .map((entry) => entry && entry.parsed ? entry.parsed : entry)
      .filter((entry) => entry && typeof entry === "object")
      .slice(0, LOCAL_SAFETY_TRAIL_MAX);
    localStorage.setItem(LOCAL_SAFETY_TRAIL_KEY, JSON.stringify(arr));
    return true;
  } catch {
    return false;
  }
}

function readLastBackupMeta() {
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

function assessStaleFileRisk(norm = {}, sourceInfo = {}) {
  const loadedAt = cleanText(sourceInfo.writtenAt || norm.writtenAt, 40);
  const loadedMs = parseDateMs(loadedAt);
  const latestSafety = readLocalSafetySnapshot();
  const backupMeta = readLastBackupMeta();
  const safetyMs = latestSafety ? latestSafety.capturedMs : 0;
  const backupMs = backupMeta ? backupMeta.exportedMs : 0;
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


function appendLocalSafetyTrail(entry) {
  if (!entry || typeof entry !== "object") return false;
  const capturedAt = cleanText(entry.capturedAt, 40);
  const capturedMs = Number.isFinite(Date.parse(capturedAt)) ? Date.parse(capturedAt) : 0;
  if (capturedMs <= 0) return false;
  try {
    const trail = readLocalSafetyTrail();
    const latest = trail[0] || null;
    const latestMs = latest ? latest.capturedMs : 0;
    const compactEntry = safeJsonClone(entry, 900000);
    if (!compactEntry) return false;
    const nextEntry = { parsed: compactEntry, norm: normaliseInput(compactEntry.payload), capturedAt, capturedMs };
    if (latest && Math.abs(capturedMs - latestMs) < 30000) {
      trail[0] = nextEntry;
    } else {
      trail.unshift(nextEntry);
    }
    return writeLocalSafetyTrail(trail);
  } catch {
    return false;
  }
}

function clearLocalSafetySnapshot() {
  try {
    localStorage.removeItem(LOCAL_SAFETY_KEY);
    return true;
  } catch {
    return false;
  }
}

function restoreLocalSafetySnapshot(snapshot = readLocalSafetySnapshot()) {
  if (!snapshot || !snapshot.norm) return false;
  const parsed = snapshot.parsed || {};
  applyLoadedState(snapshot.norm, {
    schema: snapshot.norm.schema,
    fileName: cleanText(parsed?.source?.fileName, 120) || "local safety snapshot",
    writtenAt: snapshot.capturedAt || snapshot.norm.writtenAt,
  }, { clearOps: false, skipLocalSafetyCheck: true });
  state.ops = Array.isArray(parsed.ops) ? parsed.ops : [];
  const ids = new Set(state.nodes.map((node) => cleanText(node?.id, 80)).filter(Boolean));
  const selectedId = cleanText(parsed.selectedId, 80);
  const focusRootId = cleanText(parsed.focusRootId, 80);
  if (focusRootId && ids.has(focusRootId)) state.focusRootId = focusRootId;
  if (selectedId && ids.has(selectedId)) state.selectedId = selectedId;
  if (Array.isArray(parsed.collapsedIds)) {
    state.collapsed = new Set(parsed.collapsedIds.map((id) => cleanText(id, 80)).filter((id) => id && ids.has(id)));
  }
  if (state.selectedId) expandPathToNode(state.selectedId);
  refreshMeta();
  renderTree();
  requestAnimationFrame(() => {
    refocusTreeNavigation(state.selectedId);
    softlyEnsureSelectionVisible();
  });
  setStatus("Local copy restored. save when ready.", "ok", { durationMs: 5200 });
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
  const trail = readLocalSafetyTrail();
  const latest = readLocalSafetySnapshot();
  const latestMs = latest ? latest.capturedMs : 0;
  const previous = trail.find((item) => item && item.capturedMs > 0 && (!latestMs || item.capturedMs < latestMs - 1000));
  if (!previous) {
    setStatus("No earlier local version found yet.", "warn", { durationMs: 5200 });
    refocusTreeNavigation(state.selectedId);
    return false;
  }
  const ok = restoreLocalSafetySnapshot(previous);
  if (ok) {
    saveWorkspaceState();
    requestAnimationFrame(() => {
      if (state.selectedId) flashTouchedRow(state.selectedId);
    });
    setStatus(`Restored local version from ${formatAgoLabel(previous.capturedAt)} · ${previous.norm.nodes.length} nodes. save when ready.`, "ok", { durationMs: 7200 });
  }
  return ok;
}

function maybeOfferLocalSafetyRestore(sourceInfo = {}, options = {}) {
  if (options && options.skipLocalSafetyCheck) return false;
  const snapshot = readLocalSafetySnapshot();
  if (!snapshot) return false;
  const loadedStamp = cleanText(sourceInfo.writtenAt || state.source?.writtenAt, 40);
  const loadedMs = Number.isFinite(Date.parse(loadedStamp)) ? Date.parse(loadedStamp) : 0;
  const hasNewerLocal = snapshot.capturedMs > Math.max(loadedMs, 0) + 1000;
  if (!hasNewerLocal) return false;
  const label = formatSaveClockLabel(new Date(snapshot.capturedMs));
  setStatus(`This file looks older. Newer local copy found (${label}).`, "warn", {
    durationMs: 12000,
    action: {
      label: "Restore",
      onClick: () => restoreLocalSafetySnapshot(snapshot),
    },
  });
  return true;
}

function buildPeFromLegacyDetails(node) {
  const text = normaliseDetails(node && node.details, 4000);
  if (!text) return null;
  return {
    schema: "pocket.pe.v1",
    title: cleanText(node && node.label, 220),
    mode: "text",
    text,
    outline: [],
    updatedAt: cleanText(node && node.updatedAt, 40) || nowIso(),
  };
}

function ensurePeFromLegacyDetails(nodes) {
  const safe = Array.isArray(nodes) ? nodes : [];
  return safe.map((node) => {
    if (!node || typeof node !== "object" || Array.isArray(node)) return node;
    if (Object.prototype.hasOwnProperty.call(node, "pe")) return node;
    const pe = buildPeFromLegacyDetails(node);
    if (pe) node.pe = pe;
    return node;
  });
}
function applyLoadedState(norm, sourceInfo = {}, options = {}) {
  const clearOps = options.clearOps !== false;
  state.nodes = ensurePeFromLegacyDetails(Array.isArray(norm.nodes) ? norm.nodes : []);
  state.tombstones = Array.isArray(norm.tombstones) ? norm.tombstones : [];
  state.rootExtras = (norm.rootExtras && typeof norm.rootExtras === "object" && !Array.isArray(norm.rootExtras)) ? norm.rootExtras : {};
  state.dataExtras = (norm.dataExtras && typeof norm.dataExtras === "object" && !Array.isArray(norm.dataExtras)) ? norm.dataExtras : {};
  if (clearOps) state.ops = [];
  collapseAllNodes();
  state.selectedId = "";
  state.focusRootId = "";
  state.source = {
    schema: cleanText(sourceInfo.schema || norm.schema, 80),
    fileName: cleanText(sourceInfo.fileName, 120),
    writtenAt: cleanText(sourceInfo.writtenAt || norm.writtenAt, 40),
  };
  updateConflictGuardForLoadedSource(norm, state.source);
  const restoredWorkspace = restoreWorkspaceState();
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
  saveLastSaveSnapshot(baselinePayload);
  refreshMeta();
  renderTree();
  if (restoredWorkspace && state.selectedId) {
    requestAnimationFrame(() => {
      refocusTreeNavigation(state.selectedId);
      softlyEnsureSelectionVisible();
    });
  }
  persistPipSnapshot();
  maybeOfferLocalSafetyRestore(state.source, options);
}

function saveAutoCache(norm, sourceInfo = {}) {
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
  } catch {}
}

function saveLastSaveSnapshot(payload) {
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
  if (!Array.isArray(state.nodes) || state.nodes.length === 0) return false;
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
