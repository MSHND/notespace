/* Editor loop test checklist.
   A quiet manual trust checklist for the normal/detail/popout/outline editor seam. */

(function initialisePocketEditorTestLoop(global) {
  "use strict";

  const STORAGE_KEY = "pocket.editorTestLoop.v1";
  const TESTS = [
    ["normal_dirty", "Normal detail editor", "Edit title/body → save* appears → save clears/closes cleanly."],
    ["normal_to_popout", "Normal → popout", "Type in normal editor → popout opens with the same title/body."],
    ["popout_to_normal", "Popout → normal", "Edit/save in popout → normal editor and tree update behind it."],
    ["outline_structure", "Outline structure", "Switch to outline → indent branch → drag branch → save → reopen → structure survives."],
    ["conflict_guard", "Conflict guard", "Open popout → change normal editor behind it → save popout → conflict guard appears."],
    ["file_save", "Pocket save", "After editor tests, main save shows dirty state and exports the updated file."],
  ];

  function readState() {
    try {
      const parsed = JSON.parse(global.localStorage.getItem(STORAGE_KEY) || "{}");
      return parsed && typeof parsed === "object" ? parsed : {};
    } catch (_error) {
      return {};
    }
  }

  function writeState(state) {
    try { global.localStorage.setItem(STORAGE_KEY, JSON.stringify(state || {})); } catch (_error) {}
  }

  function closeChecklist() {
    const existing = document.getElementById("editorTestLoopOverlay");
    if (existing) existing.remove();
    if (typeof refocusTreeNavigation === "function") refocusTreeNavigation(global.state?.selectedId || "");
  }

  function progressText(state) {
    const done = TESTS.filter(([id]) => state[id]).length;
    return `${done}/${TESTS.length}`;
  }

  function openChecklist() {
    closeChecklist();
    const state = readState();

    const overlay = document.createElement("div");
    overlay.id = "editorTestLoopOverlay";
    overlay.className = "editorTestLoopOverlay";
    overlay.setAttribute("role", "dialog");
    overlay.setAttribute("aria-modal", "true");
    overlay.setAttribute("aria-labelledby", "editorTestLoopTitle");

    const style = document.createElement("style");
    style.textContent = `
      .editorTestLoopOverlay { position: fixed; inset: 0; z-index: 10000; display: grid; place-items: center; padding: 18px; background: rgba(15, 23, 42, .18); }
      .editorTestLoopCard { width: min(620px, 94vw); max-height: min(720px, 88vh); overflow: auto; border: 1px solid rgba(148, 163, 184, .24); border-radius: 20px; background: rgba(251, 251, 248, .98); box-shadow: 0 24px 80px -44px rgba(15, 23, 42, .54); padding: 16px; color: rgba(15, 23, 42, .92); }
      .editorTestLoopTop { display: flex; align-items: start; gap: 12px; margin-bottom: 12px; }
      .editorTestLoopTitleBlock { flex: 1 1 auto; min-width: 0; }
      .editorTestLoopTitle { font-size: 16px; font-weight: 720; margin-bottom: 3px; }
      .editorTestLoopSub { font-size: 12px; color: rgba(71, 85, 105, .68); line-height: 1.4; }
      .editorTestLoopClose { border: 0; background: transparent; color: rgba(51, 65, 85, .8); font-size: 22px; line-height: 1; cursor: pointer; padding: 0 2px; }
      .editorTestLoopProgress { display: inline-flex; align-items: center; gap: 6px; margin: 4px 0 12px; font-size: 12px; color: rgba(51, 65, 85, .74); }
      .editorTestLoopList { display: grid; gap: 8px; }
      .editorTestLoopItem { display: grid; grid-template-columns: 22px minmax(0, 1fr); gap: 8px; align-items: start; padding: 10px 9px; border-radius: 14px; background: rgba(255, 255, 255, .72); border: 1px solid rgba(148, 163, 184, .16); }
      .editorTestLoopItem input { margin-top: 2px; width: 16px; height: 16px; }
      .editorTestLoopName { font-size: 13px; font-weight: 700; margin-bottom: 2px; }
      .editorTestLoopHint { font-size: 12px; color: rgba(71, 85, 105, .72); line-height: 1.4; }
      .editorTestLoopActions { display: flex; justify-content: space-between; gap: 8px; margin-top: 14px; }
      .editorTestLoopAction { border: 0; background: transparent; color: rgba(30, 41, 59, .92); cursor: pointer; font: inherit; font-size: 12px; font-weight: 650; padding: 4px; }
      .editorTestLoopAction:hover, .editorTestLoopAction:focus-visible { color: rgba(15, 23, 42, .98); outline: none; }
    `;
    overlay.appendChild(style);

    const card = document.createElement("div");
    card.className = "editorTestLoopCard";

    const top = document.createElement("div");
    top.className = "editorTestLoopTop";
    const titleBlock = document.createElement("div");
    titleBlock.className = "editorTestLoopTitleBlock";
    const title = document.createElement("div");
    title.id = "editorTestLoopTitle";
    title.className = "editorTestLoopTitle";
    title.textContent = "Editor loop test";
    const sub = document.createElement("div");
    sub.className = "editorTestLoopSub";
    sub.textContent = "A small manual checklist for the normal editor, popout editor, outline mode, conflicts, and file save.";
    titleBlock.appendChild(title);
    titleBlock.appendChild(sub);
    const close = document.createElement("button");
    close.type = "button";
    close.className = "editorTestLoopClose";
    close.setAttribute("aria-label", "Close editor test checklist");
    close.textContent = "×";
    close.addEventListener("click", closeChecklist);
    top.appendChild(titleBlock);
    top.appendChild(close);
    card.appendChild(top);

    const progress = document.createElement("div");
    progress.className = "editorTestLoopProgress";
    progress.textContent = `Progress: ${progressText(state)}`;
    card.appendChild(progress);

    const list = document.createElement("div");
    list.className = "editorTestLoopList";
    for (const [id, name, hint] of TESTS) {
      const label = document.createElement("label");
      label.className = "editorTestLoopItem";
      const checkbox = document.createElement("input");
      checkbox.type = "checkbox";
      checkbox.checked = !!state[id];
      checkbox.addEventListener("change", () => {
        const next = readState();
        next[id] = checkbox.checked;
        next.updatedAt = new Date().toISOString();
        writeState(next);
        progress.textContent = `Progress: ${progressText(next)}`;
      });
      const text = document.createElement("div");
      const testName = document.createElement("div");
      testName.className = "editorTestLoopName";
      testName.textContent = name;
      const testHint = document.createElement("div");
      testHint.className = "editorTestLoopHint";
      testHint.textContent = hint;
      text.appendChild(testName);
      text.appendChild(testHint);
      label.appendChild(checkbox);
      label.appendChild(text);
      list.appendChild(label);
    }
    card.appendChild(list);

    const actions = document.createElement("div");
    actions.className = "editorTestLoopActions";
    const reset = document.createElement("button");
    reset.type = "button";
    reset.className = "editorTestLoopAction";
    reset.textContent = "reset ticks";
    reset.addEventListener("click", () => {
      writeState({ updatedAt: new Date().toISOString() });
      closeChecklist();
      openChecklist();
    });
    const done = document.createElement("button");
    done.type = "button";
    done.className = "editorTestLoopAction";
    done.textContent = "done";
    done.addEventListener("click", closeChecklist);
    actions.appendChild(reset);
    actions.appendChild(done);
    card.appendChild(actions);

    overlay.appendChild(card);
    overlay.addEventListener("click", (ev) => {
      if (ev.target === overlay) closeChecklist();
    });
    overlay.addEventListener("keydown", (ev) => {
      if (ev.key === "Escape") {
        ev.preventDefault();
        closeChecklist();
      }
    });
    document.body.appendChild(overlay);
    requestAnimationFrame(() => close.focus({ preventScroll: true }));
  }

  function ensureCommand() {
    const card = document.querySelector("#commandOverlay .commandCard");
    if (!card || document.getElementById("cmdEditorTestLoop")) return;
    const button = document.createElement("button");
    button.id = "cmdEditorTestLoop";
    button.className = "commandBtn";
    button.type = "button";
    button.innerHTML = '<span>Test editor loop</span><span class="commandHint">trust</span>';
    button.addEventListener("click", () => {
      if (typeof closeCommandPalette === "function") closeCommandPalette({ restoreFocus: false });
      requestAnimationFrame(openChecklist);
    });

    const healthButton = document.getElementById("cmdHealth");
    if (healthButton && healthButton.parentNode === card) healthButton.insertAdjacentElement("afterend", button);
    else card.appendChild(button);
  }

  function init() {
    ensureCommand();
    const more = document.getElementById("btnMore");
    if (more) more.addEventListener("click", () => requestAnimationFrame(ensureCommand));
  }

  global.PocketEditorTestLoop = Object.freeze({ open: openChecklist, ensureCommand });
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init, { once: true });
  else init();
})(window);
