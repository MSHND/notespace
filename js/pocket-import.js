/* Import parsing, path import planning/commit/undo. */

function parseNdjsonLines(rawText, maxLines = 5000) {
  const text = String(rawText || "");
  if (!text.trim()) return [];
  const lines = text
    .split(/\r?\n/)
    .map((line) => String(line || "").trim())
    .filter(Boolean);
  const out = [];
  for (let i = 0; i < lines.length; i += 1) {
    if (out.length >= maxLines) break;
    try {
      const parsed = JSON.parse(lines[i]);
      if (parsed && typeof parsed === "object") out.push(parsed);
    } catch {}
  }
  return out;
}

function extractNormFromChangeEntry(entry) {
  if (!entry || typeof entry !== "object") return null;
  const candidates = [];
  if (entry.snapshot && typeof entry.snapshot === "object") {
    candidates.push(entry.snapshot);
  }
  if (entry.data && typeof entry.data === "object") {
    candidates.push({
      schema: "portal.mtt.web.v1",
      writtenAt: cleanText(entry.writtenAt || entry.exportedAt, 40),
      data: entry.data,
    });
  }
  candidates.push(entry);

  for (const candidate of candidates) {
    const norm = normaliseInput(candidate);
    if (!Array.isArray(norm.nodes) || norm.nodes.length === 0) continue;
    const writtenAt = cleanText(
      entry.writtenAt || entry.exportedAt || norm.writtenAt,
      40
    );
    const ms = Number.isFinite(Date.parse(writtenAt)) ? Date.parse(writtenAt) : 0;
    return { norm, writtenAt, ms };
  }
  return null;
}

function pickLatestChangeSnapshot(entries) {
  const safe = Array.isArray(entries) ? entries : [];
  let best = null;
  for (let i = 0; i < safe.length; i += 1) {
    const extracted = extractNormFromChangeEntry(safe[i]);
    if (!extracted) continue;
    if (!best) {
      best = { ...extracted, index: i };
      continue;
    }
    if (extracted.ms > best.ms || (extracted.ms === best.ms && i > best.index)) {
      best = { ...extracted, index: i };
    }
  }
  return best;
}

async function loadLatestSnapshotFromChangeLog() {
  for (const sourcePath of ["JSONs/pocket-change-log.ndjson", "pocket-change-log.ndjson"]) {
    try {
      const text = await readSourceText(sourcePath);
      const entries = parseNdjsonLines(text);
      if (!entries.length) continue;
      const latest = pickLatestChangeSnapshot(entries);
      if (!latest) continue;
      return {
        ok: true,
        sourcePath,
        entryCount: entries.length,
        norm: latest.norm,
        writtenAt: latest.writtenAt,
        ms: latest.ms,
      };
    } catch {}
  }
  return { ok: false };
}

async function autoLoadAtStartup() {
  if (isPipMode) return false;
  if (state.nodes.length > 0) return true;
  const sourceParam = cleanText(url.searchParams.get("source"), 260);
  const sourcePaths = sourceParam
    ? [sourceParam]
    : ["JSONs/pocket-data.json"];

  for (const sourcePath of sourcePaths) {
    try {
      const text = await readSourceText(sourcePath);
      const parsed = JSON.parse(text);
      const norm = normaliseInput(parsed);
      if (Array.isArray(norm.nodes) && norm.nodes.length > 0) {
        applyLoadedState(norm, {
          schema: norm.schema,
          fileName: sourcePath,
          writtenAt: norm.writtenAt,
        });
        const baseWrittenAt = cleanText(norm.writtenAt, 40);
        const baseMs = Number.isFinite(Date.parse(baseWrittenAt)) ? Date.parse(baseWrittenAt) : 0;
        const overlay = await loadLatestSnapshotFromChangeLog();
        if (overlay.ok) {
          const shouldApplyOverlay = !(baseMs > 0 && overlay.ms > 0 && overlay.ms <= baseMs);
          if (shouldApplyOverlay) {
            applyLoadedState(overlay.norm, {
              schema: overlay.norm.schema,
              fileName: `${sourcePath} + ${overlay.sourcePath}`,
              writtenAt: overlay.writtenAt || overlay.norm.writtenAt,
            });
            saveAutoCache(overlay.norm, {
              schema: overlay.norm.schema,
              fileName: `${sourcePath} + ${overlay.sourcePath}`,
              writtenAt: overlay.writtenAt || overlay.norm.writtenAt,
            });
            setStatus(startupConfidenceText("Welcome back · latest change log"), startupConfidenceKind(), { durationMs: 5200 });
            return true;
          }
        }
        saveAutoCache(norm, {
          schema: norm.schema,
          fileName: sourcePath,
          writtenAt: norm.writtenAt,
        });
        setStatus(startupConfidenceText("Welcome back"), startupConfidenceKind(), { durationMs: 5200 });
        return true;
      }
    } catch {}
  }

  const overlayOnly = await loadLatestSnapshotFromChangeLog();
  if (overlayOnly.ok) {
    applyLoadedState(overlayOnly.norm, {
      schema: overlayOnly.norm.schema,
      fileName: overlayOnly.sourcePath,
      writtenAt: overlayOnly.writtenAt || overlayOnly.norm.writtenAt,
    });
    saveAutoCache(overlayOnly.norm, {
      schema: overlayOnly.norm.schema,
      fileName: overlayOnly.sourcePath,
      writtenAt: overlayOnly.writtenAt || overlayOnly.norm.writtenAt,
    });
    setStatus(startupConfidenceText("Welcome back · change log"), startupConfidenceKind(), { durationMs: 5200 });
    return true;
  }

  const cached = restoreAutoCache();
  if (cached && cached.norm) {
    applyLoadedState(cached.norm, cached.source);
    setStatus(startupConfidenceText("Welcome back · restored local copy"), startupConfidenceKind(), { durationMs: 6200 });
    return true;
  }
  const sourceHint = sourceParam || "JSONs/pocket-data.json";
  setStatus(`Open a pocket file, restore local copy, or press + to start.`, "warn", { durationMs: 6500 });
  return false;
}

