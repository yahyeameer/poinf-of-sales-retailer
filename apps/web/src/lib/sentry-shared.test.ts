import assert from "node:assert/strict";
import { test } from "node:test";

import { beforeSend } from "./sentry-shared.ts";

/**
 * beforeSend is the last gate before a crash report leaves the building, and
 * it is the only thing standing between Sentry and a staff PIN. That makes it
 * worth a test that fails loudly rather than a comment claiming it works.
 *
 * The event below is deliberately hostile: a PIN in a query string, a PIN in a
 * request body, a PIN nested two levels inside `extra`, an auth token in a
 * header, the till cashier cookie, an API key inside an array, and a fetch
 * breadcrumb carrying the query string again. Every one of these is something
 * a real event could plausibly pick up.
 */
function hostileEvent() {
  return {
    request: {
      url: "https://shop.example/till?pin=4817&cashier=amina",
      query_string: "pin=4817",
      cookies: {
        aipos_till_cashier: "22222222-2222-2222-2222-222222222222",
        "sb-access-token": "ey.J",
      },
      data: { pin: "4817", total_cents: 1200 },
      headers: { Authorization: "Bearer ey.J", "Content-Type": "application/json" },
    },
    extra: { staff: { name: "Amina", pin: "4817" }, nested: [{ apiKey: "sk-live-x" }] },
    contexts: { app: { app_name: "ai-pos" } },
    breadcrumbs: [
      { category: "fetch", data: { url: "https://shop.example/api/x?pin=4817", status_code: 200 } },
      { category: "ui.click", data: undefined },
    ],
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any;
}

test("beforeSend drops the whole request body and cookie jar", () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const out = beforeSend(hostileEvent(), {} as any) as any;
  assert.equal(out.request.cookies, undefined);
  assert.equal(out.request.data, undefined);
});

test("beforeSend redacts query strings but keeps the path", () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const out = beforeSend(hostileEvent(), {} as any) as any;
  // The path is what says *which screen broke*, so it has to survive.
  assert.equal(out.request.url, "https://shop.example/till?[redacted]");
  assert.equal(out.request.query_string, "[redacted]");
  assert.equal(out.breadcrumbs[0].data.url, "https://shop.example/api/x?[redacted]");
  assert.equal(out.breadcrumbs[0].data.status_code, 200);
});

test("beforeSend redacts by key at depth and through arrays, keeping the rest", () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const out = beforeSend(hostileEvent(), {} as any) as any;
  assert.equal(out.extra.staff.pin, "[redacted]");
  assert.equal(out.extra.nested[0].apiKey, "[redacted]");
  assert.equal(out.request.headers.Authorization, "[redacted]");

  // Redaction that takes the diagnostic value with it is not a win.
  assert.equal(out.extra.staff.name, "Amina");
  assert.equal(out.request.headers["Content-Type"], "application/json");
  assert.equal(out.contexts.app.app_name, "ai-pos");
});

test("no secret survives anywhere in the serialised event", () => {
  // The check that actually matters: not "did each rule fire" but "is the
  // string gone", wherever it ended up.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const blob = JSON.stringify(beforeSend(hostileEvent(), {} as any));
  for (const secret of ["4817", "ey.J", "sk-live-x", "22222222"]) {
    assert.ok(!blob.includes(secret), `"${secret}" leaked into the event`);
  }
});

test("beforeSend handles a bare event without throwing", () => {
  // Sentry sends plenty of events with no request, extra or breadcrumbs at all.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const out = beforeSend({ message: "boom" } as any, {} as any) as any;
  assert.equal(out.message, "boom");
});
