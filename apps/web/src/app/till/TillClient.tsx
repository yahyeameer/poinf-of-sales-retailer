"use client";

import { useState, useMemo, useTransition, useRef, useEffect } from "react";
import { useRouter } from "next/navigation";
import {
  formatMoney,
  formatTime,
  computeTotals,
  addScan,
  setQuantity,
  type CartLine,
} from "@ai-pos/shared";
import { ChevronUp } from "lucide-react";

import { Button } from "@/components/ui/button";
import { ActionNotice } from "@/components/ui/notice";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";

import {
  openShift,
  closeShift,
  recordCashMovement,
  completeSale,
  parkSale,
  deleteParkedSale,
  getShiftReport,
  type TenderInput,
} from "./actions";

import { CartPanel } from "./components/CartPanel";
import { CashDialog } from "./components/CashDialog";
import { CheckoutDialog } from "./components/CheckoutDialog";
import { CloseShiftDialog } from "./components/CloseShiftDialog";
import { HeldSalesDialog } from "./components/HeldSalesDialog";
import { ProductKeypad } from "./components/ProductKeypad";
import { ReceiptDialog } from "./components/ReceiptDialog";
import { ShiftGate } from "./components/ShiftGate";
import { TillBar } from "./components/TillBar";
import { XReportDialog } from "./components/XReportDialog";
import type {
  CashKind,
  Notice,
  OpenShift,
  ParkedSale,
  SaleReceipt,
  Tender,
  TillProduct,
} from "./components/types";

// page.tsx imports these from here, and they describe this route's props, so
// they stay re-exported rather than making every caller reach into components/.
export type { TillProduct, ParkedSale, OpenShift };

type DialogName = "checkout" | "cash" | "closeShift" | "held" | "xreport";

/**
 * The till's state owner. Everything visual lives in ./components — this file
 * holds the cart, the tenders, the idempotency key and the server calls, which
 * is the part that must not be duplicated when the same cart renders as both a
 * side panel and a bottom sheet.
 */
