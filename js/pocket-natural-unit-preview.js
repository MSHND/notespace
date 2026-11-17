/* Dormant view proof. The caller supplies already authorised text. */
(function (global) {
  "use strict";

  function createPreview(document, authorisedText) {
    if (typeof authorisedText !== "string") return null;
    const body = document.createElement("div");
    body.style.whiteSpace = "pre-wrap";
    body.style.overflowWrap = "anywhere";
    body.textContent = authorisedText;
    const lines = authorisedText.split(/\r\n|\n|\r/u, 3);
    if (lines.length <= 2 && authorisedText.length <= 160) return body;

    const view = document.createElement("details");
    view.open = false;
    const summary = document.createElement("summary");
    const snippet = document.createElement("span");
    snippet.style.whiteSpace = "pre-wrap";
    snippet.style.overflowWrap = "anywhere";
    snippet.style.display = "-webkit-box";
    snippet.style.webkitBoxOrient = "vertical";
    snippet.style.webkitLineClamp = "2";
    snippet.style.overflow = "hidden";
    snippet.textContent = lines.slice(0, 2).join("\n");
    const action = document.createElement("span");
    action.textContent = " More…";
    summary.appendChild(snippet);
    summary.appendChild(action);
    view.appendChild(summary);
    view.appendChild(body);
    view.addEventListener("toggle", () => {
      snippet.style.display = view.open ? "none" : "-webkit-box";
      action.textContent = view.open ? " Show less" : " More…";
    });
    return view;
  }

  if (typeof module === "object" && module.exports) module.exports = createPreview;
  else global.PocketNaturalUnitPreview = createPreview;
})(typeof window !== "undefined" ? window : globalThis);
