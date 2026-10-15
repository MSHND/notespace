/* Same-origin Sync composition. Local HTTPS and production bootstraps load this module. */

(function initialisePocketSyncLocalIntegration(global) {
  "use strict";

  const OPEN_DIAGNOSTIC_STAGE = "account-passkey-authentication-completion";
  const OPEN_DIAGNOSTIC_CODES = Object.freeze([
    "account-authentication-failed",
    "account-service-failed",
    "account-service-invalid",
    "authentication-options-invalid",
    "authentication-request-invalid",
    "passkey-api-unavailable",
    "passkey-authentication-cancelled",
    "passkey-authentication-response-invalid",
    "passkey-ceremony-expired",
    "passkey-ceremony-mismatch",
    "passkey-not-supported",
    "passkey-security-failed",
    "prf-output-invalid",
  ]);

  const OPEN_AUTHENTICATION_REQUEST_FIELDS = Object.freeze([
    "browserGetStarted", "parserPath", "challengeBytes", "rpId", "allowCredentialCount",
    "allowCredentialIdBytes", "transports", "userVerification", "prfInputBytes",
  ]);
  const OPEN_AUTHENTICATION_REQUEST_TRANSPORTS = Object.freeze([
    "usb", "nfc", "ble", "smart-card", "hybrid", "internal",
  ]);

  function frozen(value) {
    return Object.freeze(value);
  }

  function safeFailure(reason) {
    return frozen({ ok: false, reason });
  }

  function projectAuthenticationRequestDiagnostic(value) {
    if (!value || typeof value !== "object" || Array.isArray(value)
        || Object.keys(value).length !== OPEN_AUTHENTICATION_REQUEST_FIELDS.length
        || OPEN_AUTHENTICATION_REQUEST_FIELDS.some((field) => !Object.prototype.hasOwnProperty.call(value, field))
        || value.browserGetStarted !== true
        || !["native", "fallback"].includes(value.parserPath)
        || !Number.isSafeInteger(value.challengeBytes) || value.challengeBytes < 32 || value.challengeBytes > 65536
        || typeof value.rpId !== "string" || value.rpId.length < 1 || value.rpId.length > 160 || value.rpId !== value.rpId.trim()
        || !Number.isSafeInteger(value.allowCredentialCount) || value.allowCredentialCount < 0 || value.allowCredentialCount > 64
        || value.userVerification !== "required"
        || ![null, 32].includes(value.prfInputBytes)) return null;
    let allowCredentialIdBytes = null;
    let transports = null;
    if (value.allowCredentialCount === 1) {
      if (!Number.isSafeInteger(value.allowCredentialIdBytes)
          || value.allowCredentialIdBytes < 1 || value.allowCredentialIdBytes > 4096) return null;
      allowCredentialIdBytes = value.allowCredentialIdBytes;
      if (value.transports !== null) {
        if (!Array.isArray(value.transports)
            || value.transports.length > OPEN_AUTHENTICATION_REQUEST_TRANSPORTS.length
            || value.transports.some((transport) => !OPEN_AUTHENTICATION_REQUEST_TRANSPORTS.includes(transport))) return null;
        transports = frozen(value.transports.slice());
      }
    } else if (value.allowCredentialIdBytes !== null || value.transports !== null) {
      return null;
    }
    return frozen({
      browserGetStarted: true,
      parserPath: value.parserPath,
      challengeBytes: value.challengeBytes,
      rpId: value.rpId,
      allowCredentialCount: value.allowCredentialCount,
      allowCredentialIdBytes,
      transports,
      userVerification: "required",
      prfInputBytes: value.prfInputBytes,
    });
  }

  function projectOpenDiagnostic(result) {
    const projection = { ok: result?.ok === true };
    if (typeof result?.reason === "string") projection.reason = result.reason;
    if (typeof result?.adopted === "boolean") projection.adopted = result.adopted;
    if (typeof result?.sourceOwnerPreserved === "boolean") {
      projection.sourceOwnerPreserved = result.sourceOwnerPreserved;
    }
    if (result?.reason === "synced-pocket-not-configured"
        && typeof result?.authenticatedAccountSuffix === "string"
        && /^[A-Za-z0-9_-]{5}$/.test(result.authenticatedAccountSuffix)) {
      projection.authenticatedAccountSuffix = result.authenticatedAccountSuffix;
    }
    const acceptedStage = result?.failureStage === OPEN_DIAGNOSTIC_STAGE;
    const acceptedCode = OPEN_DIAGNOSTIC_CODES.includes(result?.failureCode);
    if (acceptedStage) projection.failureStage = OPEN_DIAGNOSTIC_STAGE;
    if (acceptedCode) projection.failureCode = result.failureCode;
    if (acceptedStage && acceptedCode) {
      const authenticationRequest = projectAuthenticationRequestDiagnostic(result?.authenticationRequest);
      if (authenticationRequest) projection.authenticationRequest = authenticationRequest;
    }
    return frozen(projection);
  }

  function currentServiceRoot() {
    const script = global.document?.currentScript;
    const root = script?.dataset?.serviceRoot;
    if (typeof root !== "string" || !root.startsWith("/") || root.startsWith("//")
        || root.includes("\\") || root.includes("?") || root.includes("#")) return null;
    return root;
  }

  const configuredServiceRoot = currentServiceRoot();

  function operationId() {
    const crypto = global.crypto;
    const encoder = global.PocketSyncCrypto?.encodeBase64Url;
    if (!crypto || typeof crypto.getRandomValues !== "function" || typeof encoder !== "function") return null;
    try { return encoder(crypto.getRandomValues(new Uint8Array(32))); }
    catch (_error) { return null; }
  }

  function currentPayload() {
    if (typeof global.buildPocketPayload !== "function") return null;
    try { return global.buildPocketPayload(new Date(0).toISOString()); }
    catch (_error) { return null; }
  }

  function recordFingerprint(value) {
    const fingerprint = global.PocketDeviceChanges?.fingerprintDocument;
    if (typeof fingerprint !== "function") return "";
    try { return fingerprint(value); }
    catch (_error) { return ""; }
  }

  function validSyncedPocketId(value) {
    return typeof value === "string" && value.length > 0 && value === value.trim();
  }

  function create(options) {
    if (options !== undefined && (!options || typeof options !== "object"
        || Array.isArray(options) || Object.keys(options).length !== 1
        || options.progressivePreview !== true)) {
      throw new Error("Pocket Sync local preview composition option invalid.");
    }
    const previewRequested = options?.progressivePreview === true;
    let previewHost = null;
    let previewHostRegistered = false;

    function registerIncomingPreviewHost(host) {
      if (!previewRequested || previewHostRegistered || !host
          || typeof host !== "object" || Array.isArray(host)
          || typeof host.begin !== "function"
          || typeof host.reveal !== "function"
          || typeof host.clear !== "function"
          || !host.mount || typeof host.mount.appendChild !== "function"
          || typeof host.mount.removeChild !== "function"
          || typeof host.mount.ownerDocument?.createElement !== "function") return false;
      previewHostRegistered = true;
      previewHost = host;
      return true;
    }

    function createPrivatePreviewObserver({ isAttemptCurrent } = {}) {
      // P379 invokes this only for an accepted Open, before authentication.
      // The UI host was registered after this runtime was created.
      const knowledgeFactory = global.PocketProgressiveOpenConnection?.createSession;
      const bridgeFactory = global.PocketProgressiveOpenPresentationConnection?.createBridge;
      const presenterFactory = global.createProgressiveMainPresentation;
      if (!previewHost || typeof isAttemptCurrent !== "function"
          || typeof knowledgeFactory !== "function"
          || typeof bridgeFactory !== "function"
          || typeof presenterFactory !== "function") {
        throw new Error("Pocket Sync incoming preview unavailable.");
      }
      const host = previewHost;
      const knowledgeSession = knowledgeFactory({ isAttemptCurrent });
      let bridge = null;
      let generation = null;
      let retired = false;
      const current = () => {
        try { return !retired && isAttemptCurrent() === true; }
        catch (_error) { return false; }
      };
      function clearOwned() {
        if (bridge) {
          try { bridge.dispose(); } catch (_error) {}
          bridge = null;
        }
        const owned = generation;
        generation = null;
        if (owned !== null) {
          try { host.clear(owned); } catch (_error) {}
        }
      }
      return frozen({
        async onScopedStarlingReader(reader, source, isCurrent) {
          if (!current()) throw new Error("Pocket Sync incoming preview attempt stale.");
          // A second P375 selection, including SAME Seal, must retire the
          // first visual generation before P376 replaces reached knowledge.
          clearOwned();
          const owned = host.begin();
          if (!owned || typeof owned !== "object") {
            throw new Error("Pocket Sync incoming preview host invalid.");
          }
          generation = owned;
          await knowledgeSession.onScopedStarlingReader(reader, source, isCurrent);
          if (!current() || generation !== owned) {
            throw new Error("Pocket Sync incoming preview attempt stale.");
          }
          const selected = knowledgeSession.currentSource();
          const root = knowledgeSession.inspect("root");
          if (!selected || !root || root.scope !== "incomplete"
              || root.childrenState !== "ready" || root.reached !== true
              || root.acceptedSealRef !== selected.acceptedSealRef) {
            throw new Error("Pocket Sync incoming preview root invalid.");
          }
          bridge = bridgeFactory({
            knowledgeSession, mount: host.mount, createPresentation: presenterFactory,
            isAttemptCurrent,
          });
          const attached = bridge.attachCurrent();
          if (!attached || attached.ok !== true
              || attached.scope !== "incomplete" || !current()
              || generation !== owned || knowledgeSession.currentSource() !== selected
              || host.reveal(owned) !== true) {
            throw new Error("Pocket Sync incoming preview projection failed.");
          }
        },
        retire() {
          if (retired) return false;
          retired = true;
          clearOwned(); // Token-owned cleanup works AFTER P379 retires its lease.
          knowledgeSession.retire();
          return true;
        },
      });
    }

    const serviceRoot = configuredServiceRoot;
    const remote = global.PocketSyncRemoteClient;
    const browser = global.PocketSyncBrowserRuntime;
    if (!serviceRoot || !remote || !browser
        || typeof remote.createBrowserJsonTransport !== "function"
      || typeof remote.createAccountService !== "function"
        || typeof remote.createContentService !== "function"
        || typeof remote.createEnvelopeService !== "function"
        || typeof remote.createRecoveryService !== "function"
        || typeof browser.createRuntime !== "function") {
      throw new Error("Pocket Sync local integration foundation unavailable.");
    }
    const transport = remote.createBrowserJsonTransport({ serviceRoot });
    const contentService = remote.createContentService({ transport });
    const authorityServices = typeof remote.createPersistenceAuthorityService === "function"
      && typeof remote.createObjectHeadService === "function"
      ? { persistenceAuthorityService: remote.createPersistenceAuthorityService({ transport }),
        objectHeadService: remote.createObjectHeadService({ transport }) }
      : {};
    const runtime = browser.createRuntime({
      accountService: remote.createAccountService({ transport }),
      ...(typeof remote.createPocketDiscoveryService === "function"
        ? { discoveryService: remote.createPocketDiscoveryService({ transport }) } : {}),
      contentService,
      ...authorityServices,
      envelopeService: remote.createEnvelopeService({ transport }),
      recoveryService: remote.createRecoveryService({ transport }),
      ...(previewRequested
        ? { progressiveOpenObserverFactory: createPrivatePreviewObserver }
        : {}),
    });
    if (!runtime
        || typeof runtime.startOwnerlessFirstCreate !== "function"
        || typeof runtime.continueOwnerlessFirstCreate !== "function") {
      throw new Error("Pocket Sync ownerless local integration foundation unavailable.");
    }
    let syncedPocketId = null;
    let latestOpenDiagnostic = null;

    function remember(result) {
      if (result?.ok === true && result.owner?.ownerKind === "synced"
          && typeof result.owner.syncedPocketId === "string") {
        syncedPocketId = result.owner.syncedPocketId;
      } else if (result?.ok === true
          && result.reason === "ownerless-activated"
          && result.stage === "adopted"
          && result.adopted === true
          && validSyncedPocketId(result.syncedPocketId)) {
        syncedPocketId = result.syncedPocketId;
      }
      return result;
    }

    async function startOwnerlessFirstCreate(input) {
      try { return remember(await runtime.startOwnerlessFirstCreate(input)); }
      catch (_error) { return safeFailure("ownerless-first-create-unavailable"); }
    }

    async function continueOwnerlessFirstCreate(input) {
      try { return remember(await runtime.continueOwnerlessFirstCreate(input)); }
      catch (_error) { return safeFailure("ownerless-first-create-unavailable"); }
    }

    async function activate() {
      try { return remember(await runtime.activate()); }
      catch (_error) { return safeFailure("activation-unavailable"); }
    }

    async function resume(input) {
      try { return remember(await runtime.resume(input)); }
      catch (_error) { return safeFailure("activation-unavailable"); }
    }

    async function openExisting(input) {
      let result;
      try { result = remember(await runtime.openExisting(input)); }
      catch (_error) { result = safeFailure("additional-device-unavailable"); }
      latestOpenDiagnostic = projectOpenDiagnostic(result);
      return result;
    }

    function getLatestOpenDiagnostic() {
      return latestOpenDiagnostic ? projectOpenDiagnostic(latestOpenDiagnostic) : null;
    }

    function captureSwitchTarget() {
      try { return global.PocketSyncedSwitchGate?.capture?.() || null; }
      catch (_error) { return null; }
    }

    async function saveSwitchTarget(target) {
      try { return await global.PocketSyncedSwitchGate?.save?.(target) || safeFailure("save-unavailable"); }
      catch (_error) { return safeFailure("save-failed"); }
    }

    function discardSwitchTarget(target) {
      try { return global.PocketSyncedSwitchGate?.discardPermit?.(target) || null; }
      catch (_error) { return null; }
    }

    async function recoverExisting() {
      try { return remember(await runtime.recoverExisting()); }
      catch (_error) { return safeFailure("recovery-unavailable"); }
    }

    async function resumeRecovery(input) {
      try { return remember(await runtime.resumeRecovery(input)); }
      catch (_error) { return safeFailure("recovery-unavailable"); }
    }

    async function findRecoveryAttempt() {
      try { return await runtime.findRecoveryAttempt(); }
      catch (_error) { return safeFailure("recovery-discovery-needs-attention"); }
    }

    async function admitAcceptedDeleteRestore(input) {
      try {
        return typeof runtime.admitAcceptedDeleteRestore === "function"
          ? await runtime.admitAcceptedDeleteRestore(input)
          : safeFailure("restore-owner-unavailable");
      } catch (_error) { return safeFailure("restore-owner-unavailable"); }
    }

    async function verifyRoundTrip() {
      if (!syncedPocketId) return safeFailure("sync-not-activated");
      try {
        if (global.hasPocketUnsavedChanges?.() === true) return safeFailure("source-has-unsaved-changes");
        const store = global.PocketSyncDeviceStore;
        const crypto = global.PocketSyncCrypto;
        if (!store || !crypto || typeof store.open !== "function" || typeof store.readStoredRecord !== "function"
            || typeof crypto.openMasterKeyBundle !== "function" || typeof crypto.openContent !== "function") {
          return safeFailure("round-trip-unavailable");
        }
        if (authorityServices.persistenceAuthorityService) {
          const authorityOperation = operationId();
          if (!authorityOperation) return safeFailure("round-trip-unavailable");
          const authority = await authorityServices.persistenceAuthorityService.read({
            apiVersion: 1, operationId: authorityOperation, syncedPocketId,
          });
          if (authority?.authority?.currentMode === "starling") {
            return safeFailure("round-trip-starling-authority");
          }
          if (authority?.authority?.currentMode !== "whole-record"
              || authority.authority.transition !== null) return safeFailure("round-trip-not-ready");
        }
        const savedPayload = currentPayload();
        const savedFingerprint = recordFingerprint(savedPayload);
        if (!savedPayload || !savedFingerprint) return safeFailure("round-trip-unavailable");
        await store.open();
        const localRecord = await store.readStoredRecord(syncedPocketId);
        if (!localRecord || localRecord.remote?.pending !== null || localRecord.remote?.conflict !== null) {
          return safeFailure("round-trip-not-ready");
        }
        const revisionOperation = operationId();
        if (!revisionOperation) return safeFailure("round-trip-unavailable");
        const revision = await contentService.readRevision({
          apiVersion: 1, operationId: revisionOperation, syncedPocketId,
        });
        if (!revision || revision.recordPresent !== true || !Number.isSafeInteger(revision.revision)
            || revision.revision < 1) return safeFailure("round-trip-not-ready");
        const downloadOperation = operationId();
        if (!downloadOperation) return safeFailure("round-trip-unavailable");
        const remote = await contentService.downloadEncryptedRecord({
          apiVersion: 1, operationId: downloadOperation, syncedPocketId, revision: revision.revision,
        });
        const bundle = await crypto.openMasterKeyBundle(
          localRecord.deviceEnvelope.record,
          localRecord.deviceWrappingKey,
          localRecord.deviceEnvelope.context
        );
        let decrypted = null;
        try {
          decrypted = await crypto.openContent(remote.encryptedRecord, bundle.masterKey, {
            syncedPocketId,
            revision: revision.revision,
            contentType: crypto.FORMAT.contentType,
          });
          if (recordFingerprint(decrypted) !== savedFingerprint) return safeFailure("round-trip-mismatch");
          return frozen({ ok: true, revision: revision.revision, matchesCurrentSavedPocket: true });
        } finally {
          decrypted = null;
        }
      } catch (_error) {
        return safeFailure("round-trip-unavailable");
      }
    }

    const integration = frozen({
      activate, resume, openExisting, getLatestOpenDiagnostic,
      captureSwitchTarget, saveSwitchTarget, discardSwitchTarget,
      recoverExisting, resumeRecovery, findRecoveryAttempt, verifyRoundTrip, admitAcceptedDeleteRestore,
      startOwnerlessFirstCreate, continueOwnerlessFirstCreate,
      ...(previewRequested ? { registerIncomingPreviewHost } : {}),
    });
    global.PocketSyncActiveIntegration = integration;
    try { global.PocketSyncUi?.install?.(integration); } catch (_error) {}
    return integration;
  }

  const integrationApi = frozen({ create });
  global.PocketSyncBrowserIntegration = integrationApi;
  global.PocketSyncLocalIntegration = integrationApi;
})(typeof window !== "undefined" ? window : globalThis);
