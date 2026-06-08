#!/usr/bin/env node
/* Pocket repo health check. Read-only. */
const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..");
let failures = 0;

function read(rel) {
  const file = path.join(root, rel);
  try { return fs.readFileSync(file, "utf8"); }
  catch (error) { fail(rel, "missing or unreadable"); return ""; }
}

function ok(label, detail = "") {
  console.log(`ok   ${label}${detail ? " - " + detail : ""}`);
}

function fail(label, detail = "") {
  failures += 1;
  console.log(`fail ${label}${detail ? " - " + detail : ""}`);
}

function warn(label, detail = "") {
  console.log(`warn ${label}${detail ? " - " + detail : ""}`);
}

function checkExists(rel) {
  if (fs.existsSync(path.join(root, rel))) ok(rel, "exists");
  else fail(rel, "missing");
}

function checkEnds(rel, ending) {
  const text = read(rel).trimEnd();
  if (!text) return;
  if (text.endsWith(ending)) ok(rel, `ends with ${ending}`);
  else fail(rel, `does not end with ${ending}`);
}

function repoRel(file) {
  const rel = path.relative(root, file);
  const label = rel.startsWith("..") || path.isAbsolute(rel) ? file : rel;
  return label.replace(/\\/g, "/");
}

function collectJsonFiles(dir, files) {
  if (!fs.existsSync(dir)) return;
  const stack = [dir];
  while (stack.length) {
    const current = stack.pop();
    let entries = [];
    try { entries = fs.readdirSync(current, { withFileTypes: true }); }
    catch (error) { warn(repoRel(current), "unreadable data fixture directory"); continue; }
    entries.forEach(entry => {
      const file = path.join(current, entry.name);
      if (entry.isDirectory()) stack.push(file);
      else if (entry.isFile() && entry.name.toLowerCase().endsWith(".json")) files.push(file);
    });
  }
}

function addCandidate(files, input) {
  if (!input) return;
  const file = path.isAbsolute(input) ? input : path.join(root, input);
  files.push(path.normalize(file));
}

function suppliedDataFiles() {
  const files = [];
  String(process.env.POCKET_CHECK_DATA || "").split(path.delimiter).forEach(input => addCandidate(files, input.trim()));
  return Array.from(new Set(files));
}

function candidateDataFiles() {
  const files = suppliedDataFiles();
  [
    "data",
    "fixtures",
    "samples",
    "sample-data",
    path.join("test", "fixtures"),
    path.join("tests", "fixtures"),
    path.join("tools", "fixtures")
  ].forEach(rel => collectJsonFiles(path.join(root, rel), files));
  [
    "pocket-data.json",
    "pocket-export.json",
    "workspace.json",
    "sample.json",
    "sample-data.json",
    "data.json"
  ].forEach(rel => {
    const file = path.join(root, rel);
    if (fs.existsSync(file)) files.push(file);
  });
  return Array.from(new Set(files));
}

function parseJsonFile(file, required) {
  let text = "";
  try { text = fs.readFileSync(file, "utf8"); }
  catch (error) {
    if (required) fail(repoRel(file), "supplied PE check data is missing or unreadable");
    return null;
  }
  try { return JSON.parse(text.replace(/^\uFEFF/, "")); }
  catch (error) {
    if (required) fail(repoRel(file), "supplied PE check data is not valid JSON");
    else warn(repoRel(file), "sample/data fixture is not valid JSON");
    return null;
  }
}

function findNodeById(value, id, seen = new Set()) {
  if (!value || typeof value !== "object") return null;
  if (seen.has(value)) return null;
  seen.add(value);
  if (!Array.isArray(value) && value.id === id) return value;
  if (Array.isArray(value)) {
    for (const item of value) {
      const found = findNodeById(item, id, seen);
      if (found) return found;
    }
    return null;
  }
  for (const [key, child] of Object.entries(value)) {
    if (key === id && child && typeof child === "object") return child;
    const found = findNodeById(child, id, seen);
    if (found) return found;
  }
  return null;
}

function outlineCount(value) {
  return Array.isArray(value) ? value.length : null;
}

function outlineSource(peCount, editorCount) {
  if (peCount !== null && editorCount !== null) return "both";
  if (peCount !== null) return "node.pe.outline";
  if (editorCount !== null) return "node.editor.outline";
  return "neither";
}

function cleanCheck(value, max = 80) {
  return String(value || "").trim().slice(0, max);
}