function persistPipSnapshot() {
  try {
    const payload = {
      savedAt: nowIso(),
      source: state.source,
      nodes: state.nodes,
      tombstones: state.tombstones,
      rootExtras: state.rootExtras || {},
      dataExtras: state.dataExtras || {},
      selectedId: state.selectedId,
      focusRootId: state.focusRootId,
      collapsedIds: Array.from(state.collapsed),
      ops: state.ops,
    };
    localStorage.setItem(PIP_SNAPSHOT_KEY, JSON.stringify(payload));
    saveWorkspaceState();
  } catch {}
}

function restoreFromPipSnapshot() {
  if (state.nodes.length > 0) return false;
  try {
    const raw = localStorage.getItem(PIP_SNAPSHOT_KEY);
    if (!raw) return false;
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return false;
    const nodes = normaliseNodes(parsed.nodes);
    if (!Array.isArray(nodes) || nodes.length === 0) return false;
    state.nodes = nodes;
    state.tombstones = Array.isArray(parsed.tombstones) ? parsed.tombstones : [];
    state.rootExtras = (parsed.rootExtras && typeof parsed.rootExtras === "object" && !Array.isArray(parsed.rootExtras))
      ? normaliseRootExtras(parsed.rootExtras) || {}
      : {};
    state.dataExtras = (parsed.dataExtras && typeof parsed.dataExtras === "object" && !Array.isArray(parsed.dataExtras))
      ? normaliseRootExtras(parsed.dataExtras) || {}
      : {};
    state.ops = Array.isArray(parsed.ops) ? parsed.ops : [];
    state.selectedId = cleanText(parsed.selectedId, 80);
    state.focusRootId = cleanText(parsed.focusRootId, 80);
    state.collapsed = new Set(Array.isArray(parsed.collapsedIds) ? parsed.collapsedIds.map((id) => cleanText(id, 80)).filter(Boolean) : []);
    if (state.collapsed.size === 0) collapseAllNodes();
    state.source = {
      schema: cleanText(parsed.source && parsed.source.schema, 80),
      fileName: cleanText(parsed.source && parsed.source.fileName, 120),
      writtenAt: cleanText(parsed.source && parsed.source.writtenAt, 40),
    };
    refreshMeta();
    renderTree();
    const fromLabel = isPipMode ? "current session" : "local autosave";
    setStatus(`Loaded ${state.nodes.length} node${state.nodes.length === 1 ? "" : "s"} from ${fromLabel}.`, "ok");
    return true;
  } catch {
    return false;
  }
}

async function copyText(text, options = {}) {
  const opts = options && typeof options === "object" ? options : {};
  const preserveLines = opts.preserveLines === true;
  const maxRaw = Number(opts.max);
  const max = Number.isFinite(maxRaw) && maxRaw > 0
    ? Math.round(maxRaw)
    : (preserveLines ? 4000 : 220);
  const value = preserveLines ? normaliseDetails(text, max) : cleanText(text, max);
  if (!value) return false;
  try {
    if (navigator.clipboard && typeof navigator.clipboard.writeText === "function") {
      await navigator.clipboard.writeText(value);
      return true;
    }
  } catch {}
  try {
    const ta = document.createElement("textarea");
    ta.value = value;
    ta.style.position = "fixed";
    ta.style.left = "-9999px";
    document.body.appendChild(ta);
    ta.focus();
    ta.select();
    const ok = document.execCommand("copy");
    ta.remove();
    return !!ok;
  } catch {
    return false;
  }
}

function findRowElementByNodeId(nodeId) {
  const id = cleanText(nodeId, 80);
  if (!id || !(el.treeWrap instanceof HTMLElement)) return null;
  const rows = el.treeWrap.querySelectorAll(".row[data-node-id]");
  for (const item of rows) {
    if (!(item instanceof HTMLElement)) continue;
    const rowId = cleanText(item.getAttribute("data-node-id"), 80);
    if (rowId === id) return item;
  }
  return null;
}

function scrollRowComfortably(row, options = {}) {
  if (!(row instanceof HTMLElement)) return false;
  // Keyboard-driven tree movement feels calmer when the scroll follows instantly
  // and only moves the minimum amount needed to keep a small cushion around the row.
  const behavior = options.smooth === true && options.instant !== true ? "smooth" : "auto";
  const container = el.treeWrap instanceof HTMLElement ? el.treeWrap : null;
  if (!(container instanceof HTMLElement)) {
    try { row.scrollIntoView({ block: "nearest", inline: "nearest", behavior }); } catch {}
    return true;
  }

  const rowBox = row.getBoundingClientRect();
  const wrapBox = container.getBoundingClientRect();
  const rowHeight = Math.max(24, rowBox.height || 32);
  const cushion = Math.min(84, Math.max(28, rowHeight * 2.25));
  const visibleTop = wrapBox.top + cushion;
  const visibleBottom = wrapBox.bottom - cushion;

  let delta = 0;
  if (rowBox.bottom > visibleBottom) {
    delta = rowBox.bottom - visibleBottom;
  } else if (rowBox.top < visibleTop) {
    delta = rowBox.top - visibleTop;
  }

  if (Math.abs(delta) > 1) {
    try {
      container.scrollBy({ top: delta, left: 0, behavior });
    } catch {
      container.scrollTop += delta;
    }
  }
  return true;
}

