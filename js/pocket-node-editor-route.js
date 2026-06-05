/* Compact native PE bridge. Title source of truth: node.label. */
(function (global) {
  "use strict";
  const SCHEMA = "pocket.pe.v1", MAX_TEXT = 120000, MAX_LINES = 3000, MAX_LINE = 1200;
  function clean(v, n = 80) { return typeof cleanText === "function" ? cleanText(v, n) : String(v || "").trim().slice(0, n); }
  function nodes() { return Array.isArray(global.state && global.state.nodes) ? global.state.nodes