import assert from "node:assert/strict";
import { afterEach, test } from "node:test";

import { askGemini, geminiConfigured, parseJsonReply } from "./ai/gemini.ts";

/**
 * The assistant has a working keyword path underneath it, so the whole value
 * of this client is that it *degrades* — a missing key, a retired model name,
 * a rate limit or a slow reply must all end in "could not use the model" and
 * let the caller fall back. A throw here would put a 500 on a shop owner's
 * screen instead of the answer they used to get.
 *
 * These tests stub fetch rather than call Google: the point is the handling,
 * and a test that needs a live API key is a test nobody runs.
 */

const realFetch = globalThis.fetch;
const realKey = process.env.GEMINI_API_KEY;
const realModel = process.env.GEMINI_MODEL;

afterEach(() => {
  globalThis.fetch = realFetch;
  if (realKey === undefined) delete process.env.GEMINI_API_KEY;
  else process.env.GEMINI_API_KEY = realKey;
  if (realModel === undefined) delete process.env.GEMINI_MODEL;
  else process.env.GEMINI_MODEL = realModel;
});

function stubFetch(handler: (url: string, init: RequestInit) => Response | Promise<Response>) {
  globalThis.fetch = ((url: string, init: RequestInit) =>
    Promise.resolve(handler(String(url), init))) as unknown as typeof fetch;
}

function reply(text: string) {
  return new Response(
    JSON.stringify({ candidates: [{ content: { parts: [{ text }] }, finishReason: "STOP" }] }),
    { status: 200, headers: { "Content-Type": "application/json" } },
  );
}

test("no key is a soft failure, not a throw", async () => {
  delete process.env.GEMINI_API_KEY;
  assert.equal(geminiConfigured(), false);
  const r = await askGemini({ system: "s", user: "u" });
  assert.equal(r.ok, false);
  assert.match(r.reason ?? "", /GEMINI_API_KEY/);
});

test("a normal reply comes back as text", async () => {
  process.env.GEMINI_API_KEY = "test-key";
  stubFetch(() => reply("Rice is your best seller at $412.00."));
  const r = await askGemini({ system: "s", user: "u" });
  assert.equal(r.ok, true);
  assert.equal(r.text, "Rice is your best seller at $412.00.");
});

test("multi-part replies are joined rather than truncated", async () => {
  process.env.GEMINI_API_KEY = "test-key";
  globalThis.fetch = (() =>
    Promise.resolve(
      new Response(
        JSON.stringify({
          candidates: [{ content: { parts: [{ text: "one " }, { text: "two" }] } }],
        }),
        { status: 200 },
      ),
    )) as unknown as typeof fetch;
  const r = await askGemini({ system: "s", user: "u" });
  assert.equal(r.text, "one two");
});

test("the key travels in a header, never in the URL", async () => {
  // A key in a query string ends up in logs, proxies and error reports.
  process.env.GEMINI_API_KEY = "secret-key-value";
  let seenUrl = "";
  let seenHeader = "";
  stubFetch((url, init) => {
    seenUrl = url;
    seenHeader = String((init.headers as Record<string, string>)["x-goog-api-key"] ?? "");
    return reply("ok");
  });
  await askGemini({ system: "s", user: "u" });
  assert.ok(!seenUrl.includes("secret-key-value"), "key must not be in the URL");
  assert.equal(seenHeader, "secret-key-value");
});

test("a retired model name says so instead of just 404", async () => {
  process.env.GEMINI_API_KEY = "test-key";
  process.env.GEMINI_MODEL = "gemini-from-2019";
  stubFetch(() => new Response("No such model", { status: 404 }));
  const r = await askGemini({ system: "s", user: "u" });
  assert.equal(r.ok, false);
  assert.match(r.reason ?? "", /gemini-from-2019/);
  assert.match(r.reason ?? "", /GEMINI_MODEL/);
});

test("a rate limit is a soft failure", async () => {
  process.env.GEMINI_API_KEY = "test-key";
  stubFetch(() => new Response("quota exceeded", { status: 429 }));
  const r = await askGemini({ system: "s", user: "u" });
  assert.equal(r.ok, false);
  assert.match(r.reason ?? "", /429/);
});

test("a response with no usable text is a failure, not an empty answer", async () => {
  // Otherwise the assistant renders a confident blank.
  process.env.GEMINI_API_KEY = "test-key";
  stubFetch(
    () =>
      new Response(JSON.stringify({ candidates: [{ content: { parts: [] }, finishReason: "SAFETY" }] }), {
        status: 200,
      }),
  );
  const r = await askGemini({ system: "s", user: "u" });
  assert.equal(r.ok, false);
  assert.match(r.reason ?? "", /SAFETY/);
});

test("a network error is caught", async () => {
  process.env.GEMINI_API_KEY = "test-key";
  globalThis.fetch = (() => Promise.reject(new Error("ECONNRESET"))) as unknown as typeof fetch;
  const r = await askGemini({ system: "s", user: "u" });
  assert.equal(r.ok, false);
  assert.match(r.reason ?? "", /ECONNRESET/);
});

test("json mode is requested only when asked for", async () => {
  process.env.GEMINI_API_KEY = "test-key";
  let body: Record<string, unknown> = {};
  stubFetch((_u, init) => {
    body = JSON.parse(String(init.body));
    return reply("{}");
  });

  await askGemini({ system: "s", user: "u", json: true });
  assert.equal(
    (body.generationConfig as Record<string, unknown>).responseMimeType,
    "application/json",
  );

  await askGemini({ system: "s", user: "u" });
  assert.equal((body.generationConfig as Record<string, unknown>).responseMimeType, undefined);
});

// --- parseJsonReply --------------------------------------------------------
//
// Models wrap JSON in fences and prose even when asked not to, and a router
// that returns null on a fenced reply silently drops the model path.

test("parses plain JSON", () => {
  assert.deepEqual(parseJsonReply<{ lookups: string[] }>('{"lookups":["low_stock"]}'), {
    lookups: ["low_stock"],
  });
});

test("parses fenced JSON", () => {
  assert.deepEqual(
    parseJsonReply<{ lookups: string[] }>('```json\n{"lookups":["profit"]}\n```'),
    { lookups: ["profit"] },
  );
});

test("parses JSON buried in a sentence", () => {
  assert.deepEqual(
    parseJsonReply<{ lookups: string[] }>('Sure! {"lookups":["dead_stock"]} — hope that helps.'),
    { lookups: ["dead_stock"] },
  );
});

test("returns null on genuine rubbish rather than throwing", () => {
  assert.equal(parseJsonReply("no json here at all"), null);
  assert.equal(parseJsonReply("{ not: valid, json"), null);
});
