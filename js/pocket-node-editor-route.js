/* Native Pocket item-details route.
   Purpose-built repair: title is node.label; item details live in node.pe. */
(function initialisePocketPeRoute(global) {
  "use strict";

  const PE_SCHEMA = "pocket.pe.v1";
  const TEXT_LIMIT = 120000;
  const OUTLINE_LIMIT = 3000;
  const OUTLINE_LINE_LIMIT = 1200;

  function clean(value, max = 80) {
    const text = String(value == null ? "" : value).replace(/\r/g, "").trim();
    return text.slice(0, max);
  }

  function nowIsoSafe() {
    return typeof nowIso === "function" ? nowIso() : new Date().toISOString();
  }

  function nodesList() {
    if (global.state && Array.isArray(global.state.nodes)) return global.state.nodes;
    if (global.state && Array.isArray(global.state.mainThoughtTree)) return global.state.mainThoughtTree;
    return [];
  }

  function mapNode(id) {
    if (!id) return null;
    if (typeof nodeMap === "function") return nodeMap().get(id) || null;
    return nodesList().find((node) => node && node.id === id) || null;
  }

  function selectedId() {
    const active = document.activeElement instanceof HTMLElement ? document.activeElement.closest("[data-node-id]") : null;
    const selected = document.querySelector(".row.selected[data-node