#!/usr/bin/env bash
set -euo pipefail
root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cc="${CC:-cc}"
tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT
"$cc" -std=c11 -Wall -Wextra -Werror -pedantic \
  -I "$root/Sources/CPocketCore/include" \
  "$root/Sources/CPocketCore/pocket_core.c" \
  "$root/Tests/PortableCore/portable_core_test.c" \
  -o "$tmp/portable_core_test"
"$tmp/portable_core_test"
