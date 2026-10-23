#include "pocket_core.h"
#include <assert.h>
#include <string.h>
#include <stdint.h>
#include <stdio.h>

static unsigned checks;
#define CHECK(expr) do { assert(expr); checks++; } while (0)
static pc_document *loaded(const uint8_t *text, size_t length, uint64_t revision) {
    const uint8_t id[] = "portable-test-1";
    pc_document *doc = NULL;
    CHECK(pc_document_create(id, sizeof(id)-1, text, length, revision, &doc) == PC_OK);
    CHECK(doc != NULL);
    return doc;
}
static pc_snapshot capture(pc_document *doc) {
    pc_snapshot snap;
    CHECK(pc_document_capture(doc, &snap) == PC_OK);
    return snap;
}
static void content_cycle(void) {
    pc_document *doc = loaded((const uint8_t *)"original", 8, 2);
    CHECK(pc_document_revision(doc) == 2);
    CHECK(pc_document_is_dirty(doc) == 0);
    pc_snapshot baseline = capture(doc);
    CHECK(baseline.text_length == 8 && memcmp(baseline.text, "original", 8) == 0);
    CHECK(pc_document_confirm_saved(doc, baseline.revision, baseline.epoch) == PC_OK);
    CHECK(pc_document_edit(doc, (const uint8_t *)"original + edit", 15) == PC_OK);
    CHECK(pc_document_revision(doc) == 3 && pc_document_is_dirty(doc) == 1);
    pc_snapshot edited = capture(doc);
    CHECK(edited.epoch > baseline.epoch);
    CHECK(pc_document_edit(doc, (const uint8_t *)"original", 8) == PC_OK);
    CHECK(pc_document_revision(doc) == 4 && pc_document_is_dirty(doc) == 0);
    pc_snapshot restored = capture(doc);
    CHECK(restored.epoch > edited.epoch);
    CHECK(restored.identity_length == baseline.identity_length);
    CHECK(memcmp(restored.identity, baseline.identity, baseline.identity_length) == 0);
    CHECK(pc_document_confirm_saved(doc, edited.revision, edited.epoch) == PC_STALE);
    CHECK(pc_document_confirm_saved(doc, baseline.revision, baseline.epoch) == PC_STALE);
    CHECK(pc_document_is_dirty(doc) == 0);
    CHECK(pc_document_edit(doc, (const uint8_t *)"second baseline", 15) == PC_OK);
    CHECK(pc_document_revision(doc) == 5 && pc_document_is_dirty(doc) == 1);
    CHECK(pc_document_confirm_saved(doc, restored.revision, restored.epoch) == PC_STALE);
    CHECK(pc_document_is_dirty(doc) == 1);
    pc_snapshot next = capture(doc);
    CHECK(pc_document_confirm_saved(doc, next.revision, next.epoch) == PC_OK);
    CHECK(pc_document_revision(doc) == 5 && pc_document_is_dirty(doc) == 0);
    CHECK(pc_document_edit(doc, (const uint8_t *)"original", 8) == PC_OK);
    CHECK(pc_document_revision(doc) == 6 && pc_document_is_dirty(doc) == 1);
    CHECK(pc_document_confirm_saved(doc, next.revision, next.epoch) == PC_STALE);
    CHECK(pc_document_is_dirty(doc) == 1);
    CHECK(pc_document_edit(doc, (const uint8_t *)"second baseline", 15) == PC_OK);
    CHECK(pc_document_revision(doc) == 7 && pc_document_is_dirty(doc) == 0);
    CHECK(pc_document_edit(doc, (const uint8_t *)"second baseline", 15) == PC_UNCHANGED);
    CHECK(pc_document_revision(doc) == 7);
    pc_snapshot_release(&baseline); pc_snapshot_release(&edited);
    pc_snapshot_release(&restored); pc_snapshot_release(&next);
    pc_document_destroy(doc);
}
static void empty_content(void) {
    pc_document *doc = loaded(NULL, 0, 0);
    CHECK(pc_document_is_dirty(doc) == 0);
    CHECK(pc_document_edit(doc, (const uint8_t *)"x\ny", 3) == PC_OK);
    CHECK(pc_document_is_dirty(doc) == 1);
    CHECK(pc_document_edit(doc, NULL, 0) == PC_OK);
    CHECK(pc_document_is_dirty(doc) == 0 && pc_document_revision(doc) == 2);
    pc_snapshot snap = capture(doc);
    CHECK(snap.text_length == 0 && snap.text != NULL);
    CHECK(pc_document_confirm_saved(doc, snap.revision, snap.epoch) == PC_OK);
    pc_snapshot_release(&snap);
    pc_document_destroy(doc);
}
static void unicode_and_nul(void) {
    const uint8_t baseline[] = "Kaya 🌿\nSecond line\nこんにちは";
    const uint8_t different[] = "Kaya 🍀\nSecond line\nこんにちは";
    pc_document *doc = loaded(baseline, sizeof(baseline)-1, 8);
    CHECK(pc_document_edit(doc, different, sizeof(different)-1) == PC_OK);
    CHECK(pc_document_is_dirty(doc) == 1);
    CHECK(pc_document_edit(doc, baseline, sizeof(baseline)-1) == PC_OK);
    CHECK(pc_document_is_dirty(doc) == 0 && pc_document_revision(doc) == 10);
    const uint8_t embedded[] = {'a',0,'b','\n',0};
    CHECK(pc_document_edit(doc, embedded, sizeof(embedded)) == PC_OK);
    CHECK(pc_document_is_dirty(doc) == 1);
    pc_snapshot snap = capture(doc);
    CHECK(snap.text_length == sizeof(embedded));
    CHECK(memcmp(snap.text, embedded, sizeof(embedded)) == 0);
    CHECK(pc_document_confirm_saved(doc, snap.revision, snap.epoch) == PC_OK);
    CHECK(pc_document_is_dirty(doc) == 0);
    CHECK(pc_document_edit(doc, baseline, sizeof(baseline)-1) == PC_OK);
    CHECK(pc_document_is_dirty(doc) == 1);
    CHECK(pc_document_edit(doc, embedded, sizeof(embedded)) == PC_OK);
    CHECK(pc_document_is_dirty(doc) == 0);
    pc_snapshot_release(&snap);
    pc_document_destroy(doc);
}
static void refusals_preserve_state(void) {
    pc_document *doc = loaded((const uint8_t *)"safe", 4, 0);
    CHECK(pc_document_edit(doc, NULL, 2) == PC_INVALID);
    CHECK(pc_document_edit(doc, (const uint8_t *)"x", SIZE_MAX) == PC_INVALID);
    CHECK(pc_document_revision(doc) == 0 && pc_document_is_dirty(doc) == 0);
    CHECK(pc_document_confirm_saved(doc, 0, 999) == PC_STALE);
    CHECK(pc_document_edit(doc, (const uint8_t *)"unsafe", 6) == PC_OK);
    CHECK(pc_document_confirm_saved(doc, 0, 1) == PC_STALE);
    CHECK(pc_document_is_dirty(doc) == 1);
    CHECK(pc_document_edit(doc, (const uint8_t *)"safe", 4) == PC_OK);
    CHECK(pc_document_is_dirty(doc) == 0);
    pc_document_destroy(doc);
}
int main(void) {
    content_cycle(); empty_content(); unicode_and_nul(); refusals_preserve_state();
    printf("portable C core proof PASS (4 suites, %u assertions; no files, accounts or Sync)\n", checks);
    return 0;
}
