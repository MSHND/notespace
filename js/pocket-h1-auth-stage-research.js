/* Dormant synthetic research adapter. Installation requires an authenticated Open. */
(function (global) {
  "use strict";
  const SCHEMA = "pocket.h1.auth-stage.research.v1";
  const DB = "pocket.h1.auth-stage.research.v1";
  const encoder = new TextEncoder();
  let session = null, queue = Promise.resolve(), held = false, version = 0, installed = false;
  let currentDraft = null, notice = null, completing = false, insideCommit = false;
  let nativeSave = null, saveToken = null, saving = false;
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
  function concealWhenOwnerIsNotCurrent() {
    if (!installed || current(session)) return false;
    // This only observes *locally detectable* owner/session loss. A server-side
    // rights change is separately tested at the explicit authenticated recheck.
    held = true;
    clearPendingReview();
    notice?.remove(); notice = null;
    return true;
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
    if (concealWhenOwnerIsNotCurrent() || !current(session) || held || completing || !input.isConnected) return;
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

  // P389: called from the REAL native durable publication coordinator,
  // after its encrypted candidate seal is prepared but before any CAS request.
  // It binds the immutable stage ID + native operation ID + encrypted candidate
  // in the scoped, nonextractable-key IndexedDB ledger, not in a second Canon.
  async function beforeNativeHeadAttempt(candidate) {
    if (!installed || !saving || !current(session) || !candidate
        || typeof candidate.operationId !== "string" || !candidate.operationId
        || typeof candidate.candidateSealStorageRef !== "string"
        || !candidate.candidateSealStorageRef
        || candidate.syncedPocketId !== session.pocket) return false;
    try {
      const proof = session, previously = await read(proof);
      const stage = previously.value.stages?.[0], draft = stage?.draft;
      const attempt = stage?.attempt;
      const node = state.nodes?.find(item => item.id === draft?.nodeId);
      const change = stage?.operation?.operations?.[0];
      const seq = getPocketHighestOperationSequence();
      const working = freezePocketStarlingOwnerWorkingSetThrough(seq);
      if (previously.value.stages.length !== 1 || previously.value.draft
          || !stage?.id || attempt?.kind !== "possibly-sent"
          || attempt.stageId !== stage.id || attempt.nativeRequest
          || attempt.ceiling !== stage.operation.ceiling
          || candidate.expectedHead?.revision !== stage.baseHead?.revision
          || candidate.expectedHead?.sealRef !== stage.baseHead?.sealRef
          || node?.parentId !== draft?.parentId || node?.label !== draft?.text
          || change?.type !== "payload" || change.input?.nodeId !== node?.id
          || change.input?.payload?.label !== draft?.text
          || stage.operation?.ceiling !== seq
          || JSON.stringify(working?.operations) !== JSON.stringify(stage.operation.operations)) return false;
      const request = { operationId: candidate.operationId,
        syncedPocketId: session.pocket, expectedHead: plain(candidate.expectedHead),
        candidateSealStorageRef: candidate.candidateSealStorageRef, stageId: stage.id };
      await write(ledger => {
        if (ledger.stages?.length !== 1 || ledger.stages[0]?.id !== stage.id
            || ledger.stages[0]?.attempt?.nativeRequest) reject();
        ledger.stages[0].attempt.nativeRequest = request;
      });
      const confirmed = await read(proof);
      return confirmed.value.stages?.[0]?.attempt?.nativeRequest?.operationId === request.operationId
        && confirmed.value.stages[0].attempt.nativeRequest.candidateSealStorageRef === request.candidateSealStorageRef;
    } catch (_error) { return false; }
  }

  // Only a freshly authorised Connected Open may invoke this. In this bounded
  // H2→H3 witness, a Head at the EXACT native candidate seal plus the
  // verified stage's original operation/context is sufficient; any later or
  // different Head is UNKNOWN and left held, not guessed equivalent.
  async function reconcileLostAck() {
    if (!installed || saving || !held || !current(session)) reject();
    const proof = session, confirmed = await global.PocketH1AuthStageResearch.inspect();
    const stage = confirmed.value.stages?.[0], request = stage?.attempt?.nativeRequest;
    const draft = stage?.draft, change = stage?.operation?.operations?.[0];
    const visible = state.nodes?.find(item => item.id === draft?.nodeId);
    if (confirmed.value.stages.length !== 1 || confirmed.value.draft || !stage?.id
        || stage.attempt?.kind !== "possibly-sent"
        || !request || request.stageId !== stage.id
        || request.syncedPocketId !== proof.pocket
        || !request.operationId || !request.candidateSealStorageRef
        || request.expectedHead?.sealRef !== stage.baseHead?.sealRef
        || request.expectedHead?.revision !== stage.baseHead?.revision
        || !draft || change?.type !== "payload" || stage.operation?.operations.length !== 1
        || change.input?.nodeId !== draft.nodeId
        || change.input?.payload?.label !== draft.text) reject();
    const head = proof.head;
    // A verified current Head number alone cannot settle historical Pending.
    // Exact H3 must have the native candidate Seal and the authorised visible
    // title. A later H4+ requires the native encrypted Seal-chain proof that
    // this exact pre-CAS candidate is an ancestor of the current accepted Head.
    const direct = head?.revision === request.expectedHead.revision + 1
      && head?.sealRef === request.candidateSealStorageRef
      && visible?.id === draft.nodeId && visible?.parentId === draft.parentId
      && visible?.label === draft.text;
    let superseded = false;
    if (!direct && head?.revision > request.expectedHead.revision + 1
        && visible?.id === draft.nodeId && visible?.parentId === draft.parentId
        && typeof proof.owner?.controller?.reconcileResearchNativeCandidate === "function") {
      let lineage = null;
      try {
        lineage = await proof.owner.controller.reconcileResearchNativeCandidate({
          syncedPocketId: proof.pocket,
          expectedHead: plain(request.expectedHead),
          candidateSealStorageRef: request.candidateSealStorageRef,
        });
      } catch (_error) {}
      superseded = current(proof) && lineage?.outcome === "committed-and-superseded"
        && lineage.examined === head.revision - request.expectedHead.revision;
    }
    if (!direct && !superseded) {
      held = true;
      clearPendingReview();
      show("Save outcome unconfirmed. Editing is paused.");
      return { ok: false, reason: "exact-operation-unconfirmed", stageId: stage.id };
    }
    const candidateHead = { schema: request.expectedHead.schema,
      revision: request.expectedHead.revision + 1,
      sealRef: request.candidateSealStorageRef };
    // The accepted receipt records the original H3, not the newer visible
    // H4+ when a later unrelated legitimate change superseded that Head.
    const receipt = { stageId: stage.id, nativeOperationId: request.operationId,
      candidateSealStorageRef: request.candidateSealStorageRef,
      nodeId: draft.nodeId, baseHead: plain(stage.baseHead),
      acceptedHead: candidateHead, currentHeadAtReconcile: plain(head),
      operation: plain(stage.operation) };
    try {
      await write(ledger => {
        if (ledger.stages?.length !== 1 || ledger.stages[0]?.id !== stage.id
            || ledger.stages[0]?.attempt?.nativeRequest?.operationId !== request.operationId
            || ledger.stages[0]?.attempt.nativeRequest.candidateSealStorageRef !== candidateHead.sealRef) reject();
        ledger.acceptedReceipts = [...(ledger.acceptedReceipts || []), receipt];
        ledger.stages = [];
        ledger.draft = null;
      });
      const readback = await read(proof);
      if (readback.value.stages?.length !== 0
          || readback.value.acceptedReceipts?.at(-1)?.stageId !== stage.id
          || readback.value.acceptedReceipts.at(-1).nativeOperationId !== request.operationId
          || readback.value.acceptedReceipts.at(-1).acceptedHead.sealRef !== candidateHead.sealRef) reject();
    } catch (_error) {
      held = true;
      show("Accepted offsite; local receipt settlement needs review.");
      return { ok: false, reason: "local-receipt-unsettled", stageId: stage.id };
    }
    held = false;
    clearPendingReview();
    show(superseded ? "Saved. Later changes are also present." : "Saved.");
    return { ok: true, reason: "verified-lost-ack-recovered", stageId: stage.id,
      nativeOperationId: request.operationId, acceptedHead: candidateHead,
      superseded, currentHead: head };
  }

  // P388: One authenticated, source-integrated, synthetic research admission.
  // Never send directly to the Head endpoint. Native exportTree and its owner
  // Starling/CAS gate remain the sole authority for offsite acceptance.
  async function acceptPending() {
    if (!installed || saving || !held || !current(session) || !nativeSave) reject();
    saving = true;
    try {
      await queue;
      const proof = session;
      const checked = await global.PocketH1AuthStageResearch.inspect();
      const value = checked.value;
      if (value.draft || value.stages?.length !== 1) reject();
      const stage = value.stages[0], draft = stage?.draft;
      const operation = stage?.operation, change = operation?.operations?.[0];
      const node = state.nodes?.find(item => item.id === draft?.nodeId);
      const seq = getPocketHighestOperationSequence();
      const currentWorkingSet = freezePocketStarlingOwnerWorkingSetThrough(seq);
      if (!stage?.id || stage.attempt || !draft || !operation
          || stage.baseHead?.revision !== proof.head.revision
          || stage.baseHead?.sealRef !== proof.head.sealRef
          || node?.parentId !== draft.parentId || node?.label !== draft.text
          || change?.type !== "payload" || operation.operations.length !== 1
          || change.input?.nodeId !== node.id
          || change.input?.payload?.label !== draft.text
          || operation.ceiling !== seq
          || JSON.stringify(currentWorkingSet?.operations) !== JSON.stringify(operation.operations)
          || !hasPocketUnsavedChanges()) reject();
      // Mark one exact operation as possibly sent BEFORE any network mutation.
      // This is a durable no-blind-retry fence even if the reply is lost.
      await write(ledger => {
        if (ledger.stages?.length !== 1 || ledger.stages[0]?.id !== stage.id
            || ledger.stages[0].attempt || ledger.draft) reject();
        ledger.stages[0].attempt = { kind: "possibly-sent", stageId: stage.id,
          baseRevision: stage.baseHead.revision, ceiling: operation.ceiling };
      });
      const reserved = await read(proof);
      if (reserved.value.stages?.[0]?.attempt?.stageId !== stage.id) reject();
      saveToken = crypto.randomUUID();
      let result = null;
      try {
        result = await nativeSave({
          returnDetails: true, downloadFallback: false, h1ResearchSaveToken: saveToken,
        });
      } catch (_error) {}
      // The native gate consumes this token at the only admitted Save boundary.
      const consumed = saveToken === null;
      saveToken = null;
      if (!consumed || result?.ok !== true || result.reason !== "synced-save") {
        held = true;
        show("Save outcome unconfirmed. Editing is paused.");
        return { ok: false, reason: "outcome-unconfirmed", stageId: stage.id };
      }
      let fresh;
      try { fresh = await authenticate(); } catch (_error) {}
      if (!fresh || !current(proof) || fresh.scope !== proof.scope
          || fresh.sessionTag !== proof.sessionTag
          || fresh.head?.revision !== proof.head.revision + 1
          || fresh.head?.sealRef === proof.head.sealRef) {
        held = true;
        show("Save outcome unconfirmed. Editing is paused.");
        return { ok: false, reason: "acceptance-not-independently-verified", stageId: stage.id };
      }
      // Preserve exact stage-to-Head receipt evidence, while removing the
      // Pending stage only AFTER native acceptance and fresh Head verification.
      session = fresh;
      const accepted = { stageId: stage.id, nodeId: draft.nodeId, baseHead: stage.baseHead,
        acceptedHead: fresh.head, operation: plain(operation) };
      try {
        await write(ledger => {
          if (ledger.stages?.length !== 1 || ledger.stages[0]?.id !== stage.id
              || ledger.stages[0]?.attempt?.stageId !== stage.id) reject();
          ledger.acceptedReceipts = [...(ledger.acceptedReceipts || []), accepted];
          ledger.stages = [];
          ledger.draft = null;
        });
        const settled = await read(session);
        if (settled.value.stages?.length !== 0
            || settled.value.acceptedReceipts?.at(-1)?.stageId !== stage.id
            || settled.value.acceptedReceipts.at(-1).acceptedHead.sealRef !== fresh.head.sealRef) reject();
      } catch (_error) {
        held = true;
        show("Accepted offsite; local receipt settlement needs review.");
        return { ok: false, reason: "local-receipt-unsettled", stageId: stage.id,
          acceptedHead: fresh.head };
      }
      held = false;
      clearPendingReview();
      show("Saved.");
      return { ok: true, reason: "verified-saved", stageId: stage.id,
        acceptedHead: fresh.head };
    } finally {
      saving = false;
      saveToken = null;
    }
  }

  async function install(options = {}) {
    session = null;
    currentDraft = null;
    completing = false;
    saving = false;
    saveToken = null;
    clearPendingReview();
    notice?.remove(); notice = null;
    const proof = await authenticate();
    session = proof;
    const restored = await read(proof);
    held = restored.value.stages.length > 0 || !!restored.value.draft;
    if (restored.value.stages.length) {
      show(restored.value.stages.some(stage => stage.attempt)
        ? "Save outcome unconfirmed. Editing is paused."
        : "Pending offsite work needs review.");
      showPendingReview(restored.value);
    } else if (restored.value.draft) {
      show("Protected draft needs review. Not Saved offsite.");
    }
    if (!installed) {
      installed = true;
      // Keep the actual native Save function privately for ONE opaque P388
      // admission; the ordinary UI remains held throughout research.
      nativeSave = global.exportTree;
      global.exportTree = async () => ({ ok: false, reason: "h1-stage-research-held" });
      document.addEventListener("input", event => {
        if (event.target.matches("input.labelEdit")) capture(event.target);
      }, true);
      document.addEventListener("blur", event => {
        if (event.target.matches("input.labelEdit")) event.stopImmediatePropagation();
      }, true);
      document.addEventListener("keydown", event => {
        concealWhenOwnerIsNotCurrent();
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
    // Research Open integration: deliberately opt-in so historical P385-P389
    // frozen witnesses retain their prior explicit-reconcile behaviour.
    // Automatic means invoked *inside* authenticated install, never an
    // unauthorised offline retry, extra CAS or arbitrary background work.
    if (options.autoReconcileOnOpen === true && restored.value.stages.length === 1
        && restored.value.stages[0]?.attempt?.nativeRequest && current(proof)) {
      try {
        const outcome = await reconcileLostAck();
        return { scope: proof.scope, pending: outcome.ok ? 0 : 1,
          autoReconciliation: outcome };
      } catch (_error) {
        held = true;
        clearPendingReview();
        show("Save outcome unconfirmed. Editing is paused.");
        return { scope: proof.scope, pending: 1,
          autoReconciliation: { ok: false, reason: "unconfirmed" } };
      }
    }
    return { scope: proof.scope, pending: restored.value.stages.length };
  }
  global.PocketH1AuthStageResearch = Object.freeze({
    install,
    // These fail-closed hooks are read by the original Main completion/Save boundaries.
    // Only this dormant research adapter exposes them, and only after installation.
    blocksNativeSave: (options = {}) => {
      concealWhenOwnerIsNotCurrent();
      if (!installed) return false;
      // A one-use, private token admits ONLY the internally initiated native
      // exportTree call. Unrelated Save routes always remain blocked.
      if (saving && saveToken && options.h1ResearchSaveToken === saveToken
          && current(session)) {
        saveToken = null;
        return false;
      }
      return true;
    },
    blocksUnstagedInline: () => {
      concealWhenOwnerIsNotCurrent();
      return installed && (!current(session) || held || (completing && !insideCommit));
    },
    async inspect() {
      try {
        const fresh = await authenticate();
        if (!current(session) || fresh.scope !== session.scope ||
            fresh.sessionTag !== session.sessionTag) reject();
        return read(session);
      } catch (error) {
        // A failed fresh authority check cannot leave a protected comparison on
        // screen, or allow further completion from this stale research session.
        held = true;
        clearPendingReview();
        notice?.remove(); notice = null;
        throw error;
      }
    },
    acceptPending,
    beforeNativeHeadAttempt,
    reconcileLostAck,
    flush: () => queue,
  });
})(window);
