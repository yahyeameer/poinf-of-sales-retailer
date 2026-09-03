"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { formatMoney } from "@ai-pos/shared";
import { Archive, Pencil, Plus, RotateCcw, Truck } from "lucide-react";

import { LocalTime } from "@/components/LocalTime";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { EmptyState } from "@/components/ui/empty-state";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/components/ui/toast";
import { saveSupplier, setSupplierActive } from "@/app/purchasing-actions";

export interface Supplier {
  id: string;
  name: string;
  contactName: string | null;
  phone: string | null;
  email: string | null;
  address: string | null;
  note: string | null;
  leadTimeDays: number;
  isActive: boolean;
  deliveries: number;
  units: number;
  spendCents: number;
  lastDeliveryAt: string | null;
}

const BLANK = {
  id: null as string | null,
  name: "",
  contactName: "",
  phone: "",
  email: "",
  address: "",
  leadTimeDays: "0",
  note: "",
};

/**
 * Who the shop buys from, and what they have cost.
 *
 * The spend column is the reason this screen is worth opening rather than a
 * settings sub-page: products.cost_cents is a weighted average with no memory
 * of where any of it came from, so "has this wholesaler been getting dearer?"
 * is only answerable once deliveries are attributed.
 */
export function SuppliersClient({
  suppliers,
  currency,
}: {
  suppliers: Supplier[];
  currency: string;
}) {
  const router = useRouter();
  const [pending, startTransition] = React.useTransition();
  const [form, setForm] = React.useState<typeof BLANK | null>(null);
  const toast = useToast();

  function openNew() {
    setForm({ ...BLANK });
  }

  function openEdit(s: Supplier) {
    setForm({
      id: s.id,
      name: s.name,
      contactName: s.contactName ?? "",
      phone: s.phone ?? "",
      email: s.email ?? "",
      address: s.address ?? "",
      leadTimeDays: String(s.leadTimeDays),
      note: s.note ?? "",
    });
  }

  function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!form) return;

    startTransition(async () => {
      const result = await saveSupplier({
        id: form.id,
        name: form.name,
        contactName: form.contactName || null,
        phone: form.phone || null,
        email: form.email || null,
        address: form.address || null,
        leadTimeDays: parseInt(form.leadTimeDays, 10) || 0,
        note: form.note || null,
      });

      toast(result);
      if (result.ok) {
        setForm(null);
        router.refresh();
      }
    });
  }

  function toggleActive(s: Supplier) {
    startTransition(async () => {
      const result = await setSupplierActive(s.id, !s.isActive);
      toast(result);
      if (result.ok) router.refresh();
    });
  }

  return (
    <div className="mx-auto max-w-7xl space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="flex items-center gap-2.5 text-2xl font-bold tracking-tight text-gradient">
            <Truck className="size-6 text-primary" />
            Suppliers
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Who you buy from, and what they have cost you.
          </p>
        </div>

        <Button type="button" onClick={openNew}>
          <Plus />
          Add supplier
        </Button>
      </div>

      <Card>
        <CardHeader className="flex-row items-center justify-between space-y-0">
          <CardTitle>All suppliers</CardTitle>
          <Badge variant="secondary">{suppliers.length}</Badge>
        </CardHeader>

        <CardContent className="p-0">
          {suppliers.length === 0 ? (
            <EmptyState
              icon={Truck}
              title="No suppliers yet"
              description="Add the wholesalers you buy from, then a delivery can be booked in against one."
              action={
                <Button type="button" onClick={openNew}>
                  <Plus />
                  Add your first supplier
                </Button>
              }
            />
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Supplier</TableHead>
                    <TableHead>Contact</TableHead>
                    <TableHead className="text-right">Lead time</TableHead>
                    <TableHead className="text-right">Deliveries</TableHead>
                    <TableHead className="text-right">Spend</TableHead>
                    <TableHead className="text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>

                <TableBody>
                  {suppliers.map((s) => (
                    <TableRow key={s.id} data-inactive={s.isActive ? undefined : "true"}>
                      <TableCell>
                        <div className="flex items-center gap-2">
                          <span className="font-semibold">{s.name}</span>
                          {!s.isActive && <Badge variant="outline">Archived</Badge>}
                        </div>
                        {s.lastDeliveryAt && (
                          <p className="mt-0.5 text-xs text-muted-foreground">
                            Last delivery <LocalTime value={s.lastDeliveryAt} format="date" />
                          </p>
                        )}
                      </TableCell>

                      <TableCell className="text-sm text-muted-foreground">
                        {s.contactName || s.phone || s.email ? (
                          <div className="space-y-0.5">
                            {s.contactName && <div>{s.contactName}</div>}
                            {s.phone && <div className="font-mono text-xs">{s.phone}</div>}
                            {s.email && <div className="truncate text-xs">{s.email}</div>}
                          </div>
                        ) : (
                          "—"
                        )}
                      </TableCell>

                      <TableCell className="text-right tabular-nums text-muted-foreground">
                        {s.leadTimeDays === 0 ? "—" : `${s.leadTimeDays}d`}
                      </TableCell>

                      <TableCell className="text-right tabular-nums">
                        {s.deliveries.toLocaleString()}
                      </TableCell>

                      <TableCell className="text-right font-semibold tabular-nums">
                        {formatMoney(s.spendCents, currency)}
                      </TableCell>

                      <TableCell>
                        <div className="flex flex-wrap justify-end gap-2">
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            onClick={() => openEdit(s)}
                          >
                            <Pencil />
                            Edit
                          </Button>
                          <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            disabled={pending}
                            onClick={() => toggleActive(s)}
                          >
                            {s.isActive ? <Archive /> : <RotateCcw />}
                            {s.isActive ? "Archive" : "Restore"}
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      <Dialog open={form !== null} onOpenChange={(open) => !open && setForm(null)}>
        <DialogContent className="max-w-md">
          <form onSubmit={submit} className="space-y-4">
            <DialogHeader>
              <DialogTitle>{form?.id ? "Edit supplier" : "Add supplier"}</DialogTitle>
              <DialogDescription>
                Only the name is required. Everything else is there so you can reach them
                without looking it up somewhere else.
              </DialogDescription>
            </DialogHeader>

            <div className="space-y-1.5">
              <Label htmlFor="sup-name">Name</Label>
              <Input
                id="sup-name"
                required
                maxLength={200}
                value={form?.name ?? ""}
                onChange={(e) => setForm((f) => (f ? { ...f, name: e.target.value } : f))}
              />
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="sup-contact">Contact person</Label>
                <Input
                  id="sup-contact"
                  value={form?.contactName ?? ""}
                  onChange={(e) =>
                    setForm((f) => (f ? { ...f, contactName: e.target.value } : f))
                  }
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="sup-phone">Phone</Label>
                <Input
                  id="sup-phone"
                  value={form?.phone ?? ""}
                  onChange={(e) => setForm((f) => (f ? { ...f, phone: e.target.value } : f))}
                />
              </div>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="sup-email">Email</Label>
              <Input
                id="sup-email"
                type="email"
                value={form?.email ?? ""}
                onChange={(e) => setForm((f) => (f ? { ...f, email: e.target.value } : f))}
              />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="sup-lead">Usual lead time (days)</Label>
              <Input
                id="sup-lead"
                type="number"
                min="0"
                max="365"
                value={form?.leadTimeDays ?? "0"}
                onChange={(e) =>
                  setForm((f) => (f ? { ...f, leadTimeDays: e.target.value } : f))
                }
              />
              <p className="text-xs text-muted-foreground">
                How long they normally take. Nothing depends on it yet — it is here so the
                figure is recorded while you know it.
              </p>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="sup-note">Note</Label>
              <Textarea
                id="sup-note"
                rows={2}
                value={form?.note ?? ""}
                onChange={(e) => setForm((f) => (f ? { ...f, note: e.target.value } : f))}
              />
            </div>

            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                disabled={pending}
                onClick={() => setForm(null)}
              >
                Cancel
              </Button>
              <Button type="submit" disabled={pending}>
                {pending ? "Saving…" : form?.id ? "Save changes" : "Add supplier"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
