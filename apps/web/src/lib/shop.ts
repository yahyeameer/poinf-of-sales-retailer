import { createClient } from "@/lib/supabase/server";

export interface ShopBranding {
  name: string;
  currency: string;
  logoUrl: string | null;
  phone: string | null;
  address: string | null;
  taxNumber: string | null;
  receiptHeader: string | null;
  receiptFooter: string | null;
  receiptShowLogo: boolean;
  receiptShowTaxLine: boolean;
  receiptPaperMm: 58 | 80;
  taxRate: number;
  taxInclusive: boolean;
  allowOversell: boolean;
  minMarginPct: number;
  secondaryCurrency: string | null;
  exchangeRate: number | null;
  exchangeRateUpdatedAt: string | null;
}

/** Columns the settings page and the receipt both read. Kept in one place so
 *  the preview and the printed copy cannot disagree about what exists. */
export const SHOP_COLUMNS =
  "name, currency, logo_path, phone, address, tax_number, " +
  "receipt_header, receipt_footer, receipt_show_logo, receipt_show_tax_line, " +
  "receipt_paper_mm, tax_rate, tax_inclusive, allow_oversell, min_margin_pct, " +
  "secondary_currency, exchange_rate, exchange_rate_updated_at";

interface ShopRow {
  name: string;
  currency: string;
  logo_path: string | null;
  phone: string | null;
  address: string | null;
  tax_number: string | null;
  receipt_header: string | null;
  receipt_footer: string | null;
  receipt_show_logo: boolean;
  receipt_show_tax_line: boolean;
  receipt_paper_mm: number;
  tax_rate: string | number;
  tax_inclusive: boolean;
  allow_oversell: boolean;
  min_margin_pct: string | number;
  secondary_currency: string | null;
  exchange_rate: string | number | null;
  exchange_rate_updated_at: string | null;
}

/**
 * Turns a stored object path into a URL at render time.
 *
 * The path is stored rather than the URL because the project host differs
 * between local, staging and production — a URL written into the row would
 * point at the wrong host the moment the shop is deployed anywhere else.
 */
export function logoUrlFor(supabaseUrl: string, path: string | null): string | null {
  if (!path) return null;
  return `${supabaseUrl}/storage/v1/object/public/shop-logos/${path}`;
}

export async function getShopBranding(tenantId: string): Promise<ShopBranding | null> {
  const supabase = await createClient();

  const { data, error } = await supabase
    .from("tenants")
    .select(SHOP_COLUMNS)
    .eq("id", tenantId)
    .single();

  if (error || !data) return null;

  const row = data as unknown as ShopRow;

  return {
    name: row.name,
    currency: row.currency,
    logoUrl: logoUrlFor(process.env.NEXT_PUBLIC_SUPABASE_URL ?? "", row.logo_path),
    phone: row.phone,
    address: row.address,
    taxNumber: row.tax_number,
    receiptHeader: row.receipt_header,
    receiptFooter: row.receipt_footer,
    receiptShowLogo: row.receipt_show_logo,
    receiptShowTaxLine: row.receipt_show_tax_line,
    receiptPaperMm: row.receipt_paper_mm === 58 ? 58 : 80,
    taxRate: Number(row.tax_rate),
    taxInclusive: row.tax_inclusive,
    allowOversell: row.allow_oversell,
    minMarginPct: Number(row.min_margin_pct),
    secondaryCurrency: row.secondary_currency,
    exchangeRate: row.exchange_rate == null ? null : Number(row.exchange_rate),
    exchangeRateUpdatedAt: row.exchange_rate_updated_at,
  };
}
