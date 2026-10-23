#!/usr/bin/env bash
# Reproducible self-contained HTML preview. Requires clang+wasm-ld+base64+python3.
set -euo pipefail
here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
root="$(cd "$here/.." && pwd)"
out="${1:-$here/index.html}"
tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT
compiler="${CLANG:-clang}"
resource_dir="$($compiler -print-resource-dir)"
"$compiler" --target=wasm32-unknown-unknown -O2 -std=c11 -fno-builtin \
  -Werror -Wall -Wextra -pedantic -ffreestanding -nostdlib -nostdinc \
  -isystem "$resource_dir/include" \
  -I "$here/include" -I "$root/Sources/CPocketCore/include" \
  "$root/Sources/CPocketCore/pocket_core.c" \
  "$here/src/playground_bridge.c" "$here/src/wasm_support.c" \
  -Wl,--no-entry -Wl,--export-all -Wl,--initial-memory=131072 \
  -Wl,--max-memory=4194304 -Wl,--strip-debug \
  -o "$tmp/pocket-core.wasm"
python3 - "$here/index.template.html" "$tmp/pocket-core.wasm" "$out" <<'PY'
from pathlib import Path
import sys,base64
html=Path(sys.argv[1]).read_text()
assert html.count('@@CORE_WASM_BASE64@@') == 1
encoded=base64.b64encode(Path(sys.argv[2]).read_bytes()).decode('ascii')
Path(sys.argv[3]).write_text(html.replace('@@CORE_WASM_BASE64@@',encoded))
print('Browser artifact built:',sys.argv[3],'(',len(encoded)//4*3,'approximately WASM bytes )')
PY
