"use client";

import { useState } from "react";

import { formatMoney, type CartLine } from "@ai-pos/shared";
import { Minus, Plus, ShoppingCart, Trash2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { cn } from "@/lib/utils";

interface Totals {
  subtotalCents: number;
  taxCents: number;
  totalCents: number;
}

/**
 * One line, with its own state because the quantity can be typed as well as
 * stepped.
 *
 * Stepping is right for one or two more; it is wrong for "eight of these",
 * which was eight taps on a 32px target. Tapping the number turns it into an
 * input, so the common case stays one tap and the awkward case stops being a
 * drum solo.
 */
function CartRow({
  line: l,
  currency,
  onQuantity,
}: {
  line: CartLine;
  currency: string;
  onQuantity: (productId: string, quantity: number) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");

  function commit() {
    const n = Number(draft);
    // A blank or nonsense entry means "leave it alone", not "remove the line" —
    // deleting a line is a deliberate action with its own button.
    if (Number.isFinite(n) && n > 0) onQuantity(l.productId, n);
    setEditing(false);
  }

  return (
    <li className="rounded-lg border border-border bg-card p-2.5">
      <div className="flex items-baseline justify-between gap-2">
        <span className="min-w-0 flex-1 truncate text-sm font-medium">{l.name}</span>
        <span className="text-sm font-bold tabular-nums">
          {formatMoney(Math.round(l.quantity * l.unitPriceCents), currency)}
        </span>
      </div>

      <div className="mt-2 flex items-center gap-2">
        <Button
          type="button"
          variant="outline"
          size="icon-touch"
          aria-label={`One fewer ${l.name}`}
          onClick={() => onQuantity(l.productId, l.quantity - 1)}
        >
          <Minus className="size-5" />
        </Button>

        {editing ? (
          <input
            autoFocus
            type="number"
            inputMode="decimal"
            min={0}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onBlur={commit}
            onKeyDown={(e) => {
              if (e.key === "Enter") commit();
              if (e.key === "Escape") setEditing(false);
            }}
            aria-label={`Quantity of ${l.name}`}
            className="h-12 w-16 rounded-lg border border-primary/45 bg-background text-center text-base font-semibold tabular-nums focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          />
        ) : (
          <button
            type="button"
            onClick={() => {
              setDraft(String(l.quantity));
              setEditing(true);
            }}
            aria-label={`Quantity of ${l.name}, ${l.quantity}. Tap to type a different amount.`}
            className="h-12 min-w-14 rounded-lg text-center text-base font-semibold tabular-nums hover:bg-muted"
          >
            {l.quantity}
          </button>
        )}

        <Button
          type="button"
          variant="outline"
          size="icon-touch"
          aria-label={`One more ${l.name}`}
          onClick={() => onQuantity(l.productId, l.quantity + 1)}
        >
          <Plus className="size-5" />
        </Button>

        <span className="ml-1 flex-1 truncate text-xs tabular-nums text-muted-foreground">
          @ {formatMoney(l.unitPriceCents, currency)}
        </span>

        {/* Pushed to the far edge, away from the minus it used to sit beside.
            Removing a line and reducing it by one are one tap apart otherwise,
            and only one of them is undoable by tapping again. */}
        <Button
          type="button"
          variant="ghost"
          size="icon-touch"
          aria-label={`Remove ${l.name}`}
          onClick={() => onQuantity(l.productId, 0)}
          className="text-muted-foreground hover:text-destructive"
        >
          <Trash2 className="size-5" />
        </Button>
      </div>
    </li>
  );
}

/**
 * The cart. Rendered twice with the same component: as a sticky side panel from
 * `lg`, and inside a bottom sheet on phones — the numbers must agree exactly, so
 * they come from one place.
 */
export function CartPanel({
  lines,
  totals,
  currency,
  taxInclusive,
  parkedCount,
  pending,
  onQuantity,
  onCharge,
  onHold,
  onShowHeld,
  className,
}: {
  lines: CartLine[];
  totals: Totals;
  currency: string;
  taxInclusive: boolean;
  parkedCount: number;
  pending: boolean;
  onQuantity: (productId: string, quantity: number) => void;
  onCharge: () => void;
  onHold: () => void;
  onShowHeld: () => void;
  className?: string;
}) {
  return (
    <section className={cn("flex min-h-0 flex-col gap-3", className)}>
      <header className="flex items-center justify-between gap-2">
        <h2 className="text-sm font-semibold">
          Cart <span className="tabular-nums text-muted-foreground">({lines.length})</span>
        </h2>
        {parkedCount > 0 && (
          <Button type="button" variant="ghost" size="sm" onClick={onShowHeld}>
            Held ({parkedCount})
          </Button>
        )}
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto">
        {lines.length === 0 ? (
          <EmptyState
            icon={ShoppingCart}
            title="Nothing scanned yet"
            description="Scan a barcode or tap a product to start the sale."
          />
        ) : (
          <ul className="flex flex-col gap-2">
            {lines.map((l) => (
              <CartRow
                key={l.productId}
                line={l}
                currency={currency}
                onQuantity={onQuantity}
              />
            ))}
          </ul>
        )}
      </div>

      <div className="shrink-0 space-y-2 border-t border-border pt-3">
        <dl className="space-y-1 text-sm">
          <div className="flex justify-between">
            <dt className="text-muted-foreground">Subtotal</dt>
            <dd className="tabular-nums">{formatMoney(totals.subtotalCents, currency)}</dd>
          </div>
          <div className="flex justify-between text-muted-foreground">
            <dt>{taxInclusive ? "Tax included" : "Tax"}</dt>
            <dd className="tabular-nums">{formatMoney(totals.taxCents, currency)}</dd>
          </div>
          <div className="flex items-baseline justify-between pt-1">
            <dt className="font-semibold">Total</dt>
            <dd className="text-2xl font-bold tabular-nums text-gradient">
              {formatMoney(totals.totalCents, currency)}
            </dd>
          </div>
        </dl>

        <div className="flex flex-col gap-2">
          <Button
            type="button"
            size="till"
            block="always"
            disabled={lines.length === 0}
            onClick={onCharge}
          >
            Charge {lines.length > 0 && formatMoney(totals.totalCents, currency)}
          </Button>
          <Button
            type="button"
            variant="outline"
            block="always"
            disabled={lines.length === 0 || pending}
            onClick={onHold}
          >
            Hold this sale
          </Button>
        </div>
      </div>
    </section>
  );
}
