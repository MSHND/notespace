/* Empty state, tree rendering, overflow labels, add/rename/delete commands. */

function buildEmptyState(queryText = "", focusRoot = null) {
  const li = document.createElement("li");
  li.className = "treeEmptyHint";

  const card = document.createElement("div");
  card.className = "emptyState";

  const title = document.createElement("div");
  title.className = "emptyStateTitle";

  const text = document.createElement("div");
  text.className = "emptyStateText";

  const actions = document.createElement("div");
  actions.className = "emptyStateActions";

  const addAction = (label, onClick, titleText = "") => {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "emptyStateAction";
    btn.textContent = label;
    if (titleText) btn.title = titleText;
    btn.addEventListener("click", (ev) => {
      ev.preventDefault();
      ev.stopPropagation();
      onClick();
    });
    actions.appendChild(btn);
    return btn;
  };

  const hasQuery = cleanText(queryText, 120).length > 0;
  const hasNodes = Array.isArray(state.nodes) && state.nodes.length > 0;
  if (hasQuery) {
    title.textContent = "Nothing matched.";
    text.textContent = "Clear the filter to come back to your full pocket.";
    addAction("Clear filter", () => clearFilterAndReturnHome("Filter cleared."));
  } else if (focusRoot) {
    title.textContent = "This branch is quiet.";
    text.textContent = "Add something here, or step back to the full tree.";
    addAction("Add here", () => addItemsFromPrimaryAction());
    addAction("Full pocket", () => clearFocusAndReturnHome("Back to full pocket."));
  } else if (!hasNodes) {
    title.textContent = "Nothing here yet.";
    text.textContent = "Add the first item when you're ready.";
    addAction("Add item", () => addItemsFromPrimaryAction());
  } else {
    title.textContent = "Nothing here yet.";
    text.textContent = "Add a thought here, or return to the full tree.";
    addAction("Add item", () => addItemsFromPrimaryAction());
    if (state.focusRootId) addAction("Full pocket", () => clearFocusAndReturnHome("Back to full pocket."));
  }

  card.appendChild(title);
  card.appendChild(text);
  if (actions.childNodes.length > 0) card.appendChild(actions);
  li.appendChild(card);
  return li;
}

function buildPocketFileGateState() {
  const session = state.pocketFile && typeof state.pocketFile === "object" ? state.pocketFile : {};
  const recovery = typeof readLocalSafetySnapshot === "function" ? readLocalSafetySnapshot() : null;
  const gateMode = cleanText(session.gateMode, 20);
  const blocked = gateMode === "blocked";
  const capabilities = window.PocketDoorwayCapabilities?.read?.() || Object.freeze({
    localOpen: false,
    localNew: false,
    syncedOpen: false,
    syncedNew: false,
    anyOpen: false,
    anyNew: false,
    anyAction: false,
  });
  return {
    blocked,
    recovery: !!recovery,
    recentName: cleanText(session.recentName, 120),
    capabilities,
  };
}

function buildPocketFileGate() {
  const gate = buildPocketFileGateState();
  const li = document.createElement("li");
  li.className = "treeEmptyHint";

  const card = document.createElement("div");
  card.className = "emptyState";

  const title = document.createElement("div");
  title.className = "emptyStateTitle";
  title.textContent = gate.blocked
    ? "Open a Pocket to continue"
    : (gate.recovery ? "Finish saving your Pocket changes" : "Pocket");

  const text = document.createElement("div");
  text.className = "emptyStateText";
  const capabilities = gate.capabilities;
  const availableText = capabilities.anyOpen && capabilities.anyNew
    ? "Open an existing Pocket, or start a new one."
    : (capabilities.anyOpen
      ? "Open an existing Pocket to continue."
      : (capabilities.anyNew
        ? "Start a new Pocket to continue."
        : "Pocket cannot open or create a persistent local file here, and Synced Pocket is not available."));
  text.textContent = gate.recovery
    ? "Pocket found changes that may not have been saved."
    : availableText;

  const actions = document.createElement("div");
  actions.className = "emptyStateActions";
  const addAction = (label, onClick, options = {}) => {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "emptyStateAction";
    btn.textContent = label;
    btn.addEventListener("click", (ev) => {
      ev.preventDefault();
      ev.stopPropagation();
      if (options.clearGate !== false && state.pocketFile && typeof state.pocketFile === "object") state.pocketFile.gateMode = "";
      onClick();
    });
    actions.appendChild(btn);
  };
  if (capabilities.anyOpen) {
    addAction("Open", () => {
      if (typeof openPocketDoorway === "function") openPocketDoorway();
      else if (capabilities.localOpen && typeof openPocketFile === "function") void openPocketFile();
    });
  }
  if (capabilities.anyNew) {
    addAction("New", () => {
      if (typeof openPocketNewDoorway === "function") openPocketNewDoorway();
    });
  }

  card.appendChild(title);
  card.appendChild(text);
  if (gate.recentName) {
    const hint = document.createElement("div");
    hint.className = "emptyStateText";
    hint.textContent = `Last used: ${gate.recentName}`;
    card.appendChild(hint);
  }
  if (actions.childNodes.length > 0) card.appendChild(actions);
  li.appendChild(card);
  return li;
}

