"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { Building2, Store, Truck } from "lucide-react";

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { switchLocation } from "@/app/warehouse-actions";
import type { ShopLocation } from "@/lib/tenant";

const KIND_ICON = {
  shop: Store,
  warehouse: Building2,
  van: Truck,
} as const;

export function LocationSwitcher({
  locations,
  activeId,
  pinned,
}: {
  locations: ShopLocation[];
  activeId: string | null;
  pinned: boolean;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  const active = locations.find((l) => l.id === activeId);
  const ActiveIcon = active ? (KIND_ICON[active.kind] ?? Store) : Store;

  // A cashier tied to one shop gets a label, not a control — offering a
  // disabled dropdown just invites them to try.
  if (pinned || locations.length <= 1) {
    return (
      <div className="flex items-center gap-2 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 dark:border-slate-800 dark:bg-slate-800/50">
        <ActiveIcon className="h-4 w-4 shrink-0 text-slate-400" />
        <div className="min-w-0">
          <div className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">
            Working at
          </div>
          <div className="truncate text-xs font-medium text-slate-700 dark:text-slate-300">
            {active?.name ?? "No location"}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-1">
      <div className="px-1 text-[10px] font-semibold uppercase tracking-wider text-slate-400">
        Working at
      </div>
      <Select
        value={activeId ?? ""}
        disabled={pending}
        onValueChange={(next) => {
          startTransition(async () => {
            await switchLocation(next);
            router.refresh();
          });
        }}
      >
        <SelectTrigger className="h-9 text-xs">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {locations.map((l) => {
            const Icon = KIND_ICON[l.kind] ?? Store;
            return (
              <SelectItem key={l.id} value={l.id}>
                <span className="flex items-center gap-2">
                  <Icon className="h-3.5 w-3.5 text-slate-400" />
                  {l.name}
                </span>
              </SelectItem>
            );
          })}
        </SelectContent>
      </Select>
    </div>
  );
}
