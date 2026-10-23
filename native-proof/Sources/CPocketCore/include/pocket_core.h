#ifndef POCKET_PROOF_CORE_H
#define POCKET_PROOF_CORE_H

#include <stddef.h>
#include <stdint.h>

/*
 * Pocket-owned portable semantic prototype. C11; no OS, UI or filesystem APIs.
 * A full Pocket document model, existing PE behaviour and E2EE are NOT included.
 * Bytes must be valid UTF-8. Text is allowed to contain embedded NUL bytes.
 */
#ifdef __cplusplus
extern "C" {
#endif

typedef struct pc_document pc_document;

typedef enum pc_result {
    PC_OK = 0,
    PC_UNCHANGED = 1,
    PC_INVALID = 2,
    PC_NO_MEMORY = 3,
    PC_OVERFLOW = 4,
    PC_STALE = 5
} pc_result;

typedef struct pc_snapshot {
    uint8_t *identity;
    size_t identity_length;
    uint8_t *text;
    size_t text_length;
    uint64_t revision;
    uint64_t epoch;
} pc_snapshot;

pc_result pc_document_create(const uint8_t *identity, size_t identity_length,
                             const uint8_t *text, size_t text_length,
                             uint64_t loaded_revision, pc_document **out_document);
void pc_document_destroy(pc_document *document);
pc_result pc_document_edit(pc_document *document, const uint8_t *text, size_t text_length);
pc_result pc_document_capture(const pc_document *document, pc_snapshot *snapshot);
void pc_snapshot_release(pc_snapshot *snapshot);
pc_result pc_document_confirm_saved(pc_document *document, uint64_t revision,
                                    uint64_t epoch);
int pc_document_is_dirty(const pc_document *document);
uint64_t pc_document_revision(const pc_document *document);

#ifdef __cplusplus
}
#endif
#endif
