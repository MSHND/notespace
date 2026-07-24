/* Pure text/date/node normalisation and completed-bucket helpers. */

function nowIso() {
  return new Date().toISOString();
}

function cleanText(v, max = 220) {
  return String(v || "").replace(/\s+/g, " ").trim().slice(0, max);
}

function normaliseUrgentFlag(value) {
  if (typeof value === "boolean") return value;
  const raw = cleanText(value, 16).toLowerCase();
  if (!raw) return false;
  return raw === "1" || raw === "true" || raw === "yes" || raw === "y";
}

function normaliseCopyContextFlag(value) {
  if (typeof value === "boolean") return value;
  const raw = cleanText(value, 24).toLowerCase();
  if (!raw) return false;
  return raw === "1" || raw === "true" || raw === "yes" || raw === "y" || raw === "on" || raw === "copy";
}

function parseUrgentDetailsBody(rawValue) {
  const source = String(rawValue || "");
  const hasUrgentTag = /(^|\s)#urgent\b/i.test(source);
  const details = normaliseDetails(source, 4000);
  return {
    details,
    urgent: hasUrgentTag,
  };
}

function composeDetailsEditorValue(rawValue, urgentValue) {
  return normaliseDetails(rawValue, 4000);
}

function hasCompletionTag(rawValue) {
  const source = String(rawValue || "");
  return /(^|\s)#completed?\b/i.test(source);
}

