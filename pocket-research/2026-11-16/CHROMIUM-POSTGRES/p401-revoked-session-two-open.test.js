"use strict";
// P401 fictional only. Server-issued old cookie is retained in test memory,
// then revoked by an ACTUAL subsequent native passkey Open on the same owner.
// No token, session ID, credential, account ID or Pocket content is logged.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const Module = require("node:module");
const filename = path.join(__dirname, "p383-authenticated-open-save-readback.test.js");
let source = fs.readFileSync(filename, "utf8");
function replaceOnce(needle, value) {
  assert.equal(source.split(needle).length, 2, "P401 pinned P383 drift: " + needle.slice(0, 80));
  source = source.replace(needle, value);
}
replaceOnce("P383 Chromium Open, Starling Save, PostgreSQL acceptance and fresh Chromium readback",
  "P401 real revoked-and-replaced server cookie, separate second user Open");
replaceOnce(
  '    await reader.cdp.send("WebAuthn.addCredential", {\n      authenticatorId: reader.authenticatorId, credential: credentials[0],\n    });',
  [
    '    const already = await reader.cdp.send("WebAuthn.getCredentials",',
    '      { authenticatorId: reader.authenticatorId });',
    '    if (already.credentials.length === 0) {',
    '      await reader.cdp.send("WebAuthn.addCredential", {',
    '        authenticatorId: reader.authenticatorId, credential: credentials[0] });',
    '    } else {',
    '      assert.equal(already.credentials.length, 1);',
    '      assert.equal(already.credentials[0].credentialId, credentials[0].credentialId);',
    '    }',
  ].join("\n")
);
replaceOnce("return { ok: result.ok, reason: result.reason, prfTransfers };",
  "return { ok: result.ok, reason: result.reason, adopted: result.adopted, sourceOwnerPreserved: result.sourceOwnerPreserved, failureCode: result.failureCode, prfTransfers };");
replaceOnce("  const b = await openBrowser(browser, origin);", [
  '  const original = (await a.context.cookies(origin))',
  '    .find(item => item.name === POLICY.sessionCookieName);',
  '  assert.ok(original?.httpOnly, "Real server-issued session required");',
  '  const unchangedHead = await sqlState(sql, activated.pocket);',
  '  // A separate real native passkey Open REPLACES the prior server session.',
  '  const replacementOpen = await a.page.evaluate(() => PocketSyncActiveIntegration.openExisting());',
  '  assert.equal(replacementOpen.ok, true, "Lawful session replacement: " + replacementOpen.reason);',
  '  const replacement = (await a.context.cookies(origin))',
  '    .find(item => item.name === POLICY.sessionCookieName);',
  '  assert.ok(replacement?.httpOnly && replacement.value !== original.value);',
  '  const { rows: oldRows } = await sql.query(',
  '    "SELECT record->>\'status\' AS status, record->>\'replacedBy\' AS next FROM public.pocket_sync_records WHERE collection = \'sessions\' AND record_key = $1",',
  '    [original.value]);',
  '  assert.equal(oldRows.length, 1);',
  '  assert.equal(oldRows[0].status, "revoked");',
  '  assert.equal(oldRows[0].next, replacement.value, "PG proves server replacement lineage");',
  '  const b = await openBrowser(browser, origin);',
  '  await b.context.addCookies([{ name: POLICY.sessionCookieName, value: original.value,',
  '    url: origin, secure: true, httpOnly: true, sameSite: "Strict" }]);',
  '  const p401Probe = require("./p396-session-provenance.js");',
  '  const initial = await p401Probe.sessionBefore({ reader: b, origin, sql });',
  '  assert.deepEqual({ state: initial.state, cookieCount: initial.cookieCount },',
  '    { state: "revoked-and-replaced-session", cookieCount: 1 });',
  '  // First user Open must FAIL CLOSED. No client-side removal or silent retry.',
  '  const first = await openWithSyncedFixturePasskey(b, a,',
  '    { ...prf, salt: prf.salt.slice(), output: prf.output.slice() });',
  '  assert.equal(first.ok, false);',
  '  assert.equal(first.adopted, false);',
  '  assert.equal(first.prfTransfers, 0);',
  '  const firstTrace = await p401Probe.authenticationBeginAfter({',
  '    reader: b, origin, before: initial });',
  '  assert.equal(firstTrace.requests.length, 1, "No automatic repeat begin");',
  '  assert.deepEqual({ http: firstTrace.requests[0].status,',
  '    reason: firstTrace.requests[0].reason, cleared: firstTrace.requests[0].clearedByServer },',
  '    { http: 401, reason: "service-session-invalid", cleared: true });',
  '  assert.equal(firstTrace.cookiesAfter, 0, "Server Max-Age=0 clears revoked cookie");',
  '  assert.equal(b.responses.filter(x => x.route === ROUTES.finishAuthentication).length, 0);',
  '  assert.equal(b.responses.filter(x => x.route === ROUTES.compareAndSetShadowHead).length, 0);',
  '  assert.equal(await b.page.evaluate(() => capturePocketFileSaveSession().ownerKind), "none");',
  '  assert.equal(await b.page.evaluate(() => canModifyPocket()), false);',
  '  assert.deepEqual(await sqlState(sql, activated.pocket), unchangedHead);',
  '  // Explicit SECOND user gesture, same Chromium profile, same fictional Pocket.',
  '  const second = await openWithSyncedFixturePasskey(b, a,',
  '    { ...prf, salt: prf.salt.slice(), output: prf.output.slice() });',
  '  assert.equal(second.ok, true, "Second Open: " + second.reason);',
  '  assert.equal(second.prfTransfers, 1);',
  '  const all = await p401Probe.authenticationBeginAfter({ reader: b, origin, before: initial });',
  '  assert.deepEqual(all.requests.map(x => x.status), [401, 200, 200]);',
  '  assert.equal(b.responses.filter(x => x.route === ROUTES.finishAuthentication',
  '    && x.response.status() === 200).length, 2);',
  '  assert.equal(await b.page.evaluate(() =>',
  '    PocketOwnerSaveBoundary.captureOwnerSaveSession().ownerKind), "synced");',
  '  assert.equal(b.responses.filter(x => x.route === ROUTES.compareAndSetShadowHead).length, 0);',
  '  assert.deepEqual(await sqlState(sql, activated.pocket), unchangedHead);',
  '  assert.deepEqual((await contents(b.page)).map(x => x.id), ["beta", "alpha", "restore"]);',
  '  console.info("P401_REVOKED_TWO_OPEN=" + JSON.stringify({',
  '    oldSession: "revoked-and-replaced", firstHttp: 401, serverCleared: true,',
  '    firstPasskey: false, silentRetry: false, explicitlyNewOpen: true,',
  '    lawfulPasskey: true, samePocket: true, extraCAS: 0, fictional: true }));',
  '  await b.context.close();',
  '  return;',
  '  const unusedOriginalReader = await openBrowser(browser, origin);',
].join("\n"));
const runner = new Module(filename, module);
runner.filename = filename;
runner.paths = module.paths;
runner._compile(source, filename);
