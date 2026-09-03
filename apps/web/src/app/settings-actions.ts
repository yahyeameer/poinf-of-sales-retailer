"use server";

import { revalidatePath } from "next/cache";

import { createClient } from "@/lib/supabase/server";
import { getTenantContext } from "@/lib/tenant";

export interface ActionResult {
  ok: boolean;
  message: string;
}

const MAX_LOGO_BYTES = 1_048_576; // matches the bucket's own limit
const ALLOWED_LOGO_TYPES = ["image/png", "image/jpeg", "image/webp", "image/svg+xml"];

function readableError(error: { message: string; code?: string } | null): string {
  if (!error) return "Something went wrong.";
  if (error.code === "42501") return "Only an owner can change shop settings.";
  return error.message;
}

/** Settings show up on the receipt, the till and the dashboard header. */
function revalidateEverywhere() {
  for (const path of ["/settings", "/receipts", "/till", "/", "/locations"]) {
    revalidatePath(path);
  }
}

async function requireOwner() {
  const ctx = await getTenantContext();
  if (!ctx) return { ctx: null, error: "You need to sign in first." };
  if (ctx.role !== "owner") return { ctx: null, error: "Only an owner can change shop settings." };
  return { ctx, error: null };
}

// ---------------------------------------------------------------------------
// Shop profile
// ---------------------------------------------------------------------------

export async function updateShopProfile(input: {
  name: string;
  phone: string | null;
  address: string | null;
  taxNumber: string | null;
}): Promise<ActionResult> {
  const { ctx, error: authError } = await requireOwner();
  if (!ctx) return { ok: false, message: authError! };
  if (!input.name.trim()) return { ok: false, message: "The shop needs a name." };

  const supabase = await createClient();
  const { error } = await supabase
    .from("tenants")
    .update({
      name: input.name.trim(),
      phone: input.phone?.trim() || null,
      address: input.address?.trim() || null,
      tax_number: input.taxNumber?.trim() || null,
    })
    .eq("id", ctx.tenantId);

  if (error) return { ok: false, message: readableError(error) };

  revalidateEverywhere();
  return { ok: true, message: "Shop details saved." };
}

// ---------------------------------------------------------------------------
// Logo
// ---------------------------------------------------------------------------

export async function uploadLogo(formData: FormData): Promise<ActionResult> {
  const { ctx, error: authError } = await requireOwner();
  if (!ctx) return { ok: false, message: authError! };

  const file = formData.get("logo");
  if (!(file instanceof File) || file.size === 0) {
    return { ok: false, message: "Choose an image first." };
  }
  if (!ALLOWED_LOGO_TYPES.includes(file.type)) {
    return { ok: false, message: "Use a PNG, JPEG, WebP or SVG." };
  }
  if (file.size > MAX_LOGO_BYTES) {
    return {
      ok: false,
      message: `That image is ${Math.round(file.size / 1024)} KB. Keep it under 1 MB.`,
    };
  }

  const supabase = await createClient();

  const ext = file.type === "image/svg+xml" ? "svg" : file.type.split("/")[1] ?? "png";
  // Fixed filename per tenant with upsert: a shop replacing its logo five times
  // should not leave five orphans in the bucket. The path prefix is the tenant
  // id, which is what the storage policy checks.
  const path = `${ctx.tenantId}/logo.${ext}`;

  const { error: uploadError } = await supabase.storage
    .from("shop-logos")
    .upload(path, file, { upsert: true, contentType: file.type });

  if (uploadError) return { ok: false, message: uploadError.message };

  // Clear any logo stored under a different extension, otherwise switching from
  // PNG to SVG leaves the old file serving from the bucket forever.
  const { data: existing } = await supabase.storage.from("shop-logos").list(ctx.tenantId);
  const stale = (existing ?? [])
    .filter((f) => f.name.startsWith("logo.") && f.name !== `logo.${ext}`)
    .map((f) => `${ctx.tenantId}/${f.name}`);
  if (stale.length > 0) {
    await supabase.storage.from("shop-logos").remove(stale);
  }

  const { error } = await supabase
    .from("tenants")
    .update({ logo_path: path })
    .eq("id", ctx.tenantId);

  if (error) return { ok: false, message: readableError(error) };

  revalidateEverywhere();
  return { ok: true, message: "Logo updated." };
}

