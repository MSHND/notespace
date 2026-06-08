# Codex report

Status: Report-only safer plan for PE toolbar chip alignment.

Findings:

- Main chip style lives in `styles.css`: `:root` chip variables and the `.chip`, `.chip:hover`, `.chip.on` rules near the top of the file.
- Copy only button-surface visuals: border `rgba(148, 163, 184, 0.28)`, white panel background, radius `999px`, height `28px`, padding `0 12px`, `12px` text, centered inline-flex, subtle `0 1px 3px` shadow.
- Copy hover visuals only for PE toolbar buttons: whiter background and softer border `rgba(116, 124, 136, 0.26)`.
- Copy active visuals only to `.mode button.on`: blue-tint background, blue border, blue text.
- PE selectors to change: `.toolbarBtn`, `.mode button`, `.toolbarBtn:hover`, `.toolbarBtn:focus-visible`, `.mode button:hover`, `.mode button:focus-visible`, `.mode button.on`.
- Do not change PE markup, `.topbar`, `.toolbarGroup`, `.toolbarGroup.identity`, `.status`, `.grow`, `.toolbarHint`, `#closeBtn`, unsaved dialog markup, runtime script, script order, or save/apply plumbing.
- Yes, this can be done as CSS-only.

Safest first CSS-only edit:

- Add chip-like border/background/radius/shadow to `.toolbarBtn, .mode button` while preserving the existing toolbar DOM and status placement.
- Add matching hover/focus rules for only those selectors.
- Keep selected styling limited to `.mode button.on`; do not add any active/primary class to Save or Save & close.

Checks run:

- Not run; report-only documentation update.

Result:

- No code/runtime/template behaviour changed.

Manual retest steps for the future CSS-only pass:

1. Hard refresh Pocket.
2. Confirm the main tree renders before opening PE.
3. Open PE/item details and confirm only toolbar button visuals changed.
4. Confirm `save`, `save & close`, Cmd/Ctrl+S, Escape, and the unsaved dialog still behave as before.
