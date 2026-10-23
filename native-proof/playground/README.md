# Pocket disposable browser playground — Stage 0 candidate

**Open `index.html` in a modern Chrome, Edge, Safari or Firefox browser.**
Download the file if viewing it on GitHub: GitHub's source viewer is not an
executable preview. It is a single self-contained HTML file: no local web
server, installation, service, account, internet connection or real Pocket
file is needed after download. Editing works entirely in browser memory.

## What is actually running?

`index.html` embeds binary WebAssembly compiled from the
`native-proof/Sources/CPocketCore/pocket_core.c` source and its header.
The browser UI calls `pg_edit`, `pg_undo`, `pg_redo`, `pg_capture`, `pg_mark_baseline` and `pg_reset`
in a small C adapter, which delegates text and dirty/revision meaning to the
Pocket-owned C11 core. JavaScript does **not** simulate the core state.

Play with the disposable thought, **Mark in-memory baseline**, edit again,
use diagnostic **Undo (core)** and **Redo (core)**, **Restore baseline text**,
and **Reset playground**. The core's revision and
dirty flag are shown on screen. The dirty-state regression is corrected: restoring exactly identical confirmed
baseline text makes Dirty=NO while revision history continues to advance.
Undo/Redo are now Pocket-owned C11 core operations; each explicit successful edit is one step.

There is **no actual local file Save**, no persistent Undo history across reloads, no real Pocket model, no account or Sync, no E2EE, no
backend and no network submission. Ctrl/Cmd+Z remains browser/textarea-owned and is NOT core keyboard acceptance.
The diagnostic buttons exercise the real compiled C11 history and do not test caret/IME/grouping. Do not type real or
private information into this experimental preview.

## Build and test

On Linux or macOS with Clang (WASM target + wasm-ld), Python 3 and Node 22+:

```sh
bash native-proof/playground/build-html.sh
node native-proof/playground/tests/web-core-smoke.mjs
```

This recompiles and reinlines the WASM. `web-core-smoke.mjs` instantiates the
**actual binary** in Node's WebAssembly runtime and checks Unicode, mutation,
revision, dirty flag, baseline confirmation, Undo/Redo, branching, reset and oversized input refusal.
CI builds another fresh copy and tests both the rebuilt and committed HTML.

The browser-specific visual interaction, keyboard/IME and accessibility
require physical browser acceptance. This proof is only a thin disposable
adapter; no production code integration, deployment or Stage 0 adoption.

Core provenanced from the native status-fix source ZIP SHA256:
`933855a16385ede51b6c19b205bd43ed820ce63758cfbb9bd7c2465435cfb90e`.

Portable C11 proof caps each text at 32 KiB and retained history at 33 states
(32 Undo transitions) and 128 KiB of text bytes. The browser bridge stays at
4 KiB per disposable thought. On a successful edit, oldest history is evicted
when limits are reached; oversized edits return PC_OVERFLOW without mutation.
Saved-baseline bytes are retained separately and are not evicted with history.
Allocation failure returns PC_NO_MEMORY without partial mutation. No OS keyboard
interception, coalescing, disk Save, production Undo or native acceptance is claimed.
