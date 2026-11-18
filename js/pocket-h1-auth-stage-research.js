/* Dormant synthetic research adapter. Installation requires an authenticated Open. */
(function (global) {
  "use strict";
  const SCHEMA = "pocket.h1.auth-stage.research.v1";
  const DB = "pocket.h1.auth-stage.research.v1";
  const encoder = new TextEncoder();
  let session = null, queue = Promise.resolve(), held = false, version = 0, installed = false;
  let currentDraft = null, notice = null, completing = false, insideCommit = false;
  const plain = value => JSON.parse(JSON.stringify(value));
  const reject = () => { throw new Error("h1-authority-unavailable"); };
  const current = proof => proof && session === proof &&
    PocketOwnerSaveBoundary.isOwnerSaveSessionCurrent(proof.owner) && canShowPocketTree();
  const request = result => new Promise((resolve, reject) => {
    result.onsuccess = () => resolve(result.result);
    result.onerror = () => reject(result.error);
  });
  const done = tx => new Promise((resolve, reject) => {
    tx.oncomplete = resolve;
    tx.onabort = tx.onerror = () => reject(tx.error || new Error("h1-stage-aborted"));
  });
  async function openStore() {
    const opening = indexedDB.open(DB, 1);
    opening.onupgradeneeded = () => opening.result.createObjectStore("ledger");
    return request(opening);
  }
  async function remote(route, body) {
    const response = await fetch("/pocket-sync/v1/" + route, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ apiVersion: 1, operationId: crypto.randomUUID(), ...body }),
    });
    if (!response.ok) reject();
    return response.json();
  }
  async function authenticate() {
    const owner = PocketOwnerSaveBoundary.captureOwnerSaveSession();
    if (owner?.ownerKind !== "synced" || !PocketOwnerSaveBoundary.isOwnerSaveSessionCurrent(owner)) reject();
    const pocket = owner.controllerSession.syncedPocketId;
    const account = await remote("account/synced-pocket/read", { ownerContinuity: "pocket.sync.owner-session.v1" });
    const head = (await remote("pockets/head/read", { syncedPocketId: pocket })).head;
    const accepted = owner.controller.getStarlingBootstrapState().head;
    if (account.syncedPocketId !== pocket || !account.ownerContinuity?.accountId ||
        !account.ownerContinuity.sessionTag || head?.sealRef !== accepted?.sealRef ||
        head?.revision !== accepted?.revision || !PocketOwnerSaveBoundary.isOwnerSaveSessionCurrent(owner)) reject();
    await PocketSyncDeviceStore.open();
    const record = await PocketSyncDeviceStore.readPocket(pocket);
    if (!record?.deviceWrappingKey || record.deviceWrappingKey.extractable) reject();
    const binding = [SCHEMA, account.ownerContinuity.accountId, pocket, record.deviceId, record.usage.masterKeyGeneration];
    const bytes = new Uint8Array(await crypto.subtle.digest("SHA-256", encoder.encode(JSON.stringify(binding))));
    const scope = Array.from(bytes, value => value.toString(16).padStart(2, "0")).join("");
    return { owner, pocket, head, record, scope, binding, sessionTag: account.ownerContinuity.sessionTag };
  }
  async function read(proof) {
    if (!current(proof)) reject();
    const db = await openStore();
    try {
      const tx = db.transaction("ledger", "readonly"), completion = done(tx);
      const row = await request(tx.objectStore("ledger").get(proof.scope));
      await completion;
      if (!current(proof)) reject();
      if (!row) return { revision: 0, value: { schema: SCHEMA, binding: proof.binding, draft: null, stages: [] } };
      const value = await PocketSyncCrypto.openContent(row.record, proof.record.deviceWrappingKey, row.context);
      if (!current(proof) || value.schema !== SCHEMA ||
          JSON.stringify(value.binding) !== JSON.stringify(proof.binding)) reject();
      return { revision: row.context.revision, value };
    } finally { db.close(); }
  }
  async function write(change) {
    const proof = session;
    if (!current(proof)) reject();
    const fresh = await authenticate();
    if (fresh.scope !== proof.scope || fresh.sessionTag !== proof.sessionTag ||
        fresh.head.sealRef !== proof.head.sealRef) reject();
    const previous = await read(proof), value = plain(previous.value);
    change(value);
    const record = await PocketSyncDeviceStore.readPocket(proof.pocket);
    await PocketSyncDeviceStore.reservePocketEncryptionUsage(proof.pocket, record.storeRevision, record.usage,
      { masterKeyContentEncryptions: 0, deviceWrappingKeyEncryptions: 1 });
    const context = { syncedPocketId: proof.scope, revision: previous.revision + 1,
      contentType: PocketSyncCrypto.FORMAT.contentType };
    const encrypted = await PocketSyncCrypto.sealContent(value, record.deviceWrappingKey, context);
    if (!current(proof)) reject();
    const db = await openStore();
    try {
      const tx = db.transaction("ledger", "readwrite", { durability: "strict" }), completion = done(tx);
      const store = tx.objectStore("ledger"), lookup = store.get(proof.scope);
      lookup.onsuccess = () => {
        if (!current(proof) || (lookup.result?.context.revision || 0) !== previous.revision) { tx.abort(); return; }
        store.put({ context, record: encrypted }, proof.scope);
      };
      await completion;
    } finally { db.close(); }
    const confirmed = await read(proof);
    if (confirmed.revision !== context.revision || JSON.stringify(confirmed.value) !== JSON.stringify(value)) reject();
    return confirmed.value;
  }
  function clearPendingReview() {
    document.getElementById("h1AuthStageReview")?.remove();
  }
  function showPendingReview(value) {
    clearPendingReview();
    if (!current(session) || !value || !Array.isArray(value.stages) || value.stages.length !== 1) return;
    const stage = value.stages[0], draft = stage?.draft;
    const node = Array.isArray(state?.nodes) ? state.nodes.find(item => item.id === draft?.nodeId) : null;
    const operation = stage?.operation?.operations;
    // Only render text already visible in this verified owner projection. A changed
    // accepted Head or different placement means there is no lawful comparison.
    if (!node || !draft || typeof draft.text !== "string"
        || node.parentId !== draft.parentId
        || (node.label !== draft.original && node.label !== draft.text)
        || stage?.baseHead?.revision !== session.head.revision
        || stage?.baseHead?.sealRef !== session.head.sealRef
        || !Array.isArray(operation) || operation.length !== 1
        || operation[0]?.type !== "payload"
        || operation[0]?.input?.nodeId !== node.id
        || operation[0]?.input?.payload?.label !== draft.text) return;
    const view = document.createElement("section");
    view.id = "h1AuthStageReview";
    view.setAttribute("role", "group");
    view.setAttribute("aria-label", "Pending change, read only");
    const currentTitle = document.createElement("p");
    // Main may already display the still-Pending working title. The only
    // accepted value is the originally verified base stored with this stage.
    currentTitle.textContent = "Current title: " + draft.original;
    const pendingTitle = document.createElement("p");
    pendingTitle.textContent = "Pending title: " + draft.text;
    view.append(currentTitle, pendingTitle);
    document.body.appendChild(view);
  }
  function show(text) {
    if (!current(session)) {
      clearPendingReview();
      notice?.remove(); notice = null;
      return;
    }
    if (!notice) {
      notice = document.createElement("p");
      notice.id = "h1AuthStageStatus";
      notice.setAttribute("role", "status");
      document.body.appendChild(notice);
    }
    notice.textContent = text;
  }
  function enqueue(action) {
    queue = queue.then(action).catch(() => { held = true; show("Writing protection could not be verified. Editing is paused."); });
    return queue;
  }
  function capture(input) {
    if (!current(session) || held || completing || !input.isConnected) return;
    const nodeId = input.getAttribute("data-edit-id"), node = state.nodes.find(node => node.id === nodeId);
    if (!node || state.inlineEdit.isNew) return;
    currentDraft = { id: currentDraft?.nodeId === nodeId ? currentDraft.id : crypto.randomUUID(),
      nodeId, parentId: node.parentId, original: node.label, text: input.value, version: ++version };
    const draft = plain(currentDraft);
    enqueue(async () => { await write(value => { value.draft = draft; }); show("Draft protected on this device. Pending offsite."); });
  }
  async function complete(input) {
    if (!current(session) || held || !currentDraft) reject();
    const draft = plain(currentDraft);
    const edit = state.inlineEdit;
    const node = Array.isArray(state.nodes) ? state.nodes.find(item => item.id === draft.nodeId) : null;
    if (!input.isConnected || edit?.id !== draft.nodeId || edit.isNew
        || input.getAttribute("data-edit-id") !== draft.nodeId
        || input.value !== draft.text || !node || node.parentId !== draft.parentId
        || node.label !== draft.original) reject();
    let result;
    insideCommit = true;
    try {
      result = commitInlineEdit(draft.nodeId, draft.text);
    } finally {
      insideCommit = false;
    }
    const operation = freezePocketStarlingOwnerWorkingSetThrough(getPocketHighestOperationSequence());
    if (!result?.ok || operation.operations?.length !== 1 ||
        operation.operations[0].type !== "payload" || operation.operations[0].input.nodeId !== draft.nodeId ||
        operation.operations[0].input.payload.label !== draft.text) reject();
    await write(value => {
      if (value.draft?.id !== draft.id || value.draft.version !== draft.version || value.stages.length) reject();
      value.stages.push({ id: crypto.randomUUID(), draft, baseHead: session.head,
        sessionTag: session.sessionTag, operation: plain(operation) });
      value.draft = null;
    });
    currentDraft = null;
    held = true;
    show("Pending offsite work needs review.");
    const confirmed = await read(session);
    showPendingReview(confirmed.value);
  }
  async function install() {
    session = null;
    currentDraft = null;
    completing = false;
    clearPendingReview();
    notice?.remove(); notice = null;
    const proof = await authenticate();
    session = proof;
    const restored = await read(proof);
    held = restored.value.stages.length > 0 || !!restored.value.draft;
    if (restored.value.stages.length) {
      show("Pending offsite work needs review.");
      showPendingReview(restored.value);
    } else if (restored.value.draft) {
      show("Protected draft needs review. Not Saved offsite.");
    }
    if (!installed) {
      installed = true;
      // No public staging gate exists in this source. Hold the normal Save entry
      // while the research adapter owns unfinished or Pending work.
      global.exportTree = async () => ({ ok: false, reason: "h1-stage-research-held" });
      document.addEventListener("input", event => {
        if (event.target.matches("input.labelEdit")) capture(event.target);
      }, true);
      document.addEventListener("blur", event => {
        if (event.target.matches("input.labelEdit")) event.stopImmediatePropagation();
      }, true);
      document.addEventListener("keydown", event => {
        if (held && event.key === "F2") { event.preventDefault(); event.stopImmediatePropagation(); }
        if (event.key !== "Enter" || !event.target.matches("input.labelEdit")) return;
        if (event.isComposing || event.keyCode === 229) {
          // Permit the browser/IME default, never the Main semantic Enter handler.
          event.stopImmediatePropagation();
          return;
        }
        event.preventDefault(); event.stopImmediatePropagation();
        if (!held && !completing) {
          capture(event.target);
          completing = true;
          enqueue(() => complete(event.target));
        }
      }, true);
    }
    return { scope: proof.scope, pending: restored.value.stages.length };
  }
  global.PocketH1AuthStageResearch = Object.freeze({
    install,
    // These fail-closed hooks are read by the original Main completion/Save boundaries.
    // Only this dormant research adapter exposes them, and only after installation.
    blocksNativeSave: () => installed,
    blocksUnstagedInline: () => installed && (!current(session) || held || (completing && !insideCommit)),
    async inspect() {
      try {
        const fresh = await authenticate();
        if (!current(session) || fresh.scope !== session.scope ||
            fresh.sessionTag !== session.sessionTag) reject();
        return read(session);
      } catch (error) {
        clearPendingReview();
        notice?.remove(); notice = null;
        throw error;
      }
    },
    flush: () => queue,
  });
})(window);