function showRowCopyToast(nodeId) {
  const id = cleanText(nodeId, 80);
  if (!id) return false;
  const row = findRowElementByNodeId(id);
  if (!(row instanceof HTMLElement)) return false;
  scrollRowComfortably(row);
  const prevTimer = rowCopyToastTimers.get(id);
  if (prevTimer) clearTimeout(prevTimer);
  row.classList.remove("copyFlash");
  void row.offsetWidth;
  row.classList.add("copyFlash");
  const timer = window.setTimeout(() => {
    row.classList.remove("copyFlash");
    rowCopyToastTimers.delete(id);
  }, 780);
  rowCopyToastTimers.set(id, timer);
  return true;
}

function flashTouchedRow(nodeId) {
  const id = cleanText(nodeId, 80);
  if (!id) return false;
  const row = findRowElementByNodeId(id);
  if (!(row instanceof HTMLElement)) return false;
  scrollRowComfortably(row);
  const prevTimer = rowTouchFlashTimers.get(id);
  if (prevTimer) clearTimeout(prevTimer);
  row.classList.remove("touchFlash");
  void row.offsetWidth;
  row.classList.add("touchFlash");
  const timer = window.setTimeout(() => {
    row.classList.remove("touchFlash");
    rowTouchFlashTimers.delete(id);
  }, 950);
  rowTouchFlashTimers.set(id, timer);
  return true;
}

function advanceSelectionAfterCopy(nodeId) {
  const id = cleanText(nodeId, 80);
  const visibleIds = getVisibleNodeIdsInRenderOrder();
  if (!id || visibleIds.length === 0) return false;
  const index = visibleIds.indexOf(id);
  if (index < 0) return false;
  const nextId = visibleIds[index + 1] || visibleIds[0];
  if (!nextId || nextId === id) {
    refocusTreeNavigation(id);
    flashTouchedRow(id);
    return false;
  }
  state.selectedId = nextId;
  refreshMeta();
  renderTree();
  refocusTreeNavigation(nextId);
  requestAnimationFrame(() => flashTouchedRow(id));
  return true;
}

function showCopiedFeedback(nodeId) {
  const id = cleanText(nodeId, 80);
  const sourceNode = id ? (nodeMap().get(id) || null) : null;
  const copiedLabel = cleanText(sourceNode?.label, 220);
  showRowCopyToast(id);
  refocusTreeNavigation(id);
  setStatus(copiedLabel ? `Copied · ${copiedLabel}` : "Copied.", "ok");
}

function normaliseNodes(raw) {
  const arr = Array.isArray(raw) ? raw : [];
  const out = [];
  const seen = new Set();
  for (let i = 0; i < arr.length; i += 1) {
    const item = arr[i];
    if (!item || typeof item !== "object") continue;
    const id = cleanText(item.id, 80);
    if (!id || id === "root" || seen.has(id)) continue;
    seen.add(id);
    const parentId = cleanText(item.parentId, 80) || "root";
    const label = cleanText(item.label, 220);
    if (!label) continue;
    const orderRaw = Number(item.order);
    const order = Number.isFinite(orderRaw) ? Math.round(orderRaw) : (1000 + out.length);
    const updatedAt = cleanText(item.updatedAt, 40) || nowIso();
    const urgent = normaliseUrgentFlag(item.urgent);
    const details = normaliseDetails(item.details, 4000);
    const task = normaliseTreeTaskMeta(item.task || item.taskMeta);
    const profile = normaliseTreeProfile(item.profile);
    const system = normaliseTreeSystemMeta(item.system);
    const status = normaliseTreeStatusMeta(item.status);
    const extras = normaliseNodeExtras(item);
    const payload = {
      id,
      parentId,
      label,
      order,
      updatedAt,
      source: cleanText(item.source, 30) || "manual",
    };
    if (urgent) payload.urgent = true;
    if (details) payload.details = details;
    if (task) payload.task = task;
    if (profile) payload.profile = profile;
    if (system) payload.system = system;
    if (status) payload.status = status;
    if (extras) Object.assign(payload, extras);
    out.push(payload);
  }
  return out;
}

function normaliseInput(parsed) {
  const p = (parsed && typeof parsed === "object") ? parsed : {};
  const schema = cleanText(p.schema, 80);
  const rootExtras = normaliseRootExtras(p);
  if (schema === "portal.mtt.web.v1" && p.data && typeof p.data === "object") {
    const dataExtras = normaliseRootExtras(p.data);
    return {
      schema,
      writtenAt: cleanText(p.writtenAt, 40),
      nodes: normaliseNodes(p.data.mainThoughtTree),
      tombstones: Array.isArray(p.data.mainThoughtTreeTombstones) ? p.data.mainThoughtTreeTombstones : [],
      rootExtras,
      dataExtras,
    };
  }
  if (schema === "portal.sync.v1" && p.data && typeof p.data === "object") {
    const dataExtras = normaliseRootExtras(p.data);
    return {
      schema,
      writtenAt: cleanText(p.writtenAt, 40),
      nodes: normaliseNodes(p.data.mainThoughtTree),
      tombstones: Array.isArray(p.data.mainThoughtTreeTombstones) ? p.data.mainThoughtTreeTombstones : [],
      rootExtras,
      dataExtras,
    };
  }
  if (schema === "portal.pocketlite.changes.v1" && p.snapshot && typeof p.snapshot === "object") {
    const snap = p.snapshot;
    const dataObj = (snap.data && typeof snap.data === "object") ? snap.data : {};
    const dataExtras = normaliseRootExtras(dataObj);
    return {
      schema,
      writtenAt: cleanText(p.exportedAt, 40),
      nodes: normaliseNodes(dataObj.mainThoughtTree),
      tombstones: Array.isArray(dataObj.mainThoughtTreeTombstones) ? dataObj.mainThoughtTreeTombstones : [],
      rootExtras,
      dataExtras,
    };
  }
  if (Array.isArray(p.mainThoughtTree)) {
    return {
      schema: schema || "unknown.mainThoughtTree",
      writtenAt: cleanText(p.writtenAt, 40),
      nodes: normaliseNodes(p.mainThoughtTree),
      tombstones: Array.isArray(p.mainThoughtTreeTombstones) ? p.mainThoughtTreeTombstones : [],
      rootExtras,
      dataExtras: null,
    };
  }
  if (Array.isArray(parsed)) {
    return {
      schema: "array.nodes",
      writtenAt: "",
      nodes: normaliseNodes(parsed),
      tombstones: [],
      rootExtras: null,
      dataExtras: null,
    };
  }
  return { schema: "", writtenAt: "", nodes: [], tombstones: [], rootExtras: null, dataExtras: null };
}

