# pocket split checkpoint

This is a structure-only split of the current single-file pocket app.

The goal is to keep behaviour the same while making future GitHub edits and the later Electron move safer.

## Files

- `index.html` — small app shell and script loading order.
- `styles.css` — visual/layout rules.
- `js/pocket-state.js` — state, DOM references, runtime flags.
- `js/pocket-data.js` — normalisation and data helper functions.
- `js/pocket-storage.js` — payload, local safety, cache, restore helpers.
- `js/pocket-import.js` — path/list import behaviours.
- `js/pocket-editor-copy.js` — details editor and copy-template behaviours.
- `js/pocket-history-status.js` — undo, status, save-state labels, inline edit setup.
- `js/pocket-tree-actions.js` — tree mutation, selection, movement, keyboard navigation.
- `js/pocket-render.js` — rendering and primary row commands.
- `js/pocket-io-browser.js` — browser save/open/popout/export behaviours.
- `js/pocket-overlays-init.js` — menus, controls help, command palette, event binding and startup.

## Electron path later

The later Electron move should mostly replace or complement `js/pocket-io-browser.js` with an Electron IO layer, while leaving the data model and rendering files alone.

## Important

This split intentionally keeps the old `pocketLite.*` local storage keys for continuity.
