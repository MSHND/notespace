/* Shared native file-picker interaction ownership. */

(function initPocketNativeFilePickerActivity(global) {
  "use strict";

  let pendingCount = 0;

  function isActive() {
    return pendingCount > 0;
  }

  async function run(task) {
    if (typeof task !== "function") {
      throw new TypeError("Native file-picker activity requires a task.");
    }
    pendingCount += 1;
    try {
      return await task();
    } finally {
      pendingCount = Math.max(0, pendingCount - 1);
    }
  }

  global.PocketNativeFilePickerActivity = Object.freeze({
    isActive,
    run,
  });
})(typeof window !== "undefined" ? window : globalThis);
