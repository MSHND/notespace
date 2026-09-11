from pathlib import Path


def replace(path, old, new, count=1):
    p = Path(path)
    text = p.read_text()
    actual = text.count(old)
    if actual != count:
        raise SystemExit(f"{path}: expected {count} anchor(s), found {actual}: {old[:100]!r}")
    p.write_text(text.replace(old, new, count))


owner = "js/pocket-starling-owner-successor.js"
replace(owner,
'''      const committed = await completeAuthoritativeSave(local, canonical.bytes, { casAttempted: false });
      return committed ? Object.freeze({ ok: true }) : failure("starling-save-unsettled");
    }

    async function dispatchAuthoritySave(input) {''',
'''      const committed = await completeAuthoritativeSave(local, canonical.bytes, { casAttempted: false });
      if (committed) return Object.freeze({ ok: true });
      const after = await loadDurableState();
      const conflicted = after?.schema === AUTHORITY_STATE_SCHEMA ? after.saveWitness : null;
      if (conflicted && conflicted.phase === "conflict" && conflicted.casMayHaveRun === true
          && conflicted.ceiling === witness.ceiling
          && conflicted.authorityRevision === witness.authorityRevision
          && sameHead(conflicted.expectedHead, witness.expectedHead)
          && conflicted.targetFingerprint === witness.targetFingerprint) {
        return Object.freeze({ ok: false, reason: "starling-save-head-conflict",
          rebaseCeiling: witness.ceiling });
      }
      return failure("starling-save-unsettled");
    }

    function starlingPayload(document) {
      if (!isObject(document) || typeof document.schema !== "string" || !document.schema
          || typeof document.writtenAt !== "string" || !document.writtenAt
          || !Array.isArray(document.nodes) || !Array.isArray(document.tombstones)
          || !isObject(document.rootExtras) || !isObject(document.dataExtras)) return null;
      let nodes; let tombstones; let rootExtras; let dataExtras;
      try {
        nodes = clone(document.nodes);
        tombstones = clone(document.tombstones);
        rootExtras = clone(document.rootExtras);
        dataExtras = clone(document.dataExtras);
      } catch (_error) { return null; }
      if (!nodes || !tombstones || !rootExtras || !dataExtras) return null;
      return freeze({
        ...rootExtras,
        schema: "portal.export.v1",
        exportedAt: document.writtenAt,
        writtenAt: document.writtenAt,
        mainThoughtTree: nodes,
        mainThoughtTreeTombstones: tombstones,
        data: { ...dataExtras, mainThoughtTree: nodes, mainThoughtTreeTombstones: tombstones },
      });
    }

    async function materializeMergedPayload(opened) {
      const materialize = global.PocketStarlingMaterializeShadow;
      if (!opened || opened.outcome !== "opened" || !opened.session || !safeHead(opened.head)
          || !materialize || typeof materialize.materializeAccepted !== "function") return null;
      try {
        const result = await materialize.materializeAccepted(opened.session);
        return result?.ok === true ? starlingPayload(result.document) : null;
      } catch (_error) { return null; }
    }

    function sameAuthorityLineage(left, right) {
      return !!left && !!right && starlingSteady(left) && starlingSteady(right)
        && left.authorityRevision === right.authorityRevision
        && left.rollbackRevision === right.rollbackRevision
        && sameHead(left.adoptionHead, right.adoptionHead);
    }

    async function acceptConcurrentRebase(durable, witness, authority, expectedHead, descriptor,
      remoteCommitted) {
      const current = currentPrivate();
      if (!current || !descriptor) return failure("starling-rebase-unsettled");
      const candidateHead = safeHead({ schema: HEAD_SCHEMA, revision: expectedHead.revision + 1,
        sealRef: descriptor.candidateSealStorageRef });
      if (!candidateHead) return failure("starling-rebase-unsettled");
      const opened = await freshOpen();
      if (!opened || opened.outcome !== "opened" || !sameHead(opened.head, candidateHead)) {
        return failure("starling-rebase-local-confirmation-unsettled");
      }
      const payload = await materializeMergedPayload(opened);
      if (!payload) return failure("starling-rebase-local-confirmation-unsettled");
      const observedAuthority = await readSharedAuthority();
      if (!sameAuthorityLineage(authority, observedAuthority)) {
        return failure("starling-rebase-authority-conflict");
      }
      const next = authorityPlainState(observedAuthority, null, opened.head, null, null,
        durable.acceptedDeleteReceipt);
      if (!next || !await persistDurableState(next)) {
        return failure("starling-rebase-local-confirmation-unsettled");
      }
      accepted = { token: current.session.token, generation: current.session.generation,
        sourceRevision: observedAuthority.rollbackRevision, head: opened.head, session: opened.session };
      return freeze({ ok: true, remoteCommitted: remoteCommitted === true,
        coveredOperationCeiling: witness.ceiling, mergedPayload: payload });
    }

    async function acceptConcurrentNoChange(durable, witness, authority, opened) {
      const current = currentPrivate();
      if (!current || !opened || opened.outcome !== "opened" || !safeHead(opened.head)) {
        return failure("starling-rebase-local-confirmation-unsettled");
      }
      const verified = await freshOpen();
      const observedAuthority = await readSharedAuthority();
      if (!verified || verified.outcome !== "opened" || !sameHead(verified.head, opened.head)
          || !sameAuthorityLineage(authority, observedAuthority)) {
        return failure("starling-rebase-local-confirmation-unsettled");
      }
      const payload = await materializeMergedPayload(verified);
      if (!payload) return failure("starling-rebase-local-confirmation-unsettled");
      const next = authorityPlainState(observedAuthority, null, verified.head, null, null,
        durable.acceptedDeleteReceipt);
      if (!next || !await persistDurableState(next)) {
        return failure("starling-rebase-local-confirmation-unsettled");
      }
      accepted = { token: current.session.token, generation: current.session.generation,
        sourceRevision: observedAuthority.rollbackRevision, head: verified.head, session: verified.session };
      return freeze({ ok: true, remoteCommitted: false, noHeadChange: true,
        coveredOperationCeiling: witness.ceiling, mergedPayload: payload });
    }

    async function rebaseConcurrentSyncedOwner(input) {
      if (!input || Object.keys(input).length !== 2
          || !Object.prototype.hasOwnProperty.call(input, "expectedSession")
          || !Object.prototype.hasOwnProperty.call(input, "ceiling")
          || !Number.isSafeInteger(input.ceiling) || input.ceiling < 1
          || !base.isSyncedOwnerSaveSessionCurrent(input.expectedSession)) {
        return failure("starling-rebase-input-invalid");
      }
      return serialiseOwnerOperation(async () => {
        if (!base.isSyncedOwnerSaveSessionCurrent(input.expectedSession)
            || !await refreshPrivateOwner()) return failure("starling-rebase-owner-session-stale");
        const authority = await readSharedAuthority();
        const durable = await loadDurableState();
        const witness = durable?.schema === AUTHORITY_STATE_SCHEMA ? durable.saveWitness : null;
        if (!authority || !durable || !witness || witness.schema !== SAVE_SCHEMA
            || witness.phase !== "conflict" || witness.casMayHaveRun !== true
            || witness.ceiling !== input.ceiling || !starlingSteady(authority)
            || !sameAuthorityLineage(authority, durable.authority)
            || witness.authorityRevision !== authority.authorityRevision
            || !sameHead(durable.acceptedHead, witness.expectedHead)) {
          return failure("starling-rebase-witness-unavailable");
        }
        if (!base.isSyncedOwnerSaveSessionCurrent(input.expectedSession)) {
          return failure("starling-rebase-owner-session-stale");
        }
        const opened = await freshOpen();
        if (!opened || opened.outcome !== "opened" || !opened.session || !safeHead(opened.head)
            || sameHead(opened.head, witness.expectedHead)) {
          return failure("starling-rebase-fresh-open-failed");
        }
        const remoteEdit = global.PocketStarlingRemoteEditShadow;
        const publication = global.PocketStarlingDurablePublication;
        if (!remoteEdit || typeof remoteEdit.createEditor !== "function"
            || !publication || typeof publication.descriptorFromPrepared !== "function") {
          return failure("starling-rebase-unavailable");
        }
        let prepared;
        try {
          const current = currentPrivate();
          const editor = await remoteEdit.createEditor({
            opened,
            masterKey: current.owner.masterKey,
            context: { syncedPocketId: current.owner.syncedPocketId },
            semanticAuthority: current.owner.semanticAuthority,
          });
          prepared = await editor.prepareWorkingSet(clone(witness.operations),
            clone(witness.preservationProjection));
        } catch (_error) { return failure("starling-rebase-semantic-conflict"); }
        if (prepared?.outcome === "unchanged") {
          return acceptConcurrentNoChange(durable, witness, authority, opened);
        }
        if (!prepared || prepared.outcome !== "prepared") {
          return failure("starling-rebase-semantic-conflict");
        }
        const descriptor = publication.descriptorFromPrepared(prepared);
        if (!descriptor || !sameHead(descriptor.expectedHead, opened.head)) {
          return failure("starling-rebase-preparation-invalid");
        }
        const coordinator = publication.createCoordinator?.({
          objectHeadService: options.objectHeadService,
          operationIdFactory: options.operationIdFactory,
        });
        if (!coordinator) return failure("starling-rebase-unavailable");
        try { await coordinator.ensureObjects(descriptor); }
        catch (_error) { return failure("starling-rebase-publication-failed"); }
        let headResult;
        try { headResult = await coordinator.attemptHead(descriptor, authority.authorityRevision); }
        catch (_error) {
          let reconciled;
          try {
            const current = currentPrivate();
            reconciled = await coordinator.reconcile({ descriptor,
              masterKey: current.owner.masterKey,
              context: { syncedPocketId: current.owner.syncedPocketId } });
          } catch (_reconcileError) { return failure("starling-rebase-outcome-unknown"); }
          const outcomes = global.PocketStarlingHeadShadow?.OUTCOME;
          if (!outcomes) return failure("starling-rebase-outcome-unknown");
          if (reconciled.outcome === outcomes.COMMITTED) {
            return acceptConcurrentRebase(durable, witness, authority, opened.head, descriptor, true);
          }
          if (reconciled.outcome === outcomes.CONFLICT
              || reconciled.outcome === outcomes.COMMITTED_AND_SUPERSEDED) {
            return failure("starling-rebase-second-head-conflict");
          }
          if (reconciled.outcome === outcomes.NOT_COMMITTED) {
            return failure("starling-rebase-not-committed");
          }
          return failure("starling-rebase-outcome-unknown");
        }
        if (headResult?.outcome === "committed") {
          return acceptConcurrentRebase(durable, witness, authority, opened.head, descriptor, true);
        }
        if (headResult?.outcome === "conflict") return failure("starling-rebase-second-head-conflict");
        if (headResult?.outcome === "not-committed") return failure("starling-rebase-not-committed");
        return failure("starling-rebase-outcome-unknown");
      });
    }

    async function dispatchAuthoritySave(input) {''')

