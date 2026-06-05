/* Native PE / item-details route.
   Purpose-built path: PE title is node.label. PE body stays in node.pe. */
(function initialisePocketPeRoute(global) {
  "use strict";

  const PE_SCHEMA = "pocket.pe.v1";
  const PE_MAX_TEXT_CHARS = 120000;
  const PE_MAX_OUTLINE_LINES = 3000;
  const PE_MAX_LINE_CHARS = 1200;

  function clean(value, max = 80) {
    return typeof cleanText === "function" ? cleanText(value, max) : String(value || "").trim().slice(0, max);
  }

  function