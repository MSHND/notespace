/* Keep the main save chip visually identical to the other top chips.
   It may still have save-state text, but it should not inherit disabled or safety styling. */

(function initialisePocketSaveChipNormalise(global) {
  "use strict";

  function normaliseSaveChip() {
    const button = document.getElementById("btnExportTree");
    if (!(button instanceof HTMLButtonElement)) return;
    button.disabled = false;
    button.classList.remove("safetySafe", "safetyCheck", "on");
    button.classList.toggle("safetyNeed", button.textContent === "save*");
    button.style.opacity = "1";
    button.style.filter = "none";
  }

  function wrapRefreshMeta() {
    if (typeof global.refreshMeta !== "function") return;
    const original = global.refreshMeta;
    global.refreshMeta = function wrappedRefreshMeta(...args) {
      const result = original.apply(this, args);
      normaliseSaveChip();
      return result;
    };
  }

  function init() {
    wrapRefreshMeta();
    normaliseSaveChip();
    window.setInterval(normaliseSaveChip, 800);
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init, { once: true });
  else init();
})(window);
