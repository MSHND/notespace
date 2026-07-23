/* Target node resolution for the standalone node popout editor. */
(function initialisePocketNodePopoutTarget(global) {
  "use strict";

  function clean(value, max = 80) {
    return typeof cleanText === "function" ? cleanText(value, max) : String(value || "").trim().slice(0, max);
  }

  function getById(input) {
    const id = typeof input === "string" ? clean(input, 80) : "";
    if (!id || typeof nodeMap !== "function") return null;
    return nodeMap().get(id) || null;
  }

  function get(input) {
    let id = "";
    if (typeof input === "string") id = clean(input, 80);
    else if (input && typeof input === "object") id = clean(input.id, 80);
    if (!id) id = clean(global.state?.selectedId, 80);
    return getById(id);
  }

  global.PocketNodePopoutTarget = Object.freeze({ get: get, getById: getById });
})(window);
