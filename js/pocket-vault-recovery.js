/* Encrypted browser recovery for unsaved, Vault-backed Pocket documents. */

(function initialisePocketVaultRecovery(global) {
  "use strict";

  const STORAGE_KEY = typeof VAULT_RECOVERY_KEY === "string"
    ? VAULT_RECOVERY_KEY
    : "pocketLite.vaultRecovery.encrypted.v1";
  const RECORD_SCHEMA = "pocket.vaultRecovery.encrypted.v1";
  const MAX_OUTPUT_NODES = 10000;
  const MAX_OUTPUT_CHARS = 5000000;

  let captureEpoch = 0;
  let captureTail = Promise.resolve({ ok: true, reason: "idle" });
  let captureStatus = "idle";
  let ownedRecordRaw = "";
  let activeFlow = null;
  let flowSequence = 0;
  let initialised = false;
  let deferredNormalStartup = null;

  function clean(value, max = 120) {
    return typeof global.cleanText === "function"
      ? global.cleanText(value, max)
      : String(value || "").trim().slice(0, max);
  }

  function cloneJson(value) {
    const owner = global.PocketDeviceChanges;
    if (owner && typeof owner.cloneJsonCompatible === "function") {
      const cloned = owner.cloneJsonCompatible(value);
      return cloned && cloned.ok ? cloned.value : null;
    }
    try {
      return JSON.parse(JSON.stringify(value));
    } catch (_error) {
      return null;
    }
  }

  function currentRawRecord() {
    try {
      return global.localStorage?.getItem(STORAGE_KEY) || "";
    } catch (_error) {
      return "";
    }
  }

  function inspectRecord(raw = currentRawRecord()) {
    if (!raw) return { exists: false, valid: false, raw: "", record: null };
    try {
      const record = JSON.parse(raw);
      if (!record
          || typeof record !== "object"
          || Array.isArray(record)
          || record.schema !== RECORD_SCHEMA
          || Number(record.version) !== 1
          || typeof record.capturedAt !== "string"
          || !Number.isFinite(Date.parse(record.capturedAt))
          || !record.envelope
          || typeof record.envelope !== "object") {
        return { exists: true, valid: false, raw, record: null };
      }
      global.PocketCrypto?.validateEnvelope?.(record.envelope);
      const highestSequence = Number(record.highestSequence);
      if (!Number.isSafeInteger(highestSequence) || highestSequence < 0) {
        return { exists: true, valid: false, raw, record: null };
      }
      return {
        exists: true,
        valid: true,
        raw,
        record,
      };
    } catch (_error) {
      return { exists: true, valid: false, raw, record: null };
    }
  }

  function hasRecovery() {
    return inspectRecord().exists;
  }

  function setCaptureStatus(next) {
    captureStatus = next;
    try {
      global.refreshMeta?.();
    } catch (_error) {}
  }

  function recoveryStatusText() {
    if (captureStatus === "failed") {
      return "Pocket could not update encrypted browser recovery. Save the Vault to protect these changes.";
    }
    if (captureStatus === "stored") {
      return "Unsaved Vault changes are encrypted in browser recovery on this device.";
    }
    return "Unsaved Vault changes are being encrypted for browser recovery.";
  }

  function activeVaultIdentity() {
    const session = global.PocketVault?.getActiveSession?.();
    const identity = global.PocketVault?.captureActiveSessionIdentity?.();
    const sourceIdentity = global.capturePocketEditorSourceIdentity?.();
    if (!session
        || !identity
        || !sourceIdentity
        || sourceIdentity.sourceOwnerKind !== "vault"
        || !global.isPocketVaultOwnerActive?.()) {
      return null;
    }
    return { session, identity, sourceIdentity };
  }

  function vaultCaptureIsCurrent(capture) {
    return !!capture
      && capture.epoch === captureEpoch
      && global.isPocketEditorSourceIdentityCurrent?.(capture.sourceIdentity) === true
      && global.PocketVault?.isActiveSessionIdentityCurrent?.(capture.identity) === true
      && global.isPocketVaultOwnerActive?.() === true;
  }

  function existingRecordAllowsCapture(vaultId) {
    const existing = inspectRecord();
    if (!existing.exists) return true;
    return existing.valid
      && existing.raw === ownedRecordRaw
      && clean(existing.record?.envelope?.vaultId, 160) === clean(vaultId, 160);
  }

  function scheduleCapture(reason = "change") {
    const active = activeVaultIdentity();
    const highestSequence = Number(global.getPocketHighestOperationSequence?.() || 0);
    if (!active || highestSequence <= 0) return false;
    const capturedAt = new Date().toISOString();
    const payload = cloneJson(global.buildPocketPayload?.(capturedAt));
    if (!payload) {
      setCaptureStatus("failed");
      return false;
    }
    const capture = {
      epoch: ++captureEpoch,
      reason: clean(reason, 80),
      capturedAt,
      highestSequence,
      payload,
      session: active.session,
      identity: active.identity,
      sourceIdentity: active.sourceIdentity,
    };
    setCaptureStatus("pending");
    const task = captureTail.then(async () => {
      if (!vaultCaptureIsCurrent(capture)) {
        return { ok: false, reason: "superseded" };
      }
      const existingBeforeEncryption = inspectRecord();
      if (!existingRecordAllowsCapture(capture.identity.vaultId)) {
        setCaptureStatus("failed");
        global.setStatus?.(
          "An earlier encrypted Vault recovery is still waiting. Resolve it before relying on recovery for this Vault.",
          "warn",
          { durationMs: 7200 }
        );
        return { ok: false, reason: "different-recovery-waiting" };
      }
      let envelope;
      try {
        envelope = await global.PocketVault.sealWithUnlockedKey(
          capture.payload,
          capture.session,
          capture.session.revision + 1
        );
      } catch (error) {
        if (capture.epoch === captureEpoch) setCaptureStatus("failed");
        return { ok: false, reason: "encryption-failed", error };
      }
      if (!vaultCaptureIsCurrent(capture)) {
        return { ok: false, reason: "superseded" };
      }
      const existingBeforeWrite = inspectRecord();
      if (existingBeforeWrite.raw !== existingBeforeEncryption.raw
          || !existingRecordAllowsCapture(capture.identity.vaultId)) {
        if (capture.epoch === captureEpoch) {
          setCaptureStatus("failed");
          global.setStatus?.(
            "Another encrypted Vault recovery is now waiting. Resolve it before relying on recovery for this Vault.",
            "warn",
            { durationMs: 7200 }
          );
        }
        return { ok: false, reason: "recovery-record-changed" };
      }
      const record = {
        schema: RECORD_SCHEMA,
        version: 1,
        capturedAt: capture.capturedAt,
        highestSequence: capture.highestSequence,
        envelope,
      };
      let raw;
      try {
        raw = JSON.stringify(record);
        global.localStorage?.setItem(STORAGE_KEY, raw);
      } catch (error) {
        if (capture.epoch === captureEpoch) {
          setCaptureStatus("failed");
          global.setStatus?.(
            "Pocket could not update encrypted browser recovery. Save the Vault to protect these changes.",
            "warn",
            { durationMs: 7200 }
          );
        }
        return { ok: false, reason: "storage-failed", error };
      }
      if (!vaultCaptureIsCurrent(capture)) {
        return { ok: false, reason: "superseded" };
      }
      if (currentRawRecord() !== raw) {
        if (capture.epoch === captureEpoch) {
          setCaptureStatus("failed");
          global.setStatus?.(
            "Another encrypted Vault recovery replaced this capture. Save the Vault to protect these changes.",
            "warn",
            { durationMs: 7200 }
          );
        }
        return { ok: false, reason: "recovery-record-replaced" };
      }
      ownedRecordRaw = raw;
      setCaptureStatus("stored");
      return {
        ok: true,
        capturedAt: capture.capturedAt,
        highestSequence: capture.highestSequence,
      };
    });
    captureTail = task.catch((error) => {
      if (capture.epoch === captureEpoch) setCaptureStatus("failed");
      return { ok: false, reason: "capture-failed", error };
    });
    return true;
  }

  async function captureCurrentUnsavedState(reason = "change") {
    if (!scheduleCapture(reason)) return { ok: false, reason: "not-captured" };
    return awaitStableCaptureTail();
  }

  function clearRecovery(expectedRaw) {
    const current = currentRawRecord();
    if (!current) {
      if (!expectedRaw || expectedRaw === ownedRecordRaw) ownedRecordRaw = "";
      setCaptureStatus("idle");
      return true;
    }
    if (typeof expectedRaw === "string" && expectedRaw !== current) return false;
    try {
      global.localStorage?.removeItem(STORAGE_KEY);
    } catch (_error) {
      return false;
    }
    const cleared = !currentRawRecord();
    if (cleared) {
      if (!expectedRaw || expectedRaw === ownedRecordRaw) ownedRecordRaw = "";
      setCaptureStatus("idle");
    }
    return cleared;
  }

  async function awaitStableCaptureTail() {
    let observed;
    do {
      observed = captureTail;
      await observed;
    } while (captureTail !== observed);
    return observed;
  }

  async function clearActiveVaultRecoveryIfClean() {
    const active = activeVaultIdentity();
    if (!active || Number(global.getPocketUnsavedOperationCount?.() || 0) > 0) return false;
    captureEpoch += 1;
    await awaitStableCaptureTail();
    const existing = inspectRecord();
    if (!existing.exists) {
      setCaptureStatus("idle");
      return true;
    }
    if (!existing.valid
        || existing.raw !== ownedRecordRaw
        || clean(existing.record.envelope?.vaultId, 160) !== clean(active.identity.vaultId, 160)) {
      return false;
    }
    return clearRecovery(existing.raw);
  }

  async function handleVaultTruthSaveSuccess() {
    const active = activeVaultIdentity();
    if (!active) return false;
    captureEpoch += 1;
    await awaitStableCaptureTail();
    if (Number(global.getPocketUnsavedOperationCount?.() || 0) <= 0) {
      const existing = inspectRecord();
      if (!existing.exists) {
        setCaptureStatus("idle");
        return true;
      }
      if (!existing.valid
          || existing.raw !== ownedRecordRaw
          || clean(existing.record.envelope?.vaultId, 160) !== clean(active.identity.vaultId, 160)) {
        return false;
      }
      return clearRecovery(existing.raw);
    }
    const scheduled = scheduleCapture("newer-change-after-save");
    if (!scheduled) return false;
    await awaitStableCaptureTail();
    const latestSequence = Number(global.getPocketHighestOperationSequence?.() || 0);
    const stored = inspectRecord();
    return stored.valid
      && !!ownedRecordRaw
      && stored.raw === ownedRecordRaw
      && clean(stored.record.envelope?.vaultId, 160) === clean(active.identity.vaultId, 160)
      && Number(stored.record.highestSequence) >= latestSequence;
  }

  function whenIdle() {
    return awaitStableCaptureTail();
  }

  function validateRecoveredPayload(payload) {
    if (!global.isPocketPayloadShape?.(payload)) {
      return { ok: false, reason: "unsupported-payload" };
    }
    const validator = global.PocketDeviceChanges;
    if (!validator || typeof validator.validateStructure !== "function") {
      return { ok: false, reason: "validation-unavailable" };
    }
    const checked = validator.validateStructure(payload, {
      maxNodes: MAX_OUTPUT_NODES,
      maxChars: MAX_OUTPUT_CHARS,
    });
    if (!checked.ok || !checked.normalisationChecked || !checked.normalisedDocument) {
      return { ok: false, reason: checked.reason || "unsafe-payload" };
    }
    const documentValue = cloneJson(checked.document);
    return documentValue
      ? { ok: true, document: documentValue }
      : { ok: false, reason: "clone-failed" };
  }

  function payloadFromDocument(documentValue, writtenAt = new Date().toISOString()) {
    const documentClone = cloneJson(documentValue);
    if (!documentClone) return null;
    const nodes = cloneJson(documentClone.nodes || []);
    const tombstones = cloneJson(documentClone.tombstones || []);
    const rootExtras = cloneJson(documentClone.rootExtras || {});
    const dataExtras = cloneJson(documentClone.dataExtras || {});
    if (!nodes || !tombstones || !rootExtras || !dataExtras) return null;
    return {
      ...rootExtras,
      schema: "portal.export.v1",
      exportedAt: writtenAt,
      writtenAt,
      mainThoughtTree: nodes,
      mainThoughtTreeTombstones: tombstones,
      data: {
        ...dataExtras,
        mainThoughtTree: nodes,
        mainThoughtTreeTombstones: tombstones,
      },
    };
  }

  function recoveredLabel(capturedAt) {
    const value = Number.isFinite(Date.parse(capturedAt)) ? new Date(capturedAt) : new Date();
    const date = value.toISOString().slice(0, 10);
    const time = value.toTimeString().slice(0, 5);
    return clean(`Recovered ${date} ${time}`, 220) || "Recovered items";
  }

  function freshRecoveredId(usedIds, prefix, index) {
    const base = typeof global.makeId === "function"
      ? clean(global.makeId(prefix), 64)
      : `${prefix}_${Date.now().toString(36)}`;
    let attempt = Math.max(0, Number(index) || 0);
    while (attempt < Number.MAX_SAFE_INTEGER) {
      const suffix = attempt.toString(36);
      const candidate = clean(`${base.slice(0, Math.max(1, 78 - suffix.length))}_${suffix}`, 80);
      if (candidate && candidate !== "root" && !usedIds.has(candidate)) {
        usedIds.add(candidate);
        return candidate;
      }
      attempt += 1;
    }
    return "";
  }

  function buildRecoveredImport(destinationPayload, recoveredPayload, capturedAt) {
    const destination = validateRecoveredPayload(destinationPayload);
    const recovered = validateRecoveredPayload(recoveredPayload);
    if (!destination.ok || !recovered.ok) {
      return { ok: false, reason: destination.reason || recovered.reason || "invalid-document" };
    }
    const destinationDocument = cloneJson(destination.document);
    const recoveredDocument = cloneJson(recovered.document);
    if (!destinationDocument || !recoveredDocument) return { ok: false, reason: "clone-failed" };

    const usedIds = new Set((destinationDocument.nodes || []).map((node) => clean(node?.id, 80)).filter(Boolean));
    const wrapperId = freshRecoveredId(usedIds, "recovered", 0);
    if (!wrapperId) return { ok: false, reason: "id-generation-failed" };
    const idMap = new Map();
    (recoveredDocument.nodes || []).forEach((node, index) => {
      const originalId = clean(node?.id, 80);
      if (originalId) idMap.set(originalId, freshRecoveredId(usedIds, "recovered_item", index + 1));
    });
    if (idMap.size !== (recoveredDocument.nodes || []).length
        || Array.from(idMap.values()).some((id) => !id)) {
      return { ok: false, reason: "id-generation-failed" };
    }

    const rootOrders = (destinationDocument.nodes || [])
      .filter((node) => clean(node?.parentId, 80) === "root" && Number.isFinite(Number(node?.order)))
      .map((node) => Number(node.order));
    const nextRootOrder = rootOrders.length ? Math.max(...rootOrders) + 1 : 0;
    const now = new Date().toISOString();
    const wrapper = {
      id: wrapperId,
      parentId: "root",
      order: nextRootOrder,
      label: recoveredLabel(capturedAt),
      updatedAt: now,
      source: "manual",
    };
    const copiedNodes = (recoveredDocument.nodes || []).map((node) => {
      const copy = cloneJson(node);
      const originalId = clean(node.id, 80);
      const originalParent = clean(node.parentId, 80);
      copy.id = idMap.get(originalId);
      copy.parentId = originalParent === "root" ? wrapperId : idMap.get(originalParent);
      return copy;
    });
    const combinedDocument = {
      nodes: (destinationDocument.nodes || []).concat([wrapper], copiedNodes),
      tombstones: destinationDocument.tombstones || [],
      rootExtras: destinationDocument.rootExtras || {},
      dataExtras: destinationDocument.dataExtras || {},
    };
    const validator = global.PocketDeviceChanges;
    const checked = validator.validateStructure(combinedDocument, {
      maxNodes: MAX_OUTPUT_NODES,
      maxChars: MAX_OUTPUT_CHARS,
    });
    if (!checked.ok || !checked.normalisationChecked || !checked.normalisedDocument) {
      return { ok: false, reason: checked.reason || "unsafe-import" };
    }
    const payload = payloadFromDocument(checked.document, now);
    return payload
      ? { ok: true, payload, wrapperId }
      : { ok: false, reason: "payload-build-failed" };
  }

  function flowIsCurrent(flow) {
    return !!flow
      && activeFlow === flow
      && flow.cancelled !== true
      && global.isPocketFileSaveSessionCurrent?.(flow.sourceSession) === true;
  }

  function flowRecordIsActive(flow) {
    return !!flow && activeFlow === flow && flow.cancelled !== true;
  }

  function allowsOutputToken(token) {
    return !!activeFlow
      && activeFlow.token === token
      && activeFlow.cancelled !== true
      && flowIsCurrent(activeFlow);
  }

  function clearDecryptedFlowState(flow) {
    if (!flow) return;
    flow.payload = null;
    flow.document = null;
  }

  function finishFlow(flow, options = {}) {
    if (!flowRecordIsActive(flow)) return false;
    flow.cancelled = true;
    clearDecryptedFlowState(flow);
    activeFlow = null;
    if (options.status) {
      global.setStatus?.(options.status, options.tone || "ok", {
        durationMs: options.durationMs || 5200,
      });
    }
    if (global.canShowPocketTree?.()) {
      global.refocusTreeNavigation?.(typeof state === "object" ? state.selectedId : "");
    } else {
      global.document?.getElementById?.("btnLoad")?.focus?.({ preventScroll: true });
    }
    const resume = deferredNormalStartup;
    deferredNormalStartup = null;
    if (typeof resume === "function") {
      try {
        resume();
      } catch (_error) {}
    }
    return true;
  }

  function deferNormalStartup(resume) {
    if (!isFlowOpen() || typeof resume !== "function") return false;
    deferredNormalStartup = resume;
    return true;
  }

  async function confirmRecoveryDeletion(flow, afterUnlock) {
    const confirmed = await global.PocketVaultBrowserIo?.showRecoveryConfirmation?.({
      mode: afterUnlock ? "recovery-confirm-discard" : "recovery-confirm-delete",
      title: afterUnlock ? "Discard encrypted recovery?" : "Delete encrypted recovery?",
      body: "This permanently deletes only the browser-held encrypted recovery. It does not change or delete any saved Pocket file or Vault.",
      confirmLabel: afterUnlock ? "Discard recovery" : "Delete recovery",
      danger: true,
    });
    if (!flowIsCurrent(flow) || !confirmed) return false;
    if (!clearRecovery(flow.recordRaw)) {
      global.setStatus?.(
        "Pocket could not delete the encrypted browser recovery. It is still available.",
        "warn",
        { durationMs: 6200 }
      );
      return false;
    }
    finishFlow(flow, {
      status: "Encrypted browser recovery deleted. Saved files were not changed.",
      tone: "ok",
    });
    return true;
  }

  async function unlockRecovery(flow) {
    const unlocked = await global.PocketVaultBrowserIo?.showRecoveryUnlock?.({
      submit: async (credential, forgetCredentials) => {
        if (!flowIsCurrent(flow)) {
          return { ok: false, message: "This recovery request is no longer current." };
        }
        const current = inspectRecord();
        if (!current.exists || current.raw !== flow.recordRaw || !current.valid) {
          forgetCredentials?.();
          return {
            ok: false,
            message: "Pocket could not unlock this browser recovery. It may be damaged or may have changed.",
          };
        }
        let password = String(credential || "");
        credential = "";
        let opened;
        try {
          opened = await global.PocketCrypto.unlockEnvelope(current.record.envelope, password);
        } catch (_error) {
          return {
            ok: false,
            message: "That password did not unlock the recovery. Nothing was revealed or deleted.",
          };
        } finally {
          password = "";
          forgetCredentials?.();
        }
        if (!flowIsCurrent(flow)) {
          return { ok: false, message: "This recovery request is no longer current." };
        }
        const checked = validateRecoveredPayload(opened.payload);
        if (!checked.ok) {
          opened = null;
          return {
            ok: false,
            message: "Pocket unlocked the data but could not validate it safely. The encrypted recovery was not deleted.",
          };
        }
        const payload = payloadFromDocument(checked.document, new Date().toISOString());
        opened = null;
        if (!payload) {
          return {
            ok: false,
            message: "Pocket could not prepare the recovered data safely. The encrypted recovery was not deleted.",
          };
        }
        return { ok: true, payload, document: checked.document };
      },
    });
    if (!flowIsCurrent(flow) || !unlocked || unlocked.ok !== true) return false;
    flow.payload = unlocked.payload;
    flow.document = unlocked.document;
    return true;
  }

  async function saveRecoveryAsVault(flow) {
    const payload = payloadFromDocument(flow.document, new Date().toISOString());
    if (!payload) return false;
    const result = await global.PocketVaultBrowserIo?.saveRecoveredPayloadAsVault?.(payload, {
      recoveryFlowToken: flow.token,
    });
    if (!flowIsCurrent(flow) && result?.ok !== true) return false;
    if (!result || result.ok !== true) {
      global.setStatus?.(
        "The recovered encrypted Vault was not saved. The browser recovery is still available.",
        "warn",
        { durationMs: 6200 }
      );
      return false;
    }
    if (!clearRecovery(flow.recordRaw)) {
      finishFlow(flow, {
        status: "Recovered Vault saved, but Pocket could not remove the older browser recovery.",
        tone: "warn",
        durationMs: 7200,
      });
      return true;
    }
    finishFlow(flow, {
      status: "Recovered data saved as a new encrypted Vault.",
      tone: "ok",
    });
    return true;
  }

  async function saveRecoveryAsJson(flow) {
    const confirmed = await global.PocketVaultBrowserIo?.showRecoveryConfirmation?.({
      mode: "recovery-confirm-plain-json",
      title: "Save recovered data without encryption?",
      body: "This creates a readable plain JSON file. Anyone who can open that file can read the recovered Pocket content.",
      confirmLabel: "Save plain JSON",
    });
    if (!flowIsCurrent(flow) || !confirmed) return false;
    const payload = payloadFromDocument(flow.document, new Date().toISOString());
    if (!payload) return false;
    const result = await global.PocketVaultBrowserIo?.saveRecoveredPayloadAsJson?.(payload, {
      recoveryFlowToken: flow.token,
    });
    if (!flowIsCurrent(flow) && result?.ok !== true) return false;
    if (!result || result.ok !== true) {
      global.setStatus?.(
        "The recovered plain JSON file was not saved. The encrypted browser recovery is still available.",
        "warn",
        { durationMs: 6200 }
      );
      return false;
    }
    if (!clearRecovery(flow.recordRaw)) {
      finishFlow(flow, {
        status: "Recovered plain JSON saved, but Pocket could not remove the encrypted browser recovery.",
        tone: "warn",
        durationMs: 7200,
      });
      return true;
    }
    finishFlow(flow, {
      status: "Recovered data saved as plain JSON.",
      tone: "ok",
    });
    return true;
  }

  async function addRecoveryToExisting(flow) {
    if (typeof global.showOpenFilePicker !== "function") {
      global.setStatus?.("Opening an existing Pocket file is not available in this browser.", "warn");
      return false;
    }
    let handle;
    try {
      const handles = await global.showOpenFilePicker({
        types: [{
          description: "Pocket JSON file",
          accept: { "application/json": [".json"] },
        }],
        multiple: false,
      });
      handle = Array.isArray(handles) ? handles[0] : null;
    } catch (error) {
      if (!error || (error.name !== "AbortError" && !/abort/i.test(String(error.message || "")))) {
        global.setStatus?.("Pocket could not open the existing-file picker.", "warn");
      }
      return false;
    }
    if (!handle || !flowIsCurrent(flow)) return false;

    let file;
    let parsed;
    let destinationRaw = "";
    try {
      file = await handle.getFile();
      destinationRaw = await file.text();
      if (destinationRaw.length > MAX_OUTPUT_CHARS) {
        throw new Error("The selected Pocket file is too large for this safe import.");
      }
      parsed = JSON.parse(destinationRaw);
    } catch (_error) {
      global.setStatus?.(
        "Pocket could not read that existing Pocket JSON file safely. Nothing was written.",
        "warn",
        { durationMs: 7200 }
      );
      return false;
    }
    if (!flowIsCurrent(flow)
        || global.PocketCrypto?.isVaultEnvelope?.(parsed)
        || !global.isPocketPayloadShape?.(parsed)) {
      global.setStatus?.(
        "Choose a supported plain Pocket JSON file for this import. Nothing was written.",
        "warn",
        { durationMs: 7200 }
      );
      return false;
    }
    const combined = buildRecoveredImport(parsed, flow.payload, flow.capturedAt);
    if (!combined.ok) {
      global.setStatus?.(
        "Pocket could not add the recovered items without risking content loss. Nothing was written.",
        "warn",
        { durationMs: 7200 }
      );
      return false;
    }
    const fileName = clean(file?.name || handle.name || "Pocket file", 120);
    const confirmed = await global.PocketVaultBrowserIo?.showRecoveryConfirmation?.({
      mode: "recovery-confirm-add-existing",
      title: `Add recovered items to ${fileName}?`,
      body: "Pocket will add one new top-level Recovered item and save only the file you selected. It will not merge or overwrite existing items.",
      confirmLabel: "Add and save",
    });
    if (!flowIsCurrent(flow) || !confirmed) return false;

    const sourceSession = flow.sourceSession;
    const written = await global.enqueuePocketOwnerTransition(async () => {
      const isCurrent = () => flowIsCurrent(flow)
        && global.isPocketFileSaveSessionCurrent?.(sourceSession) === true;
      if (!isCurrent()) return { ok: false, reason: "recovery-flow-changed" };
      const permitted = await global.ensureWritePermission?.(handle);
      if (!isCurrent()) return { ok: false, reason: "recovery-flow-changed" };
      if (!permitted) return { ok: false, reason: "permission-denied" };
      let currentDestinationRaw = "";
      try {
        const currentDestination = await handle.getFile();
        currentDestinationRaw = await currentDestination.text();
      } catch (error) {
        return { ok: false, reason: "destination-read-failed", error };
      }
      if (!isCurrent()) return { ok: false, reason: "recovery-flow-changed" };
      if (currentDestinationRaw !== destinationRaw) {
        return { ok: false, reason: "destination-changed" };
      }
      let saved;
      try {
        saved = await global.writePocketPayloadToHandle(combined.payload, handle, { isCurrent });
      } catch (error) {
        return { ok: false, reason: "write-failed", error };
      }
      if (!saved.ok || !isCurrent()) return saved;
      return { ok: true, written: true, targetName: fileName };
    });
    if (!written.ok) {
      global.setStatus?.(
        "The existing Pocket file was not changed. The encrypted browser recovery is still available.",
        "warn",
        { durationMs: 7200 }
      );
      return false;
    }
    if (!clearRecovery(flow.recordRaw)) {
      finishFlow(flow, {
        status: "Recovered items were added, but Pocket could not remove the encrypted browser recovery.",
        tone: "warn",
        durationMs: 7200,
      });
      return true;
    }
    finishFlow(flow, {
      status: `Recovered items added beneath ${recoveredLabel(flow.capturedAt)}.`,
      tone: "ok",
    });
    return true;
  }

  async function runUnlockedActions(flow) {
    while (flowIsCurrent(flow) && flow.payload && flow.document) {
      const action = await global.PocketVaultBrowserIo?.showRecoveryActions?.();
      if (!flowIsCurrent(flow)) return false;
      if (!action || action === "keep") {
        finishFlow(flow, {
          status: "Encrypted browser recovery kept for later.",
          tone: "ok",
        });
        return true;
      }
      if (action === "discard") {
        if (await confirmRecoveryDeletion(flow, true)) return true;
        continue;
      }
      if (action === "save-vault") {
        if (await saveRecoveryAsVault(flow)) return true;
        continue;
      }
      if (action === "save-json") {
        if (await saveRecoveryAsJson(flow)) return true;
        continue;
      }
      if (action === "add-existing") {
        if (await addRecoveryToExisting(flow)) return true;
      }
    }
    return false;
  }

  async function runStartupFlow(flow) {
    while (flowIsCurrent(flow)) {
      const action = await global.PocketVaultBrowserIo?.showRecoveryWarning?.();
      if (!flowIsCurrent(flow)) return false;
      if (!action || action === "later") {
        finishFlow(flow, {
          status: "Encrypted browser recovery kept for later.",
          tone: "ok",
        });
        return true;
      }
      if (action === "delete") {
        if (await confirmRecoveryDeletion(flow, false)) return true;
        continue;
      }
      if (action === "unlock") {
        if (!await unlockRecovery(flow)) continue;
        return runUnlockedActions(flow);
      }
    }
    return false;
  }

  function showStartupWarning() {
    const inspected = inspectRecord();
    if (!inspected.exists || activeFlow) return false;
    const sourceSession = global.capturePocketFileSaveSession?.();
    if (!sourceSession) return false;
    const flow = {
      id: ++flowSequence,
      token: Object.freeze({ id: flowSequence }),
      sourceSession,
      recordRaw: inspected.raw,
      capturedAt: inspected.valid ? inspected.record.capturedAt : "",
      payload: null,
      document: null,
      cancelled: false,
    };
    activeFlow = flow;
    void runStartupFlow(flow);
    return true;
  }

  function isFlowOpen() {
    return !!activeFlow && activeFlow.cancelled !== true;
  }

  function init() {
    if (initialised) return true;
    initialised = true;
    if (hasRecovery()) showStartupWarning();
    return true;
  }

  global.PocketVaultRecovery = Object.freeze({
    STORAGE_KEY,
    RECORD_SCHEMA,
    hasRecovery,
    inspectRecord,
    scheduleCapture,
    captureCurrentUnsavedState,
    handleVaultTruthSaveSuccess,
    clearActiveVaultRecoveryIfClean,
    clearRecovery,
    whenIdle,
    recoveryStatusText,
    showStartupWarning,
    isFlowOpen,
    deferNormalStartup,
    allowsOutputToken,
    validateRecoveredPayload,
    payloadFromDocument,
    buildRecoveredImport,
  });

  global.PocketVaultBrowserIo?.init?.();
  init();
})(typeof window !== "undefined" ? window : globalThis);
