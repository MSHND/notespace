#include "pocket_core.h"
#include <assert.h>
#include <string.h>
#include <stdio.h>

static pc_result make_doc(pc_document **out) {
    const char id[] = "portable-test-1";
    const char text[] = "original";
    return pc_document_create((const uint8_t *)id, sizeof(id)-1,
                              (const uint8_t *)text, sizeof(text)-1, 0, out);
}

int main(void) {
    pc_document *doc = NULL;
    assert(make_doc(&doc) == PC_OK && doc);
    assert(pc_document_revision(doc) == 0);
    assert(pc_document_is_dirty(doc) == 0);

    pc_snapshot before;
    assert(pc_document_capture(doc, &before) == PC_OK);
    assert(before.revision == 0 && before.epoch != 0);
    assert(before.text_length == 8 && memcmp(before.text, "original", 8) == 0);
    assert(pc_document_confirm_saved(doc, before.revision, before.epoch) == PC_OK);
    pc_snapshot_release(&before);

    const char edit[] = "original + edit";
    assert(pc_document_edit(doc, (const uint8_t *)edit, sizeof(edit)-1) == PC_OK);
    assert(pc_document_is_dirty(doc) == 1);
    assert(pc_document_revision(doc) == 1);
    assert(pc_document_confirm_saved(doc, 0, 1) == PC_STALE);
    assert(pc_document_edit(doc, (const uint8_t *)edit, sizeof(edit)-1) == PC_UNCHANGED);
    assert(pc_document_revision(doc) == 1);

    pc_snapshot after;
    assert(pc_document_capture(doc, &after) == PC_OK);
    assert(after.revision == 1 && after.text_length == sizeof(edit)-1);
    assert(pc_document_confirm_saved(doc, after.revision, after.epoch) == PC_OK);
    assert(pc_document_is_dirty(doc) == 0);
    pc_snapshot_release(&after);

    /* A known OPEN design issue: editing back to equal saved bytes still
       advances a revision. Do not claim portable Undo was fixed here. */
    assert(pc_document_edit(doc, (const uint8_t *)"original", 8) == PC_OK);
    assert(pc_document_is_dirty(doc) == 1);
    pc_document_destroy(doc);

    puts("portable C core proof PASS (no files, accounts or Sync)");
    return 0;
}
