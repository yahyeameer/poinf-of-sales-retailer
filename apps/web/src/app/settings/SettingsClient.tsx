"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";

import { Receipt, type ReceiptShop } from "@/components/Receipt";
import {
  removeLogo,
  updateReceiptSettings,
  updateShopProfile,
  updateTradingSettings,
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

export function SettingsClient({
  shop,
  canEdit,
  tenantId,
}: {
  shop: ShopBranding;
  canEdit: boolean;
  tenantId: string;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const fileRef = useRef<HTMLInputElement>(null);

  const [profileNotice, setProfileNotice] = useState<Notice>(null);
  const [logoNotice, setLogoNotice] = useState<Notice>(null);
  const [receiptNotice, setReceiptNotice] = useState<Notice>(null);
  const [tradingNotice, setTradingNotice] = useState<Notice>(null);

  const [profile, setProfile] = useState({
    name: shop.name,
    phone: shop.phone ?? "",
    address: shop.address ?? "",
    taxNumber: shop.taxNumber ?? "",
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
    <div>
      <h1>Shop Settings</h1>
      <p className="subtitle">
        Your shop&apos;s identity, what prints on a receipt, and how money is handled.
      </p>

      {!canEdit && (
        <div className="notice">
          Only an owner can change these. You can see what they are set to.
        </div>
      )}

      <div className="settings-grid">
        <div className="settings-forms">
          {/* ---------- Shop profile ---------- */}
          <form onSubmit={saveProfile} className="panel" style={{ padding: 20 }}>
            <h2 style={{ fontSize: 16, marginTop: 0 }}>Shop details</h2>
            <p className="hint" style={{ marginTop: 0 }}>
              These print at the top of every receipt.
            </p>

            <label htmlFor="s-name">Shop name</label>
            <input
              id="s-name"
              type="text"
              required
              disabled={disabled}
              value={profile.name}
              onChange={(e) => setProfile({ ...profile, name: e.target.value })}
            />

            <label htmlFor="s-phone">Phone number</label>
            <input
              id="s-phone"
              type="text"
              disabled={disabled}
              placeholder="+252 61 234 5678"
              value={profile.phone}
              onChange={(e) => setProfile({ ...profile, phone: e.target.value })}
            />

            <label htmlFor="s-address">Address</label>
            <input
              id="s-address"
              type="text"
              disabled={disabled}
              placeholder="Bakaara Market, Mogadishu"
              value={profile.address}
              onChange={(e) => setProfile({ ...profile, address: e.target.value })}
            />

            <label htmlFor="s-tin">Tax / TIN number</label>
            <input
              id="s-tin"
              type="text"
              disabled={disabled}
              placeholder="Optional"
              value={profile.taxNumber}
              onChange={(e) => setProfile({ ...profile, taxNumber: e.target.value })}
            />

            {profileNotice && (
              <div className={profileNotice.ok ? "notice success" : "notice"}>
                {profileNotice.message}
              </div>
            )}

            <button type="submit" disabled={disabled} style={{ width: "auto" }}>
              {pending ? "Saving…" : "Save shop details"}
            </button>
          </form>

          {/* ---------- Logo ---------- */}
          <section className="panel" style={{ padding: 20 }}>
            <h2 style={{ fontSize: 16, marginTop: 0 }}>Logo</h2>
            <p className="hint" style={{ marginTop: 0 }}>
              PNG, JPEG, WebP or SVG, under 1 MB. A square or wide logo works best;
              thermal printers are black and white, so plain shapes print better than
              photographs.
            </p>

            <div style={{ display: "flex", gap: 16, alignItems: "center", flexWrap: "wrap" }}>
              <div className="logo-slot">
                {shop.logoUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={shop.logoUrl} alt="Shop logo" />
                ) : (
                  <span className="hint">No logo</span>
                )}
              </div>

              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                <input
                  ref={fileRef}
                  type="file"
                  accept="image/png,image/jpeg,image/webp,image/svg+xml"
                  disabled={disabled}
                  onChange={handleLogo}
                  aria-label="Upload logo"
                />
                {shop.logoUrl && (
                  <button
                    type="button"
                    className="chip-button"
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
                  </button>
                )}
              </div>
            </div>

            {logoNotice && (
              <div className={logoNotice.ok ? "notice success" : "notice"} style={{ marginTop: 12 }}>
                {logoNotice.message}
              </div>
            )}
          </section>

          {/* ---------- Receipt ---------- */}
          <form onSubmit={saveReceipt} className="panel" style={{ padding: 20 }}>
            <h2 style={{ fontSize: 16, marginTop: 0 }}>Receipt layout</h2>
            <p className="hint" style={{ marginTop: 0 }}>
              The preview on the right updates as you type and is the same component
              that prints, so what you see is what customers get.
            </p>

            <label htmlFor="s-paper">Paper width</label>
            <select
              id="s-paper"
              disabled={disabled}
              value={receipt.paperMm}
              onChange={(e) =>
                setReceipt({ ...receipt, paperMm: Number(e.target.value) === 58 ? 58 : 80 })
              }
            >
              <option value={80}>80 mm — standard thermal roll</option>
              <option value={58}>58 mm — narrow, portable printers</option>
            </select>

            <label htmlFor="s-header">Header line</label>
            <input
              id="s-header"
              type="text"
              maxLength={200}
              disabled={disabled}
              placeholder="e.g. Wholesale &amp; Retail"
              value={receipt.header}
              onChange={(e) => setReceipt({ ...receipt, header: e.target.value })}
            />

            <label htmlFor="s-footer">Footer message</label>
            <textarea
              id="s-footer"
              rows={3}
              maxLength={300}
              disabled={disabled}
              placeholder="Thank you! No returns without a receipt."
              value={receipt.footer}
              onChange={(e) => setReceipt({ ...receipt, footer: e.target.value })}
              style={{
                width: "100%",
                padding: "8px 10px",
                borderRadius: 7,
                border: "1px solid var(--border)",
                background: "var(--bg)",
                color: "var(--text)",
                font: "inherit",
              }}
            />
            <p className="hint" style={{ marginTop: 4 }}>
              {receipt.footer.length}/300
            </p>

            <label style={{ display: "flex", gap: 8, alignItems: "center", marginTop: 12 }}>
              <input
                type="checkbox"
                disabled={disabled || !shop.logoUrl}
                checked={receipt.showLogo}
                onChange={(e) => setReceipt({ ...receipt, showLogo: e.target.checked })}
                style={{ width: "auto" }}
              />
              <span>Print the logo{!shop.logoUrl && " (upload one first)"}</span>
            </label>

            <label style={{ display: "flex", gap: 8, alignItems: "center", marginTop: 8 }}>
              <input
                type="checkbox"
                disabled={disabled}
                checked={receipt.showTaxLine}
                onChange={(e) => setReceipt({ ...receipt, showTaxLine: e.target.checked })}
                style={{ width: "auto" }}
              />
              <span>Show the tax line</span>
            </label>

            {receiptNotice && (
              <div className={receiptNotice.ok ? "notice success" : "notice"}>
                {receiptNotice.message}
              </div>
            )}

            <button type="submit" disabled={disabled} style={{ width: "auto", marginTop: 16 }}>
              {pending ? "Saving…" : "Save receipt layout"}
            </button>
          </form>

          {/* ---------- Trading ---------- */}
          <form onSubmit={saveTrading} className="panel" style={{ padding: 20 }}>
            <h2 style={{ fontSize: 16, marginTop: 0 }}>Money &amp; trading rules</h2>
            <p className="hint" style={{ marginTop: 0 }}>
              These apply to new sales. Past sales keep the rate and rule they were
              rung up with, which is why an old receipt still adds up.
            </p>

            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
              <div>
                <label htmlFor="s-currency">Currency</label>
                <input
                  id="s-currency"
                  type="text"
                  maxLength={3}
                  disabled={disabled}
                  value={trading.currency}
                  onChange={(e) =>
                    setTrading({ ...trading, currency: e.target.value.toUpperCase() })
                  }
                />
              </div>
              <div>
                <label htmlFor="s-tax">Tax rate (%)</label>
                <input
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

            <label style={{ display: "flex", gap: 8, alignItems: "flex-start", marginTop: 14 }}>
              <input
                type="checkbox"
                disabled={disabled}
                checked={trading.taxInclusive}
                onChange={(e) => setTrading({ ...trading, taxInclusive: e.target.checked })}
                style={{ width: "auto", marginTop: 3 }}
              />
              <span>
                Shelf prices already include tax
                <span className="hint" style={{ display: "block" }}>
                  On: the receipt shows tax as a component of the total. Off: tax is
                  added on top at checkout.
                </span>
              </span>
            </label>

            <label style={{ display: "flex", gap: 8, alignItems: "flex-start", marginTop: 12 }}>
              <input
                type="checkbox"
                disabled={disabled}
                checked={trading.allowOversell}
                onChange={(e) => setTrading({ ...trading, allowOversell: e.target.checked })}
                style={{ width: "auto", marginTop: 3 }}
              />
              <span>
                Allow selling stock you don&apos;t have
                <span className="hint" style={{ display: "block" }}>
                  Off: a sale is refused when the shelf is empty. On: it goes through
                  and is flagged for you to reconcile. Transfers between locations are
                  never allowed to oversell either way.
                </span>
              </span>
            </label>

            <label htmlFor="s-margin" style={{ marginTop: 14 }}>
              Warn below this margin (%)
            </label>
            <input
              id="s-margin"
              type="number"
              step="0.01"
              min="0"
              max="99.99"
              disabled={disabled}
              value={trading.minMarginPct}
              onChange={(e) => setTrading({ ...trading, minMarginPct: e.target.value })}
            />
            <p className="hint" style={{ marginTop: 4 }}>
              Shown when a restock pushes a product&apos;s margin under this. The selling
              price is never changed for you.
            </p>

            {tradingNotice && (
              <div className={tradingNotice.ok ? "notice success" : "notice"}>
                {tradingNotice.message}
              </div>
            )}

            <button type="submit" disabled={disabled} style={{ width: "auto", marginTop: 16 }}>
              {pending ? "Saving…" : "Save trading settings"}
            </button>
          </form>
        </div>

        {/* ---------- Live preview ---------- */}
        <div className="settings-preview">
          <div className="preview-sticky">
            <div className="nav-group-title" style={{ marginBottom: 10 }}>
              RECEIPT PREVIEW · {receipt.paperMm}MM
            </div>
            <Receipt shop={previewShop} sale={SAMPLE_SALE} />
            <p className="hint" style={{ marginTop: 10, maxWidth: 330 }}>
              Sample sale. Real receipts are on the{" "}
              <a href="/receipts">Receipts</a> page.
            </p>
            <p className="hint" style={{ maxWidth: 330 }}>
              Shop id <code>{tenantId.slice(0, 8)}</code>
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
