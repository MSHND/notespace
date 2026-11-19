"use strict";
// P398-A FICTIONAL RESEARCH ONLY: Real Chromium/PG revoked-session then denied second authentication then separate successful lawful Open; original Pending/H4 assertions preserved.
// Do not make product/server auth changes or weaken original assertions.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const Module = require("node:module");
const filename = path.join(__dirname, "p397-pending-two-open-recovery.test.js");
let source = fs.readFileSync(filename,"utf8");
const anchor = "  \"  const fresh = await openWithSyncedFixturePasskey(secondBrowser,\",";
assert.equal(source.split(anchor).length,2,"P398 parent fixture drift; do not mask");
const injected = ["  // Explicit, separate denied second Open before a separately user-requested successful Open.","  const denialRoute = '**' + ROUTES.beginAuthentication;","  await secondBrowser.page.route(denialRoute, route => route.fulfill({status:403,contentType:'application/json',body:JSON.stringify({ok:false,reason:'not-authorised'})}));","  const deniedSecond = await openWithSyncedFixturePasskey(secondBrowser,","    {cdp:{send:async()=>transferred},authenticatorId:'synthetic-transfer'},","    {...prf,salt:prf.salt.slice(),output:prf.output.slice()});","  await secondBrowser.page.unroute(denialRoute);","  assert.equal(deniedSecond.ok,false,'Denied passkey Open must fail closed');","  assert.equal(deniedSecond.prfTransfers,0,'Denied authentication must never reach passkey PRF');","  assert.equal(await secondBrowser.page.evaluate(() => PocketOwnerSaveBoundary.hasSyncedOwner()),false);","  assert.equal(await secondBrowser.page.evaluate(() => canModifyPocket()),false);","  assert.equal(await secondBrowser.page.locator('#h1AuthStageReview').count(),0);","  assert.equal(secondBrowser.responses.filter(item => item.route === ROUTES.compareAndSetShadowHead).length,0);","  assert.deepEqual(await sqlState(sql,activated.pocket),h2);","  const deniedAuthenticator = await secondBrowser.cdp.send('WebAuthn.getCredentials',{authenticatorId:secondBrowser.authenticatorId});","  assert.equal(deniedAuthenticator.credentials.length,1);","  await secondBrowser.cdp.send('WebAuthn.removeCredential',{authenticatorId:secondBrowser.authenticatorId,credentialId:deniedAuthenticator.credentials[0].credentialId});","  console.info('P398_PENDING_DENIED_SECOND='+JSON.stringify({denied:true,noPasskey:true,noOwner:true,noNewCas:true,fictional:true}));"].map(line => "  " + JSON.stringify(line) + ",").join("\n");
source = source.replace(anchor,injected + "\n" + anchor);
const runner = new Module(filename,module);
runner.filename=filename;runner.paths=module.paths;
runner._compile(source,filename);
