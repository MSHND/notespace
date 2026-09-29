/* Ownerless first-create existing-account preflight.
   Owns account-state classification only; no content, recovery, Save, adoption or UI. */
(function initialisePocketSyncFirstCreate(global) {
  "use strict";

  const API_VERSION = 1;
  const ACCOUNT_PATH = "existing-unbound";
  const CONFIG_FIELDS = Object.freeze([
    "accountClient",
    "discoveryService",
    "createOperationId",
  ]);

  function isObject(value) {
    return value !== null && typeof value === "object" && !Array.isArray(value);
  }

  function isIdentifier(value) {
    return typeof value === "string" && value.length > 0;
  }

  function isPositiveInteger(value) {
    return Number.isSafeInteger(value) && value > 0;
  }

  function firstCreateError(code) {
    const error = new Error(`Pocket Sync first-create ${code}.`);
    error.code = code;
    return error;
  }

  function fail(reason) {
    return Object.freeze({ ok: false, reason });
  }

  function safeFailureReason(error) {
    return typeof error?.code === "string" && error.code.startsWith("first-create-")
      ? error.code
      : "first-create-authentication-failed";
  }

  function safePrf(prf) {
    return Object.freeze({
      status: prf.status,
      evaluationInput: prf.evaluationInput,
    });
  }

  function validateAuthenticated(input) {
    if (!isObject(input)
        || input.ok !== true
        || input.accountAuthenticated !== true
        || input.contentUnlocked !== false
        || !isIdentifier(input.accountId)
        || !isIdentifier(input.credentialId)
        || !isPositiveInteger(input.credentialVersion)
        || !isPositiveInteger(input.accountPolicyVersion)
        || typeof input.bootstrap !== "boolean"
        || !isObject(input.prf)) {
      throw firstCreateError("first-create-authentication-failed");
    }

    if (input.bootstrap === true) {
      if (input.prf.status !== "not-requested"
          || input.prf.evaluationInput !== null
          || Object.prototype.hasOwnProperty.call(input.prf, "outputBytes")) {
        throw firstCreateError("first-create-authentication-failed");
      }
      return input;
    }

    if (!["available", "unavailable"].includes(input.prf.status)
        || !isIdentifier(input.prf.evaluationInput)) {
      throw firstCreateError("first-create-authentication-failed");
    }

    if (input.prf.status === "available") {
      if (!(input.prf.outputBytes instanceof Uint8Array)
          || input.prf.outputBytes.byteLength !== 32) {
        throw firstCreateError("first-create-authentication-failed");
      }
    } else if (Object.prototype.hasOwnProperty.call(input.prf, "outputBytes")) {
      throw firstCreateError("first-create-authentication-failed");
    }
    return input;
  }

  function safeAccountResult(authenticated) {
    return Object.freeze({
      ok: true,
      status: "account-ready",
      accountPath: ACCOUNT_PATH,
      accountId: authenticated.accountId,
      credentialId: authenticated.credentialId,
      credentialVersion: authenticated.credentialVersion,
      accountPolicyVersion: authenticated.accountPolicyVersion,
      prf: safePrf(authenticated.prf),
    });
  }

  function privateAccountReady(authenticated) {
    return Object.freeze({
      accountPath: ACCOUNT_PATH,
      accountId: authenticated.accountId,
      credentialId: authenticated.credentialId,
      credentialVersion: authenticated.credentialVersion,
      accountPolicyVersion: authenticated.accountPolicyVersion,
      prf: authenticated.prf,
    });
  }

  function validateDiscovery(input, operationId) {
    if (!isObject(input)
        || input.apiVersion !== API_VERSION
        || input.ok !== true
        || input.operationId !== operationId
        || !["ready", "not-configured"].includes(input.status)) {
      throw firstCreateError("first-create-discovery-failed");
    }
    if (input.status === "ready") {
      if (!isIdentifier(input.syncedPocketId)) {
        throw firstCreateError("first-create-discovery-failed");
      }
    } else if (input.syncedPocketId !== null) {
      throw firstCreateError("first-create-discovery-failed");
    }
    return input;
  }

  function createConductor(configuration) {
    if (!isObject(configuration)
        || Object.keys(configuration).some((field) => !CONFIG_FIELDS.includes(field))
        || !isObject(configuration.accountClient)
        || typeof configuration.accountClient.authenticatePasskey !== "function"
        || !isObject(configuration.discoveryService)
        || typeof configuration.discoveryService.readSyncedPocket !== "function"
        || typeof configuration.createOperationId !== "function") {
      throw firstCreateError("first-create-input-invalid");
    }

    const accountClient = configuration.accountClient;
    const discoveryService = configuration.discoveryService;
    const createOperationId = configuration.createOperationId;

    function nextOperationId() {
      let value;
      try {
        value = createOperationId();
      } catch (_error) {
        throw firstCreateError("first-create-operation-id-invalid");
      }
      if (!isIdentifier(value)) {
        throw firstCreateError("first-create-operation-id-invalid");
      }
      return value;
    }

    async function prepareExistingAccount(onAccountReady) {
      if (typeof onAccountReady !== "function") {
        throw firstCreateError("first-create-input-invalid");
      }

      let bootstrapAccountId = null;
      let classification = null;

      async function consumeAuthenticated(authenticatedInput) {
        const authenticated = validateAuthenticated(authenticatedInput);

        if (authenticated.bootstrap === true) {
          if (bootstrapAccountId !== null || classification !== null) {
            throw firstCreateError("first-create-authentication-failed");
          }
          bootstrapAccountId = authenticated.accountId;
          return;
        }

        if (bootstrapAccountId !== null && authenticated.accountId !== bootstrapAccountId) {
          throw firstCreateError("first-create-account-mismatch");
        }
        if (classification !== null) {
          throw firstCreateError("first-create-authentication-failed");
        }

        const discoveryOperationId = nextOperationId();
        let discovery;
        try {
          discovery = validateDiscovery(
            await discoveryService.readSyncedPocket({
              apiVersion: API_VERSION,
              operationId: discoveryOperationId,
            }),
            discoveryOperationId
          );
        } catch (error) {
          if (error?.code === "first-create-discovery-failed"
              || error?.code === "first-create-operation-id-invalid") {
            throw error;
          }
          throw firstCreateError("first-create-discovery-failed");
        }

        if (discovery.status === "ready") {
          classification = Object.freeze({
            ok: true,
            status: "existing-pocket",
            syncedPocketId: discovery.syncedPocketId,
          });
          return;
        }

        try {
          await onAccountReady(privateAccountReady(authenticated));
        } catch (_error) {
          throw firstCreateError("first-create-account-ready-failed");
        }
        classification = safeAccountResult(authenticated);
      }

      let firstAuthentication;
      try {
        firstAuthentication = await accountClient.authenticatePasskey({
          apiVersion: API_VERSION,
          operationId: nextOperationId(),
        }, consumeAuthenticated);
      } catch (error) {
        return fail(safeFailureReason(error));
      }

      if (firstAuthentication?.bootstrap === true) {
        if (!isIdentifier(bootstrapAccountId) || classification !== null) {
          return fail("first-create-authentication-failed");
        }
        try {
          await accountClient.authenticatePasskey({
            apiVersion: API_VERSION,
            operationId: nextOperationId(),
          }, consumeAuthenticated);
        } catch (error) {
          return fail(safeFailureReason(error));
        }
      }

      return classification || fail("first-create-authentication-failed");
    }

    return Object.freeze({ prepareExistingAccount });
  }

  global.PocketSyncFirstCreate = Object.freeze({ createConductor });
})(typeof window !== "undefined" ? window : globalThis);
