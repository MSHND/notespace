#include "pocket_core.h"
#include <stdlib.h>
#include <string.h>
#include <limits.h>

struct pc_document {
    uint8_t *identity;
    size_t identity_length;
    uint8_t *text;
    size_t text_length;
    uint64_t revision;
    uint64_t saved_revision;
    uint64_t epoch;
};

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
    if (!identity_is_valid(identity, identity_length) ||
        (text_length && !text) || text_length == SIZE_MAX) return PC_INVALID;
    pc_document *doc = (pc_document *) calloc(1, sizeof(*doc));
    if (!doc) return PC_NO_MEMORY;
    doc->identity = copy_bytes(identity, identity_length);
    doc->text = copy_bytes(text, text_length);
    if (!doc->identity || !doc->text) {
        pc_document_destroy(doc);
        return PC_NO_MEMORY;
    }
    doc->identity_length = identity_length;
    doc->text_length = text_length;
    doc->revision = loaded_revision;
    doc->saved_revision = loaded_revision;
    doc->epoch = 1;
    *out_document = doc;
    return PC_OK;
}

void pc_document_destroy(pc_document *doc) {
    if (!doc) return;
    free(doc->identity);
    free(doc->text);
    free(doc);
}

pc_result pc_document_edit(pc_document *doc, const uint8_t *text, size_t length) {
    if (!doc || (length && !text) || length == SIZE_MAX) return PC_INVALID;
    if (length == doc->text_length && (!length || !memcmp(text, doc->text, length)))
        return PC_UNCHANGED;
    if (doc->revision == UINT64_MAX || doc->epoch == UINT64_MAX) return PC_OVERFLOW;
    uint8_t *copy = copy_bytes(text, length);
    if (!copy) return PC_NO_MEMORY;
    free(doc->text);
    doc->text = copy;
    doc->text_length = length;
    doc->revision++;
    doc->epoch++;
    return PC_OK;
}

pc_result pc_document_capture(const pc_document *doc, pc_snapshot *snapshot) {
    if (!doc || !snapshot) return PC_INVALID;
    memset(snapshot, 0, sizeof(*snapshot));
    snapshot->identity = copy_bytes(doc->identity, doc->identity_length);
    snapshot->text = copy_bytes(doc->text, doc->text_length);
    if (!snapshot->identity || !snapshot->text) {
        pc_snapshot_release(snapshot);
        return PC_NO_MEMORY;
    }
    snapshot->identity_length = doc->identity_length;
    snapshot->text_length = doc->text_length;
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
    doc->saved_revision = revision;
    return PC_OK;
}

int pc_document_is_dirty(const pc_document *doc) {
    return doc ? doc->revision != doc->saved_revision : 0;
}

uint64_t pc_document_revision(const pc_document *doc) {
    return doc ? doc->revision : 0;
}
