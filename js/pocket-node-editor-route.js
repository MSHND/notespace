/* Canonical native PE route.
   Owns item details open/apply/save without wrapper plumbing. */
(function initialisePocketPeRoute(global) {
  "use strict";

  const PE_ROUTE_VERSION = "PE route v1.0";
  let peWindow = null;

  function clean(value, max = 80) {
    if (typeof cleanText === "function") return cleanText(value, max);
    return String(value == null ? "" : value).trim().slice(0, max);
  }
  function now() { return typeof nowIso === "function" ? nowIso() : new Date().toISOString();