/* Canonical genuinely-fresh Pocket starter document.

This owner knows only how to construct a brand-new first-use Pocket payload.
Local-file recovery, file handles, Sync/account state and Save ownership stay
with their existing owners.
*/

(function initialisePocketFirstUseDocument(global) {
  "use strict";

  function canonicalNodeId() {
    if (typeof global.makeId !== "function") {
      throw new Error("Pocket first-use canonical ID owner unavailable.");
    }
    return global.makeId("node");
  }

  function canonicalNow() {
    if (typeof global.nowIso !== "function") {
      throw new Error("Pocket first-use clock owner unavailable.");
    }
    return global.nowIso();
  }

  function buildFirstUseNodes(updatedAt) {
    const thingsOnMyMindId = canonicalNodeId();
    const copyId = canonicalNodeId();
    const howCopyWorksId = canonicalNodeId();
    const typeWhatYouRememberId = canonicalNodeId();
    const pressEnterId = canonicalNodeId();
    const ideasId = canonicalNodeId();
    return [
      {
        id: thingsOnMyMindId,
        parentId: "root",
        label: "Things on my mind",
        source: "manual",
        order: 1001,
        updatedAt,
      },
      {
        id: canonicalNodeId(),
        parentId: thingsOnMyMindId,
        label: "Something I want to think about",
        source: "manual",
        order: 1001,
        updatedAt,
      },
      {
        id: canonicalNodeId(),
        parentId: thingsOnMyMindId,
        label: "Something I don’t want to forget",
        source: "manual",
        order: 1002,
        updatedAt,
      },
      {
        id: canonicalNodeId(),
        parentId: "root",
        label: "Things I might do",
        source: "manual",
        order: 1002,
        updatedAt,
      },
      {
        id: copyId,
        parentId: "root",
        label: "Copy",
        source: "manual",
        order: 1003,
        updatedAt,
        copyContext: true,
      },
      {
        id: howCopyWorksId,
        parentId: copyId,
        label: "How Copy works",
        source: "manual",
        order: 1001,
        updatedAt,
      },
      {
        id: canonicalNodeId(),
        parentId: howCopyWorksId,
        label: "Put things here you want to reuse",
        source: "manual",
        order: 1001,
        updatedAt,
      },
      {
        id: typeWhatYouRememberId,
        parentId: howCopyWorksId,
        label: "Type what you remember to find one",
        source: "manual",
        order: 1002,
        updatedAt,
      },
      {
        id: canonicalNodeId(),
        parentId: typeWhatYouRememberId,
        label: "Pocket looks in the title and notes",
        source: "manual",
        order: 1001,
        updatedAt,
      },
      {
        id: pressEnterId,
        parentId: howCopyWorksId,
        label: "Press Enter to copy it",
        source: "manual",
        order: 1003,
        updatedAt,
      },
      {
        id: canonicalNodeId(),
        parentId: pressEnterId,
        label: "If it has notes, Pocket copies the notes; otherwise it copies the title",
        source: "manual",
        order: 1001,
        updatedAt,
      },
      {
        id: ideasId,
        parentId: copyId,
        label: "A few ideas",
        source: "manual",
        order: 1002,
        updatedAt,
      },
      {
        id: canonicalNodeId(),
        parentId: ideasId,
        label: "Email sign-offs",
        source: "manual",
        order: 1001,
        updatedAt,
      },
      {
        id: canonicalNodeId(),
        parentId: ideasId,
        label: "Addresses and contact details",
        source: "manual",
        order: 1002,
        updatedAt,
      },
      {
        id: canonicalNodeId(),
        parentId: ideasId,
        label: "Replies you send often",
        source: "manual",
        order: 1003,
        updatedAt,
      },
    ];
  }

  function buildFreshPayload(writtenAt = canonicalNow()) {
    const nodes = buildFirstUseNodes(writtenAt);
    return {
      schema: "portal.export.v1",
      exportedAt: writtenAt,
      writtenAt,
      mainThoughtTree: nodes,
      mainThoughtTreeTombstones: [],
      data: {
        mainThoughtTree: nodes,
        mainThoughtTreeTombstones: [],
      },
    };
  }

  global.PocketFirstUseDocument = Object.freeze({ buildFreshPayload });
})(typeof window !== "undefined" ? window : globalThis);
