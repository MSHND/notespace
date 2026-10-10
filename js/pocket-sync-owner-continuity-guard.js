/* P355c dormant, private Synced-owner continuity foundation.
 *
 * NOT loaded by index.html and NOT an export permission. The only installation
 * entry point executes an injected trusted installation; it cannot accept a
 * caller-supplied witness. Future composition must prove the authenticated
 * ceremony/adoption provenance before enabling this module in production.
 */
(function initialisePocketSyncOwnerContinuityGuard(global) {
  "use strict";

  const SCHEMA = "pocket.sync.owner-session.v1";
  const CONFIG_KEYS = Object.freeze([
    "controller", "boundary", "discoveryService", "remoteContract",
    "nextOperationId", "performTrustedInstallation", "now",
  ]);
  const FAILURE = Object.freeze({ ok: false, reason: "owner-continuity-unavailable" });
  const CURRENT = Object.freeze({ ok: true, reason: "owner-continuity-current" });
  const INSTALLED = Object.freeze({ ok: true, reason: "owner-continuity-bound" });

  function object(value) {
    return value !== null && typeof value === "object" && !Array.isArray(value);
  }

  function validSession(session) {
    return object(session) && object(session.controllerSession)
      && object(session.localSession) && session.ownerKind === "synced"
      && Number.isSafeInteger(session.syncedGeneration)
      && Number.isSafeInteger(session.controllerSession.generation)
      && typeof session.controllerSession.syncedPocketId === "string"
      && session.controllerSession.syncedPocketId.length > 0
      && object(session.controllerSession.token);
  }

  function sameLocal(left, right) {
    if (!object(left) || !object(right)) return false;
    return left.id === right.id && left.ownerKind === right.ownerKind
      && left.handle === right.handle
      && left.storagePrivacy === right.storagePrivacy
      && left.vaultSessionId === right.vaultSessionId
      && left.pipSession === right.pipSession
      && left.detachedDeviceChanges === right.detachedDeviceChanges;
  }

  function sameController(left, right) {
    return !!left && !!right && left.token === right.token
      && left.generation === right.generation
      && left.syncedPocketId === right.syncedPocketId;
  }

  function sameOwner(left, right) {
    return validSession(left) && validSession(right)
      && left.controller === right.controller
      && left.syncedGeneration === right.syncedGeneration
      && sameController(left.controllerSession, right.controllerSession)
      && sameLocal(left.localSession, right.localSession);
  }

  // Private identity comes only from the real account-client result captured by
  // createDormantCompletedDeviceOpener. The original synthetic factory has no
  // ceremony provenance and MUST NOT bind an owner by itself.
  function createGuard(configuration, trustedJourney) {
    if (!object(configuration) || Object.keys(configuration).length !== CONFIG_KEYS.length
        || CONFIG_KEYS.some((key) => !Object.prototype.hasOwnProperty.call(configuration, key))) {
      throw new Error("owner-continuity-configuration-invalid");
    }
    const { controller, boundary, discoveryService, remoteContract,
      nextOperationId, performTrustedInstallation, now } = configuration;
    if (!object(controller)
        || typeof controller.captureSyncedOwnerSaveSession !== "function"
        || typeof controller.isSyncedOwnerSaveSessionCurrent !== "function"
        || !object(boundary) || typeof boundary.captureOwnerSaveSession !== "function"
        || typeof boundary.isOwnerSaveSessionCurrent !== "function"
        || !object(discoveryService) || typeof discoveryService.readSyncedPocket !== "function"
        || !object(remoteContract) || typeof remoteContract.validateReadSyncedPocketResponse !== "function"
        || typeof nextOperationId !== "function"
        || typeof performTrustedInstallation !== "function"
        || typeof now !== "function") {
      throw new Error("owner-continuity-configuration-invalid");
    }

    // No public getter or setter exposes these values. No browser persistence.
    let bound = null;
    let installationInProgress = false;
    let lifetime = 0;

    function readController() {
      try { return controller.captureSyncedOwnerSaveSession(); }
      catch (_error) { return null; }
    }

    function readOwner() {
      try { return boundary.captureOwnerSaveSession(); }
      catch (_error) { return null; }
    }

    function ownerCurrent(snapshot) {
      if (!validSession(snapshot) || snapshot.controller !== controller) return false;
      try {
        return boundary.isOwnerSaveSessionCurrent(snapshot) === true
          && controller.isSyncedOwnerSaveSessionCurrent(snapshot.controllerSession) === true
          && sameOwner(snapshot, readOwner())
          && sameController(snapshot.controllerSession, readController());
      } catch (_error) { return false; }
    }

    function initialCurrent(local, controllerSession) {
      try {
        const currentLocal = readOwner();
        const currentController = readController();
        if (local === null ? currentLocal !== null
          : !object(local) || !object(currentLocal)
            || local.ownerKind !== currentLocal.ownerKind
            || !sameLocal(local.localSession, currentLocal.localSession)
            || (local.ownerKind === "synced" && !sameOwner(local, currentLocal))
            || boundary.isOwnerSaveSessionCurrent(local) !== true) return false;
        return controllerSession === null
          ? currentController === null
          : sameController(controllerSession, currentController)
            && controller.isSyncedOwnerSaveSessionCurrent(controllerSession) === true;
      } catch (_error) { return false; }
    }

    function clock() {
      try {
        const value = now();
        return Number.isFinite(value) ? value : null;
      } catch (_error) { return null; }
    }

    async function serverEvidence() {
      try {
        const operationId = nextOperationId();
        if (typeof operationId !== "string" || !/^[A-Za-z0-9_-]{1,160}$/.test(operationId)) return null;
        const request = Object.freeze({
          apiVersion: 1, operationId, ownerContinuity: SCHEMA,
        });
        const response = await discoveryService.readSyncedPocket(request);
        // Preserve the exact P355b server-client boundary; do not trust ad-hoc fixture shapes.
        const validated = remoteContract.validateReadSyncedPocketResponse(response, request);
        if (!object(validated) || validated.status !== "ready"
            || !object(validated.ownerContinuity)
            || validated.ownerContinuity.schema !== SCHEMA
            || typeof validated.syncedPocketId !== "string"
            || typeof validated.ownerContinuity.accountId !== "string"
            || !/^[0-9a-f]{64}$/.test(validated.ownerContinuity.sessionTag)) return null;
        const until = Date.parse(validated.ownerContinuity.expiresAt);
        const time = clock();
        if (time === null || !Number.isFinite(until) || until <= time) return null;
        return Object.freeze({
          accountId: validated.ownerContinuity.accountId,
          syncedPocketId: validated.syncedPocketId,
          sessionTag: validated.ownerContinuity.sessionTag,
          expiresAt: validated.ownerContinuity.expiresAt,
        });
      } catch (_error) { return null; }
    }

    function sameEvidence(left, right) {
      return !!left && !!right && left.accountId === right.accountId
        && left.syncedPocketId === right.syncedPocketId
        && left.sessionTag === right.sessionTag
        && left.expiresAt === right.expiresAt;
    }

    // ONLY a new owner installation crossing both existing owner boundaries can bind.
    // This cannot retrofit an owner that was already installed before this call.
    async function installWithContinuity() {
      if (installationInProgress) return FAILURE;
      installationInProgress = true;
      lifetime += 1;
      const attempt = lifetime;
      bound = null;
      try {
        const before = readOwner();
        const beforeController = readController();
        if (before !== null && !object(before)) return FAILURE;
        if (beforeController !== null && !object(beforeController)) return FAILURE;
        if (!initialCurrent(before, beforeController)
            || !trustedJourney
            || typeof trustedJourney.accountId !== "string"
            || !/^[A-Za-z0-9_-]{1,160}$/.test(trustedJourney.accountId)
            || typeof trustedJourney.syncedPocketId !== "string"
            || trustedJourney.syncedPocketId.length < 1) return FAILURE;

        const initialEvidence = await serverEvidence();
        if (!initialEvidence || initialEvidence.accountId !== trustedJourney.accountId
            || initialEvidence.syncedPocketId !== trustedJourney.syncedPocketId
            || !initialCurrent(before, beforeController)
            || attempt !== lifetime) return FAILURE;

        // The injected callback must be a trusted composition's actual adoption
        // and save-boundary installation, NEVER an arbitrary witness setter.
        const installed = await performTrustedInstallation();
        if (!(installed === true
            || (object(installed) && Object.keys(installed).length === 1 && installed.ok === true))) {
          return FAILURE;
        }
        const after = readOwner();
        if (!ownerCurrent(after)
            || !sameController(after.controllerSession, readController())
            || (beforeController !== null
              && sameController(beforeController, after.controllerSession))
            || (before !== null
              && sameLocal(before.localSession, after.localSession))
            || after.controllerSession.syncedPocketId !== trustedJourney.syncedPocketId
            || after.controllerSession.syncedPocketId !== initialEvidence.syncedPocketId
            || attempt !== lifetime) return FAILURE;

        // A second fresh, server-authorised read excludes session swaps during adoption.
        const verified = await serverEvidence();
        if (!ownerCurrent(after) || !sameEvidence(initialEvidence, verified)
            || verified?.accountId !== trustedJourney.accountId
            || verified?.syncedPocketId !== trustedJourney.syncedPocketId
            || attempt !== lifetime) return FAILURE;

        bound = Object.freeze({ owner: after, evidence: initialEvidence });
        return INSTALLED;
      } catch (_error) {
        return FAILURE;
      } finally {
        installationInProgress = false;
      }
    }

    // Result is transient information, never a token, consent or export permission.
    async function revalidate() {
      if (installationInProgress || bound === null) return FAILURE;
      const captured = bound;
      const generation = lifetime;
      if (!ownerCurrent(captured.owner)) {
        if (bound === captured) bound = null;
        return FAILURE;
      }
      const until = Date.parse(captured.evidence.expiresAt);
      const time = clock();
      if (time === null || !Number.isFinite(until) || until <= time) {
        if (bound === captured) bound = null;
        return FAILURE;
      }
      const fresh = await serverEvidence();
      if (generation !== lifetime || bound !== captured
          || installationInProgress || !ownerCurrent(captured.owner)
          || !sameEvidence(captured.evidence, fresh)) {
        if (bound === captured) bound = null;
        return FAILURE;
      }
      return CURRENT;
    }

    return Object.freeze({ installWithContinuity, revalidate });
  }

  // Synthetic P355c factory retains its shape but can no longer mint unproven
  // authority: no account ceremony is available to this API.
  function createDormantGuard(configuration) {
    return createGuard(configuration, null);
  }

  const COMPLETED_FACTORY = Object.freeze([
    "additionalDeviceApi", "openerConfiguration", "dependencies",
    "controller", "boundary", "remoteContract", "nextOperationId", "now",
  ]);

  // The retained guard callback must see only a one-use slot. The original
  // completed-Open descriptor (payload + master-key reference) is cleared
  // synchronously when consumed and again when installation settles.
  function ordinaryAdoptionFailure(result) {
    if (!object(result) || result.ok !== false) return FAILURE;
    // Only existing, bounded ordinary failure fields survive; never retain
    // arbitrary adopter output or the decrypted Open argument.
    return Object.freeze({
      ok: false,
      ...(typeof result.reason === "string" && result.reason.length <= 160
        ? { reason: result.reason } : {}),
      ...(result.partialState === "visible-payload-committed-detached"
        ? { partialState: result.partialState } : {}),
    });
  }

  function transientCompletedInstallation(slot, current, isCurrent, adopt, observed, captureInstalled) {
    async function run() {
      const installing = slot.opened;
      slot.opened = null;
      if (!installing || !isCurrent(current)) return FAILURE;
      observed.invoked = true;
      try {
        const result = await adopt(installing);
        observed.settled = true;
        observed.accepted = result === true || (object(result) && result.ok === true);
        if (observed.accepted) {
          observed.owner = captureInstalled(
            observed.beforeOwner, observed.beforeController, observed.syncedPocketId
          );
        } else {
          observed.failure = ordinaryAdoptionFailure(result);
        }
        return result;
      } catch (_error) {
        observed.settled = true;
        observed.failure = FAILURE;
        return FAILURE;
      }
    }
    function release() {
      slot.opened = null;
    }
    return Object.freeze({ run, release });
  }

  // Entirely dormant; production browser-runtime Open never constructs this.
  // An authenticated account is captured only from the trusted account-client
  // completion in the SAME openExisting call, not from an input option/draft.
  function createDormantCompletedDeviceOpener(configuration) {
    if (!object(configuration) || Object.keys(configuration).length !== COMPLETED_FACTORY.length
        || COMPLETED_FACTORY.some((key) => !Object.prototype.hasOwnProperty.call(configuration, key))) {
      throw new Error("completed-device-continuity-configuration-invalid");
    }
    const config = configuration;
    if (!object(config.additionalDeviceApi)
        || typeof config.additionalDeviceApi.createAdditionalDeviceOpener !== "function"
        || !object(config.openerConfiguration)
        || !object(config.openerConfiguration.accountClient)
        || typeof config.openerConfiguration.accountClient.authenticatePasskey !== "function"
        || !object(config.openerConfiguration.discoveryService)
        || typeof config.openerConfiguration.discoveryService.readSyncedPocket !== "function"
        || !object(config.dependencies)
        || Object.keys(config.dependencies).length !== 4
        || ["captureTarget", "isTargetCurrent", "validatePayload", "adoptOpenedPocket"]
          .some((name) => typeof config.dependencies[name] !== "function")) {
      throw new Error("completed-device-continuity-configuration-invalid");
    }

    let journey = null;
    let boundGuard = null;
    const expectedAccountClient = config.openerConfiguration.accountClient;
    const normalDiscovery = config.openerConfiguration.discoveryService;

    const accountClient = Object.freeze({
      async authenticatePasskey(request) {
        const current = journey;
        if (!current || current.closed || current.phase === "invalid"
            || current.phase === "authenticated") {
          throw new Error("completed-device-journey-invalid");
        }
        let authenticated;
        try {
          // The real client validates the WebAuthn/server finish before returning.
          // Do not use its private onAuthenticated consumer here: that consumes
          // PRF bytes needed by the distinct new-device path.
          authenticated = await expectedAccountClient.authenticatePasskey(request);
        } catch (error) {
          current.phase = "invalid";
          throw error;
        }
        if (journey !== current || current.closed
            || !object(authenticated) || authenticated.ok !== true
            || authenticated.accountAuthenticated !== true
            || authenticated.contentUnlocked !== false
            || typeof authenticated.accountId !== "string"
            || !/^[A-Za-z0-9_-]{1,160}$/.test(authenticated.accountId)
            || typeof authenticated.credentialId !== "string"
            || authenticated.credentialId.length < 1
            || typeof authenticated.bootstrap !== "boolean") {
          current.phase = "invalid";
          throw new Error("completed-device-authentication-invalid");
        }
        if (authenticated.bootstrap === true) {
          if (current.phase !== "fresh") {
            current.phase = "invalid";
            throw new Error("completed-device-bootstrap-invalid");
          }
          current.phase = "bootstrap";
          current.bootstrapAccountId = authenticated.accountId;
        } else {
          if (current.phase === "bootstrap"
              && current.bootstrapAccountId !== authenticated.accountId) {
            current.phase = "invalid";
            throw new Error("completed-device-account-mismatch");
          }
          current.accountId = authenticated.accountId;
          current.phase = "authenticated";
        }
        return authenticated;
      },
    });

    const discoveryService = Object.freeze({
      async readSyncedPocket(request) {
        const current = journey;
        if (!current || current.closed || current.phase !== "authenticated"
            || request?.ownerContinuity !== undefined || current.discoveredPocketId !== null) {
          throw new Error("completed-device-discovery-invalid");
        }
        const result = await normalDiscovery.readSyncedPocket(request);
        if (journey !== current || current.closed || current.phase !== "authenticated") {
          throw new Error("completed-device-journey-stale");
        }
        if (result?.ok === true && result.status === "ready"
            && typeof result.syncedPocketId === "string"
            && result.syncedPocketId.length > 0) {
          current.discoveredPocketId = result.syncedPocketId;
        }
        return result;
      },
    });

    const opener = config.additionalDeviceApi.createAdditionalDeviceOpener(
      Object.assign({}, config.openerConfiguration, { accountClient, discoveryService })
    );

    // Defined outside the opened-argument frame: the retained installer cannot
    // reach the completed-Open descriptor through this currentness callback.
    function currentCompletedJourney(value) {
      return journey === value && !value.closed;
    }

    // A separate read-only observation of the SAME existing owner boundaries.
    // Used only to distinguish a completed ordinary installation from a failed
    // optional final witness. Does not create or restore either owner.
    function currentInstalledOwner(snapshot) {
      if (!validSession(snapshot) || snapshot.controller !== config.controller) return false;
      try {
        return config.boundary.isOwnerSaveSessionCurrent(snapshot) === true
          && config.controller.isSyncedOwnerSaveSessionCurrent(snapshot.controllerSession) === true
          && sameOwner(snapshot, config.boundary.captureOwnerSaveSession())
          && sameController(snapshot.controllerSession,
            config.controller.captureSyncedOwnerSaveSession());
      } catch (_error) { return false; }
    }

    function captureNewInstalledOwner(beforeOwner, beforeController, pocketId) {
      let installed;
      try { installed = config.boundary.captureOwnerSaveSession(); }
      catch (_error) { return null; }
      if (!currentInstalledOwner(installed)
          || installed.controllerSession.syncedPocketId !== pocketId
          || (beforeController !== null
            && sameController(beforeController, installed.controllerSession))
          || (beforeOwner !== null
            && sameLocal(beforeOwner.localSession, installed.localSession))) return null;
      return installed;
    }

    async function installCompletedOpenedPocket(opened) {
      const current = journey;
      if (!current || current.closed || current.phase !== "authenticated"
          || typeof opened?.syncedPocketId !== "string"
          || opened.syncedPocketId !== current.discoveredPocketId
          || current.installAttempted) {
        return FAILURE;
      }
      current.installAttempted = true;
      const trusted = Object.freeze({
        accountId: current.accountId,
        syncedPocketId: current.discoveredPocketId,
      });
      let beforeOwner, beforeController;
      try {
        beforeOwner = config.boundary.captureOwnerSaveSession();
        beforeController = config.controller.captureSyncedOwnerSaveSession();
      } catch (_error) { return FAILURE; }
      const observed = {
        invoked: false, settled: false, accepted: false, owner: null, failure: null,
        beforeOwner, beforeController, syncedPocketId: trusted.syncedPocketId,
      };
      const pendingInstallation = transientCompletedInstallation(
        { opened },
        current,
        currentCompletedJourney,
        config.dependencies.adoptOpenedPocket,
        observed,
        captureNewInstalledOwner
      );
      try {
        const guard = createGuard({
          controller: config.controller, boundary: config.boundary,
          discoveryService: normalDiscovery, remoteContract: config.remoteContract,
          nextOperationId: config.nextOperationId, now: config.now,
          performTrustedInstallation: pendingInstallation.run,
        }, trusted);
        const result = await guard.installWithContinuity();
        if (journey !== current || current.closed) return FAILURE;
        if (observed.invoked && observed.settled && observed.accepted
            && observed.owner !== null && currentInstalledOwner(observed.owner)) {
          // Open was genuinely installed. A failed final optional witness must
          // not turn that successful ordinary Open into a reported failure.
          // Only the fully successful guard may retain continuity binding.
          if (result.ok === true) boundGuard = guard;
          return Object.freeze({ ok: true });
        }
        // Preserve genuine ordinary failure details; no fallback, second
        // adoption, or claimed success for a merely detached/controller owner.
        return observed.invoked && observed.settled && !observed.accepted
          ? observed.failure || FAILURE : FAILURE;
      } finally {
        // Also covers rejection before adoption and failures after adoption.
        // The guard retains run(), whose slot is now empty, not opened.
        pendingInstallation.release();
      }
    }

    async function openExisting(options = {}) {
      if (journey !== null) {
        return Object.freeze({ ok: false, reason: "additional-device-open-failed", adopted: false });
      }
      boundGuard = null;
      const current = {
        phase: "fresh", bootstrapAccountId: null,
        accountId: null, discoveredPocketId: null,
        closed: false, installAttempted: false,
      };
      journey = current;
      try {
        // The optional adopter is reached ONLY from openCompletedDevice().
        // The new-device path still uses the original adopter, without binding.
        return await opener.openExisting({
          captureTarget: config.dependencies.captureTarget,
          isTargetCurrent: config.dependencies.isTargetCurrent,
          validatePayload: config.dependencies.validatePayload,
          adoptOpenedPocket: config.dependencies.adoptOpenedPocket,
          adoptCompletedOpenedPocket: installCompletedOpenedPocket,
        }, options);
      } finally {
        current.closed = true;
        current.accountId = null;
        current.bootstrapAccountId = null;
        current.discoveredPocketId = null;
        journey = null;
      }
    }

    async function revalidate() {
      return boundGuard ? boundGuard.revalidate() : FAILURE;
    }

    return Object.freeze({ openExisting, revalidate });
  }

  // Both factories remain unused by all production boot paths.
  global.PocketSyncOwnerContinuityGuard = Object.freeze({
    createDormantGuard, createDormantCompletedDeviceOpener,
  });
})(typeof window !== "undefined" ? window : globalThis);
