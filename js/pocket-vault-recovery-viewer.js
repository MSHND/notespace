/* Dedicated read-only inspection surface for decrypted browser recovery. */
(function initialisePocketVaultRecoveryViewer(global) {
  "use strict";

  let activeViewer = null;
  let bound = false;
  let inertRecords = [];

  function dom(id) {
    return global.document?.getElementById?.(id) || null;
  }

  function clean(value, max = 220) {
    return typeof global.cleanText === "function"
      ? global.cleanText(value, max)
      : String(value || "").trim().slice(0, max);
  }

  function cloneJson(value) {
    try {
      return JSON.parse(JSON.stringify(value));
    } catch (_error) {
      return null;
    }
  }

  function setBackgroundInert(enabled) {
    const overlay = dom("vaultRecoveryViewerOverlay");
    if (!overlay?.parentElement) return;
    if (enabled) {
      if (inertRecords.length) return;
      inertRecords = Array.from(overlay.parentElement.children || [])
        .filter((element) => element !== overlay)
        .map((element) => {
          const previous = element.inert === true;
          element.inert = true;
          return { element, previous };
        });
      return;
    }
    for (const record of inertRecords) {
      if (record?.element) record.element.inert = record.previous;
    }
    inertRecords = [];
  }

  function visibleViewerControls() {
    const overlay = dom("vaultRecoveryViewerOverlay");
    if (!overlay || typeof overlay.querySelectorAll !== "function") return [];
    return Array.from(overlay.querySelectorAll("button:not([disabled])"))
      .filter((element) => !element.hidden && !element.closest?.("[hidden]"));
  }

  function focusViewerInitial() {
    const preferred = dom("vaultRecoveryKeep");
    const target = preferred && !preferred.hidden && !preferred.disabled
      ? preferred
      : visibleViewerControls()[0];
    target?.focus?.({ preventScroll: true });
  }

  function childNodes(parentId) {
    if (!activeViewer) return [];
    return activeViewer.nodes
      .filter((node) => clean(node?.parentId, 80) === parentId)
      .sort((left, right) => {
        const orderDelta = Number(left?.order || 0) - Number(right?.order || 0);
        return orderDelta || clean(left?.label).localeCompare(clean(right?.label));
      });
  }

  function outlineText(node) {
    const present = !!node
      && typeof node === "object"
      && Object.prototype.hasOwnProperty.call(node, "editor");
    const classification = global.PocketEditorMetadata?.classifyEditorMeta?.(
      present ? node.editor : undefined,
      { present }
    );
    if (classification?.kind === "supported-v1-outline") {
      return classification.normalised.outline
        .map((block) => `${"  ".repeat(Math.max(0, Number(block?.depth) || 0))}${String(block?.text || "")}`)
        .join("\n");
    }
    return classification?.kind === "unsupported-or-malformed"
      ? "This item contains editor data that this Pocket version cannot display safely."
      : "";
  }

  function renderSelected() {
    if (!activeViewer) return false;
    const node = activeViewer.nodeMap.get(activeViewer.selectedId) || null;
    const label = node ? clean(node.label, 220) || "Untitled" : "Select a recovered item";
    const details = node ? String(node.details || "").replace(/\r/g, "") : "";
    const outline = node ? outlineText(node) : "";
    const labelElement = dom("vaultRecoverySelectedLabel");
    const detailsElement = dom("vaultRecoverySelectedDetails");
    const outlineSection = dom("vaultRecoverySelectedOutlineSection");
    const outlineElement = dom("vaultRecoverySelectedOutline");
    if (labelElement) labelElement.textContent = label;
    if (detailsElement) {
      detailsElement.textContent = details || "No readable Notes.";
    }
    if (outlineElement) outlineElement.textContent = outline;
    if (outlineSection) outlineSection.hidden = !outline;
    return true;
  }

  function selectNode(nodeId) {
    if (!activeViewer || !activeViewer.nodeMap.has(clean(nodeId, 80))) return false;
    activeViewer.selectedId = clean(nodeId, 80);
    renderTree();
    renderSelected();
    return true;
  }

  function toggleBranch(nodeId) {
    if (!activeViewer || !activeViewer.nodeMap.has(clean(nodeId, 80))) return false;
    const id = clean(nodeId, 80);
    if (!childNodes(id).length) return false;
    if (activeViewer.collapsed.has(id)) activeViewer.collapsed.delete(id);
    else activeViewer.collapsed.add(id);
    renderTree();
    return true;
  }

  function appendTreeBranch(list, parentId) {
    if (!activeViewer) return;
    for (const node of childNodes(parentId)) {
      const id = clean(node.id, 80);
      const children = childNodes(id);
      const item = global.document.createElement("li");
      item.className = "vaultRecoveryTreeItem";
      const row = global.document.createElement("div");
      row.className = "vaultRecoveryTreeRow";
      if (children.length) {
        const toggle = global.document.createElement("button");
        toggle.type = "button";
        toggle.className = "vaultRecoveryTreeToggle";
        toggle.textContent = activeViewer.collapsed.has(id) ? "›" : "⌄";
        toggle.setAttribute("aria-label", activeViewer.collapsed.has(id) ? "Expand branch" : "Collapse branch");
        toggle.addEventListener("click", () => toggleBranch(id));
        row.appendChild(toggle);
      } else {
        const spacer = global.document.createElement("span");
        spacer.className = "vaultRecoveryTreeToggleSpacer";
        row.appendChild(spacer);
      }
      const button = global.document.createElement("button");
      button.type = "button";
      button.className = `vaultRecoveryTreeNode${activeViewer.selectedId === id ? " selected" : ""}`;
      button.textContent = clean(node.label, 220) || "Untitled";
      button.setAttribute("aria-pressed", activeViewer.selectedId === id ? "true" : "false");
      button.addEventListener("click", () => selectNode(id));
      row.appendChild(button);
      item.appendChild(row);
      if (children.length && !activeViewer.collapsed.has(id)) {
        const nested = global.document.createElement("ul");
        nested.className = "vaultRecoveryTreeList";
        appendTreeBranch(nested, id);
        item.appendChild(nested);
      }
      list.appendChild(item);
    }
  }

  function renderTree() {
    const root = dom("vaultRecoveryTree");
    if (!root || !activeViewer) return false;
    root.innerHTML = "";
    appendTreeBranch(root, "root");
    return true;
  }

  function finish(action) {
    const viewer = activeViewer;
    if (!viewer) return false;
    const overlay = dom("vaultRecoveryViewerOverlay");
    if (overlay) overlay.hidden = true;
    global.document?.body?.classList?.remove("vaultRecoveryViewerOpen");
    setBackgroundInert(false);
    activeViewer = null;
    const root = dom("vaultRecoveryTree");
    if (root) root.innerHTML = "";
    for (const id of [
      "vaultRecoverySelectedLabel",
      "vaultRecoverySelectedDetails",
      "vaultRecoverySelectedOutline",
      "vaultRecoveryCaptureTime",
    ]) {
      const element = dom(id);
      if (element) element.textContent = "";
    }
    viewer.nodes = [];
    viewer.nodeMap.clear();
    viewer.document = null;
    viewer.resolve(action);
    return true;
  }

  function bind() {
    if (bound) return true;
    bound = true;
    const actions = {
      vaultRecoveryKeep: "keep",
      vaultRecoverySaveVault: "save-vault",
      vaultRecoverySaveJson: "save-json",
      vaultRecoveryAddExisting: "add-existing",
      vaultRecoveryDiscard: "discard",
    };
    for (const [id, action] of Object.entries(actions)) {
      dom(id)?.addEventListener("click", () => finish(action));
    }
    dom("vaultRecoveryViewerOverlay")?.addEventListener("keydown", (event) => {
      if (!activeViewer) return;
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation?.();
        finish("keep");
        return;
      }
      if (event.key !== "Tab") return;
      const controls = visibleViewerControls();
      if (!controls.length) {
        event.preventDefault();
        return;
      }
      const index = controls.indexOf(global.document?.activeElement);
      const next = event.shiftKey
        ? (index <= 0 ? controls.length - 1 : index - 1)
        : (index < 0 || index >= controls.length - 1 ? 0 : index + 1);
      event.preventDefault();
      event.stopPropagation?.();
      controls[next].focus?.({ preventScroll: true });
    });
    global.document?.addEventListener?.("focusin", (event) => {
      const overlay = dom("vaultRecoveryViewerOverlay");
      if (!activeViewer || overlay?.contains?.(event.target)) return;
      focusViewerInitial();
    });
    return true;
  }

  function show(documentValue, capturedAt) {
    if (activeViewer) return Promise.resolve(false);
    const documentClone = cloneJson(documentValue);
    const nodes = Array.isArray(documentClone?.nodes) ? documentClone.nodes : null;
    if (!nodes) return Promise.resolve(false);
    bind();
    return new Promise((resolve) => {
      const nodeMap = new Map();
      for (const node of nodes) {
        const id = clean(node?.id, 80);
        if (id) nodeMap.set(id, node);
      }
      const firstRoot = nodes.find((node) => clean(node?.parentId, 80) === "root") || nodes[0] || null;
      activeViewer = {
        document: documentClone,
        nodes,
        nodeMap,
        collapsed: new Set(),
        selectedId: clean(firstRoot?.id, 80),
        capturedAt: clean(capturedAt, 40),
        resolve,
      };
      const capture = dom("vaultRecoveryCaptureTime");
      if (capture) {
        const date = Number.isFinite(Date.parse(capturedAt)) ? new Date(capturedAt) : null;
        capture.textContent = date
          ? `Captured ${date.toLocaleString()}`
          : "Capture time unavailable";
      }
      renderTree();
      renderSelected();
      const overlay = dom("vaultRecoveryViewerOverlay");
      if (overlay) overlay.hidden = false;
      global.document?.body?.classList?.add("vaultRecoveryViewerOpen");
      setBackgroundInert(true);
      focusViewerInitial();
    });
  }

  function snapshot() {
    if (!activeViewer) return null;
    const node = activeViewer.nodeMap.get(activeViewer.selectedId) || null;
    return {
      capturedAt: activeViewer.capturedAt,
      nodeCount: activeViewer.nodes.length,
      selectedId: activeViewer.selectedId,
      selectedLabel: node ? clean(node.label, 220) : "",
      selectedDetails: node ? String(node.details || "") : "",
      selectedOutline: node ? outlineText(node) : "",
      collapsedIds: Array.from(activeViewer.collapsed),
    };
  }

  global.PocketVaultRecoveryViewer = Object.freeze({
    show,
    isOpen: () => !!activeViewer,
    selectNode,
    toggleBranch,
    snapshot,
  });
})(typeof window !== "undefined" ? window : globalThis);
