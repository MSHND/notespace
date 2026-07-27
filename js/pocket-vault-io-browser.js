/* Canonical browser ownership and IO for editable encrypted Pocket Vaults. */

(function initialisePocketVaultBrowserIo(global) {
  "use strict";

  let candidateSequence = 0;
  let activeCandidate = null;
  let activeDialog = null;
  let preparedAdoptionSequence = 0;
  let preparedAdoptionLease = null;
  let dialogSequence = 0;
  let dialogBound = false;
  let dialogInertRecords = [];
  let dialogReturnFocus = null;

  function dom(id) {
    return document.getElementById(id);
  }

  function say(message, tone = "ok", durationMs = 5200) {
    if (typeof global.setStatus === "function") {
      global.setStatus(message, tone, { durationMs });
    }
  }

  function clean(value, max = 120) {
    return typeof global.cleanText === "function"
      ? global.cleanText(value, max)
      : String(value || "").trim().slice(0, max);
  }

  function isAbort(error) {
    return !!error && (error.name === "AbortError" || /abort/i.test(String(error.message || "")));
  }

  function currentSaveSession() {
    return typeof global.capturePocketFileSaveSession === "function"
      ? global.capturePocketFileSaveSession()
      : null;
  }

  function sourceSessionIsCurrent(session) {
    return typeof global.isPocketFileSaveSessionCurrent === "function"
      && global.isPocketFileSaveSessionCurrent(session);
  }

  function hasUnsavedChanges() {
    return typeof global.hasUnsavedPocketLiteChanges === "function"
      ? global.hasUnsavedPocketLiteChanges()
      : Number(global.getPocketUnsavedOperationCount?.() || 0) > 0;
  }

  function isDialogOpen() {
    return !!activeDialog && !dom("vaultDialogOverlay")?.hidden;
  }

  function ownerActionPending() {
    return !!activeCandidate || isDialogOpen() || !!preparedAdoptionLease;
  }

  function acquirePreparedDocumentAdoption() {
    if (preparedAdoptionLease) return null;
    preparedAdoptionSequence += 1;
    preparedAdoptionLease = Object.freeze({
      kind: "pocket.preparedDocumentAdoption.v1",
      id: preparedAdoptionSequence,
    });
    return preparedAdoptionLease;
  }

  function finishPreparedDocumentAdoption(lease) {
    if (!lease || lease !== preparedAdoptionLease) return false;
    preparedAdoptionLease = null;
    return true;
  }

  function setDialogBackgroundInert(enabled) {
    const overlay = dom("vaultDialogOverlay");
    if (!(overlay instanceof HTMLElement) || !overlay.parentElement) return;
    if (enabled) {
      if (dialogInertRecords.length > 0) return;
      dialogInertRecords = Array.from(overlay.parentElement.children || [])
        .filter((element) => element !== overlay)
        .map((element) => {
          const previous = element.inert === true;
          element.inert = true;
          return { element, previous };
        });
      return;
    }
    for (const record of dialogInertRecords) {
      if (record?.element) record.element.inert = record.previous;
    }
    dialogInertRecords = [];
  }

  function visibleDialogControls() {
    const overlay = dom("vaultDialogOverlay");
    if (!(overlay instanceof HTMLElement) || typeof overlay.querySelectorAll !== "function") return [];
    return Array.from(overlay.querySelectorAll("input:not([disabled]), button:not([disabled])"))
      .filter((element) => element instanceof HTMLElement
        && !element.hidden
        && !element.closest("[hidden]"));
  }

  function focusDialogInitial() {
    if (!activeDialog) return;
    const id = activeDialog.initialFocusId;
    const target = id ? dom(id) : visibleDialogControls()[0];
    target?.focus?.({ preventScroll: true });
  }

  function setDialogError(message = "") {
    const error = dom("vaultDialogError");
    if (error) error.textContent = clean(message, 500);
  }

  function setDialogBusy(busy) {
    if (!activeDialog) return;
    activeDialog.busy = busy === true;
    for (const id of [
      "vaultCredentialSubmit",
      "vaultCredentialCancel",
      "vaultExportConfirm",
      "vaultExportCancel",
      "vaultSwitchSave",
      "vaultSwitchDiscard",
      "vaultSwitchCancel"
    ]) {
      const control = dom(id);
      if (control && !control.closest("[hidden]")) control.disabled = activeDialog.busy;
    }
  }

  function resetDialogSections() {
    for (const id of ["vaultCredentialForm", "vaultExportActions", "vaultSwitchActions"]) {
      const section = dom(id);
      if (section) section.hidden = true;
    }
    const confirmGroup = dom("vaultPasswordConfirmGroup");
    const confirm = dom("vaultPasswordConfirm");
    if (confirmGroup) confirmGroup.hidden = true;
    if (confirm) confirm.disabled = true;
    const password = dom("vaultPassword");
    if (password) password.value = "";
    if (confirm) confirm.value = "";
    setDialogError("");
  }

  function showDialogShell(config) {
    const overlay = dom("vaultDialogOverlay");
    if (!(overlay instanceof HTMLElement) || activeDialog) return false;
    dialogReturnFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    activeDialog = {
      token: `vault_dialog_${++dialogSequence}`,
      mode: config.mode,
      busy: false,
      initialFocusId: config.initialFocusId || "",
      resolve: config.resolve,
      submit: config.submit,
      cancel: config.cancel,
      sourceSession: config.sourceSession || null,
      canContinue: typeof config.canContinue === "function" ? config.canContinue : null,
      inlineDraft: config.inlineDraft || null,
    };
    resetDialogSections();
    const title = dom("vaultDialogTitle");
    const body = dom("vaultDialogBody");
    if (title) title.textContent = config.title || "";
    if (body) body.textContent = config.body || "";
    overlay.hidden = false;
    document.body?.classList?.add("vaultDialogOpen");
    setDialogBackgroundInert(true);
    requestAnimationFrame(focusDialogInitial);
    return true;
  }

  function closeDialog(result, options = {}) {
    const record = activeDialog;
    if (!record) return false;
    activeDialog = null;
    resetDialogSections();
    const overlay = dom("vaultDialogOverlay");
    if (overlay) overlay.hidden = true;
    document.body?.classList?.remove("vaultDialogOpen");
    setDialogBackgroundInert(false);
    const returnFocus = dialogReturnFocus;
    dialogReturnFocus = null;
    if (options.restoreFocus !== false) {
      if (typeof global.refocusTreeNavigation === "function" && global.canShowPocketTree?.()) {
        global.refocusTreeNavigation(state.selectedId || "");
      } else {
        returnFocus?.focus?.({ preventScroll: true });
      }
    }
    record.resolve?.(result);
    return true;
  }

  function cancelDialog() {
    const record = activeDialog;
    if (!record || record.busy) return false;
    record.cancel?.();
    return closeDialog(false);
  }

  function showCredentialDialog(config) {
    return new Promise((resolve) => {
      const createMode = config.mode === "create";
      if (!showDialogShell({
        mode: config.mode,
        title: createMode ? "Create encrypted Vault" : "Unlock encrypted Vault",
        body: config.body || "",
        initialFocusId: "vaultPassword",
        resolve,
        submit: config.submit,
        cancel: config.cancel,
        sourceSession: config.sourceSession,
      })) {
        resolve(false);
        return;
      }
      const form = dom("vaultCredentialForm");
      const confirmGroup = dom("vaultPasswordConfirmGroup");
      const confirm = dom("vaultPasswordConfirm");
      const submit = dom("vaultCredentialSubmit");
      if (form) form.hidden = false;
      if (confirmGroup) confirmGroup.hidden = !createMode;
      if (confirm) confirm.disabled = !createMode;
      if (submit) submit.textContent = createMode ? "Create Vault" : "Unlock";
    });
  }

  function showExportConfirmation() {
    return new Promise((resolve) => {
      if (!showDialogShell({
        mode: "export",
        title: "Export an unencrypted copy?",
        body: "This creates a readable JSON file. Your encrypted Vault will remain active, and future Save will continue writing only to the Vault.",
        initialFocusId: "vaultExportConfirm",
        resolve,
      })) {
        resolve(false);
        return;
      }
      const actions = dom("vaultExportActions");
      if (actions) actions.hidden = false;
    });
  }

  function showOwnerSwitchDialog(candidateInfo = {}) {
    return new Promise((resolve) => {
      const sourceSession = currentSaveSession();
      const inlineDraft = typeof global.captureActiveInlineEditForOwnerSwitch === "function"
        ? global.captureActiveInlineEditForOwnerSwitch()
        : { ok: !global.hasUnsavedInlineTitleDraft?.(), active: false };
      if (!showDialogShell({
        mode: "switch",
        title: "Save changes to this Vault?",
        body: "Vault changes are not stored in browser recovery. Save them before opening another file, or discard them.",
        initialFocusId: "vaultSwitchSave",
        resolve,
        sourceSession,
        canContinue: candidateInfo.canContinue,
        inlineDraft,
      })) {
        resolve(false);
        return;
      }
      const actions = dom("vaultSwitchActions");
      if (actions) actions.hidden = false;
    });
  }

  function dialogCandidateIsCurrent(record) {
    if (typeof record?.canContinue !== "function") return true;
    try {
      return record.canContinue() !== false;
    } catch (_error) {
      return false;
    }
  }

  function allowsDialogSave(token, saveSession) {
    return !!activeDialog
      && activeDialog.mode === "switch"
      && activeDialog.token === token
      && activeDialog.busy === true
      && sourceSessionIsCurrent(activeDialog.sourceSession)
      && sourceSessionIsCurrent(saveSession)
      && saveSession.ownerKind === "vault"
      && saveSession.vaultSessionId === activeDialog.sourceSession.vaultSessionId
      && dialogCandidateIsCurrent(activeDialog);
  }

  async function submitCredentialDialog(event) {
    event?.preventDefault?.();
    const record = activeDialog;
    if (!record || !["unlock", "create"].includes(record.mode) || record.busy) return false;
    const passwordInput = dom("vaultPassword");
    const confirmInput = dom("vaultPasswordConfirm");
    let password = String(passwordInput?.value || "");
    let confirmation = String(confirmInput?.value || "");
    const forgetCredentials = () => {
      password = "";
      confirmation = "";
      if (passwordInput) passwordInput.value = "";
      if (confirmInput) confirmInput.value = "";
    };
    if (password.length < 8) {
      setDialogError("Use at least 8 characters.");
      forgetCredentials();
      passwordInput?.focus?.({ preventScroll: true });
      return false;
    }
    if (record.mode === "create" && password !== confirmation) {
      setDialogError("The passwords do not match.");
      forgetCredentials();
      confirmInput?.focus?.({ preventScroll: true });
      return false;
    }
    setDialogError("");
    setDialogBusy(true);
    let result;
    try {
      const submission = record.submit?.(password, forgetCredentials);
      result = await submission;
    } catch (_error) {
      result = { ok: false, message: "Pocket could not complete that encrypted Vault action." };
    } finally {
      forgetCredentials();
    }
    if (record !== activeDialog) return false;
    if (!result || result.ok !== true) {
      setDialogBusy(false);
      setDialogError(result?.message || "Pocket could not complete that encrypted Vault action.");
      passwordInput?.focus?.({ preventScroll: true });
      return false;
    }
    closeDialog(result, { restoreFocus: false });
    return true;
  }

  async function saveBeforeOwnerSwitch() {
    const record = activeDialog;
    if (!record || record.mode !== "switch" || record.busy) return false;
    setDialogBusy(true);
    setDialogError("");
    const saveContextIsCurrent = () => (
      record === activeDialog
      && allowsDialogSave(record.token, record.sourceSession)
    );
    const focusInlineDraft = (draft) => {
      requestAnimationFrame(() => {
        const current = global.inspectActiveInlineTitleDraft?.();
        const input = current?.input || draft?.input || null;
        input?.focus?.({ preventScroll: true });
      });
    };
    const cancelForInlineDraft = (draft) => {
      if (record === activeDialog) {
        setDialogBusy(false);
        closeDialog(false, { restoreFocus: false });
      }
      say(
        "Finish or cancel the current rename before switching files. Nothing was saved or changed.",
        "warn",
        7200
      );
      focusInlineDraft(draft);
      return false;
    };
    const cancelStaleSwitch = (draft) => {
      if (record === activeDialog) {
        setDialogBusy(false);
        closeDialog(false, { restoreFocus: false });
      }
      say("That file switch is no longer current. Your Vault changes remain open and were not saved.", "warn", 7200);
      focusInlineDraft(draft);
      return false;
    };
    if (!saveContextIsCurrent()) return cancelStaleSwitch();
    const inlineDraft = record.inlineDraft
      || (typeof global.captureActiveInlineEditForOwnerSwitch === "function"
        ? global.captureActiveInlineEditForOwnerSwitch()
        : { ok: !global.hasUnsavedInlineTitleDraft?.(), active: false });
    if (!inlineDraft?.ok) return cancelForInlineDraft(inlineDraft);
    if (typeof global.isDetailsEditorOpen === "function"
        && global.isDetailsEditorOpen()) {
      global.saveDetailsEditor?.();
      if (!saveContextIsCurrent()) return cancelStaleSwitch(inlineDraft);
      if (global.isDetailsEditorOpen()
          || global.hasUnsavedDetailsEditorChanges?.()) {
        setDialogBusy(false);
        setDialogError("Finish the open item edit before switching encrypted Vaults.");
        dom("vaultSwitchSave")?.focus?.({ preventScroll: true });
        return false;
      }
    }
    if (!saveContextIsCurrent()) return cancelStaleSwitch(inlineDraft);
    if (inlineDraft.active) {
      if (typeof global.commitActiveInlineEditForOwnerSwitch !== "function") {
        return cancelForInlineDraft(inlineDraft);
      }
      const committed = global.commitActiveInlineEditForOwnerSwitch(inlineDraft, {
        vaultDialogToken: record.token,
        sourceSession: record.sourceSession,
        isCurrent: saveContextIsCurrent,
      });
      if (!committed?.ok) return cancelForInlineDraft(committed || inlineDraft);
    }
    if (global.hasUnsavedDetailsEditorChanges?.()
        || global.hasUnsavedInlineTitleDraft?.()) {
      return cancelForInlineDraft(inlineDraft);
    }
    if (!saveContextIsCurrent()) return cancelStaleSwitch(inlineDraft);
    const result = await global.exportTree?.({
      returnDetails: true,
      downloadFallback: false,
      vaultDialogToken: record.token,
    });
    if (record !== activeDialog) return false;
    if (!saveContextIsCurrent()) return cancelStaleSwitch(inlineDraft);
    if (!result || result.ok !== true) {
      setDialogBusy(false);
      setDialogError("Pocket could not save the encrypted Vault. It remains open with your changes.");
      dom("vaultSwitchSave")?.focus?.({ preventScroll: true });
      return false;
    }
    closeDialog("save", { restoreFocus: false });
    return true;
  }

  function bindDialogUi() {
    if (dialogBound) return true;
    dialogBound = true;
    dom("vaultCredentialForm")?.addEventListener("submit", submitCredentialDialog);
    dom("vaultCredentialCancel")?.addEventListener("click", cancelDialog);
    dom("vaultExportConfirm")?.addEventListener("click", () => closeDialog(true, { restoreFocus: false }));
    dom("vaultExportCancel")?.addEventListener("click", cancelDialog);
    dom("vaultSwitchSave")?.addEventListener("click", () => { void saveBeforeOwnerSwitch(); });
    dom("vaultSwitchDiscard")?.addEventListener("click", () => closeDialog("discard", { restoreFocus: false }));
    dom("vaultSwitchCancel")?.addEventListener("click", cancelDialog);
    global.addEventListener?.("keydown", (event) => {
      if (!isDialogOpen()) return;
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopImmediatePropagation?.();
        cancelDialog();
        return;
      }
      if (event.key !== "Tab") return;
      const controls = visibleDialogControls();
      if (!controls.length) {
        event.preventDefault();
        return;
      }
      const index = controls.indexOf(document.activeElement);
      const next = event.shiftKey
        ? (index <= 0 ? controls.length - 1 : index - 1)
        : (index < 0 || index >= controls.length - 1 ? 0 : index + 1);
      event.preventDefault();
      event.stopImmediatePropagation?.();
      controls[next].focus();
    }, true);
    document.addEventListener("focusin", (event) => {
      if (!isDialogOpen() || dom("vaultDialogOverlay")?.contains(event.target)) return;
      focusDialogInitial();
    }, true);
    return true;
  }

  function newCandidate(kind, handle, sourceSession) {
    const record = {
      token: ++candidateSequence,
      kind,
      handle,
      sourceSession,
      cancelled: false,
    };
    activeCandidate = record;
    return record;
  }

  function candidateIsCurrent(candidate) {
    return !!candidate
      && activeCandidate === candidate
      && candidate.cancelled !== true
      && sourceSessionIsCurrent(candidate.sourceSession);
  }

  function clearCandidate(candidate) {
    if (!candidate || activeCandidate !== candidate) return false;
    candidate.cancelled = true;
    activeCandidate = null;
    return true;
  }

  async function compareHandles(left, right) {
    if (typeof global.comparePocketFileHandles !== "function") {
      return { verified: !left || !right, same: left === right && !!left };
    }
    return global.comparePocketFileHandles(left, right);
  }

  async function requireDistinctDestination(handle, activeHandle, message) {
    const relationship = await compareHandles(handle, activeHandle);
    if (relationship.verified && !relationship.same) return true;
    say(
      relationship.same
        ? message
        : "Pocket could not verify that destination is a different file. Choose another file.",
      "warn",
      7200
    );
    return false;
  }

  function vaultPickerOptions(mode = "open") {
    const common = {
      types: [{
        description: "Pocket encrypted Vault",
        accept: { "application/json": [".json", ".vault"] },
      }],
    };
    return mode === "open"
      ? { ...common, multiple: false }
      : { ...common, suggestedName: "pocket.vault.json" };
  }

  function jsonExportPickerOptions() {
    return {
      types: [{ description: "Readable Pocket JSON copy", accept: { "application/json": [".json"] } }],
      suggestedName: "pocket-data-unencrypted.json",
    };
  }

  function validateDecryptedPayload(payload) {
    if (typeof global.isPocketPayloadShape !== "function" || !global.isPocketPayloadShape(payload)) {
      return { ok: false, message: "This Vault does not contain a supported Pocket document." };
    }
    const validator = global.PocketDeviceChanges;
    if (!validator || typeof validator.validateStructure !== "function") {
      return { ok: false, message: "Pocket could not safely validate the decrypted document." };
    }
    const structure = validator.validateStructure(payload);
    if (!structure.ok) {
      return { ok: false, message: "Pocket could not safely open the decrypted document without losing information." };
    }
    const safeDocument = structure.normalisedDocument;
    if (!structure.normalisationChecked || !safeDocument) {
      return { ok: false, message: "Pocket could not safely validate the decrypted document." };
    }
    const norm = {
      schema: clean(payload.schema, 80),
      writtenAt: clean(payload.writtenAt || payload.exportedAt, 40),
      nodes: safeDocument.nodes,
      tombstones: safeDocument.tombstones,
      rootExtras: safeDocument.rootExtras,
      dataExtras: safeDocument.dataExtras,
    };
    return { ok: true, norm };
  }

  async function adoptReadyVault(candidate, ready, fileName, adoptionLease) {
    try {
      return await global.enqueuePocketOwnerTransition(async () => {
        if (!candidateIsCurrent(candidate)) return false;
        const committed = global.commitPreparedPocketDocument(ready.norm, {
          schema: ready.norm.schema || "",
          fileName,
          writtenAt: ready.norm.writtenAt || ready.unlocked.createdAt || "",
        }, {
          handle: candidate.handle,
          displayName: fileName,
          ownerKind: "vault",
          vaultSession: ready.unlocked,
          forceNewSession: true,
          canContinue: () => candidateIsCurrent(candidate),
          loadedStateOptions: {
            clearOps: true,
            skipLocalSafetyCheck: true,
            establishDocumentBaseline: true,
            baselinePayload: ready.payload,
            storagePrivate: "vault",
          },
        });
        if (!committed.ok) return false;
        global.clearConflictGuard?.();
        clearCandidate(candidate);
        global.refocusTreeNavigation?.(state.selectedId || "");
        say(`Encrypted Vault opened · revision ${ready.unlocked.revision}`, "ok", 5200);
        return true;
      });
    } finally {
      finishPreparedDocumentAdoption(adoptionLease);
    }
  }

  async function beforeAdoptPreparedDocument(candidateInfo = {}) {
    if (isDialogOpen() || preparedAdoptionLease) return false;
    if (!dialogCandidateIsCurrent(candidateInfo)) return false;
    const session = currentSaveSession();
    if (session?.ownerKind === "vault") {
      if (!hasUnsavedChanges()) {
        return acquirePreparedDocumentAdoption();
      }
      const choice = await showOwnerSwitchDialog(candidateInfo);
      const allowed = choice === "save" || choice === "discard";
      return allowed && dialogCandidateIsCurrent(candidateInfo)
        ? acquirePreparedDocumentAdoption()
        : false;
    }
    if (candidateInfo.kind === "vault" && hasUnsavedChanges()) {
      say("Save your current Pocket file before opening an encrypted Vault.", "warn", 6200);
      return false;
    }
    return acquirePreparedDocumentAdoption();
  }

  async function continueOpenVaultCandidate(candidate) {
    if (!candidateIsCurrent(candidate)) {
      clearCandidate(candidate);
      return false;
    }
    let file;
    let envelope;
    try {
      file = await candidate.handle.getFile();
      if (!candidateIsCurrent(candidate)) {
        clearCandidate(candidate);
        return false;
      }
      const text = await file.text();
      if (!candidateIsCurrent(candidate)) {
        clearCandidate(candidate);
        return false;
      }
      envelope = JSON.parse(text);
      global.PocketCrypto.validateEnvelope(envelope);
    } catch (_error) {
      clearCandidate(candidate);
      say("That encrypted Vault could not be read safely. Your current document is unchanged.", "warn", 7200);
      return false;
    }

    const unlockedResult = await showCredentialDialog({
      mode: "unlock",
      sourceSession: candidate.sourceSession,
      submit: async (credential, forgetCredentials) => {
        if (!candidateIsCurrent(candidate)) {
          return { ok: false, message: "This Vault open request is no longer current." };
        }
        let passphrase = String(credential || "");
        credential = "";
        let unlocked;
        try {
          unlocked = await global.PocketVault.unlockEnvelope(envelope, passphrase);
        } catch (_error) {
          return { ok: false, message: "That password did not unlock this Vault, or the Vault has been changed." };
        } finally {
          passphrase = "";
          forgetCredentials?.();
        }
        if (!candidateIsCurrent(candidate)) {
          return { ok: false, message: "This Vault open request is no longer current." };
        }
        const checked = validateDecryptedPayload(unlocked.payload);
        if (!checked.ok) return checked;
        return {
          ok: true,
          unlocked,
          payload: unlocked.payload,
          norm: checked.norm,
        };
      },
      cancel: () => clearCandidate(candidate),
    });
    if (!unlockedResult || unlockedResult.ok !== true || !candidateIsCurrent(candidate)) {
      clearCandidate(candidate);
      return false;
    }
    const adoptionLease = await beforeAdoptPreparedDocument({
      kind: "vault",
      displayName: clean(file?.name || candidate.handle?.name || "pocket.vault.json", 120),
      canContinue: () => candidateIsCurrent(candidate),
    });
    if (!adoptionLease || !candidateIsCurrent(candidate)) {
      finishPreparedDocumentAdoption(adoptionLease);
      clearCandidate(candidate);
      return false;
    }
    const fileName = clean(file?.name || candidate.handle?.name || "pocket.vault.json", 120);
    const adopted = await adoptReadyVault(candidate, unlockedResult, fileName, adoptionLease);
    if (!adopted) {
      clearCandidate(candidate);
      say("Pocket could not adopt that encrypted Vault. Your current document is unchanged.", "warn", 7200);
    }
    return adopted;
  }

  async function beginOpenVaultHandle(handle, sourceSession = currentSaveSession()) {
    if (ownerActionPending() || global.isPocketFilePermissionPromptOpen?.()) {
      say("Finish the current file action before opening another Vault.", "warn", 5200);
      return false;
    }
    if (global.isPocketDeviceChangesDecisionOpen?.()) {
      say("Choose how to handle the file and device changes first.", "warn", 5200);
      return false;
    }
    if (!handle || typeof handle.getFile !== "function" || !sourceSessionIsCurrent(sourceSession)) {
      return false;
    }
    const candidate = newCandidate("vault", handle, sourceSession);
    const activeRelationship = await compareHandles(handle, sourceSession.handle);
    if (!candidateIsCurrent(candidate)) {
      clearCandidate(candidate);
      return false;
    }
    if (activeRelationship.verified && activeRelationship.same) {
      clearCandidate(candidate);
      say("That file is already the active document.", "warn", 5200);
      return false;
    }
    const permission = await global.getPocketFilePermissionState(handle);
    if (!candidateIsCurrent(candidate)) {
      clearCandidate(candidate);
      return false;
    }
    if (permission === "prompt") {
      global.showPocketFilePermissionExplanation(handle, handle.name, {
        sourceSession,
        candidateKind: "vault",
        continueAfterPermission: () => continueOpenVaultCandidate(candidate),
        cancelCandidate: () => clearCandidate(candidate),
      });
      return false;
    }
    if (permission !== "granted") {
      clearCandidate(candidate);
      say("Pocket needs permission to open and save that encrypted Vault.", "warn", 6200);
      return false;
    }
    return continueOpenVaultCandidate(candidate);
  }

  async function openVault() {
    if (ownerActionPending() || global.isPocketFilePermissionPromptOpen?.()) {
      say("Finish the current file action before opening another Vault.", "warn", 5200);
      return false;
    }
    if (global.isPocketDeviceChangesDecisionOpen?.()) {
      say("Choose how to handle the file and device changes first.", "warn", 5200);
      return false;
    }
    if (typeof global.showOpenFilePicker !== "function") {
      say("Editable encrypted Vaults require supported local file access in this browser.", "warn", 7200);
      return false;
    }
    const sourceSession = currentSaveSession();
    let handle;
    try {
      const handles = await global.showOpenFilePicker(vaultPickerOptions("open"));
      handle = Array.isArray(handles) ? handles[0] : null;
    } catch (error) {
      if (!isAbort(error)) say("Could not open the encrypted Vault picker.", "warn", 6200);
      return false;
    }
    return beginOpenVaultHandle(handle, sourceSession);
  }

  async function writeEnvelopeToHandle(envelope, handle, options = {}) {
    if (!handle || typeof handle.createWritable !== "function") {
      return { ok: false, reason: "vault-write-failed" };
    }
    const isCurrent = typeof options.isCurrent === "function" ? options.isCurrent : () => true;
    if (!isCurrent()) return { ok: false, reason: "file-session-changed" };
    const permitted = await global.ensureWritePermission(handle);
    if (!isCurrent()) return { ok: false, reason: "file-session-changed" };
    if (!permitted) return { ok: false, reason: "permission-denied", permissionDenied: true };
    let writable;
    try {
      writable = await handle.createWritable();
      if (!isCurrent()) {
        try { await writable.abort?.(); } catch {}
        return { ok: false, reason: "file-session-changed" };
      }
      await writable.write(`${JSON.stringify(envelope, null, 2)}\n`);
      if (!isCurrent()) {
        try { await writable.abort?.(); } catch {}
        return { ok: false, reason: "file-session-changed" };
      }
      await writable.close();
      return { ok: true };
    } catch (error) {
      try { await writable?.abort?.(); } catch {}
      return { ok: false, reason: "vault-write-failed", error };
    }
  }

  async function writeActiveVaultPayload(payload, options = {}) {
    const expected = options.expectedSession;
    const requestIsCurrent = () => (
      sourceSessionIsCurrent(expected)
      && (
        !options.vaultDialogToken
        || allowsDialogSave(options.vaultDialogToken, expected)
      )
    );
    if (!expected
        || expected.ownerKind !== "vault"
        || !requestIsCurrent()
        || !expected.handle
        || !expected.vaultSessionId) {
      return { ok: false, reason: "vault-session-changed" };
    }
    const session = global.PocketVault?.getActiveSession?.();
    if (!session || session.vaultSessionId !== expected.vaultSessionId) {
      return { ok: false, reason: "vault-locked" };
    }
    let envelope;
    try {
      envelope = await global.PocketVault.sealWithUnlockedKey(payload, session, session.revision + 1);
    } catch (error) {
      return { ok: false, reason: "vault-encryption-failed", error };
    }
    if (!requestIsCurrent()) return { ok: false, reason: "vault-session-changed" };
    const permitted = await global.ensureWritePermission(expected.handle);
    if (!requestIsCurrent()) return { ok: false, reason: "vault-session-changed" };
    if (!permitted) return { ok: false, reason: "permission-denied", permissionDenied: true };
    let writable;
    try {
      writable = await expected.handle.createWritable();
      if (!requestIsCurrent()) {
        try { await writable.abort?.(); } catch {}
        return { ok: false, reason: "vault-session-changed" };
      }
      await writable.write(`${JSON.stringify(envelope, null, 2)}\n`);
      if (!requestIsCurrent()) {
        try { await writable.abort?.(); } catch {}
        return { ok: false, reason: "vault-session-changed" };
      }
      await writable.close();
    } catch (error) {
      try { await writable?.abort?.(); } catch {}
      return { ok: false, reason: "vault-write-failed", error };
    }
    if (!requestIsCurrent()) return { ok: false, reason: "vault-session-changed" };
    const advanced = global.PocketVault.replaceActiveSessionRevision(
      expected.vaultSessionId,
      envelope.revision
    );
    if (!advanced) return { ok: false, reason: "vault-session-changed" };
    return {
      ok: true,
      target: "vault",
      revision: envelope.revision,
      sourceIdentity: global.capturePocketEditorSourceIdentity(),
    };
  }

  async function createActiveVault() {
    if (ownerActionPending() || global.isPocketFilePermissionPromptOpen?.()) {
      say("Finish the current file action before creating a Vault.", "warn", 5200);
      return false;
    }
    if (!global.canShowPocketTree?.()) {
      say("Open or create a Pocket document before saving it as an encrypted Vault.", "warn", 6200);
      return false;
    }
    if (typeof global.showSaveFilePicker !== "function") {
      say("Editable encrypted Vaults require supported local file access in this browser.", "warn", 7200);
      return false;
    }
    const sourceSession = currentSaveSession();
    let handle;
    try {
      handle = await global.showSaveFilePicker(vaultPickerOptions("save"));
    } catch (error) {
      if (!isAbort(error)) say("Could not open the encrypted Vault picker.", "warn", 6200);
      return false;
    }
    if (!handle || !sourceSessionIsCurrent(sourceSession)) return false;
    if (!await requireDistinctDestination(
      handle,
      sourceSession.handle,
      "Choose a different file for the new encrypted Vault."
    )) return false;
    if (!sourceSessionIsCurrent(sourceSession)) return false;
    const candidate = newCandidate("create-vault", handle, sourceSession);
    const result = await showCredentialDialog({
      mode: "create",
      sourceSession,
      submit: async (credential, forgetCredentials) => {
        if (!candidateIsCurrent(candidate)) {
          return { ok: false, message: "This Vault creation request is no longer current." };
        }
        let passphrase = String(credential || "");
        credential = "";
        let session;
        let envelope;
        const coveredSequence = Number(global.getPocketHighestOperationSequence?.() || 0);
        const payload = global.buildPocketPayload(new Date().toISOString());
        try {
          session = await global.PocketVault.createUnlockedSession(passphrase);
        } catch (_error) {
          return { ok: false, message: "Pocket could not prepare the encrypted Vault." };
        } finally {
          passphrase = "";
          forgetCredentials?.();
        }
        try {
          envelope = await global.PocketVault.sealWithUnlockedKey(payload, session, 1);
        } catch (_error) {
          return { ok: false, message: "Pocket could not prepare the encrypted Vault." };
        }
        const written = await global.enqueuePocketOwnerTransition(async () => {
          if (!candidateIsCurrent(candidate)) return { ok: false, reason: "file-session-changed" };
          const saved = await writeEnvelopeToHandle(envelope, handle, {
            isCurrent: () => candidateIsCurrent(candidate),
          });
          if (!saved.ok) return saved;
          if (!candidateIsCurrent(candidate)) {
            return { ok: false, reason: "file-session-changed" };
          }
          const persistedSession = Object.freeze({
            ...session,
            revision: envelope.revision,
            createdAt: envelope.createdAt,
          });
          global.setPocketFileSession(handle, clean(handle.name || "pocket.vault.json", 120), {
            ownerKind: "vault",
            vaultSession: persistedSession,
            forceNewSession: true,
          });
          state.source = {
            schema: clean(payload.schema, 80),
            fileName: clean(handle.name || "pocket.vault.json", 120),
            writtenAt: clean(payload.writtenAt || payload.exportedAt, 40),
          };
          global.establishPocketDocumentBaseline?.(payload, state.source);
          global.retainPocketOperationsAfterSequence?.(coveredSequence);
          if (sourceSession.detachedDeviceChanges === true) {
            global.clearLocalSafetySnapshot?.({ coveredDetachedVaultAdoption: true });
          }
          global.clearConflictGuard?.();
          global.markVaultSavedNow?.();
          clearCandidate(candidate);
          global.refreshMeta?.();
          global.renderTree?.();
          return { ok: true };
        });
        return written.ok
          ? { ok: true }
          : { ok: false, message: "Pocket could not write the encrypted Vault. Your current document is unchanged." };
      },
      cancel: () => clearCandidate(candidate),
    });
    if (!result || result.ok !== true) {
      clearCandidate(candidate);
      return false;
    }
    say("Encrypted Vault created and opened.", "ok", 5200);
    return true;
  }

  async function exportUnencryptedJsonCopy() {
    if (!global.isPocketVaultOwnerActive?.()) {
      say("Open an encrypted Vault before exporting a readable copy.", "warn", 5200);
      return false;
    }
    if (ownerActionPending() || global.isPocketFilePermissionPromptOpen?.()) return false;
    const sourceSession = currentSaveSession();
    const confirmed = await showExportConfirmation();
    if (!confirmed || !sourceSessionIsCurrent(sourceSession)) return false;
    if (typeof global.showSaveFilePicker !== "function") {
      say("Readable JSON export is not available in this browser.", "warn", 6200);
      return false;
    }
    let handle;
    try {
      handle = await global.showSaveFilePicker(jsonExportPickerOptions());
    } catch (error) {
      if (!isAbort(error)) say("Could not open the JSON export picker.", "warn", 6200);
      return false;
    }
    if (!handle || !sourceSessionIsCurrent(sourceSession)) return false;
    if (!await requireDistinctDestination(
      handle,
      sourceSession.handle,
      "Choose a different file for the readable JSON copy."
    )) return false;
    if (!sourceSessionIsCurrent(sourceSession)) return false;
    const result = await global.enqueuePocketOwnerTransition(async () => {
      if (!sourceSessionIsCurrent(sourceSession)) return { ok: false, reason: "vault-session-changed" };
      const payload = global.buildPocketPayload(new Date().toISOString());
      let written;
      try {
        written = await global.writePocketPayloadToHandle(payload, handle, {
          isCurrent: () => sourceSessionIsCurrent(sourceSession),
        });
      } catch (error) {
        return { ok: false, reason: "write-failed", error };
      }
      if (!sourceSessionIsCurrent(sourceSession)) return { ok: false, reason: "vault-session-changed" };
      return written;
    });
    if (!result.ok) {
      say("The readable JSON copy was not exported. Your encrypted Vault remains active.", "warn", 6200);
      return false;
    }
    say("Readable JSON copy exported. The encrypted Vault remains active.", "ok", 6200);
    return true;
  }

  function init() {
    bindDialogUi();
    global.refreshMeta?.();
  }

  global.PocketVaultBrowserIo = Object.freeze({
    init,
    openVault,
    chooseVaultFile: openVault,
    openVaultFile: beginOpenVaultHandle,
    createActiveVault,
    saveVaultFromCurrentPocket: createActiveVault,
    exportUnencryptedJsonCopy,
    writeActiveVaultPayload,
    beforeAdoptPreparedDocument,
    finishPreparedDocumentAdoption,
    allowsDialogSave,
    isDialogOpen,
    isOwnerActionPending: ownerActionPending,
  });

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init, { once: true });
  } else {
    init();
  }
})(window);