function hasOwn(value, key) {
  return !!value && Object.prototype.hasOwnProperty.call(value, key);
}

function hasPe(node) {
  return !!node && !!node.pe && typeof node.pe === "object" && !Array.isArray(node.pe);
}

function hasDetails(node) {
  return hasOwn(node, "details");
}

function hasEditor(node) {
  return !!node && !!node.editor && typeof node.editor === "object" && !Array.isArray(node.editor);
}

function peText(node) {
  return hasPe(node) && typeof node.pe.text === "string" ? node.pe.text : "";
}

function normaliseBodyText(value) {
  return typeof value === "string" ? value.replace(/\r\n/g, "\n").replace(/\r/g, "\n").trim() : "";
}

function nodeSummary(node) {
  return `${cleanCheck(node && node.id, 80) || "(missing id)"} / ${cleanCheck(node && node.label, 120) || "(unlabelled)"}`;
}

function nodesFromPocketExport(data) {
  if (Array.isArray(data)) return data.filter(node => node && typeof node === "object" && !Array.isArray(node));
  if (!data || typeof data !== "object") return null;
  if (Array.isArray(data.mainThoughtTree)) return data.mainThoughtTree.filter(node => node && typeof node === "object" && !Array.isArray(node));
  if (data.data && Array.isArray(data.data.mainThoughtTree)) return data.data.mainThoughtTree.filter(node => node && typeof node === "object" && !Array.isArray(node));
  if (Array.isArray(data.nodes)) return data.nodes.filter(node => node && typeof node === "object" && !Array.isArray(node));
  return null;
}

function fieldPresence(node) {
  const peOutline = hasPe(node) ? outlineCount(node.pe.outline) : null;
  const editorOutline = hasEditor(node) ? outlineCount(node.editor.outline) : null;
  const peTextState = hasPe(node) && hasOwn(node.pe, "text") ? (normaliseBodyText(node.pe.text) ? "present" : "empty") : "missing";
  return [
    `details=${hasDetails(node) ? "yes" : "no"}`,
    `pe=${hasPe(node) ? "yes" : "no"}`,
    `pe.text=${peTextState}`,
    `pe.outline=${peOutline === null ? "none" : peOutline}`,
    `editor=${hasEditor(node) ? "yes" : "no"}`,
    `editor.outline=${editorOutline === null ? "none" : editorOutline}`
  ].join(", ");
}
function fileSnapshot(file) {
  try {
    const stat = fs.statSync(file);
    return { size: stat.size, mtimeMs: stat.mtimeMs };
  } catch {
    return null;
  }
}

function checkFileUnchanged(file, before) {
  const after = fileSnapshot(file);
  if (!before || !after) {
    fail("PE check data unchanged", `${repoRel(file)} could not be verified`);
    return;
  }
  if (before.size !== after.size || before.mtimeMs !== after.mtimeMs) {
    fail("PE check data unchanged", `${repoRel(file)} changed during diagnostic`);
    return;
  }
  ok("PE check data unchanged", repoRel(file));
}

function buildPeFromLegacyDetailsForCheck(node) {
  const text = normaliseBodyText(node && node.details);
  if (!text) return null;
  return {
    schema: "pocket.pe.v1",
    title: cleanCheck(node && node.label, 220),
    mode: "text",
    text,
    outline: [],
    updatedAt: cleanCheck(node && node.updatedAt, 40) || "<current timestamp>"
  };
}

function cloneNodeForCheck(node) {
  return node && typeof node === "object" ? JSON.parse(JSON.stringify(node)) : node;
}

function applyDetailsOnlyPeMigrationForCheck(nodes) {
  const beforeById = new Map(nodes.map(node => [node.id, node]));
  const migrated = nodes.map(node => {
    const next = cloneNodeForCheck(node);
    if (!hasOwn(node, "pe") && normaliseBodyText(node.details)) {
      const pe = buildPeFromLegacyDetailsForCheck(node);
      if (pe) next.pe = pe;
    }
    return next;
  });
  const migratedById = new Map(migrated.map(node => [node.id, node]));
  const upgraded = [];
  let overwritten = 0;
  let retainedDetails = 0;

  beforeById.forEach((before, id) => {
    const after = migratedById.get(id);
    if (!after) return;
    if (!hasOwn(before, "pe") && normaliseBodyText(before.details) && hasPe(after) && normaliseBodyText(after.pe.text)) {
      upgraded.push(after);
      if (hasDetails(after)) retainedDetails += 1;
    }
    if (hasOwn(before, "pe") && normaliseBodyText(peText(before)) !== normaliseBodyText(peText(after))) {
      overwritten += 1;
    }
  });

  return { migrated, upgraded, overwritten, retainedDetails };
}

