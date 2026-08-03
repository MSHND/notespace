"use strict";

class InMemorySyncAdapter {
  constructor(options = {}) {
    this.available = options.available !== false;
    this.failWrite = options.failWrite === true;
    this.records = new Map();
    this.calls = [];
  }

  seed(syncedPocketId, revision, encryptedRecord) {
    this.records.set(String(syncedPocketId), { revision, encryptedRecord });
  }

  intervene(syncedPocketId, encryptedRecord) {
    const id = String(syncedPocketId);
    const current = this.records.get(id) || { revision: 0, encryptedRecord: null };
    this.records.set(id, {
      revision: current.revision + 1,
      encryptedRecord,
    });
    return current.revision + 1;
  }

  async readRemoteState(request) {
    this.calls.push({ type: "read", request });
    if (!this.available) return { ok: false, reason: "unavailable" };
    const current = this.records.get(request.syncedPocketId);
    return { ok: true, revision: current ? current.revision : 0 };
  }

  async conditionalWriteRemote(request) {
    this.calls.push({ type: "write", request });
    if (!this.available) return { ok: false, reason: "unavailable" };
    if (this.failWrite) return { ok: false, reason: "write-failed" };
    const current = this.records.get(request.syncedPocketId);
    const actualRevision = current ? current.revision : 0;
    if (actualRevision !== request.expectedRevision) {
      return { ok: false, conflict: true, actualRevision };
    }
    const revision = actualRevision + 1;
    this.records.set(request.syncedPocketId, {
      revision,
      encryptedRecord: request.encryptedRecord,
    });
    return { ok: true, revision };
  }
}

module.exports = { InMemorySyncAdapter };