replace(owner,
'''      saveSyncedOwner,
      admitAcceptedDeleteRestore,''',
'''      saveSyncedOwner,
      rebaseConcurrentSyncedOwner,
      admitAcceptedDeleteRestore,''')

io = "js/pocket-io-browser.js"
replace(io,
'''function requirePocketFileForChanges() {
  if (canModifyPocket()) return true;
  showPocketFileGatePrompt();
  return false;
}''',
'''function requirePocketFileForChanges() {
  if (window.PocketOwnerSaveBoundary?.isConcurrentRebaseLeaseActive?.() === true) {
    if (typeof setStatus === "function") {
      setStatus("This Pocket is finishing a concurrent save. Your draft is still here.", "warn", { durationMs: 5200 });
    }
    return false;
  }
  if (canModifyPocket()) return true;
  showPocketFileGatePrompt();
  return false;
}''')

replace(io,
'''  const targetChanged = truthFileHandle !== nextHandle
    || session.displayName !== nextName
    || session.pipSession !== nextPip
    || session.detachedDeviceChanges !== nextDetached
    || session.ownerKind !== nextOwnerKind
    || session.storagePrivacy !== nextStoragePrivacy
    || session.vaultSessionId !== nextVaultSessionId;''',
'''  const targetChanged = truthFileHandle !== nextHandle
    || session.displayName !== nextName
    || session.pipSession !== nextPip
    || session.detachedDeviceChanges !== nextDetached
    || session.ownerKind !== nextOwnerKind
    || session.storagePrivacy !== nextStoragePrivacy
    || session.vaultSessionId !== nextVaultSessionId;
  if (window.PocketOwnerSaveBoundary?.isConcurrentRebaseLeaseActive?.() === true
      && (targetChanged || options.forceNewSession === true)) {
    throw new Error("Pocket owner session is leased for concurrent Save adoption.");
  }''')

