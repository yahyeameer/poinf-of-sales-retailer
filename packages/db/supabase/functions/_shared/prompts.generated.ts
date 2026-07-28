// GENERATED FILE — DO NOT EDIT.
// Source: packages/prompts/prompts/*.md
// Regenerate: npm run build -w @ai-pos/prompts

export type PromptId =
  | "csv-import-normalizer"
  | "photo-to-catalog-draft"
  | "report-nl-query"
  | "vision-match-tiebreak"
  | "weekly-owner-insight";

export interface PromptDefinition {
  readonly id: PromptId;
  readonly version: number;
  readonly description: string;
  readonly variables: readonly string[];
  readonly body: string;
}

export const PROMPTS: Record<PromptId, PromptDefinition> = {
  "csv-import-normalizer": {
    id: "csv-import-normalizer",
    version: 1,
    description: "Normalises a messy retail inventory CSV into catalog rows.",
    variables: ["CURRENCY"],
    body: "You normalize retail product inventory rows for a POS database.\n\nINPUT: A JSON array of raw CSV rows with arbitrary column names.\n\nOUTPUT: A JSON array with this exact schema, one object per input row:\n{\n  \"name\": string,            // clean product name, title case\n  \"sku\": string | null,      // preserve if present, else null\n  \"barcode\": string | null,  // digits only, else null\n  \"price_cents\": integer,    // selling price in minor currency units\n  \"cost_cents\": integer | null,\n  \"category\": string | null, // singular, lowercase (e.g. \"beverage\")\n  \"unit\": string | null,     // \"each\" | \"kg\" | \"g\" | \"l\" | \"ml\" | \"pack\"\n  \"confidence\": number       // 0.0 to 1.0, your confidence this row is clean\n}\n\nRULES:\n- Strip currency symbols and thousands separators before parsing prices.\n- If price is ambiguous (e.g. \"1.5\" — is that 1.50 or 1500?), use context from other rows and lower confidence.\n- Never invent barcodes. Never invent SKUs.\n- If a row is clearly not a product (header, blank, total row), omit it entirely.\n- Currency is {{CURRENCY}}. Assume prices are in this currency unless a symbol says otherwise.\n\nReturn ONLY the JSON array. No prose, no code fences.",
  },
  "photo-to-catalog-draft": {
    id: "photo-to-catalog-draft",
    version: 1,
    description: "Extracts catalog metadata from a photo of a product, to prefill the new-product form.",
    variables: [],
    body: "You extract retail catalog metadata from a product photo.\n\nLook at the image and return this JSON:\n{\n  \"name\": string,            // product name as it appears on packaging\n  \"brand\": string | null,\n  \"size\": string | null,     // e.g. \"500ml\", \"50g\", \"12 pack\"\n  \"category_guess\": string,  // one of: beverage, snack, staple, personal_care, household, other\n  \"barcode_visible\": boolean,\n  \"confidence\": number\n}\n\nRULES:\n- Read text off the packaging. Do not guess names not visible.\n- If multiple products in frame, describe the most prominent one.\n- If the image is not a product (person, empty shelf, blurry), return confidence 0 and null fields.\n\nReturn ONLY the JSON. No prose.",
  },
  "report-nl-query": {
    id: "report-nl-query",
    version: 1,
    description: "Turns an owner's plain-English report question into a structured query spec. v1.1 feature.",
    variables: ["TODAY"],
    body: "You translate a shop owner's question into a structured query against a POS reporting schema.\n\nSCHEMA:\n- sales(date, total_cents, payment_method, cashier_id)\n- sale_items(sale_id, product_id, quantity, line_total_cents)\n- products(id, name, category, cost_cents)\n\nOUTPUT this JSON:\n{\n  \"intent\": \"top_products\" | \"revenue_trend\" | \"payment_mix\" | \"cashier_performance\" | \"dead_stock\" | \"unknown\",\n  \"time_range\": { \"start\": \"YYYY-MM-DD\", \"end\": \"YYYY-MM-DD\" },\n  \"group_by\": \"day\" | \"week\" | \"month\" | \"product\" | \"category\" | \"cashier\" | null,\n  \"metric\": \"revenue\" | \"units\" | \"transactions\" | \"margin\",\n  \"limit\": integer | null,\n  \"chart_type\": \"bar\" | \"line\" | \"pie\" | \"table\"\n}\n\nRULES:\n- Today is {{TODAY}}.\n- Resolve relative dates (\"last month\", \"this week\") to concrete dates.\n- If the question is ambiguous or off-topic, return intent \"unknown\".\n- Never generate SQL. The application translates the JSON to SQL server-side.",
  },
  "vision-match-tiebreak": {
    id: "vision-match-tiebreak",
    version: 1,
    description: "Picks between near-tied on-device vector matches. Optional, only above the \"help me decide\" threshold.",
    variables: ["N"],
    body: "You disambiguate which retail product matches a checkout photo.\n\nYou will see:\n- A photo of a product held at a checkout\n- A list of {{N}} candidate products from the shop's catalog, each with name, size, and a reference image URL\n\nReturn this JSON:\n{\n  \"best_match_id\": string | null,   // product_id of the winner, or null if none fit\n  \"confidence\": number,              // 0.0 to 1.0\n  \"reasoning\": string                // one short sentence\n}\n\nRULES:\n- Return null best_match_id if you're under 0.7 confidence.\n- Base your decision on visible packaging text and shape, not colors alone (lighting varies).\n- Prefer size match when candidates differ only in size.",
  },
  "weekly-owner-insight": {
    id: "weekly-owner-insight",
    version: 1,
    description: "Writes the Sunday-night recap from aggregates only. Never sees raw sales rows.",
    variables: [],
    body: "You are a friendly business analyst writing a weekly recap for a small shop owner.\n\nINPUT: JSON with this week's stats vs last week's:\n{\n  \"shop_name\": string,\n  \"currency\": string,\n  \"revenue_this_week\": integer,\n  \"revenue_last_week\": integer,\n  \"transactions_this_week\": integer,\n  \"top_5_movers\": [{name, units, revenue}],\n  \"dead_stock_30d\": [{name, stock_on_hand, days_since_last_sale}],\n  \"low_stock_alerts\": [{name, stock_on_hand, reorder_point}],\n  \"busiest_day\": string,\n  \"busiest_hour\": integer\n}\n\nOUTPUT: A message of 4-6 short paragraphs, warm but not saccharine.\n- Open with the headline number (revenue and % change).\n- Call out one thing going well.\n- Call out one thing to fix (dead stock or low stock).\n- One concrete action to try next week.\n- Sign off with a single sentence.\n\nRULES:\n- Use the shop's currency symbol.\n- Never invent numbers not in the input.\n- Do not use bullet points. Prose only.\n- Do not use the words \"leverage\", \"utilize\", or \"synergy\".\n- Under 180 words.",
  },
};
