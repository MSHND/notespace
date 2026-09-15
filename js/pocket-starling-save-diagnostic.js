/* Bounded memory-only observability for one live Synced/Starling Save.

This wrapper is observational only. It never changes Save authority, persistence
ordering, remote writes, retry behaviour, dirty semantics or durable owner-state
shape. It remembers only a fixed safe projection of the latest Save and derives
Starling durable phases from the already-accepted owner-state transitions as
those transitions are sealed and successfully persisted. P206 adds only bounded
substage timing around already-existing steady-Starling operations.
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
  const STAGE_ELAPSED_FIELDS = Object.freeze([
    Object.freeze(["captured", "captured"]),
    Object.freeze(["prepared", "prepared"]),
    Object.freeze(["objects-present", "objectsPresent"]),
    Object.freeze(["cas-ambiguous", "casAmbiguous"]),
    Object.freeze(["conflict", "conflict"]),
    Object.freeze(["remote-proved", "remoteProved"]),
    Object.freeze(["accepted", "accepted"]),
  ]);
  const DETAIL_ELAPSED_FIELDS = Object.freeze([
    "sourceAccepted",
    "prepareSourceAccepted",
    "workingSetPrepared",
    "descriptorPrepared",
    "objectsEnsured",
    "headCommitted",
    "proofOpened",
    "proofMaterialized",
    "proofVerified",
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
  let currentDetailActive = null;

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

  function freshStageElapsedMs() {
    return {
      captured: null,
      prepared: null,
      objectsPresent: null,
      casAmbiguous: null,
      conflict: null,
      remoteProved: null,
      accepted: null,
    };
  }

  function freshDetailElapsedMs() {
    return {
      sourceAccepted: null,
      prepareSourceAccepted: null,
      workingSetPrepared: null,
      descriptorPrepared: null,
      objectsEnsured: null,
      headCommitted: null,
      proofOpened: null,
      proofMaterialized: null,
      proofVerified: null,
    };
  }

  function safeElapsed(value) {
    return Number.isSafeInteger(value) && value >= 0 && value <= MAX_ELAPSED_MS ? value : null;
  }

  function projectedStageElapsedMs(active) {
    const values = active?.stageElapsedMs || {};
    return frozen({
      captured: safeElapsed(values.captured),
      prepared: safeElapsed(values.prepared),
      objectsPresent: safeElapsed(values.objectsPresent),
      casAmbiguous: safeElapsed(values.casAmbiguous),
      conflict: safeElapsed(values.conflict),
      remoteProved: safeElapsed(values.remoteProved),
      accepted: safeElapsed(values.accepted),
    });
  }

  function projectedDetailElapsedMs(active) {
    const values = active?.detailElapsedMs || {};
    return frozen({
      sourceAccepted: safeElapsed(values.sourceAccepted),
      prepareSourceAccepted: safeElapsed(values.prepareSourceAccepted),
      workingSetPrepared: safeElapsed(values.workingSetPrepared),
      descriptorPrepared: safeElapsed(values.descriptorPrepared),
      objectsEnsured: safeElapsed(values.objectsEnsured),
      headCommitted: safeElapsed(values.headCommitted),
      proofOpened: safeElapsed(values.proofOpened),
      proofMaterialized: safeElapsed(values.proofMaterialized),
      proofVerified: safeElapsed(values.proofVerified),
    });
  }

  function recordFirstStageElapsed(active, stage) {
    if (!active?.stageElapsedMs) return;
    const entry = STAGE_ELAPSED_FIELDS.find(([name]) => name === stage);
    if (!entry) return;
    const field = entry[1];
    if (active.stageElapsedMs[field] !== null) return;
    const elapsed = boundedElapsed(active.startedAt);
    const floor = safeElapsed(active.lastStageElapsedMs);
    const value = floor === null ? elapsed : Math.max(floor, elapsed);
    active.stageElapsedMs[field] = value;
    active.lastStageElapsedMs = value;
  }

  function projection(active, outcome, failureCode = null) {
    return frozen({
      outcome: OUTCOMES.includes(outcome) ? outcome : "failed",
      highestStage: STAGES.includes(active?.highestStage) ? active.highestStage : "pre-authority",
      failureCode: outcome === "failed" ? safeFailureCode(failureCode) : null,
      elapsedMs: boundedElapsed(active.startedAt),
      stageElapsedMs: projectedStageElapsedMs(active),
      detailElapsedMs: projectedDetailElapsedMs(active),
    });
  }

  function publish(active, outcome, failureCode = null) {
    if (!active) return;
    latest = projection(active, outcome, failureCode);
  }

  function detailPredecessor(name) {
    const index = DETAIL_ELAPSED_FIELDS.indexOf(name);
    return index > 0 ? DETAIL_ELAPSED_FIELDS[index - 1] : null;
  }

  function recordFirstDetailElapsed(active, name) {
    if (!active || currentDetailActive !== active || !active.detailElapsedMs
        || !DETAIL_ELAPSED_FIELDS.includes(name) || active.detailElapsedMs[name] !== null) return;
    const predecessor = detailPredecessor(name);
    if (predecessor && active.detailElapsedMs[predecessor] === null) return;
    const elapsed = boundedElapsed(active.startedAt);
    const floor = safeElapsed(active.lastDetailElapsedMs);
    const value = floor === null ? elapsed : Math.max(floor, elapsed);
    active.detailElapsedMs[name] = value;
    active.lastDetailElapsedMs = value;
    publish(active, "started");
  }

  function safelyRecordDetail(active, name) {
    try { recordFirstDetailElapsed(active, name); }
    catch (_error) {}
  }

  function reach(active, stage) {
    if (!active || !STAGES.includes(stage)) return;
    recordFirstStageElapsed(active, stage);
    if (stageRank(stage) > stageRank(active.highestStage)) active.highestStage = stage;
    publish(active, "started");
  }

  function sameObservedHead(left, right) {
    return isObject(left) && isObject(right)
      && left.schema === right.schema && left.revision === right.revision && left.sealRef === right.sealRef;
  }

  function installRemoteOpenDetailObserver() {
    const base = global.PocketStarlingRemoteOpenShadow;
    if (!isObject(base) || typeof base.createRemoteOpener !== "function") return;
    try {
      global.PocketStarlingRemoteOpenShadow = frozen({
        ...base,
        createRemoteOpener(...args) {
          const opener = base.createRemoteOpener.apply(base, args);
          if (!isObject(opener) || typeof opener.openRemote !== "function") return opener;
          return frozen({
            ...opener,
            async openRemote(...openArgs) {
              const active = currentDetailActive;
              const result = await opener.openRemote.apply(opener, openArgs);
              try {
                if (!active || result?.outcome !== "opened" || !result.session || active.payload === null) {
                  return result;
                }
                if (active.detailElapsedMs?.headCommitted !== null) {
                  safelyRecordDetail(active, "proofOpened");
                } else if (active.stageElapsedMs?.captured === null) {
                  safelyRecordDetail(active, "sourceAccepted");
                } else if (active.stageElapsedMs?.prepared === null) {
                  safelyRecordDetail(active, "prepareSourceAccepted");
                }
              } catch (_error) {}
              return result;
            },
          });
        },
      });
    } catch (_error) {}
  }

  function installRemoteEditDetailObserver() {
    const base = global.PocketStarlingRemoteEditShadow;
    if (!isObject(base) || typeof base.createEditor !== "function") return;
    try {
      global.PocketStarlingRemoteEditShadow = frozen({
        ...base,
        async createEditor(...args) {
          const editor = await base.createEditor.apply(base, args);
          if (!isObject(editor) || typeof editor.prepareWorkingSet !== "function") return editor;
          return frozen({
            ...editor,
            async prepareWorkingSet(...prepareArgs) {
              const active = currentDetailActive;
              const result = await editor.prepareWorkingSet.apply(editor, prepareArgs);
              try {
                if (active && result?.outcome === "prepared"
                    && active.detailElapsedMs?.prepareSourceAccepted !== null) {
                  safelyRecordDetail(active, "workingSetPrepared");
                }
              } catch (_error) {}
              return result;
            },
          });
        },
      });
    } catch (_error) {}
  }

  function installPublicationDetailObserver() {
    const base = global.PocketStarlingDurablePublication;
    if (!isObject(base) || typeof base.descriptorFromPrepared !== "function"
        || typeof base.createCoordinator !== "function") return;
    try {
      global.PocketStarlingDurablePublication = frozen({
        ...base,
        descriptorFromPrepared(...args) {
          const active = currentDetailActive;
          const descriptor = base.descriptorFromPrepared.apply(base, args);
          try {
            const prepared = args[0];
            if (active && descriptor && prepared?.outcome === "prepared"
                && active.detailElapsedMs?.workingSetPrepared !== null
                && sameObservedHead(descriptor.expectedHead, prepared.expectedHead)) {
              safelyRecordDetail(active, "descriptorPrepared");
            }
          } catch (_error) {}
          return descriptor;
        },
        createCoordinator(...args) {
          const coordinator = base.createCoordinator.apply(base, args);
          if (!isObject(coordinator)) return coordinator;
          const wrapped = { ...coordinator };
          if (typeof coordinator.ensureObjects === "function") {
            wrapped.ensureObjects = async function ensureObjects(...ensureArgs) {
              const active = currentDetailActive;
              const result = await coordinator.ensureObjects.apply(coordinator, ensureArgs);
              try {
                if (active && active.detailElapsedMs?.descriptorPrepared !== null) {
                  safelyRecordDetail(active, "objectsEnsured");
                }
              } catch (_error) {}
              return result;
            };
          }
          if (typeof coordinator.attemptHead === "function") {
            wrapped.attemptHead = async function attemptHead(...headArgs) {
              const active = currentDetailActive;
              const result = await coordinator.attemptHead.apply(coordinator, headArgs);
              try {
                if (active && result?.outcome === "committed"
                    && active.detailElapsedMs?.objectsEnsured !== null) {
                  safelyRecordDetail(active, "headCommitted");
                }
              } catch (_error) {}
              return result;
            };
          }
          return frozen(wrapped);
        },
      });
    } catch (_error) {}
  }

  function installMaterializeDetailObserver() {
    const base = global.PocketStarlingMaterializeShadow;
    if (!isObject(base) || typeof base.materializeAccepted !== "function") return;
    try {
      global.PocketStarlingMaterializeShadow = frozen({
        ...base,
        async materializeAccepted(...args) {
          const active = currentDetailActive;
          const result = await base.materializeAccepted.apply(base, args);
          try {
            if (active && result?.ok === true && result.document
                && active.detailElapsedMs?.proofOpened !== null) {
              safelyRecordDetail(active, "proofMaterialized");
            }
          } catch (_error) {}
          return result;
        },
      });
    } catch (_error) {}
  }

  installRemoteOpenDetailObserver();
  installRemoteEditDetailObserver();
  installPublicationDetailObserver();
  installMaterializeDetailObserver();

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
          if (marker === "accepted") {
            safelyRecordDetail(active, "proofVerified");
            reach(active, "remote-proved");
          }
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
          stageElapsedMs: freshStageElapsedMs(),
          lastStageElapsedMs: null,
          detailElapsedMs: freshDetailElapsedMs(),
          lastDetailElapsedMs: null,
        };
        activeRef.current = active;
        currentDetailActive = active;
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
          if (currentDetailActive === active) currentDetailActive = null;
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
    getLatest() {
      if (!latest) return null;
      return frozen({
        ...latest,
        stageElapsedMs: frozen({ ...latest.stageElapsedMs }),
        detailElapsedMs: frozen({ ...latest.detailElapsedMs }),
      });
    },
  });
})(typeof window !== "undefined" ? window : globalThis);
