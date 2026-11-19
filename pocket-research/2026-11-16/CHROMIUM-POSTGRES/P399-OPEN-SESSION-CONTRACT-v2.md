# P399-A | Research-only Open session contract v2
Status: fictional Chromium / disposable PostgreSQL acceptance hypothesis, not hosted product policy.
Source approval: pocket.alpha-p399-a-three-state-open-contract-20261119 rev1, 19 Nov 2026 AWST. Existing P387/P390 strict tests unchanged.

## Distinct server/browser states, no silent equivalence
A. ACTIVE-UNEXPIRED. At the precise original crash/restart Open boundary, browser holds one HTTP-only session cookie which maps to a server active, unexpired session in actual disposable PostgreSQL. User-initiated Open may immediately perform account-bound passkey and protected-stage validation. It must recover exact encrypted Pending or historical H3 receipt / lawful H4, never replay Head CAS.
B. ABSENT. Browser has ZERO HTTP-only session cookies before the user-initiated Open. This is not a revoked session and cannot satisfy a strict "active-cookie" witness. An explicit lawful discoverable bootstrap + bound passkey ceremony may authenticate the correct owner on that same Open. Before actual authentication, no adoption or protected stage read. After actual account-bound finish, verify correct Pocket/Head, no false Saved, no extra CAS. A fresh isolated browser with no existing local staged ledger proves remote readback only, not cross-device master-key custody.
C. REVOKED/REPLACED. Browser presents one actual server-revoked/replaced cookie: server responds real 401 service-session-invalid and clears cookie; first Open must fail before PRF and adoption. The same session's prior encrypted stage / receipt remains hidden, no edit/save/CAS. A separately user-initiated fresh passkey Open is a second operation, never an automatic retry; only after rightful-owner authentication may it revalidate stage/H4 receipt.

Expired/unknown cookies, unrecognised HTTP 401/403, wrong account, cancelled passkey, adapter missing/throws and source-protected inspection denied are additional fail-closed contrasts. Do not classify them as one of A/B/C without direct evidence. Actual browser-crash cookie restoration timing remains unproved. No synthetic HTTP403 stands in for real browser user cancellation.

## Deterministic fixtures without manufacturing success
- Actual `sessionBefore` from p396-session-provenance reads the real HTTP-only cookie plus matching server PostgreSQL record. Logs only state and count, never cookie/session/credential/account tokens.
- A is an observed active cookie; P398 strict active witnesses must FAIL if they observe B or C. Original P387/P390 untouched strict success oracles remain release-gating, even when their environment restores C.
- B is created only by a truly new Chromium browser context, not by clearing a stale cookie; require zero before, server successful fresh bootstrap and bound finish plus native passkey PRF, correct Pocket and no extra CAS.
- C is established through genuine server-revocation record, first actual 401+Set-Cookie clear; P397/P398 unchanged staged tests preserve Pending and H4 receipt across separate user Open. Existing P397 research fixture does insert a real previously revoked cookie from test PostgreSQL; that is explicit test setup, NOT evidence that every crash restores it.
- No in-app/session server auth changes, no skipped original red case, no branch protection bypass, no main/Render/real data/rights/schema/CSP change.

## Security contrasts and honest limits
- Wrong-account: use actually separately registered fictional other account/credential and verify it cannot adopt or disclose original owner's Pending/receipt; it may lawfully open its OWN separate Pocket only. Distinct from a synthetic denied HTTP request.
- Cancellation: require observed browser-native WebAuthn not-allowed/abort AFTER server begin; a JS-injected DOMException would be a simulated cancellation, not proven native user cancellation. Do not claim genuine user cancellation without actual native browser evidence.
- Adapter missing/throw + 403 protected inspection: only legitimate adoption may be called "adopted-but-editing-paused"; block plaintext, legacy/native Save and replay CAS. If not exercised in exact protected two-Open trace, UNPROVED.
- Any insufficiently observed class or negative remains UNPROVED; a green individual test does not promote Stage1 Gate1 or prove broader fine-grained VIEW/COMMIT, hidden relationships, melt, erasure, hosted real Save or multi-device key custody.

## Hard gates
Original P387/P390 sources and assertions remain unchanged. Full original P382–P398 suite plus focused new P399 witnesses, 81/81 stable and static, both isolated and sequential Chromium/PG: any red, not-run or skipped required witness means overall NO-GO. Record exact commit/jobs and actual TAP results.
