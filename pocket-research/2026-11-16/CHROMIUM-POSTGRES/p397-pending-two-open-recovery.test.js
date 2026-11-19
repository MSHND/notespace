"use strict";
// P397 synthetic Chromium/Postgres test only: encrypted Pending must survive
// an actual revoked session and an explicitly separate fresh-passkey Open.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const Module = require("node:module");
const filename = path.join(__dirname, "p387-authority-repeat-recovery.test.js");
let source = fs.readFileSync(filename, "utf8");
function replaceOnce(a,b) {
  assert.equal(source.split(a).length,2,"P397 P387 parent fixture drift: "+a.slice(0,70));
  source=source.replace(a,b);
}
function before(anchor, lines) {
  replaceOnce(anchor, lines.map(line=>"  "+JSON.stringify(line)+",").join("\n")+"\n"+anchor);
}
function substitute(anchor, lines) {
  replaceOnce(anchor, lines.map(line=>"  "+JSON.stringify(line)+",").join("\n"));
}
replaceOnce("P387 repeated completion and second authorised restart",
  "P397 real encrypted Pending two-step authorised Open after rejected old session");
before('  "  const p396Before = await p396Probe.sessionBefore({ reader: secondBrowser, origin, sql });",', [
  "  const { rows: staleRows } = await sql.query(",
  "    \"SELECT previous.record_key AS token FROM public.pocket_sync_records previous JOIN public.pocket_sync_records next ON next.collection = 'sessions' AND next.record_key = previous.record->>'replacedBy' WHERE previous.collection = 'sessions' AND previous.record->>'status' = 'revoked' AND next.record->>'status' = 'active' LIMIT 1\");",
  "  assert.equal(staleRows.length,1,'Actual revoked-and-replaced session required');",
  "  await secondBrowser.context.addCookies([{ name: POLICY.sessionCookieName,",
  "    value: staleRows[0].token, url: origin, secure: true, httpOnly: true, sameSite: 'Strict' }]);"
]);
substitute("  '  assert.equal(secondOpen.ok, true);',", [
  "  assert.equal(secondOpen.ok,false,'First Open with revoked session must fail closed');",
  "  assert.equal(secondOpen.prfTransfers,0,'No passkey when session is refused');",
  "  assert.deepEqual(p396After.requests.map(item => ({ status:item.status, reason:item.reason, cleared:item.clearedByServer })),",
  "    [{status:401,reason:'service-session-invalid',cleared:true}]);",
  "  assert.equal(p396After.before.state,'revoked-and-replaced-session');",
  "  assert.equal(p396After.cookiesAfter,0);",
  "  assert.equal(await secondBrowser.page.evaluate(() => PocketOwnerSaveBoundary.hasSyncedOwner()), false);",
  "  assert.equal(await secondBrowser.page.locator('#h1AuthStageReview').count(),0);",
  "  assert.equal(await secondBrowser.page.evaluate(() => canModifyPocket()), false);",
  "  assert.deepEqual(await sqlState(sql,activated.pocket),h2);",
  "  assert.equal(secondBrowser.responses.filter(item => item.route === ROUTES.compareAndSetShadowHead).length,0);",
  "  // Separate user action after genuine server cookie clear. No auto-retry.",
  "  const installed = await secondBrowser.cdp.send('WebAuthn.getCredentials',",
  "    {authenticatorId:secondBrowser.authenticatorId});",
  "  assert.equal(installed.credentials.length,1);",
  "  await secondBrowser.cdp.send('WebAuthn.removeCredential',",
  "    {authenticatorId:secondBrowser.authenticatorId,credentialId:installed.credentials[0].credentialId});",
  "  const fresh = await openWithSyncedFixturePasskey(secondBrowser,",
  "    { cdp: { send: async () => transferred }, authenticatorId: 'synthetic-transfer' },",
  "    { ...prf, salt:prf.salt.slice(), output:prf.output.slice() });",
  "  assert.equal(fresh.ok,true,'Second explicit passkey Open: '+fresh.reason);",
  "  assert.equal(fresh.prfTransfers,1);",
  "  assert.equal(secondBrowser.responses.filter(item => item.route === ROUTES.compareAndSetShadowHead).length,0);",
  "  console.info('P397_PENDING_TWO_OPEN='+JSON.stringify({first:'revoked-session-refused',",
  "    firstPrf:0,cleared:true,freshInitiatedSeparately:true,freshPrf:fresh.prfTransfers,",
  "    encryptedPendingExpected:1,newCas:0,fictional:true}));"
]);
const runner = new Module(filename,module);
runner.filename=filename;
runner.paths=module.paths;
runner._compile(source,filename);