export async function removeLogo(): Promise<ActionResult> {
  const { ctx, error: authError } = await requireOwner();
  if (!ctx) return { ok: false, message: authError! };

  const supabase = await createClient();

  const { data: existing } = await supabase.storage.from("shop-logos").list(ctx.tenantId);
  const paths = (existing ?? []).map((f) => `${ctx.tenantId}/${f.name}`);
  if (paths.length > 0) {
    await supabase.storage.from("shop-logos").remove(paths);
  }

  const { error } = await supabase
    .from("tenants")
    .update({ logo_path: null })
    .eq("id", ctx.tenantId);

  if (error) return { ok: false, message: readableError(error) };

  revalidateEverywhere();
  return { ok: true, message: "Logo removed." };
}

// ---------------------------------------------------------------------------
// Receipt
// ---------------------------------------------------------------------------

export async function updateReceiptSettings(input: {
  header: string | null;
  footer: string | null;
  showLogo: boolean;
  showTaxLine: boolean;
  paperMm: 58 | 80;
}): Promise<ActionResult> {
  const { ctx, error: authError } = await requireOwner();
  if (!ctx) return { ok: false, message: authError! };

  const supabase = await createClient();
  const { error } = await supabase
    .from("tenants")
    .update({
      receipt_header: input.header?.trim() || null,
      receipt_footer: input.footer?.trim() || null,
      receipt_show_logo: input.showLogo,
      receipt_show_tax_line: input.showTaxLine,
      receipt_paper_mm: input.paperMm,
    })
    .eq("id", ctx.tenantId);

  if (error) return { ok: false, message: readableError(error) };

  revalidateEverywhere();
  return { ok: true, message: "Receipt layout saved." };
}

// ---------------------------------------------------------------------------
// Ledger repair
// ---------------------------------------------------------------------------

/**
 * Rebuild `products.stock_on_hand` from `stock_movements`.
 *
 * The ledger is the truth and the column is a trigger-maintained cache of it.
 * They can only drift if a trigger was disabled during a migration or a row was
 * written round the side — rare, but when it happens every stock figure in the
 * app is quietly wrong and nothing surfaces it. README has documented this
 * function as the fix since the schema landed; it just had no button.
 *
 * Owner-only, and read-only in effect: it can only move the cache toward what
 * the ledger already says, so running it when nothing is wrong is a no-op that
 * reports zero.
 */
export async function recomputeStockOnHand(): Promise<ActionResult> {
  const { ctx, error: authError } = await requireOwner();
  if (!ctx) return { ok: false, message: authError! };

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("recompute_stock_on_hand", {
    p_tenant_id: ctx.tenantId,
  });

  if (error) return { ok: false, message: readableError(error) };

  const corrected = Number(data ?? 0);

  for (const path of ["/stock", "/catalog", "/warehouse", "/till", "/"]) {
    revalidatePath(path);
  }

  return {
    ok: true,
    message:
      corrected === 0
        ? "Checked every product — the ledger and the stock figures already agree."
        : `Corrected ${corrected} product${corrected === 1 ? "" : "s"} whose stock figure disagreed with the ledger.`,
  };
}

// ---------------------------------------------------------------------------
// Money and trading rules
// ---------------------------------------------------------------------------

export async function updateTradingSettings(input: {
  currency: string;
  taxRatePct: number;
  taxInclusive: boolean;
  allowOversell: boolean;
  minMarginPct: number;
}): Promise<ActionResult> {
  const { ctx, error: authError } = await requireOwner();
  if (!ctx) return { ok: false, message: authError! };

  if (!/^[A-Za-z]{3}$/.test(input.currency)) {
    return { ok: false, message: "Currency should be a three-letter code like USD or KES." };
  }
  if (!(input.taxRatePct >= 0 && input.taxRatePct < 100)) {
    return { ok: false, message: "Tax rate must be between 0 and 100." };
  }
  if (!(input.minMarginPct >= 0 && input.minMarginPct < 100)) {
    return { ok: false, message: "Minimum margin must be between 0 and 100." };
  }

  const supabase = await createClient();
  const { error } = await supabase
    .from("tenants")
    .update({
      currency: input.currency.toUpperCase(),
      // Stored as a rate, entered as a percentage. Rounded to four places to
      // match the numeric(6,4) column rather than letting Postgres truncate.
      tax_rate: Math.round((input.taxRatePct / 100) * 10000) / 10000,
      tax_inclusive: input.taxInclusive,
      allow_oversell: input.allowOversell,
      min_margin_pct: input.minMarginPct,
    })
    .eq("id", ctx.tenantId);

  if (error) return { ok: false, message: readableError(error) };

  revalidateEverywhere();
  return {
    ok: true,
    message: "Trading settings saved. New sales use these; past sales keep what they were rung up with.",
  };
}
