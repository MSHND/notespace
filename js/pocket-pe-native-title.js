/* PE native title plumbing.
   The tree item name is node.label. PE title reads/writes that same field.
   node.pe.title is retained only as legacy/fallback data. */
(function initialisePocketPeNativeTitle(global) {
  "use strict";

  if (global.__pocketPeNativeTitleInstalled) return;

  function clean(value, max = 80) {
    return typeof cleanText === "function" ? cleanText(value, max) : String(value || "").trim().slice(0, max);
  }

  function