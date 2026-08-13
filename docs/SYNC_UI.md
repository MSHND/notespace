# Sync doorway

The Sync UI is installed only by an injected, provider-neutral integration. Static Pocket has no enabled Sync action and selects no service host or provider. It refreshes on Pocket owner transitions and opening More, never by polling.

Turning on Sync is an explicit confirmation: Pocket saves the current JSON or Vault before ownership changes, uses a passkey, and asks for a recovery copy. A fresh or safely replaceable device can open its existing synced Pocket from the quiet doorway beside Choose file, without entering an account locator.

After adoption, ordinary Save remains the only persistence action. The doorway does not provide background sync, polling, or a separate Sync-now command. Emergency-recovery UI and production deployment are separate work.