// Derived Main presentation index. Full renderTree() owns its lifecycle;
// semantic truth remains in state.nodes.
const mainMountedNodeRegistry = new Map();
const mainMountedNodeRegistryAmbiguousIds = new Set();

function clearMainMountedNodeRegistry() {
  mainMountedNodeRegistry.clear();
  mainMountedNodeRegistryAmbiguousIds.clear();
}

function registerMainMountedNode(nodeId, branch, row) {
  const id = cleanText(nodeId, 80);
  if (!id || !(branch instanceof HTMLElement) || !(row instanceof HTMLElement)) return false;
  if (mainMountedNodeRegistryAmbiguousIds.has(id)) return false;
  if (mainMountedNodeRegistry.has(id)) {
    mainMountedNodeRegistry.delete(id);
    mainMountedNodeRegistryAmbiguousIds.add(id);
    return false;
  }
  mainMountedNodeRegistry.set(id, { branch, row });
  return true;
}

function currentMainMountedNodeEntry(nodeId) {
  const id = cleanText(nodeId, 80);
  if (!id || mainMountedNodeRegistryAmbiguousIds.has(id) || !(el.treeRoot instanceof HTMLElement)) return null;
  const entry = mainMountedNodeRegistry.get(id) || null;
  if (!entry || !(entry.branch instanceof HTMLElement) || !(entry.row instanceof HTMLElement)) return null;
  if (entry.row.getAttribute("data-node-id") !== id) return null;
  if (entry.row.parentNode !== entry.branch) return null;
  if (!el.treeRoot.contains(entry.branch)) return null;
  return entry;
}

function getMountedMainRowForNodeId(nodeId) {
  return currentMainMountedNodeEntry(nodeId)?.row || null;
}

function projectMainPrimarySelection(previousNodeId, nextNodeId) {
  const previousId = cleanText(previousNodeId, 80);
  const nextId = cleanText(nextNodeId, 80);
  if (!previousId || !nextId || previousId === nextId) return false;
  if (typeof canShowPocketTree === "function" && !canShowPocketTree()) return false;
  if (cleanText(state.selectedId, 80) !== nextId) return false;
  if (cleanText(el.search?.value, 120)) return false;
  if (cleanText(state.focusRootId, 80)) return false;
  if (cleanText(state.inlineEdit?.id, 80)) return false;
  if (state.rowMiniMenuOpen) return false;
  if (document.body?.classList?.contains?.("phoneMode")) return false;

  const multiSelected = state.multiSelectedIds;
  if (multiSelected instanceof Set) {
    if (multiSelected.size > 0) return false;
  } else if (Array.isArray(multiSelected)) {
    if (multiSelected.length > 0) return false;
  } else if (multiSelected != null) {
    return false;
  }

  const previous = currentMainMountedNodeEntry(previousId);
  const next = currentMainMountedNodeEntry(nextId);
  if (!previous || !next || previous.row === next.row) return false;
  if (!previous.row.classList.contains("selected")) return false;
  if (next.row.classList.contains("selected")) return false;

  previous.row.classList.remove("selected");
  next.row.classList.add("selected");
  return true;
}

