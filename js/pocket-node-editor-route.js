/* Native PE bridge. Title source of truth: node.label. */
(function (global) {
  "use strict";
  const SCHEMA = "pocket.pe.v1";
  const MAX_TEXT = 120000;
  const MAX_LINES = 3000;
  const MAX_LINE = 1200;

  function clean(value, max) {
    return typeof cleanText === "function" ? cleanText(value, max || 80) : String(value || "").trim().slice(0, max || 80);
  }

  function allNodes() {
    return Array.isArray(global.state && global.state.nodes) ? global.state.nodes : [];
  }

  function node