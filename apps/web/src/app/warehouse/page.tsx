import Link from "next/link";
import { redirect } from "next/navigation";
import {
  ArrowLeftRight,
  Boxes,
  ClipboardCheck,
  Coins,
  PackageSearch,
  TriangleAlert,
  Warehouse as WarehouseIcon,
} from "lucide-react";
import { formatMoney } from "@ai-pos/shared";

import { AccessGate } from "@/components/AccessGate";
import { LocalTime } from "@/components/LocalTime";
import { Shell } from "@/components/Shell";
import { canAccessRoute } from "@/components/nav-items";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { Notice } from "@/components/ui/notice";
import { StatTile } from "@/components/ui/stat-tile";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { createClient } from "@/lib/supabase/server";
import { getTenantContext, navAccess } from "@/lib/tenant";

export const dynamic = "force-dynamic";

/**
 * The warehouse counterpart of the retail dashboard at `/`.
 *
 * A warehouse has no takings, no drawer and no customers, so none of the
 * figures on `/` mean anything there — and because sales are location-scoped by
 * RLS, a warehouse picker who lands on `/` sees every tile reading zero. That
 * is indistinguishable from a broken app. The questions this screen answers
 * instead are the ones actually asked on that floor: what is here, what is
 * running out, what moved, and when it was last counted.
 *
 * Everything is scoped to the *active* location rather than the tenant. An
 * owner can reach it by switching the location switcher to a warehouse; staff
 * pinned to one are redirected here from `/`.
 */

interface StockRow {
  product_id: string;
  product_name: string;
  on_hand: number;
  reorder_point: number;
  cost_cents: number;
}

interface LowStockRow {
  product_id: string;
  name: string;
  stock_on_hand: number;
  reorder_point: number;
}

interface TransferRow {
  reference_id: string;
  moved_at: string;
  from_location: string | null;
  to_location: string | null;
  from_location_id: string | null;
  to_location_id: string | null;
  units: number;
  lines: number;
  net_delta: number;
}

interface StocktakeRow {
  reference_id: string;
  counted_at: string;
  lines_adjusted: number;
  units_missing: number | null;
  units_surplus: number | null;
}

