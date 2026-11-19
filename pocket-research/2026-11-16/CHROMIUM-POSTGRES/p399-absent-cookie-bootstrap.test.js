"use strict";
// P399-A actual fresh browser/no HTTP-only cookie, discoverable bootstrap and native passkey.
// Separate Chromium context, not a client-side clearing of a revoked cookie.
// A lawful independent remote readback is NOT proof of transfer of an owner's encrypted local staged ledger.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const Module = require("node:module");
const filename = path.join(__dirname,"p383-authenticated-open-save-readback.test.js");
let source=fs.readFileSync(filename,"utf8");
function replaceOnce(a,b){assert.equal(source.split(a).length,2,"P399 fixture drift: "+a);source=source.replace(a,b);}
replaceOnce("P383 Chromium Open, Starling Save, PostgreSQL acceptance and fresh Chromium readback",
 "P399 absent-cookie real fresh passkey bootstrap and same Pocket readback");
replaceOnce('  const b = await openBrowser(browser, origin);', [
  '  const b = await openBrowser(browser, origin);',
  "  const p396Probe=require('./p396-session-provenance.js');",
  "  const p399Before=await p396Probe.sessionBefore({reader:b,origin,sql});",
  "  assert.deepEqual({state:p399Before.state,cookieCount:p399Before.cookieCount},",
  "    {state:'absent',cookieCount:0},'Actually separate new Chromium profile, no cookie clearing');",
  "  assert.equal(await b.page.evaluate(()=>PocketOwnerSaveBoundary.hasSyncedOwner()),false);",
  "  assert.equal(b.responses.filter(x=>x.route===ROUTES.compareAndSetShadowHead).length,0);",
].join("\n"));
replaceOnce('  assert.ok(successful(b.responses, ROUTES.finishAuthentication));', [
  '  assert.ok(successful(b.responses, ROUTES.finishAuthentication));',
  "  const p399Auth=await p396Probe.authenticationBeginAfter({reader:b,origin,before:p399Before});",
  "  assert.equal(p399Auth.requests.length,2,'Fresh discoverable and bound begin');",
  "  assert.deepEqual(p399Auth.requests.map(x=>x.status),[200,200]);",
  "  assert.equal(p399Auth.requests.some(x=>x.clearedByServer),false);",
  "  assert.equal(reopened.prfTransfers,1,'Native passkey ceremony and bounded PRF transfer');",
  "  assert.equal(b.responses.filter(x=>x.route===ROUTES.finishAuthentication && x.response.status()===200).length,2);",
  "  assert.equal(p399Auth.cookiesAfter,1,'New real server session issued');",
  "  console.info('P399_ABSENT_FRESH='+JSON.stringify({before:'absent',freshBegin:2,",
  "    finish200:2,nativePrf:reopened.prfTransfers,afterCookie:1,newCAS:0,fictional:true}));",
].join("\n"));
const runner=new Module(filename,module);runner.filename=filename;runner.paths=module.paths;runner._compile(source,filename);
