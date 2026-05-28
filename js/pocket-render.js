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
  const localSafety = readLocalSafetySnapshot();

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
    title.textContent = "Open a pocket file, or start fresh.";
    text.textContent = "Your data stays in this browser unless you save.";
    addAction("open", () => {
      if (el.fileInput instanceof HTMLInputElement) el.fileInput.click();
    }, "Open an existing pocket JSON file");
    if (localSafety) {
      addAction("Restore local copy", () => restoreLocalSafetySnapshot(localSafety), "Restore the browser safety copy on this device");
    }
    addAction("start new", () => addItemsFromPrimaryAction());
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

function renderTree() {
  const query = cleanText(el.search.value, 120).toLowerCase();
  const tokens = query.split(/\s+/).filter(Boolean);
  const filtering = tokens.length > 0;
  const byId = nodeMap();
  const byParent = childrenMap();
  if (state.focusRootId && !byId.has(state.focusRootId)) {
    state.focusRootId = "";
  }
  const focusRoot = state.focusRootId ? byId.get(state.focusRootId) : null;

  function nodeOutlineText(node) {
    const outline = Array.isArray(node?.editor?.outline) ? node.editor.outline : [];
    if (!outline.length) return "";
    return outline.map((block) => String(block?.text || "")).filter(Boolean).join("\n");
  }

  function nodeSearchText(node) {
    return [
      getPath(node.id),
      node.label,
      node.details,
      nodeOutlineText(node),
      node?.task?.notes,
      node?.profile?.keywords?.join?.(" "),
      node?.profile?.entities?.join?.(" "),
      node?.profile?.people?.join?.(" ")
    ].filter(Boolean).join("\n").toLowerCase();
  }

  function matches(node) {
    if (!filtering) return true;
    const haystack = nodeSearchText(node);
    return tokens.every((t) => haystack.includes(t));
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

  function build(node, depth) {
    if (!matches(node) && !hasVisibleDesc(node.id)) return null;
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
    twisty.className = `twisty${hasKids ? "" : " empty"}`;
    twisty.textContent = hasKids ? (isCollapsed ? "▸" : "▾") : "•";
    twisty.addEventListener("click", (ev) => {
      ev.stopPropagation();
      if (!hasKids) return;
      if (state.collapsed.has(node.id)) state.collapsed.delete(node.id);
      else state.collapsed.add(node.id);
      renderTree();
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
        finished = true;
        commitInlineEdit(node.id, value, options);
      };
      const finishCommit = () => finishCommitWith(input.value);
      const finishCancel = () => {
        if (finished) return;
        finished = true;
        cancelInlineEdit(node.id);
      };
      input.addEventListener("click", (ev) => ev.stopPropagation());
      input.addEventListener("dblclick", (ev) => ev.stopPropagation());
      input.addEventListener("paste", (ev) => {
        const pasted = String(ev.clipboardData?.getData("text/plain") || "");
        if (!pasted) return;
        const parsed = parseCaptureSlashPathBatch(pasted);
        const looksLikeBatch = parsed.matched && parsed.ok && pasted.includes("\n");
        if (!looksLikeBatch) return;
        ev.preventDefault();
        finishCommitWith(pasted);
      });
      input.addEventListener("keydown", (ev) => {
        ev.stopPropagation();
        if (ev.key === "Enter") {
          ev.preventDefault();
          finishCommit();
          return;
        }
        if (ev.key === "Tab") {
          ev.preventDefault();
          finishCommitWith(input.value, { postAction: ev.shiftKey ? "outdent" : "indent" });
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

    const detailText = normaliseDetails(node.details, 4000);
    if (detailText) {
      const detailBadge = document.createElement("span");
      detailBadge.className = "detailBadge";
      detailBadge.textContent = "...";
      detailBadge.title = cleanText(detailText.split("\n")[0], 180) || "Has details";
      row.appendChild(detailBadge);
    }

    row.addEventListener("click", () => {
      const copyOnClick = shouldCopyOnSingleClick(node, hasKids);
      state.selectedId = node.id;
      row.focus({ preventScroll: true });
      refreshMeta();
      renderTree();
      focusRowByNodeId(node.id);
      if (copyOnClick) scheduleCopyClick(node.id, node.label);
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
      openDetailsEditorForSelectedNode();
    });
    row.addEventListener("contextmenu", (ev) => {
      if (state.inlineEdit.id === node.id) return;
      ev.preventDefault();
      ev.stopPropagation();
      cancelPendingCopyClick();
      state.selectedId = node.id;
      openRowMiniMenu(node.id, row, { x: ev.clientX, y: ev.clientY });
    });

    li.appendChild(row);

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
  repairVisibleSelectionAfterRender();
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
  if (!state.selectedId) {
    setStatus("Select a node first.", "warn");
    return;
  }
  deleteNodeById(state.selectedId, { confirm: false });
}