export default async function WarehousePage() {
  const ctx = await getTenantContext();
  if (!ctx) redirect("/login?next=/warehouse");

  const access = navAccess(ctx);

  // Reachable only from a warehouse. Someone standing on the shop floor asking
  // for this page wants `/`, and sending them to a gate that says so is kinder
  // than a screen of zeroes about a building they aren't in.
  if (!canAccessRoute("/warehouse", access)) {
    return (
      <Shell shopName={ctx.shopName}>
        <AccessGate href="/warehouse" access={access} />
      </Shell>
    );
  }

  if (!ctx.locationId) {
    return (
      <Shell shopName={ctx.shopName}>
        <div className="mx-auto max-w-7xl space-y-6">
          <Heading name={ctx.locationName} />
          <Notice tone="warning">This shop has no location set up yet.</Notice>
        </div>
      </Shell>
    );
  }

  const supabase = await createClient();
  const locationId = ctx.locationId;

  const [{ data: stock }, { data: low }, { data: transfers }, { data: stocktakes }] =
    await Promise.all([
      supabase
        .from("v_location_stock")
        .select("product_id, product_name, on_hand, reorder_point, cost_cents")
        .eq("location_id", locationId),
      supabase
        .from("v_low_stock")
        .select("product_id, name, stock_on_hand, reorder_point")
        .eq("location_id", locationId)
        .order("stock_on_hand", { ascending: true })
        .limit(12),
      // Both directions in one query: `or` rather than two round trips, because
      // a transfer out of here and a transfer into here belong on the same list.
      supabase
        .from("v_transfers")
        .select(
          "reference_id, moved_at, from_location, to_location, from_location_id, to_location_id, units, lines, net_delta",
        )
        .or(`from_location_id.eq.${locationId},to_location_id.eq.${locationId}`)
        .order("moved_at", { ascending: false })
        .limit(8),
      supabase
        .from("v_stocktakes")
        .select("reference_id, counted_at, lines_adjusted, units_missing, units_surplus")
        .eq("location_id", locationId)
        .order("counted_at", { ascending: false })
        .limit(5),
    ]);

  const rows = (stock ?? []) as StockRow[];
  const lowRows = (low ?? []) as LowStockRow[];
  const transferRows = (transfers ?? []) as TransferRow[];
  const stocktakeRows = (stocktakes ?? []) as StocktakeRow[];

  // Only positive holdings count as "held". A negative balance is a ledger
  // problem, and averaging it into the headline would hide it.
  const held = rows.filter((r) => Number(r.on_hand) > 0);
  const units = held.reduce((sum, r) => sum + Number(r.on_hand), 0);
  const valueCents = held.reduce(
    (sum, r) => sum + Number(r.on_hand) * Number(r.cost_cents ?? 0),
    0,
  );
  const negatives = rows.filter((r) => Number(r.on_hand) < 0).length;
  const lastCount = stocktakeRows[0]?.counted_at ?? null;

  const money = (cents: number) => formatMoney(Math.round(cents), ctx.currency);

  return (
    <Shell shopName={ctx.shopName}>
      <div className="mx-auto max-w-7xl space-y-6">
        <Heading name={ctx.locationName} kind={ctx.locationKind} />

        {negatives > 0 && (
          <Notice tone="warning">
            {negatives} product{negatives === 1 ? " has" : "s have"} a negative balance here,
            which means the ledger and the shelf disagree. A{" "}
            <Link href="/stocktake" className="font-semibold underline underline-offset-4">
              stocktake
            </Link>{" "}
            corrects it.
          </Notice>
        )}

        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <StatTile
            label="SKUs held"
            value={held.length.toLocaleString()}
            hint={`of ${rows.length.toLocaleString()} stocked here`}
            icon={PackageSearch}
          />
          <StatTile label="Units on hand" value={units.toLocaleString()} icon={Boxes} />
          <StatTile
            label="Value at cost"
            value={money(valueCents)}
            hint="What this building is holding"
            icon={Coins}
          />
          <StatTile
            label="Below reorder"
            value={lowRows.length.toLocaleString()}
            hint={lowRows.length === 0 ? "Nothing to reorder" : "Lines needing a top-up"}
            icon={TriangleAlert}
          />
        </div>

        <div className="grid gap-4 lg:grid-cols-2">
          <Card>
            <CardHeader>
              <CardTitle>Running low here</CardTitle>
              <CardDescription>
                At or below the reorder point for this location
              </CardDescription>
            </CardHeader>
            <CardContent className="p-0">
              {lowRows.length === 0 ? (
                <EmptyState
                  icon={PackageSearch}
                  title="Nothing below its reorder point"
                  description="Every line held here is above the level you set for it."
                />
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Product</TableHead>
                      <TableHead className="text-right">On hand</TableHead>
                      <TableHead className="text-right">Reorder at</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {lowRows.map((row) => (
                      <TableRow key={row.product_id}>
                        <TableCell className="font-medium">{row.name}</TableCell>
                        <TableCell className="num text-right">
                          {Number(row.stock_on_hand) <= 0 ? (
                            <Badge variant="destructive">Out</Badge>
                          ) : (
                            Number(row.stock_on_hand).toLocaleString()
                          )}
                        </TableCell>
                        <TableCell className="num text-right text-muted-foreground">
                          {Number(row.reorder_point).toLocaleString()}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Recent movements</CardTitle>
              <CardDescription>Transfers in and out of {ctx.locationName}</CardDescription>
            </CardHeader>
            <CardContent className="p-0">
              {transferRows.length === 0 ? (
                <EmptyState
                  icon={ArrowLeftRight}
                  title="Nothing has moved yet"
                  description="Transfers to and from this location will appear here."
                />
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>When</TableHead>
                      <TableHead>Direction</TableHead>
                      <TableHead className="text-right">Units</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {transferRows.map((row) => {
                      const outbound = row.from_location_id === locationId;
                      const other = outbound ? row.to_location : row.from_location;

                      return (
                        <TableRow key={row.reference_id}>
                          <TableCell className="text-muted-foreground">
                            <LocalTime value={row.moved_at} format="date" />
                          </TableCell>
                          <TableCell>
                            <div className="flex items-center gap-1.5">
                              <Badge variant={outbound ? "secondary" : "default"}>
                                {outbound ? "Out" : "In"}
                              </Badge>
                              <span className="truncate">{other ?? "—"}</span>
                            </div>
                          </TableCell>
                          <TableCell className="num text-right">
                            {/* A transfer must net to zero. A pair that doesn't
                                means stock was created or destroyed by a move,
                                which is worth seeing rather than smoothing. */}
                            {Number(row.units).toLocaleString()}
                            {Number(row.net_delta) !== 0 && (
                              <Badge variant="destructive" className="ml-2">
                                unbalanced
                              </Badge>
                            )}
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        </div>

        <Card>
          <CardHeader>
            <CardTitle>Counts</CardTitle>
            <CardDescription>
              {lastCount ? (
                <>
                  Last counted <LocalTime value={lastCount} format="long" />
                </>
              ) : (
                "This location has never been counted"
              )}
            </CardDescription>
          </CardHeader>
          <CardContent className="p-0">
            {stocktakeRows.length === 0 ? (
              <EmptyState
                icon={ClipboardCheck}
                title="No stocktake on record"
                description="Counting the shelf against the ledger is how the two stay honest."
                action={
                  <Link
                    href="/stocktake"
                    className="inline-flex min-h-11 items-center rounded-lg bg-primary px-4 text-sm font-semibold text-primary-foreground transition-opacity hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    Start a stocktake
                  </Link>
                }
              />
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Counted</TableHead>
                    <TableHead className="text-right">Lines corrected</TableHead>
                    <TableHead className="text-right">Missing</TableHead>
                    <TableHead className="text-right">Extra</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {stocktakeRows.map((row) => (
                    <TableRow key={row.reference_id}>
                      <TableCell className="text-muted-foreground">
                        <LocalTime value={row.counted_at} />
                      </TableCell>
                      <TableCell className="num text-right">
                        {Number(row.lines_adjusted).toLocaleString()}
                      </TableCell>
                      <TableCell className="num text-right text-destructive">
                        {Number(row.units_missing ?? 0).toLocaleString()}
                      </TableCell>
                      <TableCell className="num text-right text-success">
                        {Number(row.units_surplus ?? 0).toLocaleString()}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>
      </div>
    </Shell>
  );
}

function Heading({ name, kind }: { name: string; kind?: string | null }) {
  return (
    <div className="flex flex-wrap items-center gap-3">
      <h1 className="flex items-center gap-2.5 text-2xl font-bold tracking-tight text-gradient">
        <WarehouseIcon className="size-6 text-primary" />
        {name}
      </h1>
      {kind && <Badge variant="secondary" className="capitalize">{kind}</Badge>}
    </div>
  );
}