function nodeMap() {
  const m = new Map();
  for (const n of state.nodes) m.set(n.id, n);
  return m;
}

function childrenMap() {
  const byParent = new Map();
  for (const n of state.nodes) {
    const pid = n.parentId || "root";
    if (!byParent.has(pid)) byParent.set(pid, []);
    byParent.get(pid).push(n);
  }
  for (const [parentId, arr] of byParent.entries()) {
    arr.sort((a, b) => compareSiblingOrder(a, b, parentId));
  }
  return byParent;
}

function findChildByLabel(parentId, label) {
  const want = cleanText(label, 120).toLowerCase();
  if (!want) return null;
  const byParent = childrenMap();
  const kids = byParent.get(parentId || "root") || [];
  for (const kid of kids) {
    if (cleanText(kid.label, 220).toLowerCase() === want) return kid;
  }
  return null;
}

function ensurePathNodeUnder(rootParentId, labels) {
  const parts = Array.isArray(labels) ? labels.map((v) => cleanText(v, 120)).filter(Boolean) : [];
  if (parts.length === 0) return null;
  let parentId = cleanText(rootParentId, 80) || "root";
  let current = null;
  for (const part of parts) {
    let child = findChildByLabel(parentId, part);
    if (!child) {
      const id = makeId("node");
      const order = maxSiblingOrder(parentId) + 1;
      child = {
        id,
        parentId,
        label: part,
        source: "manual",
        order,
        updatedAt: nowIso(),
      };
      state.nodes.push(child);
      recordOp({ type: "add_path", id, parentId, label: part });
    }
    current = child;
    parentId = child.id;
  }
  return current;
}

function ensurePathNode(labels) {
  return ensurePathNodeUnder("root", labels);
}

function resolveImportAnchorHeadNode() {
  const map = nodeMap();
  let cur = map.get(state.focusRootId || state.selectedId) || null;
  if (!cur) return null;
  let guard = 0;
  while (cur && cur.parentId && cur.parentId !== "root" && guard < 200) {
    cur = map.get(cur.parentId) || null;
    guard += 1;
  }
  return cur || null;
}

