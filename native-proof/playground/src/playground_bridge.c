/* Browser presentation boundary over unchanged Pocket C11 core.
 * All data is synthetic, memory-only and bounded to 4 KiB per thought.
 */
#include "pocket_core.h"
#include <stddef.h>
#include <stdint.h>
#include <string.h>

#define PG_MAX_BYTES 4096u
#define PG_ID "disposable-playground-1"
#define PG_INITIAL "A tiny thought, just for testing. 🌿"

static pc_document *document = NULL;
static uint8_t input_buffer[PG_MAX_BYTES];
static uint8_t display_buffer[PG_MAX_BYTES + 1];
static uint32_t display_size;

int pg_reset(void) {
    pc_document *next = NULL;
    const uint8_t id[] = PG_ID;
    const uint8_t initial[] = PG_INITIAL;
    pc_result result = pc_document_create(id, sizeof(id) - 1,
                                          initial, sizeof(initial) - 1,
                                          0, &next);
    if (result != PC_OK) return (int)result;
    pc_document_destroy(document);
    document = next;
    return (int)PC_OK;
}

uint32_t pg_input_pointer(void) { return (uint32_t)(uintptr_t)input_buffer; }
uint32_t pg_input_capacity(void) { return PG_MAX_BYTES; }

int pg_edit(uint32_t byte_count) {
    if (!document || byte_count > PG_MAX_BYTES) return (int)PC_INVALID;
    return (int)pc_document_edit(document, input_buffer, byte_count);
}

/* Thin WASM adapter: the C11 document remains the only Undo/Redo owner. */
int pg_undo(void) { return document ? (int)pc_document_undo(document) : (int)PC_INVALID; }
int pg_redo(void) { return document ? (int)pc_document_redo(document) : (int)PC_INVALID; }
int pg_can_undo(void) { return pc_document_can_undo(document); }
int pg_can_redo(void) { return pc_document_can_redo(document); }

int pg_mark_baseline(void) {
    if (!document) return (int)PC_INVALID;
    pc_snapshot snap;
    pc_result result = pc_document_capture(document, &snap);
    if (result != PC_OK) return (int)result;
    result = pc_document_confirm_saved(document, snap.revision, snap.epoch);
    pc_snapshot_release(&snap);
    return (int)result;
}

int pg_capture(void) {
    if (!document) return -1;
    pc_snapshot snap;
    pc_result result = pc_document_capture(document, &snap);
    if (result != PC_OK) return -1;
    if (snap.text_length > PG_MAX_BYTES) {
        pc_snapshot_release(&snap);
        return -1;
    }
    memcpy(display_buffer, snap.text, snap.text_length);
    display_buffer[snap.text_length] = 0;
    display_size = (uint32_t)snap.text_length;
    pc_snapshot_release(&snap);
    return (int)display_size;
}
uint32_t pg_display_pointer(void) { return (uint32_t)(uintptr_t)display_buffer; }
uint32_t pg_display_size(void) { return display_size; }
int pg_is_dirty(void) { return pc_document_is_dirty(document); }
uint64_t pg_revision(void) { return pc_document_revision(document); }
