/**
 * POST /functions/v1/process-sale
 *
 * The endpoint the device's sync queue drains into. It is a thin wrapper over
 * the process_sale() RPC — all the atomicity and idempotency lives in the
 * database, where it belongs, because the phone may well die mid-request.
 *
 * Accepts a batch: a device that has been offline for a day arrives with
 * everything at once, and one request beats forty on a bad connection.
 *
 * Body: { sales: [{ client_id, items, payment_method, discount_cents?,
 *                   created_at?, note? }] }
 *
 * Always 200 unless the whole request was malformed. Each sale reports its own
 * outcome, so one rejected line doesn't strand the other thirty-nine in the
 * queue forever.
 */
import { userClient } from "../_shared/clients.ts";
import { corsHeaders, json, requireAuthedPost } from "../_shared/http.ts";

type SaleLine = {
  product_id: string;
  quantity: number;
  unit_price_cents: number;
};

type IncomingSale = {
  client_id: string;
  items: SaleLine[];
  payment_method: "cash" | "mobile_money" | "card" | "mixed";
  discount_cents?: number;
  created_at?: string;
  note?: string;
};

type Outcome =
  | { client_id: string; status: "ok"; sale_id: string; total_cents: number }
  | { client_id: string; status: "rejected"; code: string; error: string; detail?: string };

const MAX_BATCH = 100;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const auth = requireAuthedPost(req);
  if (auth instanceof Response) return auth;

  let body: { sales?: IncomingSale[] };
  try {
    body = await req.json();
  } catch {
    return json({ error: "Body must be JSON" }, 400);
  }

  const sales = body.sales ?? [];
  if (!Array.isArray(sales) || sales.length === 0) {
    return json({ error: "Nothing to sync" }, 400);
  }
  if (sales.length > MAX_BATCH) {
    return json({ error: `Batch too large; send at most ${MAX_BATCH} sales` }, 413);
  }

  const supabase = userClient(auth.token);
  const results: Outcome[] = [];

  // Sequential, not Promise.all. These calls take row locks on the same product
  // rows; firing a whole batch concurrently mostly produces lock contention and
  // makes a slow connection slower, not faster.
  for (const sale of sales) {
    if (!sale?.client_id || !Array.isArray(sale.items) || sale.items.length === 0) {
      results.push({
        client_id: sale?.client_id ?? "unknown",
        status: "rejected",
        code: "PS422",
        error: "Sale needs a client_id and at least one line",
      });
      continue;
    }

    const { data, error } = await supabase.rpc("process_sale", {
      p_client_id: sale.client_id,
      p_items: sale.items,
      p_payment_method: sale.payment_method,
      p_discount_cents: sale.discount_cents ?? 0,
      p_created_at: sale.created_at ?? new Date().toISOString(),
      p_note: sale.note ?? null,
    });

    if (error) {
      results.push({
        client_id: sale.client_id,
        status: "rejected",
        code: error.code ?? "unknown",
        error: error.message,
        detail: (error as { details?: string }).details,
      });
      continue;
    }

    results.push({
      client_id: sale.client_id,
      status: "ok",
      sale_id: data.id,
      total_cents: data.total_cents,
    });
  }

  const rejected = results.filter((r) => r.status === "rejected").length;

  return json({
    synced: results.length - rejected,
    rejected,
    results,
  });
});
