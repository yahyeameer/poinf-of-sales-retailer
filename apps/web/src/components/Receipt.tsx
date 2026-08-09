"use client";

import { formatMoney } from "@ai-pos/shared";

export interface ReceiptShop {
  name: string;
  logoUrl: string | null;
  phone: string | null;
  address: string | null;
  taxNumber: string | null;
  receiptHeader: string | null;
  receiptFooter: string | null;
  receiptShowLogo: boolean;
  receiptShowTaxLine: boolean;
  receiptPaperMm: 58 | 80;
}

export interface ReceiptSale {
  ref: string;
  createdAt: string;
  paymentMethod: string;
  items: { name: string; qty: number; priceCents: number }[];
  subtotalCents?: number;
  taxCents?: number;
  totalCents: number;
  isRefund?: boolean;
  voided?: boolean;
  cashierName?: string | null;
  locationName?: string | null;
}

/**
 * One receipt renderer, used by both the settings preview and the real thing.
 *
 * Two components would drift the first time someone tweaked a margin, and an
 * owner would design a layout that isn't what prints. 58mm and 80mm rolls hold
 * roughly 32 and 48 monospace characters, which is what the width below is
 * approximating — the character grid is the layout on a thermal printer.
 */
export function Receipt({ shop, sale }: { shop: ReceiptShop; sale: ReceiptSale }) {
  const narrow = shop.receiptPaperMm === 58;
  const width = narrow ? 260 : 330;

  return (
    <div
      className="receipt"
      style={{
        width,
        maxWidth: "100%",
        background: "#fff",
        color: "#111",
        padding: narrow ? "14px 12px" : "18px 20px",
        fontFamily: "ui-monospace, 'Cascadia Mono', Consolas, monospace",
        fontSize: narrow ? 11 : 12,
        lineHeight: 1.45,
        borderRadius: 4,
      }}
    >
      {shop.receiptShowLogo && shop.logoUrl && (
        <div style={{ textAlign: "center", marginBottom: 8 }}>
          {/* Plain img, not next/image: this element also goes through
              window.print(), where the optimiser's srcset is no help. */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={shop.logoUrl}
            alt=""
            style={{ maxHeight: narrow ? 40 : 52, maxWidth: "70%", objectFit: "contain" }}
          />
        </div>
      )}

      <div style={{ textAlign: "center", fontWeight: 700, fontSize: narrow ? 13 : 15 }}>
        {shop.name}
      </div>

      {shop.address && (
        <div style={{ textAlign: "center", fontSize: narrow ? 10 : 11 }}>{shop.address}</div>
      )}
      {shop.phone && (
        <div style={{ textAlign: "center", fontSize: narrow ? 10 : 11 }}>Tel: {shop.phone}</div>
      )}
      {shop.taxNumber && (
        <div style={{ textAlign: "center", fontSize: narrow ? 10 : 11 }}>
          TIN: {shop.taxNumber}
        </div>
      )}

      {shop.receiptHeader && (
        <div style={{ textAlign: "center", marginTop: 6, whiteSpace: "pre-wrap" }}>
          {shop.receiptHeader}
        </div>
      )}

      {sale.isRefund && (
        <div style={{ textAlign: "center", marginTop: 8, fontWeight: 700 }}>*** REFUND ***</div>
      )}
      {sale.voided && (
        <div style={{ textAlign: "center", marginTop: 8, fontWeight: 700 }}>*** VOIDED ***</div>
      )}

      <div style={{ borderTop: "1px dashed #999", margin: "10px 0" }} />

      {sale.items.map((item, i) => (
        <div key={i} style={{ display: "flex", justifyContent: "space-between", gap: 8 }}>
          <span style={{ flex: 1, minWidth: 0 }}>
            {item.qty}x {item.name}
          </span>
          <span style={{ whiteSpace: "nowrap", fontVariantNumeric: "tabular-nums" }}>
            {formatMoney(item.priceCents * item.qty, "")}
          </span>
        </div>
      ))}

      <div style={{ borderTop: "1px dashed #999", margin: "10px 0" }} />

      {sale.subtotalCents !== undefined && (
        <div style={{ display: "flex", justifyContent: "space-between" }}>
          <span>Subtotal</span>
          <span style={{ fontVariantNumeric: "tabular-nums" }}>
            {formatMoney(sale.subtotalCents, "")}
          </span>
        </div>
      )}

      {/* Tax-inclusive shops show the component already inside the total, which
          is why the wording says "incl." rather than adding a line. */}
      {shop.receiptShowTaxLine && sale.taxCents !== undefined && sale.taxCents !== 0 && (
        <div style={{ display: "flex", justifyContent: "space-between" }}>
          <span>Tax (incl.)</span>
          <span style={{ fontVariantNumeric: "tabular-nums" }}>
            {formatMoney(sale.taxCents, "")}
          </span>
        </div>
      )}

      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          fontWeight: 700,
          fontSize: narrow ? 14 : 16,
          marginTop: 6,
        }}
      >
        <span>TOTAL</span>
        <span style={{ fontVariantNumeric: "tabular-nums" }}>
          {formatMoney(sale.totalCents, "")}
        </span>
      </div>

      <div style={{ marginTop: 10, fontSize: narrow ? 10 : 11, color: "#444" }}>
        <div>Payment: {sale.paymentMethod.replace(/_/g, " ").toUpperCase()}</div>
        <div>Ref: {sale.ref}</div>
        <div>{new Date(sale.createdAt).toLocaleString()}</div>
        {sale.cashierName && <div>Served by: {sale.cashierName}</div>}
        {sale.locationName && <div>{sale.locationName}</div>}
      </div>

      {shop.receiptFooter && (
        <div
          style={{
            textAlign: "center",
            marginTop: 12,
            paddingTop: 8,
            borderTop: "1px dashed #999",
            whiteSpace: "pre-wrap",
          }}
        >
          {shop.receiptFooter}
        </div>
      )}
    </div>
  );
}
