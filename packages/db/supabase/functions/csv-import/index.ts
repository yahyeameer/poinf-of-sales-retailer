/**
 * POST /functions/v1/csv-import
 *
 * Owner uploads whatever spreadsheet they've been keeping. Columns are in a
 * random order, prices are written "N1,500", and categories are spelled three
 * ways. Prompt 3.1 normalises it.
 *
 * Nothing is written to the catalog here. It returns rows for the owner to
 * confirm, split by confidence — an LLM that misreads "1.5" as 150 instead of
 * 1500 should cost a click, not a month of wrong prices.
 *
 * Body: { rows: object[], currency: string }
 */
import Anthropic from "npm:@anthropic-ai/sdk@0.68.0";

import { tenantFromToken } from "../_shared/clients.ts";
import { corsHeaders, json, requireAuthedPost } from "../_shared/http.ts";
import { PROMPTS } from "../_shared/prompts.generated.ts";

const MAX_ROWS = 2000;
const CHUNK = 100; // keeps each request well inside the output token budget
const AUTO_ACCEPT_CONFIDENCE = 0.8;

interface NormalizedRow {
  name: string;
  sku: string | null;
  barcode: string | null;
  price_cents: number;
  cost_cents: number | null;
  category: string | null;
  unit: string | null;
  confidence: number;
}

function render(id: keyof typeof PROMPTS, vars: Record<string, string>): string {
  return PROMPTS[id].body.replace(/\{\{(\w+)\}\}/g, (_m, key: string) => vars[key] ?? "");
}

function extractJson(text: string): unknown {
  const cleaned = text.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "").trim();
  try {
    return JSON.parse(cleaned);
  } catch {
    const start = cleaned.search(/[[{]/);
    const end = Math.max(cleaned.lastIndexOf("]"), cleaned.lastIndexOf("}"));
    if (start !== -1 && end > start) return JSON.parse(cleaned.slice(start, end + 1));
    throw new Error("Model response was not JSON");
  }
}

/** Cheap structural guard. The owner confirms the rest by eye. */
function isPlausible(row: unknown): row is NormalizedRow {
  const r = row as NormalizedRow;
  return (
    !!r &&
    typeof r.name === "string" &&
    r.name.trim().length > 0 &&
    Number.isInteger(r.price_cents) &&
    r.price_cents >= 0 &&
    typeof r.confidence === "number"
  );
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const auth = requireAuthedPost(req);
  if (auth instanceof Response) return auth;
  if (!tenantFromToken(auth.token)) return json({ error: "No shop on this session" }, 401);

  const apiKey = Deno.env.get("ANTHROPIC_API_KEY");
  if (!apiKey) return json({ error: "ANTHROPIC_API_KEY is not configured" }, 500);

  let body: { rows?: unknown[]; currency?: string };
  try {
    body = await req.json();
  } catch {
    return json({ error: "Body must be JSON" }, 400);
  }

  const rows = body.rows ?? [];
  const currency = body.currency ?? "USD";

  if (!Array.isArray(rows) || rows.length === 0) return json({ error: "No rows to import" }, 400);
  if (rows.length > MAX_ROWS) {
    return json({ error: `That file has ${rows.length} rows; the limit is ${MAX_ROWS}` }, 413);
  }

  const anthropic = new Anthropic({ apiKey });
  const system = render("csv-import-normalizer", { CURRENCY: currency });

  const accepted: NormalizedRow[] = [];
  const needsReview: NormalizedRow[] = [];
  const failedChunks: number[] = [];

  for (let i = 0; i < rows.length; i += CHUNK) {
    const chunk = rows.slice(i, i + CHUNK);

    try {
      const message = await anthropic.messages.create({
        model: Deno.env.get("ANTHROPIC_MODEL") ?? "claude-sonnet-5",
        max_tokens: 8000,
        system,
        messages: [{ role: "user", content: JSON.stringify(chunk) }],
      });

      const text = message.content
        .filter((block): block is { type: "text"; text: string } => block.type === "text")
        .map((block) => block.text)
        .join("");

      const parsed = extractJson(text);
      if (!Array.isArray(parsed)) throw new Error("Expected a JSON array");

      for (const row of parsed) {
        if (!isPlausible(row)) continue;
        (row.confidence >= AUTO_ACCEPT_CONFIDENCE ? accepted : needsReview).push(row);
      }
    } catch (err) {
      // One bad chunk shouldn't lose the other nineteen. Report which rows to retry.
      console.error("csv-import chunk failed", { offset: i, error: String(err) });
      failedChunks.push(i);
    }
  }

  return json({
    currency,
    submitted: rows.length,
    accepted,
    needs_review: needsReview,
    failed_row_offsets: failedChunks,
    // The client writes to `products` itself, through RLS, once the owner
    // confirms. This function never touches the catalog.
    next_step: "confirm_and_insert",
  });
});
