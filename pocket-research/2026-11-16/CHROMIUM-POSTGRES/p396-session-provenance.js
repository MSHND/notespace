"use strict";
// P396-A disposable research probe. Never log, return or retain session IDs,
// cookie values, account identifiers, credentials or content.
const assert = require("node:assert/strict");
const { POLICY, ROUTES } = require("../../../sync-service/pocket-sync-http-adapter.js");

async function sessionBefore({ reader, origin, sql }) {
  const cookies = (await reader.context.cookies(origin))
    .filter(item => item.name === POLICY.sessionCookieName);
  assert.ok(cookies.length <= 1, "At most one research session cookie");
  let state = "absent";
  if (cookies.length === 1) {
    const value = cookies[0].value;
    const { rows } = await sql.query(
      "SELECT record->>'status' AS status, record->>'expiresAt' AS expires_at FROM public.pocket_sync_records WHERE collection = 'sessions' AND record_key = $1",
      [value]
    );
    if (rows.length !== 1) state = "unknown-session";
    else if (rows[0].status !== "active") state = "inactive-session";
    else if (!Number.isFinite(Date.parse(rows[0].expires_at))
        || Date.parse(rows[0].expires_at) <= Date.now()) state = "expired-session";
    else state = "active-unexpired-session";
  }
  return Object.freeze({ cookieCount: cookies.length, state, profile: "persistent-browser" });
}
async function authenticationBeginAfter({ reader, origin, before }) {
  const auth = reader.responses.filter(item => item.route === ROUTES.beginAuthentication);
  const records = [];
  for (const { response } of auth) {
    const requestBody = response.request().postDataJSON();
    let reason = null;
    if (response.status() >= 400) {
      try {
        const json = await response.json();
        if (json?.ok === false && typeof json.reason === "string" && /^[a-z0-9-]{1,80}$/.test(json.reason)) {
          reason = json.reason;
        }
      } catch (_ignored) {}
    }
    const header = await response.headerValue("set-cookie").catch(() => null);
    // Never print the header: even a positive Set-Cookie contains a secret.
    const cookieCleared = typeof header === "string"
      && header.startsWith(POLICY.sessionCookieName + "=")
      && header.includes("Max-Age=0");
    records.push({
      status: response.status(),
      reason,
      clearedByServer: cookieCleared,
      selection: requestBody?.accountSelection === "choose-another" ? "choose-another"
        : requestBody?.accountLocator ? "account-locator" : "unspecified",
    });
  }
  const afterCount = (await reader.context.cookies(origin))
    .filter(item => item.name === POLICY.sessionCookieName).length;
  return Object.freeze({ before, requests: records, cookiesAfter: afterCount });
}
module.exports = Object.freeze({ sessionBefore, authenticationBeginAfter });
