/* P370 dormant progressive-open structural knowledge, above the accepted P368 reader.
   This is not a Main projection, document materialiser, validator or persistence owner. */
(function (global) {
  "use strict";

  const SCOPE = "incomplete";
  const failure = (parentId, reason) =>
    Object.freeze({ ok: false, scope: SCOPE, parentId, reason });

  // P368 returns canonical, JSON-compatible node records. Cloning also ensures
  // its returned objects and every caller projection remain independently owned.
  const copy = (value) => JSON.parse(JSON.stringify(value));

  function createKnowledgeOwner(reader) {
    if (!reader || reader.ok !== true || reader.scope !== SCOPE ||
        typeof reader.acceptedSealRef !== "string" || !reader.acceptedSealRef ||
        typeof reader.readChildren !== "function" ||
        typeof reader.readReachedNode !== "function") {
      throw new TypeError("P370 requires a successful P368 scoped reader");
    }

    const sealRef = reader.acceptedSealRef;
    const reached = new Map();
    let retired = false;

    function entry(node) {
      return { node, state: "unresolved", ids: null, reason: null,
        generation: 0, inFlight: null };
    }
    reached.set("root", entry(null));

    function describe(id, value) {
      return Object.freeze({
        scope: SCOPE,
        acceptedSealRef: sealRef,
        reached: true,
        id,
        node: value.node === null ? null : copy(value.node),
        childrenState: value.state,
        childIds: value.state === "ready" ? Object.freeze(value.ids.slice()) : null,
        failureReason: value.state === "failed" ? value.reason : null,
      });
    }
    function inspect(id) {
      const value = reached.get(id);
      return value ? describe(id, value) : null;
    }
    function snapshot() {
      return Object.freeze({
        scope: SCOPE,
        acceptedSealRef: sealRef,
        root: describe("root", reached.get("root")),
        reached: Object.freeze(Array.from(reached, ([id, value]) =>
          id === "root" ? null : describe(id, value)).filter(Boolean)),
      });
    }

    function requestChildren(parentId, { retry = false } = {}) {
      const parent = reached.get(parentId);
      if (retired) return Promise.resolve(failure(parentId, "session-retired"));
      if (!parent) return Promise.resolve(failure(parentId, "unreached-parent"));
      if (parent.state === "pending") return parent.inFlight;
      if (parent.state === "ready") return Promise.resolve(
        Object.freeze({ ok: true, scope: SCOPE, parentId,
          childIds: Object.freeze(parent.ids.slice()) }));
      if (parent.state === "failed" && retry !== true) {
        return Promise.resolve(failure(parentId, parent.reason));
      }

      parent.state = "pending";
      parent.ids = null;
      parent.reason = null;
      const generation = ++parent.generation;
      const current = () => !retired && parent.generation === generation &&
        parent.state === "pending";

      function reject(reason) {
        if (!current()) return failure(parentId, "stale-response");
        parent.state = "failed";
        parent.reason = reason;
        parent.inFlight = null;
        return failure(parentId, reason);
      }

      // No await between staging and committing. Failed P368 results never
      // publish any proposed node, while siblings/other reached truth survive.
      const running = Promise.resolve()
        .then(() => reader.readChildren(parentId))
        .then((result) => {
          if (!current()) return failure(parentId, "stale-response");
          if (!result || result.ok !== true) {
            return reject(typeof result?.reason === "string" && result.reason
              ? result.reason : "scoped-read-failed");
          }
          if (result.scope !== SCOPE || result.parentId !== parentId ||
              !Array.isArray(result.nodes)) return reject("scoped-result-invalid");

          let staged;
          try { staged = result.nodes.map(copy); }
          catch (_) { return reject("scoped-result-invalid"); }
          if (!current()) return failure(parentId, "stale-response");

          const ids = staged.map((node) => node.id);
          for (const node of staged) reached.set(node.id, entry(node));
          parent.ids = ids;
          parent.state = "ready";
          parent.inFlight = null;
          return Object.freeze({ ok: true, scope: SCOPE, parentId,
            childIds: Object.freeze(ids.slice()) });
        }, (error) => reject(typeof error?.code === "string" && error.code
          ? error.code : "scoped-read-threw"));
      parent.inFlight = running;
      return running;
    }

    // A future Open owner can explicitly retire its old authenticated model.
    // Delayed read settlement then has no authority to publish stale knowledge.
    function retire() {
      if (retired) return false;
      retired = true;
      for (const value of reached.values()) {
        if (value.state === "pending") {
          value.generation += 1;
          value.state = "failed";
          value.reason = "session-retired";
          value.inFlight = null;
        }
      }
      return true;
    }

    return Object.freeze({ requestChildren, inspect, snapshot, retire });
  }

  global.PocketProgressiveOpenState = Object.freeze({ createKnowledgeOwner });
})(typeof window !== "undefined" ? window : globalThis);