function projectMainSameParentReorder(movingNodeId, adjacentTargetNodeId, direction) {
  const moveDirection = Number(direction) < 0 ? -1 : (Number(direction) > 0 ? 1 : 0);
  if (!moveDirection) return false;
  if (typeof canShowPocketTree === "function" && !canShowPocketTree()) return false;
  if (cleanText(el.search?.value, 120)) return false;

  const moving = currentMainMountedNodeEntry(movingNodeId);
  const target = currentMainMountedNodeEntry(adjacentTargetNodeId);
  if (!moving || !target || moving.branch === target.branch) return false;

  const parentList = moving.branch.parentNode;
  if (!(parentList instanceof HTMLElement) || target.branch.parentNode !== parentList) return false;
  if (moveDirection < 0) {
    if (target.branch.nextSibling !== moving.branch) return false;
  } else if (moving.branch.nextSibling !== target.branch) {
    return false;
  }

  if (moveDirection < 0) parentList.insertBefore(moving.branch, target.branch);
  else parentList.insertBefore(moving.branch, target.branch.nextSibling);
  return true;
}

function openItemDetailsForNode(nodeId) {
  if (typeof requirePocketFileForChanges === "function" && !requirePocketFileForChanges()) return false;
  const id = cleanText(nodeId, 80);
  if (!id || !nodeMap().get(id)) return false;
  state.selectedId = id;
  if (typeof cancelPendingCopyClick === "function") cancelPendingCopyClick();
  if (typeof closeRowMiniMenu === "function") closeRowMiniMenu({ restoreFocus: false });
  if (typeof closeCommandPalette === "function") closeCommandPalette({ restoreFocus: false });
  if (typeof window.openPocketNodeEditor === "function") return !!window.openPocketNodeEditor(id);
  if (typeof window.openPocketEditor === "function") return !!window.openPocketEditor(id);
  if (typeof window.openPocketPeEditor === "function") return !!window.openPocketPeEditor(id);
  if (window.PocketPeEditor && typeof window.PocketPeEditor.open === "function") return !!window.PocketPeEditor.open(id);
  return false;
}

function supportedOutlineForNode(node) {
  const metadata = window.PocketEditorMetadata;
  if (!metadata
    || typeof metadata.classifyEditorMeta !== "function"
    || typeof metadata.isMeaningfulOutline !== "function") {
    return null;
  }

  const present = !!node
    && typeof node === "object"
    && Object.prototype.hasOwnProperty.call(node, "editor");
  const classification = metadata.classifyEditorMeta(
    present ? node.editor : undefined,
    { present },
  );
  const outline = classification.kind === "supported-v1-outline"
    ? classification.normalised && classification.normalised.outline
    : null;
  return metadata.isMeaningfulOutline(outline) ? outline : null;
}

function treeContentIndicatorForNode(node) {
  const view = window.PocketNodeContent?.readNode?.(node);
  const text = view?.text || "";
  if (!text.trim()) return { visible: false, title: "" };
  const first = text.split("\n").map((line) => cleanText(line, 180)).find(Boolean);
  return { visible: true, title: first || "Has content" };
}

function filterWordRuns(value) {
  return String(value || "").toLowerCase().match(/[\p{L}\p{N}]+/gu) || [];
}

function orderedFilterWordPrefixMatch(query, candidate) {
  const fragments = filterWordRuns(query);
  if (!fragments.length) return true;
  const words = filterWordRuns(candidate);
  let wordIndex = 0;
  for (const fragment of fragments) {
    let matched = false;
    while (wordIndex < words.length) {
      const word = words[wordIndex];
      wordIndex += 1;
      if (word.startsWith(fragment)) {
        matched = true;
        break;
      }
    }
    if (!matched) return false;
  }
  return true;
}

