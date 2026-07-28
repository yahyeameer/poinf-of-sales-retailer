/**
 * Typed access to the versioned prompts, plus zod schemas for what each one is
 * supposed to return.
 *
 * The schemas are the point. An LLM that returns almost-right JSON is worse
 * than one that fails loudly, because "almost right" is how you end up with a
 * product priced at 1.5 cents. Every caller parses before it trusts.
 */
import { z } from "zod";
import { PROMPTS, type PromptDefinition, type PromptId } from "./generated.ts";

export { PROMPTS };
export type { PromptDefinition, PromptId };

export class MissingPromptVariableError extends Error {
  constructor(promptId: string, missing: string[]) {
    super(`Prompt "${promptId}" is missing variable(s): ${missing.join(", ")}`);
    this.name = "MissingPromptVariableError";
  }
}

/**
 * Renders a prompt, substituting {{VARS}}.
 *
 * Throws on a missing variable rather than leaving the literal `{{CURRENCY}}`
 * in the text — the model would carry on regardless and produce plausible
 * nonsense, which is far harder to notice than a stack trace.
 */
export function renderPrompt(
  id: PromptId,
  vars: Record<string, string | number> = {},
): string {
  const prompt = PROMPTS[id];
  if (!prompt) throw new Error(`Unknown prompt: ${id}`);

  const missing = prompt.variables.filter((v) => vars[v] === undefined || vars[v] === null);
  if (missing.length > 0) throw new MissingPromptVariableError(id, missing);

  return prompt.body.replace(/\{\{(\w+)\}\}/g, (_match, key: string) => String(vars[key]));
}

// ---------------------------------------------------------------------------
// Output schemas
// ---------------------------------------------------------------------------

export const PRODUCT_UNITS = ["each", "kg", "g", "l", "ml", "pack"] as const;

/** 3.1 — one normalised row out of a messy CSV. */
export const csvImportRowSchema = z.object({
  name: z.string().min(1).max(200),
  sku: z.string().max(64).nullable(),
  barcode: z
    .string()
    .regex(/^\d{4,20}$/, "barcode must be digits only")
    .nullable(),
  price_cents: z.number().int().nonnegative(),
  cost_cents: z.number().int().nonnegative().nullable(),
  category: z.string().max(60).nullable(),
  unit: z.enum(PRODUCT_UNITS).nullable(),
  confidence: z.number().min(0).max(1),
});

export const csvImportResponseSchema = z.array(csvImportRowSchema);

/**
 * Below this, the row goes to the owner for review instead of straight into the
 * catalog. Ambiguous prices are the main offender — see the rule about "1.5" in
 * the prompt — and a wrong price is worse than a missing product.
 */
export const CSV_AUTO_ACCEPT_CONFIDENCE = 0.8;

/** 3.2 — draft catalog fields from a product photo. */
export const photoDraftSchema = z.object({
  name: z.string().nullable(),
  brand: z.string().nullable(),
  size: z.string().nullable(),
  category_guess: z.enum([
    "beverage",
    "snack",
    "staple",
    "personal_care",
    "household",
    "other",
  ]),
  barcode_visible: z.boolean(),
  confidence: z.number().min(0).max(1),
});

/** 3.3 — the cloud tie-breaker's verdict. */
export const visionTiebreakSchema = z.object({
  best_match_id: z.string().uuid().nullable(),
  confidence: z.number().min(0).max(1),
  reasoning: z.string().max(300),
});

/** 3.5 — structured report query. The app builds the SQL; the model never does. */
export const reportQuerySchema = z.object({
  intent: z.enum([
    "top_products",
    "revenue_trend",
    "payment_mix",
    "cashier_performance",
    "dead_stock",
    "unknown",
  ]),
  time_range: z.object({
    start: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    end: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  }),
  group_by: z
    .enum(["day", "week", "month", "product", "category", "cashier"])
    .nullable(),
  metric: z.enum(["revenue", "units", "transactions", "margin"]),
  limit: z.number().int().positive().max(100).nullable(),
  chart_type: z.enum(["bar", "line", "pie", "table"]),
});

export type CsvImportRow = z.infer<typeof csvImportRowSchema>;
export type PhotoDraft = z.infer<typeof photoDraftSchema>;
export type VisionTiebreak = z.infer<typeof visionTiebreakSchema>;
export type ReportQuery = z.infer<typeof reportQuerySchema>;

/**
 * Models are told "no code fences" and mostly comply. `mostly` is why this
 * exists — one stray ```json costs a whole CSV import otherwise.
 */
export function extractJson(text: string): unknown {
  const cleaned = text
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/, "")
    .trim();

  try {
    return JSON.parse(cleaned);
  } catch {
    // Last resort: grab the outermost array or object in the response.
    const start = cleaned.search(/[[{]/);
    const end = Math.max(cleaned.lastIndexOf("]"), cleaned.lastIndexOf("}"));
    if (start !== -1 && end > start) {
      return JSON.parse(cleaned.slice(start, end + 1));
    }
    throw new Error("Model response was not JSON");
  }
}
