/* Pocket boot scaffold.
   Dormant by design: index.html does not load this yet.
   Future role: load PocketLoadManifest phases in order. */
(function (global) {
  "use strict";
  global.PocketBoot = Object.freeze({
    version: "boot scaffold v1",
    active: false
  });
  console.info("[Pocket boot] dormant scaffold loaded");
})(window);
