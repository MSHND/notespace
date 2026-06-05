/* Native PE route: PE title is node.label; body remains node.pe. */
(function (global) {
  "use strict";
  const MAX_TEXT = 120000, MAX_LINES = 3000, MAX_LINE = 1200, SCHEMA = "pocket.pe.v1";
  function clean(v, n = 80) { return typeof cleanText === "function" ? cleanText(v, n) : String(v || "").trim().slice(0, n); }
  function esc(v) { return String(v || "").replace(/[&<>"]/g, c => ({"&":"&amp;","<":"