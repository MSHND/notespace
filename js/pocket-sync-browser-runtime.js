/* Dormant browser composition for an explicitly invoked Sync activation. */

(function initialisePocketSyncBrowserRuntime(global) {
  "use strict";

  const SERVICE_FIELDS = Object.freeze([
    "accountService", "contentService", "envelopeService", "recoveryService",
  ]);
  const RECOVERY_FILENAME = "Pocket Recovery Copy.json";
  const BEGIN_ATTENTION_REASONS = Object.freeze({
    "begin-attention-expired": "recovery-begin-expired",
    "begin-attention-not-found": "recovery-begin-not-found",
    "begin-attention-rejected": "recovery-begin-rejected",
    "begin-attention-generic-rejected": "recovery-begin-rejected",
    "begin-attention-request-rejected": "recovery-begin-request-rejected",
    "begin-attention-authentication-rejected": "recovery-begin-authentication-rejected",
    "begin-attention-authorisation-rejected": "recovery-begin-authorisation-rejected",
    "begin-attention-conflict": "recovery-begin-conflict",
    "begin-attention-response-invalid": "recovery-begin-response-invalid",
    "begin-attention-service-state-invalid": "recovery-begin-service-state-invalid",
    "begin-attention-storage-failed": "recovery-begin-storage-failed",
    "begin-attention-server-contract-invalid": "recovery-begin-server-contract-invalid",
    "begin-attention-server-internal": "recovery-begin-server-internal",
    "begin-attention-http-shell-rejected": "recovery-begin-http-shell-rejected",
    "begin-attention-redirect-rejected": "recovery-begin-redirect-rejected",
    "begin-attention-unclassified-rejected": "recovery-begin-rejected",
  });

  function frozen(value) {
    return Object.freeze(value);
  }

  function requireMethods(value, methods, code) {
    if (!value || typeof value !== "object" || methods.some((method) => typeof value[method] !== "function")) {
      throw new Error(`Pocket Sync browser runtime ${code}.`);
    }
    return value;
  }

  function safeFailure(reason) {
    return frozen({ ok: false, reason, adopted: false, sourceOwnerPreserved: true });
  }

  function isLegacyRestartableDraft(draft, ownerKind) {
    return ownerKind === "none"
      && draft?.stage === "begin-pending"
      && ["begin-attention-rejected", "begin-attention-generic-rejected"].includes(draft.pendingOperation)
      && draft.beginResponse === null
      && draft.finishRequest === null
      && draft.finishResponse === null
      && draft.confirmedRemoteRevision === 0
      && draft.content === null
      && draft.deviceEnvelope === null
      && draft.replacementRecoveryRoot === null
      && draft.replacementRecoveryVerifier === null
      && draft.replacementRecoveryAuthorisation === null
      && draft.replacementRecoveryEnvelope === null
      && draft.replacementAccountLocator === null
      && draft.replacementRecoveryPackage === null
      && draft.account === null
      && draft.keySetVersion === 0
      && draft.recoveryVersion === 0
      && draft.deviceGrant === null
      && draft.replacementRecoveryCopyStored === false;
  }

  function browserEnvironment(value) {
    if (value === undefined) return global;
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      throw new Error("Pocket Sync browser runtime environment-invalid.");
    }
    return value;
  }

  function sourceSession() {
    const captured = typeof global.capturePocketFileSaveSession === "function"
      ? global.capturePocketFileSaveSession() : null;
    if (!captured || !["json", "vault"].includes(captured.ownerKind)
        || !Number.isSafeInteger(captured.id)) return null;
    const fingerprint = global.PocketDeviceChanges?.fingerprintDocument;
    if (typeof fingerprint !== "function" || typeof global.buildPocketPayload !== "function") return null;
    let contentContinuityId;
    try { contentContinuityId = fingerprint(global.buildPocketPayload(new Date(0).toISOString())); }
    catch (_error) { return null; }
    if (typeof contentContinuityId !== "string" || contentContinuityId.length < 1) return null;
    return frozen({
      ownerKind: captured.ownerKind,
      id: captured.id,
      vaultSessionId: typeof captured.vaultSessionId === "string" ? captured.vaultSessionId : "",
      continuityId: `${captured.id}:${contentContinuityId}`,
    });
  }

  function sourceSessionCurrent(snapshot) {
    const current = sourceSession();
    return !!current && !!snapshot
      && current.ownerKind === snapshot.ownerKind
      && current.id === snapshot.id
      && current.vaultSessionId === snapshot.vaultSessionId
      && current.continuityId === snapshot.continuityId;
  }

  function sourceSessionIdentityCurrent(snapshot) {
    const current = sourceSession();
    return !!current && !!snapshot
      && current.ownerKind === snapshot.ownerKind
      && current.id === snapshot.id
      && current.vaultSessionId === snapshot.vaultSessionId;
  }

  function sourceIsDirty(snapshot) {
    if (!sourceSessionCurrent(snapshot)) throw new Error("Pocket Sync browser runtime source-session-changed.");
    if (typeof global.hasPocketUnsavedChanges !== "function") {
      throw new Error("Pocket Sync browser runtime dirty-state-unavailable.");
    }
    return global.hasPocketUnsavedChanges() === true;
  }

  function prepareEditorDrafts(snapshot) {
    // Activation freezes from the tree, so live editor drafts must join that truth first.
    if (!sourceSessionCurrent(snapshot)) return "source-session-changed";
    if (global.hasUnsavedDetailsEditorChanges?.() === true) {
      if (typeof global.saveDetailsEditor !== "function") return "editor-draft-commit-failed";
      try { global.saveDetailsEditor(); } catch (_error) { return "editor-draft-commit-failed"; }
      if (!sourceSessionIdentityCurrent(snapshot)) return "source-session-changed";
      if (global.hasUnsavedDetailsEditorChanges?.() === true) return "editor-draft-commit-failed";
    }
    if (global.hasUnsavedInlineTitleDraft?.() === true) {
      if (typeof global.captureActiveInlineEditForOwnerSwitch !== "function"
          || typeof global.commitActiveInlineEditForOwnerSwitch !== "function") {
        return "editor-draft-commit-failed";
      }
      let captured;
      let committed;
      try {
        captured = global.captureActiveInlineEditForOwnerSwitch();
        committed = global.commitActiveInlineEditForOwnerSwitch(captured, {
          isCurrent: () => sourceSessionIdentityCurrent(snapshot),
        });
      } catch (_error) {
        return "editor-draft-commit-failed";
      }
      if (!sourceSessionIdentityCurrent(snapshot)) return "source-session-changed";
      if (!captured?.ok || !committed?.ok || global.hasUnsavedInlineTitleDraft?.() === true) {
        return "editor-draft-commit-failed";
      }
    }
    return "";
  }

  function browserRandom(environment) {
    return (length) => {
      const crypto = environment.crypto || global.crypto;
      if (!crypto || typeof crypto.getRandomValues !== "function") {
        throw new Error("Pocket Sync browser runtime secure-random-unavailable.");
      }
      const bytes = new Uint8Array(length);
      crypto.getRandomValues(bytes);
      return bytes;
    };
  }

  function recoveryPicker(environment) {
    return async () => {
      const select = environment.showSaveFilePicker || global.showSaveFilePicker;
      if (typeof select !== "function") {
        const document = environment.document || global.document;
        const Blob = environment.Blob || global.Blob;
        const URL = environment.URL || global.URL;
        if (!document?.createElement || !document.body?.appendChild
            || typeof Blob !== "function" || typeof URL?.createObjectURL !== "function"
            || typeof URL.revokeObjectURL !== "function") return frozen({ ok: false });
        return frozen({ ok: true, destination: frozen({ kind: "browser-download" }) });
      }
      try {
        const destination = await select.call(environment, {
          suggestedName: RECOVERY_FILENAME,
          types: [{
            description: "Pocket recovery copy",
            accept: { "application/json": [".json"] },
          }],
        });
        return destination ? frozen({ ok: true, destination }) : frozen({ ok: false });
      } catch (_error) {
        return frozen({ ok: false });
      }
    };
  }

  function recoveryPackagePicker(environment) {
    return async () => {
      const select = environment.showOpenFilePicker || global.showOpenFilePicker;
      if (typeof select !== "function") {
        const document = environment.document || global.document;
        if (!document?.createElement || !document.body?.appendChild) return null;
        return new Promise((resolve) => {
          const input = document.createElement("input");
          let settled = false;
          const finish = (value) => {
            if (settled) return;
            settled = true;
            try { input.value = ""; input.remove?.(); } catch (_error) {}
            resolve(value);
          };
          input.type = "file";
          input.accept = ".json,application/json";
          input.multiple = false;
          input.hidden = true;
          input.addEventListener?.("cancel", () => finish(null), { once: true });
          input.addEventListener?.("change", async () => {
            const file = input.files?.length === 1 ? input.files[0] : null;
            if (!file || (file.type !== "application/json" && !file.name?.toLowerCase().endsWith(".json"))
                || typeof file.text !== "function") return finish(null);
            try { return finish(JSON.parse(await file.text())); }
            catch (_error) { return finish(null); }
          }, { once: true });
          document.body.appendChild(input);
          try { input.click(); } catch (_error) { finish(null); }
        });
      }
      try {
        const handles = await select.call(environment, {
          multiple: false,
          types: [{
            description: "Pocket recovery copy",
            accept: { "application/json": [".json"] },
          }],
        });
        if (!Array.isArray(handles) || handles.length !== 1
            || !handles[0] || typeof handles[0].getFile !== "function") return null;
        const file = await handles[0].getFile();
        if (!file || typeof file.text !== "function") return null;
        return JSON.parse(await file.text());
      } catch (_error) {
        return null;
      }
    };
  }

  function writeRecoveryCopy(environment) {
    return async (input) => {
      if (!input || !input.destination || !input.recoveryPackage) return frozen({ ok: false });
      if (input.destination.kind === "browser-download") {
        const document = environment.document || global.document;
        const Blob = environment.Blob || global.Blob;
        const URL = environment.URL || global.URL;
        if (!document?.createElement || !document.body?.appendChild || typeof Blob !== "function"
            || typeof URL?.createObjectURL !== "function" || typeof URL.revokeObjectURL !== "function") {
          return frozen({ ok: false });
        }
        let link;
        let objectUrl;
        let deferredCleanup = false;
        try {
          const blob = new Blob([`${JSON.stringify(input.recoveryPackage, null, 2)}\n`], {
            type: "application/json",
          });
          objectUrl = URL.createObjectURL(blob);
          link = document.createElement("a");
          link.href = objectUrl;
          link.download = RECOVERY_FILENAME;
          link.hidden = true;
          document.body.appendChild(link);
          if (typeof link.click !== "function") throw new Error("recovery-download-unavailable");
          link.click();
          const schedule = environment.setTimeout || global.setTimeout;
          if (typeof schedule !== "function") throw new Error("recovery-download-cleanup-unavailable");
          schedule(() => {
            try { link?.remove?.(); } catch (_removeError) {}
            try { if (objectUrl) URL.revokeObjectURL(objectUrl); } catch (_revokeError) {}
          }, 1000);
          deferredCleanup = true;
          return frozen({ ok: true });
        } catch (_error) {
          return frozen({ ok: false });
        } finally {
          if (!deferredCleanup) {
            try { link?.remove?.(); } catch (_removeError) {}
            try { if (objectUrl) URL.revokeObjectURL(objectUrl); } catch (_revokeError) {}
          }
        }
      }
      if (typeof input.destination.createWritable !== "function") return frozen({ ok: false });
      let writable;
      try {
        writable = await input.destination.createWritable();
        if (!writable || typeof writable.write !== "function" || typeof writable.close !== "function") {
          throw new Error("recovery-writer-invalid");
        }
        await writable.write(`${JSON.stringify(input.recoveryPackage, null, 2)}\n`);
        await writable.close();
        return frozen({ ok: true });
      } catch (_error) {
        try { await writable?.abort?.(); } catch (_abortError) {}
        return frozen({ ok: false });
      }
    };
  }

  function freezePocketPayload(snapshot, now) {
    let frozenPayload = null;
    return async () => {
      if (!sourceSessionCurrent(snapshot)) {
        const error = new Error("Pocket Sync browser runtime source-session-changed.");
        error.code = "source-session-changed";
        throw error;
      }
      if (frozenPayload === null) {
        if (typeof global.buildPocketPayload !== "function") {
          throw new Error("Pocket Sync browser runtime payload-unavailable.");
        }
        frozenPayload = global.buildPocketPayload(new Date(now()).toISOString());
      }
      if (!sourceSessionCurrent(snapshot)) {
        const error = new Error("Pocket Sync browser runtime source-session-changed.");
        error.code = "source-session-changed";
        throw error;
      }
      return frozenPayload;
    };
  }

  async function buildRecoveryPackage(security, crypto, environment, input) {
    const browserCrypto = environment.crypto || global.crypto;
    const Encoder = environment.TextEncoder || global.TextEncoder;
    if (!browserCrypto?.subtle || typeof browserCrypto.subtle.digest !== "function"
        || typeof Encoder !== "function") throw new Error("recovery-checksum-unavailable");
    const checksumInput = JSON.stringify({
      packageVersion: input.packageVersion,
      accountLocator: input.accountLocator,
      syncedPocketId: input.syncedPocketId,
      rootMaterial: input.rootMaterial,
      rootBits: input.rootBits,
      instructions: input.instructions,
    });
    const digest = new Uint8Array(await browserCrypto.subtle.digest(
      "SHA-256",
      new Encoder().encode(checksumInput)
    ));
    return security.buildRecoveryPackage(Object.assign({}, input, {
      checksum: crypto.encodeBase64Url(digest),
    }));
  }

  function createRuntime(input) {
    if (!input || typeof input !== "object" || Array.isArray(input)
        || Object.keys(input).some((field) => ![...SERVICE_FIELDS, "discoveryService",
          "persistenceAuthorityService", "objectHeadService", "environment"].includes(field))
        || SERVICE_FIELDS.some((field) => !Object.prototype.hasOwnProperty.call(input, field))) {
      throw new Error("Pocket Sync browser runtime configuration-invalid.");
    }
    const config = input;
    const environment = browserEnvironment(config.environment);
    requireMethods(config.accountService, ["beginRegistration", "finishRegistration", "beginAuthentication", "finishAuthentication"], "account-service-invalid");
    requireMethods(config.contentService, ["conditionalUpload"], "content-service-invalid");
    requireMethods(config.envelopeService, ["addEnvelope"], "envelope-service-invalid");
    requireMethods(config.recoveryService, ["initialiseRecovery"], "recovery-service-invalid");
    const authorityPair = Number(Object.prototype.hasOwnProperty.call(config, "persistenceAuthorityService"))
      + Number(Object.prototype.hasOwnProperty.call(config, "objectHeadService"));
    if (![0, 2].includes(authorityPair)) throw new Error("Pocket Sync browser runtime configuration-invalid.");
    if (authorityPair === 2) {
      requireMethods(config.persistenceAuthorityService, ["read"], "persistence-authority-service-invalid");
      requireMethods(config.objectHeadService, ["readShadowHead", "getOpaqueObject"], "object-head-service-invalid");
    }
    const security = global.PocketSyncSecurityContract;
    const crypto = global.PocketSyncCrypto;
    const storeApi = global.PocketSyncDeviceStore;
    const accountApi = global.PocketSyncAccountClient;
    const activationApi = global.PocketSyncActivation;
    const additionalApi = global.PocketSyncAdditionalDevice;
    const recoveryApi = global.PocketSyncEmergencyRecovery;
    const ownerApi = global.PocketSyncOwnerController;
    const bridgeApi = global.PocketSyncActivationOwnerBridge;
    const boundary = global.PocketOwnerSaveBoundary;
    requireMethods(security, ["buildRecoveryPackage"], "foundation-unavailable");
    requireMethods(crypto, ["encodeBase64Url", "openMasterKeyBundle", "openContent"], "foundation-unavailable");
    requireMethods(storeApi, ["createIndexedDbDriver", "createStore"], "foundation-unavailable");
    requireMethods(accountApi, ["createClient", "createBrowserWebAuthnAdapter"], "foundation-unavailable");
    requireMethods(activationApi, ["createActivationOrchestrator", "createStrandedActivationClassifier"], "foundation-unavailable");
    requireMethods(recoveryApi, ["createRecoveryOrchestrator"], "foundation-unavailable");
    requireMethods(ownerApi, ["createSyncedOwnerController"], "foundation-unavailable");
    requireMethods(bridgeApi, ["createActivationOwnerBridge"], "foundation-unavailable");
    requireMethods(boundary, ["installSyncedOwnerForSave"], "foundation-unavailable");

    const now = typeof environment.now === "function" ? environment.now : Date.now;
    const deviceStore = storeApi.createStore(storeApi.createIndexedDbDriver(environment.indexedDB || global.indexedDB));
    const accountClient = accountApi.createClient({
      accountService: config.accountService,
      webAuthn: accountApi.createBrowserWebAuthnAdapter(environment),
      now,
    });
    const syncedOwnerController = ownerApi.createSyncedOwnerController({
      crypto,
      deviceStore,
      contentService: config.contentService,
      randomBytes: browserRandom(environment),
    });
    const ownerBridge = bridgeApi.createActivationOwnerBridge({
      syncedOwnerController,
      ownerSaveBoundary: boundary,
    });
    const orchestrator = activationApi.createActivationOrchestrator({
      securityContract: security,
      crypto,
      deviceStore,
      accountClient,
      contentService: config.contentService,
      envelopeService: config.envelopeService,
      recoveryService: config.recoveryService,
      randomBytes: browserRandom(environment),
      now,
    });
    const strandedActivationClassifier = activationApi.createStrandedActivationClassifier({
      securityContract: security,
      crypto,
    });
    const recoveryWebAuthn = accountApi.createBrowserWebAuthnAdapter(environment);
    const recoveryOrchestrator = recoveryApi.createRecoveryOrchestrator({
      securityContract: security,
      crypto,
      deviceStore,
      accountContract: accountApi,
      contentService: config.contentService,
      envelopeService: config.envelopeService,
      recoveryService: config.recoveryService,
      webAuthn: Object.freeze({ createCredential: recoveryWebAuthn.createCredential }),
      randomBytes: browserRandom(environment),
      now,
    });

    function additionalTarget() {
      const session = typeof global.capturePocketFileSaveSession === "function"
        ? global.capturePocketFileSaveSession() : null;
      if (!session || !["none", "detached", "json", "vault"].includes(session.ownerKind)) return null;
      return frozen({ ownerKind: session.ownerKind, continuityId: String(session.id) });
    }

    function additionalTargetCurrent(expected = null) {
      const target = additionalTarget();
      return !!target && (expected === null || (target.ownerKind === expected.ownerKind
        && (target.ownerKind === "none" || [target.continuityId, `${target.ownerKind}:${target.continuityId}`]
          .includes(expected.continuityId))));
    }

    function hasDirtyStandalonePe() {
      try { return global.PocketNodePopoutWindow?.hasUnsavedChanges?.() === true; }
      catch (_error) { return true; }
    }

    function additionalTargetReplaceable(expected = null, discardTarget = null) {
      const target = additionalTarget();
      if (!target || (expected !== null && (target.ownerKind !== expected.ownerKind
          || (target.ownerKind !== "none"
            && ![target.continuityId, `${target.ownerKind}:${target.continuityId}`]
              .includes(expected.continuityId))))) return false;
      if (target.ownerKind === "none") return true;
      if (["json", "vault"].includes(target.ownerKind) && hasDirtyStandalonePe()) return false;
      try {
        if (global.hasUnsavedDetailsEditorChanges?.() === true
            || global.hasUnsavedInlineTitleDraft?.() === true) return false;
      } catch (_error) { return false; }
      if (discardTarget && ["json", "vault"].includes(target.ownerKind)
          && additionalTargetCurrent(discardTarget)) return true;
      try {
        return typeof global.hasPocketUnsavedChanges === "function"
          && global.hasPocketUnsavedChanges() === false;
      } catch (_error) { return false; }
    }

    function recoveryDependencies() {
      return frozen({
        captureRecoveryTarget: additionalTarget,
        isRecoveryTargetCurrent: (expected) => additionalTargetCurrent(expected)
          && additionalTargetReplaceable(expected),
        readRecoveryPackage: recoveryPackagePicker(environment),
        prepareReplacementRecoveryCopyDestination: recoveryPicker(environment),
        buildRecoveryPackage: (input) => buildRecoveryPackage(security, crypto, environment, input),
        writeReplacementRecoveryCopy: writeRecoveryCopy(environment),
        validateRecoveredPayload: (payload) => global.isPocketPayloadShape?.(payload) === true,
      });
    }

    async function adoptRecoveredPocket(result) {
      const found = await deviceStore.readRecoveryAttempt(result.recoveryAttemptId);
      const target = additionalTarget();
      if (!found?.record || !found?.draft || !target
          || found.draft.targetOwnerKind !== target.ownerKind
          || (target.ownerKind !== "none"
            && found.draft.targetContinuityId !== `${target.ownerKind}:${target.continuityId}`)
          || !additionalTargetReplaceable(target)) return safeFailure("recovery-target-stale");
      const bundle = await crypto.openMasterKeyBundle(
        found.record.deviceEnvelope.record,
        found.record.deviceWrappingKey,
        found.record.deviceEnvelope.context,
        []
      );
      if (authorityPair === 2) {
        let authority = null;
        try {
          const operationId = crypto.encodeBase64Url(browserRandom(environment)(32));
          authority = (await config.persistenceAuthorityService.read({ apiVersion: 1,
            operationId, syncedPocketId: found.record.syncedPocketId }))?.authority || null;
        } catch (_error) { return safeFailure("recovery-authority-attention"); }
        if (!authority || authority.currentMode !== "whole-record" || authority.transition !== null
            || authority.rollbackRevision !== null || authority.adoptionHead !== null) {
          return safeFailure("recovery-starling-authority-attention");
        }
      }
      const payload = await crypto.openContent(
        found.record.content.record,
        bundle.masterKey,
        found.record.content.context
      );
      if (global.isPocketPayloadShape?.(payload) !== true
          || typeof global.normaliseInput !== "function"
          || typeof global.commitPreparedPocketDocument !== "function") {
        return safeFailure("recovered-content-invalid");
      }
      const norm = global.normaliseInput(payload);
      // The controller makes the final old-target check before the document
      // commit gives that document a new detached session identity.
      const adopted = await syncedOwnerController.adoptReadyRecovery(result, frozen({
        captureRecoveryTarget: additionalTarget,
        isRecoveryTargetCurrent: (expected) => additionalTargetCurrent(expected)
          && additionalTargetReplaceable(expected),
      }));
      if (!adopted?.ok) return safeFailure(adopted?.reason || "recovery-adoption-failed");
      const committed = global.commitPreparedPocketDocument(norm, {
        schema: norm.schema || "portal.export.v1", fileName: "Synced Pocket",
        writtenAt: norm.writtenAt || "",
      }, { ownerKind: "detached", displayName: "Synced Pocket", forceNewSession: true,
        detachedDeviceChanges: true, storagePrivate: "synced",
        canContinue: () => additionalTargetReplaceable(target) });
      if (!committed?.ok) {
        try { syncedOwnerController.releaseSyncedOwner(); } catch (_error) {}
        return safeFailure("recovery-target-stale");
      }
      if (boundary.installSyncedOwnerForSave(syncedOwnerController) !== true) {
        try { syncedOwnerController.releaseSyncedOwner(); } catch (_error) {}
        return frozen({ ok: false, partialState: "visible-payload-committed-detached" });
      }
      return frozen({ ok: true });
    }

    async function adoptAdditionalDevice(input, discardTarget = null, jsonSafetyToken = null) {
      const captured = additionalTarget();
      if (!captured || typeof global.normaliseInput !== "function"
          || typeof global.commitPreparedPocketDocument !== "function"
          || input?.target?.ownerKind !== captured.ownerKind
          || input.target.continuityId !== `${captured.ownerKind}:${captured.continuityId}`
          || global.isPocketPayloadShape?.(input.payload) !== true) return frozen({ ok: false });
      let eligible;
      try { eligible = await syncedOwnerController.canAdoptSyncedOwner({
        syncedPocketId: input.syncedPocketId, masterKey: input.masterKey,
      }); } catch (_error) { eligible = null; }
      if (!eligible?.ok || boundary.hasSyncedOwner?.() === true) return frozen({ ok: false });
      const norm = global.normaliseInput(input.payload);
      const localRollback = ["json", "vault"].includes(captured.ownerKind)
        && typeof global.capturePocketDocumentStateForAdoption === "function"
        && typeof global.capturePocketFileOwnerForAdoption === "function"
        ? {
          document: global.capturePocketDocumentStateForAdoption(),
          owner: global.capturePocketFileOwnerForAdoption(),
        }
        : null;
      const restoreLocalTarget = () => {
        if (!localRollback) return false;
        try {
          global.restorePocketDocumentStateAfterFailedAdoption?.(localRollback.document);
          global.restorePocketFileOwnerAfterFailedAdoption?.(localRollback.owner);
          global.refreshMeta?.();
          global.renderTree?.();
          global.refocusTreeNavigation?.(global.state?.selectedId || "");
          return true;
        } catch (_error) { return false; }
      };
      const commitOpenedPayload = () => global.commitPreparedPocketDocument(norm, {
        schema: norm.schema || "portal.export.v1", fileName: "Synced Pocket",
        writtenAt: norm.writtenAt || "",
      }, { ownerKind: "detached", displayName: "Synced Pocket", forceNewSession: true,
        detachedDeviceChanges: true, storagePrivate: "synced",
        ...(discardTarget?.ownerKind === "json" ? {
          loadedStateOptions: { skipLocalSafetyCheck: true },
        } : {}),
        canContinue: () => additionalTargetReplaceable(input.target, discardTarget) });
      if (!localRollback) {
        const committed = commitOpenedPayload();
        if (!committed?.ok) {
          if (!additionalTargetCurrent(input.target)) return frozen({ ok: false, reason: "additional-device-target-stale" });
          if (!additionalTargetReplaceable(input.target, discardTarget)) return frozen({ ok: false, reason: "additional-device-target-dirty" });
          return frozen({ ok: false });
        }
        const adopted = await syncedOwnerController.adoptSyncedOwner({
          syncedPocketId: input.syncedPocketId, masterKey: input.masterKey,
        });
        if (!adopted?.ok || boundary.installSyncedOwnerForSave(syncedOwnerController) !== true) {
          try { syncedOwnerController.releaseSyncedOwner(); } catch (_error) {}
          return frozen({ ok: false, partialState: "visible-payload-committed-detached" });
        }
        return frozen({ ok: true });
      }
      const adopted = await syncedOwnerController.adoptSyncedOwner({
        syncedPocketId: input.syncedPocketId, masterKey: input.masterKey,
      });
      if (!adopted?.ok) return frozen({ ok: false });
      const committed = commitOpenedPayload();
      if (!committed?.ok) {
        try { syncedOwnerController.releaseSyncedOwner(); } catch (_error) {}
        if (!additionalTargetCurrent(input.target)) return frozen({ ok: false, reason: "additional-device-target-stale" });
        if (!additionalTargetReplaceable(input.target, discardTarget)) return frozen({ ok: false, reason: "additional-device-target-dirty" });
        return frozen({ ok: false });
      }
      if (boundary.installSyncedOwnerForSave(syncedOwnerController) !== true) {
        try { syncedOwnerController.releaseSyncedOwner(); } catch (_error) {}
        restoreLocalTarget();
        return frozen({ ok: false, partialState: "visible-payload-committed-detached" });
      }
      try { await global.retireJsonSafetyForSyncedDiscard?.(jsonSafetyToken); } catch (_error) {}
      return frozen({ ok: true });
    }

    function dependenciesFor(snapshot) {
      return frozen({
        captureSourceSession: sourceSession,
        isSourceSessionCurrent: sourceSessionCurrent,
        hasUnsavedSourceChanges: sourceIsDirty,
        async saveLocalSource(session) {
          if (!sourceSessionCurrent(session) || typeof global.exportTree !== "function") {
            return frozen({ ok: false });
          }
          const saved = await global.exportTree({ returnDetails: true, downloadFallback: false });
          return saved && saved.ok === true ? frozen({ ok: true }) : frozen({
            ok: false,
            cancelled: saved?.reason === "cancelled",
          });
        },
        freezePayload: freezePocketPayload(snapshot, now),
        prepareRecoveryCopyDestination: recoveryPicker(environment),
        buildRecoveryPackage: (input) => buildRecoveryPackage(security, crypto, environment, input),
        writeRecoveryCopy: writeRecoveryCopy(environment),
        adoptSyncedOwner: ownerBridge.adoptSyncedOwner,
      });
    }

    async function activate() {
      const snapshot = sourceSession();
      if (!snapshot) return safeFailure("unsupported-source-owner");
      const draftResult = prepareEditorDrafts(snapshot);
      if (draftResult) return safeFailure(draftResult);
      const frozenSource = sourceSession();
      if (!frozenSource || frozenSource.ownerKind !== snapshot.ownerKind
          || frozenSource.id !== snapshot.id || frozenSource.vaultSessionId !== snapshot.vaultSessionId) {
        return safeFailure("source-session-changed");
      }
      const random = browserRandom(environment);
      const syncedPocketId = crypto.encodeBase64Url(random(32));
      const deviceId = crypto.encodeBase64Url(random(32));
      return orchestrator.activate(dependenciesFor(frozenSource), { syncedPocketId, deviceId });
    }

    async function resume(input) {
      if (!input || typeof input !== "object" || Array.isArray(input)
          || Object.keys(input).length !== 1 || typeof input.activationId !== "string") {
        return safeFailure("invalid-activation-input");
      }
      const snapshot = sourceSession();
      if (!snapshot) return safeFailure("unsupported-source-owner");
      try {
        if (global.hasPocketUnsavedChanges?.() === true) return safeFailure("source-has-unsaved-changes");
      } catch (_error) {
        return safeFailure("source-has-unsaved-changes");
      }
      return orchestrator.resume(dependenciesFor(snapshot), { activationId: input.activationId });
    }

    async function openExisting(input = {}) {
      if (!additionalApi || typeof additionalApi.createAdditionalDeviceOpener !== "function") {
        return safeFailure("additional-device-unavailable");
      }
      try { requireMethods(config.discoveryService, ["readSyncedPocket"], "discovery-service-invalid"); }
      catch (_error) { return safeFailure("additional-device-unavailable"); }
      if (!input || typeof input !== "object" || Array.isArray(input)
          || Object.keys(input).some((field) => field !== "discardTarget")) {
        return safeFailure("additional-device-target-dirty");
      }
      const requestedDiscard = input.discardTarget || null;
      const discardTarget = requestedDiscard
        && ["json", "vault"].includes(requestedDiscard.ownerKind)
        && typeof requestedDiscard.continuityId === "string"
        && additionalTargetCurrent(requestedDiscard)
        ? frozen({ ownerKind: requestedDiscard.ownerKind, continuityId: requestedDiscard.continuityId })
        : null;
      if (requestedDiscard && !discardTarget) return safeFailure("additional-device-target-dirty");
      if (discardTarget) {
        try {
          if (global.hasPocketUnsavedChanges?.() !== true) return safeFailure("additional-device-target-dirty");
        } catch (_error) { return safeFailure("additional-device-target-dirty"); }
      }
      if (!additionalTargetReplaceable(null, discardTarget)) return safeFailure("additional-device-target-dirty");
      const additionalDevice = additionalApi.createAdditionalDeviceOpener({
        crypto, deviceStore, accountClient,
        strandedActivationClassifier,
        discoveryService: config.discoveryService,
        contentService: config.contentService,
        envelopeService: config.envelopeService,
        ...(authorityPair === 2 ? {
          persistenceAuthorityService: config.persistenceAuthorityService,
          objectHeadService: config.objectHeadService,
        } : {}),
        randomBytes: browserRandom(environment), now,
      });
      const jsonSafetyToken = discardTarget?.ownerKind === "json"
        ? await global.captureJsonSafetyForSyncedDiscard?.() || null
        : null;
      let opened = null;
      try {
        opened = await additionalDevice.openExisting({
          captureTarget: additionalTarget,
          isTargetCurrent: additionalTargetCurrent,
          validatePayload: (payload) => global.isPocketPayloadShape?.(payload) === true,
          adoptOpenedPocket: (opened) => adoptAdditionalDevice(opened, discardTarget, jsonSafetyToken),
        });
        return opened;
      } finally {
        global.releaseJsonSafetyForSyncedDiscard?.(jsonSafetyToken);
      }
    }

    async function recoverExisting() {
      if (!additionalTargetReplaceable()) return safeFailure("recovery-target-dirty");
      const deviceId = crypto.encodeBase64Url(browserRandom(environment)(32));
      const recovered = await recoveryOrchestrator.recover(recoveryDependencies(), { deviceId });
      if (!recovered?.ok || recovered.readyForAdoption !== true) return recovered;
      try { return adoptRecoveredPocket(recovered); }
      catch (_error) { return safeFailure("recovery-adoption-failed"); }
    }

    async function resumeRecovery(input) {
      if (!input || typeof input !== "object" || Array.isArray(input)
          || Object.keys(input).length !== 1 || typeof input.recoveryAttemptId !== "string") {
        return safeFailure("invalid-recovery-input");
      }
      if (!additionalTargetReplaceable()) return safeFailure("recovery-target-dirty");
      const recovered = await recoveryOrchestrator.resume(recoveryDependencies(), {
        recoveryAttemptId: input.recoveryAttemptId,
      });
      if (!recovered?.ok || recovered.readyForAdoption !== true) return recovered;
      try { return adoptRecoveredPocket(recovered); }
      catch (_error) { return safeFailure("recovery-adoption-failed"); }
    }

    async function restartLegacyRecovery(input) {
      if (!input || typeof input !== "object" || Array.isArray(input)
          || Object.keys(input).length !== 1 || typeof input.recoveryAttemptId !== "string") {
        return safeFailure("invalid-recovery-input");
      }
      const target = additionalTarget();
      if (!target || target.ownerKind !== "none" || !additionalTargetReplaceable(target)) {
        return safeFailure("recovery-target-dirty");
      }
      return recoveryOrchestrator.restartLegacyBeginAttention(recoveryDependencies(), {
        recoveryAttemptId: input.recoveryAttemptId,
      });
    }

    async function findRecoveryAttempt() {
      const target = additionalTarget();
      if (!target || !additionalTargetReplaceable(target)) {
        return safeFailure("recovery-discovery-needs-attention");
      }
      try {
        await deviceStore.open();
        const found = await deviceStore.findRecoveryAttempt({
          targetOwnerKind: target.ownerKind,
          targetContinuityId: `${target.ownerKind}:${target.continuityId}`,
        });
        if (found?.state === "none") return frozen({ ok: true });
        if (found?.state === "match" && typeof found.recoveryAttemptId === "string") {
          const attempt = await deviceStore.readRecoveryAttempt(found.recoveryAttemptId);
          const reason = attempt?.draft?.stage === "begin-pending"
            ? BEGIN_ATTENTION_REASONS[attempt.draft.pendingOperation] || null : null;
          if (reason) return frozen({ ok: false, reason, adopted: false,
            sourceOwnerPreserved: true, locallyDurable: true, resumable: false,
            recoveryAttemptId: found.recoveryAttemptId,
            restartable: isLegacyRestartableDraft(attempt.draft, target.ownerKind) });
          if (!attempt?.record || !attempt?.draft) throw new Error("recovery-attempt-missing");
          return frozen({ ok: true, recoveryAttemptId: found.recoveryAttemptId });
        }
      } catch (_error) {}
      return safeFailure("recovery-discovery-needs-attention");
    }

    async function admitAcceptedDeleteRestore(input) {
      const session = global.capturePocketFileSaveSession?.();
      if (!session || session.ownerKind !== "synced"
          || typeof syncedOwnerController.admitAcceptedDeleteRestore !== "function") {
        return frozen({ ok: false, reason: "restore-owner-unavailable" });
      }
      try { return await syncedOwnerController.admitAcceptedDeleteRestore(input); }
      catch (_error) { return frozen({ ok: false, reason: "restore-owner-unavailable" }); }
    }

    return frozen({ activate, resume, openExisting, recoverExisting, resumeRecovery,
      restartLegacyRecovery, findRecoveryAttempt, admitAcceptedDeleteRestore });
  }

  global.PocketSyncBrowserRuntime = frozen({ createRuntime });
})(typeof window !== "undefined" ? window : globalThis);
