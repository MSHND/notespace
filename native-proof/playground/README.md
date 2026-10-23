# Pocket disposable browser playground — Stage 0 candidate

**Open `index.html` in a modern Chrome, Edge, Safari or Firefox browser.**
Download the file if viewing it on GitHub: GitHub's source viewer is not an
executable preview. It is a single self-contained HTML file: no local web
server, installation, service, account, internet connection or real Pocket
file is needed after download. Editing works entirely in browser memory.

## What is actually running?

`index.html` embeds binary WebAssembly compiled from the unchanged
`native-proof/Sources/CPocketCore/pocket_core.c` source and its header.
The browser UI calls `pg_edit`, `pg_capture`, `pg_mark_baseline` and `pg_reset`
in a small C adapter, which delegates text and dirty/revision meaning to the
Pocket-owned C11 core. JavaScript does **not** simulate the core state.

Play with the disposable thought, **Mark in-memory baseline**, edit again,
**Restore baseline text**, and **Reset playground**. The core's revision and
dirty flag are shown on screen. The dirty-state regression is corrected: restoring exactly identical confirmed
baseline text makes Dirty=NO while revision history continues to advance.
This proves the state *after an edit*, not an independent portable Undo owner.

There is **no actual local file Save**, no full portable Undo owner, no
persistent history, no real Pocket model, no account or Sync, no E2EE, no
backend and no network submission. Browser textarea Undo belongs to the
host editor and does not certify Pocket's Undo model. Do not type real or
private information into this experimental preview.

## Build and test

On Linux or macOS with Clang (WASM target + wasm-ld), Python 3 and Node 22+:

```sh
bash native-proof/playground/build-html.sh
node native-proof/playground/tests/web-core-smoke.mjs
```

This recompiles and reinlines the WASM. `web-core-smoke.mjs` instantiates the
**actual binary** in Node's WebAssembly runtime and checks Unicode, mutation,
revision, dirty flag, baseline confirmation, reset and oversized input refusal.
CI builds another fresh copy and tests both the rebuilt and committed HTML.

The browser-specific visual interaction, keyboard/IME and accessibility
require physical browser acceptance. This proof is only a thin disposable
adapter; no production code integration, deployment or Stage 0 adoption.

Core provenanced from the native status-fix source ZIP SHA256:
`933855a16385ede51b6c19b205bd43ed820ce63758cfbb9bd7c2465435cfb90e`.
