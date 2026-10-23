#include "pocket_core.h"
#include <stdlib.h>
#include <string.h>
#include <limits.h>

typedef struct pc_history_state {
    uint8_t *text;
    size_t length;
} pc_history_state;

struct pc_document {
    uint8_t *identity;
    size_t identity_length;
    /* Canonical text lives in the history state at history_index. */
    pc_history_state history[PC_HISTORY_MAX_STATES];
    size_t history_count;
    size_t history_index;
    size_t history_bytes;
    uint8_t *saved_text;
    size_t saved_text_length;
    uint64_t revision;
    uint64_t saved_revision;
    uint64_t epoch;
};

static const pc_history_state *current(const pc_document *doc) {
    return &doc->history[doc->history_index];
}

static uint8_t *copy_bytes(const uint8_t *source, size_t length) {
    if (length == SIZE_MAX || (length && !source)) return NULL;
    uint8_t *copy = (uint8_t *) malloc(length + 1);
    if (!copy) return NULL;
    if (length) memcpy(copy, source, length);
    copy[length] = 0;
    return copy;
}

/* Restrict fixture identities to readable UUID-like ASCII; no path components. */
static int identity_is_valid(const uint8_t *identity, size_t length) {
    if (!identity || length < 1 || length > 64) return 0;
    for (size_t i = 0; i < length; i++) {
        uint8_t c = identity[i];
        if (!((c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z') ||
              (c >= '0' && c <= '9') || c == '-')) return 0;
    }
    return 1;
}

pc_result pc_document_create(const uint8_t *identity, size_t identity_length,
                             const uint8_t *text, size_t text_length,
                             uint64_t loaded_revision, pc_document **out_document) {
    if (!out_document) return PC_INVALID;
    *out_document = NULL;
    if (!identity_is_valid(identity, identity_length) || (text_length && !text))
        return PC_INVALID;
    if (text_length > PC_TEXT_MAX_BYTES) return PC_OVERFLOW;
    pc_document *doc = (pc_document *) calloc(1, sizeof(*doc));
    if (!doc) return PC_NO_MEMORY;
    doc->identity = copy_bytes(identity, identity_length);
    doc->history[0].text = copy_bytes(text, text_length);
    doc->saved_text = copy_bytes(text, text_length);
    if (!doc->identity || !doc->history[0].text || !doc->saved_text) {
        pc_document_destroy(doc);
        return PC_NO_MEMORY;
    }
    doc->identity_length = identity_length;
    doc->history[0].length = text_length;
    doc->history_count = 1;
    doc->history_bytes = text_length;
    doc->saved_text_length = text_length;
    doc->revision = loaded_revision;
    doc->saved_revision = loaded_revision;
    doc->epoch = 1;
    *out_document = doc;
    return PC_OK;
}

void pc_document_destroy(pc_document *doc) {
    if (!doc) return;
    free(doc->identity);
    for (size_t i = 0; i < doc->history_count; i++) free(doc->history[i].text);
    if (!doc->history_count) free(doc->history[0].text);
    free(doc->saved_text);
    free(doc);
}

/* All resource checks and allocation precede mutation. */
pc_result pc_document_edit(pc_document *doc, const uint8_t *text, size_t length) {
    if (!doc || (length && !text)) return PC_INVALID;
    if (length > PC_TEXT_MAX_BYTES) return PC_OVERFLOW;
    const pc_history_state *here = current(doc);
    if (length == here->length && (!length || !memcmp(text, here->text, length)))
        return PC_UNCHANGED;
    if (doc->revision == UINT64_MAX || doc->epoch == UINT64_MAX) return PC_OVERFLOW;
    uint8_t *copy = copy_bytes(text, length);
    if (!copy) return PC_NO_MEMORY;

    /* No-op and failed edit preserve Redo; a successful divergent edit drops it. */
    for (size_t i = doc->history_index + 1; i < doc->history_count; i++) {
        doc->history_bytes -= doc->history[i].length;
        free(doc->history[i].text);
        doc->history[i].text = NULL;
    }
    doc->history_count = doc->history_index + 1;
    /* Keep current plus new state: drop oldest history on either limit. */
    while (doc->history_count == PC_HISTORY_MAX_STATES ||
           doc->history_bytes + length > PC_HISTORY_MAX_BYTES) {
        doc->history_bytes -= doc->history[0].length;
        free(doc->history[0].text);
        for (size_t i = 1; i < doc->history_count; i++)
            doc->history[i - 1] = doc->history[i];
        doc->history_count--;
        doc->history_index--;
    }
    doc->history[doc->history_count].text = copy;
    doc->history[doc->history_count].length = length;
    doc->history_count++;
    doc->history_index++;
    doc->history_bytes += length;
    doc->revision++;
    doc->epoch++;
    return PC_OK;
}

int pc_document_can_undo(const pc_document *doc) {
    return doc && doc->history_index > 0;
}
int pc_document_can_redo(const pc_document *doc) {
    return doc && doc->history_index + 1 < doc->history_count;
}
pc_result pc_document_undo(pc_document *doc) {
    if (!doc) return PC_INVALID;
    if (!pc_document_can_undo(doc)) return PC_UNCHANGED;
    if (doc->revision == UINT64_MAX || doc->epoch == UINT64_MAX) return PC_OVERFLOW;
    doc->history_index--;
    doc->revision++;
    doc->epoch++;
    return PC_OK;
}
pc_result pc_document_redo(pc_document *doc) {
    if (!doc) return PC_INVALID;
    if (!pc_document_can_redo(doc)) return PC_UNCHANGED;
    if (doc->revision == UINT64_MAX || doc->epoch == UINT64_MAX) return PC_OVERFLOW;
    doc->history_index++;
    doc->revision++;
    doc->epoch++;
    return PC_OK;
}

pc_result pc_document_capture(const pc_document *doc, pc_snapshot *snapshot) {
    if (!doc || !snapshot) return PC_INVALID;
    memset(snapshot, 0, sizeof(*snapshot));
    const pc_history_state *here = current(doc);
    snapshot->identity = copy_bytes(doc->identity, doc->identity_length);
    snapshot->text = copy_bytes(here->text, here->length);
    if (!snapshot->identity || !snapshot->text) {
        pc_snapshot_release(snapshot);
        return PC_NO_MEMORY;
    }
    snapshot->identity_length = doc->identity_length;
    snapshot->text_length = here->length;
    snapshot->revision = doc->revision;
    snapshot->epoch = doc->epoch;
    return PC_OK;
}

void pc_snapshot_release(pc_snapshot *snapshot) {
    if (!snapshot) return;
    free(snapshot->identity);
    free(snapshot->text);
    memset(snapshot, 0, sizeof(*snapshot));
}

pc_result pc_document_confirm_saved(pc_document *doc, uint64_t revision, uint64_t epoch) {
    if (!doc) return PC_INVALID;
    if (doc->revision != revision || doc->epoch != epoch) return PC_STALE;
    const pc_history_state *here = current(doc);
    /* A valid confirmation is the only authority to advance the baseline.
       Allocate first so failure cannot alter the previous confirmed content. */
    if (here->length != doc->saved_text_length ||
        (here->length && memcmp(here->text, doc->saved_text, here->length))) {
        uint8_t *new_baseline = copy_bytes(here->text, here->length);
        if (!new_baseline) return PC_NO_MEMORY;
        free(doc->saved_text);
        doc->saved_text = new_baseline;
        doc->saved_text_length = here->length;
    }
    doc->saved_revision = revision;
    return PC_OK;
}

int pc_document_is_dirty(const pc_document *doc) {
    if (!doc) return 0;
    const pc_history_state *here = current(doc);
    return (here->length != doc->saved_text_length ||
                   (here->length && memcmp(here->text, doc->saved_text, here->length) != 0));
}

uint64_t pc_document_revision(const pc_document *doc) {
    return doc ? doc->revision : 0;
}
