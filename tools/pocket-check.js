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

function candidateDataFiles() {
  const files = [];
  String(process.env.POCKET_CHECK_DATA || "").split(path.delimiter).forEach(input => addCandidate(files, input.trim()));
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

function normaliseOutlineBlockForPeCheck(raw, index) {
  const depth = Number(raw && raw.depth);
  return {
    id: cleanCheck(raw && raw.id, 80) || "block_" + index,
    text: String(raw && raw.text == null ? "" : raw.text).replace(/\r/g, "").slice(0, 4000),
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
  const supplied = String(process.env.POCKET_CHECK_DATA || "").split(path.delimiter).filter(Boolean).length;
  if (!files.length) {
    warn("PE outline node", `${targetId} not checked; no sample/data fixture files found; set POCKET_CHECK_DATA=path/to/export.json`);
    return;
  }

  let foundNode = null;
  let foundFile = "";
  for (const file of files) {
    const required = supplied > 0 && String(process.env.POCKET_CHECK_DATA || "").split(path.delimiter).map(input => path.normalize(path.isAbsolute(input.trim()) ? input.trim() : path.join(root, input.trim()))).includes(file);
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
checkPeOutlinePreservation();

if (failures) {
  console.log(`Pocket check failed: ${failures}`);
  process.exit(1);
}

console.log("Pocket check passed");