function renderTree(options = {}) {
  clearMainMountedNodeRegistry();
  if (typeof canShowPocketTree === "function" && !canShowPocketTree()) {
    if (el.treeRoot instanceof HTMLElement) {
      el.treeRoot.innerHTML = "";
      el.treeRoot.appendChild(buildPocketFileGate());
    }
    if (typeof refreshTreeLabelOverflowTitles === "function") refreshTreeLabelOverflowTitles();
    return;
  }
  const query = cleanText(el.search.value, 120);
  const queryWords = filterWordRuns(query);
  const filtering = queryWords.length > 0;
  const byId = nodeMap();
  const byParent = childrenMap();
  if (state.focusRootId && !byId.has(state.focusRootId)) {
    state.focusRootId = "";
  }
  const focusRoot = state.focusRootId ? byId.get(state.focusRootId) : null;

  function nodeOutlineText(node) {
    return window.PocketNodeContent?.readNode?.(node)?.text || normaliseDetails(node?.details, 4000);
  }

  function nodeSearchText(node) {
    return [
      getPath(node.id),
      node.label,
      nodeOutlineText(node),
      node?.task?.notes,
      node?.profile?.keywords?.join?.(" "),
      node?.profile?.entities?.join?.(" "),
      node?.profile?.people?.join?.(" ")
    ].filter(Boolean).join("\n").toLowerCase();
  }

  function matches(node) {
    if (!filtering) return true;
    return orderedFilterWordPrefixMatch(query, nodeSearchText(node));
  }

  function hasVisibleDesc(nodeId) {
    const kids = byParent.get(nodeId) || [];
    for (const kid of kids) {
      if (matches(kid) || hasVisibleDesc(kid.id)) return true;
    }
    return false;
  }

  function depthIndentPx(depth) {
    const d = Math.max(0, Number(depth) || 0);
    if (d <= 0) return 8;
    if (d === 1) return 20;
    if (d === 2) return 30;
    if (d === 3) return 38;
    return 38 + ((d - 3) * 7);
  }

  const actualMatchIds = [];

  function build(node, depth) {
    const nodeMatches = matches(node);
    if (!nodeMatches && !hasVisibleDesc(node.id)) return null;
    if (filtering && nodeMatches) actualMatchIds.push(node.id);
    const li = document.createElement("li");
    li.className = "treeNode";

    const row = document.createElement("div");
    const attentionState = nodeAttentionState(node);
    const rowAttentionClass = attentionState === "manual_urgent" ? " urgent" : "";
    row.className = `row${state.selectedId === node.id ? " selected" : ""}${state.rowMiniMenuOpen && state.rowMiniMenuNodeId === node.id ? " menuOpen" : ""}${rowAttentionClass}`;
    row.setAttribute("data-node-id", node.id);
    row.style.paddingLeft = `${depthIndentPx(depth)}px`;
    row.tabIndex = 0;

    const children = byParent.get(node.id) || [];
    const hasKids = children.length > 0;
    const copyActionReady = shouldCopyOnSingleClick(node, hasKids);
    if (copyActionReady) row.classList.add("copyReady");
    const isCollapsed = !filtering && state.collapsed.has(node.id);

    const twisty = document.createElement("button");
    twisty.type = "button";
    twisty.className = `twisty${hasKids ? "" : " empty"}`;
    twisty.textContent = hasKids ? (isCollapsed ? "▸" : "▾") : "";
    twisty.setAttribute("aria-label", hasKids
      ? `${isCollapsed ? "Expand" : "Collapse"} branch`
      : "Select branch");
    if (typeof installTreeGutterDrag === "function") installTreeGutterDrag(twisty, node.id);
    twisty.addEventListener("click", (ev) => {
      ev.preventDefault();
      ev.stopPropagation();
      cancelPendingCopyClick();
      state.selectedId = node.id;
      if (hasKids) {
        if (state.collapsed.has(node.id)) state.collapsed.delete(node.id);
        else state.collapsed.add(node.id);
      }
      renderTree();
      refocusTreeNavigation(node.id);
    });
    row.appendChild(twisty);

    if (state.inlineEdit.id === node.id) {
      const input = document.createElement("input");
      input.className = "labelEdit";
      input.type = "text";
      input.value = node.label || "";
      input.placeholder = state.inlineEdit.isNew ? "What belongs here?" : "Rename item";
      input.setAttribute("data-edit-id", node.id);
      let finished = false;
      const finishCommitWith = (value, options = {}) => {
        if (finished) return;
        const result = commitInlineEdit(node.id, value, options);
        if (result?.ok || state.inlineEdit.id !== node.id) finished = true;
        return result;
      };
      const finishCommit = () => finishCommitWith(input.value);
      const finishCancel = () => {
        if (finished) return;
        cancelInlineEdit(node.id);
        if (state.inlineEdit.id !== node.id) finished = true;
      };
      input.addEventListener("click", (ev) => ev.stopPropagation());
      input.addEventListener("dblclick", (ev) => ev.stopPropagation());
      input.addEventListener("keydown", (ev) => {
        ev.stopPropagation();
        if (ev.key === "Enter") {
          ev.preventDefault();
          finishCommit();
          return;
        }
        if (
          ev.key === "Tab"
          && !ev.shiftKey
          && !ev.metaKey
          && !ev.ctrlKey
          && !ev.altKey
          && state.inlineEdit.id === node.id
          && state.inlineEdit.isNew === true
        ) {
          ev.preventDefault();
          const result = finishCommit();
          if (result?.ok && result.kind === "add" && result.id === node.id) {
            insertSiblingBelow(result.id);
          }
          return;
        }
        if (ev.key === "Escape") {
          ev.preventDefault();
          finishCancel();
        }
      });
      input.addEventListener("blur", () => finishCommit());
      row.appendChild(input);
      if (state.inlineEdit.autoFocus) {
        state.inlineEdit.autoFocus = false;
        requestAnimationFrame(() => {
          if (!document.body.contains(input)) return;
          input.focus({ preventScroll: true });
          input.select();
        });
      }
    } else {
      const label = document.createElement("div");
      const labelAttentionClass = attentionState === "manual_urgent" ? " urgent" : "";
      label.className = `label${labelAttentionClass}`;
      label.textContent = node.label;
      label.setAttribute("data-full-label", cleanText(node.label, 500) || getPath(node.id));
      row.appendChild(label);
    }

    const contentIndicator = treeContentIndicatorForNode(node);
    if (contentIndicator.visible) {
      const detailBadge = document.createElement("span");
      detailBadge.className = "detailBadge";
      detailBadge.textContent = "...";
      detailBadge.title = contentIndicator.title;
      row.appendChild(detailBadge);
    }

    row.addEventListener("click", (ev) => {
      const copyOnClick = shouldCopyOnSingleClick(node, hasKids);
      const previousId = cleanText(state.selectedId, 80);
      const multiSelectionCleared = typeof consumePocketOrdinaryRowClickMultiClear === "function"
        && consumePocketOrdinaryRowClickMultiClear(ev) === true;
      const plainDesktopClick = !ev.altKey
        && !ev.metaKey
        && !ev.ctrlKey
        && !ev.shiftKey
        && !document.body?.classList?.contains?.("phoneMode");

      state.selectedId = node.id;
      row.focus({ preventScroll: true });
      refreshMeta();

      let settledLocally = false;
      if (plainDesktopClick && !multiSelectionCleared) {
        if (previousId === node.id) {
          settledLocally = true;
        } else if (typeof projectMainPrimarySelection === "function") {
          try {
            settledLocally = projectMainPrimarySelection(previousId, node.id) === true;
          } catch {}
        }
      }
      if (!settledLocally) renderTree();

      focusRowByNodeId(node.id);
      if (copyOnClick) scheduleCopyClick(node.id);
      else cancelPendingCopyClick();
    });
    row.addEventListener("dblclick", (ev) => {
      ev.preventDefault();
      ev.stopPropagation();
      cancelPendingCopyClick();
      state.selectedId = node.id;
      refreshMeta();
      renderTree();
      focusRowByNodeId(node.id);
      openItemDetailsForNode(node.id);
    });
    row.addEventListener("contextmenu", (ev) => {
      if (state.inlineEdit.id === node.id) return;
      ev.preventDefault();
      ev.stopPropagation();
      cancelPendingCopyClick();
      state.selectedId = node.id;
      refreshMeta();
      renderTree();
      const currentRow = typeof getMountedMainRowForNodeId === "function"
        ? getMountedMainRowForNodeId(node.id)
        : row;
      if (typeof openRowMiniMenu === "function") {
        openRowMiniMenu(node.id, currentRow instanceof HTMLElement ? currentRow : row, {
          x: ev.clientX,
          y: ev.clientY,
        });
      }
    });

    li.appendChild(row);
    registerMainMountedNode(node.id, li, row);

    if (hasKids && !isCollapsed) {
      const ul = document.createElement("ul");
      const childDepth = depth + 1;
      const childGroupIndentPx = Math.max(10, depthIndentPx(childDepth) - 8);
      ul.className = "children groupedChildBlock";
      ul.style.setProperty("--group-indent", `${childGroupIndentPx}px`);
      for (const kid of children) {
        const child = build(kid, childDepth);
        if (child) ul.appendChild(child);
      }
      if (ul.childNodes.length > 0) li.appendChild(ul);
    }

    return li;
  }

  const roots = focusRoot ? [focusRoot] : (byParent.get("root") || []).slice();
  const rendered = [];
  for (const root of roots) {
    const node = build(root, 0);
    if (node) rendered.push(node);
  }

  el.treeRoot.innerHTML = "";
  for (const n of rendered) el.treeRoot.appendChild(n);
  if (rendered.length === 0) {
    el.treeRoot.appendChild(buildEmptyState(query, focusRoot));
  }
  refreshTreeLabelOverflowTitles();
  repairVisibleSelectionAfterRender({
    repairFilteredSelection: options.repairFilteredSelection === true && filtering,
    actualMatchIds,
  });
  requestAnimationFrame(() => refreshTreeLabelOverflowTitles());

  if (state.inlineEdit.id) {
    const activeInput = el.treeRoot.querySelector(`[data-edit-id="${state.inlineEdit.id}"]`);
    if (activeInput) {
      requestAnimationFrame(() => {
        activeInput.focus();
        activeInput.select();
      });
    }
  }
}

