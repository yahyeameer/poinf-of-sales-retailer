/**
 * A very small Gemini client.
 *
 * Deliberately `fetch` against the REST endpoint rather than a vendor SDK. The
 * two calls this app makes are a prompt in and a string out; an SDK would add
 * a dependency, a bundle, and a second thing to keep on a supported version
 * for no behaviour we need.
 *
 * Everything here degrades rather than throws. The assistant it backs has a
 * working keyword path underneath it, so a missing key, a wrong model id, a
 * rate limit or a slow response should all end in "we could not use the
 * model", never in a 500 on a shop owner's screen.
 */

const ENDPOINT = "https://generativelanguage.googleapis.com/v1beta/models";

/** Free-tier eligible at time of writing. Override if Google moves the name. */
const DEFAULT_MODEL = "gemini-2.5-flash";

const TIMEOUT_MS = 12_000;

export function geminiConfigured(): boolean {
  return !!process.env.GEMINI_API_KEY;
}

export interface GeminiResult {
  ok: boolean;
  text: string;
  /** Set when ok is false. Logged, never shown to a shop owner verbatim. */
  reason?: string;
}

/**
 * One turn. `json` asks for a JSON object back, which the routing step needs
 * and the prose step does not.
 */
export async function askGemini(opts: {
  system: string;
  user: string;
  json?: boolean;
  maxOutputTokens?: number;
}): Promise<GeminiResult> {
  const key = process.env.GEMINI_API_KEY;
  if (!key) return { ok: false, text: "", reason: "GEMINI_API_KEY is not set" };

  const model = process.env.GEMINI_MODEL || DEFAULT_MODEL;

  // An unbounded fetch here would hold a shop owner's request open for as long
  // as the upstream felt like taking.
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

  try {
    const res = await fetch(`${ENDPOINT}/${model}:generateContent`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-goog-api-key": key },
      signal: controller.signal,
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: opts.system }] },
        contents: [{ role: "user", parts: [{ text: opts.user }] }],
        generationConfig: {
          // Low but not zero: this is retrieval-and-phrasing, not writing.
          temperature: 0.2,
          maxOutputTokens: opts.maxOutputTokens ?? 512,
          ...(opts.json ? { responseMimeType: "application/json" } : {}),
        },
      }),
    });

    if (!res.ok) {
      const body = await res.text().catch(() => "");
      // 404 here is almost always a model name Google has retired or renamed,
      // which is worth saying plainly in the log rather than leaving as "404".
      const hint =
        res.status === 404
          ? ` (model "${model}" not found — set GEMINI_MODEL to a current one)`
          : "";
      return { ok: false, text: "", reason: `HTTP ${res.status}${hint}: ${body.slice(0, 300)}` };
    }

    const data = (await res.json()) as {
      candidates?: { content?: { parts?: { text?: string }[] }; finishReason?: string }[];
    };

    const text = data.candidates?.[0]?.content?.parts?.map((p) => p.text ?? "").join("") ?? "";
    if (!text.trim()) {
      return {
        ok: false,
        text: "",
        reason: `empty response (finishReason: ${data.candidates?.[0]?.finishReason ?? "none"})`,
      };
    }

    return { ok: true, text };
  } catch (err) {
    const aborted = err instanceof Error && err.name === "AbortError";
    return {
      ok: false,
      text: "",
      reason: aborted ? `timed out after ${TIMEOUT_MS}ms` : String(err),
    };
  } finally {
    clearTimeout(timer);
  }
}

/** Parses a JSON object out of a model reply, tolerating ```json fences. */
export function parseJsonReply<T>(text: string): T | null {
  const cleaned = text.trim().replace(/^```(?:json)?/i, "").replace(/```$/, "").trim();
  try {
    return JSON.parse(cleaned) as T;
  } catch {
    // Some replies wrap the object in a sentence despite the mime type.
    const start = cleaned.indexOf("{");
    const end = cleaned.lastIndexOf("}");
    if (start === -1 || end <= start) return null;
    try {
      return JSON.parse(cleaned.slice(start, end + 1)) as T;
    } catch {
      return null;
    }
  }
}
