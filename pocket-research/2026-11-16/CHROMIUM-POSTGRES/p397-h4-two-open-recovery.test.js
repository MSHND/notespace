"use strict";
// P397 fictional Chromium/PostgreSQL test only: prior native H3 accepted
// without browser ACK and superseded H4 must survive a revoked-cookie
// refusal and separately initiated fresh passkey Open/receipt reconcile.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const Module = require("node:module");
const filename = path.join(__dirname,"p390-superseded-lineage.test.js");
let source = fs.readFileSync(filename,"utf8");
function replaceOnce(a,b) {
  assert.equal(source.split(a).length,2,"P397 P390 parent fixture drift: "+a.slice(0,70));
  source=source.replace(a,b);
}
function before(anchor, lines) {
  replaceOnce(anchor, lines.map(line=>"  "+JSON.stringify(line)+",").join("\n")+"\n"+anchor);
}
function substitute(anchor, lines) {
  replaceOnce(anchor, lines.map(line=>"  "+JSON.stringify(line)+",").join("\n"));
}
replaceOnce("P390 true native H4 cryptographic lineage automatic authorised Open",
  "P397 real H4 superseded receipt after revoked session and separate fresh Open");
before('  "  const p396Before = await p396Probe.sessionBefore({ reader: reopenedBrowser, origin, sql });",', [
  "  const { rows: staleRows } = await sql.query(",
  "    \"SELECT previous.record_key AS token FROM public.pocket_sync_records previous JOIN public.pocket_sync_records next ON next.collection = 'sessions' AND next.record_key = previous.record->>'replacedBy' WHERE previous.collection = 'sessions' AND previous.record->>'status' = 'revoked' AND next.record->>'status' = 'active' LIMIT 1\");",
  "  assert.equal(staleRows.length,1,'Actual revoked-and-replaced session required');",
  "  await reopenedBrowser.context.addCookies([{name:POLICY.sessionCookieName,",
  "    value:staleRows[0].token,url:origin,secure:true,httpOnly:true,sameSite:'Strict'}]);"
]);
substitute("  '  assert.equal(signed.ok, true, \"Reopened after H4: \"+signed.reason);',", [
  "  assert.equal(signed.ok,false,'Revoked prior session cannot Open');",
  "  assert.equal(signed.prfTransfers,0,'No passkey use on first refused Open');",
  "  assert.equal(p396After.before.state,'revoked-and-replaced-session');",
  "  assert.deepEqual(p396After.requests.map(item => ({status:item.status, reason:item.reason, cleared:item.clearedByServer})),",
  "    [{status:401,reason:'service-session-invalid',cleared:true}]);",
  "  assert.equal(p396After.cookiesAfter,0);",
  "  assert.equal(await reopenedBrowser.page.evaluate(() => PocketOwnerSaveBoundary.hasSyncedOwner()),false);",
  "  assert.equal(await reopenedBrowser.page.locator('#h1AuthStageStatus').count(),0);",
  "  assert.equal(await reopenedBrowser.page.evaluate(() => canModifyPocket()),false);",
  "  assert.deepEqual(await sqlState(sql,activated.pocket),h4);",
  "  assert.equal(reopenedBrowser.responses.filter(item=>item.route===ROUTES.compareAndSetShadowHead).length,0);",
  "  // Second Open is a distinct explicit user action, not a silent retry.",
  "  const imported = await reopenedBrowser.cdp.send('WebAuthn.getCredentials',",
  "    {authenticatorId:reopenedBrowser.authenticatorId});",
  "  assert.equal(imported.credentials.length,1);",
  "  await reopenedBrowser.cdp.send('WebAuthn.removeCredential',",
  "    {authenticatorId:reopenedBrowser.authenticatorId,credentialId:imported.credentials[0].credentialId});",
  "  const fresh = await openWithSyncedFixturePasskey(reopenedBrowser,",
  "    {cdp:{send:async()=>currentTransferCredentials},authenticatorId:'synthetic-transfer'},",
  "    { ...prf, salt:prf.salt.slice(), output:prf.output.slice() });",
  "  assert.equal(fresh.ok,true,'Explicit fresh passkey Open after server clear: '+fresh.reason);",
  "  assert.equal(fresh.prfTransfers,1);",
  "  assert.equal(reopenedBrowser.responses.filter(item=>item.route===ROUTES.compareAndSetShadowHead).length,0);",
  "  console.info('P397_H4_TWO_OPEN='+JSON.stringify({first:'revoked-session-refused',",
  "    firstPrf:0,cleared:true,freshInitiatedSeparately:true,freshPrf:fresh.prfTransfers,",
  "    expectedReceipt:true,acceptedH3:true,supersededH4:true,newCas:0,fictional:true}));"
]);
const runner = new Module(filename,module);
runner.filename=filename;
runner.paths=module.paths;
runner._compile(source,filename);
