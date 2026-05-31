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

let rowActionMenuEl = null;

function closeRowActionMenu() {
  if (rowActionMenuEl instanceof HTMLElement) rowActionMenuEl.remove();
  rowActionMenuEl = null;
}

function openItemDetailsForNode(nodeId) {
  const id = cleanText(nodeId || state.selectedId, 80);
  if (!id) return false;
  state.selectedId = id;
  closeRowActionMenu();
  if (typeof closeRowMiniMenu === "function") closeRowMiniMenu({ restoreFocus: false });
  if (typeof closeCommandPalette === "function") closeCommandPalette({ restoreFocus: false });
  if (typeof window.openPocketPeEditor === "function") return !!window.openPocketPeEditor(id);
  if (window.PocketPeEditor && typeof window.PocketPeEditor.open === "function") return !!window.PocketPeEditor.open(id);
  if (typeof window.openPocketNodeEditor === "function") return !!window.openPocketNodeEditor(id);
  if (typeof window.openPocketEditor === "function") return !!window.openPocketEditor(id);
  return false;
}

function positionRowActionMenu(menu, point) {
  const gap = 6;
  const vw = Math.max(document.documentElement.clientWidth || 0, window.innerWidth || 0);
  const vh = Math.max(document.documentElement.clientHeight || 0, window.innerHeight || 0);
  menu.style.left = "0px";
  menu.style.top = "0px";
  menu.style.visibility = "hidden";
  const rect = menu.getBoundingClientRect();
  const width = Math.min(rect.width || 148, Math.max(118, vw - gap * 2));
  const height = Math.min(rect.height || 170, Math.max(80, vh - gap * 2));
  let left = Number.isFinite(point?.x) ? point.x + 4 : gap;
  let top = Number.isFinite(point?.y) ? point.y + 4 : gap;
  if (left + width > vw - gap) left = vw - width - gap;
  if (top + height > vh - gap) top = vh - height - gap;
  menu.style.left = `${Math.max(gap, Math.round(left))}px`;
  menu.style.top = `${Math.max(gap, Math.round(top))}px`;
  menu.style.visibility = "";
}

function addRowActionButton(menu, label, action) {
  const btn = document.createElement("button");
  btn.className = "rowMiniMenuBtn";
  btn.type = "button";
  btn.setAttribute("role", "menuitem");
  const span = document.createElement("span");
  span.className = "rowMiniMenuLabel";
  span.textContent = label;
  btn.appendChild(span);
  btn.addEventListener("click", (ev) => {
    ev.preventDefault();
    ev.stopPropagation();
    action();
  });
  menu.appendChild(btn);
  return btn;
}

function openRowActionMenu(nodeId, point) {
  const id = cleanText(nodeId, 80);
  const node = id ? nodeMap().get(id) || null : null;
  if (!node) return false;

  closeRowActionMenu();
  if (typeof closeRowMiniMenu === "function") closeRowMiniMenu({ restoreFocus: false });
  if (typeof closeCommandPalette === "function") closeCommandPalette({ restoreFocus: false });
  state.selectedId = id;

  const menu = document.createElement("div");
  menu.className = "rowMiniMenu";
  menu.setAttribute("role", "menu");
  menu.setAttribute("aria-label", "Row actions");

  const title = document.createElement("div");
  title.className = "rowMiniMenuTitle";
  title.textContent = `Actions · ${cleanText(node.label || "Untitled", 80) || "Untitled"}`;
  menu.appendChild(title);

  addRowActionButton(menu, "Edit", () => openItemDetailsForNode(id));
  addRowActionButton(menu, "Add below", () => {
    closeRowActionMenu();
    state.selectedId = id;
    insertSiblingBelow(id);
  });

  const sep = document.createElement("div");
  sep.className = "rowMiniMenuSep";
  sep.setAttribute("role", "separator");
  menu.appendChild(sep);

  addRowActionButton(menu, "Delete", () => {
    closeRowActionMenu();
    state.selectedId = id;
    deleteSelected();
  });

  menu.addEventListener("click", (ev) => ev.stopPropagation());
  menu.addEventListener("pointerdown", (ev) => ev.stopPropagation());
  menu.addEventListener("keydown", (ev) => {
    if (ev.key === "Escape") {
      ev.preventDefault();
      ev.stopPropagation();
      closeRowActionMenu();
      refocusTreeNavigation(id);
    }
  });

  document.body.appendChild(menu);
  rowActionMenuEl = menu;
  positionRowActionMenu(menu, point);
  const first = menu.querySelector(".rowMiniMenuBtn");
  if (first instanceof HTMLElement) first.focus({ preventScroll: true });

  window.setTimeout(() => {
    document.addEventListener("pointerdown", function closeOnOutsidePointer(ev) {
      if (rowActionMenuEl instanceof HTMLElement && rowActionMenuEl.contains(ev.target)) return;
      closeRowActionMenu();
      document.removeEventListener("pointerdown", closeOnOutsidePointer, true);
    }, true);
  }, 0);

  return true;
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
      openRowActionMenu(node.id, { x: ev.clientX, y: ev.clientY });
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