replace(io,
'''          expectedSession: saveSession,
          freezePayload,
          vaultDialogToken: options.vaultDialogToken,''',
'''          expectedSession: saveSession,
          freezePayload,
          captureOperationHighWater: () => typeof getPocketHighestOperationSequence === "function"
            ? getPocketHighestOperationSequence()
            : (Number(state.operationHighWater) || 0),
          vaultDialogToken: options.vaultDialogToken,''')

replace(io,
'''    const pickedFileAdoption = !!(
      writeResult''',
'''    let concurrentRebaseAcceptedPayload = null;
    if (writeResult?.ok === true && writeResult.concurrentRebase === true) {
      const boundary = window.PocketOwnerSaveBoundary;
      const leaseToken = writeResult.rebaseLease;
      const coveredCeiling = Number(writeResult.coveredOperationCeiling);
      const mergedPayload = writeResult.mergedPayload;
      const canContinue = () => !!boundary
        && boundary.isConcurrentRebaseLeaseCurrent?.(leaseToken, saveSession, coveredCeiling) === true
        && isPocketFileSaveSessionCurrent(saveSession)
        && (typeof getPocketHighestOperationSequence === "function"
          ? getPocketHighestOperationSequence()
          : (Number(state.operationHighWater) || 0)) === coveredCeiling;
      let adopted = false;
      try {
        let norm = null;
        try { norm = normaliseInput(mergedPayload); } catch (_error) {}
        if (norm && canContinue() && typeof commitPreparedPocketDocument === "function") {
          const committed = commitPreparedPocketDocument(norm, {
            schema: norm.schema || "portal.export.v1",
            fileName: "Synced Pocket",
            writtenAt: cleanText(mergedPayload?.writtenAt || mergedPayload?.exportedAt, 40),
          }, {
            handle: null,
            displayName: "Synced Pocket",
            ownerKind: "synced",
            storagePrivate: "synced",
            forceNewSession: false,
            canContinue,
            loadedStateOptions: {
              skipLocalSafetyCheck: true,
              establishDocumentBaseline: true,
              baselinePayload: mergedPayload,
            },
          });
          adopted = committed?.ok === true && canContinue();
        }
      } finally {
        boundary?.releaseConcurrentRebaseLease?.(leaseToken);
      }
      if (!adopted) {
        writeResult = {
          ok: false,
          reason: "concurrent-rebase-local-adoption-failed",
          ownerKind: "synced",
          target: "synced",
          remoteCommitted: writeResult.remoteCommitted === true,
        };
        if (typeof setStatus === "function") {
          setStatus("This Pocket changed elsewhere. Your changes are still here; reopen or review before saving again.", "warn", { durationMs: 7200 });
        }
      } else {
        concurrentRebaseAcceptedPayload = mergedPayload;
      }
    }
    const pickedFileAdoption = !!(
      writeResult''')

replace(io,
'''        establishPocketDocumentBaseline(payload, state.source);''',
'''        establishPocketDocumentBaseline(concurrentRebaseAcceptedPayload || payload, state.source);''')

replace("js/pocket-editor-copy.js",
'''function stageDetailsEditorDraft() {
  if (!isDetailsEditorOpen()) return false;''',
'''function stageDetailsEditorDraft() {
  if (window.PocketOwnerSaveBoundary?.isConcurrentRebaseLeaseActive?.() === true) return false;
  if (!isDetailsEditorOpen()) return false;''')

replace("js/pocket-node-popout-editor.js",
'''  function applyPayload(payload, options = {}) {
    if (typeof global.isPocketFilePermissionPromptOpen === "function"''',
'''  function applyPayload(payload, options = {}) {
    if (global.PocketOwnerSaveBoundary?.isConcurrentRebaseLeaseActive?.() === true) {
      return rejection(
        "concurrent-rebase-lease-active",
        "Pocket is finishing a concurrent save. Your editor changes are still here; try Save again when it finishes.",
        "Concurrent Save finishing — editor not applied"
      );
    }
    if (typeof global.isPocketFilePermissionPromptOpen === "function"''')
