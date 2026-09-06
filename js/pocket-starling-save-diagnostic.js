/* Bounded memory-only observability for one live Synced/Starling Save.

This wrapper is observational only. It never changes Save authority, persistence
ordering, remote writes, retry behaviour, dirty semantics or durable owner-state
shape. It remembers only a fixed safe projection of the latest Save and derives
Starling durable phases from the already-accepted owner-state transitions as
those transitions are sealed and successfully persisted.
*/
(function initialisePocketStarlingSaveDiagnostic(global) {
  "use strict";

  const baseOwnerApi = global.PocketSyncOwnerController;
  if (!baseOwnerApi || typeof baseOwnerApi.createSyncedOwnerController !== "function") return;

  const AUTHORITY_STATE_SCHEMA = "pocket.starling.owner-authority-state.v3";
  const OUTCOMES = Object.freeze(["started", "failed", "accepted"]);
  const STAGES = Object.freeze([
    "pre-authority",
    "authority-read",
    "reentry-validated",
    "payload-prepared",
    "captured",
    "prepared",
    "objects-present",
    "cas-ambiguous",
    "conflict",
    "remote-proved",
    "accepted",
  ]);
  const DURABLE_PHASES = Object.freeze([
    "captured", "prepared", "objects-present", "cas-ambiguous", "conflict",
  ]);
  const FAILURE_CODES = Object.freeze([
    "save-failed",
    "save-input-invalid",
    "authority-owner-state-unavailable",
    "authority-state-unavailable",
    "authority-state-invalid",
    "authority-switch-unsettled",
    "authority-transition-conflict",
    "authority-switch-local-confirmation-unsettled",
    "authority-switch-reentry-confirmed",
    "starling-cutover-authority-unavailable",
    "starling-cutover-authority-changed",
    "starling-cutover-bootstrap-failed",
    "starling-cutover-bootstrap-threw",
    "starling-cutover-bootstrap-not-ready",
    "starling-cutover-legacy-migration-unsettled",
    "starling-cutover-preparation-invalid",
    "starling-cutover-adoption-ineligible",
    "starling-reentry-required",
    "starling-save-reentry-confirmed",
    "payload-freeze-failed",
    "starling-save-preparation-invalid",
    "starling-save-local-confirmation-unsettled",
    "starling-save-unsettled",
  ]);
  const REENTRY_REACHED_REASONS = Object.freeze(new Set([
    "payload-freeze-failed",
    "starling-save-preparation-invalid",
    "starling-save-local-confirmation-unsettled",
    "starling-save-unsettled",
    "starling-save-reentry-confirmed",
  ]));
  const MAX_ELAPSED_MS = 24 * 60 * 60 * 1000;

  let latest = null;
  let serial = 0;

  function isObject(value) {
    return !!value && typeof value === "object" && !Array.isArray(value);
  }

  function frozen(value) {
    return Object.freeze(value);
  }

  function monotonicNow() {
    try {
      const value = global.performance?.now?.();
      if (Number.isFinite(value) && value >= 0) return value;
    } catch (_error) {}
    const value = Date.now();
    return Number.isFinite(value) && value >= 0 ? value : 0;
  }

  function boundedElapsed(startedAt) {
    const elapsed = monotonicNow() - startedAt;
    if (!Number.isFinite(elapsed) || elapsed <= 0) return 0;
    return Math.min(MAX_ELAPSED_MS, Math.round(elapsed));
  }

  function stageRank(stage) {
    return STAGES.indexOf(stage);
  }

  function safeFailureCode(reason) {
    return typeof reason === "string" && FAILURE_CODES.includes(reason) ? reason : "save-failed";
  }

  function projection(active, outcome, failureCode = null) {
    return frozen({
      outcome: OUTCOMES.includes(outcome) ? outcome : "failed",
      highestStage: STAGES.includes(active?.highestStage) ? active.highestStage : "pre-authority",
      failureCode: outcome === "failed" ? safeFailureCode(failureCode) : null,
      elapsedMs: outcome === "started" ? boundedElapsed(active.startedAt) : boundedElapsed(active.startedAt),
    });
  }

  function publish(active, outcome, failureCode = null) {
    if (!active) return;
    latest = projection(active, outcome, failureCode);
  }

  function reach(active, stage) {
    if (!active || !STAGES.includes(stage)) return;
    if (stageRank(stage) > stageRank(active.highestStage)) active.highestStage = stage;
    publish(active, "started");
  }

  function currentPreparationExists(active) {
    if (!active?.payload) return false;
    const resolver = global.currentPocketStarlingOwnerSavePreparation;
    if (typeof resolver !== "function") return false;
    try {
      const value = resolver(active.payload);
      return isObject(value) && Number.isSafeInteger(value.ceiling) && value.ceiling >= 1
        && Array.isArray(value.operations) && isObject(value.preservationProjection);
    } catch (_error) { return false; }
  }

  function durableMarker(active, value) {
    if (!active || !isObject(value) || value.schema !== AUTHORITY_STATE_SCHEMA) return null;
    const witness = value.saveWitness;
    if (isObject(witness) && DURABLE_PHASES.includes(witness.phase)) return witness.phase;
    if (witness === null && value.authority?.currentMode === "starling"
        && stageRank(active.highestStage) >= stageRank("cas-ambiguous")) {
      return "accepted";
    }
    return null;
  }

  function diagnosticConfiguration(configuration, activeRef) {
    if (!isObject(configuration)) return configuration;
    const crypto = configuration.crypto;
    const ownerStateStore = isObject(configuration.starlingSuccessor?.ownerStateStore)
      ? configuration.starlingSuccessor.ownerStateStore
      : global.PocketStarlingOwnerState;
    if (!isObject(crypto) || typeof crypto.sealContent !== "function"
        || !isObject(ownerStateStore)
        || ["open", "read", "write"].some((name) => typeof ownerStateStore[name] !== "function")) {
      return configuration;
    }

    const wrappedCrypto = frozen({
      ...crypto,
      async sealContent(...args) {
        const active = activeRef.current;
        const marker = durableMarker(active, args[0]);
        if (active && marker) {
          if (marker === "accepted") reach(active, "remote-proved");
          active.pendingPersistStage = marker;
        }
        try { return await crypto.sealContent(...args); }
        catch (error) {
          if (active && active.pendingPersistStage === marker) active.pendingPersistStage = null;
          throw error;
        }
      },
    });

    const wrappedOwnerStateStore = frozen({
      async open(...args) { return ownerStateStore.open(...args); },
      async read(...args) { return ownerStateStore.read(...args); },
      async write(...args) {
        const active = activeRef.current;
        const marker = active?.pendingPersistStage || null;
        try {
          const result = await ownerStateStore.write(...args);
          if (active && marker && active.pendingPersistStage === marker) {
            active.pendingPersistStage = null;
            reach(active, marker === "accepted" ? "accepted" : marker);
          }
          return result;
        } catch (error) {
          if (active && active.pendingPersistStage === marker) active.pendingPersistStage = null;
          throw error;
        }
      },
    });

    return {
      ...configuration,
      crypto: wrappedCrypto,
      starlingSuccessor: { ownerStateStore: wrappedOwnerStateStore },
    };
  }

  function finaliseInferredStage(active, result) {
    if (!active) return;
    const reason = typeof result?.reason === "string" ? result.reason : "";
    if (result?.ok === true) {
      if (stageRank(active.highestStage) < stageRank("authority-read")) reach(active, "authority-read");
      return;
    }
    if (reason === "starling-cutover-authority-unavailable") return;
    if (stageRank(active.highestStage) < stageRank("authority-read")) reach(active, "authority-read");
    if (REENTRY_REACHED_REASONS.has(reason)
        && stageRank(active.highestStage) < stageRank("reentry-validated")) {
      reach(active, "reentry-validated");
    }
    if (["starling-save-preparation-invalid", "starling-save-local-confirmation-unsettled",
      "starling-save-unsettled"].includes(reason)
        && currentPreparationExists(active)
        && stageRank(active.highestStage) < stageRank("payload-prepared")) {
      reach(active, "payload-prepared");
    }
  }

  function wrapController(controller, activeRef) {
    if (!controller || typeof controller.saveSyncedOwner !== "function") return controller;
    return frozen({
      ...controller,
      async saveSyncedOwner(input) {
        const active = {
          token: ++serial,
          startedAt: monotonicNow(),
          highestStage: "pre-authority",
          payload: null,
          pendingPersistStage: null,
        };
        activeRef.current = active;
        publish(active, "started");
        const wrappedInput = input && typeof input.freezePayload === "function"
          ? {
            ...input,
            async freezePayload() {
              const payload = await input.freezePayload();
              active.payload = payload && typeof payload === "object" ? payload : null;
              return payload;
            },
          }
          : input;
        try {
          const result = await controller.saveSyncedOwner(wrappedInput);
          finaliseInferredStage(active, result);
          publish(active, result?.ok === true ? "accepted" : "failed", result?.reason);
          return result;
        } catch (error) {
          finaliseInferredStage(active, { ok: false, reason: "save-failed" });
          publish(active, "failed", "save-failed");
          throw error;
        } finally {
          active.payload = null;
          active.pendingPersistStage = null;
          if (activeRef.current === active) activeRef.current = null;
        }
      },
    });
  }

  global.PocketSyncOwnerController = frozen({
    ...baseOwnerApi,
    createSyncedOwnerController(configuration) {
      const activeRef = { current: null };
      const controller = baseOwnerApi.createSyncedOwnerController(
        diagnosticConfiguration(configuration, activeRef)
      );
      return wrapController(controller, activeRef);
    },
  });

  global.PocketStarlingSaveDiagnostic = frozen({
    getLatest() { return latest ? frozen({ ...latest }) : null; },
  });
})(typeof window !== "undefined" ? window : globalThis);