function extractIndentedPathsFromText(rawText) {
  const text = String(rawText || "");
  if (!text.trim()) return [];
  const lines = text.split(/\r?\n/);
  const stack = [];
  const out = [];
  const seen = new Set();
  let nonEmptyLineCount = 0;
  let bulletLineCount = 0;
  let maxDepth = 0;

  for (const rawLine of lines) {
    const lineRaw = String(rawLine || "");
    if (!lineRaw.trim()) continue;
    nonEmptyLineCount += 1;
    const lineTabsNormalised = lineRaw.replace(/\t/g, "  ");
    const indent = (lineTabsNormalised.match(/^\s*/) || [""])[0].length;
    const trimmed = lineTabsNormalised.trim();
    const bulletMatch = trimmed.match(/^(?:[-*+•]|\d+[.)])\s+(.+)$/);
    if (!bulletMatch) continue;
    bulletLineCount += 1;
    let label = cleanText(bulletMatch[1], 220);
    label = label.replace(/^\[[xX ]\]\s+/, "");
    label = label.replace(/^['"](.+)['"]$/, "$1").trim();
    if (!label) continue;

    while (stack.length && indent <= stack[stack.length - 1].indent) stack.pop();
    stack.push({ indent, label });
    if (stack.length < 2) continue;

    maxDepth = Math.max(maxDepth, stack.length);
    const parts = stack.map((s) => cleanText(s.label, 120)).filter(Boolean);
    if (parts.length < 2) continue;
    const key = parts.join("\u0000");
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(parts);
  }

  if (out.length === 0) return [];
  const bulletRatio = nonEmptyLineCount > 0 ? (bulletLineCount / nonEmptyLineCount) : 0;
  if (bulletLineCount < 4) return [];
  if (bulletRatio < 0.7) return [];
  if (maxDepth < 2) return [];
  return out;
}

function parseCaptureSlashPathBatch(rawText) {
  const source = String(rawText || "")
    .replace(/[\u200B-\u200D\uFEFF]/g, "")
    .replace(/\r\n?/g, "\n")
    .replace(/[\u2028\u2029]/g, "\n");
  const withoutCommand = source.replace(/^\s*(?:add|new|create)\s+/i, "");
  const isBoundaryBeforeSlash = (line, slashIndex) => {
    if (slashIndex <= 0) return true;
    const prev = line[slashIndex - 1] || "";
    return /\s/.test(prev) || /[|,;:>\])}]/.test(prev);
  };

  const normalisePathLine = (line) => {
    let cleaned = String(line || "").trim();
    if (!cleaned) return "";
    cleaned = cleaned.replace(/^[>\-*\u2022\u00B7\u25E6\u2023\u25AA\u25CF]+\s*/, "");
    cleaned = cleaned.replace(/^\d+[\.\)]\s*/, "");
    cleaned = cleaned.replace(/^(?:add|new|create)\s+/i, "");
    cleaned = cleaned.replace(/^`+|`+$/g, "");
    const firstSlash = cleaned.indexOf("/");
    if (firstSlash > 0 && /^[^a-z0-9/]+$/i.test(cleaned.slice(0, firstSlash))) {
      cleaned = cleaned.slice(firstSlash);
    }
    const slashCount = (cleaned.match(/\//g) || []).length;
    if (
      !cleaned.startsWith("/") &&
      slashCount >= 2 &&
      !/^[a-z][a-z0-9+.-]*:\/\//i.test(cleaned)
    ) {
      const parts = cleaned
        .split("/")
        .map((part) => cleanText(part, 120))
        .filter(Boolean);
      if (parts.length >= 2) cleaned = `/${parts.join("/")}`;
    }
    return cleanText(cleaned, 900);
  };

  const isPathLine = (line) => {
    const cleaned = normalisePathLine(line);
    if (!cleaned.startsWith("/")) return false;
    return cleaned.replace(/^\/+/, "").includes("/");
  };

  let lineEntries = withoutCommand
    .split("\n")
    .map((line, index) => ({
      lineNumber: index + 1,
      text: normalisePathLine(line),
    }))
    .filter((entry) => !!entry.text && isPathLine(entry.text));
  const initialSinglePathLine = lineEntries.length === 1 ? lineEntries[0] : null;

  // Fallback: some clipboard targets collapse multi-line path lists into one long line.
  if (lineEntries.length < 2) {
    const compact = withoutCommand.replace(/\n+/g, " ").replace(/\s+/g, " ").trim();
    if (!compact) return { matched: false, ok: false };

    let starts = [];
    for (let i = 0; i < compact.length; i += 1) {
      if (compact[i] !== "/") continue;
      if (isBoundaryBeforeSlash(compact, i)) starts.push(i);
    }

    if (starts.length < 2) {
      const firstPathParts = compact
        .replace(/^\/+/, "")
        .split("/")
        .map((part) => cleanText(part, 120))
        .filter(Boolean);
      const seg1 = cleanText(firstPathParts[0], 120);
      const seg2 = cleanText(firstPathParts[1], 120);
      const prefixCandidates = [];
      if (seg1 && seg2) {
        prefixCandidates.push(`/${seg1}/${seg2}/`);
        prefixCandidates.push(`/${seg1}/${seg2}`);
      }
      if (seg1) prefixCandidates.push(`/${seg1}/`);

      for (const token of prefixCandidates) {
        if (!token) continue;
        const tokenStarts = [];
        let from = 0;
        while (from < compact.length) {
          const at = compact.indexOf(token, from);
          if (at < 0) break;
          tokenStarts.push(at);
          from = at + 1;
        }
        if (tokenStarts.length >= 2) {
          starts = tokenStarts;
          break;
        }
      }
    }

    if (starts.length < 2) {
      if (initialSinglePathLine) {
        lineEntries = [initialSinglePathLine];
      } else {
        return { matched: false, ok: false };
      }
    } else {
      lineEntries = starts
        .map((start, idx) => {
          const end = idx + 1 < starts.length ? starts[idx + 1] : compact.length;
          return normalisePathLine(compact.slice(start, end));
        })
        .filter((line) => isPathLine(line))
        .map((line, idx) => ({ lineNumber: idx + 1, text: line }));
      if (lineEntries.length < 2 && initialSinglePathLine) {
        lineEntries = [initialSinglePathLine];
      } else if (lineEntries.length < 2) {
        return { matched: false, ok: false };
      }
    }
  }

  const lines = lineEntries.map((entry, index) => {
    if (index !== 0) return entry;
    const withCommand = entry.text.match(/^(?:add|new|create)\s+(.+)$/i);
    return {
      ...entry,
      text: withCommand ? cleanText(withCommand[1], 900) : entry.text,
    };
  });

  const entries = [];
  for (const lineEntry of lines) {
    const line = String(lineEntry.text || "");
    if (!line.startsWith("/")) {
      return {
        matched: true,
        ok: false,
        message: `Line ${lineEntry.lineNumber}: use /path/item format.`,
      };
    }
    if (!line.replace(/^\/+/, "").includes("/")) {
      return {
        matched: true,
        ok: false,
        message: `Line ${lineEntry.lineNumber}: use /path/item format.`,
      };
    }
    const parts = line
      .replace(/^\/+/, "")
      .split("/")
      .map((part) => cleanText(part, 120))
      .filter(Boolean);
    if (parts.length < 2) {
      return {
        matched: true,
        ok: false,
        message: `Line ${lineEntry.lineNumber}: use /path/item format.`,
      };
    }
    entries.push({
      lineNumber: lineEntry.lineNumber,
      parts,
    });
  }

  if (entries.length === 0) return { matched: false, ok: false };
  if (entries.length === 1) {
    const compactSource = withoutCommand.replace(/\s+/g, " ").trim();
    const slashCount = (compactSource.match(/\//g) || []).length;
    const looksSingleLine = compactSource.length > 0 && !withoutCommand.includes("\n");
    // Safety: very long single-line slash input is almost always a collapsed list.
    // Reject it loudly so we never silently import one giant malformed branch.
    if (looksSingleLine && slashCount >= 12) {
      return {
        matched: true,
        ok: false,
        message: "Path list looks collapsed into one line. Use one /path/item per line before import.",
      };
    }
  }
  return { matched: true, ok: true, entries };
}

function extractSlashPathsFromText(rawText) {
  const text = String(rawText || "");
  if (!text.trim()) return [];
  const slashBatch = parseCaptureSlashPathBatch(text);
  if (slashBatch.matched) {
    if (!slashBatch.ok) {
      lastPathExtractMeta = {
        strictAbsoluteMode: false,
        ignoredNonAbsoluteCount: 0,
        nonEmptyPrepared: 0,
        absolutePrepared: 0,
        extractedCount: 0,
        source: "slash_batch_error",
        parseError: cleanText(slashBatch.message, 220),
      };
      return [];
    }
    const out = [];
    const seen = new Set();
    for (const entry of slashBatch.entries) {
      const parts = Array.isArray(entry?.parts)
        ? entry.parts.map((part) => cleanText(part, 120)).filter(Boolean)
        : [];
      if (parts.length < 2) continue;
      const key = parts.join("\u0000");
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(parts);
    }
    lastPathExtractMeta = {
      strictAbsoluteMode: true,
      ignoredNonAbsoluteCount: 0,
      nonEmptyPrepared: slashBatch.entries.length,
      absolutePrepared: slashBatch.entries.length,
      extractedCount: out.length,
      source: "slash_batch",
      parseError: "",
    };
    return out;
  }
  const out = [];
  const seen = new Set();
  const lines = text.split(/\r?\n/);
  const cleanImportLine = (rawLine) => {
    let line = String(rawLine || "").trim();
    if (!line) return "";
    line = line.replace(/^>+\s+/, "");
    line = line.replace(/^[-*+]\s+\[[xX ]\]\s+/, "");
    line = line.replace(/^[*\-+•]\s+/, "");
    line = line.replace(/^\d+[.)]\s+/, "");
    line = line.replace(/^add\s+/i, "").trim();
    line = line.replace(/^['"](.+)['"]\s*[,;]?$/, "$1").trim();
    return line;
  };
  const prepared = lines.map((rawLine) => cleanImportLine(rawLine));
  let nonEmptyPrepared = 0;
  let absolutePrepared = 0;
  for (const preparedLine of prepared) {
    if (!preparedLine) continue;
    nonEmptyPrepared += 1;
    if (preparedLine.startsWith("/")) absolutePrepared += 1;
  }
  // Hardening: if a paste is mostly absolute paths, ignore non-absolute stragglers
  // so wrapped text or sentence fragments cannot create unintended nodes.
  const strictAbsoluteMode = nonEmptyPrepared > 0
    && absolutePrepared >= 3
    && (absolutePrepared / nonEmptyPrepared) >= 0.3;
  let ignoredNonAbsoluteCount = 0;

  for (let line of prepared) {
    if (!line) continue;
    if (!/[\\/]/.test(line)) {
      if (/\s*->\s*/.test(line) || /\s*>\s*/.test(line)) {
        line = line.replace(/\s*(?:->|>)\s*/g, "/");
      } else if (/\s*\|\s*/.test(line)) {
        line = line.replace(/\s*\|\s*/g, "/");
      }
    }
    line = line.replace(/\\/g, "/");
    const hasHttpPrefix = /^https?:\/\//i.test(line);
    line = line.replace(/\s*\/\s*/g, "/");
    line = line.replace(/\/{2,}/g, "/");
    let candidate = line;
    if (!candidate.startsWith("/")) {
      if (strictAbsoluteMode) {
        ignoredNonAbsoluteCount += 1;
        continue;
      }
      const hasLetters = /[A-Za-z]/.test(candidate);
      const rawParts = candidate.split("/").map((part) => cleanText(part, 120)).filter(Boolean);
      const looksLikePath = rawParts.length >= 3;
      if (hasHttpPrefix || !hasLetters || !looksLikePath) continue;
      candidate = `/${candidate}`;
    }
    const parts = candidate
      .split("/")
      .map((part) => cleanText(part, 120))
      .filter(Boolean);
    if (parts.length === 0) continue;
    const key = parts.join("\u0000");
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(parts);
  }
  if (out.length > 0) {
    lastPathExtractMeta = {
      strictAbsoluteMode,
      ignoredNonAbsoluteCount,
      nonEmptyPrepared,
      absolutePrepared,
      extractedCount: out.length,
      source: "slash",
      parseError: "",
    };
    return out;
  }
  const indented = extractIndentedPathsFromText(rawText);
  lastPathExtractMeta = {
    strictAbsoluteMode: false,
    ignoredNonAbsoluteCount: 0,
    nonEmptyPrepared,
    absolutePrepared,
    extractedCount: indented.length,
    source: indented.length > 0 ? "indented" : "none",
    parseError: "",
  };
  return indented;
}

function isMostlyFlatPathList(paths) {
  const safe = Array.isArray(paths) ? paths : [];
  if (safe.length < 8) return false;
  let singleSeg = 0;
  for (const p of safe) {
    if (Array.isArray(p) && p.length === 1) singleSeg += 1;
  }
  return singleSeg / safe.length >= 0.8;
}

function buildPathImportPlan(paths, anchorHead) {
  const topLevelNames = new Set();
  for (const n of state.nodes) {
    if ((n.parentId || "root") !== "root") continue;
    const label = cleanText(n.label, 220).toLowerCase();
    if (label) topLevelNames.add(label);
  }
  const keySep = "\u0000";
  const childByKey = new Map();
  for (const n of state.nodes) {
    const pid = cleanText(n.parentId, 80) || "root";
    const label = cleanText(n.label, 120).toLowerCase();
    if (!label) continue;
    childByKey.set(`${pid}${keySep}${label}`, n.id);
  }
  let virtualCount = 0;
  let newNodeCount = 0;
  let newTopLevelCount = 0;
  const newTopLevelLabels = new Set();
  const entries = [];
  for (const parts of paths) {
    let effectiveParts = parts.slice();
    if (anchorHead && effectiveParts.length > 0) {
      const first = cleanText(effectiveParts[0], 120).toLowerCase();
      if (topLevelNames.has(first)) effectiveParts = effectiveParts.slice(1);
    }
    if (effectiveParts.length === 0) continue;
    let parentId = anchorHead ? anchorHead.id : "root";
    let createdInPath = 0;
    for (const rawPart of effectiveParts) {
      const part = cleanText(rawPart, 120);
      if (!part) continue;
      const key = `${parentId}${keySep}${part.toLowerCase()}`;
      let childId = childByKey.get(key) || "";
      if (!childId) {
        virtualCount += 1;
        childId = `virt_${virtualCount}`;
        childByKey.set(key, childId);
        createdInPath += 1;
        newNodeCount += 1;
        if (parentId === "root") {
          newTopLevelCount += 1;
          if (part) newTopLevelLabels.add(part);
        }
      }
      parentId = childId;
    }
    entries.push({
      originalParts: parts.slice(),
      effectiveParts,
      createdInPath,
    });
  }
  const existingCount = entries.filter((e) => e.createdInPath === 0).length;
  return {
    entries,
    pathCount: entries.length,
    newNodeCount,
    existingCount,
    newTopLevelCount,
    newTopLevelLabels: Array.from(newTopLevelLabels),
  };
}

function queuePathImport(rawText, options = {}) {
  const opts = {
    requireAnchor: false,
    sourceInfo: null,
    ...options,
  };
  const paths = extractSlashPathsFromText(rawText);
  const importMeta = lastPathExtractMeta && typeof lastPathExtractMeta === "object"
    ? lastPathExtractMeta
    : null;
  const parseError = importMeta
    ? cleanText(importMeta.parseError, 220)
    : "";
  if (paths.length === 0) {
    if (parseError) {
      setStatus(parseError, "warn");
      return -1;
    }
    return 0;
  }
  const ignoredNonAbsoluteCount = importMeta && importMeta.strictAbsoluteMode
    ? Math.max(0, Number(importMeta.ignoredNonAbsoluteCount || 0))
    : 0;
  let anchorHead = resolveImportAnchorHeadNode();
  if (!anchorHead && isMostlyFlatPathList(paths)) {
    setStatus("Import looks like a flat list. Focus a destination node first, then import.", "warn");
    return -1;
  }
  let inferredTop = "";
  if (Array.isArray(paths) && paths.length > 0) {
    const tops = [];
    let validTop = true;
    for (const parts of paths) {
      const first = Array.isArray(parts) && parts.length > 0 ? cleanText(parts[0], 120) : "";
      if (!first) {
        validTop = false;
        break;
      }
      tops.push(first);
    }
    if (validTop) {
      const unique = Array.from(new Set(tops.map((x) => x.toLowerCase())));
      if (unique.length === 1) inferredTop = tops[0];
    }
  }
  if (opts.requireAnchor && !anchorHead) {
    const roots = state.nodes.filter((n) => (n.parentId || "root") === "root");
    if (roots.length > 0) {
      const byLabel = new Map();
      for (const root of roots) {
        const key = cleanText(root.label, 220).toLowerCase();
        if (!key) continue;
        if (!byLabel.has(key)) byLabel.set(key, root);
      }
      const matched = [];
      let canInfer = true;
      for (const parts of paths) {
        const first = Array.isArray(parts) && parts.length > 0 ? cleanText(parts[0], 220).toLowerCase() : "";
        if (!first) {
          canInfer = false;
          break;
        }
        const root = byLabel.get(first);
        if (!root) {
          canInfer = false;
          break;
        }
        matched.push(root.id);
      }
      if (canInfer) {
        const uniqueIds = Array.from(new Set(matched));
        if (uniqueIds.length === 1) {
          const map = nodeMap();
          anchorHead = map.get(uniqueIds[0]) || null;
        }
      }
    }
  }
  if (opts.requireAnchor && !anchorHead && !inferredTop) {
    setStatus("Pick a head node first, then import.", "warn");
    return -1;
  }
  const plan = buildPathImportPlan(paths, anchorHead);
  if (!plan || plan.pathCount === 0) {
    setStatus("No valid path lines to import.", "warn");
    return -1;
  }
  const hasSharedFirstSegment = !!inferredTop;
  if (!anchorHead && !hasSharedFirstSegment && plan.newTopLevelCount >= 8) {
    setStatus(
      `Safety check: import would create ${plan.newTopLevelCount} new top-level nodes. Focus a destination first, or use a shared first segment path like /Role Map/...`,
      "warn"
    );
    return -1;
  }
  const pending = {
    anchorHeadId: anchorHead ? anchorHead.id : "",
    autoAnchorHeadLabel: (!anchorHead && hasSharedFirstSegment) ? inferredTop : "",
    sourceInfo: opts.sourceInfo && typeof opts.sourceInfo === "object" ? opts.sourceInfo : null,
    entries: plan.entries,
    pathCount: plan.pathCount,
    newNodeCount: plan.newNodeCount,
    existingCount: plan.existingCount,
    newTopLevelCount: plan.newTopLevelCount,
    ignoredNonAbsoluteCount,
  };
  const targetText = anchorHead
    ? getPath(anchorHead.id)
    : (inferredTop || "inferred root path");
  let importTargetNode = anchorHead || null;
  if (!importTargetNode && inferredTop) {
    importTargetNode = findChildByLabel("root", inferredTop);
  }
  if (importTargetNode) {
    state.selectedId = importTargetNode.id;
    state.focusRootId = importTargetNode.id;
    state.collapsed.delete(importTargetNode.id);
    expandPathToNode(importTargetNode.id);
  }
  const ignoredText = ignoredNonAbsoluteCount > 0
    ? ` Ignored ${ignoredNonAbsoluteCount} non-path line${ignoredNonAbsoluteCount === 1 ? "" : "s"}.`
    : "";
  const anchorModeText = (!anchorHead && hasSharedFirstSegment)
    ? " Auto-anchor: first segment."
    : "";
  setStatus(
    `Importing ${plan.pathCount} path line${plan.pathCount === 1 ? "" : "s"} to ${targetText}.${anchorModeText}${ignoredText}`,
    "ok"
  );
  refreshMeta();
  renderTree();
  persistPipSnapshot();
  if (importTargetNode && el.treeRoot) {
    requestAnimationFrame(() => {
      const escaped = (window.CSS && typeof window.CSS.escape === "function")
        ? window.CSS.escape(importTargetNode.id)
        : String(importTargetNode.id).replace(/"/g, '\\"');
      const row = el.treeRoot.querySelector(`[data-node-id="${escaped}"]`);
      if (!row) return;
      row.scrollIntoView({ block: "nearest", inline: "nearest" });
    });
  }
  pendingPathImport = pending;
  return commitPendingPathImport();
}

function commitPendingPathImport() {
  if (!pendingPathImport) {
    setStatus("Nothing to import.", "warn");
    return 0;
  }
  const pending = pendingPathImport;
  pendingPathImport = null;
  return commitPathImport(pending);
}

function cancelPendingPathImport() {
  if (!pendingPathImport) {
    setStatus("No pending import.", "warn");
    return false;
  }
  pendingPathImport = null;
  setStatus("Import cancelled.", "warn");
  return true;
}

function undoLastImportBatch() {
  undoMostRecentTreeMutation();
}

function commitPathImport(pending) {
  if (!pending || !Array.isArray(pending.entries) || pending.entries.length === 0) {
    setStatus("Nothing to import.", "warn");
    return 0;
  }
  // Safety snapshot before bulk import, so Restore last can recover quickly.
  const safetyPayload = {
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
  saveLastSaveSnapshot(safetyPayload);
  const map = nodeMap();
  let anchorHead = pending.anchorHeadId ? (map.get(pending.anchorHeadId) || null) : null;
  if (!anchorHead) {
    const autoAnchorLabel = cleanText(pending.autoAnchorHeadLabel, 120);
    if (autoAnchorLabel) {
      anchorHead = findChildByLabel("root", autoAnchorLabel) || ensurePathNode([autoAnchorLabel]);
    }
  }
  const beforeIds = new Set(state.nodes.map((n) => n.id));
  let lastNode = null;
  let focusNode = null;
  for (const entry of pending.entries) {
    let parts = Array.isArray(entry.effectiveParts) ? entry.effectiveParts.slice() : [];
    if (anchorHead && parts.length > 0) {
      const first = cleanText(parts[0], 120).toLowerCase();
      const anchorLabel = cleanText(anchorHead.label, 120).toLowerCase();
      if (first && anchorLabel && first === anchorLabel) parts = parts.slice(1);
    }
    if (parts.length === 0) {
      if (!focusNode && anchorHead) focusNode = anchorHead;
      continue;
    }
    lastNode = anchorHead
      ? ensurePathNodeUnder(anchorHead.id, parts)
      : ensurePathNode(parts);
    if (!focusNode) {
      const firstPart = cleanText(parts[0], 120);
      if (firstPart) {
        focusNode = anchorHead
          ? findChildByLabel(anchorHead.id, firstPart)
          : findChildByLabel("root", firstPart);
      }
    }
  }
  const createdIds = state.nodes
    .map((n) => n.id)
    .filter((id) => !beforeIds.has(id));
  if (!focusNode) focusNode = lastNode || anchorHead || null;
  if (focusNode) {
    state.selectedId = focusNode.id;
    state.focusRootId = focusNode.id;
    state.collapsed.delete(focusNode.id);
    expandPathToNode(focusNode.id);
  }
  if (el.search && cleanText(el.search.value, 160)) el.search.value = "";
  if (pending.sourceInfo && typeof pending.sourceInfo === "object") {
    state.source = {
      schema: cleanText(pending.sourceInfo.schema, 80) || "path.lines",
      fileName: cleanText(pending.sourceInfo.fileName, 120),
      writtenAt: cleanText(pending.sourceInfo.writtenAt, 40),
    };
  }
  recordOp({
    type: "import_paths",
    pathCount: pending.pathCount || 0,
    created: createdIds.length,
    anchor: pending.anchorHeadId || "root",
  });
  refreshMeta();
  renderTree();
  persistPipSnapshot();
  if (focusNode && el.treeRoot) {
    requestAnimationFrame(() => {
      const escaped = (window.CSS && typeof window.CSS.escape === "function")
        ? window.CSS.escape(focusNode.id)
        : String(focusNode.id).replace(/"/g, '\\"');
      const row = el.treeRoot.querySelector(`[data-node-id="${escaped}"]`);
      if (!row) return;
      row.scrollIntoView({ block: "nearest", inline: "nearest" });
      row.classList.add("importFlash");
      if (importRevealTimer) {
        clearTimeout(importRevealTimer);
        importRevealTimer = null;
      }
      importRevealTimer = window.setTimeout(() => {
        row.classList.remove("importFlash");
      }, 1200);
    });
  }
  const importPath = focusNode ? getPath(focusNode.id) : (anchorHead ? getPath(anchorHead.id) : "");
  const ignoredNonAbsoluteCount = Math.max(0, Number(pending.ignoredNonAbsoluteCount || 0));
  const ignoredText = ignoredNonAbsoluteCount > 0
    ? ` Ignored ${ignoredNonAbsoluteCount} non-path line${ignoredNonAbsoluteCount === 1 ? "" : "s"}.`
    : "";
  setStatus(importPath ? `Imported to: ${importPath}.${ignoredText}` : `Imported ${pending.pathCount} path line${pending.pathCount === 1 ? "" : "s"}.${ignoredText}`, "ok");
  refocusTreeNavigation(state.selectedId || (focusNode ? focusNode.id : ""));
  return pending.pathCount || 0;
}
