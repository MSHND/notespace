/* Editor joy polish: focus behaviour and light Markdown-style formatting shortcuts. */

(function initialisePocketEditorJoy(global) {
  "use strict";

  function focusBodyWhenEditorOpens() {
    const overlay = document.getElementById("detailOverlay");
    const body = document.getElementById("detailEditorBody");
    if (!(overlay instanceof HTMLElement) || !(body instanceof HTMLTextAreaElement)) return;
    if (overlay.hidden) return;

    global.setTimeout(() => {
      if (overlay.hidden) return;
      if (document.activeElement !== document.getElementById("detailEditorLabel")) return;
      body.focus({ preventScroll: true });
      const end = body.value.length;
      body.setSelectionRange(end, end);
    }, 80);
  }

  function wrapSelection(textarea, before, after = before) {
    const start = textarea.selectionStart || 0;
    const end = textarea.selectionEnd || start;
    const value = textarea.value || "";
    const selected = value.slice(start, end);
    const next = `${value.slice(0, start)}${before}${selected}${after}${value.slice(end)}`;
    textarea.value = next;
    const nextStart = start + before.length;
    const nextEnd = nextStart + selected.length;
    textarea.focus({ preventScroll: true });
    textarea.setSelectionRange(nextStart, nextEnd);
    textarea.dispatchEvent(new Event("input", { bubbles: true }));
  }

  function bulletSelection(textarea) {
    const start = textarea.selectionStart || 0;
    const end = textarea.selectionEnd || start;
    const value = textarea.value || "";
    const lineStart = value.lastIndexOf("\n", Math.max(0, start - 1)) + 1;
    const lineEndIndex = value.indexOf("\n", end);
    const lineEnd = lineEndIndex === -1 ? value.length : lineEndIndex;
    const block = value.slice(lineStart, lineEnd);
    const bulleted = block
      .split("\n")
      .map((line) => line.trim().startsWith("- ") ? line : `- ${line}`)
      .join("\n");
    textarea.value = `${value.slice(0, lineStart)}${bulleted}${value.slice(lineEnd)}`;
    textarea.focus({ preventScroll: true });
    textarea.setSelectionRange(lineStart, lineStart + bulleted.length);
    textarea.dispatchEvent(new Event("input", { bubbles: true }));
  }

  function handleEditorFormatShortcuts(ev) {
    const textarea = ev.target instanceof HTMLTextAreaElement ? ev.target : null;
    if (!textarea || textarea.id !== "detailEditorBody") return;
    const key = String(ev.key || "").toLowerCase();
    const primary = ev.ctrlKey || ev.metaKey;
    if (!primary || ev.altKey) return;

    if (key === "b") {
      ev.preventDefault();
      wrapSelection(textarea, "**");
      return;
    }
    if (key === "i") {
      ev.preventDefault();
      wrapSelection(textarea, "*");
      return;
    }
    if (key === "8" && ev.shiftKey) {
      ev.preventDefault();
      bulletSelection(textarea);
    }
  }

  function init() {
    const overlay = document.getElementById("detailOverlay");
    if (overlay instanceof HTMLElement) {
      const observer = new MutationObserver(focusBodyWhenEditorOpens);
      observer.observe(overlay, { attributes: true, attributeFilter: ["hidden"] });
    }
    document.addEventListener("keydown", handleEditorFormatShortcuts, true);
  }

  global.PocketEditorJoy = Object.freeze({ focusBodyWhenEditorOpens });

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init, { once: true });
  else init();
})(window);