function checkPeMigrationInventory() {
  const files = suppliedDataFiles();
  if (!files.length) return;

  const targets = [
    { id: "node_mq4snlc7_t5ku2wm", label: "Francesca POs" },
    { id: "w", label: "Work (CoA)" },
    { id: "node_mpor798l_rxdyhx3", label: "Phone" },
    { id: "w4_68", label: "Electricity" }
  ];

  files.forEach(file => {
    const beforeStat = fileSnapshot(file);
    const data = parseJsonFile(file, true);
    if (!data) return;
    const nodes = nodesFromPocketExport(data);
    if (!nodes) {
      fail(repoRel(file), "supplied PE check data has no node list");
      return;
    }

    const withPe = nodes.filter(hasPe);
    const withDetails = nodes.filter(hasDetails);
    const withBoth = nodes.filter(node => hasPe(node) && hasDetails(node));
    const detailsOnly = nodes.filter(node => hasDetails(node) && !hasPe(node));
    const peOnly = nodes.filter(node => hasPe(node) && !hasDetails(node));
    const withEditor = nodes.filter(hasEditor);
    const matching = [];
    const conflicts = [];

    withBoth.forEach(node => {
      if (normaliseBodyText(node.details) === normaliseBodyText(peText(node))) matching.push(node);
      else conflicts.push(node);
    });

    ok("PE migration inventory", repoRel(file));
    ok("PE total node count", String(nodes.length));
    ok("PE nodes with node.pe", String(withPe.length));
    ok("PE nodes with node.details", String(withDetails.length));
    ok("PE nodes with both node.pe and node.details", String(withBoth.length));
    ok("PE details-only nodes", String(detailsOnly.length));
    ok("PE pe-only nodes", String(peOnly.length));
    ok("PE nodes with node.editor", String(withEditor.length));
    ok("PE details / pe.text matching pairs", String(matching.length));
    ok("PE details / pe.text conflicting pairs", String(conflicts.length));
    if (conflicts.length) warn("PE details / pe.text conflict nodes", conflicts.map(nodeSummary).join("; "));
    else ok("PE details / pe.text conflict nodes", "none");

    const migrationCheck = applyDetailsOnlyPeMigrationForCheck(nodes);
    const afterDetailsOnly = migrationCheck.migrated.filter(node => hasDetails(node) && !hasPe(node));
    ok("PE details-only nodes before migration path", String(detailsOnly.length));
    ok("PE details-only nodes after migration path", String(afterDetailsOnly.length));
    if (migrationCheck.upgraded.length) {
      ok("PE details-only nodes upgraded", migrationCheck.upgraded.map(nodeSummary).join("; "));
    } else {
      ok("PE details-only nodes upgraded", "none");
    }
    if (migrationCheck.overwritten > 0) {
      fail("PE existing pe.text overwritten", String(migrationCheck.overwritten));
    } else {
      ok("PE existing pe.text overwritten", "0");
    }
    if (migrationCheck.retainedDetails !== migrationCheck.upgraded.length) {
      fail("PE upgraded nodes retain details", `${migrationCheck.retainedDetails}/${migrationCheck.upgraded.length}`);
    } else {
      ok("PE upgraded nodes retain details", `${migrationCheck.retainedDetails}/${migrationCheck.upgraded.length}`);
    }

    const byId = new Map(nodes.map(node => [node.id, node]));
    const migratedById = new Map(migrationCheck.migrated.map(node => [node.id, node]));
    targets.forEach(target => {
      const node = byId.get(target.id);
      if (!node) {
        warn("PE migration target", `${target.id} / ${target.label} missing`);
        return;
      }
      ok("PE migration target", `${nodeSummary(node)}: ${fieldPresence(node)}`);
      const after = migratedById.get(target.id);
      if (after) ok("PE migration target after path", `${nodeSummary(after)}: ${fieldPresence(after)}`);
    });
    checkFileUnchanged(file, beforeStat);
  });
}