function stripCompletionTags(rawValue) {
  const source = String(rawValue || "");
  return source.replace(/(^|\s)#completed?\b/gi, "$1");
}

function normaliseDetails(v, max = 4000) {
  const raw = String(v || "").replace(/\r/g, "").replace(/\t/g, "  ");
  if (!raw.trim()) return "";
  const lines = raw.split("\n").map((line) => line.replace(/[ \t]+$/g, ""));
  const collapsed = lines.join("\n").replace(/\n{3,}/g, "\n\n");
  return collapsed.trim().slice(0, max);
}

function normaliseIsoTimestamp(value) {
  const raw = String(value || "").trim();
  if (!raw) return "";
  const ms = Date.parse(raw);
  if (!Number.isFinite(ms)) return "";
  return new Date(ms).toISOString();
}

function normaliseDateYmd(value) {
  const raw = String(value || "").trim();
  return /^\d{4}-\d{2}-\d{2}$/.test(raw) ? raw : "";
}

function localTodayYmd() {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function nodeAttentionState(node) {
  return normaliseUrgentFlag(node?.urgent) ? "manual_urgent" : "";
}

function uniqueTextArray(raw, maxItems = 200, maxLen = 80) {
  if (!Array.isArray(raw)) return [];
  const out = [];
  const seen = new Set();
  for (const item of raw) {
    const value = cleanText(item, maxLen);
    const key = value.toLowerCase();
    if (!value || seen.has(key)) continue;
    seen.add(key);
    out.push(value);
    if (out.length >= maxItems) break;
  }
  return out;
}

function normaliseTreeTaskMeta(value) {
  if (!value || typeof value !== "object") return null;
  const statusRaw = cleanText(value.status, 40).toLowerCase().replace(/[\s-]+/g, "_");
  const status = ["open", "in_progress", "blocked", "done"].includes(statusRaw) ? statusRaw : "";
  const priorityRaw = cleanText(value.priority, 24).toLowerCase();
  const priority = ["low", "normal", "high", "urgent"].includes(priorityRaw) ? priorityRaw : "";
  const followUpBy = normaliseDateYmd(value.followUpBy || value.follow_up_by);
  const waitingFor = cleanText(value.waitingFor || value.waiting_for || value.owner, 120);
  const contactTypeRaw = cleanText(value.contactType || value.contact_type, 40).toLowerCase();
  const contactType = ["email", "phone", "sms", "teams", "in_person", "other"].includes(contactTypeRaw) ? contactTypeRaw : "";
  const projectPath = cleanText(value.projectPath || value.project || value.path, 320);
  const notes = normaliseDetails(value.notes, 2400);
  const createdAt = normaliseIsoTimestamp(value.createdAt);
  const updatedAt = normaliseIsoTimestamp(value.updatedAt);
  const tags = uniqueTextArray(value.tags, 80, 40);
  const done = typeof value.done === "boolean" ? value.done : null;

  const out = {};
  if (status) out.status = status;
  if (priority) out.priority = priority;
  if (followUpBy) out.followUpBy = followUpBy;
  if (waitingFor) out.waitingFor = waitingFor;
  if (contactType) out.contactType = contactType;
  if (projectPath) out.projectPath = projectPath;
  if (notes) out.notes = notes;
  if (createdAt) out.createdAt = createdAt;
  if (updatedAt) out.updatedAt = updatedAt;
  if (tags.length > 0) out.tags = tags;
  if (done !== null) out.done = done;

  return Object.keys(out).length > 0 ? out : null;
}

function normaliseTreeProfile(value) {
  if (!value || typeof value !== "object") return null;
  const keywords = uniqueTextArray(value.keywords, 240, 80);
  const entities = uniqueTextArray(value.entities, 240, 80);
  const people = uniqueTextArray(value.people, 240, 120);
  const usageCountRaw = Number(value.usageCount);
  const usageCount = Number.isFinite(usageCountRaw) ? Math.max(0, Math.round(usageCountRaw)) : 0;
  const lastUsed = normaliseIsoTimestamp(value.lastUsed);
  const createdAt = normaliseIsoTimestamp(value.createdAt);
  const updatedAt = normaliseIsoTimestamp(value.updatedAt);

  const corrections = {};
  if (value.corrections && typeof value.corrections === "object" && !Array.isArray(value.corrections)) {
    const entries = Object.entries(value.corrections);
    for (let i = 0; i < entries.length; i += 1) {
      const [rawKey, rawRule] = entries[i];
      if (i >= 500) break;
      const key = cleanText(rawKey, 80).toLowerCase();
      if (!key || !rawRule || typeof rawRule !== "object") continue;
      const preferredNodePath = cleanText(rawRule.preferredNodePath, 320);
      const avoidNodePath = cleanText(rawRule.avoidNodePath, 320);
      if (!preferredNodePath && !avoidNodePath) continue;
      corrections[key] = {};
      if (preferredNodePath) corrections[key].preferredNodePath = preferredNodePath;
      if (avoidNodePath) corrections[key].avoidNodePath = avoidNodePath;
    }
  }

  const out = {};
  if (keywords.length > 0) out.keywords = keywords;
  if (entities.length > 0) out.entities = entities;
  if (people.length > 0) out.people = people;
  if (usageCount > 0) out.usageCount = usageCount;
  if (lastUsed) out.lastUsed = lastUsed;
  if (createdAt) out.createdAt = createdAt;
  if (updatedAt) out.updatedAt = updatedAt;
  if (Object.keys(corrections).length > 0) out.corrections = corrections;

  return Object.keys(out).length > 0 ? out : null;
}

function normaliseTreeSystemMeta(value) {
  if (!value || typeof value !== "object") return null;
  const source = value;
  const kind = cleanText(source.kind, 40).toLowerCase();
  const bucketType = cleanText(source.bucketType, 40).toLowerCase();
  const managed = source.managed === true;
  const pinnedLast = source.pinnedLast === true;

  const out = {};
  if (kind) out.kind = kind;
  if (bucketType) out.bucketType = bucketType;
  if (managed) out.managed = true;
  if (pinnedLast) out.pinnedLast = true;
  return Object.keys(out).length > 0 ? out : null;
}

function normaliseTreeStatusMeta(value) {
  if (!value || typeof value !== "object") return null;
  const source = value;
  const completed = source.completed === true;
  const completedAt = normaliseIsoTimestamp(source.completedAt);

  const out = {};
  if (completed) out.completed = true;
  if (completedAt) out.completedAt = completedAt;
  return Object.keys(out).length > 0 ? out : null;
}

function isCompletedSystemBucketNode(node) {
  const system = normaliseTreeSystemMeta(node?.system);
  if (!system) return false;
  const kind = cleanText(system.kind, 40).toLowerCase();
  const bucketType = cleanText(system.bucketType, 40).toLowerCase();
  return kind === "bucket" && bucketType === "completed" && system.managed === true;
}

function isManagedSystemBucketNode(node) {
  const system = normaliseTreeSystemMeta(node?.system);
  if (!system) return false;
  return cleanText(system.kind, 40).toLowerCase() === "bucket" && system.managed === true;
}

function isPinnedCompletedBucketNode(node) {
  const system = normaliseTreeSystemMeta(node?.system);
  if (!system) return false;
  const kind = cleanText(system.kind, 40).toLowerCase();
  const bucketType = cleanText(system.bucketType, 40).toLowerCase();
  return kind === "bucket" && bucketType === "completed" && system.managed === true && system.pinnedLast === true;
}

function compareSiblingOrder(left, right, parentId) {
  const safeParentId = cleanText(parentId, 80) || "root";
  const leftPinnedCompleted = isPinnedCompletedBucketNode(left);
  const rightPinnedCompleted = isPinnedCompletedBucketNode(right);
  if (leftPinnedCompleted !== rightPinnedCompleted) return leftPinnedCompleted ? 1 : -1;
  const byOrder = (Number(left?.order) || 0) - (Number(right?.order) || 0);
  if (byOrder !== 0) return byOrder;
  return cleanText(left?.label, 220).localeCompare(cleanText(right?.label, 220));
}

function findCompletedSystemBucketChildNode(parentId) {
  const safeParentId = cleanText(parentId, 80) || "root";
  return state.nodes.find((node) => {
    if (!node || ((node.parentId || "root") !== safeParentId)) return false;
    return isCompletedSystemBucketNode(node);
  }) || null;
}

function pinCompletedBucketToParentTail(parentId, bucketId) {
  const safeParentId = cleanText(parentId, 80) || "root";
  const id = cleanText(bucketId, 80);
  if (!id) return;
  const bucket = state.nodes.find((node) => cleanText(node?.id, 80) === id) || null;
  if (!bucket) return;
  let maxOrder = 1000;
  for (const node of state.nodes) {
    if (!node) continue;
    if (cleanText(node.id, 80) === id) continue;
    if ((node.parentId || "root") !== safeParentId) continue;
    const order = Number(node.order);
    if (Number.isFinite(order) && order > maxOrder) maxOrder = order;
  }
  const nextOrder = maxOrder + 10;
  if (Number(bucket.order) !== nextOrder) bucket.order = nextOrder;
}

function ensureCompletedSystemBucketChildNode(parentId) {
  const safeParentId = cleanText(parentId, 80) || "root";
  let bucket = findCompletedSystemBucketChildNode(safeParentId);
  let created = false;
  if (!bucket) {
    bucket = {
      id: makeId("node"),
      parentId: safeParentId,
      label: "Completed",
      source: "system",
      order: maxSiblingOrder(safeParentId) + 1,
      updatedAt: nowIso(),
      system: {
        kind: "bucket",
        bucketType: "completed",
        managed: true,
        pinnedLast: true,
      },
    };
    state.nodes.push(bucket);
    created = true;
  } else {
    bucket.label = "Completed";
    bucket.source = "system";
    bucket.system = {
      kind: "bucket",
      bucketType: "completed",
      managed: true,
      pinnedLast: true,
    };
    bucket.updatedAt = nowIso();
  }
  pinCompletedBucketToParentTail(safeParentId, bucket.id);
  return { bucket, created };
}

function moveNodeIntoCompletedSystemBucket(nodeId) {
  const id = cleanText(nodeId, 80);
  if (!id) return { moved: false, reason: "missing_node_id" };
  const map = nodeMap();
  const node = map.get(id) || null;
  if (!node) return { moved: false, reason: "missing_node" };
  if (isManagedSystemBucketNode(node)) return { moved: false, reason: "system_bucket" };

  const parentId = cleanText(node.parentId, 80) || "root";
  const parentNode = parentId === "root" ? null : (map.get(parentId) || null);
  if (parentNode && isCompletedSystemBucketNode(parentNode)) {
    return { moved: false, reason: "already_in_completed_bucket" };
  }
  if (parentId !== "root" && !parentNode) return { moved: false, reason: "missing_parent" };

  const ensured = ensureCompletedSystemBucketChildNode(parentId);
  const bucket = ensured.bucket;
  if (!bucket) return { moved: false, reason: "missing_bucket" };
  if (cleanText(bucket.id, 80) === id) return { moved: false, reason: "bucket_node" };

  node.parentId = bucket.id;
  node.order = maxSiblingOrder(bucket.id) + 1;
  const prevStatus = normaliseTreeStatusMeta(node.status) || {};
  node.status = {
    ...prevStatus,
    completed: true,
    completedAt: nowIso(),
  };
  node.updatedAt = nowIso();
  pinCompletedBucketToParentTail(parentId, bucket.id);
  return { moved: true, bucketId: bucket.id, bucketCreated: !!ensured.created };
}

const RESERVED_NODE_KEYS = new Set([
  "id",
  "parentId",
  "label",
  "order",
  "updatedAt",
  "source",
  "due",
  "urgent",
  "details",
  "editor",
  // Retired node.pe stays reserved so it is discarded rather than revived as a generic extra.
  "pe",
  "task",
  "taskMeta",
  "profile",
  "system",
  "status",
]);

const RESERVED_ROOT_KEYS = new Set([
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
]);

function safeJsonClone(value, maxChars = 8000) {
  try {
    const text = JSON.stringify(value);
    if (!text || text.length > maxChars) return null;
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function normaliseNodeExtras(item) {
  if (!item || typeof item !== "object" || Array.isArray(item)) return null;
  const out = {};
  let kept = 0;
  for (const [rawKey, rawValue] of Object.entries(item)) {
    if (kept >= 24) break;
    const key = cleanText(rawKey, 48);
    if (!key || RESERVED_NODE_KEYS.has(key)) continue;
    if (!/^[a-zA-Z0-9_.:-]+$/.test(key)) continue;

    if (typeof rawValue === "string") {
      out[key] = rawValue.slice(0, 1200);
      kept += 1;
      continue;
    }
    if (typeof rawValue === "number") {
      if (!Number.isFinite(rawValue)) continue;
      out[key] = rawValue;
      kept += 1;
      continue;
    }
    if (typeof rawValue === "boolean" || rawValue === null) {
      out[key] = rawValue;
      kept += 1;
      continue;
    }

    const cloned = safeJsonClone(rawValue, 8000);
    if (cloned === null) continue;
    out[key] = cloned;
    kept += 1;
  }
  return kept > 0 ? out : null;
}

function normaliseRootExtras(item) {
  if (!item || typeof item !== "object" || Array.isArray(item)) return null;
  const out = {};
  let kept = 0;
  for (const [rawKey, rawValue] of Object.entries(item)) {
    if (kept >= 32) break;
    const key = cleanText(rawKey, 64);
    if (!key || RESERVED_ROOT_KEYS.has(key)) continue;
    if (!/^[a-zA-Z0-9_.:-]+$/.test(key)) continue;

    if (typeof rawValue === "string") {
      out[key] = rawValue.slice(0, 2000);
      kept += 1;
      continue;
    }
    if (typeof rawValue === "number") {
      if (!Number.isFinite(rawValue)) continue;
      out[key] = rawValue;
      kept += 1;
      continue;
    }
    if (typeof rawValue === "boolean" || rawValue === null) {
      out[key] = rawValue;
      kept += 1;
      continue;
    }

    const cloned = safeJsonClone(rawValue, 12000);
    if (cloned === null) continue;
    out[key] = cloned;
    kept += 1;
  }
  return kept > 0 ? out : null;
}