function refreshTreeLabelOverflowTitles() {
  if (!(el.treeRoot instanceof HTMLElement)) return;
  const labels = el.treeRoot.querySelectorAll(".label[data-full-label]");
  for (const labelEl of labels) {
    if (!(labelEl instanceof HTMLElement)) continue;
    const fullText = cleanText(labelEl.getAttribute("data-full-label") || "", 500);
    if (!fullText) {
      labelEl.removeAttribute("title");
      continue;
    }
    const isOverflowed = (labelEl.scrollWidth - labelEl.clientWidth) > 1;
    if (isOverflowed) labelEl.setAttribute("title", fullText);
    else labelEl.removeAttribute("title");
  }
}

function maxSiblingOrder(parentId) {
  let max = 1000;
  for (const n of state.nodes) {
    if ((n.parentId || "root") !== parentId) continue;
    if (Number.isFinite(n.order) && n.order > max) max = n.order;
  }
  return max;
}

function addItemsFromPrimaryAction() {
  if (typeof requirePocketFileForChanges === "function" && !requirePocketFileForChanges()) return;
  const map = nodeMap();
  const selectedId = cleanText(state.selectedId, 80);
  const focusId = cleanText(state.focusRootId, 80);

  if (selectedId && map.has(selectedId)) {
    insertSiblingBelow(selectedId);
    return;
  }

  if (focusId && map.has(focusId)) {
    insertChildUnder(focusId);
    return;
  }

  const newTopNode = {
    id: makeId("node"),
    parentId: "root",
    label: "",
    source: "manual",
    order: maxSiblingOrder("root") + 1,
    updatedAt: nowIso(),
  };
  lastEditUndoSnapshot = createTreeUndoSnapshot("add");
  lastTreeUndoKind = "edit";
  state.nodes.push(newTopNode);
  beginInlineEdit(newTopNode.id, {
    isNew: true,
    originalLabel: "",
    afterId: "",
    parentId: "root",
  });
  setStatus("Caught. Type, then Enter.", "ok");
}

