/* Pocket command router scaffold.
   Dormant: not loaded by index.html yet.
   Future owner for keyboard, menu, double-click, edit, and copy commands. */
(function initialisePocketCommandRouter(global) {
  "use strict";

  const VERSION = "command router scaffold v1";

  const commands = Object.create(null);

  function register(name, handler) {
    if (!name || typeof handler !== "function") return false;
    commands[String(name)] = handler;
    return true;
  }

  function run(name, payload) {
    const handler = commands[String(name)];
    if (typeof handler !== "function") return false;
    return handler(payload);
  }

  global.PocketCommandRouter = Object.freeze({
    version: VERSION,
    active: false,
    register,
    run
  });
})(window);
