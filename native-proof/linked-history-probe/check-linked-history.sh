#!/usr/bin/env bash
set -euo pipefail
root="$(cd "$(dirname "$0")" && pwd)"
tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT
cc -std=c11 -Wall -Wextra -Werror -pedantic -I "$root" \
  "$root/linked_history.c" "$root/test_linked_history.c" -o "$tmp/linked_history_test"
"$tmp/linked_history_test"