function renameSelected() {
  if (typeof requirePocketFileForChanges === "function" && !requirePocketFileForChanges()) return;
  if (!state.selectedId) {
    setStatus("Select a node first.", "warn");
    return;
  }
  const map = nodeMap();
  const node = map.get(state.selectedId);
  if (!node) {
    setStatus("Selected node was not found.", "warn");
    return;
  }
  if (state.inlineEdit.id === node.id) {
    focusRowByNodeId(node.id);
    setStatus("Already renaming. Enter saves, Esc cancels.", "ok");
    return;
  }
  beginInlineEdit(node.id, {
    isNew: false,
    originalLabel: node.label || "",
    afterId: "",
    parentId: node.parentId || "root",
  });
  setStatus("Renaming. Enter saves, Esc cancels.", "ok");
}

function deleteSelected() {
  if (typeof requirePocketFileForChanges === "function" && !requirePocketFileForChanges()) return;
  if (!state.selectedId) {
    setStatus("Select a node first.", "warn");
    return;
  }
  deleteNodeById(state.selectedId);
}

// P373 dormant, read-only projection of authenticated P370 knowledge.
// It is never a document model, command target, Open conductor or Save source.
const progressiveMainMountOwners = new WeakMap();

function createProgressiveMainPresentation({ knowledge, mount, isCurrent } = {}) {
  if (!knowledge || typeof knowledge.inspect !== "function"
      || !mount || typeof mount.appendChild !== "function"
      || typeof mount.removeChild !== "function"
      || typeof mount.setAttribute !== "function"
      || typeof mount.ownerDocument?.createElement !== "function"
      || typeof isCurrent !== "function") {
    throw new TypeError("Progressive Main presentation requires knowledge, DOM mount and current-session guard.");
  }
  const first = knowledge.inspect("root");
  if (!first || first.scope !== "incomplete" || first.reached !== true
      || first.id !== "root" || first.node !== null
      || typeof first.acceptedSealRef !== "string" || !first.acceptedSealRef) {
    throw new TypeError("Progressive Main presentation requires a P370 incomplete root.");
  }

  const seal = first.acceptedSealRef;
  const documentOwner = mount.ownerDocument;
  const token = {};
  const mounted = new Map();
  let disposed = false;
  progressiveMainMountOwners.set(mount, token);

  function current() {
    if (disposed || progressiveMainMountOwners.get(mount) !== token) return false;
    try { return isCurrent() === true; } catch (_) { return false; }
  }
  function fail(reason) {
    return Object.freeze({ ok: false, scope: "incomplete", acceptedSealRef: seal, reason });
  }
  function validDescription(value, id) {
    return !!value && value.scope === "incomplete"
      && value.acceptedSealRef === seal && value.reached === true
      && value.id === id
      && (id === "root" ? value.node === null
        : !!value.node && value.node.id === id)
      && ["unresolved", "pending", "ready", "failed"].includes(value.childrenState)
      && (value.childrenState === "ready"
        ? Array.isArray(value.childIds) : value.childIds === null)
      && (value.childrenState !== "failed"
        || (typeof value.failureReason === "string" && value.failureReason.length > 0));
  }
  function read(parentId) {
    let parent;
    try { parent = knowledge.inspect(parentId); } catch (_) { return null; }
    if (!validDescription(parent, parentId)) return null;
    const children = [];
    if (parent.childrenState === "ready") {
      const ids = new Set();
      for (let i = 0; i < parent.childIds.length; i += 1) {
        const id = parent.childIds[i];
        if (typeof id !== "string" || !id || ids.has(id)) return null;
        ids.add(id);
        let child;
        try { child = knowledge.inspect(id); } catch (_) { return null; }
        // Identity/parent agreement is an interface guard, not a second
        // validator of P368's authenticated structural records.
        if (!validDescription(child, id) || child.node.parentId !== parentId
            || child.node.order !== i) return null;
        children.push(child);
      }
    }
    return { parent, children };
  }
  function status(value) {
    switch (value.childrenState) {
      case "unresolved": return "Children not loaded";
      case "pending": return "Loading children…";
      case "failed": return "Could not load children: " + value.failureReason;
      case "ready": return value.childIds.length ? "Children ready" : "No children (validated)";
      default: return "";
    }
  }
  function setStatus(badge, value) {
    if (!badge) return;
    badge.setAttribute("data-children-state", value.childrenState);
    badge.textContent = status(value);
  }
  function createStatusRow(value) {
    const li = documentOwner.createElement("li");
    li.className = "treeEmptyHint";
    const badge = documentOwner.createElement("span");
    badge.className = "emptyStateText";
    setStatus(badge, value);
    li.appendChild(badge);
    return { branch: li, badge };
  }
  function createBranch(value) {
    const li = documentOwner.createElement("li");
    li.className = "treeNode";
    const row = documentOwner.createElement("div");
    row.className = "row";
    row.tabIndex = -1;
    row.setAttribute("data-node-id", value.id);
    row.setAttribute("aria-disabled", "true");
    const label = documentOwner.createElement("div");
    label.className = "label";
    label.textContent = String(value.node.label ?? "");
    const badge = documentOwner.createElement("span");
    badge.className = "detailBadge";
    setStatus(badge, value);
    const group = documentOwner.createElement("ul");
    group.className = "children groupedChildBlock";
    row.appendChild(label);
    row.appendChild(badge);
    li.appendChild(row);
    li.appendChild(group);
    return { branch: li, row, badge, group, state: value.childrenState,
      ids: null };
  }
  // Staging finishes before replacing exactly the owning child list.
  function replaceGroup(group, branches) {
    while (group.firstChild) group.removeChild(group.firstChild);
    for (const branch of branches) group.appendChild(branch);
  }
  function refresh(parentId) {
    if (!current()) return fail("stale-session");
    if (typeof parentId !== "string" || !parentId) return fail("invalid-parent");
    if (parentId !== "root" && !mounted.has(parentId)) return fail("unmounted-parent");
    const reached = read(parentId);
    if (!reached) return fail("incompatible-knowledge");
    const { parent, children } = reached;
    const prior = mounted.get(parentId);
    if (prior?.state === "ready") {
      if (parent.childrenState !== "ready"
          || prior.ids.length !== children.length
          || prior.ids.some((id, i) => id !== children[i].id)) {
        return fail("ready-list-changed");
      }
      return Object.freeze({ ok: true, scope: "incomplete",
        acceptedSealRef: seal, parentId, childrenState: "ready", changed: false });
    }

    let staged = null;
    let placeholder = null;
    try {
      if (parent.childrenState === "ready") {
        staged = children.map(createBranch);
      } else if (parentId === "root" && !prior) {
        placeholder = createStatusRow(parent);
      }
    } catch (_) { return fail("mount-staging-failed"); }
    if (!current()) return fail("stale-session");

    if (parentId === "root" && !prior) {
      mount.setAttribute("data-pocket-scope", "incomplete");
      mount.setAttribute("data-accepted-seal-ref", seal);
      if (staged && staged.length) {
        replaceGroup(mount, staged.map(x => x.branch));
        mounted.set("root", { group: mount, badge: null, state: "ready",
          ids: children.map(x => x.id) });
        for (let i = 0; i < staged.length; i += 1) mounted.set(children[i].id, staged[i]);
      } else {
        const display = placeholder || createStatusRow(parent);
        replaceGroup(mount, [display.branch]);
        mounted.set("root", { group: mount, badge: display.badge,
          state: parent.childrenState, ids: parent.childrenState === "ready" ? [] : null });
      }
    } else if (parent.childrenState === "ready") {
      if (!prior) return fail("unmounted-parent");
      if (parentId === "root" && !staged.length) {
        if (prior.badge) setStatus(prior.badge, parent);
        else {
          const display = createStatusRow(parent);
          replaceGroup(mount, [display.branch]);
          prior.badge = display.badge;
        }
      } else {
        replaceGroup(prior.group, staged.map(x => x.branch));
        if (prior.badge) setStatus(prior.badge, parent);
        for (let i = 0; i < staged.length; i += 1) mounted.set(children[i].id, staged[i]);
      }
      prior.state = "ready";
      prior.ids = children.map(x => x.id);
    } else if (prior && prior.state !== parent.childrenState) {
      setStatus(prior.badge, parent);
      prior.state = parent.childrenState;
    }
    return Object.freeze({ ok: true, scope: "incomplete", acceptedSealRef: seal,
      parentId, childrenState: parent.childrenState, changed: true });
  }
  function dispose() {
    if (disposed) return false;
    disposed = true;
    if (progressiveMainMountOwners.get(mount) === token) progressiveMainMountOwners.delete(mount);
    mounted.clear();
    return true;
  }
  return Object.freeze({ refresh, dispose });
}
