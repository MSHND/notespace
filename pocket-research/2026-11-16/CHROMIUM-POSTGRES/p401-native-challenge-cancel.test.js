"use strict";
// P401 disposable browser/PG negative probe. A REAL browser WebAuthn.get
// starts after a successful server challenge. We then remove the CDP virtual
// authenticator and abort the native request. This is NOT proof of a human
// pressing a native browser/OS Cancel button. Pending/H4 remain protected holds.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const Module = require("node:module");
const test = require("node:test");
const filename = path.join(__dirname, "p383-authenticated-open-save-readback.test.js");
let source = fs.readFileSync(filename, "utf8");
function replaceOnce(needle, value) {
  assert.equal(source.split(needle).length, 2, "P401 pinned P383 drift: " + needle.slice(0, 80));
  source = source.replace(needle, value);
}
replaceOnce("P383 Chromium Open, Starling Save, PostgreSQL acceptance and fresh Chromium readback",
  "P401 genuine post-challenge native WebAuthn get ABORT (not physical user Cancel)");
replaceOnce("  const b = await openBrowser(browser, origin);", [
  '  const unchangedHead = await sqlState(sql, activated.pocket);',
  '  const cancelReader = await openBrowser(browser, origin);',
  '  const saved = await a.cdp.send("WebAuthn.getCredentials",',
  '    { authenticatorId: a.authenticatorId });',
  '  assert.equal(saved.credentials.length, 1);',
  '  await cancelReader.cdp.send("WebAuthn.addCredential",',
  '    { authenticatorId: cancelReader.authenticatorId, credential: saved.credentials[0] });',
  '  await cancelReader.cdp.send("WebAuthn.setAutomaticPresenceSimulation",',
  '    { authenticatorId: cancelReader.authenticatorId, enabled: false });',
  '  let beganNative;',
  '  const nativeStarted = new Promise(resolve => { beganNative = resolve; });',
  '  await cancelReader.page.exposeFunction("__p401NativeGetStarted", () => beganNative());',
  '  await cancelReader.page.evaluate(() => {',
  '    const nativeGet = navigator.credentials.get.bind(navigator.credentials);',
  '    window.__p401NativeResolved = false;',
  '    navigator.credentials.get = function(options) {',
  '      if (!options?.publicKey) return nativeGet(options);',
  '      window.__p401Abort = new AbortController();',
  '      const result = nativeGet({ ...options, signal: window.__p401Abort.signal });',
  '      window.__p401NativeGetStarted();',
  '      return result.then(credential => {',
  '        window.__p401NativeResolved = true;',
  '        return credential;',
  '      });',
  '    };',
  '  });',
  '  const pendingOpen = cancelReader.page.evaluate(async () => {',
  '    const result = await PocketSyncActiveIntegration.openExisting();',
  '    return { ok: result.ok, adopted: result.adopted, reason: result.reason };',
  '  });',
  '  await Promise.race([nativeStarted, new Promise((_, reject) =>',
  '    setTimeout(() => reject(new Error("No actual native WebAuthn.get after server begin")), 15000))]);',
  '  const begins = cancelReader.responses.filter(x => x.route === ROUTES.beginAuthentication);',
  '  assert.ok(begins.length >= 1 && begins.some(x => x.response.status() === 200),',
  '    "Actual HTTP begin must succeed before native WebAuthn.get");',
  '  assert.equal(cancelReader.responses.filter(x => x.route === ROUTES.finishAuthentication).length, 0);',
  '  // CDP exposes no user-Cancel command: device removal plus a programmatic',
  '  // AbortSignal is a REAL native API abort but NOT human/native UI Cancel.',
  '  await cancelReader.cdp.send("WebAuthn.removeVirtualAuthenticator",',
  '    { authenticatorId: cancelReader.authenticatorId });',
  '  await cancelReader.page.evaluate(() => window.__p401Abort.abort());',
  '  const cancelled = await Promise.race([pendingOpen, new Promise((_, reject) =>',
  '    setTimeout(() => reject(new Error("Native abort did not settle Open")), 15000))]);',
  '  assert.equal(cancelled.ok, false, "Abort must not be converted into successful Open");',
  '  assert.notEqual(cancelled.adopted, true);',
  '  assert.equal(await cancelReader.page.evaluate(() => window.__p401NativeResolved), false);',
  '  assert.equal(cancelReader.responses.filter(x => x.route === ROUTES.finishAuthentication).length, 0);',
  '  assert.equal(cancelReader.responses.filter(x => x.route === ROUTES.compareAndSetShadowHead).length, 0);',
  '  assert.equal(await cancelReader.page.evaluate(() => capturePocketFileSaveSession().ownerKind), "none");',
  '  assert.equal(await cancelReader.page.evaluate(() => canModifyPocket()), false);',
  '  assert.deepEqual(await sqlState(sql, activated.pocket), unchangedHead);',
  '  console.info("P401_NATIVE_ABORT_BOUNDARY=" + JSON.stringify({',
  '    begin200: true, nativeGetActuallyStarted: true,',
  '    method: "CDP virtual device removal plus AbortController",',
  '    finishCalls: 0, adopted: false, extraCAS: 0,',
  '    userPressedNativeCancelProved: false, pendingH4Proved: false, fictional: true }));',
  '  await cancelReader.context.close();',
  '  return;',
  '  const unusedOriginalReader = await openBrowser(browser, origin);',
].join("\n"));
const runner = new Module(filename, module);
runner.filename = filename;
runner.paths = module.paths;
runner._compile(source, filename);
// A green AbortController/CDP probe MUST NOT silently promote the native
// human-Cancel requirement or Pending/H4 protection to proven.
test.todo("P401 actual browser/OS user Cancel after challenge, preserving encrypted Pending/H4");
