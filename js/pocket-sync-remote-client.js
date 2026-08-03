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
    readRevision: "/pockets/revision/read",
    downloadEncryptedRecord: "/pockets/content/download",
    conditionalUpload: "/pockets/content/conditional-upload",
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

  function identifier(value) {
    if (typeof value !== "string"
        || value.length < 1
        || value.length > IDENTIFIER_LIMIT
        || value !== value.trim()) {
      throw remoteError("remote-request-invalid");
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
      statuses: routeName === "conditionalUpload" ? Object.freeze([200, 409]) : Object.freeze([200]),
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
      if (prototype !== Object.prototype && prototype !== null) {
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
      if (!isObject(requestBody)) throw remoteError("remote-request-invalid");
      validateJsonValue(requestBody, new Set());
      let bodyText;
      try {
        bodyText = JSON.stringify(requestBody);
      } catch (_error) {
        throw remoteError("remote-request-invalid");
      }
      if (typeof bodyText !== "string"
          || encodedSize(encoder, bodyText, "remote-request-invalid") > limits.request) {
        throw remoteError("remote-request-invalid");
      }
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

    return Object.freeze({ request });
  }

  function validateTransport(transport) {
    if (!isObject(transport)
        || Object.keys(transport).length !== 1
        || Object.keys(transport)[0] !== "request"
        || typeof transport.request !== "function") {
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
      });
    }

    return Object.freeze({
      beginRegistration,
      finishRegistration,
      beginAuthentication,
      finishAuthentication,
    });
  }

  function securityContract() {
    const contract = global.PocketSyncSecurityContract;
    if (!isObject(contract)
        || typeof contract.validateOpaqueEncryptedRecord !== "function"
        || typeof contract.buildConditionalWriteRequest !== "function") {
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

    return Object.freeze({ readRevision, downloadEncryptedRecord, conditionalUpload });
  }

  global.PocketSyncRemoteClient = Object.freeze({
    POLICY,
    ROUTES,
    validateReadRevisionRequest,
    validateReadRevisionResponse,
    validateDownloadRequest,
    validateDownloadResponse,
    validateConditionalUploadRequest,
    validateConditionalUploadResponse,
    createBrowserJsonTransport,
    createAccountService,
    createContentService,
  });
})(typeof window !== "undefined" ? window : globalThis);
