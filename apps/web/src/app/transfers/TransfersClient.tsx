"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ArrowLeftRight } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ActionNotice, Notice as NoticeBox } from "@/components/ui/notice";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { submitTransfer } from "@/app/warehouse-actions";
import type { ShopLocation } from "@/lib/tenant";

import { RecentTransfers } from "./components/RecentTransfers";
import { TransferLines } from "./components/TransferLines";
import type { Draft, Notice, StockAtLocation, TransferDoc } from "./components/types";

// Re-exported so page.tsx keeps importing its row types from here rather than
// reaching into ./components.
export type { StockAtLocation, TransferDoc } from "./components/types";

let nextKey = 1;

/**
 * Moving goods between locations.
 *
 * The whole draft lives here — both ends, the lines and the note — because the
 * submit button's enabled state depends on all of them at once, and a rule
 * spread across three components is a rule that eventually disagrees with
 * itself.
 */
export function TransfersClient({
  locations,
  stock,
  recent,
}: {
  locations: ShopLocation[];
  stock: StockAtLocation[];
  recent: TransferDoc[];
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  const [fromId, setFromId] = useState(locations[0]?.id ?? "");
  const [toId, setToId] = useState(locations[1]?.id ?? "");
  const [note, setNote] = useState("");
  const [lines, setLines] = useState<Draft[]>([{ key: 0, productId: "", quantity: "" }]);
  const [notice, setNotice] = useState<Notice>(null);

  // Only products that actually have stock at the source can be moved, so the
  // dropdown is built from the source's shelf rather than the whole catalog.
  const available = useMemo(
    () => stock.filter((s) => s.location_id === fromId && Number(s.on_hand) > 0),
    [stock, fromId],
  );

  const onHandFor = (productId: string) =>
    Number(available.find((s) => s.product_id === productId)?.on_hand ?? 0);

  const overCommitted = lines.some((l) => {
    const qty = parseFloat(l.quantity);
    return l.productId && Number.isFinite(qty) && qty > onHandFor(l.productId);
  });

  const filledLines = lines.filter((l) => l.productId && parseFloat(l.quantity) > 0);
  const sameLocation = fromId === toId;

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setNotice(null);
    startTransition(async () => {
      const result = await submitTransfer({
        fromLocationId: fromId,
        toLocationId: toId,
        lines: filledLines.map((l) => ({
          productId: l.productId,
          quantity: parseFloat(l.quantity),
        })),
        note: note.trim() || null,
      });
      setNotice(result);
      if (result.ok) {
        setLines([{ key: nextKey++, productId: "", quantity: "" }]);
        setNote("");
        router.refresh();
      }
    });
  }

  return (
    <div className="mx-auto max-w-7xl space-y-6">
      <div>
        <h1 className="flex items-center gap-2.5 text-2xl font-bold tracking-tight text-gradient">
          <ArrowLeftRight className="size-6 text-primary" />
          Stock transfers
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Move goods between your locations. Recorded as paired ledger entries, so the
          business total never changes — only where the stock sits.
        </p>
      </div>

      <ActionNotice result={notice} />

      <form onSubmit={handleSubmit}>
        <Card>
          <CardHeader>
            <CardTitle>New transfer</CardTitle>
          </CardHeader>

          <CardContent className="space-y-5">
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="t-from">From</Label>
                <Select
                  value={fromId}
                  onValueChange={(value) => {
                    setFromId(value);
                    // Lines reference the old shelf; clearing avoids submitting
                    // a product the new source may not stock at all.
                    setLines([{ key: nextKey++, productId: "", quantity: "" }]);
                  }}
                >
                  <SelectTrigger id="t-from">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {locations.map((l) => (
                      <SelectItem key={l.id} value={l.id}>
                        {l.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="t-to">To</Label>
                <Select value={toId} onValueChange={setToId}>
                  <SelectTrigger id="t-to">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {locations.map((l) => (
                      <SelectItem key={l.id} value={l.id}>
                        {l.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            {sameLocation && (
              <NoticeBox tone="warning">
                Source and destination are the same. Pick two different locations.
              </NoticeBox>
            )}

            <div className="space-y-3">
              <h3 className="text-sm font-semibold">Products</h3>
              <TransferLines
                lines={lines}
                available={available}
                onHandFor={onHandFor}
                onUpdate={(key, patch) =>
                  setLines((prev) => prev.map((l) => (l.key === key ? { ...l, ...patch } : l)))
                }
                onRemove={(key) => setLines((prev) => prev.filter((l) => l.key !== key))}
                onAdd={() =>
                  setLines((prev) => [...prev, { key: nextKey++, productId: "", quantity: "" }])
                }
              />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="t-note">Note (optional)</Label>
              <Input
                id="t-note"
                type="text"
                placeholder="e.g. weekly shelf replenishment"
                value={note}
                onChange={(e) => setNote(e.target.value)}
              />
            </div>

            <Button
              type="submit"
              disabled={pending || filledLines.length === 0 || sameLocation || overCommitted}
            >
              <ArrowLeftRight />
              {pending
                ? "Moving…"
                : `Transfer ${filledLines.length} line${filledLines.length === 1 ? "" : "s"}`}
            </Button>
          </CardContent>
        </Card>
      </form>

      <RecentTransfers recent={recent} />
    </div>
  );
}
