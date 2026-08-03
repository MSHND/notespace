/* Synced Pocket account and passkey client foundation.

This module is intentionally unloaded. It defines one explicit WebAuthn
ceremony boundary without adding UI, transport, persistence, or ownership.
*/

(function initialisePocketSyncAccountClient(global) {
  "use strict";

  const POLICY = Object.freeze({
    apiVersion: 1,
    credentialType: "public-key",
    prfEvaluationInputBytes: 32,
    prfOutputBytes: 32,
    minimumChallengeBytes: 32,
    userVerification: "required",
    residentKey: "required",
    attestation: "none",
    conditionalMediation: false,
    automaticRetry: false,
    accountAuthenticationUnlocksContent: false,
  });
  const IDENTIFIER_LIMIT = 160;
  const USER_ID_LIMIT = 64;
  const BASE64URL_PATTERN = /^[A-Za-z0-9_-]+$/;
  const TRANSPORTS = Object.freeze([
    "usb",
    "nfc",
    "ble",
    "smart-card",
    "hybrid",
    "internal",
  ]);
  const REGISTRATION_OPTION_FIELDS = Object.freeze([
    "rp",
    "user",
    "challenge",
    "pubKeyCredParams",
    "timeout",
    "excludeCredentials",
    "authenticatorSelection",
    "attestation",
    "extensions",
  ]);
  const AUTHENTICATION_OPTION_FIELDS = Object.freeze([
    "challenge",
    "timeout",
    "rpId",
    "allowCredentials",
    "userVerification",
    "extensions",
  ]);
  const REGISTRATION_CREDENTIAL_FIELDS = Object.freeze([
    "id",
    "rawId",
    "response",
    "authenticatorAttachment",
    "clientExtensionResults",
    "type",
  ]);
  const REGISTRATION_RESPONSE_FIELDS = Object.freeze([
    "clientDataJSON",
    "authenticatorData",
    "transports",
    "publicKey",
    "publicKeyAlgorithm",
    "attestationObject",
  ]);
  const AUTHENTICATION_CREDENTIAL_FIELDS = Object.freeze([
    "id",
    "rawId",
    "response",
    "authenticatorAttachment",
    "clientExtensionResults",
    "type",
  ]);
  const AUTHENTICATION_RESPONSE_FIELDS = Object.freeze([
    "clientDataJSON",
    "authenticatorData",
    "signature",
    "userHandle",
  ]);

  function accountError(code) {
    const error = new Error(`Pocket Sync account client ${code}.`);
    error.code = code;
    return error;
  }

  function isObject(value) {
    return !!value && typeof value === "object" && !Array.isArray(value);
  }

  function exactObject(value, allowed, required, code) {
    if (!isObject(value)
        || Object.keys(value).some((field) => !allowed.includes(field))
        || required.some((field) => !Object.prototype.hasOwnProperty.call(value, field))) {
      throw accountError(code);
    }
    return value;
  }

  function freezeTree(value) {
    if (value instanceof ArrayBuffer || ArrayBuffer.isView(value)) return value;
    if (Array.isArray(value)) return Object.freeze(value.map(freezeTree));
    if (isObject(value)) {
      const copy = {};
      Object.keys(value).forEach((key) => {
        copy[key] = freezeTree(value[key]);
      });
      return Object.freeze(copy);
    }
    return value;
  }

  function identifier(value, code) {
    if (typeof value !== "string"
        || value.length < 1
        || value.length > IDENTIFIER_LIMIT
        || value !== value.trim()) {
      throw accountError(code);
    }
    return value;
  }

  function positiveInteger(value, code) {
    if (!Number.isSafeInteger(value) || value < 1) throw accountError(code);
    return value;
  }

  function optionalTimeout(value, code) {
    if (value === undefined) return undefined;
    return positiveInteger(value, code);
  }

  function encodeBase64Url(bytes) {
    let binary = "";
    for (let index = 0; index < bytes.byteLength; index += 1) {
      binary += String.fromCharCode(bytes[index]);
    }
    return global.btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
  }

  function decodeBase64Url(value, code) {
    if (typeof value !== "string"
        || value.length < 1
        || value.length % 4 === 1
        || !BASE64URL_PATTERN.test(value)) {
      throw accountError(code);
    }
    let binary;
    try {
      const standard = value.replace(/-/g, "+").replace(/_/g, "/");
      binary = global.atob(standard.padEnd(Math.ceil(standard.length / 4) * 4, "="));
    } catch (_error) {
      throw accountError(code);
    }
    const bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index += 1) {
      bytes[index] = binary.charCodeAt(index);
    }
    if (encodeBase64Url(bytes) !== value) throw accountError(code);
    return bytes;
  }

  function binaryBytes(value, code) {
    let bytes;
    if (value instanceof ArrayBuffer) {
      bytes = new Uint8Array(value.slice(0));
    } else if (ArrayBuffer.isView(value)) {
      bytes = new Uint8Array(value.byteLength);
      bytes.set(new Uint8Array(value.buffer, value.byteOffset, value.byteLength));
    } else {
      throw accountError(code);
    }
    return bytes;
  }

  function bufferCopy(bytes) {
    return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
  }

  function canonicalBinaryText(value, code, options = {}) {
    if (value === null && options.nullable === true) return null;
    const bytes = decodeBase64Url(value, code);
    if (options.minimum !== undefined && bytes.byteLength < options.minimum) {
      throw accountError(code);
    }
    if (options.maximum !== undefined && bytes.byteLength > options.maximum) {
      throw accountError(code);
    }
    if (options.exact !== undefined && bytes.byteLength !== options.exact) {
      throw accountError(code);
    }
    return value;
  }

  function validTimestamp(value, code) {
    if (typeof value !== "string"
        || value.length < 1
        || value.length > 80
        || value !== value.trim()
        || !Number.isFinite(Date.parse(value))) {
      throw accountError(code);
    }
    return value;
  }

  function expiryMilliseconds(value, nowMilliseconds) {
    validTimestamp(value, "passkey-ceremony-mismatch");
    const expires = Date.parse(value);
    if (expires <= nowMilliseconds) throw accountError("passkey-ceremony-expired");
    return expires;
  }

  function validatePrfEvaluationInput(value, code = "prf-evaluation-input-invalid") {
    return canonicalBinaryText(value, code, { exact: POLICY.prfEvaluationInputBytes });
  }

  function normaliseDescriptor(input, code) {
    const descriptor = exactObject(input, ["type", "id", "transports"], ["type", "id"], code);
    if (descriptor.type !== POLICY.credentialType) throw accountError(code);
    const value = {
      type: POLICY.credentialType,
      id: canonicalBinaryText(descriptor.id, code),
    };
    if (descriptor.transports !== undefined) {
      if (!Array.isArray(descriptor.transports)
          || descriptor.transports.some((transport) => !TRANSPORTS.includes(transport))) {
        throw accountError(code);
      }
      value.transports = descriptor.transports.slice();
    }
    return value;
  }

  function normalisePrfInput(input, code) {
    const extensions = exactObject(input, ["prf"], ["prf"], code);
    const prf = exactObject(extensions.prf, ["eval"], ["eval"], code);
    const evaluation = exactObject(prf.eval, ["first"], ["first"], code);
    return {
      prf: {
        eval: {
          first: validatePrfEvaluationInput(evaluation.first, code),
        },
      },
    };
  }

  function validateRegistrationOptions(input, expectedPrfInput) {
    const code = "registration-options-invalid";
    const options = exactObject(input, REGISTRATION_OPTION_FIELDS, [
      "rp",
      "user",
      "challenge",
      "pubKeyCredParams",
      "authenticatorSelection",
      "attestation",
      "extensions",
    ], code);
    const rp = exactObject(options.rp, ["id", "name"], ["id", "name"], code);
    const user = exactObject(options.user, ["id", "name", "displayName"], [
      "id",
      "name",
      "displayName",
    ], code);
    const selection = exactObject(options.authenticatorSelection, [
      "residentKey",
      "userVerification",
    ], ["residentKey", "userVerification"], code);
    if (selection.residentKey !== POLICY.residentKey
        || selection.userVerification !== POLICY.userVerification
        || options.attestation !== POLICY.attestation
        || !Array.isArray(options.pubKeyCredParams)
        || options.pubKeyCredParams.length < 1) {
      throw accountError(code);
    }
    const parameters = options.pubKeyCredParams.map((parameter) => {
      const value = exactObject(parameter, ["type", "alg"], ["type", "alg"], code);
      if (value.type !== POLICY.credentialType || !Number.isSafeInteger(value.alg)) {
        throw accountError(code);
      }
      return { type: POLICY.credentialType, alg: value.alg };
    });
    const extensions = normalisePrfInput(options.extensions, code);
    if (expectedPrfInput !== undefined
        && extensions.prf.eval.first !== validatePrfEvaluationInput(expectedPrfInput, code)) {
      throw accountError(code);
    }
    const normalised = {
      rp: {
        id: identifier(rp.id, code),
        name: identifier(rp.name, code),
      },
      user: {
        id: canonicalBinaryText(user.id, code, { maximum: USER_ID_LIMIT }),
        name: identifier(user.name, code),
        displayName: identifier(user.displayName, code),
      },
      challenge: canonicalBinaryText(options.challenge, code, {
        minimum: POLICY.minimumChallengeBytes,
      }),
      pubKeyCredParams: parameters,
      excludeCredentials: (options.excludeCredentials || []).map((value) => normaliseDescriptor(value, code)),
      authenticatorSelection: {
        residentKey: POLICY.residentKey,
        userVerification: POLICY.userVerification,
      },
      attestation: POLICY.attestation,
      extensions,
    };
    const timeout = optionalTimeout(options.timeout, code);
    if (timeout !== undefined) normalised.timeout = timeout;
    return freezeTree(normalised);
  }

  function validateAuthenticationOptions(input, expectedPrfInput) {
    const code = "authentication-options-invalid";
    const options = exactObject(input, AUTHENTICATION_OPTION_FIELDS, [
      "challenge",
      "rpId",
      "userVerification",
      "extensions",
    ], code);
    if (options.userVerification !== POLICY.userVerification) throw accountError(code);
    const extensions = normalisePrfInput(options.extensions, code);
    if (expectedPrfInput !== undefined
        && extensions.prf.eval.first !== validatePrfEvaluationInput(expectedPrfInput, code)) {
      throw accountError(code);
    }
    const normalised = {
      challenge: canonicalBinaryText(options.challenge, code, {
        minimum: POLICY.minimumChallengeBytes,
      }),
      rpId: identifier(options.rpId, code),
      allowCredentials: (options.allowCredentials || []).map((value) => normaliseDescriptor(value, code)),
      userVerification: POLICY.userVerification,
      extensions,
    };
    const timeout = optionalTimeout(options.timeout, code);
    if (timeout !== undefined) normalised.timeout = timeout;
    return freezeTree(normalised);
  }

  function fallbackRegistrationOptions(json) {
    const challenge = decodeBase64Url(json.challenge, "registration-options-invalid");
    const userId = decodeBase64Url(json.user.id, "registration-options-invalid");
    const prf = decodeBase64Url(json.extensions.prf.eval.first, "registration-options-invalid");
    return freezeTree(Object.assign({}, json, {
      challenge: bufferCopy(challenge),
      user: Object.assign({}, json.user, { id: bufferCopy(userId) }),
      excludeCredentials: json.excludeCredentials.map((descriptor) => Object.assign({}, descriptor, {
        id: bufferCopy(decodeBase64Url(descriptor.id, "registration-options-invalid")),
      })),
      extensions: { prf: { eval: { first: bufferCopy(prf) } } },
    }));
  }

  function fallbackAuthenticationOptions(json) {
    const challenge = decodeBase64Url(json.challenge, "authentication-options-invalid");
    const prf = decodeBase64Url(json.extensions.prf.eval.first, "authentication-options-invalid");
    return freezeTree(Object.assign({}, json, {
      challenge: bufferCopy(challenge),
      allowCredentials: json.allowCredentials.map((descriptor) => Object.assign({}, descriptor, {
        id: bufferCopy(decodeBase64Url(descriptor.id, "authentication-options-invalid")),
      })),
      extensions: { prf: { eval: { first: bufferCopy(prf) } } },
    }));
  }

  function parseRegistrationOptions(input, expectedPrfInput, publicKeyCredential) {
    const json = validateRegistrationOptions(input, expectedPrfInput);
    const parser = publicKeyCredential && publicKeyCredential.parseCreationOptionsFromJSON;
    if (typeof parser === "function") {
      try {
        return parser.call(publicKeyCredential, json);
      } catch (_error) {
        throw accountError("registration-options-invalid");
      }
    }
    return fallbackRegistrationOptions(json);
  }

  function parseAuthenticationOptions(input, expectedPrfInput, publicKeyCredential) {
    const json = validateAuthenticationOptions(input, expectedPrfInput);
    const parser = publicKeyCredential && publicKeyCredential.parseRequestOptionsFromJSON;
    if (typeof parser === "function") {
      try {
        return parser.call(publicKeyCredential, json);
      } catch (_error) {
        throw accountError("authentication-options-invalid");
      }
    }
    return fallbackAuthenticationOptions(json);
  }

  function unavailablePrf(evaluationInput, status) {
    return Object.freeze({ status, evaluationInput });
  }

  function availablePrf(evaluationInput, value) {
    const outputBytes = binaryBytes(value, "prf-output-invalid");
    if (outputBytes.byteLength !== POLICY.prfOutputBytes) {
      outputBytes.fill(0);
      throw accountError("prf-output-invalid");
    }
    return Object.freeze({ status: "available", evaluationInput, outputBytes });
  }

  function inspectPrfResult(ceremonyKind, extensionResults, evaluationInput) {
    if (!["registration", "authentication"].includes(ceremonyKind)) {
      throw accountError("prf-output-invalid");
    }
    const requested = evaluationInput !== undefined && evaluationInput !== null;
    const publicInput = requested
      ? validatePrfEvaluationInput(evaluationInput, "prf-output-invalid")
      : null;
    const extensions = exactObject(
      extensionResults,
      ["prf"],
      [],
      "prf-output-invalid"
    );
    if (!Object.prototype.hasOwnProperty.call(extensions, "prf")) {
      return unavailablePrf(publicInput, "unavailable");
    }
    if (!requested) throw accountError("prf-output-invalid");
    const prf = exactObject(
      extensions.prf,
      ceremonyKind === "registration" ? ["enabled", "results"] : ["results"],
      [],
      "prf-output-invalid"
    );
    if (ceremonyKind === "registration") {
      if (typeof prf.enabled !== "boolean") throw accountError("prf-output-invalid");
      if (prf.enabled === false) {
        if (prf.results !== undefined) throw accountError("prf-output-invalid");
        return unavailablePrf(publicInput, "unavailable");
      }
    }
    if (prf.results === undefined) {
      return unavailablePrf(
        publicInput,
        ceremonyKind === "registration" ? "enabled-no-output" : "unavailable"
      );
    }
    const results = exactObject(prf.results, ["first"], [], "prf-output-invalid");
    if (!Object.prototype.hasOwnProperty.call(results, "first")) {
      return unavailablePrf(
        publicInput,
        ceremonyKind === "registration" ? "enabled-no-output" : "unavailable"
      );
    }
    return availablePrf(publicInput, results.first);
  }

  function readClientExtensions(credential, code) {
    if (!credential || typeof credential.getClientExtensionResults !== "function") {
      throw accountError(code);
    }
    let value;
    try {
      value = credential.getClientExtensionResults();
    } catch (_error) {
      throw accountError(code);
    }
    if (!isObject(value)) throw accountError(code);
    return value;
  }

  function normaliseTransports(value, code) {
    if (!Array.isArray(value) || value.some((transport) => !TRANSPORTS.includes(transport))) {
      throw accountError(code);
    }
    return value.slice();
  }

  function safeRegistrationExtensions(extensionResults) {
    if (!Object.prototype.hasOwnProperty.call(extensionResults, "prf")) return {};
    const prf = extensionResults.prf;
    if (!isObject(prf) || typeof prf.enabled !== "boolean") {
      throw accountError("prf-output-invalid");
    }
    return { prf: { enabled: prf.enabled } };
  }

  function validateNativeExtensions(value, registration, code) {
    const extensions = exactObject(value, ["prf"], [], code);
    if (!Object.prototype.hasOwnProperty.call(extensions, "prf")) return;
    const allowed = registration ? ["enabled", "results"] : ["results"];
    exactObject(extensions.prf, allowed, [], code);
  }

  function normaliseRegistrationJson(input, options = {}) {
    const code = "passkey-registration-response-invalid";
    const credential = exactObject(input, REGISTRATION_CREDENTIAL_FIELDS, [
      "id",
      "rawId",
      "response",
      "clientExtensionResults",
      "type",
    ], code);
    if (credential.type !== POLICY.credentialType) throw accountError(code);
    const id = canonicalBinaryText(credential.id, code);
    const rawId = canonicalBinaryText(credential.rawId, code);
    if (id !== rawId) throw accountError(code);
    const response = exactObject(credential.response, REGISTRATION_RESPONSE_FIELDS, [
      "clientDataJSON",
      "attestationObject",
    ], code);
    const normalisedResponse = {
      clientDataJSON: canonicalBinaryText(response.clientDataJSON, code),
      attestationObject: canonicalBinaryText(response.attestationObject, code),
    };
    if (response.authenticatorData !== undefined) {
      normalisedResponse.authenticatorData = canonicalBinaryText(response.authenticatorData, code);
    }
    if (response.transports !== undefined) {
      normalisedResponse.transports = normaliseTransports(response.transports, code);
    }
    if (response.publicKey !== undefined && response.publicKey !== null) {
      normalisedResponse.publicKey = canonicalBinaryText(response.publicKey, code);
    }
    if (response.publicKeyAlgorithm !== undefined) {
      if (!Number.isSafeInteger(response.publicKeyAlgorithm)) throw accountError(code);
      normalisedResponse.publicKeyAlgorithm = response.publicKeyAlgorithm;
    }
    if (options.native === true) {
      validateNativeExtensions(credential.clientExtensionResults, true, code);
    } else {
      const extensions = exactObject(credential.clientExtensionResults, ["prf"], [], code);
      if (extensions.prf !== undefined) {
        const prf = exactObject(extensions.prf, ["enabled"], ["enabled"], code);
        if (typeof prf.enabled !== "boolean") throw accountError(code);
      }
    }
    const normalised = {
      id,
      rawId,
      response: normalisedResponse,
      clientExtensionResults: options.safeExtensions || credential.clientExtensionResults,
      type: POLICY.credentialType,
    };
    if (credential.authenticatorAttachment !== undefined
        && credential.authenticatorAttachment !== null) {
      normalised.authenticatorAttachment = identifier(credential.authenticatorAttachment, code);
    }
    return freezeTree(normalised);
  }

  function normaliseAuthenticationJson(input, options = {}) {
    const code = "passkey-authentication-response-invalid";
    const credential = exactObject(input, AUTHENTICATION_CREDENTIAL_FIELDS, [
      "id",
      "rawId",
      "response",
      "clientExtensionResults",
      "type",
    ], code);
    if (credential.type !== POLICY.credentialType) throw accountError(code);
    const id = canonicalBinaryText(credential.id, code);
    const rawId = canonicalBinaryText(credential.rawId, code);
    if (id !== rawId) throw accountError(code);
    const response = exactObject(credential.response, AUTHENTICATION_RESPONSE_FIELDS, [
      "clientDataJSON",
      "authenticatorData",
      "signature",
    ], code);
    const normalisedResponse = {
      clientDataJSON: canonicalBinaryText(response.clientDataJSON, code),
      authenticatorData: canonicalBinaryText(response.authenticatorData, code),
      signature: canonicalBinaryText(response.signature, code),
    };
    if (response.userHandle !== undefined) {
      normalisedResponse.userHandle = canonicalBinaryText(response.userHandle, code, { nullable: true });
    }
    if (options.native === true) {
      validateNativeExtensions(credential.clientExtensionResults, false, code);
    } else if (!isObject(credential.clientExtensionResults)
        || Object.keys(credential.clientExtensionResults).length !== 0) {
      throw accountError(code);
    }
    const normalised = {
      id,
      rawId,
      response: normalisedResponse,
      clientExtensionResults: {},
      type: POLICY.credentialType,
    };
    if (credential.authenticatorAttachment !== undefined
        && credential.authenticatorAttachment !== null) {
      normalised.authenticatorAttachment = identifier(credential.authenticatorAttachment, code);
    }
    return freezeTree(normalised);
  }

  function manualRegistrationJson(credential, safeExtensions) {
    const code = "passkey-registration-response-invalid";
    if (!credential || !isObject(credential.response)) throw accountError(code);
    const response = credential.response;
    const value = {
      id: credential.id,
      rawId: encodeBase64Url(binaryBytes(credential.rawId, code)),
      response: {
        clientDataJSON: encodeBase64Url(binaryBytes(response.clientDataJSON, code)),
        attestationObject: encodeBase64Url(binaryBytes(response.attestationObject, code)),
      },
      clientExtensionResults: safeExtensions,
      type: credential.type,
    };
    if (credential.authenticatorAttachment !== undefined
        && credential.authenticatorAttachment !== null) {
      value.authenticatorAttachment = credential.authenticatorAttachment;
    }
    if (typeof response.getAuthenticatorData === "function") {
      value.response.authenticatorData = encodeBase64Url(binaryBytes(response.getAuthenticatorData(), code));
    }
    if (typeof response.getTransports === "function") {
      value.response.transports = response.getTransports();
    }
    if (typeof response.getPublicKey === "function") {
      const publicKey = response.getPublicKey();
      if (publicKey !== null) value.response.publicKey = encodeBase64Url(binaryBytes(publicKey, code));
    }
    if (typeof response.getPublicKeyAlgorithm === "function") {
      value.response.publicKeyAlgorithm = response.getPublicKeyAlgorithm();
    }
    return normaliseRegistrationJson(value, { safeExtensions });
  }

  function manualAuthenticationJson(credential) {
    const code = "passkey-authentication-response-invalid";
    if (!credential || !isObject(credential.response)) throw accountError(code);
    const response = credential.response;
    const value = {
      id: credential.id,
      rawId: encodeBase64Url(binaryBytes(credential.rawId, code)),
      response: {
        clientDataJSON: encodeBase64Url(binaryBytes(response.clientDataJSON, code)),
        authenticatorData: encodeBase64Url(binaryBytes(response.authenticatorData, code)),
        signature: encodeBase64Url(binaryBytes(response.signature, code)),
        userHandle: response.userHandle === null || response.userHandle === undefined
          ? null
          : encodeBase64Url(binaryBytes(response.userHandle, code)),
      },
      clientExtensionResults: {},
      type: credential.type,
    };
    if (credential.authenticatorAttachment !== undefined
        && credential.authenticatorAttachment !== null) {
      value.authenticatorAttachment = credential.authenticatorAttachment;
    }
    return normaliseAuthenticationJson(value);
  }

  function serializeRegistrationCredential(credential, evaluationInput) {
    const extensionResults = readClientExtensions(
      credential,
      "passkey-registration-response-invalid"
    );
    const prf = inspectPrfResult("registration", extensionResults, evaluationInput);
    try {
      const safeExtensions = safeRegistrationExtensions(extensionResults);
      let safeCredential;
      if (credential && typeof credential.toJSON === "function") {
        const json = credential.toJSON();
        try {
          json.clientExtensionResults = safeExtensions;
        } catch (_error) {}
        safeCredential = normaliseRegistrationJson(json, {
          native: true,
          safeExtensions,
        });
      } else {
        safeCredential = manualRegistrationJson(credential, safeExtensions);
      }
      return Object.freeze({ credential: safeCredential, prf });
    } catch (error) {
      if (prf.outputBytes) prf.outputBytes.fill(0);
      if (error && typeof error.code === "string") throw error;
      throw accountError("passkey-registration-response-invalid");
    }
  }

  function serializeAuthenticationCredential(credential, evaluationInput) {
    const extensionResults = readClientExtensions(
      credential,
      "passkey-authentication-response-invalid"
    );
    const prf = inspectPrfResult("authentication", extensionResults, evaluationInput);
    try {
      let safeCredential;
      if (credential && typeof credential.toJSON === "function") {
        const json = credential.toJSON();
        try {
          json.clientExtensionResults = {};
        } catch (_error) {}
        safeCredential = normaliseAuthenticationJson(json, { native: true });
      } else {
        safeCredential = manualAuthenticationJson(credential);
      }
      return Object.freeze({ credential: safeCredential, prf });
    } catch (error) {
      if (prf.outputBytes) prf.outputBytes.fill(0);
      if (error && typeof error.code === "string") throw error;
      throw accountError("passkey-authentication-response-invalid");
    }
  }

  function validateBeginRegistrationRequest(input) {
    const code = "registration-request-invalid";
    const request = exactObject(input, [
      "apiVersion",
      "operationId",
      "accountIntent",
      "deviceId",
    ], ["apiVersion", "operationId", "accountIntent", "deviceId"], code);
    if (request.apiVersion !== POLICY.apiVersion
        || request.accountIntent !== "create-or-add-credential") {
      throw accountError(code);
    }
    return freezeTree({
      apiVersion: POLICY.apiVersion,
      operationId: identifier(request.operationId, code),
      accountIntent: "create-or-add-credential",
      deviceId: identifier(request.deviceId, code),
    });
  }

  function validateBeginAuthenticationRequest(input) {
    const code = "authentication-request-invalid";
    const request = exactObject(input, [
      "apiVersion",
      "operationId",
      "accountLocator",
    ], ["apiVersion", "operationId"], code);
    if (request.apiVersion !== POLICY.apiVersion) throw accountError(code);
    const value = {
      apiVersion: POLICY.apiVersion,
      operationId: identifier(request.operationId, code),
    };
    if (request.accountLocator !== undefined) {
      value.accountLocator = identifier(request.accountLocator, code);
    }
    return freezeTree(value);
  }

  function validateBeginRegistrationResponse(input, expectedOperationId, nowMilliseconds) {
    const code = "account-service-invalid";
    const response = exactObject(input, [
      "apiVersion",
      "ok",
      "operationId",
      "ceremonyId",
      "expiresAt",
      "prfEvaluationInput",
      "publicKeyCreationOptions",
    ], [
      "apiVersion",
      "ok",
      "operationId",
      "ceremonyId",
      "expiresAt",
      "prfEvaluationInput",
      "publicKeyCreationOptions",
    ], code);
    if (response.apiVersion !== POLICY.apiVersion || response.ok !== true) {
      throw accountError(code);
    }
    if (response.operationId !== expectedOperationId) {
      throw accountError("passkey-ceremony-mismatch");
    }
    expiryMilliseconds(response.expiresAt, nowMilliseconds);
    const evaluationInput = validatePrfEvaluationInput(response.prfEvaluationInput, code);
    return freezeTree({
      apiVersion: POLICY.apiVersion,
      ok: true,
      operationId: response.operationId,
      ceremonyId: identifier(response.ceremonyId, code),
      expiresAt: response.expiresAt,
      prfEvaluationInput: evaluationInput,
      publicKeyCreationOptions: validateRegistrationOptions(
        response.publicKeyCreationOptions,
        evaluationInput
      ),
    });
  }

  function validateBeginAuthenticationResponse(input, expectedOperationId, nowMilliseconds) {
    const code = "account-service-invalid";
    const response = exactObject(input, [
      "apiVersion",
      "ok",
      "operationId",
      "ceremonyId",
      "expiresAt",
      "prfEvaluationInput",
      "publicKeyRequestOptions",
    ], [
      "apiVersion",
      "ok",
      "operationId",
      "ceremonyId",
      "expiresAt",
      "prfEvaluationInput",
      "publicKeyRequestOptions",
    ], code);
    if (response.apiVersion !== POLICY.apiVersion || response.ok !== true) {
      throw accountError(code);
    }
    if (response.operationId !== expectedOperationId) {
      throw accountError("passkey-ceremony-mismatch");
    }
    expiryMilliseconds(response.expiresAt, nowMilliseconds);
    const evaluationInput = validatePrfEvaluationInput(response.prfEvaluationInput, code);
    return freezeTree({
      apiVersion: POLICY.apiVersion,
      ok: true,
      operationId: response.operationId,
      ceremonyId: identifier(response.ceremonyId, code),
      expiresAt: response.expiresAt,
      prfEvaluationInput: evaluationInput,
      publicKeyRequestOptions: validateAuthenticationOptions(
        response.publicKeyRequestOptions,
        evaluationInput
      ),
    });
  }

  function validateFinishRegistrationRequest(input) {
    const code = "registration-request-invalid";
    const request = exactObject(input, [
      "apiVersion",
      "operationId",
      "ceremonyId",
      "deviceId",
      "credential",
    ], ["apiVersion", "operationId", "ceremonyId", "deviceId", "credential"], code);
    if (request.apiVersion !== POLICY.apiVersion) throw accountError(code);
    return freezeTree({
      apiVersion: POLICY.apiVersion,
      operationId: identifier(request.operationId, code),
      ceremonyId: identifier(request.ceremonyId, code),
      deviceId: identifier(request.deviceId, code),
      credential: normaliseRegistrationJson(request.credential),
    });
  }

  function validateFinishAuthenticationRequest(input) {
    const code = "authentication-request-invalid";
    const request = exactObject(input, [
      "apiVersion",
      "operationId",
      "ceremonyId",
      "credential",
    ], ["apiVersion", "operationId", "ceremonyId", "credential"], code);
    if (request.apiVersion !== POLICY.apiVersion) throw accountError(code);
    return freezeTree({
      apiVersion: POLICY.apiVersion,
      operationId: identifier(request.operationId, code),
      ceremonyId: identifier(request.ceremonyId, code),
      credential: normaliseAuthenticationJson(request.credential),
    });
  }

  function validateFinishResponse(input, expected, code) {
    const response = exactObject(input, [
      "apiVersion",
      "ok",
      "operationId",
      "ceremonyId",
      "accountId",
      "credentialId",
      "credentialVersion",
      "accountPolicyVersion",
      "prfEvaluationInput",
    ], [
      "apiVersion",
      "ok",
      "operationId",
      "ceremonyId",
      "accountId",
      "credentialId",
      "credentialVersion",
      "accountPolicyVersion",
      "prfEvaluationInput",
    ], code);
    if (response.apiVersion !== POLICY.apiVersion || response.ok !== true) {
      throw accountError(code);
    }
    if (response.operationId !== expected.operationId
        || response.ceremonyId !== expected.ceremonyId
        || response.credentialId !== expected.credentialId
        || response.prfEvaluationInput !== expected.prfEvaluationInput) {
      throw accountError("passkey-ceremony-mismatch");
    }
    return freezeTree({
      apiVersion: POLICY.apiVersion,
      ok: true,
      operationId: response.operationId,
      ceremonyId: response.ceremonyId,
      accountId: identifier(response.accountId, code),
      credentialId: identifier(response.credentialId, code),
      credentialVersion: positiveInteger(response.credentialVersion, code),
      accountPolicyVersion: positiveInteger(response.accountPolicyVersion, code),
      prfEvaluationInput: validatePrfEvaluationInput(response.prfEvaluationInput, code),
    });
  }

  function validateFinishRegistrationResponse(input, expected) {
    return validateFinishResponse(input, expected, "account-service-invalid");
  }

  function validateFinishAuthenticationResponse(input, expected) {
    return validateFinishResponse(input, expected, "account-service-invalid");
  }

  function createBrowserWebAuthnAdapter(environment = global) {
    return Object.freeze({
      async createCredential(jsonOptions) {
        const publicKeyCredential = environment && environment.PublicKeyCredential;
        const credentials = environment && environment.navigator && environment.navigator.credentials;
        if (!credentials || typeof credentials.create !== "function") {
          throw accountError("passkey-api-unavailable");
        }
        const publicKey = parseRegistrationOptions(
          jsonOptions,
          jsonOptions.extensions.prf.eval.first,
          publicKeyCredential
        );
        return credentials.create({ publicKey });
      },
      async getCredential(jsonOptions) {
        const publicKeyCredential = environment && environment.PublicKeyCredential;
        const credentials = environment && environment.navigator && environment.navigator.credentials;
        if (!credentials || typeof credentials.get !== "function") {
          throw accountError("passkey-api-unavailable");
        }
        const publicKey = parseAuthenticationOptions(
          jsonOptions,
          jsonOptions.extensions.prf.eval.first,
          publicKeyCredential
        );
        return credentials.get({ publicKey });
      },
    });
  }

  function validateAccountService(service) {
    const methods = [
      "beginRegistration",
      "finishRegistration",
      "beginAuthentication",
      "finishAuthentication",
    ];
    if (!isObject(service)
        || Object.keys(service).some((field) => !methods.includes(field))
        || methods.some((method) => typeof service[method] !== "function")) {
      throw accountError("account-service-invalid");
    }
    return service;
  }

  function validateWebAuthn(webAuthn) {
    if (!isObject(webAuthn)
        || typeof webAuthn.createCredential !== "function"
        || typeof webAuthn.getCredential !== "function") {
      throw accountError("passkey-api-unavailable");
    }
    return webAuthn;
  }

  function currentMilliseconds(now) {
    let value;
    try {
      value = now();
    } catch (_error) {
      throw accountError("account-client-invalid");
    }
    if (!Number.isFinite(value)) throw accountError("account-client-invalid");
    return value;
  }

  async function callService(service, method, request) {
    let pending;
    try {
      pending = service[method](request);
    } catch (_error) {
      throw accountError("account-service-failed");
    }
    if (!pending || typeof pending.then !== "function") {
      throw accountError("account-service-invalid");
    }
    try {
      return await pending;
    } catch (_error) {
      throw accountError("account-service-failed");
    }
  }

  function mapBrowserFailure(error, ceremonyKind) {
    if (error && typeof error.code === "string") throw error;
    if (error && error.name === "NotAllowedError") {
      throw accountError(ceremonyKind === "registration"
        ? "passkey-registration-cancelled"
        : "passkey-authentication-cancelled");
    }
    if (error && error.name === "NotSupportedError") {
      throw accountError("passkey-not-supported");
    }
    throw accountError("passkey-security-failed");
  }

  function ensureCurrent(expiry, now) {
    if (expiry <= currentMilliseconds(now)) throw accountError("passkey-ceremony-expired");
  }

  function buildSuccess(response, prf) {
    return Object.freeze({
      ok: true,
      accountAuthenticated: true,
      contentUnlocked: false,
      accountId: response.accountId,
      credentialId: response.credentialId,
      credentialVersion: response.credentialVersion,
      accountPolicyVersion: response.accountPolicyVersion,
      prf,
    });
  }

  function createClient({
    accountService,
    webAuthn = createBrowserWebAuthnAdapter(),
    now = Date.now,
  } = {}) {
    const service = validateAccountService(accountService);
    const credentialApi = validateWebAuthn(webAuthn);
    if (typeof now !== "function") throw accountError("account-client-invalid");

    async function registerPasskey(input) {
      const request = validateBeginRegistrationRequest(input);
      const beginRaw = await callService(service, "beginRegistration", request);
      const begin = validateBeginRegistrationResponse(
        beginRaw,
        request.operationId,
        currentMilliseconds(now)
      );
      const expiry = Date.parse(begin.expiresAt);
      ensureCurrent(expiry, now);
      let rawCredential;
      try {
        rawCredential = await credentialApi.createCredential(begin.publicKeyCreationOptions);
      } catch (error) {
        mapBrowserFailure(error, "registration");
      }
      let serialised;
      let completed = false;
      try {
        serialised = serializeRegistrationCredential(rawCredential, begin.prfEvaluationInput);
        ensureCurrent(expiry, now);
        const finishRequest = validateFinishRegistrationRequest({
          apiVersion: POLICY.apiVersion,
          operationId: request.operationId,
          ceremonyId: begin.ceremonyId,
          deviceId: request.deviceId,
          credential: serialised.credential,
        });
        const finishRaw = await callService(service, "finishRegistration", finishRequest);
        const finish = validateFinishRegistrationResponse(finishRaw, {
          operationId: request.operationId,
          ceremonyId: begin.ceremonyId,
          credentialId: serialised.credential.id,
          prfEvaluationInput: begin.prfEvaluationInput,
        });
        completed = true;
        return buildSuccess(finish, serialised.prf);
      } finally {
        if (!completed && serialised?.prf?.outputBytes) serialised.prf.outputBytes.fill(0);
      }
    }

    async function authenticatePasskey(input) {
      const request = validateBeginAuthenticationRequest(input);
      const beginRaw = await callService(service, "beginAuthentication", request);
      const begin = validateBeginAuthenticationResponse(
        beginRaw,
        request.operationId,
        currentMilliseconds(now)
      );
      const expiry = Date.parse(begin.expiresAt);
      ensureCurrent(expiry, now);
      let rawCredential;
      try {
        rawCredential = await credentialApi.getCredential(begin.publicKeyRequestOptions);
      } catch (error) {
        mapBrowserFailure(error, "authentication");
      }
      let serialised;
      let completed = false;
      try {
        serialised = serializeAuthenticationCredential(rawCredential, begin.prfEvaluationInput);
        ensureCurrent(expiry, now);
        const finishRequest = validateFinishAuthenticationRequest({
          apiVersion: POLICY.apiVersion,
          operationId: request.operationId,
          ceremonyId: begin.ceremonyId,
          credential: serialised.credential,
        });
        const finishRaw = await callService(service, "finishAuthentication", finishRequest);
        const finish = validateFinishAuthenticationResponse(finishRaw, {
          operationId: request.operationId,
          ceremonyId: begin.ceremonyId,
          credentialId: serialised.credential.id,
          prfEvaluationInput: begin.prfEvaluationInput,
        });
        completed = true;
        return buildSuccess(finish, serialised.prf);
      } finally {
        if (!completed && serialised?.prf?.outputBytes) serialised.prf.outputBytes.fill(0);
      }
    }

    return Object.freeze({ registerPasskey, authenticatePasskey });
  }

  global.PocketSyncAccountClient = Object.freeze({
    POLICY,
    validatePrfEvaluationInput,
    validateBeginRegistrationRequest,
    validateBeginRegistrationResponse,
    validateFinishRegistrationRequest,
    validateFinishRegistrationResponse,
    validateBeginAuthenticationRequest,
    validateBeginAuthenticationResponse,
    validateFinishAuthenticationRequest,
    validateFinishAuthenticationResponse,
    validateRegistrationOptions,
    validateAuthenticationOptions,
    parseRegistrationOptions,
    parseAuthenticationOptions,
    inspectPrfResult,
    serializeRegistrationCredential,
    serializeAuthenticationCredential,
    createBrowserWebAuthnAdapter,
    createClient,
  });
})(typeof window !== "undefined" ? window : globalThis);
