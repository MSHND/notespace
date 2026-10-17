"use strict";
// RESEARCH ONLY. Text engines do not own Pocket target selection, Save, Sync, or authority.
// Ranges are UTF-16 offsets and must lie on whole grapheme boundaries.
const Y = require("yjs");
const segmenter = new Intl.Segmenter("en", { granularity: "grapheme" });
const SCHEMA = "pocket.research.range-proposal.v1";

function openingOK(x) {
  return !!x && typeof x.id === "string" && !!x.id &&
    typeof x.text === "string" &&
    typeof x.originalUpdatedAt === "string" && !!x.originalUpdatedAt;
}
function boundaries(text) {
  const result = new Set([0, text.length]);
  for (const part of segmenter.segment(text)) result.add(part.index);
  return result;
}
function valid(text, op) {
  if (!op || typeof op.id !== "string" || !op.id ||
    typeof op.actor !== "string" || !op.actor ||
    !Number.isSafeInteger(op.start) || !Number.isSafeInteger(op.end) ||
    op.start < 0 || op.end < op.start || op.end > text.length ||
    typeof op.before !== "string" || typeof op.after !== "string" ||
    text.slice(op.start, op.end) !== op.before || op.before === op.after) return false;
  const edges = boundaries(text);
  return edges.has(op.start) && edges.has(op.end);
}
function overlaps(a, b) {
  // Ambiguous same-position insertions, including insertion on a replacement start,
  // deliberately require an explicit human decision.
  if (a.start === a.end && b.start === b.end) return a.start === b.start;
  if (a.start === a.end) return a.start >= b.start && a.start < b.end;
  if (b.start === b.end) return b.start >= a.start && b.start < a.end;
  return Math.max(a.start, b.start) < Math.min(a.end, b.end);
}
function startEditor(engine, opened, actor) {
  if (!["yjs", "automerge"].includes(engine) || !openingOK(opened) ||
    typeof actor !== "string" || !actor) throw Error("owner-opening-required");
  const accepted = [];
  return Object.freeze({
    stage(input) {
      const op = {
        id: input?.id, actor, start: input?.start, end: input?.end,
        before: input?.before, after: input?.after
      };
      if (!valid(opened.text, op)) return { ok: false, reason: "invalid-or-stale-range" };
      if (accepted.some(previous => previous.id === op.id || overlaps(previous, op)))
        return { ok: false, reason: "overlap-or-duplicate" };
      accepted.push(Object.freeze(op));
      return { ok: true, id: op.id };
    },
    proposal() {
      return Object.freeze({
        schema: SCHEMA, engine, actor, nodeId: opened.id,
        revision: opened.originalUpdatedAt, originalText: opened.text,
        intents: Object.freeze(accepted.map(op => Object.freeze({ ...op })))
      });
    }
  });
}
function inspect(opened, proposals) {
  if (!openingOK(opened) || !Array.isArray(proposals) || !proposals.length)
    return { ok: false, reason: "missing-owner-or-proposal" };
  const intents = [], ids = new Set();
  for (const p of proposals) {
    if (!p || p.schema !== SCHEMA || !["yjs", "automerge"].includes(p.engine) ||
      p.nodeId !== opened.id) return { ok: false, reason: "wrong-target-or-proposal" };
    if (p.originalText !== opened.text || p.revision !== opened.originalUpdatedAt)
      return { ok: false, reason: "stale-opening" };
    if (typeof p.actor !== "string" || !p.actor ||
      !Array.isArray(p.intents) || !p.intents.length)
      return { ok: false, reason: "invalid-proposal" };
    for (const input of p.intents) {
      if (input.actor !== p.actor || !valid(opened.text, input) || ids.has(input.id))
        return { ok: false, reason: "invalid-or-duplicate-intent" };
      ids.add(input.id);
      intents.push(Object.freeze({ ...input }));
    }
  }
  for (let a = 0; a < intents.length; a++) {
    for (let b = a + 1; b < intents.length; b++) {
      if (overlaps(intents[a], intents[b])) {
        return { ok: false, reason: "human-conflict-hold",
          ids: [intents[a].id, intents[b].id] };
      }
    }
  }
  return { ok: true, intents };
}
function ordered(intents) {
  return [...intents].sort((a, b) => b.start - a.start || b.end - a.end);
}
function projected(text, intents) {
  return ordered(intents).reduce(
    (s, i) => s.slice(0, i.start) + i.after + s.slice(i.end), text
  );
}
async function engineRender(engine, text, intents) {
  if (engine === "yjs") {
    const doc = new Y.Doc(), body = doc.getText("body");
    body.insert(0, text);
    for (const intent of ordered(intents)) {
      doc.transact(() => {
        body.delete(intent.start, intent.end - intent.start);
        body.insert(intent.start, intent.after);
      });
    }
    const rendered = body.toString();
    doc.destroy();
    return rendered;
  }
  if (engine === "automerge") {
    const A = await import("@automerge/automerge");
    let doc = A.from({ body: text });
    for (const intent of ordered(intents)) {
      doc = A.change(doc, d => {
        A.splice(d, ["body"], intent.start, intent.end - intent.start, intent.after);
      });
    }
    return doc.body;
  }
  throw Error("unknown-engine");
}
async function prepare(opened, proposals, engine) {
  const checked = inspect(opened, proposals);
  if (!checked.ok) return checked;
  if (!["yjs", "automerge"].includes(engine))
    return { ok: false, reason: "invalid-engine" };
  let rendered;
  try { rendered = await engineRender(engine, opened.text, checked.intents); }
  catch (error) { return { ok: false, reason: "engine-evaluation-failed",
    detail: String(error?.message || error) }; }
  if (rendered !== projected(opened.text, checked.intents))
    return { ok: false, reason: "semantic-render-mismatch" };
  return Object.freeze({
    ok: true, engine, intentIds: Object.freeze(checked.intents.map(x => x.id)),
    // This is a *proposal*. Pocket's existing PE independently enforces authority.
    payload: Object.freeze({ ...opened, text: rendered, body: rendered })
  });
}
function proposeUndo(baseText, intents, intentId, latest) {
  const removed = intents.find(i => i.id === intentId);
  if (!removed || intents.filter(i => i.id === intentId).length !== 1 ||
    !openingOK(latest)) return { ok: false, reason: "invalid-undo-input" };
  const others = intents.filter(i => i.id !== intentId);
  if (others.some(i => overlaps(removed, i)))
    return { ok: false, reason: "dependent-intent" };
  const expectedCurrent = projected(baseText, intents);
  if (expectedCurrent !== latest.text)
    return { ok: false, reason: "newer-work-requires-rebase" };
  const shift = others.filter(i => i.end <= removed.start)
    .reduce((n, i) => n + i.after.length - (i.end - i.start), 0);
  const start = removed.start + shift;
  if (latest.text.slice(start, start + removed.after.length) !== removed.after)
    return { ok: false, reason: "undo-anchor-lost" };
  return { ok: true, intent: Object.freeze({
    id: "undo:" + intentId, actor: "pocket-undo",
    start, end: start + removed.after.length,
    before: removed.after, after: removed.before
  }), expected: projected(baseText, others) };
}
module.exports = { startEditor, inspect, projected, prepare, proposeUndo };
