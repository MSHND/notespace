"use strict";
// P396-A test only: real server rejects unknown HTTP-only session, clears
// cookie, then user explicitly initiates a fresh passkey Open on SAME browser.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const Module = require("node:module");
const filename = path.join(__dirname, "p383-authenticated-open-save-readback.test.js");
let source = fs.readFileSync(filename, "utf8");
function replaceOnce(a,b) {
  assert.equal(source.split(a).length,2,"P396 fixture drift "+a.slice(0,75));
  source=source.replace(a,b);
}
replaceOnce("P383 Chromium Open, Starling Save, PostgreSQL acceptance and fresh Chromium readback",
  "P396 deliberately separate fresh passkey Open after real server cookie clearance");
replaceOnce(
  '    await reader.cdp.send("WebAuthn.addCredential", {\n      authenticatorId: reader.authenticatorId, credential: credentials[0],\n    });',
  [
    '    const already = await reader.cdp.send("WebAuthn.getCredentials", {',
    '      authenticatorId: reader.authenticatorId,',
    '    });',
    '    if (already.credentials.length === 0) {',
    '      await reader.cdp.send("WebAuthn.addCredential", {',
    '        authenticatorId: reader.authenticatorId, credential: credentials[0],',
    '      });',
    '    } else {',
    '      assert.equal(already.credentials.length, 1);',
    '      assert.equal(already.credentials[0].credentialId, credentials[0].credentialId,',
    '        "Repeated synthetic passkey import must refer to the same credential");',
    '    }',
  ].join("\n")
);
replaceOnce("  const b = await openBrowser(browser, origin);",[
"  const b = await openBrowser(browser, origin);",
"  const cookie = (await a.context.cookies(origin)).find(item => item.name === POLICY.sessionCookieName);",
"  assert.ok(cookie && cookie.httpOnly, 'Real owner session must be issued');",
"  const nonexistent = cookie.value.slice(0,-1) + (cookie.value.endsWith('A') ? 'B' : 'A');",
"  await b.context.addCookies([{ name: POLICY.sessionCookieName, value: nonexistent,",
"    url: origin, secure: true, httpOnly: true, sameSite: 'Strict' }]);",
"  const initial = await sqlState(sql, activated.pocket);",
"  const first = await openWithSyncedFixturePasskey(b, a,",
"    { ...prf, salt: prf.salt.slice(), output: prf.output.slice() });",
"  assert.equal(first.ok, false, 'Invalid cookie may not open Pocket');",
"  assert.equal(first.prfTransfers, 0, 'First refusal precedes passkey');",
"  const denied = b.responses.filter(item => item.route === ROUTES.beginAuthentication);",
"  assert.equal(denied.length, 1, 'Exactly one first attempt');",
"  assert.equal(denied[0].response.status(),401);",
"  assert.equal((await denied[0].response.json()).reason,'service-session-invalid');",
"  assert.equal((await b.context.cookies(origin)).length,0,'Server must clear stale cookie');",
"  assert.equal(await b.page.evaluate(() => capturePocketFileSaveSession().ownerKind),'none');",
"  assert.equal(b.responses.filter(item => item.route === ROUTES.compareAndSetShadowHead).length,0);",
"  assert.deepEqual(await sqlState(sql, activated.pocket),initial);",
"  // This is a SECOND explicit user-initiated Open. No app or test auto-retry.",
"  const second = await openWithSyncedFixturePasskey(b,a,",
"    { ...prf, salt: prf.salt.slice(), output: prf.output.slice() });",
"  assert.equal(second.ok,true,'Fresh passkey Open after server cookie clear: '+second.reason);",
"  assert.equal(second.prfTransfers,1);",
"  const begins = b.responses.filter(item => item.route === ROUTES.beginAuthentication);",
"  assert.equal(begins.length,3,'One denied begin plus two exact fresh-passkey bootstrap/account-bound begins');",
"  assert.equal(begins[1].response.status(),200);",
"  assert.equal(begins[2].response.status(),200);",
"  assert.equal(b.responses.filter(item => item.route === ROUTES.finishAuthentication",
"    && item.response.status() === 200).length,2,'Fresh discoverable bootstrap and bound finish');",
"  const adopted = await b.page.evaluate(() => {",
"    const session = PocketOwnerSaveBoundary.captureOwnerSaveSession();",
"    return { ownerKind: session?.ownerKind, syncedPocketId: session?.controllerSession?.syncedPocketId };",
"  });",
"  assert.equal(adopted.ownerKind,'synced');",
"  assert.equal(adopted.syncedPocketId,activated.pocket);",
"  assert.equal(b.responses.filter(item => item.route === ROUTES.compareAndSetShadowHead).length,0);",
"  assert.deepEqual(await sqlState(sql,activated.pocket),initial);",
"  assert.deepEqual((await contents(b.page)).map(item => item.id),expected.map(item=>item.id));",
"  console.info('P396_FRESH_REOPEN='+JSON.stringify({ first:'server-session-invalid',",
"    firstPasskeyTransfers:first.prfTransfers, freshInitiatedSeparately:true,",
"    secondPasskeyTransfers:second.prfTransfers, beginCalls:begins.length,",
"    sourceOwnerPreserved:true, openedSamePocket:true, newCas:0, fictional:true }));",
"  return;",
"  const unusedLegacyB = await openBrowser(browser, origin);",
].join("\n"));
const runner=new Module(filename,module);
runner.filename=filename;runner.paths=module.paths;
runner._compile(source,filename);