function normaliseOutlineBlockForPeCheck(raw, index) {
  const depth = Number(raw && raw.depth);
  return {
    id: cleanCheck(raw && raw.id, 80) || "block_" + index,
    text: String(!raw || raw.text == null ? "" : raw.text).replace(/\r/g, "").slice(0, 4000),
    depth: Number.isFinite(depth) ? Math.max(0, Math.min(8, Math.round(depth))) : 0,
    collapsed: raw && raw.collapsed === true,
    order: index + 1
  };
}

function normaliseEditorMetaForPeCheck(value) {
  if (!value || typeof value !== "object") return null;
  const mode = cleanCheck(value.mode, 24).toLowerCase() === "outline" ? "outline" : "text";
  if (mode !== "outline") return null;
  const outline = Array.isArray(value.outline) ? value.outline.slice(0, 400).map(normaliseOutlineBlockForPeCheck) : [];
  const meaningful = outline.some(block => {
    return (Number(block.depth) || 0) > 0 || block.collapsed === true || cleanCheck(block.text, 4000);
  });
  if (!meaningful) return null;
  return { mode: "outline", outline: outline };
}

function checkPeOutlinePreservation() {
  const targetId = "w4_68";
  const files = candidateDataFiles();
  const supplied = suppliedDataFiles();
  if (!files.length) {
    warn("PE outline node", `${targetId} not checked; no sample/data fixture files found; set POCKET_CHECK_DATA=path/to/export.json`);
    return;
  }

  let foundNode = null;
  let foundFile = "";
  for (const file of files) {
    const required = supplied.includes(file);
    const data = parseJsonFile(file, required);
    if (!data) continue;
    const node = findNodeById(data, targetId);
    if (node) {
      foundNode = node;
      foundFile = repoRel(file);
      break;
    }
  }

  if (!foundNode) {
    warn("PE outline node", `${targetId} not found in ${files.length} sample/data fixture file(s); set POCKET_CHECK_DATA=path/to/export.json`);
    return;
  }

  ok("PE outline node", `${targetId} exists in ${foundFile}`);
  const peCount = outlineCount(foundNode.pe && foundNode.pe.outline);
  const editorCount = outlineCount(foundNode.editor && foundNode.editor.outline);
  const source = outlineSource(peCount, editorCount);
  const before = [];
  if (peCount !== null) before.push(`node.pe.outline=${peCount}`);
  if (editorCount !== null) before.push(`node.editor.outline=${editorCount}`);
  if (!before.length) before.push("none");
  ok("PE outline source found", source);
  ok("PE outline count before normalisation", before.join(", "));

  const sourceCount = Math.max(peCount === null ? -1 : peCount, editorCount === null ? -1 : editorCount);
  if (!foundNode.editor || typeof foundNode.editor !== "object") {
    warn("PE outline count after current normalisation", "not applicable; current legacy path reads node.editor.outline");
    warn("PE outline count shrinks", sourceCount >= 0 ? "not applicable without node.editor.outline" : "not applicable; no outline source found");
    return;
  }

  const normalised = normaliseEditorMetaForPeCheck(foundNode.editor);
  const afterCount = outlineCount(normalised && normalised.outline) || 0;
  ok("PE outline count after current normalisation", String(afterCount));
  if (sourceCount >= 0 && afterCount < sourceCount) {
    fail("PE outline count shrinks", `yes: ${sourceCount} -> ${afterCount}`);
  } else {
    ok("PE outline count shrinks", sourceCount >= 0 ? "no" : "not applicable; no outline source found");
  }
}

console.log("Pocket check v1");

checkEnds("index.html", "</html>");

const index = read("index.html");
if (index) {
  const scripts = Array.from(index.matchAll(/<script\s+src="([^"]+)"/g)).map(match => match[1]);
  ok("script tags", String(scripts.length));
  if (scripts.includes("js/pocket-enter-preflight.js") && scripts.includes("js/pocket-enter-copy-only.js")) {
    fail("enter handlers", "preflight and copy-only both loaded");
  } else {
    ok("enter handlers", "no duplicate known pair detected");
  }
}

checkEnds("js/pocket-node-editor-route.js", "})(window);");
checkExists("js/boot/pocket-load-manifest.js");
checkExists("js/boot/pocket-boot.js");
checkExists("js/commands/pocket-command-router.js");
checkExists("docs/PIPEWORK_RULE.md");
checkPeMigrationInventory();
checkPeOutlinePreservation();

if (failures) {
  console.log(`Pocket check failed: ${failures}`);
  process.exit(1);
}

console.log("Pocket check passed");