export function TillClient({
  products,
  openShift: shift,
  parked,
  currency,
  taxRate,
  taxInclusive,
  cashierName,
  locationName,
}: {
  products: TillProduct[];
  openShift: OpenShift | null;
  parked: ParkedSale[];
  currency: string;
  taxRate: number;
  taxInclusive: boolean;
  cashierName: string;
  locationName: string;
  /** Reserved for the refund flow, which lives on /receipts. */
  canRefund?: boolean;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const searchRef = useRef<HTMLInputElement>(null);

  const [lines, setLines] = useState<CartLine[]>([]);
  const [search, setSearch] = useState("");
  const [notice, setNotice] = useState<Notice>(null);

  const [dialog, setDialog] = useState<DialogName | null>(null);
  const [cartOpen, setCartOpen] = useState(false);
  const [receipt, setReceipt] = useState<SaleReceipt | null>(null);
  const [tenders, setTenders] = useState<Tender[]>([]);
  const [report, setReport] = useState<Record<string, unknown> | null>(null);

  // Generated once per checkout attempt, not per submit. A retry after a
  // dropped connection carries the same key, which is what stops the customer
  // being charged twice.
  const clientIdRef = useRef<string>("");

  const totals = useMemo(
    () => computeTotals(lines, { rate: taxRate, inclusive: taxInclusive }),
    [lines, taxRate, taxInclusive],
  );

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return products.slice(0, 40);
    return products
      .filter((p) => p.name.toLowerCase().includes(q) || (p.barcode ?? "").includes(q))
      .slice(0, 40);
  }, [products, search]);

  // Back to the scan field whenever nothing is covering it — a scanner types
  // into whatever has focus, and a cashier should never have to click first.
  useEffect(() => {
    if (dialog === null && !cartOpen && receipt === null) searchRef.current?.focus();
  }, [dialog, cartOpen, receipt]);

  function add(p: TillProduct) {
    setNotice(null);
    setLines((prev) =>
      addScan(prev, {
        productId: p.id,
        name: p.name,
        unitPriceCents: p.price_cents,
        quantity: 1,
        unit: p.unit,
      }),
    );
    setSearch("");
    searchRef.current?.focus();
  }

  // A scanner is a keyboard that types fast and hits Enter. One exact barcode
  // match goes straight into the cart so the cashier never touches the screen.
  function onSearchKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key !== "Enter") return;
    e.preventDefault();
    const q = search.trim();
    if (!q) return;
    const exact = products.find((p) => p.barcode === q);
    if (exact) return add(exact);
    if (filtered.length === 1) return add(filtered[0]!);
  }

  function beginCheckout() {
    if (lines.length === 0) return;
    clientIdRef.current = crypto.randomUUID();
    setTenders([{ method: "cash", amount: (totals.totalCents / 100).toFixed(2), tendered: "" }]);
    setNotice(null);
    setCartOpen(false);
    setDialog("checkout");
  }

  function submitSale() {
    const payments: TenderInput[] = tenders
      .map((t) => ({
        method: t.method,
        amountCents: Math.round((parseFloat(t.amount) || 0) * 100),
        tenderedCents: t.tendered ? Math.round(parseFloat(t.tendered) * 100) : null,
      }))
      .filter((p) => p.amountCents > 0);

    startTransition(async () => {
      const result = await completeSale({
        clientId: clientIdRef.current,
        items: lines.map((l) => ({
          productId: l.productId,
          quantity: l.quantity,
          unitPriceCents: l.unitPriceCents,
        })),
        payments,
        discountCents: totals.discountCents,
        shiftId: shift?.id ?? null,
        note: null,
      });

      if (!result.ok) {
        setNotice(result);
        return;
      }

      setReceipt({
        saleId: result.data!.saleId,
        totalCents: result.data!.totalCents,
        changeCents: result.data!.changeCents,
        lines,
      });
      setLines([]);
      setTenders([]);
      setDialog(null);
      router.refresh();
    });
  }

  function runAction(fn: () => Promise<{ ok: boolean; message: string }>) {
    startTransition(async () => {
      const result = await fn();
      setNotice(result);
      if (result.ok) {
        setDialog(null);
        router.refresh();
      }
    });
  }

  // --- no shift open: nothing else on this screen matters yet ---------------
  if (!shift) {
    return (
      <ShiftGate
        currency={currency}
        pending={pending}
        notice={notice}
        onOpenShift={(floatCents) => runAction(() => openShift(floatCents))}
      />
    );
  }

  const cart = (
    <CartPanel
      lines={lines}
      totals={totals}
      currency={currency}
      taxInclusive={taxInclusive}
      parkedCount={parked.length}
      pending={pending}
      onQuantity={(productId, quantity) =>
        setLines((prev) => setQuantity(prev, productId, quantity))
      }
      onCharge={beginCheckout}
      onHold={() =>
        runAction(async () => {
          const r = await parkSale(
            `${lines.length} item${lines.length === 1 ? "" : "s"} · ${formatTime(new Date())}`,
            lines,
          );
          if (r.ok) {
            setLines([]);
            setCartOpen(false);
          }
          return r;
        })
      }
      onShowHeld={() => {
        setCartOpen(false);
        setDialog("held");
      }}
    />
  );

  return (
    <div className="flex flex-col gap-4">
      <TillBar
        shift={shift}
        currency={currency}
        cashierName={cashierName}
        locationName={locationName}
        pending={pending}
        onCashDrawer={() => {
          setNotice(null);
          setDialog("cash");
        }}
        onXReport={() => {
          setNotice(null);
          startTransition(async () => {
            const r = await getShiftReport(shift.id);
            if (r.ok) {
              setReport(r.data as Record<string, unknown>);
              setDialog("xreport");
            } else {
              setNotice(r);
            }
          });
        }}
        onCloseShift={() => {
          setNotice(null);
          setDialog("closeShift");
        }}
      />

      <ActionNotice result={notice} />

      <div className="grid gap-4 lg:grid-cols-[1fr_22rem]">
        <ProductKeypad
          products={filtered}
          currency={currency}
          search={search}
          searchRef={searchRef}
          onSearchChange={setSearch}
          onSearchKeyDown={onSearchKeyDown}
          onAdd={add}
        />

        {/* From lg the cart is always visible and sticks with the page. Below
            that it is a sheet, opened from the bar pinned to the bottom edge. */}
        <aside className="hidden lg:block">
          <div className="sticky top-6 max-h-[calc(100dvh-3rem)] rounded-xl border border-border bg-card p-4 glow-sm lit-edge relative">
            {cart}
          </div>
        </aside>
      </div>

      {/* Phone: the till owns the bottom edge — /till renders without the app's
          tab bar, so nothing else is competing for it. */}
      <div className="fixed inset-x-0 bottom-0 z-40 border-t border-border glass lit-edge safe-b px-3 pt-3 lg:hidden">
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={() => setCartOpen(true)}
            className="flex min-w-0 flex-1 items-center gap-2 rounded-lg px-1 py-1 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            aria-label="Show the cart"
          >
            <ChevronUp className="size-4 shrink-0 text-muted-foreground" />
            <span className="min-w-0">
              <span className="block text-[11px] text-muted-foreground">
                {lines.length} item{lines.length === 1 ? "" : "s"}
              </span>
              <span className="block text-lg font-bold leading-tight tabular-nums text-gradient">
                {formatMoney(totals.totalCents, currency)}
              </span>
            </span>
          </button>

          <Button
            type="button"
            size="till"
            disabled={lines.length === 0}
            onClick={beginCheckout}
            className="shrink-0"
          >
            Charge
          </Button>
        </div>
      </div>
      {/* Spacer so the last row of products clears the fixed bar. */}
      <div aria-hidden className="h-20 lg:hidden" />

      <Sheet open={cartOpen} onOpenChange={setCartOpen}>
        <SheetContent side="bottom" className="max-h-[80dvh]">
          <SheetHeader className="sr-only">
            <SheetTitle>Cart</SheetTitle>
          </SheetHeader>
          {cart}
        </SheetContent>
      </Sheet>

      <CheckoutDialog
        open={dialog === "checkout"}
        onOpenChange={(open) => setDialog(open ? "checkout" : null)}
        currency={currency}
        totalCents={totals.totalCents}
        tenders={tenders}
        setTenders={setTenders}
        pending={pending}
        notice={notice}
        onSubmit={submitSale}
      />

      <ReceiptDialog receipt={receipt} currency={currency} onClose={() => setReceipt(null)} />

      <HeldSalesDialog
        open={dialog === "held"}
        onOpenChange={(open) => setDialog(open ? "held" : null)}
        parked={parked}
        pending={pending}
        onResume={(sale) =>
          runAction(async () => {
            setLines(sale.cart);
            return deleteParkedSale(sale.id);
          })
        }
        onDiscard={(sale) => runAction(() => deleteParkedSale(sale.id))}
      />

      <CashDialog
        open={dialog === "cash"}
        onOpenChange={(open) => setDialog(open ? "cash" : null)}
        currency={currency}
        pending={pending}
        notice={notice}
        onRecord={(kind: CashKind, amountCents, reason) =>
          runAction(() => recordCashMovement(shift.id, kind, amountCents, reason))
        }
      />

      <CloseShiftDialog
        open={dialog === "closeShift"}
        onOpenChange={(open) => setDialog(open ? "closeShift" : null)}
        currency={currency}
        pending={pending}
        notice={notice}
        onCloseShift={(countedCents, note) =>
          startTransition(async () => {
            const r = await closeShift(shift.id, countedCents, note);
            if (!r.ok) {
              setNotice(r);
              return;
            }
            const v = r.data!.variance;
            setNotice({
              ok: v === 0,
              message:
                v === 0
                  ? `Drawer balanced exactly at ${formatMoney(r.data!.expected, currency)}.`
                  : `Expected ${formatMoney(r.data!.expected, currency)} — ${
                      v < 0 ? "short" : "over"
                    } by ${formatMoney(Math.abs(v), currency)}.`,
            });
            setDialog(null);
            router.refresh();
          })
        }
      />

      <XReportDialog
        open={dialog === "xreport"}
        onOpenChange={(open) => setDialog(open ? "xreport" : null)}
        report={report}
        currency={currency}
      />
    </div>
  );
}
