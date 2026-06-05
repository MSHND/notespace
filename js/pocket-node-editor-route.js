/* Native PE bridge. Title source of truth: node.label. Body stays in node.pe. */
(function (global) {
  "use strict";
  const SCHEMA = "pocket.pe.v1";
  const MAX_TEXT = 120000;
  const MAX_LINES = 3000;
  const MAX_LINE = 1200;

  function clean(value, max = 80) {
    return typeof cleanText === "function" ? cleanText(value, max) : String(value || "").trim().slice(0, max);
  }

  function allNodes() {
    return Array.isArray(global.state && global.state.nodes) ? global.state.nodes