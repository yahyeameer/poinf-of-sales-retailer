/**
 * POST /functions/v1/weekly-report
 *
 * Sunday-night recap. Intended to run on a schedule (pg_cron or an external
 * trigger) with the service-role key, so it has no user behind it.
 *
 * The model is handed the output of weekly_report_stats() and nothing else —
 * aggregates only, no sales rows, no customer data. It cannot invent a number
 * it was never given, and there is no path from here to raw transactions.
 *
 * Body: { tenant_id? }   omit to run for every tenant on a paying plan
 */
import Anthropic from "npm:@anthropic-ai/sdk@0.68.0";

import { serviceClient } from "../_shared/clients.ts";
import { corsHeaders, json } from "../_shared/http.ts";
import { PROMPTS } from "../_shared/prompts.generated.ts";

interface Outcome {
  tenant_id: string;
  status: "sent" | "skipped" | "failed";
  reason?: string;
}

/**
 * Every attempt is written to report_deliveries, whatever happened.
 *
 * Outcomes used to exist only in this response, which on a cron run nobody
 * reads. A shop owner asking "did last week's report go out?" had no way to
 * find out, and a send failing every week for a month looked exactly like one
 * that worked. For something whose whole purpose is to arrive unprompted,
 * silent failure is the failure mode that matters.
 *
 * Logging is deliberately best-effort: a report that was emailed successfully
 * must not be reported as failed because the bookkeeping row would not write.
 */
async function record(
  admin: ReturnType<typeof serviceClient>,
  row: {
    tenant_id: string;
    period_end: string;
    status: Outcome["status"];
    recipient?: string | null;
    body?: string | null;
    reason?: string | null;
  },
): Promise<void> {
  const { error } = await admin.from("report_deliveries").insert({ kind: "weekly", ...row });
  if (error) console.error("weekly-report: could not log delivery", { row, error: error.message });
}

async function writeRecap(anthropic: Anthropic, stats: unknown): Promise<string> {
  const message = await anthropic.messages.create({
    model: Deno.env.get("ANTHROPIC_MODEL") ?? "claude-sonnet-5",
    max_tokens: 1000,
    system: PROMPTS["weekly-owner-insight"].body,
    messages: [{ role: "user", content: JSON.stringify(stats) }],
  });

  return message.content
    .filter((block): block is { type: "text"; text: string } => block.type === "text")
    .map((block) => block.text)
    .join("")
    .trim();
}

async function sendEmail(to: string, subject: string, body: string): Promise<void> {
  const apiKey = Deno.env.get("RESEND_API_KEY");
  if (!apiKey) throw new Error("RESEND_API_KEY is not configured");

  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      from: Deno.env.get("REPORT_FROM_EMAIL") ?? "reports@example.com",
      to,
      subject,
      text: body,
    }),
  });

  if (!response.ok) throw new Error(`Resend returned ${response.status}: ${await response.text()}`);
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  // Scheduled job: authenticate by service-role key, not a user session.
  const key = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "").trim();
  if (!key || key !== Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")) {
    return json({ error: "This endpoint requires the service-role key" }, 401);
  }

  const apiKey = Deno.env.get("ANTHROPIC_API_KEY");
  if (!apiKey) return json({ error: "ANTHROPIC_API_KEY is not configured" }, 500);

  let body: { tenant_id?: string } = {};
  try {
    body = await req.json();
  } catch {
    // No body is fine — that's the "run for everyone" case.
  }

  const admin = serviceClient();
  const anthropic = new Anthropic({ apiKey });

  // The weekly report is a Pro feature.
  let query = admin.from("tenants").select("id, name, plan").in("plan", ["pro", "self_hosted"]);
  if (body.tenant_id) query = admin.from("tenants").select("id, name, plan").eq("id", body.tenant_id);

  const { data: tenants, error } = await query;
  if (error) return json({ error: error.message }, 500);

  // Which week this run is about. Asked of the database rather than computed
  // here, so the job, the log and the dashboard cannot disagree about which
  // Sunday a row belongs to.
  const { data: periodEnd, error: periodError } = await admin.rpc("last_report_period_end");
  if (periodError) return json({ error: periodError.message }, 500);
  const period_end = periodEnd as string;

  // Shops already emailed about this week. The unique index would refuse a
  // second 'sent' row anyway, but that is a backstop against double-sending
  // the row — this is what stops us double-sending the *email*, which the
  // database cannot undo.
  const { data: alreadySent } = await admin
    .from("report_deliveries")
    .select("tenant_id")
    .eq("kind", "weekly")
    .eq("period_end", period_end)
    .eq("status", "sent");

  const done = new Set((alreadySent ?? []).map((r: { tenant_id: string }) => r.tenant_id));

  const results: Outcome[] = [];

  for (const tenant of tenants ?? []) {
    if (done.has(tenant.id)) {
      results.push({ tenant_id: tenant.id, status: "skipped", reason: "already sent this week" });
      continue;
    }

    try {
      const { data: stats, error: statsError } = await admin.rpc("weekly_report_stats", {
        p_tenant_id: tenant.id,
      });
      if (statsError) throw new Error(statsError.message);

      // A shop that sold nothing does not need a cheerful email about it.
      if (!stats || Number(stats.transactions_this_week ?? 0) === 0) {
        results.push({ tenant_id: tenant.id, status: "skipped", reason: "no sales this week" });
        await record(admin, {
          tenant_id: tenant.id,
          period_end,
          status: "skipped",
          reason: "no sales this week",
        });
        continue;
      }

      const { data: owners } = await admin
        .from("users")
        .select("email")
        .eq("tenant_id", tenant.id)
        .eq("role", "owner")
        .eq("is_active", true);

      const recipient = owners?.[0]?.email;
      if (!recipient) {
        results.push({ tenant_id: tenant.id, status: "skipped", reason: "no owner email" });
        await record(admin, {
          tenant_id: tenant.id,
          period_end,
          status: "skipped",
          reason: "no owner email",
        });
        continue;
      }

      const recap = await writeRecap(anthropic, stats);
      await sendEmail(recipient, `${tenant.name}: last week in numbers`, recap);

      // Logged only after the email is away, so a row saying "sent" always
      // means an email actually left. The reverse order would let a crash
      // between the two mark a report delivered that nobody received.
      results.push({ tenant_id: tenant.id, status: "sent" });
      await record(admin, {
        tenant_id: tenant.id,
        period_end,
        status: "sent",
        recipient,
        body: recap,
      });
    } catch (err) {
      // One shop's failure must not stop the run for the rest.
      console.error("weekly-report failed", { tenant_id: tenant.id, error: String(err) });
      results.push({ tenant_id: tenant.id, status: "failed", reason: String(err) });
      await record(admin, {
        tenant_id: tenant.id,
        period_end,
        status: "failed",
        reason: String(err),
      });
    }
  }

  return json({
    period_end,
    processed: results.length,
    sent: results.filter((r) => r.status === "sent").length,
    results,
  });
});
