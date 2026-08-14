"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { MapPin, Plus } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ActionNotice } from "@/components/ui/notice";
import { saveLocation, setLocationActive } from "@/app/warehouse-actions";

import { LocationDialog } from "./components/LocationDialog";
import { LocationsTable } from "./components/LocationsTable";
import type {
  LocationDraft,
  LocationRow,
  LocationsDialog,
  Notice,
} from "./components/types";

// Re-exported so page.tsx keeps importing its row type from here rather than
// reaching into ./components.
export type { LocationRow } from "./components/types";

/**
 * Every place stock can sit.
 *
 * This file owns the open dialog, the notice and the two server calls; the
 * table and the form live in ./components, and the form owns its own fields.
 */
export function LocationsClient({
  locations,
  currency,
  canEdit,
}: {
  locations: LocationRow[];
  currency: string;
  canEdit: boolean;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  const [dialog, setDialog] = useState<LocationsDialog>(null);
  const [notice, setNotice] = useState<Notice>(null);

  function save(draft: LocationDraft) {
    setNotice(null);
    startTransition(async () => {
      const result = await saveLocation({
        id: draft.id,
        name: draft.name,
        kind: draft.kind,
        code: draft.code || null,
        address: draft.address || null,
        phone: draft.phone || null,
        isDefault: draft.isDefault,
      });
      setNotice(result);
      if (result.ok) {
        setDialog(null);
        router.refresh();
      }
    });
  }

  function toggleActive(l: LocationRow) {
    setNotice(null);
    startTransition(async () => {
      const result = await setLocationActive(l.id, !l.is_active);
      setNotice(result);
      if (result.ok) router.refresh();
    });
  }

  return (
    <div className="mx-auto max-w-7xl space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="flex items-center gap-2.5 text-2xl font-bold tracking-tight text-gradient">
            <MapPin className="size-6 text-primary" />
            Locations
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Every place stock can sit. Balances are held per location — a warehouse
            full of stock doesn&apos;t help a customer standing at the till.
          </p>
        </div>

        {canEdit && (
          <Button
            type="button"
            onClick={() => {
              setNotice(null);
              setDialog({ name: "form", location: null });
            }}
          >
            <Plus />
            Add location
          </Button>
        )}
      </div>

      {/* Held back while the form is open, because the dialog shows its own
          errors and two copies of the same message read as two problems. */}
      {!dialog && <ActionNotice result={notice} />}

      <Card>
        <CardHeader className="flex-row items-center justify-between space-y-0">
          <CardTitle>Locations</CardTitle>
          <div className="flex items-center gap-3">
            <span className="text-xs text-muted-foreground">value shown at cost</span>
            <Badge variant="secondary">{locations.length}</Badge>
          </div>
        </CardHeader>

        <CardContent className="p-0">
          <LocationsTable
            locations={locations}
            currency={currency}
            canEdit={canEdit}
            pending={pending}
            onEdit={(location) => {
              setNotice(null);
              setDialog({ name: "form", location });
            }}
            onToggleActive={toggleActive}
          />
        </CardContent>
      </Card>

      <LocationDialog
        open={dialog?.name === "form"}
        location={dialog?.name === "form" ? dialog.location : null}
        pending={pending}
        notice={notice}
        onOpenChange={(open) => !open && setDialog(null)}
        onSave={save}
      />
    </div>
  );
}
