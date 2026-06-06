# Pipework rule

New behaviour must be added through small, named, dormant files first.

Existing large files should only be touched when the replacement structure is already in place.

Every write must be verified by fetching the changed file back before moving on.

Do not trust a commit SHA alone. A change is not complete until read-back confirms the file is whole.

If a write leaves a file truncated or broken, stop feature work. Repair and verify first.

Preferred pattern:

1. Create a small dormant file.
2. Fetch it back and verify it closes cleanly.
3. Add another small file if needed.
4. Wire behaviour only after the replacement structure exists.
5. Touch large files only with a narrow, planned change.

Large-file caution:

- Avoid full replacements of index.html through the connector.
- Avoid large JS files with embedded HTML templates.
- Prefer small modules, separate HTML files, and clear version markers.
