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
  /**
   * Let the model think before answering. Off for routing.
   *
   * 2.5-series models reason before replying and those thought tokens are
   * charged against maxOutputTokens. A routing call given a small budget spent
   * all of it thinking and was cut off mid-sentence, so the JSON never
   * arrived and the whole model path silently fell back to keywords —
   * observed, not theorised: thoughtsTokenCount 42 against a 128 ceiling.
   * Picking one id from a list of seven does not need deliberation.
   */
  thinking?: boolean;
}): Promise<GeminiResult> {
  const key = process.env.GEMINI_API_KEY;
  if (!key) return { ok: false, text: "", reason: "GEMINI_API_KEY is not set" };

  const model = process.env.GEMINI_MODEL || DEFAULT_MODEL;

  // An unbounded fetch here would hold a shop owner's request open for as long
  // as the upstream felt like taking.
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

  const buildBody = (withThinkingConfig: boolean) =>
    JSON.stringify({
      systemInstruction: { parts: [{ text: opts.system }] },
      contents: [{ role: "user", parts: [{ text: opts.user }] }],
      generationConfig: {
        // Low but not zero: this is retrieval-and-phrasing, not writing.
        temperature: 0.2,
        maxOutputTokens: opts.maxOutputTokens ?? 512,
        ...(opts.json ? { responseMimeType: "application/json" } : {}),
        ...(withThinkingConfig && opts.thinking === false
          ? { thinkingConfig: { thinkingBudget: 0 } }
          : {}),
      },
    });

  const send = (withThinkingConfig: boolean) =>
    fetch(`${ENDPOINT}/${model}:generateContent`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-goog-api-key": key },
      signal: controller.signal,
      body: buildBody(withThinkingConfig),
    });

  try {
    let res = await send(true);

    // thinkingConfig is a 2.5-series field. A model that predates it rejects
    // the request outright, which would take the whole model path down over a
    // tuning flag — so drop it and ask again rather than fail.
    if (res.status === 400 && opts.thinking === false) {
      const peek = await res.clone().text().catch(() => "");
      if (/thinking/i.test(peek)) res = await send(false);
    }

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
    const finish = data.candidates?.[0]?.finishReason;
    if (!text.trim()) {
      return {
        ok: false,
        text: "",
        reason:
          finish === "MAX_TOKENS"
            ? "ran out of output tokens before answering (raise maxOutputTokens, or pass thinking:false)"
            : `empty response (finishReason: ${finish ?? "none"})`,
      };
    }

    // Truncated mid-answer. This guard originally covered JSON only, on the
    // reasoning that a cut-off object will not parse anyway — but prose has
    // the worse failure: it *does* parse, so a sentence ending "and Cooking
    // Oil" would have gone straight to a shop owner as though it were the
    // whole answer. Falling back to the keyword path is better than half a
    // reply, in both modes.
    if (finish === "MAX_TOKENS") {
      return {
        ok: false,
        text: "",
        reason: `reply was truncated (MAX_TOKENS${opts.thinking === false ? "" : ", thinking was on"})`,
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
