/* P376 dormant private connection: P375 validated reader -> P370 knowledge.
   Not an Open conductor, presenter, document, scheduler or Save authority. */
(function (global) {
  "use strict";

  const SCOPE = "incomplete";
  const fail = (parentId, reason) => Object.freeze({
    ok: false, scope: SCOPE, parentId, reason,
  });
  const validId = (id) => typeof id === "string" && id.length > 0 && id === id.trim();
  const guard = (fn) => {
    try { return fn() === true; } catch (_error) { return false; }
  };
  const reject = () => { throw new Error("progressive-knowledge-handoff-failed"); };

  function createSession({ isAttemptCurrent } = {}) {
    if (typeof isAttemptCurrent !== "function") {
      throw new TypeError("P376 requires caller-owned attempt eligibility");
    }
    let retired = false;
    let generation = 0;
    let active = null;
    let pending = null;

    function retireModel(model) {
      if (model && typeof model.knowledge?.retire === "function") {
        model.knowledge.retire();
      }
    }
    function invalidate() {
      generation += 1;
      retireModel(pending);
      retireModel(active);
      pending = null;
      active = null;
    }
    function eligible(model, epoch) {
      return !retired && generation === epoch
        && guard(isAttemptCurrent)
        && guard(model.isTargetCurrent);
    }
    function current() {
      const model = active;
      if (!model) return null; // A pending root is not yet public truth.
      if (!eligible(model, generation)) {
        invalidate();
        return null;
      }
      return model;
    }

    // This function is intentionally the exact optional P375 callback shape.
    async function onScopedStarlingReader(reader, source, isCurrent) {
      if (retired) reject();
      // An accepted later selection supersedes all earlier reached knowledge.
      // A failed replacement must never leave the older Seal labelled current.
      invalidate();
      const epoch = generation;
      if (!guard(isAttemptCurrent) || typeof isCurrent !== "function"
          || !guard(isCurrent)) reject();
      if (!reader || reader.ok !== true || reader.scope !== SCOPE
          || !validId(reader.acceptedSealRef)
          || typeof reader.readChildren !== "function"
          || typeof reader.readReachedNode !== "function"
          || !source || typeof source !== "object"
          || source.acceptedSealRef !== reader.acceptedSealRef
          || !validId(source.syncedPocketId)
          || !validId(source.headSealStorageRef)
          || !Number.isSafeInteger(source.authorityRevision)
          || source.authorityRevision < 1
          || !Number.isSafeInteger(source.headRevision)
          || source.headRevision < 1) reject();

      const factory = global.PocketProgressiveOpenState?.createKnowledgeOwner;
      if (typeof factory !== "function") reject();
      const pinned = Object.freeze({
        syncedPocketId: source.syncedPocketId,
        authorityRevision: source.authorityRevision,
        headRevision: source.headRevision,
        headSealStorageRef: source.headSealStorageRef,
        acceptedSealRef: source.acceptedSealRef,
      });
      let knowledge;
      try { knowledge = factory(reader); } catch (_error) { reject(); }
      const model = { knowledge, source: pinned, isTargetCurrent: isCurrent };
      pending = model;
      if (!eligible(model, epoch)) {
        if (pending === model) invalidate();
        reject();
      }

      let result;
      try { result = await knowledge.requestChildren("root"); }
      catch (_error) {
        if (pending === model) invalidate();
        reject();
      }
      if (!eligible(model, epoch) || pending !== model
          || !result || result.ok !== true || result.scope !== SCOPE
          || result.parentId !== "root") {
        if (pending === model) invalidate();
        else retireModel(model);
        reject();
      }
      const root = knowledge.inspect("root");
      if (!root || root.scope !== SCOPE || root.reached !== true
          || root.acceptedSealRef !== pinned.acceptedSealRef
          || root.childrenState !== "ready" || !Array.isArray(root.childIds)) {
        invalidate();
        reject();
      }
      active = model;
      pending = null;
      // P375 awaits this return before ordinary full-document materialisation.
      // Only the private owner persists; no reader or keys leave this session.
    }

    function inspect(id) {
      if (!validId(id)) return null;
      const model = current();
      return model ? model.knowledge.inspect(id) : null;
    }
    function currentSource() {
      const model = current();
      return model ? model.source : null;
    }
    async function requestChildren(parentId) {
      if (!validId(parentId)) return fail(parentId, "invalid-parent");
      const model = current();
      if (!model) return fail(parentId, "opening-session-stale");
      const epoch = generation;
      let result;
      try { result = await model.knowledge.requestChildren(parentId); }
      catch (_error) { return fail(parentId, "scoped-read-failed"); }
      if (!eligible(model, epoch) || active !== model) {
        if (active === model) invalidate();
        return fail(parentId, "opening-session-stale");
      }
      // P370 already owns canonical publication and defensive childIds.
      return result;
    }
    function retire() {
      if (retired) return false;
      retired = true;
      invalidate();
      return true;
    }
    return Object.freeze({
      onScopedStarlingReader, inspect, requestChildren, currentSource, retire,
    });
  }

  global.PocketProgressiveOpenConnection = Object.freeze({ createSession });
})(typeof window !== "undefined" ? window : globalThis);
