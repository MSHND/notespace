"use strict";
// P395-A: real Chromium + disposable PostgreSQL, server-shaped 401 injection.
// No auto-retry, account switch, private content exposure or Head CAS.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const Module = require("node:module");
const filename = path.join(__dirname, "p383-authenticated-open-save-readback.test.js");
let source = fs.readFileSync(filename, "utf8");
function replaceOnce(a, b) {
  assert.equal(source.split(a).length, 2, "P395 fixture drift: " + a.slice(0, 75));
  source = source.replace(a, b);
}
replaceOnce("P383 Chromium Open, Starling Save, PostgreSQL acceptance and fresh Chromium readback",
  "P395 pre-passkey expired/invalid session must fail closed with truthful guidance");
replaceOnce("return { ok: result.ok, reason: result.reason, prfTransfers };",
  "return { ok: result.ok, reason: result.reason, adopted: result.adopted, sourceOwnerPreserved: result.sourceOwnerPreserved, failureCode: result.failureCode, prfTransfers };");
replaceOnce("  const b = await openBrowser(browser, origin);", [
  "  for (const reason of ['service-session-invalid', 'service-session-expired',",
  "    'service-authentication-required', 'service-authorisation-failed']) {",
  "    const b = await openBrowser(browser, origin);",
  "    const validCookie = (await a.context.cookies(origin)).find(cookie => cookie.name === POLICY.sessionCookieName);",
  "    assert.ok(validCookie && validCookie.httpOnly, 'Real authenticated writer session');",
  "    const unknownSession = validCookie.value.slice(0, -1)",
  "      + (validCookie.value.endsWith('A') ? 'B' : 'A');",
  "    await b.context.addCookies([{ name: POLICY.sessionCookieName,",
  "      value: reason === 'service-session-invalid' ? unknownSession : 'fictional-stale-session',",
  "      url: origin, secure: true, httpOnly: true, sameSite: 'Strict' }]);",
  "    assert.equal((await b.context.cookies(origin)).length, 1);",
  "    let beginCalls = 0;",
  "    b.page.on('request', request => {",
  "      if (new URL(request.url()).pathname === SERVICE_ROOT + ROUTES.beginAuthentication) beginCalls += 1;",
  "    });",
  "    if (reason !== 'service-session-invalid') {",
  "      await b.page.route('**/pocket-sync/v1/account/passkeys/authentication/begin', async route => {",
  "        await route.fulfill({ status: reason === 'service-authorisation-failed' ? 403 : 401,",
  "          contentType: 'application/json',",
  "          headers: { 'set-cookie': POLICY.sessionCookieName + '=; Path=/; Secure; HttpOnly; SameSite=Strict; Max-Age=0' },",
  "          body: JSON.stringify({ apiVersion: 1, ok: false, reason }) });",
  "      });",
  "    }",
  "    const result = await openWithSyncedFixturePasskey(b, a,",
  "      { ...prf, salt: prf.salt.slice(), output: prf.output.slice() });",
  "    assert.equal(result.ok, false);",
  "    assert.equal(result.adopted, false);",
  "    assert.equal(result.sourceOwnerPreserved, true);",
  "    assert.equal(result.prfTransfers, 0);",
  "    assert.equal(result.failureCode, ['service-session-invalid', 'service-session-expired'].includes(reason)",
  "      ? 'account-fresh-passkey-required' : 'account-service-failed');",
  "    assert.equal(beginCalls, 1, 'No automatic authentication retry');",
  "    if (reason === 'service-session-invalid') {",
  "      const rejected = b.responses.find(({route}) => route === ROUTES.beginAuthentication);",
  "      assert.equal(rejected.response.status(), 401, 'Real service rejects unknown session');",
  "      assert.equal((await rejected.response.json()).reason, 'service-session-invalid');",
  "      assert.equal((await b.context.cookies(origin)).length, 0, 'Real server clears invalid cookie');",
  "    }",
  "    assert.equal(b.responses.filter(({ route }) => route === ROUTES.finishAuthentication).length, 0);",
  "    assert.equal(b.responses.filter(({ route }) => route === ROUTES.compareAndSetShadowHead).length, 0);",
  "    assert.equal(await b.page.evaluate(() => capturePocketFileSaveSession().ownerKind), 'none');",
  "    assert.equal(await b.page.evaluate(() => canModifyPocket()), false);",
  "    assert.deepEqual(await sqlState(sql, activated.pocket), h3);",
  "    console.info('P395_STALE_SESSION=' + JSON.stringify({ reason, failureCode: result.failureCode,",
  "      prePasskey: true, beginCalls, extraCas: 0, sourceOwnerPreserved: true }));",
  "    await b.context.close();",
  "  }",
  "  return;",
  "  const b = await openBrowser(browser, origin);",
].join("\n"));
const runner = new Module(filename, module);
runner.filename = filename;
runner.paths = module.paths;
runner._compile(source, filename);
