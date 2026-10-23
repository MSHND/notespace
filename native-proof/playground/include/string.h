#ifndef PG_FREESTANDING_STRING_H
#define PG_FREESTANDING_STRING_H
#include <stddef.h>
void *memcpy(void *dest, const void *src, size_t count);
void *memset(void *dest, int value, size_t count);
int memcmp(const void *first, const void *second, size_t count);
#endif
