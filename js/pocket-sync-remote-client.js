/* Synced Pocket same-origin remote client foundation.

This module is intentionally unloaded. It defines a bounded JSON transport and
strict account/content service adapters without selecting a service origin,
persisting session state, retrying work, or changing a Pocket owner.
*/

(function initialisePocketSyncRemoteClient(global) {
  "use strict";

  const POLICY = Object.freeze({
    apiVersion: 1,
    automaticRetry: false,
    sameOriginOnly: true,
    credentials: "same-origin",
    cache: "no-store",
    redirect: "error",
    referrerPolicy: "no-referrer",
    requestMethod: "POST",
    requestContentType: "application/json",
    responseContentType: "application/json",
    bearerTokenStorage: false,
    backgroundWork: false,
    smallJsonLimitBytes: 262144,
    contentJsonLimitBytes: 16777216,
  });

  const ROUTES = Object.freeze({
    beginRegistration: "/account/passkeys/registration/begin",
    finishRegistration: "/account/passkeys/registration/finish",
    beginAuthentication: "/account/passkeys/authentication/begin",
    finishAuthentication: "/account/passkeys/authentication/finish",
    readSyncedPocket: "/account/synced-pocket/read",
    readRevision: "/pockets/revision/read",
    downloadEncryptedRecord: "/pockets/content/download",
    conditionalUpload: "/pockets/content/conditional-upload",
    listEnvelopes: "/pockets/envelopes/list",
    downloadEnvelope: "/pockets/envelopes/download",
    addEnvelope: "/pockets/envelopes/add",
    revokeEnvelope: "/pockets/envelopes/revoke",
    initialiseRecovery: "/account/recovery/initialise",
    beginRecovery: "/account/recovery/begin",
    finishRecovery: "/account/recovery/finish",
    rotateRecovery: "/account/recovery/rotate",
  });

  const IDENTIFIER_LIMIT = 160;
  const CONTENT_FORMAT = "pocket.sync.content.opaque";
  const CONTENT_VERSION = 1;
  const BASE64URL_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
  const TRANSPORT_OPTION_FIELDS = Object.freeze([
    "serviceRoot",
    "fetch",
    "TextEncoder",
    "TextDecoder",
  ]);

  function remoteError(code, retryable) {
    const error = new Error(`Pocket Sync remote client ${code}.`);
    error.code = code;
    if (typeof retryable === "boolean") error.retryable = retryable;
    return error;
  }

  function isObject(value) {
    return !!value && typeof value === "object" && !Array.isArray(value);
  }

  function exactObject(value, allowed, required, code = "remote-response-invalid") {
    if (!isObject(value)
        || Object.keys(value).some((field) => !allowed.includes(field))
        || required.some((field) => !Object.prototype.hasOwnProperty.call(value, field))) {
      throw remoteError(code);
    }
    return value;
  }

  function frozen(value) {
    if (Array.isArray(value)) return Object.freeze(value.map(frozen));
    if (isObject(value)) {
      const copy = {};
      Object.keys(value).forEach((field) => {
        copy[field] = frozen(value[field]);
      });
      return Object.freeze(copy);
    }
    return value;
  }

  function identifier(value, code = "remote-request-invalid") {
    if (typeof value !== "string"
        || value.length < 1
        || value.length > IDENTIFIER_LIMIT
        || value !== value.trim()) {
      throw remoteError(code);
    }
    return value;
  }

  function revision(value, minimum = 0, code = "remote-request-invalid") {
    if (!Number.isSafeInteger(value) || value < minimum) throw remoteError(code);
    return value;
  }

  function normaliseServiceRoot(value) {
    if (typeof value !== "string"
        || value.length < 2
        || value !== value.trim()
        || !value.startsWith("/")
        || value.startsWith("//")
        || value.includes("//")
        || /[:?#\\@%]/.test(value)) {
      throw remoteError("remote-service-root-invalid");
    }
    const normalised = value.endsWith("/") ? value.slice(0, -1) : value;
    if (normalised.length < 2
        || normalised.split("/").some((segment, index) => index > 0 && ["", ".", ".."].includes(segment))) {
      throw remoteError("remote-service-root-invalid");
    }
    return normalised;
  }

  function routeLimits(routeName) {
    if (!Object.prototype.hasOwnProperty.call(ROUTES, routeName)) {
      throw remoteError("remote-route-invalid");
    }
    return Object.freeze({
      request: routeName === "conditionalUpload"
        ? POLICY.contentJsonLimitBytes
        : POLICY.smallJsonLimitBytes,
      response: routeName === "downloadEncryptedRecord"
        ? POLICY.contentJsonLimitBytes
        : POLICY.smallJsonLimitBytes,
      statuses: [
        "conditionalUpload",
        "addEnvelope",
        "revokeEnvelope",
        "initialiseRecovery",
        "rotateRecovery",
      ].includes(routeName) ? Object.freeze([200, 409]) : Object.freeze([200]),
    });
  }

  function validateJsonValue(value, seen) {
    if (value === null || typeof value === "string" || typeof value === "boolean") return;
    if (typeof value === "number") {
      if (!Number.isFinite(value)) throw remoteError("remote-request-invalid");
      return;
    }
    if (typeof value !== "object") throw remoteError("remote-request-invalid");
    if (seen.has(value)) throw remoteError("remote-request-invalid");
    seen.add(value);
    if (Array.isArray(value)) {
      value.forEach((item) => validateJsonValue(item, seen));
    } else {
      const prototype = Object.getPrototypeOf(value);
      if (prototype !== Object.prototype && prototype !== null
          && Object.getPrototypeOf(prototype) !== null) {
        throw remoteError("remote-request-invalid");
      }
      Object.keys(value).forEach((field) => validateJsonValue(value[field], seen));
    }
    seen.delete(value);
  }

  function encodedSize(encoder, text, code) {
    try {
      return encoder.encode(text).byteLength;
    } catch (_error) {
      throw remoteError(code);
    }
  }

  function serialiseRequestBody(routeName, requestBody, encoder) {
    const limits = routeLimits(routeName);
    if (!isObject(requestBody)) throw remoteError("remote-request-invalid");
    validateJsonValue(requestBody, new Set());
    let bodyText;
    try { bodyText = JSON.stringify(requestBody); }
    catch (_error) { throw remoteError("remote-request-invalid"); }
    if (typeof bodyText !== "string") throw remoteError("remote-request-invalid");
    if (encodedSize(encoder, bodyText, "remote-request-invalid") > limits.request) {
      throw remoteError("remote-request-too-large");
    }
    return bodyText;
  }

  function contentType(headers) {
    if (!headers || typeof headers.get !== "function") {
      throw remoteError("remote-content-type-invalid");
    }
    let value;
    try {
      value = headers.get("Content-Type");
    } catch (_error) {
      throw remoteError("remote-content-type-invalid");
    }
    if (typeof value !== "string"
        || !/^application\/json(?:\s*;\s*charset=[A-Za-z0-9._-]+)?\s*$/i.test(value)) {
      throw remoteError("remote-content-type-invalid");
    }
  }

  function declaredLength(headers, limit) {
    let value;
    try {
      value = headers.get("Content-Length");
    } catch (_error) {
      throw remoteError("remote-response-invalid");
    }
    if (value === null || value === undefined || value === "") return;
    if (!/^(0|[1-9][0-9]*)$/.test(value)) throw remoteError("remote-response-invalid");
    const length = Number(value);
    if (!Number.isSafeInteger(length)) throw remoteError("remote-response-too-large");
    if (length > limit) throw remoteError("remote-response-too-large");
  }

  async function readStreamedText(response, limit, Decoder) {
    const reader = response.body.getReader();
    if (!reader || typeof reader.read !== "function") throw remoteError("remote-response-invalid");
    const chunks = [];
    let length = 0;
    while (true) {
      let item;
      try {
        item = await reader.read();
      } catch (_error) {
        throw remoteError("remote-response-invalid");
      }
      if (!isObject(item) || typeof item.done !== "boolean") {
        throw remoteError("remote-response-invalid");
      }
      if (item.done) break;
      if (!(item.value instanceof Uint8Array)) throw remoteError("remote-response-invalid");
      length += item.value.byteLength;
      if (length > limit) {
        try {
          if (typeof reader.cancel === "function") await reader.cancel();
        } catch (_error) {}
        throw remoteError("remote-response-too-large");
      }
      chunks.push(new Uint8Array(item.value));
    }
    const combined = new Uint8Array(length);
    let offset = 0;
    chunks.forEach((chunk) => {
      combined.set(chunk, offset);
      offset += chunk.byteLength;
    });
    try {
      return new Decoder("utf-8", { fatal: true }).decode(combined);
    } catch (_error) {
      throw remoteError("remote-response-invalid");
    }
  }

  async function readFallbackText(response, limit, encoder) {
    if (!response || typeof response.text !== "function") {
      throw remoteError("remote-response-invalid");
    }
    let text;
    try {
      text = await response.text();
    } catch (_error) {
      throw remoteError("remote-response-invalid");
    }
    if (typeof text !== "string") throw remoteError("remote-response-invalid");
    if (encodedSize(encoder, text, "remote-response-invalid") > limit) {
      throw remoteError("remote-response-too-large");
    }
    return text;
  }

  async function readResponseBody(response, limit, encoder, Decoder) {
    contentType(response.headers);
    declaredLength(response.headers, limit);
    const text = response.body && typeof response.body.getReader === "function"
      ? await readStreamedText(response, limit, Decoder)
      : await readFallbackText(response, limit, encoder);
    if (text.length === 0) throw remoteError("remote-response-invalid");
    let body;
    try {
      body = JSON.parse(text);
    } catch (_error) {
      throw remoteError("remote-response-invalid");
    }
    if (!isObject(body)) throw remoteError("remote-response-invalid");
    return body;
  }

  function rejectedStatus(status) {
    if (status === 401) return remoteError("remote-authentication-required", false);
    if (status === 403) return remoteError("remote-authorisation-failed", false);
    if ([408, 502, 503, 504].includes(status)) return remoteError("remote-unavailable", true);
    if (status === 429) return remoteError("remote-rate-limited", true);
    if (status >= 300 && status < 400) return remoteError("remote-redirect-rejected", false);
    return remoteError("remote-request-rejected", false);
  }

  function createBrowserJsonTransport(options = {}) {
    exactObject(options, TRANSPORT_OPTION_FIELDS, ["serviceRoot"], "remote-client-invalid");
    const serviceRoot = normaliseServiceRoot(options.serviceRoot);
    const fetchFunction = options.fetch === undefined ? global.fetch : options.fetch;
    const Encoder = options.TextEncoder === undefined ? global.TextEncoder : options.TextEncoder;
    const Decoder = options.TextDecoder === undefined ? global.TextDecoder : options.TextDecoder;
    if (typeof fetchFunction !== "function"
        || typeof Encoder !== "function"
        || typeof Decoder !== "function") {
      throw remoteError("remote-client-invalid");
    }
    const encoder = new Encoder();

    async function request(routeName, requestBody) {
      const limits = routeLimits(routeName);
      const bodyText = serialiseRequestBody(routeName, requestBody, encoder);
      let response;
      try {
        response = await fetchFunction(`${serviceRoot}${ROUTES[routeName]}`, {
          method: POLICY.requestMethod,
          credentials: POLICY.credentials,
          mode: "same-origin",
          cache: POLICY.cache,
          redirect: POLICY.redirect,
          referrerPolicy: POLICY.referrerPolicy,
          headers: {
            Accept: POLICY.responseContentType,
            "Content-Type": POLICY.requestContentType,
          },
          body: bodyText,
        });
      } catch (_error) {
        throw remoteError("remote-unavailable", true);
      }
      if (!response || response.redirected === true) {
        throw remoteError("remote-redirect-rejected", false);
      }
      if (!Number.isSafeInteger(response.status)) throw remoteError("remote-response-invalid");
      if (!limits.statuses.includes(response.status)) throw rejectedStatus(response.status);
      const body = await readResponseBody(response, limits.response, encoder, Decoder);
      return Object.freeze({ status: response.status, body });
    }

    function preflightRequest(routeName, requestBody) {
      serialiseRequestBody(routeName, requestBody, encoder);
    }

    return Object.freeze({ request, preflightRequest });
  }

  function validateTransport(transport) {
    const keys = isObject(transport) ? Object.keys(transport) : [];
    if (!isObject(transport)
        || !keys.includes("request")
        || typeof transport.request !== "function"
        || !([1, 2].includes(keys.length))
        || (keys.length === 2
          && (!keys.includes("preflightRequest") || typeof transport.preflightRequest !== "function"))) {
      throw remoteError("remote-transport-invalid");
    }
    return transport;
  }

  async function callTransport(transport, routeName, request) {
    let pending;
    try {
      pending = transport.request(routeName, request);
    } catch (error) {
      if (error && typeof error.code === "string") throw error;
      throw remoteError("remote-unavailable", true);
    }
    if (!pending || typeof pending.then !== "function") {
      throw remoteError("remote-transport-invalid");
    }
    try {
      return await pending;
    } catch (error) {
      if (error && typeof error.code === "string") throw error;
      throw remoteError("remote-unavailable", true);
    }
  }

  function validateTransportResult(result, allowedStatuses) {
    const value = exactObject(result, ["status", "body"], ["status", "body"], "remote-response-invalid");
    if (!allowedStatuses.includes(value.status) || !isObject(value.body)) {
      throw remoteError("remote-response-invalid");
    }
    return value;
  }

  function accountContract() {
    const contract = global.PocketSyncAccountClient;
    const methods = [
      "validateBeginRegistrationRequest",
      "validateBeginRegistrationResponse",
      "validateFinishRegistrationRequest",
      "validateFinishRegistrationResponse",
      "validateBeginAuthenticationRequest",
      "validateBeginAuthenticationResponse",
      "validateFinishAuthenticationRequest",
      "validateFinishAuthenticationResponse",
    ];
    if (!isObject(contract) || methods.some((method) => typeof contract[method] !== "function")) {
      throw remoteError("remote-account-contract-unavailable");
    }
    return contract;
  }

  function currentMilliseconds(now) {
    let value;
    try {
      value = now();
    } catch (_error) {
      throw remoteError("remote-client-invalid");
    }
    if (!Number.isFinite(value)) throw remoteError("remote-client-invalid");
    return value;
  }

  function createAccountService({ transport, now = Date.now } = {}) {
    const remote = validateTransport(transport);
    const contract = accountContract();
    if (typeof now !== "function") throw remoteError("remote-client-invalid");

    async function beginRegistration(input) {
      const request = contract.validateBeginRegistrationRequest(input);
      const result = validateTransportResult(
        await callTransport(remote, "beginRegistration", request),
        [200]
      );
      return contract.validateBeginRegistrationResponse(
        result.body,
        request.operationId,
        currentMilliseconds(now)
      );
    }

    async function finishRegistration(input) {
      const request = contract.validateFinishRegistrationRequest(input);
      const result = validateTransportResult(
        await callTransport(remote, "finishRegistration", request),
        [200]
      );
      return contract.validateFinishRegistrationResponse(result.body, {
        operationId: request.operationId,
        ceremonyId: request.ceremonyId,
        credentialId: request.credential.id,
        prfEvaluationInput: isObject(result.body) ? result.body.prfEvaluationInput : undefined,
      });
    }

    async function beginAuthentication(input) {
      const request = contract.validateBeginAuthenticationRequest(input);
      const result = validateTransportResult(
        await callTransport(remote, "beginAuthentication", request),
        [200]
      );
      return contract.validateBeginAuthenticationResponse(
        result.body,
        request.operationId,
        currentMilliseconds(now)
      );
    }

    async function finishAuthentication(input) {
      const request = contract.validateFinishAuthenticationRequest(input);
      const result = validateTransportResult(
        await callTransport(remote, "finishAuthentication", request),
        [200]
      );
      return contract.validateFinishAuthenticationResponse(result.body, {
        operationId: request.operationId,
        ceremonyId: request.ceremonyId,
        credentialId: request.credential.id,
        prfEvaluationInput: isObject(result.body) ? result.body.prfEvaluationInput : undefined,
        bootstrap: isObject(result.body) && result.body.bootstrap === true,
      });
    }

    return Object.freeze({
      beginRegistration,
      finishRegistration,
      beginAuthentication,
      finishAuthentication,
    });
  }

  function securityContract(requireEnvelope = false) {
    const contract = global.PocketSyncSecurityContract;
    if (!isObject(contract)
        || typeof contract.validateOpaqueEncryptedRecord !== "function"
        || typeof contract.buildConditionalWriteRequest !== "function"
        || (requireEnvelope
          && typeof contract.validateOpaqueMasterKeyEnvelopeRecord !== "function")) {
      throw remoteError("remote-security-contract-unavailable");
    }
    return contract;
  }

  function validateReadRevisionRequest(input) {
    const request = exactObject(input, [
      "apiVersion",
      "operationId",
      "syncedPocketId",
    ], ["apiVersion", "operationId", "syncedPocketId"], "remote-request-invalid");
    if (request.apiVersion !== POLICY.apiVersion) throw remoteError("remote-request-invalid");
    return frozen({
      apiVersion: POLICY.apiVersion,
      operationId: identifier(request.operationId),
      syncedPocketId: identifier(request.syncedPocketId),
    });
  }

  function validateReadSyncedPocketRequest(input) {
    const value = exactObject(input, ["apiVersion", "operationId"],
      ["apiVersion", "operationId"], "remote-request-invalid");
    if (value.apiVersion !== POLICY.apiVersion) throw remoteError("remote-request-invalid");
    return frozen({ apiVersion: 1, operationId: identifier(value.operationId) });
  }

  function validateReadSyncedPocketResponse(input, requestInput) {
    const request = validateReadSyncedPocketRequest(requestInput);
    const response = exactObject(input, ["apiVersion", "ok", "operationId", "status", "syncedPocketId"],
      ["apiVersion", "ok", "operationId", "status", "syncedPocketId"]);
    if (response.apiVersion !== 1 || response.ok !== true || response.operationId !== request.operationId
        || !["ready", "not-configured"].includes(response.status)
        || (response.status === "ready" && typeof response.syncedPocketId !== "string")
        || (response.status === "not-configured" && response.syncedPocketId !== null)) {
      throw remoteError("remote-response-invalid");
    }
    if (response.syncedPocketId !== null) identifier(response.syncedPocketId, "remote-response-invalid");
    return frozen(response);
  }

  function validateReadRevisionResponse(input, requestInput) {
    const request = validateReadRevisionRequest(requestInput);
    const response = exactObject(input, [
      "apiVersion",
      "ok",
      "operationId",
      "syncedPocketId",
      "revision",
      "recordPresent",
      "contentFormat",
      "contentVersion",
      "encryptedRecordSize",
    ], [
      "apiVersion",
      "ok",
      "operationId",
      "syncedPocketId",
      "revision",
      "recordPresent",
      "contentFormat",
      "contentVersion",
      "encryptedRecordSize",
    ]);
    if (response.apiVersion !== POLICY.apiVersion
        || response.ok !== true
        || response.operationId !== request.operationId
        || response.syncedPocketId !== request.syncedPocketId) {
      throw remoteError("remote-response-invalid");
    }
    const remoteRevision = revision(response.revision, 0, "remote-response-invalid");
    if (remoteRevision === 0) {
      if (response.recordPresent !== false
          || response.contentFormat !== null
          || response.contentVersion !== null
          || response.encryptedRecordSize !== 0) {
        throw remoteError("remote-response-invalid");
      }
    } else if (response.recordPresent !== true
        || response.contentFormat !== CONTENT_FORMAT
        || response.contentVersion !== CONTENT_VERSION
        || !Number.isSafeInteger(response.encryptedRecordSize)
        || response.encryptedRecordSize < 16) {
      throw remoteError("remote-response-invalid");
    }
    return frozen(response);
  }

  function validateDownloadRequest(input) {
    const request = exactObject(input, [
      "apiVersion",
      "operationId",
      "syncedPocketId",
      "revision",
    ], ["apiVersion", "operationId", "syncedPocketId", "revision"], "remote-request-invalid");
    if (request.apiVersion !== POLICY.apiVersion) throw remoteError("remote-request-invalid");
    return frozen({
      apiVersion: POLICY.apiVersion,
      operationId: identifier(request.operationId),
      syncedPocketId: identifier(request.syncedPocketId),
      revision: revision(request.revision, 1),
    });
  }

  function canonicalBase64urlByteLength(value) {
    if (typeof value !== "string"
        || value.length === 0
        || value.length % 4 === 1
        || !/^[A-Za-z0-9_-]+$/.test(value)) {
      return -1;
    }
    const remainder = value.length % 4;
    const finalValue = BASE64URL_ALPHABET.indexOf(value[value.length - 1]);
    if ((remainder === 2 && (finalValue & 15) !== 0)
        || (remainder === 3 && (finalValue & 3) !== 0)) {
      return -1;
    }
    return Math.floor(value.length * 6 / 8);
  }

  function validateDownloadResponse(input, requestInput, contractInput) {
    const request = validateDownloadRequest(requestInput);
    const contract = contractInput || securityContract();
    const response = exactObject(input, [
      "apiVersion",
      "ok",
      "operationId",
      "syncedPocketId",
      "revision",
      "encryptedRecordSize",
      "encryptedRecord",
    ], [
      "apiVersion",
      "ok",
      "operationId",
      "syncedPocketId",
      "revision",
      "encryptedRecordSize",
      "encryptedRecord",
    ]);
    if (response.apiVersion !== POLICY.apiVersion
        || response.ok !== true
        || response.operationId !== request.operationId
        || response.syncedPocketId !== request.syncedPocketId
        || response.revision !== request.revision) {
      throw remoteError("remote-response-invalid");
    }
    const record = contract.validateOpaqueEncryptedRecord(response.encryptedRecord);
    const ciphertextBytes = isObject(record) && record.ok === true
      ? canonicalBase64urlByteLength(record.value.ciphertext)
      : -1;
    if (ciphertextBytes < 16
        || !Number.isSafeInteger(response.encryptedRecordSize)
        || response.encryptedRecordSize !== ciphertextBytes) {
      throw remoteError("remote-response-invalid");
    }
    return frozen({
      apiVersion: POLICY.apiVersion,
      ok: true,
      operationId: response.operationId,
      syncedPocketId: response.syncedPocketId,
      revision: response.revision,
      encryptedRecordSize: response.encryptedRecordSize,
      encryptedRecord: record.value,
    });
  }

  function validateConditionalUploadRequest(input, contractInput) {
    const contract = contractInput || securityContract();
    exactObject(input, [
      "apiVersion",
      "syncedPocketId",
      "expectedRevision",
      "operationId",
      "logicalChangeId",
      "attemptKind",
      "encryptedRecord",
    ], [
      "apiVersion",
      "syncedPocketId",
      "expectedRevision",
      "operationId",
      "logicalChangeId",
      "attemptKind",
      "encryptedRecord",
    ], "remote-request-invalid");
    if (input.apiVersion !== POLICY.apiVersion) throw remoteError("remote-request-invalid");
    identifier(input.syncedPocketId);
    identifier(input.operationId);
    identifier(input.logicalChangeId);
    if (revision(input.expectedRevision) >= Number.MAX_SAFE_INTEGER) {
      throw remoteError("remote-request-invalid");
    }
    const built = contract.buildConditionalWriteRequest(input);
    if (!isObject(built) || built.ok !== true) throw remoteError("remote-request-invalid");
    return frozen(built.value);
  }

  function validateConditionalUploadResponse(status, input, requestInput) {
    const request = validateConditionalUploadRequest(requestInput);
    if (status === 200) {
      const response = exactObject(input, [
        "apiVersion",
        "ok",
        "status",
        "wrote",
        "revision",
        "operationId",
        "replayed",
      ], [
        "apiVersion",
        "ok",
        "status",
        "wrote",
        "revision",
        "operationId",
        "replayed",
      ]);
      if (response.apiVersion !== POLICY.apiVersion
          || response.ok !== true
          || response.status !== "committed"
          || response.wrote !== true
          || response.operationId !== request.operationId
          || !Number.isSafeInteger(response.revision)
          || response.revision !== request.expectedRevision + 1
          || typeof response.replayed !== "boolean"
          || (request.attemptKind === "new-change" && response.replayed !== false)) {
        throw remoteError("remote-response-invalid");
      }
      return frozen(response);
    }
    if (status === 409) {
      const response = exactObject(input, [
        "apiVersion",
        "ok",
        "status",
        "wrote",
        "conflict",
        "actualRevision",
        "operationId",
      ], [
        "apiVersion",
        "ok",
        "status",
        "wrote",
        "conflict",
        "actualRevision",
        "operationId",
      ]);
      if (response.apiVersion !== POLICY.apiVersion
          || response.ok !== false
          || response.status !== "conflict"
          || response.wrote !== false
          || response.conflict !== true
          || response.operationId !== request.operationId
          || !Number.isSafeInteger(response.actualRevision)
          || response.actualRevision <= request.expectedRevision) {
        throw remoteError("remote-response-invalid");
      }
      return frozen({
        ok: false,
        status: "conflict",
        wrote: false,
        conflict: true,
        actualRevision: response.actualRevision,
        operationId: response.operationId,
      });
    }
    throw remoteError("remote-response-invalid");
  }

  function canonicalBase64url(value, bytes, code) {
    if (canonicalBase64urlByteLength(value) !== bytes) throw remoteError(code);
    return value;
  }

  function canonicalTimestamp(value) {
    if (typeof value !== "string") throw remoteError("remote-response-invalid");
    const milliseconds = Date.parse(value);
    if (!Number.isFinite(milliseconds) || new Date(milliseconds).toISOString() !== value) {
      throw remoteError("remote-response-invalid");
    }
    return value;
  }

  function validateEnvelopeFields(input, options = {}) {
    const code = options.code || "remote-request-invalid";
    const fields = [
      "envelopeId", "envelopeKind", "envelopeVersion", "deviceId", "credentialId",
      "kdf", "kdfSalt", "derivationVersion",
    ];
    if (!isObject(input) || fields.some((field) =>
      !Object.prototype.hasOwnProperty.call(input, field))) throw remoteError(code);
    const value = input;
    const envelopeId = identifier(value.envelopeId, code);
    const envelopeVersion = revision(value.envelopeVersion, 1, code);
    const kinds = options.allowRecovery
      ? ["device", "passkey-prf", "device-transfer", "recovery"]
      : ["device", "passkey-prf", "device-transfer"];
    if (!kinds.includes(value.envelopeKind)) throw remoteError(code);
    if (value.envelopeKind === "device") {
      if (value.credentialId !== null || value.kdf !== "none"
          || value.kdfSalt !== null || value.derivationVersion !== null) throw remoteError(code);
      identifier(value.deviceId, code);
    } else {
      if (value.deviceId !== null || value.kdf !== "HKDF-SHA-256"
          || value.derivationVersion !== 1) throw remoteError(code);
      canonicalBase64url(value.kdfSalt, 32, code);
      if (value.envelopeKind === "passkey-prf") identifier(value.credentialId, code);
      else if (value.credentialId !== null) throw remoteError(code);
    }
    return frozen({
      envelopeId,
      envelopeKind: value.envelopeKind,
      envelopeVersion,
      deviceId: value.deviceId,
      credentialId: value.credentialId,
      kdf: value.kdf,
      kdfSalt: value.kdfSalt,
      derivationVersion: value.derivationVersion,
    });
  }

  function validateActiveEnvelope(input, allowRecovery, contract, code = "remote-request-invalid") {
    const value = exactObject(input, [
      "envelopeId", "envelopeKind", "envelopeVersion", "deviceId", "credentialId",
      "kdf", "kdfSalt", "derivationVersion", "encryptedEnvelope",
    ], [
      "envelopeId", "envelopeKind", "envelopeVersion", "deviceId", "credentialId",
      "kdf", "kdfSalt", "derivationVersion", "encryptedEnvelope",
    ], code);
    const metadata = validateEnvelopeFields(value, { allowRecovery, code });
    let record;
    try {
      record = contract.validateOpaqueMasterKeyEnvelopeRecord(value.encryptedEnvelope);
    } catch (_error) {
      throw remoteError(code);
    }
    if (!isObject(record) || record.ok !== true || !isObject(record.value)
        || canonicalBase64urlByteLength(record.value.ciphertext) !== 48) {
      throw remoteError(code);
    }
    return frozen({ ...metadata, encryptedEnvelope: record.value });
  }

  function validateRecoveryVerifier(input, code = "remote-request-invalid") {
    const value = exactObject(input, ["version", "algorithm", "publicKeyFormat", "publicKey"],
      ["version", "algorithm", "publicKeyFormat", "publicKey"], code);
    if (value.version !== 1 || value.algorithm !== "Ed25519" || value.publicKeyFormat !== "spki") {
      throw remoteError(code);
    }
    const size = canonicalBase64urlByteLength(value.publicKey);
    if (size < 32 || size > 4096) throw remoteError(code);
    return frozen(value);
  }

  function validateRecoveryProof(input) {
    const value = exactObject(input, ["version", "algorithm", "signature"],
      ["version", "algorithm", "signature"], "remote-request-invalid");
    const size = canonicalBase64urlByteLength(value.signature);
    if (value.version !== 1 || value.algorithm !== "Ed25519" || size < 32 || size > 1024) {
      throw remoteError("remote-request-invalid");
    }
    return frozen(value);
  }

  function validateKeyMutation(input, additionalFields) {
    const common = [
      "apiVersion", "operationId", "logicalChangeId", "attemptKind",
      "syncedPocketId", "expectedKeySetVersion",
    ];
    const fields = [...common, ...additionalFields];
    const request = exactObject(input, fields, fields, "remote-request-invalid");
    if (request.apiVersion !== POLICY.apiVersion
        || !["new-change", "idempotent-retry"].includes(request.attemptKind)
        || revision(request.expectedKeySetVersion) >= Number.MAX_SAFE_INTEGER) {
      throw remoteError("remote-request-invalid");
    }
    return {
      ...request,
      operationId: identifier(request.operationId),
      logicalChangeId: identifier(request.logicalChangeId),
      syncedPocketId: identifier(request.syncedPocketId),
    };
  }

  function validateListEnvelopesRequest(input) {
    const value = exactObject(input, ["apiVersion", "operationId", "syncedPocketId"],
      ["apiVersion", "operationId", "syncedPocketId"], "remote-request-invalid");
    if (value.apiVersion !== POLICY.apiVersion) throw remoteError("remote-request-invalid");
    return frozen({ apiVersion: 1, operationId: identifier(value.operationId),
      syncedPocketId: identifier(value.syncedPocketId) });
  }

  function validateListEnvelopesResponse(input, requestInput) {
    const request = validateListEnvelopesRequest(requestInput);
    const response = exactObject(input, ["apiVersion", "ok", "operationId", "syncedPocketId",
      "keySetVersion", "recoveryStatus", "recoveryVersion", "envelopes"],
    ["apiVersion", "ok", "operationId", "syncedPocketId", "keySetVersion",
      "recoveryStatus", "recoveryVersion", "envelopes"]);
    const keySetVersion = revision(response.keySetVersion, 0, "remote-response-invalid");
    const recoveryVersion = revision(response.recoveryVersion, 0, "remote-response-invalid");
    if (response.apiVersion !== 1 || response.ok !== true
        || response.operationId !== request.operationId
        || response.syncedPocketId !== request.syncedPocketId
        || !["unconfigured", "ready", "rotation-required"].includes(response.recoveryStatus)
        || !Array.isArray(response.envelopes)
        || (keySetVersion === 0 && (response.recoveryStatus !== "unconfigured"
          || recoveryVersion !== 0 || response.envelopes.length !== 0))
        || (response.recoveryStatus === "unconfigured" && recoveryVersion !== 0)
        || (response.recoveryStatus !== "unconfigured" && recoveryVersion < 1)) {
      throw remoteError("remote-response-invalid");
    }
    let previous = null;
    const envelopes = response.envelopes.map((item) => {
      const value = exactObject(item, ["envelopeId", "envelopeKind", "envelopeVersion", "status",
        "deviceId", "credentialId", "kdf", "kdfSalt", "derivationVersion", "createdAt", "revokedAt"],
      ["envelopeId", "envelopeKind", "envelopeVersion", "status", "deviceId", "credentialId",
        "kdf", "kdfSalt", "derivationVersion", "createdAt", "revokedAt"]);
      const metadata = validateEnvelopeFields(value, { allowRecovery: true,
        code: "remote-response-invalid" });
      if (!["active", "revoked"].includes(value.status)
          || (value.status === "active" && value.revokedAt !== null)
          || (value.status === "revoked" && value.revokedAt === null)) {
        throw remoteError("remote-response-invalid");
      }
      canonicalTimestamp(value.createdAt);
      if (value.revokedAt !== null) canonicalTimestamp(value.revokedAt);
      if (previous !== null && metadata.envelopeId <= previous) {
        throw remoteError("remote-response-invalid");
      }
      previous = metadata.envelopeId;
      return frozen({ ...metadata, status: value.status, createdAt: value.createdAt,
        revokedAt: value.revokedAt });
    });
    return frozen({ ...response, keySetVersion, recoveryVersion, envelopes });
  }

  function validateDownloadEnvelopeRequest(input) {
    const value = exactObject(input, ["apiVersion", "operationId", "syncedPocketId", "envelopeId"],
      ["apiVersion", "operationId", "syncedPocketId", "envelopeId"], "remote-request-invalid");
    if (value.apiVersion !== 1) throw remoteError("remote-request-invalid");
    return frozen({ apiVersion: 1, operationId: identifier(value.operationId),
      syncedPocketId: identifier(value.syncedPocketId), envelopeId: identifier(value.envelopeId) });
  }

  function validateDownloadEnvelopeResponse(input, requestInput, contractInput) {
    const request = validateDownloadEnvelopeRequest(requestInput);
    const contract = contractInput || securityContract(true);
    const response = exactObject(input, ["apiVersion", "ok", "operationId", "syncedPocketId",
      "keySetVersion", "envelope"], ["apiVersion", "ok", "operationId", "syncedPocketId",
      "keySetVersion", "envelope"]);
    if (response.apiVersion !== 1 || response.ok !== true
        || response.operationId !== request.operationId
        || response.syncedPocketId !== request.syncedPocketId) throw remoteError("remote-response-invalid");
    revision(response.keySetVersion, 1, "remote-response-invalid");
    const envelopeValue = exactObject(response.envelope, ["envelopeId", "envelopeKind",
      "envelopeVersion", "deviceId", "credentialId", "kdf", "kdfSalt", "derivationVersion",
      "encryptedEnvelopeSize", "encryptedEnvelope"], ["envelopeId", "envelopeKind",
      "envelopeVersion", "deviceId", "credentialId", "kdf", "kdfSalt", "derivationVersion",
      "encryptedEnvelopeSize", "encryptedEnvelope"]);
    const { encryptedEnvelopeSize: _size, ...activeEnvelope } = envelopeValue;
    const envelope = validateActiveEnvelope(activeEnvelope, true, contract, "remote-response-invalid");
    if (envelope.envelopeId !== request.envelopeId || envelopeValue.encryptedEnvelopeSize !== 48) {
      throw remoteError("remote-response-invalid");
    }
    return frozen({ ...response, envelope: { ...envelope, encryptedEnvelopeSize: 48 } });
  }

  function validateAddEnvelopeRequest(input, contractInput) {
    const contract = contractInput || securityContract(true);
    const request = validateKeyMutation(input, ["envelope"]);
    return frozen({ ...request,
      envelope: validateActiveEnvelope(request.envelope, false, contract) });
  }

  function validateRevokeEnvelopeRequest(input) {
    const request = validateKeyMutation(input, ["envelopeId"]);
    return frozen({ ...request, envelopeId: identifier(request.envelopeId) });
  }

  function validateKeyMutationResponse(status, input, requestInput, options = {}) {
    const request = requestInput;
    if (status === 200) {
      const fields = ["apiVersion", "ok", "status", "wrote", "operationId", "replayed",
        "keySetVersion", ...(options.committedFields || [])];
      const response = exactObject(input, fields, fields);
      if (response.apiVersion !== 1 || response.ok !== true || response.status !== "committed"
          || response.wrote !== true || response.operationId !== request.operationId
          || typeof response.replayed !== "boolean"
          || (request.attemptKind === "new-change" && response.replayed)
          || response.keySetVersion !== request.expectedKeySetVersion + 1) {
        throw remoteError("remote-response-invalid");
      }
      return response;
    }
    if (status === 409) {
      const fields = ["apiVersion", "ok", "status", "wrote", "conflict", "operationId",
        "actualKeySetVersion", ...(options.conflictFields || [])];
      const response = exactObject(input, fields, fields);
      const actual = revision(response.actualKeySetVersion, 0, "remote-response-invalid");
      if (response.apiVersion !== 1 || response.ok !== false || response.status !== "conflict"
          || response.wrote !== false || response.conflict !== true
          || response.operationId !== request.operationId
          || (!options.allowMatchingKeySet && actual === request.expectedKeySetVersion)) {
        throw remoteError("remote-response-invalid");
      }
      return response;
    }
    throw remoteError("remote-response-invalid");
  }

  function validateAddEnvelopeResponse(status, input, requestInput, contractInput) {
    const request = validateAddEnvelopeRequest(requestInput, contractInput);
    if (status === 409 && request.envelope.envelopeKind === "device"
        && input?.status === "master-key-rotation-required") {
      const rotation = exactObject(input, ["apiVersion", "ok", "status", "wrote", "operationId"],
        ["apiVersion", "ok", "status", "wrote", "operationId"]);
      if (rotation.apiVersion === 1 && rotation.ok === false
          && rotation.status === "master-key-rotation-required" && rotation.wrote === false
          && rotation.operationId === request.operationId) return frozen(rotation);
    }
    const response = validateKeyMutationResponse(status, input, request, request.envelope.envelopeKind === "device"
      ? { committedFields: ["masterKeyGeneration", "masterKeyContentEncryptionLimit"] } : {});
    if (status === 200 && request.envelope.envelopeKind === "device") {
      if (response.masterKeyGeneration !== 1
          || response.masterKeyContentEncryptionLimit !== 2 ** 20) {
        throw remoteError("remote-response-invalid");
      }
    }
    return frozen(response);
  }

  function validateRevokeEnvelopeResponse(status, input, requestInput) {
    const request = validateRevokeEnvelopeRequest(requestInput);
    return frozen(validateKeyMutationResponse(status, input, request));
  }

  function validateInitialiseRecoveryRequest(input, contractInput) {
    const contract = contractInput || securityContract(true);
    const request = validateKeyMutation(input, ["recoveryVerifier", "recoveryEnvelope"]);
    const verifier = validateRecoveryVerifier(request.recoveryVerifier);
    const envelope = validateActiveEnvelope(request.recoveryEnvelope, true, contract);
    if (verifier.version !== 1 || envelope.envelopeKind !== "recovery"
        || envelope.envelopeVersion !== 1) throw remoteError("remote-request-invalid");
    return frozen({ ...request, recoveryVerifier: verifier, recoveryEnvelope: envelope });
  }

  function validateInitialiseRecoveryResponse(status, input, requestInput, contractInput) {
    const request = validateInitialiseRecoveryRequest(requestInput, contractInput);
    const response = validateKeyMutationResponse(status, input, request,
      { committedFields: ["recoveryVersion", "accountLocator", "recoveryCopyRequired"] });
    if (status === 200 && (response.recoveryVersion !== 1
        || response.recoveryCopyRequired !== true)) throw remoteError("remote-response-invalid");
    if (status === 200) identifier(response.accountLocator, "remote-response-invalid");
    return frozen(response);
  }

  function validateBeginRecoveryRequest(input) {
    const request = exactObject(input, ["apiVersion", "operationId", "accountLocator", "deviceId"],
      ["apiVersion", "operationId", "accountLocator", "deviceId"], "remote-request-invalid");
    if (request.apiVersion !== 1) throw remoteError("remote-request-invalid");
    return frozen({ apiVersion: 1, operationId: identifier(request.operationId),
      accountLocator: identifier(request.accountLocator), deviceId: identifier(request.deviceId) });
  }

  function validateBeginRecoveryResponse(input, requestInput, now = Date.now, contractInput) {
    const request = validateBeginRecoveryRequest(requestInput);
    const contract = contractInput || accountContract();
    const response = exactObject(input, ["apiVersion", "ok", "operationId", "recoveryCeremonyId",
      "expiresAt", "recoveryVersion", "keySetVersion", "challenge",
      "prfEvaluationInput", "publicKeyCreationOptions"], ["apiVersion", "ok", "operationId",
      "recoveryCeremonyId", "expiresAt", "recoveryVersion", "keySetVersion", "challenge",
      "prfEvaluationInput", "publicKeyCreationOptions"]);
    if (response.apiVersion !== 1 || response.ok !== true
        || response.operationId !== request.operationId) throw remoteError("remote-response-invalid");
    identifier(response.recoveryCeremonyId, "remote-response-invalid");
    const recoveryVersion = revision(response.recoveryVersion, 1, "remote-response-invalid");
    canonicalBase64url(response.challenge, 32, "remote-response-invalid");
    revision(response.keySetVersion, 1, "remote-response-invalid");
    try {
      contract.validateBeginRegistrationResponse({ apiVersion: 1, ok: true,
        operationId: response.operationId, ceremonyId: response.recoveryCeremonyId,
        expiresAt: response.expiresAt, prfEvaluationInput: response.prfEvaluationInput,
        publicKeyCreationOptions: response.publicKeyCreationOptions },
      request.operationId, currentMilliseconds(now));
    } catch (_error) {
      throw remoteError("remote-response-invalid");
    }
    return frozen(response);
  }

  function validateFinishRecoveryRequest(input, contractInput) {
    const contract = contractInput || accountContract();
    const request = exactObject(input, ["apiVersion", "operationId", "recoveryCeremonyId",
      "deviceId", "proof", "credential"], ["apiVersion", "operationId", "recoveryCeremonyId",
      "deviceId", "proof", "credential"], "remote-request-invalid");
    if (request.apiVersion !== 1) throw remoteError("remote-request-invalid");
    let registration;
    try {
      registration = contract.validateFinishRegistrationRequest({ apiVersion: 1,
        operationId: request.operationId, ceremonyId: request.recoveryCeremonyId,
        deviceId: request.deviceId, credential: request.credential });
    } catch (_error) {
      throw remoteError("remote-request-invalid");
    }
    return frozen({ apiVersion: 1, operationId: registration.operationId,
      recoveryCeremonyId: registration.ceremonyId, deviceId: registration.deviceId,
      proof: validateRecoveryProof(request.proof), credential: registration.credential });
  }

  function validateFinishRecoveryResponse(input, requestInput, accountInput, securityInput) {
    const account = accountInput || accountContract();
    const security = securityInput || securityContract(true);
    const request = validateFinishRecoveryRequest(requestInput, account);
    const response = exactObject(input, ["apiVersion", "ok", "operationId", "recoveryCeremonyId",
      "accountId", "credentialId", "credentialVersion", "accountPolicyVersion", "prfEvaluationInput",
      "syncedPocketId", "keySetVersion", "recoveryVersion", "recoveryEnvelope",
      "replacementCopyRequired"], ["apiVersion", "ok", "operationId", "recoveryCeremonyId",
      "accountId", "credentialId", "credentialVersion", "accountPolicyVersion", "prfEvaluationInput",
      "syncedPocketId", "keySetVersion", "recoveryVersion", "recoveryEnvelope",
      "replacementCopyRequired"]);
    if (response.apiVersion !== 1 || response.ok !== true
        || response.operationId !== request.operationId
        || response.recoveryCeremonyId !== request.recoveryCeremonyId
        || response.credentialId !== request.credential.id
        || response.replacementCopyRequired !== true) throw remoteError("remote-response-invalid");
    try {
      account.validateFinishRegistrationResponse({ apiVersion: 1, ok: true,
        operationId: response.operationId, ceremonyId: response.recoveryCeremonyId,
        accountId: response.accountId, credentialId: response.credentialId,
        credentialVersion: response.credentialVersion,
        accountPolicyVersion: response.accountPolicyVersion,
        prfEvaluationInput: response.prfEvaluationInput }, { operationId: request.operationId,
        ceremonyId: request.recoveryCeremonyId, credentialId: request.credential.id,
        prfEvaluationInput: response.prfEvaluationInput });
    } catch (_error) {
      throw remoteError("remote-response-invalid");
    }
    identifier(response.syncedPocketId, "remote-response-invalid");
    revision(response.keySetVersion, 1, "remote-response-invalid");
    const recoveryVersion = revision(response.recoveryVersion, 1, "remote-response-invalid");
    const envelopeValue = exactObject(response.recoveryEnvelope, ["envelopeId", "envelopeKind",
      "envelopeVersion", "deviceId", "credentialId", "kdf", "kdfSalt", "derivationVersion",
      "encryptedEnvelopeSize", "encryptedEnvelope"], ["envelopeId", "envelopeKind",
      "envelopeVersion", "deviceId", "credentialId", "kdf", "kdfSalt", "derivationVersion",
      "encryptedEnvelopeSize", "encryptedEnvelope"]);
    const { encryptedEnvelopeSize: _size, ...activeEnvelope } = envelopeValue;
    const envelope = validateActiveEnvelope(activeEnvelope, true, security, "remote-response-invalid");
    if (envelope.envelopeKind !== "recovery" || envelope.envelopeVersion !== recoveryVersion
        || envelopeValue.encryptedEnvelopeSize !== 48) throw remoteError("remote-response-invalid");
    return frozen({ ...response, recoveryEnvelope: { ...envelope, encryptedEnvelopeSize: 48 } });
  }

  function validateRotateRecoveryRequest(input, contractInput) {
    const contract = contractInput || securityContract(true);
    const request = validateKeyMutation(input, ["recoveryOperationId", "expectedRecoveryVersion",
      "recoveryVerifier", "recoveryEnvelope"]);
    if (revision(request.expectedRecoveryVersion, 1) >= Number.MAX_SAFE_INTEGER) {
      throw remoteError("remote-request-invalid");
    }
    const verifier = validateRecoveryVerifier(request.recoveryVerifier);
    const envelope = validateActiveEnvelope(request.recoveryEnvelope, true, contract);
    if (verifier.version !== 1
        || envelope.envelopeKind !== "recovery"
        || envelope.envelopeVersion !== request.expectedRecoveryVersion + 1) {
      throw remoteError("remote-request-invalid");
    }
    return frozen({ ...request, recoveryOperationId: identifier(request.recoveryOperationId),
      recoveryVerifier: verifier, recoveryEnvelope: envelope });
  }

  function validateRotateRecoveryResponse(status, input, requestInput, contractInput) {
    const request = validateRotateRecoveryRequest(requestInput, contractInput);
    const response = validateKeyMutationResponse(status, input, request, {
      committedFields: ["recoveryVersion", "accountLocator", "previousRecoveryInvalidated",
        "replacementCopyRequired"],
      conflictFields: ["actualRecoveryVersion"],
      allowMatchingKeySet: true,
    });
    if (status === 200) {
      if (response.recoveryVersion !== request.expectedRecoveryVersion + 1
          || response.previousRecoveryInvalidated !== true
          || response.replacementCopyRequired !== true) throw remoteError("remote-response-invalid");
      identifier(response.accountLocator, "remote-response-invalid");
    } else {
      const actualRecoveryVersion = revision(response.actualRecoveryVersion, 0,
        "remote-response-invalid");
      if (response.actualKeySetVersion === request.expectedKeySetVersion
          && actualRecoveryVersion === request.expectedRecoveryVersion) {
        throw remoteError("remote-response-invalid");
      }
    }
    return frozen(response);
  }

  function createEnvelopeService({ transport } = {}) {
    const remote = validateTransport(transport);
    const contract = securityContract(true);
    return Object.freeze({
      async listEnvelopes(input) {
        const request = validateListEnvelopesRequest(input);
        const result = validateTransportResult(await callTransport(remote, "listEnvelopes", request), [200]);
        return validateListEnvelopesResponse(result.body, request);
      },
      async downloadEnvelope(input) {
        const request = validateDownloadEnvelopeRequest(input);
        const result = validateTransportResult(await callTransport(remote, "downloadEnvelope", request), [200]);
        return validateDownloadEnvelopeResponse(result.body, request, contract);
      },
      async addEnvelope(input) {
        const request = validateAddEnvelopeRequest(input, contract);
        const result = validateTransportResult(await callTransport(remote, "addEnvelope", request), [200, 409]);
        return validateAddEnvelopeResponse(result.status, result.body, request, contract);
      },
      async revokeEnvelope(input) {
        const request = validateRevokeEnvelopeRequest(input);
        const result = validateTransportResult(await callTransport(remote, "revokeEnvelope", request), [200, 409]);
        return validateRevokeEnvelopeResponse(result.status, result.body, request);
      },
    });
  }

  function createRecoveryService({ transport, now = Date.now } = {}) {
    const remote = validateTransport(transport);
    const account = accountContract();
    const security = securityContract(true);
    if (typeof now !== "function") throw remoteError("remote-client-invalid");
    return Object.freeze({
      async initialiseRecovery(input) {
        const request = validateInitialiseRecoveryRequest(input, security);
        const result = validateTransportResult(await callTransport(remote, "initialiseRecovery", request), [200, 409]);
        return validateInitialiseRecoveryResponse(result.status, result.body, request, security);
      },
      async beginRecovery(input) {
        const request = validateBeginRecoveryRequest(input);
        const result = validateTransportResult(await callTransport(remote, "beginRecovery", request), [200]);
        return validateBeginRecoveryResponse(result.body, request, now, account);
      },
      async finishRecovery(input) {
        const request = validateFinishRecoveryRequest(input, account);
        const result = validateTransportResult(await callTransport(remote, "finishRecovery", request), [200]);
        return validateFinishRecoveryResponse(result.body, request, account, security);
      },
      async rotateRecovery(input) {
        const request = validateRotateRecoveryRequest(input, security);
        const result = validateTransportResult(await callTransport(remote, "rotateRecovery", request), [200, 409]);
        return validateRotateRecoveryResponse(result.status, result.body, request, security);
      },
    });
  }

  function createContentService({ transport } = {}) {
    const remote = validateTransport(transport);
    const contract = securityContract();

    async function readRevision(input) {
      const request = validateReadRevisionRequest(input);
      const result = validateTransportResult(
        await callTransport(remote, "readRevision", request),
        [200]
      );
      return validateReadRevisionResponse(result.body, request);
    }

    async function downloadEncryptedRecord(input) {
      const request = validateDownloadRequest(input);
      const result = validateTransportResult(
        await callTransport(remote, "downloadEncryptedRecord", request),
        [200]
      );
      return validateDownloadResponse(result.body, request, contract);
    }

    async function conditionalUpload(input) {
      const request = validateConditionalUploadRequest(input, contract);
      const result = validateTransportResult(
        await callTransport(remote, "conditionalUpload", request),
        [200, 409]
      );
      return validateConditionalUploadResponse(result.status, result.body, request);
    }

    const service = { readRevision, downloadEncryptedRecord, conditionalUpload };
    if (typeof transport.preflightRequest === "function") {
      service.preflightConditionalUpload = function preflightConditionalUpload(input) {
        const request = validateConditionalUploadRequest(input, contract);
        transport.preflightRequest("conditionalUpload", request);
        return request;
      };
    }
    return Object.freeze(service);
  }

  function createPocketDiscoveryService({ transport } = {}) {
    const remote = validateTransport(transport);
    return Object.freeze({
      async readSyncedPocket(input) {
        const request = validateReadSyncedPocketRequest(input);
        const result = validateTransportResult(await callTransport(remote, "readSyncedPocket", request), [200]);
        return validateReadSyncedPocketResponse(result.body, request);
      },
    });
  }

  global.PocketSyncRemoteClient = Object.freeze({
    POLICY,
    ROUTES,
    validateReadRevisionRequest,
    validateReadRevisionResponse,
    validateReadSyncedPocketRequest,
    validateReadSyncedPocketResponse,
    validateDownloadRequest,
    validateDownloadResponse,
    validateConditionalUploadRequest,
    validateConditionalUploadResponse,
    validateListEnvelopesRequest,
    validateListEnvelopesResponse,
    validateDownloadEnvelopeRequest,
    validateDownloadEnvelopeResponse,
    validateAddEnvelopeRequest,
    validateAddEnvelopeResponse,
    validateRevokeEnvelopeRequest,
    validateRevokeEnvelopeResponse,
    validateInitialiseRecoveryRequest,
    validateInitialiseRecoveryResponse,
    validateBeginRecoveryRequest,
    validateBeginRecoveryResponse,
    validateFinishRecoveryRequest,
    validateFinishRecoveryResponse,
    validateRotateRecoveryRequest,
    validateRotateRecoveryResponse,
    createBrowserJsonTransport,
    createAccountService,
    createContentService,
    createPocketDiscoveryService,
    createEnvelopeService,
    createRecoveryService,
  });
})(typeof window !== "undefined" ? window : globalThis);
