# P398-A Open session-state contract v1 | FICTIONAL RESEARCH ONLY

Status: versioned research acceptance contract, NOT a product/production policy. Parent Pocket Project Documents: pocket.alpha-p398-a-open-session-contract-20261119 rev2 (owner-approved one cycle, 19 November 2026 AWST).

## Lawful Open classes
1. ACTIVE (server record active, unexpired, one HTTP-only cookie for the expected rightful owner): preserve original P387/P390 immediate Open success assertions AND encrypted staged Pending or accepted H3/H4 receipt integrity. Merely seeing a browser cookie does NOT prove ACTIVE.
2. REVOKED/REPLACED or EXPIRED: server-authored exact 401 session-invalid/expired, server Set-Cookie clear, *first Open fails before passkey PRF/adoption*, no staged plaintext, edit, Save, false Saved or Head CAS; a separately user-initiated passkey Open may restore the SAME lawful owner's original Pocket and encrypted pending/receipt. Do not silently auto-retry, clear client-side cookies, or rewrite a 401 as a green first Open.
3. UNKNOWN/other 401/403/denied authentication or inaccessible protected-stage adapter/inspection: fail closed, stage concealed, no alternative legacy Save, and no authorised read or CAS without a fresh successful correct-owner check. Denial of the second explicit attempt is not authority to reveal Pending or receipt metadata. Existing P394/P395 controls are not a complete grant matrix.

## Falsification/provenance
- Real disposable PostgreSQL session row is the authority for active vs revoked/replaced. Chromium persistent-profile cookie is observational evidence only. Never expose cookie/session ID, credential or account token in logs.
- P398 valid-session wrapper cases append only a *precondition* to original P387/P390 test bodies: if the persisted cookie is revoked, the single-Open witness stays RED and the exact server reason is diagnosed by P396; original tests themselves remain unchanged.
- P398 denied-second wrappers compose P397 genuine server 401 + cookie clear and protected Pending/H4 trace with an additional explicit fictional HTTP403 for the next user-requested authentication. They require no passkey PRF, adoption, plaintext, edit or CAS during refusal, then a distinct later user-requested successful passkey Open must preserve the original encrypted state and original strict P387/P390 continuation.
- Denied-passkey here is an HTTP403 interception before ceremony. It does NOT by itself simulate a user cancelling a begun WebAuthn ceremony or prove other-owner account isolation. Wrong-account, adapter-missing/throw and exact post-second-Open inspection-403 remain separate hard gates unless exercised and independently observed; do not falsely claim comprehensive pass.
- All core/static and original P382-P397 focused/sequence cases remain required. No green CI claim if any original focused case fails. No release/gate promotion even if synthetic research is green.

## Strict exclusions
No source/product/server authentication modifications, automatic retry, client-side cookie manipulation for positive witnesses, main merge, Render deploy, real/personal/work/cultural data, grant/schema/CSP change, source-hidden leaks, Stage1 Gate1 promotion or automatic successor.
