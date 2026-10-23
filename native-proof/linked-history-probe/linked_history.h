#ifndef POCKET_LINKED_HISTORY_PROBE_H
#define POCKET_LINKED_HISTORY_PROBE_H

#include <stddef.h>
#include <stdint.h>

/* Isolated semantic proof, NOT the production Pocket schema or Save mechanism. */
#define LH_NODES 4u
#define LH_RECORD_LIMIT 24u
#define LH_TEXT_LIMIT 128u

typedef enum { LH_OK=0, LH_UNCHANGED=1, LH_INVALID=2, LH_STALE=3, LH_FULL=4 } lh_result;
typedef enum { LH_TEXT_EDIT=1, LH_NODE_MOVE=2 } lh_kind;

typedef struct {
    uint32_t id;
    uint32_t parent;
    char text[LH_TEXT_LIMIT];
} lh_node;

typedef struct {
    uint64_t id;
    uint64_t previous_id;
    uint64_t reverses_id;  /* A reversal is a NEW event, never deletion of accepted history. */
    lh_kind kind;
    uint32_t target_id;
    uint32_t parent_before;
    uint32_t parent_after;
    char text_before[LH_TEXT_LIMIT];
    char text_after[LH_TEXT_LIMIT];
} lh_change;

typedef struct {
    lh_node nodes[LH_NODES];
    lh_node confirmed_nodes[LH_NODES];
    lh_change changes[LH_RECORD_LIMIT];
    size_t change_count;
    size_t confirmed_through;
    uint64_t revision;
    uint64_t epoch;
} lh_document;

typedef struct {
    uint64_t revision;
    uint64_t epoch;
    size_t change_count;
} lh_save_token;

void lh_init(lh_document *doc);
lh_result lh_edit_text(lh_document *doc, uint32_t target, const char *text);
lh_result lh_move(lh_document *doc, uint32_t target, uint32_t parent);
lh_result lh_reverse(lh_document *doc, uint64_t change_id);
int lh_dirty(const lh_document *doc);
lh_save_token lh_capture_token(const lh_document *doc);
lh_result lh_confirm_save(lh_document *doc, lh_save_token token);
/* Local snapshot and independent incremental history projection use SAME typed records. */
lh_result lh_export_local_json(const lh_document *doc, char *dest, size_t capacity);
lh_result lh_export_changes_json(const lh_document *doc, size_t from, char *dest, size_t capacity);

#endif
