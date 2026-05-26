/* Movable detail editor. Drag the title or path area. */

(function (global) {
  "use strict";

  let active = null;

  function card() {
    return document.querySelector("#detailOverlay .detailCard");
  }

  function phoneMode() {
    return document.body.classList.contains("phoneMode");
  }

  function limit(value, min, max) {
    return Math.max(min, Math.min(value, max));
  }

  function place(el, x, y) {
    const margin = 8;
    const rect = el.getBoundingClientRect();
    const vw = Math.max(document.documentElement.clientWidth || 0, global.innerWidth || 0);
    const vh = Math.max(document.documentElement.clientHeight || 0, global.innerHeight || 0);
    el.style.position = "absolute";
    el.style.left = `${Math.round(limit(x, margin, Math.max(margin, vw - rect.width - margin)))}px`;
    el.style.top = `${Math.round(limit(y, margin, Math.max(margin, vh - rect.height - margin)))}px`;
    el.style.transform = "none";
  }

  function reset() {
    const el = card();
    if (!(el instanceof HTMLElement)) return;
    el.style.position = "";
    el.style.left = "";
    el.style.top = "";
    el.style.transform = "";
  }

  function start(ev) {
    if (phoneMode()) return;
    if (ev.button !== 0) return;
    const target = ev.target instanceof Element ? ev.target : null;
    if (!target || !target.closest("#detailEditorTitle, #detailEditorPath")) return;
    const el = card();
    if (!(el instanceof HTMLElement)) return;
    const rect = el.getBoundingClientRect();
    active = { id: ev.pointerId, el, dx: ev.clientX - rect.left, dy: ev.clientY - rect.top };
    ev.preventDefault();
    ev.stopPropagation();
    el.classList.add("dragging");
    place(el, rect.left, rect.top);
  }

  function move(ev) {
    if (!active || active.id !== ev.pointerId) return;
    ev.preventDefault();
    place(active.el, ev.clientX - active.dx, ev.clientY - active.dy);
  }

  function end(ev) {
    if (!active || active.id !== ev.pointerId) return;
    active.el.classList.remove("dragging");
    active = null;
  }

  function init() {
    const overlay = document.getElementById("detailOverlay");
    const title = document.getElementById("detailEditorTitle");
    const path = document.getElementById("detailEditorPath");
    if (!(overlay instanceof HTMLElement)) return;
    [title, path].forEach((el) => {
      if (!(el instanceof HTMLElement)) return;
      el.classList.add("detailDragHandle");
    });
    overlay.addEventListener("pointerdown", start, true);
    overlay.addEventListener("pointermove", move, true);
    overlay.addEventListener("pointerup", end, true);
    overlay.addEventListener("pointercancel", end, true);
    global.addEventListener("resize", () => { if (phoneMode()) reset(); });
  }

  global.PocketDetailDrag = Object.freeze({ init, reset });

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init, { once: true });
  else init();
})(window);
