/* Dormant browser composition for an explicitly invoked Sync activation. */

(function initialisePocketSyncBrowserRuntime(global) {
  "use strict";

  const SERVICE_FIELDS = Object.freeze([
    "accountService", "contentService", "envelopeService", "recoveryService",
  ]);
  const RECOVERY_FILENAME = "Pocket Recovery Copy.json";

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
    return frozen({
      ownerKind: captured.ownerKind,
      id: captured.id,
      vaultSessionId: typeof captured.vaultSessionId === "string" ? captured.vaultSessionId : "",
    });
  }

  function sourceSessionCurrent(snapshot) {
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
      if (typeof select !== "function") return frozen({ ok: false });
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

  async function writeRecoveryCopy(input) {
    if (!input || !input.destination || !input.recoveryPackage
        || typeof input.destination.createWritable !== "function") return frozen({ ok: false });
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
        || Object.keys(input).some((field) => ![...SERVICE_FIELDS, "environment"].includes(field))
        || SERVICE_FIELDS.some((field) => !Object.prototype.hasOwnProperty.call(input, field))) {
      throw new Error("Pocket Sync browser runtime configuration-invalid.");
    }
    const config = input;
    const environment = browserEnvironment(config.environment);
    requireMethods(config.accountService, ["beginRegistration", "finishRegistration", "beginAuthentication", "finishAuthentication"], "account-service-invalid");
    requireMethods(config.contentService, ["conditionalUpload"], "content-service-invalid");
    requireMethods(config.envelopeService, ["addEnvelope"], "envelope-service-invalid");
    requireMethods(config.recoveryService, ["initialiseRecovery"], "recovery-service-invalid");
    const security = global.PocketSyncSecurityContract;
    const crypto = global.PocketSyncCrypto;
    const storeApi = global.PocketSyncDeviceStore;
    const accountApi = global.PocketSyncAccountClient;
    const activationApi = global.PocketSyncActivation;
    const ownerApi = global.PocketSyncOwnerController;
    const bridgeApi = global.PocketSyncActivationOwnerBridge;
    const boundary = global.PocketOwnerSaveBoundary;
    requireMethods(security, ["buildRecoveryPackage"], "foundation-unavailable");
    requireMethods(crypto, ["encodeBase64Url"], "foundation-unavailable");
    requireMethods(storeApi, ["createIndexedDbDriver", "createStore"], "foundation-unavailable");
    requireMethods(accountApi, ["createClient", "createBrowserWebAuthnAdapter"], "foundation-unavailable");
    requireMethods(activationApi, ["createActivationOrchestrator"], "foundation-unavailable");
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
        writeRecoveryCopy,
        adoptSyncedOwner: ownerBridge.adoptSyncedOwner,
      });
    }

    async function activate() {
      const snapshot = sourceSession();
      if (!snapshot) return safeFailure("unsupported-source-owner");
      const random = browserRandom(environment);
      const syncedPocketId = crypto.encodeBase64Url(random(32));
      const deviceId = crypto.encodeBase64Url(random(32));
      return orchestrator.activate(dependenciesFor(snapshot), { syncedPocketId, deviceId });
    }

    async function resume(input) {
      if (!input || typeof input !== "object" || Array.isArray(input)
          || Object.keys(input).length !== 1 || typeof input.activationId !== "string") {
        return safeFailure("invalid-activation-input");
      }
      const snapshot = sourceSession();
      if (!snapshot) return safeFailure("unsupported-source-owner");
      return orchestrator.resume(dependenciesFor(snapshot), { activationId: input.activationId });
    }

    return frozen({ activate, resume });
  }

  global.PocketSyncBrowserRuntime = frozen({ createRuntime });
})(typeof window !== "undefined" ? window : globalThis);
