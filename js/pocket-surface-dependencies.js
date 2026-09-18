/* Canonical browser-surface dependency authority shared by browser composition and Node packaging. */
(function initialisePocketSurfaceDependencies(root, factory) {
  "use strict";
  const contract = factory();
  if (typeof module === "object" && module && module.exports) module.exports = contract;
  if (root && root.window === root) root.PocketSurfaceDependencies = contract;
})(typeof globalThis === "object" ? globalThis : null, function createPocketSurfaceDependencies() {
  "use strict";
  function dependencyError() {
    const error = new Error("Pocket surface dependency contract failed.");
    error.code = "pocket-surface-dependencies-invalid";
    return error;
  }
  function validateScripts(value) {
    if (!Array.isArray(value) || value.length === 0) throw dependencyError();
    const seen = new Set();
    const scripts = value.map(function (candidate) {
      if (typeof candidate !== "string" || candidate !== candidate.trim()
          || !candidate.startsWith("js/") || !candidate.endsWith(".js")
          || candidate.includes("\\") || /[:?#]/.test(candidate)
          || candidate.split("/").some(function (part) { return !part || part === "." || part === ".."; })
          || !/^js\/[A-Za-z0-9._/-]+\.js$/.test(candidate)
          || seen.has(candidate)) throw dependencyError();
      seen.add(candidate);
      return candidate;
    });
    return Object.freeze(scripts);
  }
  const surfaces = Object.freeze({
    pe: Object.freeze({
      scripts: validateScripts([
        "js/pocket-node-content.js",
        "js/pocket-node-popout-runtime.js",
        "js/pocket-node-popout-polish.js",
      ]),
    }),
  });
  function scriptsFor(surfaceName) {
    if (typeof surfaceName !== "string" || !Object.hasOwn(surfaces, surfaceName)) throw dependencyError();
    return surfaces[surfaceName].scripts;
  }
  return Object.freeze({ scriptsFor, validateScripts });
});
