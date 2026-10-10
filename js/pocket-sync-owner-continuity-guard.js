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

  function createDormantGuard(configuration) {
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
        if (!initialCurrent(before, beforeController)) return FAILURE;

        const initialEvidence = await serverEvidence();
        if (!initialEvidence || !initialCurrent(before, beforeController)
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
            || after.controllerSession.syncedPocketId !== initialEvidence.syncedPocketId
            || attempt !== lifetime) return FAILURE;

        // A second fresh, server-authorised read excludes session swaps during adoption.
        const verified = await serverEvidence();
        if (!ownerCurrent(after) || !sameEvidence(initialEvidence, verified)
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

  // Dormant: this factory is intentionally NOT loaded or called by production.
  global.PocketSyncOwnerContinuityGuard = Object.freeze({ createDormantGuard });
})(typeof window !== "undefined" ? window : globalThis);
