/* PE native title plumbing.
   The tree item name is node.label. PE title reads/writes that same field.
   node.pe.title is retained only as legacy/fallback data. */
(function initialisePocketPeNativeTitle(global) {
  "use strict";

  if (global.__pocketPeNativeTitleInstalled) return;

  function clean(value, max = 80) {
    return typeof cleanText === "function" ? cleanText(value, max) : String(value || "").trim().slice(0, max);
  }

  function nodeById(id) {
    const safeId = clean(id, 80);
    return safeId && typeof nodeMap === "function" ? nodeMap().get(safeId) || null : null;
  }

  function titleFromPayload(payload) {
    return clean(payload && payload.title, 220);
  }

  function applyNativeTitle(payload) {
    const id = clean(payload && payload.nodeId, 80);
    const node = nodeById(id);
    if (!node) return { node: null, changed