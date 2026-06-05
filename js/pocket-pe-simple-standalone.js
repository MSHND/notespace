/* Retired PE override.
   The purpose-built native PE path now lives in pocket-node-editor-route.js.
   This file remains loaded for cache/order safety, but intentionally does not
   override PocketPeEditor or openPocketPeEditor. */
(function retirePocketPeSimpleStandalone(global) {
  "use strict";
  global.__pocketPeSimpleStandaloneRetired = true;
  console.info("[simple standalone PE] retired; native PE route owns open/apply/save");
})(window);
