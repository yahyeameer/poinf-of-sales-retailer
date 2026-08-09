"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";

import { switchLocation } from "@/app/warehouse-actions";
import type { ShopLocation } from "@/lib/tenant";

const KIND_MARK: Record<string, string> = {
  shop: "Shop",
  warehouse: "Warehouse",
  van: "Van",
};

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

  // A cashier tied to one shop gets a label, not a control — offering a
  // disabled dropdown just invites them to try.
  if (pinned || locations.length <= 1) {
    return (
      <div className="loc-switcher">
        <span className="loc-label">Working at</span>
        <span className="loc-static">{active?.name ?? "No location"}</span>
      </div>
    );
  }

  return (
    <div className="loc-switcher">
      <label className="loc-label" htmlFor="loc-select">
        Working at
      </label>
      <select
        id="loc-select"
        value={activeId ?? ""}
        disabled={pending}
        onChange={(e) => {
          const next = e.target.value;
          startTransition(async () => {
            await switchLocation(next);
            router.refresh();
          });
        }}
      >
        {locations.map((l) => (
          <option key={l.id} value={l.id}>
            {l.name} · {KIND_MARK[l.kind] ?? l.kind}
          </option>
        ))}
      </select>
    </div>
  );
}
