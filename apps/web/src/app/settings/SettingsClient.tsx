"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ImageIcon, Receipt as ReceiptIcon, Store, Stethoscope, Wallet } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ActionNotice } from "@/components/ui/notice";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Receipt, type ReceiptShop } from "@/components/Receipt";
import {
  removeLogo,
  updateReceiptSettings,
  updateShopProfile,
  updateTradingSettings,
  recomputeStockOnHand,
  uploadLogo,
} from "@/app/settings-actions";
import type { ShopBranding } from "@/lib/shop";

type Notice = { ok: boolean; message: string } | null;

/** Stand-in sale for the preview. Deliberately mundane — an owner is judging
 *  the layout, not the numbers. */
const SAMPLE_SALE = {
  ref: "9E43DF25",
  createdAt: new Date().toISOString(),
  paymentMethod: "mobile_money",
  items: [
    { name: "Coca-Cola 500ml", qty: 2, priceCents: 120 },
    { name: "Rice 5kg", qty: 1, priceCents: 1450 },
    { name: "Bar Soap 175g", qty: 3, priceCents: 95 },
  ],
  subtotalCents: 1975,
  taxCents: 258,
  totalCents: 1975,
  cashierName: "Amina",
  locationName: "Demo Mini-Mart",
};

/**
 * The zone list, from the browser rather than from a hardcoded array.
 *
 * supportedValuesOf returns the same IANA names the database validates
 * against, so the picker cannot offer something the trigger will reject. It is
 * missing on older Safari and on some Android WebViews; there the current
 * value is the only option, which keeps the form honest — it can be left
 * alone, and an owner who needs to change it can do so on another device
 * rather than being shown a list that would fail to save.
 */
const TIMEZONES: string[] = (() => {
  try {
    return (Intl as unknown as { supportedValuesOf?: (k: string) => string[] })
      .supportedValuesOf?.("timeZone") ?? [];
  } catch {
    return [];
  }
})();

