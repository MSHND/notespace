/* P377 dormant presentation bridge: P376 reached knowledge -> P373 Main projection.
   Caller owns the isolated mount, attempt and preview visibility. */
(function (global) {
  "use strict";

  const SCOPE = "incomplete";
  const failed = (reason) => Object.freeze({ ok: false, scope: SCOPE, reason });
  const eligible = (fn) => {
    try { return fn() === true; } catch (_error) { return false; }
  };

  function createBridge({ knowledgeSession, mount, createPresentation, isAttemptCurrent } = {}) {
    if (!knowledgeSession
        || typeof knowledgeSession.inspect !== "function"
        || typeof knowledgeSession.currentSource !== "function"
        || typeof createPresentation !== "function"
        || typeof isAttemptCurrent !== "function"
        || !mount || typeof mount.appendChild !== "function"
        || typeof mount.ownerDocument?.createElement !== "function") {
      throw new TypeError("P377 requires private knowledge, an isolated mount, P373 factory and attempt guard");
    }

    let disposed = false;
    let attached = null;

    // Deliberately no structural reads, snapshots, mutable document or Save surface.
    const facade = Object.freeze({
      inspect(id) { return knowledgeSession.inspect(id); },
    });
    function sourceNow() {
      if (disposed || !eligible(isAttemptCurrent)) return null;
      try { return knowledgeSession.currentSource() || null; }
      catch (_error) { return null; }
    }
    function current(owner) {
      return !disposed && !!owner && attached === owner
        && eligible(isAttemptCurrent)
        && sourceNow() === owner.source;
    }
    function rootFor(source) {
      if (!source || typeof source.acceptedSealRef !== "string"
          || !source.acceptedSealRef) return null;
      let root;
      try { root = facade.inspect("root"); } catch (_error) { return null; }
      if (!root || root.scope !== SCOPE || root.id !== "root"
          || root.reached !== true || root.node !== null
          || root.childrenState !== "ready"
          || !Array.isArray(root.childIds)
          || root.acceptedSealRef !== source.acceptedSealRef) return null;
      return root;
    }
    function successfulRoot(result, source) {
      return result?.ok === true && result.scope === SCOPE
        && result.parentId === "root" && result.childrenState === "ready"
        && result.acceptedSealRef === source.acceptedSealRef;
    }
    function attachCurrent() {
      if (disposed) return failed("bridge-disposed");
      const source = sourceNow();
      if (!source) return failed("opening-attempt-stale");
      if (!rootFor(source)) return failed("root-not-ready");

      if (attached?.source === source) {
        // A no-change root refresh is a P373 mount-token liveness witness.
        // If another presenter owns the mount, do not take it back.
        let probe;
        try { probe = attached.presenter.refresh("root"); }
        catch (_error) { return failed("presentation-stale"); }
        return successfulRoot(probe, source)
          ? Object.freeze({ ok: true, scope: SCOPE,
              acceptedSealRef: source.acceptedSealRef, alreadyAttached: true })
          : failed("presentation-stale");
      }

      // P373.dispose does not erase DOM and cannot remove a later mount owner.
      if (attached) {
        attached.presenter.dispose();
        attached = null;
      }
      let presenter, owner;
      try {
        owner = { source, presenter: null };
        // The P373 guard is pinned to the EXACT frozen P376 source object.
        presenter = createPresentation({
          knowledge: facade,
          mount,
          isCurrent: () => current(owner),
        });
        owner.presenter = presenter;
        if (!presenter || typeof presenter.refresh !== "function"
            || typeof presenter.dispose !== "function") {
          if (typeof presenter?.dispose === "function") presenter.dispose();
          return failed("presentation-unavailable");
        }
        attached = owner;
        const result = presenter.refresh("root");
        if (!successfulRoot(result, source) || !current(owner)) {
          if (attached === owner) attached = null;
          presenter.dispose();
          return failed("root-projection-failed");
        }
        return Object.freeze({ ok: true, scope: SCOPE,
          acceptedSealRef: source.acceptedSealRef, alreadyAttached: false });
      } catch (_error) {
        if (attached === owner) attached = null;
        if (typeof presenter?.dispose === "function") presenter.dispose();
        return failed("root-projection-failed");
      }
    }
    function refresh(parentId) {
      if (disposed) return failed("bridge-disposed");
      const owner = attached;
      if (!current(owner)) return failed("presentation-stale");
      // P373 alone decides whether this particular reached parent can change.
      try { return owner.presenter.refresh(parentId); }
      catch (_error) { return failed("presentation-refresh-failed"); }
    }
    function dispose() {
      if (disposed) return false;
      disposed = true;
      const owner = attached;
      attached = null;
      if (owner) owner.presenter.dispose();
      return true;
    }
    return Object.freeze({ attachCurrent, refresh, dispose });
  }

  global.PocketProgressiveOpenPresentationConnection = Object.freeze({ createBridge });
})(typeof window !== "undefined" ? window : globalThis);
