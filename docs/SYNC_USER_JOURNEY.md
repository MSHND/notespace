# Synced Pocket user journey

## Approved future journey — not yet in production

This is the approved human journey for a future Synced Pocket. P027/P028 do not add these screens or turn sync on. There is no production account, passkey, emergency recovery, device transfer or remote service yet. P028 locks the security/recovery behaviour behind this journey without changing P027's existing copy.

The experience should feel like one simple choice: keep using a local Pocket, or turn on a protected Pocket that follows the human across their devices.

## 1. Turn on sync

Pocket offers one clear action when a valid local Pocket is open.

**Turn on sync**

Keep your Pocket available on your other devices. Your synced data will be protected so only you can read it.

There is no provider, folder, token, URL or technical setup.

## 2. Device/account security gesture

Pocket asks the human to use the device's normal secure gesture, such as Face ID, fingerprint or device PIN.

This step proves account access. Pocket should not describe encryption keys, protocols or server details in the ordinary journey. Behind the scenes, account access and the random key that protects Pocket content remain separate security responsibilities. A passkey sign-in alone never becomes the content key.

Where the actual passkey ceremony returns valid optional PRF output, Pocket may use it locally to help unlock the master key. Pocket must not promise this capability based on sign-in alone and must never upload PRF output. This step remains a future placeholder; P027/P028 invoke no passkey or device gesture.

## 3. Original-file notice

If the source is plain JSON, Pocket shows the real displayed filename.

**Your original file will stay where it is**

`{filename} is readable and will not be changed or deleted. After sync is working, you can decide whether to keep or remove it.`

Pocket must not suggest that turning on sync encrypts, moves, deletes or changes the original readable file. The new synced Pocket is protected; the historical JSON remains readable until the human decides what to do with it.

For a local Vault, Pocket likewise explains that the existing Vault stays where it is as a backup snapshot and will no longer receive routine Save writes after activation.

If the current local Pocket has unsaved changes, Pocket first uses the existing Save. If that Save is cancelled or fails, activation stops and the local Pocket remains open.

## 4. Save the recovery copy

After preparing the protected device and remote records, Pocket requires a local emergency recovery copy before activation can complete.

**Save your recovery copy**

This lets you get back into your Pocket if your devices or sign-in are unavailable. Keep it somewhere safe.

**Save recovery copy**

**I’ll do this later**

**Save recovery copy** produces a local-only package containing versioned recovery material, an opaque account/Pocket locator, checksum and instructions. It contains no Pocket notes and is never uploaded. **I’ll do this later** pauses activation: the current JSON/Vault owner remains active, no synced owner is adopted and **Sync is ready** is not shown.

After emergency recovery, Pocket must invalidate the old recovery authorisation, rotate to a new recovery version and ask the human to save a replacement copy.

## 5. Sync ready

Only after every locked condition succeeds does Pocket change owners and show:

**Sync is ready**

Your Pocket is protected and available on your devices.

The original file remains unchanged as a backup snapshot. Future ordinary Save writes to the Synced Pocket only.

The locked conditions are: current source session; any dirty source saved; master key created locally; trusted encrypted device record durable; initial encrypted remote commit successful; account credential registered; recovery envelope created; recovery copy saved; and synced-owner adoption successful. There is no warning-only recovery bypass.

## 6. Saved and synced

After a successful device Save and remote commit, Pocket shows:

**Saved · Synced**

This means the latest Save is durable on this device and has reached the other-device service.

## 7. Saved on this device, sync pending

If the protected device Save succeeds but the remote service is unavailable or the upload fails, Pocket shows:

**Saved on this device · Sync pending**

The human's work is safe on this device. Pocket does not retry secretly in the background. The next explicit Save tries again, even when there are no new edits.

## 8. Newer changes from another device

If another device has saved a newer remote version, Pocket shows:

**Pocket found newer changes from another device.**

Pocket does not overwrite either version, guess which one wins or merge automatically. A later task must design a calm review journey that lets the human understand and resolve the difference.

## What Pocket tells the human

Pocket must plainly explain:

- what is protected;
- what remains readable;
- what Pocket changed;
- what Pocket did not change;
- whether Save reached the other devices; and
- whether the human needs to do anything.

The human should never need to understand storage providers, remote revisions, encryption formats or key-management terms to know whether their Pocket is safe.

## Additional-device recovery path

A later additional-device journey may ask an already trusted device to approve a short-lived pairing. It uses an ephemeral authenticated agreement and a single-use encrypted master-key transfer envelope. The service relays only opaque material and never receives readable content or the master key. P028 documents this path but does not add UI or pairing behaviour.

## What is deliberately absent today

P027/P028 add no production Turn on sync button, sign-in screen, account, passkey, biometric request, emergency recovery package, device transfer, backend, network request, durable synced-device store, background sync, live synced owner or second Sync button. The locked architecture is documented in [SYNC_SECURITY_ARCHITECTURE.md](SYNC_SECURITY_ARCHITECTURE.md), [SYNC_REMOTE_API_CONTRACT.md](SYNC_REMOTE_API_CONTRACT.md) and [SYNC_THREAT_MODEL.md](SYNC_THREAT_MODEL.md); concrete production implementations still require review and tests.