export function SettingsClient({
  shop,
  canEdit,
  tenantId,
  timezone,
}: {
  shop: ShopBranding;
  canEdit: boolean;
  tenantId: string;
  timezone: string;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const fileRef = useRef<HTMLInputElement>(null);

  const [profileNotice, setProfileNotice] = useState<Notice>(null);
  const [logoNotice, setLogoNotice] = useState<Notice>(null);
  const [receiptNotice, setReceiptNotice] = useState<Notice>(null);
  const [tradingNotice, setTradingNotice] = useState<Notice>(null);
  const [ledgerNotice, setLedgerNotice] = useState<Notice>(null);

  const [profile, setProfile] = useState({
    name: shop.name,
    phone: shop.phone ?? "",
    address: shop.address ?? "",
    taxNumber: shop.taxNumber ?? "",
    timezone,
  });

  const [receipt, setReceipt] = useState({
    header: shop.receiptHeader ?? "",
    footer: shop.receiptFooter ?? "",
    showLogo: shop.receiptShowLogo,
    showTaxLine: shop.receiptShowTaxLine,
    paperMm: shop.receiptPaperMm,
  });

  const [trading, setTrading] = useState({
    currency: shop.currency,
    taxRatePct: String(Math.round(shop.taxRate * 10000) / 100),
    taxInclusive: shop.taxInclusive,
    allowOversell: shop.allowOversell,
    minMarginPct: String(shop.minMarginPct),
  });

  function repairLedger() {
    setLedgerNotice(null);
    startTransition(async () => {
      const r = await recomputeStockOnHand();
      setLedgerNotice(r);
      if (r.ok) router.refresh();
    });
  }

  // The preview reads the unsaved form state, not the saved row, so changes
  // show up as they are typed.
  const previewShop: ReceiptShop = {
    name: profile.name || shop.name,
    logoUrl: shop.logoUrl,
    phone: profile.phone || null,
    address: profile.address || null,
    taxNumber: profile.taxNumber || null,
    receiptHeader: receipt.header || null,
    receiptFooter: receipt.footer || null,
    receiptShowLogo: receipt.showLogo,
    receiptShowTaxLine: receipt.showTaxLine,
    receiptPaperMm: receipt.paperMm,
  };

  function saveProfile(e: React.FormEvent) {
    e.preventDefault();
    setProfileNotice(null);
    startTransition(async () => {
      const r = await updateShopProfile({
        name: profile.name,
        phone: profile.phone || null,
        address: profile.address || null,
        taxNumber: profile.taxNumber || null,
        timezone: profile.timezone,
      });
      setProfileNotice(r);
      if (r.ok) router.refresh();
    });
  }

  function handleLogo(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setLogoNotice(null);
    const data = new FormData();
    data.set("logo", file);
    startTransition(async () => {
      const r = await uploadLogo(data);
      setLogoNotice(r);
      if (fileRef.current) fileRef.current.value = "";
      if (r.ok) router.refresh();
    });
  }

  function saveReceipt(e: React.FormEvent) {
    e.preventDefault();
    setReceiptNotice(null);
    startTransition(async () => {
      const r = await updateReceiptSettings({
        header: receipt.header || null,
        footer: receipt.footer || null,
        showLogo: receipt.showLogo,
        showTaxLine: receipt.showTaxLine,
        paperMm: receipt.paperMm,
      });
      setReceiptNotice(r);
      if (r.ok) router.refresh();
    });
  }

  function saveTrading(e: React.FormEvent) {
    e.preventDefault();
    setTradingNotice(null);
    startTransition(async () => {
      const r = await updateTradingSettings({
        currency: trading.currency,
        taxRatePct: parseFloat(trading.taxRatePct) || 0,
        taxInclusive: trading.taxInclusive,
        allowOversell: trading.allowOversell,
        minMarginPct: parseFloat(trading.minMarginPct) || 0,
      });
      setTradingNotice(r);
      if (r.ok) router.refresh();
    });
  }

  const disabled = pending || !canEdit;

  return (
    <div className="max-w-7xl mx-auto space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-gradient">
          Shop Settings
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Your shop&apos;s identity, what prints on a receipt, and how money is handled.
        </p>
      </div>

      {!canEdit && (
        <div className="rounded-xl border border-border bg-muted p-4 text-sm text-muted-foreground">
          Only an owner can change these. You can see what they&apos;re set to.
        </div>
      )}

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_auto] xl:items-start">
        <div className="space-y-6 min-w-0">
          {/* ---------- Shop profile ---------- */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="flex items-center gap-2 text-base">
                <Store className="size-4 text-primary" />
                Shop details
              </CardTitle>
              <p className="text-xs text-muted-foreground">These print at the top of every receipt.</p>
            </CardHeader>
            <CardContent>
              <form onSubmit={saveProfile} className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="s-name">Shop name</Label>
                  <Input
                    id="s-name"
                    required
                    disabled={disabled}
                    value={profile.name}
                    onChange={(e) => setProfile({ ...profile, name: e.target.value })}
                  />
                </div>

                <div className="grid gap-4 sm:grid-cols-2">
                  <div className="space-y-2">
                    <Label htmlFor="s-phone">Phone number</Label>
                    <Input
                      id="s-phone"
                      disabled={disabled}
                      placeholder="+252 61 234 5678"
                      value={profile.phone}
                      onChange={(e) => setProfile({ ...profile, phone: e.target.value })}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="s-tin">Tax / TIN number</Label>
                    <Input
                      id="s-tin"
                      disabled={disabled}
                      placeholder="Optional"
                      value={profile.taxNumber}
                      onChange={(e) => setProfile({ ...profile, taxNumber: e.target.value })}
                    />
                  </div>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="s-address">Address</Label>
                  <Input
                    id="s-address"
                    disabled={disabled}
                    placeholder="Bakaara Market, Mogadishu"
                    value={profile.address}
                    onChange={(e) => setProfile({ ...profile, address: e.target.value })}
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="s-timezone">Time zone</Label>
                  {/* A native select over the browser's own zone list. Every
                      runtime that supports this returns the same IANA names the
                      database validates against, so the two cannot disagree —
                      and it saves shipping and ageing a list of 400 strings.
                      Older browsers get a text field, which the database still
                      checks. */}
                  <select
                    id="s-timezone"
                    disabled={disabled}
                    value={profile.timezone}
                    onChange={(e) => setProfile({ ...profile, timezone: e.target.value })}
                    className="flex h-10 w-full rounded-lg border border-border bg-card px-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-60"
                  >
                    {(TIMEZONES.includes(profile.timezone)
                      ? TIMEZONES
                      : [profile.timezone, ...TIMEZONES]
                    ).map((z) => (
                      <option key={z} value={z}>
                        {z}
                      </option>
                    ))}
                  </select>
                  <p className="text-xs text-muted-foreground">
                    Decides when your day starts and ends. Every daily figure — takings,
                    profit, cashier totals — is counted against this, so a sale at 11pm
                    lands on the right day.
                  </p>
                </div>

                <ActionNotice result={profileNotice} />

                <Button type="submit" disabled={disabled}>
                  {pending ? "Saving…" : "Save shop details"}
                </Button>
              </form>
            </CardContent>
          </Card>

          {/* ---------- Logo ---------- */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="flex items-center gap-2 text-base">
                <ImageIcon className="size-4 text-primary" />
                Logo
              </CardTitle>
              <p className="text-xs text-muted-foreground">
                PNG, JPEG, WebP or SVG, under 1 MB. Thermal printers are black and white, so
                plain shapes print better than photographs.
              </p>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex flex-wrap items-center gap-4">
                {/* Checkerboard so a transparent PNG reads as transparent, not white. */}
                <div
                  className="grid h-20 w-32 shrink-0 place-items-center rounded-lg border border-dashed border-border-strong p-2"
                  style={{
                    backgroundImage:
                      "linear-gradient(45deg,#e2e8f055 25%,transparent 25%),linear-gradient(-45deg,#e2e8f055 25%,transparent 25%),linear-gradient(45deg,transparent 75%,#e2e8f055 75%),linear-gradient(-45deg,transparent 75%,#e2e8f055 75%)",
                    backgroundSize: "12px 12px",
                    backgroundPosition: "0 0,0 6px,6px -6px,-6px 0",
                  }}
                >
                  {shop.logoUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={shop.logoUrl}
                      alt="Shop logo"
                      className="max-h-full max-w-full object-contain"
                    />
                  ) : (
                    <span className="text-xs text-muted-foreground">No logo</span>
                  )}
                </div>

                <div className="flex flex-col gap-2">
                  <Input
                    ref={fileRef}
                    type="file"
                    accept="image/png,image/jpeg,image/webp,image/svg+xml"
                    disabled={disabled}
                    onChange={handleLogo}
                    aria-label="Upload logo"
                    className="cursor-pointer file:mr-3 file:rounded file:border-0 file:bg-muted file:px-2 file:py-1 file:text-xs"
                  />
                  {shop.logoUrl && (
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      disabled={disabled}
                      onClick={() =>
                        startTransition(async () => {
                          const r = await removeLogo();
                          setLogoNotice(r);
                          if (r.ok) router.refresh();
                        })
                      }
                    >
                      Remove logo
                    </Button>
                  )}
                </div>
              </div>

              <ActionNotice result={logoNotice} />
            </CardContent>
          </Card>

          {/* ---------- Receipt ---------- */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="flex items-center gap-2 text-base">
                <ReceiptIcon className="size-4 text-primary" />
                Receipt layout
              </CardTitle>
              <p className="text-xs text-muted-foreground">
                The preview updates as you type and is the same component that prints, so what
                you see is what customers get.
              </p>
            </CardHeader>
            <CardContent>
              <form onSubmit={saveReceipt} className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="s-paper">Paper width</Label>
                  <Select
                    value={String(receipt.paperMm)}
                    disabled={disabled}
                    onValueChange={(v) =>
                      setReceipt({ ...receipt, paperMm: v === "58" ? 58 : 80 })
                    }
                  >
                    <SelectTrigger id="s-paper">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="80">80 mm — standard thermal roll</SelectItem>
                      <SelectItem value="58">58 mm — narrow, portable printers</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="s-header">Header line</Label>
                  <Input
                    id="s-header"
                    maxLength={200}
                    disabled={disabled}
                    placeholder="e.g. Wholesale &amp; Retail"
                    value={receipt.header}
                    onChange={(e) => setReceipt({ ...receipt, header: e.target.value })}
                  />
                </div>

                <div className="space-y-2">
                  <div className="flex items-baseline justify-between">
                    <Label htmlFor="s-footer">Footer message</Label>
                    <span className="text-xs text-muted-foreground">{receipt.footer.length}/300</span>
                  </div>
                  <Textarea
                    id="s-footer"
                    rows={3}
                    maxLength={300}
                    disabled={disabled}
                    placeholder="Thank you! No returns without a receipt."
                    value={receipt.footer}
                    onChange={(e) => setReceipt({ ...receipt, footer: e.target.value })}
                  />
                </div>

                <div className="space-y-3 rounded-lg border border-border p-3">
                  <Label className="flex items-center gap-2.5 font-normal">
                    <Checkbox
                      disabled={disabled || !shop.logoUrl}
                      checked={receipt.showLogo}
                      onChange={(e) => setReceipt({ ...receipt, showLogo: e.target.checked })}
                    />
                    <span>
                      Print the logo
                      {!shop.logoUrl && (
                        <span className="text-muted-foreground"> (upload one first)</span>
                      )}
                    </span>
                  </Label>

                  <Label className="flex items-center gap-2.5 font-normal">
                    <Checkbox
                      disabled={disabled}
                      checked={receipt.showTaxLine}
                      onChange={(e) => setReceipt({ ...receipt, showTaxLine: e.target.checked })}
                    />
                    <span>Show the tax line</span>
                  </Label>
                </div>

                <ActionNotice result={receiptNotice} />

                <Button type="submit" disabled={disabled}>
                  {pending ? "Saving…" : "Save receipt layout"}
                </Button>
              </form>
            </CardContent>
          </Card>

          {/* ---------- Trading ---------- */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="flex items-center gap-2 text-base">
                <Wallet className="size-4 text-primary" />
                Money &amp; trading rules
              </CardTitle>
              <p className="text-xs text-muted-foreground">
                These apply to new sales. Past sales keep the rate and rule they were rung up
                with, which is why an old receipt still adds up.
              </p>
            </CardHeader>
            <CardContent>
              <form onSubmit={saveTrading} className="space-y-4">
                <div className="grid gap-4 sm:grid-cols-2">
                  <div className="space-y-2">
                    <Label htmlFor="s-currency">Currency</Label>
                    <Input
                      id="s-currency"
                      maxLength={3}
                      disabled={disabled}
                      value={trading.currency}
                      onChange={(e) =>
                        setTrading({ ...trading, currency: e.target.value.toUpperCase() })
                      }
                      className="font-mono uppercase"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="s-tax">Tax rate (%)</Label>
                    <Input
                      id="s-tax"
                      type="number"
                      step="0.01"
                      min="0"
                      max="99.99"
                      disabled={disabled}
                      value={trading.taxRatePct}
                      onChange={(e) => setTrading({ ...trading, taxRatePct: e.target.value })}
                    />
                  </div>
                </div>

                <div className="space-y-3 rounded-lg border border-border p-3">
                  <Label className="flex items-start gap-2.5 font-normal">
                    <span className="mt-0.5">
                      <Checkbox
                        disabled={disabled}
                        checked={trading.taxInclusive}
                        onChange={(e) =>
                          setTrading({ ...trading, taxInclusive: e.target.checked })
                        }
                      />
                    </span>
                    <span>
                      Shelf prices already include tax
                      <span className="block text-xs text-muted-foreground">
                        On: the receipt shows tax as a component of the total. Off: tax is added
                        on top at checkout.
                      </span>
                    </span>
                  </Label>

                  <Label className="flex items-start gap-2.5 font-normal">
                    <span className="mt-0.5">
                      <Checkbox
                        disabled={disabled}
                        checked={trading.allowOversell}
                        onChange={(e) =>
                          setTrading({ ...trading, allowOversell: e.target.checked })
                        }
                      />
                    </span>
                    <span>
                      Allow selling stock you don&apos;t have
                      <span className="block text-xs text-muted-foreground">
                        Off: a sale is refused when the shelf is empty. On: it goes through and
                        is flagged for you to reconcile. Transfers between locations are never
                        allowed to oversell either way.
                      </span>
                    </span>
                  </Label>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="s-margin">Warn below this margin (%)</Label>
                  <Input
                    id="s-margin"
                    type="number"
                    step="0.01"
                    min="0"
                    max="99.99"
                    disabled={disabled}
                    value={trading.minMarginPct}
                    onChange={(e) => setTrading({ ...trading, minMarginPct: e.target.value })}
                  />
                  <p className="text-xs text-muted-foreground">
                    Shown when a restock pushes a product&apos;s margin under this. The selling
                    price is never changed for you.
                  </p>
                </div>

                <ActionNotice result={tradingNotice} />

                <Button type="submit" disabled={disabled}>
                  {pending ? "Saving…" : "Save trading settings"}
                </Button>
              </form>
            </CardContent>
          </Card>

          {/* ---------- Ledger repair ---------- */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="flex items-center gap-2 text-base">
                <Stethoscope className="size-4 text-primary" />
                Stock figure check
              </CardTitle>
              <p className="text-xs text-muted-foreground">
                Every stock number in the app is a running total of the stock ledger, kept
                up to date automatically. If the two ever drift apart, this rebuilds the
                totals from the ledger — the ledger is the one that is right.
              </p>
            </CardHeader>
            <CardContent className="space-y-4">
              <p className="text-xs text-muted-foreground">
                Safe to run at any time. It only ever moves a stock figure to what the
                ledger already says, and tells you how many were wrong. On a healthy shop
                that is none.
              </p>

              <ActionNotice result={ledgerNotice} />

              <Button
                type="button"
                variant="outline"
                disabled={disabled}
                onClick={repairLedger}
              >
                {pending ? "Checking…" : "Check stock figures"}
              </Button>
            </CardContent>
          </Card>
        </div>

        {/* ---------- Live preview ---------- */}
        <div className="xl:sticky xl:top-8">
          <div className="mb-2.5 flex items-center gap-2">
            <span className="text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
              Receipt preview
            </span>
            <Badge variant="outline" className="font-mono text-[10px]">
              {receipt.paperMm}mm
            </Badge>
          </div>

          <div className="rounded-xl bg-muted p-4">
            <Receipt shop={previewShop} sale={SAMPLE_SALE} />
          </div>

          <p className="mt-3 max-w-[330px] text-xs text-muted-foreground">
            Sample sale. Real receipts are on the{" "}
            <a href="/receipts" className="text-primary underline underline-offset-2">
              Receipts
            </a>{" "}
            page.
          </p>
          <p className="mt-1 max-w-[330px] text-xs text-muted-foreground">
            Shop id <code className="font-mono">{tenantId.slice(0, 8)}</code>
          </p>
        </div>
      </div>
    </div>
  );
}
