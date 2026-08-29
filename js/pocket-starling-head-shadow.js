/* Dormant P110 authority experiment. Head selects one accepted immutable Seal;
   it does not persist, transport, or reproduce lower-layer eligibility proof. */
(function (global) {
  "use strict";

  const HEAD_SCHEMA = "pocket.starling.head.v1",
    OUTCOME = Object.freeze({
      COMMITTED: "committed",
      NOT_COMMITTED: "not-committed",
      COMMITTED_AND_SUPERSEDED: "committed-and-superseded",
      CONFLICT: "conflict",
      UNKNOWN: "unknown",
    });
  const fail = (reason) => Object.freeze({ ok: false, reason });

  function exact(value, keys) {
    return (
      value &&
      typeof value === "object" &&
      !Array.isArray(value) &&
      Object.keys(value).sort().join("|") === keys.slice().sort().join("|")
    );
  }

  function validHead(value) {
    return (
      exact(value, ["schema", "revision", "sealRef"]) &&
      value.schema === HEAD_SCHEMA &&
      Number.isSafeInteger(value.revision) &&
      value.revision >= 0 &&
      ((value.revision === 0 && value.sealRef === null) ||
        (value.revision > 0 &&
          typeof value.sealRef === "string" &&
          value.sealRef.length > 0))
    );
  }

  function snapshot(value) {
    return Object.freeze({
      schema: HEAD_SCHEMA,
      revision: value.revision,
      sealRef: value.sealRef,
    });
  }

  function sameHead(left, right) {
    return left.revision === right.revision && left.sealRef === right.sealRef;
  }

  function openSeal(sealRef, resolver) {
    const boundary = global.PocketStarlingObjectSealShadow;
    if (
      !boundary ||
      typeof boundary.openFromAcceptedSealRef !== "function" ||
      typeof sealRef !== "string" ||
      sealRef.length === 0 ||
      typeof resolver !== "function"
    )
      return null;
    const opened = boundary.openFromAcceptedSealRef(sealRef, resolver);
    return opened && opened.ok ? opened.handle.seal : null;
  }

  function createAuthority(config) {
    if (
      !config ||
      typeof config !== "object" ||
      Array.isArray(config) ||
      typeof config.isCandidateEligible !== "function" ||
      typeof config.resolveSeal !== "function"
    )
      return fail("invalid-authority-config");
    const supplied =
      config.initialHead === undefined
        ? { schema: HEAD_SCHEMA, revision: 0, sealRef: null }
        : config.initialHead;
    if (!validHead(supplied)) return fail("invalid-head");
    let head = snapshot(supplied);

    function readHead() {
      return head;
    }

    function conditionalAdopt(expectedHead, candidateSealRef) {
      if (!validHead(expectedHead)) return fail("invalid-expected-head");
      const expected = snapshot(expectedHead);
      if (!sameHead(head, expected)) return fail("head-conflict");
      if (typeof candidateSealRef !== "string" || candidateSealRef.length === 0)
        return fail("candidate-invalid");
      let eligible = false;
      try {
        eligible = config.isCandidateEligible(candidateSealRef) === true;
      } catch (_error) {}
      if (!eligible) return fail("candidate-not-eligible");
      const seal = openSeal(candidateSealRef, config.resolveSeal);
      if (!seal) return fail("candidate-invalid");
      if (seal.previousSealRef !== expected.sealRef)
        return fail("candidate-lineage-mismatch");
      if (expected.revision === Number.MAX_SAFE_INTEGER)
        return fail("head-revision-exhausted");
      if (!sameHead(head, expected)) return fail("head-conflict");
      head = snapshot({
        revision: expected.revision + 1,
        sealRef: candidateSealRef,
      });
      return Object.freeze({ ok: true, reason: "adopted", head });
    }

    return Object.freeze({ readHead, conditionalAdopt });
  }

  function reconciliation(outcome, examined = 0) {
    return Object.freeze({ outcome, examined });
  }

  function reconcileAmbiguous(input) {
    if (
      !input ||
      typeof input !== "object" ||
      Array.isArray(input) ||
      !validHead(input.expectedHead) ||
      typeof input.candidateSealRef !== "string" ||
      input.candidateSealRef.length === 0 ||
      typeof input.readCurrentHead !== "function" ||
      typeof input.resolveSeal !== "function"
    )
      return reconciliation(OUTCOME.UNKNOWN);
    const expected = snapshot(input.expectedHead);
    let actual;
    try {
      actual = input.readCurrentHead();
    } catch (_error) {
      return reconciliation(OUTCOME.UNKNOWN);
    }
    if (!validHead(actual)) return reconciliation(OUTCOME.UNKNOWN);
    actual = snapshot(actual);
    if (sameHead(actual, expected))
      return reconciliation(OUTCOME.NOT_COMMITTED);
    if (actual.revision <= expected.revision)
      return reconciliation(OUTCOME.UNKNOWN);

    const delta = actual.revision - expected.revision;
    let ref = actual.sealRef,
      candidateDepth = -1;
    const seen = new Set();
    for (let depth = 0; depth < delta; depth += 1) {
      if (seen.has(ref)) return reconciliation(OUTCOME.UNKNOWN, depth);
      seen.add(ref);
      const seal = openSeal(ref, input.resolveSeal);
      if (!seal) return reconciliation(OUTCOME.UNKNOWN, depth + 1);
      if (ref === input.candidateSealRef) candidateDepth = depth;
      ref = seal.previousSealRef;
      if (depth + 1 < delta && (typeof ref !== "string" || ref.length === 0))
        return reconciliation(OUTCOME.UNKNOWN, depth + 1);
    }
    if (ref !== expected.sealRef) return reconciliation(OUTCOME.UNKNOWN, delta);
    if (candidateDepth === delta - 1)
      return reconciliation(
        delta === 1 ? OUTCOME.COMMITTED : OUTCOME.COMMITTED_AND_SUPERSEDED,
        delta,
      );
    if (candidateDepth !== -1) return reconciliation(OUTCOME.UNKNOWN, delta);
    return reconciliation(OUTCOME.CONFLICT, delta);
  }

  global.PocketStarlingHeadShadow = Object.freeze({
    HEAD_SCHEMA,
    OUTCOME,
    validHead,
    createAuthority,
    reconcileAmbiguous,
  });
})(typeof window !== "undefined" ? window : globalThis);
