/* Minimal, injected Sync doorway. It owns no Sync state or transport. */
(function initialisePocketSyncUi(global) {
  "use strict";
  let refreshInstalled = () => {};
  const RECOVERY_COPY = Object.freeze({
    "recovery-required": "A recovery copy is needed to open this synced Pocket on this device.",
    "recovery-package-invalid": "Recovery copy could not be used. Your current Pocket is unchanged.",
    "recovery-begin-unavailable": "Pocket could not start recovery with the synced service.",
    "recovery-begin-expired": "The saved recovery request expired and needs attention.",
    "recovery-begin-not-found": "This Recovery Copy is not available for this synced Pocket.",
    "recovery-begin-rejected": "Pocket could not start recovery with this synced Pocket.",
    "recovery-begin-request-rejected": "Pocket could not accept this recovery request.",
    "recovery-begin-authentication-rejected": "Pocket could not authenticate this recovery request.",
    "recovery-begin-authorisation-rejected": "Pocket could not authorise this recovery request.",
    "recovery-begin-conflict": "This recovery request conflicts with existing recovery state.",
    "recovery-begin-response-invalid": "Pocket could not safely confirm the recovery request.",
    "recovery-begin-service-state-invalid": "The synced recovery service is not ready for this request.",
    "recovery-begin-storage-failed": "The synced recovery service could not safely access recovery storage.",
    "recovery-begin-server-contract-invalid": "The synced recovery service returned an invalid recovery result.",
    "recovery-begin-server-internal": "The synced recovery service had an internal recovery failure.",
    "recovery-begin-http-shell-rejected": "The synced recovery service rejected this recovery request at its HTTP boundary.",
    "recovery-begin-redirect-rejected": "Pocket rejected a redirected recovery request.",
    "recovery-begin-failed": "Recovery could not be started with this synced Pocket.",
    "recovery-ceremony-expired": "The recovery passkey request expired. Start recovery again.",
    "recovery-credential-cancelled": "Creating this device’s recovery passkey was cancelled.",
    "recovery-credential-failed": "Pocket could not create this device’s recovery passkey.",
    "recovery-proof-failed": "Pocket could not finish this device’s recovery passkey.",
    "recovery-finish-unavailable": "Pocket could not finish this device’s recovery passkey with the synced service.",
    "recovery-finish-failed": "This device’s recovery passkey could not be accepted.",
    "remote-content-unavailable": "Pocket could not read the synced content for recovery.",
    "remote-content-changed": "The synced content changed while recovery was reading it.",
    "recovered-content-invalid": "The recovered synced content could not be validated.",
    "recovery-envelope-open-failed": "Pocket could not open the recovery authority for this device.",
    "device-envelope-failed": "Pocket could not add this device’s secure access.",
    "device-envelope-conflict": "This device’s secure access could not be added safely.",
    "recovery-rotation-failed": "Pocket could not rotate Recovery authority.",
    "recovery-rotation-conflict": "Recovery authority changed and could not be rotated safely.",
    "replacement-recovery-copy-not-stored": "Save the replacement recovery copy, then continue recovery.",
    "device-finalisation-failed": "Pocket could not finalise recovery on this device.",
    "recovery-adoption-failed": "Pocket could not finalise recovery on this device.",
    "recovery-target-stale": "The current Pocket changed before recovery could be finalised.",
    "recovery-target-changed": "The current Pocket changed before recovery could continue.",
    "recovery-target-dirty": "Pocket has changes that need attention before recovery can continue.",
    "recovery-state-invalid": "Recovery could not continue safely.",
    "replacement-copy-destination-deferred": "Choose where to save the replacement recovery copy to begin recovery.",
    "device-staging-failed": "Pocket could not prepare recovery safely on this device.",
    "invalid-recovery-input": "Recovery could not be started safely.",
    "unsupported-recovery-target": "Recovery is not available for the current Pocket.",
    "recovery-discovery-needs-attention": "Recovery on this device needs attention before it can continue.",
  });

  function owner() {
    try { return global.capturePocketFileSaveSession?.() || null; } catch (_error) { return null; }
  }

  function message(result) {
    const reason = result?.reason;
    if (result?.adopted === true && result?.sourceOwnerPreserved === false) {
      return "Sync setup hit a finalisation problem, but Synced Pocket is now the owner.";
    }
    if (Object.prototype.hasOwnProperty.call(RECOVERY_COPY, reason)) {
      const copy = RECOVERY_COPY[reason];
      return result?.resumable === true && reason !== "recovery-required"
        ? `${copy} Continue recovery will retry this same recovery attempt.` : copy;
    }
    if (result?.sourceOwnerPreserved !== true) {
      return "Sync setup could not finish. Check Storage & Sync before continuing.";
    }
    if (["additional-device-target-dirty", "source-has-unsaved-changes"].includes(reason)) {
      return "Pocket has changes that need attention before Sync can continue.";
    }
    if (reason === "source-session-changed") return "This Pocket changed while setup was running. Nothing was switched.";
    if (["recovery-copy-destination-deferred", "source-save-cancelled"].includes(reason)) return "Setup was cancelled. Your current Pocket is unchanged.";
    return "Sync setup could not finish. Your current Pocket is unchanged.";
  }

  function install(integration) {
    if (!integration || ["activate", "resume", "openExisting"].some((name) => typeof integration[name] !== "function")) return false;
    if (!global.document || global.PocketSyncUiInstalled) return false;
    const document = global.document;
    const button = document.getElementById("cmdSync");
    const topbarButton = document.getElementById("btnOpenSynced");
    if (!(button instanceof global.HTMLButtonElement) || !(topbarButton instanceof global.HTMLButtonElement)) return false;
    global.PocketSyncUiInstalled = true;
    let busy = false;
    let discovering = false;
    let discoveryVersion = 0;
    let continuation = null;
    let restartEligible = false;
    let returnFocus = null;

    const overlay = document.createElement("div");
    overlay.className = "vaultDialogOverlay";
    overlay.hidden = true;
    overlay.innerHTML = '<section class="vaultDialogCard" role="dialog" aria-modal="true" aria-labelledby="syncSetupTitle" aria-describedby="syncSetupBody syncSetupStatus">'
      + '<header class="vaultDialogHeader"><h2 id="syncSetupTitle"></h2><p id="syncSetupBody"></p></header>'
      + '<p id="syncSetupStatus" class="vaultDialogError" role="status" aria-live="polite"></p>'
      + '<div class="vaultDialogActions"><button class="vaultDialogPrimary" type="button"></button><button class="vaultDialogRecovery" type="button">Use recovery copy…</button><button class="vaultDialogRestart" type="button">Restart recovery</button><button class="vaultDialogSecondary" type="button">Cancel</button></div>'
      + '</section>';
    document.body.appendChild(overlay);
    const title = overlay.querySelector("h2");
    const body = overlay.querySelector("#syncSetupBody");
    const status = overlay.querySelector("#syncSetupStatus");
    const primary = overlay.querySelector(".vaultDialogPrimary");
    const recovery = overlay.querySelector(".vaultDialogRecovery");
    const restart = overlay.querySelector(".vaultDialogRestart");
    const cancel = overlay.querySelector(".vaultDialogSecondary");

    function eligibleActivation(session) { return !!session && ["json", "vault"].includes(session.ownerKind); }
    function eligibleOpen(session) {
      if (!session || !["none", "detached"].includes(session.ownerKind)) return false;
      if (session.ownerKind === "none") return true;
      try { return global.hasPocketUnsavedChanges?.() === false; } catch (_error) { return false; }
    }
    function hasRecovery() {
      return typeof integration.recoverExisting === "function"
        && typeof integration.resumeRecovery === "function";
    }
    function refresh() {
      const session = owner();
      const synced = session?.ownerKind === "synced";
      const canOpen = eligibleOpen(session);
      const canActivate = eligibleActivation(session);
      button.hidden = !(canActivate || canOpen) || synced;
      button.disabled = button.hidden || busy || discovering;
      topbarButton.hidden = !canOpen || synced;
      topbarButton.disabled = topbarButton.hidden || busy || discovering;
      const label = button.querySelector("span");
      if (label) label.textContent = canOpen ? "Open synced Pocket…" : "Turn on Sync…";
      const hint = button.querySelector(".commandHint");
      if (hint) hint.textContent = canOpen ? "open another device" : "encrypted copy";
      const source = document.getElementById("activeDocumentSource");
      if (synced && source instanceof global.HTMLElement) {
        source.textContent = "Synced Pocket";
        source.hidden = false;
      }
    }
    function close() {
      if (busy) return false;
      discoveryVersion += 1;
      discovering = false;
      overlay.hidden = true;
      continuation = null;
      restartEligible = false;
      returnFocus?.focus?.({ preventScroll: true });
      return true;
    }
    function show(mode) {
      if (global.isPocketVaultRecoveryFlowOpen?.() === true
          || global.isPocketFilePermissionPromptOpen?.() === true
          || global.isPocketDeviceChangesDecisionOpen?.() === true
          || global.PocketVaultBrowserIo?.isDialogOpen?.() === true) return false;
      const paletteClosed = global.closeCommandPalette?.({ restoreFocus: false }) === true;
      returnFocus = paletteClosed ? (document.getElementById("btnMore") || topbarButton) : document.activeElement;
      overlay.hidden = false;
      status.textContent = "";
      primary.hidden = false;
      restart.hidden = true;
      if (mode === "open") {
        title.textContent = "Open synced Pocket";
        body.textContent = "Open the encrypted Pocket already linked to your passkey on this device.";
        primary.textContent = "Open synced Pocket";
      } else if (mode === "recovery") {
        title.textContent = "Use recovery copy";
        body.textContent = "Pocket will ask for your saved Recovery Copy, create a passkey for this device, then ask where to save the replacement Recovery Copy.";
        primary.textContent = "Use recovery copy";
      } else if (mode === "recovery-continue") {
        title.textContent = "Continue recovery";
        body.textContent = "Continue the recovery already in progress for this Pocket.";
        primary.textContent = "Continue recovery";
      } else if (mode === "recovery-attention") {
        title.textContent = "Recovery needs attention";
        body.textContent = "Recovery on this device needs attention before it can continue.";
        primary.hidden = true;
        restart.hidden = !(restartEligible === true
          && typeof integration.restartLegacyRecovery === "function"
          && typeof continuation === "string");
      } else if (mode === "recovery-discovery") {
        title.textContent = "Checking Recovery";
        body.textContent = "Checking whether this device has a recovery already in progress.";
        primary.hidden = true;
      } else if (mode === "continue") {
        title.textContent = "Continue Sync setup";
        body.textContent = "Continue the setup already in progress for this Pocket.";
        primary.textContent = "Continue setup";
      } else {
        title.textContent = "Turn on Sync";
        body.textContent = "Pocket will keep an encrypted synced copy so you can open it on other devices. Setup uses a passkey and asks you to save a recovery copy. Your current Pocket is saved before ownership changes.";
        primary.textContent = "Turn on Sync";
      }
      primary.dataset.mode = mode;
      recovery.hidden = mode !== "open" || !hasRecovery();
      cancel.hidden = false;
      global.requestAnimationFrame?.(() => primary.focus({ preventScroll: true }));
      return true;
    }
    async function run(mode) {
      if (busy || discovering || ["recovery-discovery", "recovery-attention"].includes(mode)) return;
      busy = true;
      primary.disabled = true;
      cancel.disabled = true;
      restart.disabled = true;
      status.textContent = mode === "open" ? "Opening synced Pocket…"
        : mode === "recovery-restart" ? "Restarting recovery…"
          : mode.startsWith("recovery") ? "Recovering synced Pocket…" : "Setting up Sync…";
      let result;
      try {
        result = mode === "open" ? await integration.openExisting()
          : mode === "continue" ? await integration.resume({ activationId: continuation })
            : mode === "recovery-continue" ? await integration.resumeRecovery({ recoveryAttemptId: continuation })
              : mode === "recovery-restart" ? await integration.restartLegacyRecovery({ recoveryAttemptId: continuation })
                : mode === "recovery" ? await integration.recoverExisting() : await integration.activate();
      } catch (_error) { result = { ok: false, reason: "sync-unavailable" }; }
      busy = false;
      primary.disabled = false;
      cancel.disabled = false;
      restart.disabled = false;
      if (result?.ok === true && result?.recoveryRestarted === true) {
        continuation = null;
        restartEligible = false;
        show("recovery");
        refresh();
        return;
      }
      if (result?.ok === true) {
        overlay.hidden = true;
        continuation = null;
        refresh();
        return;
      }
      if (result?.resumable === true && typeof result.recoveryAttemptId === "string") {
        continuation = result.recoveryAttemptId;
        primary.dataset.mode = "recovery-continue";
        primary.textContent = "Continue recovery";
      } else if (result?.locallyDurable === true && result?.resumable === false
          && typeof result.recoveryAttemptId === "string") {
        continuation = result.recoveryAttemptId;
        restartEligible = result.restartable === true;
        show("recovery-attention");
      } else if (primary.dataset.mode === "recovery-continue") {
        continuation = null;
        primary.dataset.mode = "recovery";
        primary.textContent = "Use recovery copy";
        title.textContent = "Use recovery copy";
        body.textContent = "Pocket will ask for your saved Recovery Copy, create a passkey for this device, then ask where to save the replacement Recovery Copy.";
      } else if (result?.resumable === true && typeof result.activationId === "string") {
        continuation = result.activationId;
        primary.dataset.mode = "continue";
        primary.textContent = "Continue setup";
      }
      status.textContent = message(result);
      refresh();
    }
    function begin() {
      if (discovering) return;
      const session = owner();
      if (eligibleOpen(session)) {
        if (typeof integration.findRecoveryAttempt !== "function") {
          show("open");
          return;
        }
        if (!show("recovery-discovery")) return;
        discovering = true;
        refresh();
        const version = ++discoveryVersion;
        void (async () => {
          let found;
          try { found = await integration.findRecoveryAttempt(); }
          catch (_error) { found = { ok: false, reason: "recovery-discovery-needs-attention" }; }
          const current = owner();
          if (version !== discoveryVersion || overlay.hidden || busy || !eligibleOpen(current)
              || current?.ownerKind !== session.ownerKind || current?.id !== session.id) return;
          discovering = false;
          if (found?.ok === true && typeof found.recoveryAttemptId === "string") {
            restartEligible = false;
            continuation = found.recoveryAttemptId;
            show("recovery-continue");
          } else if (found?.ok === true) {
            restartEligible = false;
            show("open");
          } else if (found?.ok !== true) {
            continuation = found?.restartable === true && typeof found?.recoveryAttemptId === "string"
              ? found.recoveryAttemptId : null;
            restartEligible = found?.restartable === true;
            show("recovery-attention");
            status.textContent = message(found);
          }
        })();
      }
      else if (eligibleActivation(session)) show(continuation ? "continue" : "activate");
    }
    button.addEventListener("click", begin);
    topbarButton.addEventListener("click", begin);
    primary.addEventListener("click", () => void run(primary.dataset.mode));
    recovery.addEventListener("click", () => { if (!busy && !discovering && eligibleOpen(owner())) show("recovery"); });
    restart.addEventListener("click", () => void run("recovery-restart"));
    cancel.addEventListener("click", close);
    document.addEventListener("keydown", (event) => {
      if (!overlay.hidden && event.key === "Escape" && !busy) { event.preventDefault(); close(); }
    }, true);
    global.addEventListener?.("pocket-owner-state-changed", refresh);
    refreshInstalled = refresh;
    refresh();
    return true;
  }

  global.PocketSyncUi = Object.freeze({ install, refresh: () => refreshInstalled() });
})(typeof window !== "undefined" ? window : globalThis);
