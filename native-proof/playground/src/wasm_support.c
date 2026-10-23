/* Minimal WASM-only libc surface for this bounded in-memory proof.
 * This is a replaceable platform adapter, NOT Pocket application semantics.
 * Never use this allocator for production or untrusted persisted documents.
 */
#include <stddef.h>
#include <stdint.h>
#include <stdlib.h>
#include <string.h>

extern unsigned char __heap_base;

typedef struct block {
    struct block *next;
    size_t capacity;
} block;

static block *free_list;
static uintptr_t end_offset;

static uintptr_t round_up_8(uintptr_t x) { return (x + 7u) & ~(uintptr_t)7u; }

void *malloc(size_t size) {
    if (size == 0) size = 1;
    if (size > 65536u) return NULL;
    size = (size_t)round_up_8(size);
    block **current = &free_list;
    while (*current) {
        if ((*current)->capacity >= size) {
            block *found = *current;
            *current = found->next;
            return (void *)(found + 1);
        }
        current = &(*current)->next;
    }
    if (!end_offset) end_offset = round_up_8((uintptr_t)&__heap_base);
    uintptr_t total = sizeof(block) + size;
    if (end_offset > UINT32_MAX - total) return NULL;
    uintptr_t requested_end = end_offset + total;
    uintptr_t byte_capacity = (uintptr_t)__builtin_wasm_memory_size(0) * 65536u;
    if (requested_end > byte_capacity) {
        uintptr_t pages = (requested_end - byte_capacity + 65535u) / 65536u;
        if (__builtin_wasm_memory_grow(0, pages) == (size_t)-1) return NULL;
    }
    block *new_block = (block *)end_offset;
    new_block->capacity = size;
    new_block->next = NULL;
    end_offset = requested_end;
    return (void *)(new_block + 1);
}

void free(void *ptr) {
    if (!ptr) return;
    block *returned = ((block *)ptr) - 1;
    returned->next = free_list;
    free_list = returned;
}

void *calloc(size_t count, size_t size) {
    if (size && count > SIZE_MAX / size) return NULL;
    size_t len = count * size;
    void *p = malloc(len);
    if (p) memset(p, 0, len);
    return p;
}

void *memcpy(void *dest, const void *src, size_t count) {
    unsigned char *d = (unsigned char *)dest;
    const unsigned char *s = (const unsigned char *)src;
    for (size_t i = 0; i < count; i++) d[i] = s[i];
    return dest;
}

void *memset(void *dest, int value, size_t count) {
    unsigned char *d = (unsigned char *)dest;
    for (size_t i = 0; i < count; i++) d[i] = (unsigned char)value;
    return dest;
}

int memcmp(const void *first, const void *second, size_t count) {
    const unsigned char *a = (const unsigned char *)first;
    const unsigned char *b = (const unsigned char *)second;
    for (size_t i = 0; i < count; i++) {
        if (a[i] != b[i]) return (int)a[i] - (int)b[i];
    }
    return 0;
}
