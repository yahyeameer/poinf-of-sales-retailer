"use client";

import { useState, useMemo, useTransition, useRef, useEffect } from "react";
import { useRouter } from "next/navigation";
import {
  formatMoney,
  computeTotals,
  addScan,
  setQuantity,
  type CartLine,
} from "@ai-pos/shared";

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

import {
  Search,
  ShoppingCart,
  Plus,
  Minus,
  Trash2,
  Barcode,
  Clock,
  CheckCircle2,
  DollarSign,
  CreditCard,
  Smartphone,
  Printer,
  X,
  Sparkles,
  AlertCircle
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export interface TillProduct {
  id: string;
  name: string;
  barcode: string | null;
  price_cents: number;
  stock_on_hand: number;
  unit: CartLine["unit"];
}
export interface ParkedSale {
  id: string;
  label: string;
  cart: CartLine[];
  created_at: string;
}
export interface OpenShift {
  id: string;
  opened_at: string;
  opening_float_cents: number;
}

type Method = "cash" | "mobile_money" | "card";
const METHOD_LABEL: Record<Method, string> = {
  cash: "Cash",
  mobile_money: "Mobile money",
  card: "Card",
};

interface Tender {
  method: Method;
  amount: string;
  tendered: string;
}

interface Receipt {
  saleId: string;
  totalCents: number;
  changeCents: number;
  lines: CartLine[];
}

export function TillClient({
  products,
  openShift: shift,
  parked,
  currency,
  taxRate,
  taxInclusive,
  cashierName,
  locationName,
  canRefund,
}: {
  products: TillProduct[];
  openShift: OpenShift | null;
  parked: ParkedSale[];
  currency: string;
  taxRate: number;
  taxInclusive: boolean;
  cashierName: string;
  locationName: string;
  canRefund: boolean;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const searchRef = useRef<HTMLInputElement>(null);

  const [lines, setLines] = useState<CartLine[]>([]);
  const [search, setSearch] = useState("");
  const [notice, setNotice] = useState<{ ok: boolean; message: string } | null>(null);

  const [dialog, setDialog] = useState<
    null | "checkout" | "openShift" | "closeShift" | "cash" | "held" | "xreport"
  >(null);
  const [receipt, setReceipt] = useState<Receipt | null>(null);

  const [floatInput, setFloatInput] = useState("50.00");
  const [countedInput, setCountedInput] = useState("");
  const [closeNote, setCloseNote] = useState("");
  const [cashKind, setCashKind] = useState<"pay_in" | "pay_out" | "drop">("pay_out");
  const [cashAmount, setCashAmount] = useState("");
  const [cashReason, setCashReason] = useState("");
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

  const tendersTotal = tenders.reduce(
    (sum, t) => sum + Math.round((parseFloat(t.amount) || 0) * 100),
    0,
  );
  const outstanding = totals.totalCents - tendersTotal;
  const cashChange = tenders
    .filter((t) => t.method === "cash")
    .reduce((sum, t) => {
      const tendered = Math.round((parseFloat(t.tendered) || 0) * 100);
      const amount = Math.round((parseFloat(t.amount) || 0) * 100);
      return sum + Math.max(0, tendered - amount);
    }, 0);

  useEffect(() => {
    if (dialog === null) searchRef.current?.focus();
  }, [dialog]);

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
      <div className="till-gate">
        <h1>Open the till</h1>
        <p className="subtitle">
          Count the cash in the drawer and enter it. Everything sold this shift is
          measured against this number, so it is worth getting right.
        </p>

        {notice && <div className={notice.ok ? "notice success" : "notice"}>{notice.message}</div>}

        <div className="panel" style={{ padding: 20, maxWidth: 380 }}>
          <label htmlFor="float">Opening float ({currency})</label>
          <input
            id="float"
            type="number"
            step="0.01"
            min="0"
            value={floatInput}
            onChange={(e) => setFloatInput(e.target.value)}
            autoFocus
          />
          <button
            type="button"
            disabled={pending}
            onClick={() =>
              runAction(() => openShift(Math.round((parseFloat(floatInput) || 0) * 100)))
            }
          >
            {pending ? "Opening…" : "Open shift"}
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="till">
      <div className="till-bar">
        <div>
          <span className="till-bar-label">Shift open</span>
          <span className="till-bar-meta">
            {locationName}
            {" · since "}
            {new Date(shift.opened_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
            {" · float "}{formatMoney(shift.opening_float_cents, currency)}
            {" · "}{cashierName}
          </span>
        </div>
        <div className="till-bar-actions">
          <button type="button" className="ghost" onClick={() => { setNotice(null); setDialog("cash"); }}>
            Cash in/out
          </button>
          <button
            type="button"
            className="ghost"
            onClick={() => {
              setNotice(null);
              startTransition(async () => {
                const r = await getShiftReport(shift.id);
                if (r.ok) { setReport(r.data as Record<string, unknown>); setDialog("xreport"); }
                else setNotice(r);
              });
            }}
          >
            X report
          </button>
          <button type="button" className="ghost" onClick={() => { setNotice(null); setCountedInput(""); setDialog("closeShift"); }}>
            Close shift
          </button>
        </div>
      </div>

      {notice && <div className={notice.ok ? "notice success" : "notice"}>{notice.message}</div>}

      <div className="till-grid">
        <section className="till-products">
          <input
            ref={searchRef}
            type="search"
            placeholder="Scan a barcode or search…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            onKeyDown={onSearchKeyDown}
            aria-label="Scan or search products"
          />

          <div className="key-grid">
            {filtered.map((p) => {
              const out = Number(p.stock_on_hand) <= 0;
              return (
                <button
                  key={p.id}
                  type="button"
                  className={`key${out ? " out" : ""}`}
                  onClick={() => add(p)}
                >
                  <span className="key-name">{p.name}</span>
                  <span className="key-foot">
                    <span className="key-price">{formatMoney(p.price_cents, currency)}</span>
                    <span className="key-stock">{Number(p.stock_on_hand)}</span>
                  </span>
                </button>
              );
            })}
            {filtered.length === 0 && <p className="empty">Nothing matches &ldquo;{search}&rdquo;.</p>}
          </div>
        </section>

        <section className="till-cart">
          <header>
            <span>Cart ({lines.length})</span>
            {parked.length > 0 && (
              <button type="button" className="linky" onClick={() => setDialog("held")}>
                Held ({parked.length})
              </button>
            )}
          </header>

          {lines.length === 0 ? (
            <p className="empty">Scan or tap a product to start.</p>
          ) : (
            <ul className="cart-lines">
              {lines.map((l) => (
                <li key={l.productId}>
                  <div className="cart-line-main">
                    <span className="cart-name">{l.name}</span>
                    <span className="cart-total">
                      {formatMoney(Math.round(l.quantity * l.unitPriceCents), currency)}
                    </span>
                  </div>
                  <div className="cart-line-controls">
                    <button
                      type="button"
                      aria-label={`One fewer ${l.name}`}
                      onClick={() => setLines((p) => setQuantity(p, l.productId, l.quantity - 1))}
                    >
                      −
                    </button>
                    <span className="qty">{l.quantity}</span>
                    <button
                      type="button"
                      aria-label={`One more ${l.name}`}
                      onClick={() => setLines((p) => setQuantity(p, l.productId, l.quantity + 1))}
                    >
                      +
                    </button>
                    <span className="cart-unit">
                      @ {formatMoney(l.unitPriceCents, currency)}
                    </span>
                    <button
                      type="button"
                      className="cart-remove"
                      onClick={() => setLines((p) => setQuantity(p, l.productId, 0))}
                    >
                      Remove
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          )}

          <div className="cart-totals">
            <div className="row">
              <span>Subtotal</span>
              <span>{formatMoney(totals.subtotalCents, currency)}</span>
            </div>
            <div className="row muted">
              <span>{taxInclusive ? "Tax included" : "Tax"}</span>
              <span>{formatMoney(totals.taxCents, currency)}</span>
            </div>
            <div className="row grand">
              <span>Total</span>
              <span>{formatMoney(totals.totalCents, currency)}</span>
            </div>
          </div>

          <div className="cart-actions">
            <button type="button" className="charge" disabled={lines.length === 0} onClick={beginCheckout}>
              Charge {lines.length > 0 && formatMoney(totals.totalCents, currency)}
            </button>
            <button
              type="button"
              className="ghost"
              disabled={lines.length === 0 || pending}
              onClick={() =>
                runAction(async () => {
                  const r = await parkSale(
                    `${lines.length} item${lines.length === 1 ? "" : "s"} · ${new Date().toLocaleTimeString()}`,
                    lines,
                  );
                  if (r.ok) setLines([]);
                  return r;
                })
              }
            >
              Hold
            </button>
          </div>
        </section>
      </div>

      {/* ---------------- checkout ---------------- */}
      {dialog === "checkout" && (
        <div className="modal-backdrop">
          <div className="modal">
            <h2 style={{ marginTop: 0, fontSize: 18 }}>Take payment</h2>
            <div className="due">
              <span>Due</span>
              <strong>{formatMoney(totals.totalCents, currency)}</strong>
            </div>

            {tenders.map((t, i) => (
              <div key={i} className="tender">
                <select
                  aria-label="Payment method"
                  value={t.method}
                  onChange={(e) =>
                    setTenders((p) =>
                      p.map((x, j) => (j === i ? { ...x, method: e.target.value as Method } : x)),
                    )
                  }
                >
                  {(Object.keys(METHOD_LABEL) as Method[]).map((m) => (
                    <option key={m} value={m}>{METHOD_LABEL[m]}</option>
                  ))}
                </select>
                <input
                  type="number"
                  step="0.01"
                  aria-label="Amount"
                  placeholder="Amount"
                  value={t.amount}
                  onChange={(e) =>
                    setTenders((p) => p.map((x, j) => (j === i ? { ...x, amount: e.target.value } : x)))
                  }
                />
                {t.method === "cash" && (
                  <input
                    type="number"
                    step="0.01"
                    aria-label="Cash given"
                    placeholder="Given"
                    value={t.tendered}
                    onChange={(e) =>
                      setTenders((p) => p.map((x, j) => (j === i ? { ...x, tendered: e.target.value } : x)))
                    }
                  />
                )}
                {tenders.length > 1 && (
                  <button
                    type="button"
                    className="linky"
                    onClick={() => setTenders((p) => p.filter((_, j) => j !== i))}
                  >
                    ×
                  </button>
                )}
              </div>
            ))}

            <button
              type="button"
              className="linky"
              onClick={() =>
                setTenders((p) => [
                  ...p,
                  {
                    method: "mobile_money",
                    amount: (Math.max(0, outstanding) / 100).toFixed(2),
                    tendered: "",
                  },
                ])
              }
            >
              + Split across another method
            </button>

            <div className="checkout-summary">
              <div className="row">
                <span>Tendered</span>
                <span>{formatMoney(tendersTotal, currency)}</span>
              </div>
              {outstanding !== 0 && (
                <div className="row warn-row">
                  <span>{outstanding > 0 ? "Still owing" : "Over by"}</span>
                  <span>{formatMoney(Math.abs(outstanding), currency)}</span>
                </div>
              )}
              {cashChange > 0 && (
                <div className="row grand">
                  <span>Change</span>
                  <span>{formatMoney(cashChange, currency)}</span>
                </div>
              )}
            </div>

            {notice && !notice.ok && <div className="notice">{notice.message}</div>}

            <div className="modal-actions">
              <button type="button" disabled={pending || outstanding !== 0} onClick={submitSale}>
                {pending ? "Posting…" : "Complete sale"}
              </button>
              <button type="button" className="ghost" disabled={pending} onClick={() => setDialog(null)}>
                Back
              </button>
            </div>
            {outstanding !== 0 && (
              <p className="hint" style={{ marginTop: 8 }}>
                Payments have to add up to the total exactly. Change goes in the
                &ldquo;Given&rdquo; box, not the amount.
              </p>
            )}
          </div>
        </div>
      )}

      {/* ---------------- receipt ---------------- */}
      {receipt && (
        <div className="modal-backdrop">
          <div className="modal">
            <h2 style={{ marginTop: 0, fontSize: 18 }}>Sale complete</h2>
            {receipt.changeCents > 0 && (
              <div className="change-due">
                <span>Change due</span>
                <strong>{formatMoney(receipt.changeCents, currency)}</strong>
              </div>
            )}
            <div className="paper">
              {receipt.lines.map((l) => (
                <div className="row" key={l.productId}>
                  <span>{l.quantity}× {l.name}</span>
                  <span>{formatMoney(Math.round(l.quantity * l.unitPriceCents), currency)}</span>
                </div>
              ))}
              <hr />
              <div className="row tot">
                <span>TOTAL</span>
                <span>{formatMoney(receipt.totalCents, currency)}</span>
              </div>
              <div className="row"><span>Ref</span><span>{receipt.saleId.slice(0, 8).toUpperCase()}</span></div>
            </div>
            <div className="modal-actions">
              <button type="button" onClick={() => setReceipt(null)}>Next customer</button>
              <button type="button" className="ghost" onClick={() => window.print()}>Print</button>
            </div>
          </div>
        </div>
      )}

      {/* ---------------- held sales ---------------- */}
      {dialog === "held" && (
        <div className="modal-backdrop">
          <div className="modal">
            <h2 style={{ marginTop: 0, fontSize: 18 }}>Held sales</h2>
            {parked.length === 0 ? (
              <p className="empty">Nothing on hold.</p>
            ) : (
              <ul className="held-list">
                {parked.map((p) => (
                  <li key={p.id}>
                    <div>
                      <strong>{p.label}</strong>
                      <div className="hint">{new Date(p.created_at).toLocaleString()}</div>
                    </div>
                    <div style={{ display: "flex", gap: 8 }}>
                      <button
                        type="button"
                        onClick={() =>
                          runAction(async () => {
                            setLines(p.cart);
                            return deleteParkedSale(p.id);
                          })
                        }
                      >
                        Resume
                      </button>
                      <button
                        type="button"
                        className="ghost"
                        onClick={() => runAction(() => deleteParkedSale(p.id))}
                      >
                        Discard
                      </button>
                    </div>
                  </li>
                ))}
              </ul>
            )}
            <div className="modal-actions">
              <button type="button" className="ghost" onClick={() => setDialog(null)}>Close</button>
            </div>
          </div>
        </div>
      )}

      {/* ---------------- cash in / out ---------------- */}
      {dialog === "cash" && (
        <div className="modal-backdrop">
          <div className="modal">
            <h2 style={{ marginTop: 0, fontSize: 18 }}>Cash in or out</h2>
            <label htmlFor="ck">What is happening</label>
            <select id="ck" value={cashKind} onChange={(e) => setCashKind(e.target.value as typeof cashKind)}>
              <option value="pay_out">Paying money out</option>
              <option value="pay_in">Putting money in</option>
              <option value="drop">Moving cash to the safe</option>
            </select>

            <label htmlFor="ca">Amount ({currency})</label>
            <input id="ca" type="number" step="0.01" min="0" value={cashAmount} onChange={(e) => setCashAmount(e.target.value)} />

            <label htmlFor="cr">What for</label>
            <input id="cr" type="text" placeholder="e.g. delivery fare" value={cashReason} onChange={(e) => setCashReason(e.target.value)} />

            {notice && !notice.ok && <div className="notice">{notice.message}</div>}

            <div className="modal-actions">
              <button
                type="button"
                disabled={pending}
                onClick={() =>
                  runAction(async () => {
                    const r = await recordCashMovement(
                      shift.id, cashKind,
                      Math.round((parseFloat(cashAmount) || 0) * 100),
                      cashReason,
                    );
                    if (r.ok) { setCashAmount(""); setCashReason(""); }
                    return r;
                  })
                }
              >
                {pending ? "Recording…" : "Record"}
              </button>
              <button type="button" className="ghost" onClick={() => setDialog(null)}>Cancel</button>
            </div>
          </div>
        </div>
      )}

      {/* ---------------- close shift ---------------- */}
      {dialog === "closeShift" && (
        <div className="modal-backdrop">
          <div className="modal">
            <h2 style={{ marginTop: 0, fontSize: 18 }}>Close the shift</h2>
            <p className="hint" style={{ marginTop: 0 }}>
              Count the drawer and enter what is actually in it. The expected figure
              is deliberately hidden until you have — a target you can see is a
              target you count towards.
            </p>

            <label htmlFor="counted">Cash counted ({currency})</label>
            <input id="counted" type="number" step="0.01" min="0" value={countedInput}
                   onChange={(e) => setCountedInput(e.target.value)} autoFocus />

            <label htmlFor="cnote">Note (optional)</label>
            <input id="cnote" type="text" value={closeNote} onChange={(e) => setCloseNote(e.target.value)} />

            {notice && !notice.ok && <div className="notice">{notice.message}</div>}

            <div className="modal-actions">
              <button
                type="button"
                disabled={pending || countedInput === ""}
                onClick={() =>
                  startTransition(async () => {
                    const r = await closeShift(
                      shift.id,
                      Math.round((parseFloat(countedInput) || 0) * 100),
                      closeNote.trim() || null,
                    );
                    if (!r.ok) { setNotice(r); return; }
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
              >
                {pending ? "Closing…" : "Count and close"}
              </button>
              <button type="button" className="ghost" onClick={() => setDialog(null)}>Cancel</button>
            </div>
          </div>
        </div>
      )}

      {/* ---------------- X report ---------------- */}
      {dialog === "xreport" && report && (
        <div className="modal-backdrop">
          <div className="modal">
            <h2 style={{ marginTop: 0, fontSize: 18 }}>X report</h2>
            <p className="hint" style={{ marginTop: 0 }}>Mid-shift read. The shift stays open.</p>
            <div className="paper">
              <div className="row"><span>Opened</span><span>{new Date(String(report.opened_at)).toLocaleString()}</span></div>
              <div className="row"><span>Float</span><span>{formatMoney(Number(report.opening_float_cents), currency)}</span></div>
              <hr />
              <div className="row"><span>Sales</span><span>{String(report.sales_count)}</span></div>
              <div className="row"><span>Gross</span><span>{formatMoney(Number(report.gross_sales_cents), currency)}</span></div>
              <div className="row"><span>Refunds ({String(report.refunds_count)})</span><span>{formatMoney(Number(report.refunds_cents), currency)}</span></div>
              <div className="row tot"><span>NET</span><span>{formatMoney(Number(report.net_sales_cents), currency)}</span></div>
              <hr />
              {(report.by_method as { method: string; amount_cents: number }[]).map((m) => (
                <div className="row" key={m.method}>
                  <span>{METHOD_LABEL[m.method as Method] ?? m.method}</span>
                  <span>{formatMoney(Number(m.amount_cents), currency)}</span>
                </div>
              ))}
              {(report.cash_movements as { kind: string; amount_cents: number; reason: string }[]).map((c, i) => (
                <div className="row" key={i}>
                  <span>{c.kind === "pay_in" ? "In" : c.kind === "drop" ? "Drop" : "Out"}: {c.reason}</span>
                  <span>{c.kind === "pay_in" ? "" : "−"}{formatMoney(Number(c.amount_cents), currency)}</span>
                </div>
              ))}
              <hr />
              <div className="row tot">
                <span>CASH EXPECTED</span>
                <span>{formatMoney(Number(report.expected_cash_cents), currency)}</span>
              </div>
            </div>
            <div className="modal-actions">
              <button type="button" onClick={() => setDialog(null)}>Done</button>
              <button type="button" className="ghost" onClick={() => window.print()}>Print</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
