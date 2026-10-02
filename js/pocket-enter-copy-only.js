/* Mobile Move display + PE Esc close guards. */
(function initialisePocketEnterCopyOnly(global) {
  "use strict";

  function installMoveDisplayGuard() {
    if (document.getElementById("pocketMoveDisplayGuard")) return;
    const style = document.createElement("style");
    style.id = "pocketMoveDisplayGuard";
    style.textContent = `
      body:not(.phoneMode) .mobileMovePad { display: none !important; }
      body.phoneMode.moveModeActive .mobileMovePad { display: block !important; }
    `;
    document.head.appendChild(style);
  }

  function installPeEscCloseGuard() {
    if (global.__pocketPeEscCloseGuardInstalled) return;
    const originalOpen = global.open.bind(global);
    global.open = function pocketOpenWithPeEscClose(...args) {
      const win = originalOpen(...args);
      const name = String(args[1] || "");
      if (win && name.startsWith("pocketSimplePe_")) {
        const install = () => {
          try {
            if (!win || win.closed || !win.document || win.__pocketPeEscCloseInstalled) return;
            win.__pocketPeEscCloseInstalled = true;

            function ensureChoiceStyle() {
              if (win.document.getElementById("pocketPeUnsavedChoiceStyle")) return;
              const style = win.document.createElement("style");
              style.id = "pocketPeUnsavedChoiceStyle";
              style.textContent = `
                .peUnsavedShade {
                  position: fixed;
                  inset: 0;
                  z-index: 9999;
                  display: grid;
                  place-items: center;
                  background: rgba(15,23,42,.24);
                  padding: 18px;
                }
                .peUnsavedCard {
                  width: min(430px, 100%);
                  border: 1px solid rgba(148,163,184,.32);
                  border-radius: 18px;
                  background: rgba(255,255,255,.98);
                  box-shadow: 0 24px 70px -36px rgba(15,23,42,.55);
                  padding: 18px;
                  color: #0f172a;
                  font-family: system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
                }
                .peUnsavedTitle {
                  font-size: 16px;
                  font-weight: 750;
                  margin: 0 0 6px;
                }
                .peUnsavedText {
                  font-size: 13px;
                  line-height: 1.45;
                  color: rgba(71,85,105,.92);
                  margin: 0 0 14px;
                }
                .peUnsavedActions {
                  display: flex;
                  flex-wrap: wrap;
                  justify-content: flex-end;
                  gap: 8px;
                }
                .peUnsavedActions button {
                  border: 0;
                  border-radius: 999px;
                  padding: 7px 11px;
                  font: inherit;
                  font-size: 12px;
                  cursor: pointer;
                  background: rgba(148,163,184,.16);
                  color: #0f172a;
                }
                .peUnsavedActions button:hover,
                .peUnsavedActions button:focus-visible {
                  background: rgba(148,163,184,.28);
                  outline: none;
                }
                .peUnsavedActions .primary {
                  background: rgba(15,23,42,.9);
                  color: white;
                }
                .peUnsavedActions .primary:hover,
                .peUnsavedActions .primary:focus-visible {
                  background: rgba(15,23,42,1);
                }
                .peUnsavedActions .danger {
                  color: #7f1d1d;
                }
              `;
              win.document.head.appendChild(style);
            }

            function closeUnsavedChoice() {
              const existing = win.document.getElementById("peUnsavedChoice");
              if (existing) existing.remove();
            }

            function saveThenClose() {
              const saveBtn = win.document.getElementById("saveBtn");
              if (!saveBtn) return;
              saveBtn.click();
              let tries = 0;
              const timer = win.setInterval(() => {
                tries += 1;
                const stillDirty = win.__pocketPeDirty === true;
                const disabled = saveBtn.disabled === true;
                if (!stillDirty && !disabled) {
                  win.clearInterval(timer);
                  win.close();
                }
                if (tries > 80) {
                  win.clearInterval(timer);
                  const status = win.document.getElementById("status");
                  if (status) status.textContent = "save did not finish";
                }
              }, 100);
            }

            function showUnsavedChoice() {
              ensureChoiceStyle();
              closeUnsavedChoice();

              const shade = win.document.createElement("div");
              shade.id = "peUnsavedChoice";
              shade.className = "peUnsavedShade";
              shade.setAttribute("role", "dialog");
              shade.setAttribute("aria-modal", "true");

              const card = win.document.createElement("div");
              card.className = "peUnsavedCard";

              const title = win.document.createElement("div");
              title.className = "peUnsavedTitle";
              title.textContent = "Save before closing?";

              const text = win.document.createElement("p");
              text.className = "peUnsavedText";
              text.textContent = "You have unsaved changes in this item.";

              const actions = win.document.createElement("div");
              actions.className = "peUnsavedActions";

              const keepBtn = win.document.createElement("button");
              keepBtn.type = "button";
              keepBtn.textContent = "Keep editing";
              keepBtn.addEventListener("click", closeUnsavedChoice);

              const leaveBtn = win.document.createElement("button");
              leaveBtn.type = "button";
              leaveBtn.className = "danger";
              leaveBtn.textContent = "Leave without saving";
              leaveBtn.addEventListener("click", () => win.close());

              const saveBtn = win.document.createElement("button");
              saveBtn.type = "button";
              saveBtn.className = "primary";
              saveBtn.textContent = "Save and close";
              saveBtn.addEventListener("click", () => {
                saveBtn.disabled = true;
                saveBtn.textContent = "Saving…";
                saveThenClose();
              });

              actions.appendChild(keepBtn);
              actions.appendChild(leaveBtn);
              actions.appendChild(saveBtn);
              card.appendChild(title);
              card.appendChild(text);
              card.appendChild(actions);
              shade.appendChild(card);
              win.document.body.appendChild(shade);
              saveBtn.focus({ preventScroll: true });
            }

            function closePeWindow() {
              if (!win.__pocketPeDirty) {
                win.close();
                return;
              }
              showUnsavedChoice();
            }

            win.document.addEventListener("keydown", (ev) => {
              if (ev.key !== "Escape" || ev.metaKey || ev.ctrlKey || ev.altKey || ev.shiftKey) return;
              ev.preventDefault();
              ev.stopPropagation();
              closePeWindow();
            }, true);
            console.info("[pe esc close] installed");
          } catch (_error) {}
        };
        window.setTimeout(install, 0);
        window.setTimeout(install, 80);
        window.setTimeout(install, 240);
      }
      return win;
    };
    global.__pocketPeEscCloseGuardInstalled = true;
  }

  installMoveDisplayGuard();
  installPeEscCloseGuard();
  console.info("[Pocket UI guards] mobile Move display and PE Esc guards installed");
})(window);
