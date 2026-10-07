"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");

const {
  MAX_CONTENT_BYTES,
  SQL,
  createProjectDocumentsPostgresStore,
} = require("../sync-service/pocket-project-documents-postgres-store.js");

function fakePool() {
  const rows = new Map();
  let clock = 0;
  const nextTime = () => new Date(Date.UTC(2026, 9, 7, 12, 0, clock++));

  function publicRow(row, includeContent = true) {
    return {
      name: row.name,
      ...(includeContent ? { content: row.content } : {}),
      revision: String(row.revision),
      updated_at: row.updated_at,
    };
  }

  return {
    rows,
    async query(sql, values = []) {
      if (sql === SQL.list) {
        return {
          rowCount: rows.size,
          rows: [...rows.values()]
            .sort((left, right) => left.name.localeCompare(right.name))
            .map((row) => publicRow(row, false)),
        };
      }
      if (sql === SQL.read) {
        const row = rows.get(values[0]);
        return { rowCount: row ? 1 : 0, rows: row ? [publicRow(row)] : [] };
      }
      if (sql === SQL.create) {
        const [name, content] = values;
        if (rows.has(name)) {
          const error = new Error("duplicate");
          error.code = "23505";
          throw error;
        }
        const row = { name, content, revision: 1, updated_at: nextTime() };
        rows.set(name, row);
        return { rowCount: 1, rows: [publicRow(row)] };
      }
      if (sql === SQL.update) {
        const [name, expectedRevision, content] = values;
        const row = rows.get(name);
        if (!row || row.revision !== expectedRevision || row.revision >= 9007199254740991) {
          return { rowCount: 0, rows: [] };
        }
        const next = {
          name,
          content,
          revision: row.revision + 1,
          updated_at: nextTime(),
        };
        rows.set(name, next);
        return { rowCount: 1, rows: [publicRow(next)] };
      }
      if (sql === SQL.currentRevision) {
        const row = rows.get(values[0]);
        return {
          rowCount: row ? 1 : 0,
          rows: row ? [{ revision: String(row.revision) }] : [],
        };
      }
      throw new Error("unexpected query");
    },
  };
}

test("P349 store creates at revision 1, reads, and lists deterministically", async () => {
  const pool = fakePool();
  const store = createProjectDocumentsPostgresStore({ pool });

  const beta = await store.create("beta-doc", "second");
  const alpha = await store.create("alpha-doc", "first");
  assert.equal(beta.ok, true);
  assert.equal(beta.document.revision, 1);
  assert.equal(alpha.ok, true);
  assert.match(alpha.document.updatedAt, /^2026-10-07T12:00:/);

  assert.deepEqual(await store.list(), [
    { name: "alpha-doc", revision: 1, updatedAt: alpha.document.updatedAt },
    { name: "beta-doc", revision: 1, updatedAt: beta.document.updatedAt },
  ]);

  const read = await store.read("alpha-doc");
  assert.equal(read.ok, true);
  assert.equal(read.document.content, "first");
  assert.equal((await store.read("missing-doc")).reason, "not-found");
});

test("P349 duplicate create fails without upsert or content change", async () => {
  const pool = fakePool();
  const store = createProjectDocumentsPostgresStore({ pool });
  const first = await store.create("start-here", "original");
  assert.equal(first.ok, true);

  const duplicate = await store.create("start-here", "replacement");
  assert.deepEqual(duplicate, { ok: false, reason: "already-exists" });

  const read = await store.read("start-here");
  assert.equal(read.document.content, "original");
  assert.equal(read.document.revision, 1);
});

test("P349 CAS update increments exactly once and stale or missing revisions cannot change content", async () => {
  const pool = fakePool();
  const store = createProjectDocumentsPostgresStore({ pool });
  await store.create("current-task", "v1");

  const updated = await store.update("current-task", 1, "v2");
  assert.equal(updated.ok, true);
  assert.equal(updated.document.revision, 2);
  assert.equal(updated.document.content, "v2");

  const stale = await store.update("current-task", 1, "stale");
  assert.deepEqual(stale, { ok: false, reason: "revision-conflict", currentRevision: 2 });
  assert.equal((await store.read("current-task")).document.content, "v2");

  const missing = await store.update("missing-task", 1, "nope");
  assert.deepEqual(missing, { ok: false, reason: "not-found" });
});

test("P349 same-revision racing writers cannot both win", async () => {
  const pool = fakePool();
  const store = createProjectDocumentsPostgresStore({ pool });
  await store.create("last-report", "base");

  const [left, right] = await Promise.all([
    store.update("last-report", 1, "left"),
    store.update("last-report", 1, "right"),
  ]);

  const winners = [left, right].filter((result) => result.ok === true);
  const conflicts = [left, right].filter((result) => result.ok === false && result.reason === "revision-conflict");
  assert.equal(winners.length, 1);
  assert.equal(conflicts.length, 1);
  assert.equal(conflicts[0].currentRevision, 2);

  const final = await store.read("last-report");
  assert.equal(final.document.revision, 2);
  assert.equal(final.document.content, winners[0].document.content);
});

test("P349 store rejects invalid names, revisions and over-limit UTF-8 content before storage", async () => {
  const pool = fakePool();
  const store = createProjectDocumentsPostgresStore({ pool });

  await assert.rejects(
    () => store.create("Pocket — START HERE", "bad"),
    (error) => error?.code === "project-document-name-invalid"
  );
  await assert.rejects(
    () => store.update("start-here", 0, "bad"),
    (error) => error?.code === "project-document-revision-invalid"
  );

  const tooLarge = "😀".repeat(Math.floor(MAX_CONTENT_BYTES / 4) + 1);
  await assert.rejects(
    () => store.create("large-doc", tooLarge),
    (error) => error?.code === "project-document-content-invalid"
  );
  assert.equal(pool.rows.size, 0);
});
