"use client";

import * as React from "react";

import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Notice } from "@/components/ui/notice";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

import {
  KIND_DESCRIPTION,
  type LocationDraft,
  type LocationRow,
  type Notice as NoticeResult,
} from "./types";

const BLANK: LocationDraft = {
  id: null,
  name: "",
  kind: "shop",
  code: "",
  address: "",
  phone: "",
  isDefault: false,
};

const toDraft = (l: LocationRow): LocationDraft => ({
  id: l.id,
  name: l.name,
  kind: l.kind,
  code: l.code ?? "",
  address: l.address ?? "",
  phone: l.phone ?? "",
  isDefault: l.is_default,
});

/**
 * Adding a location, or editing one. The fields only ever build one save call,
 * so they live here.
 */
export function LocationDialog({
  open,
  location,
  pending,
  notice,
  onOpenChange,
  onSave,
}: {
  open: boolean;
  /** The row being edited, or null when adding. */
  location: LocationRow | null;
  pending: boolean;
  notice: NoticeResult;
  onOpenChange: (open: boolean) => void;
  onSave: (draft: LocationDraft) => void;
}) {
  const [form, setForm] = React.useState<LocationDraft>(BLANK);
  const [seededFor, setSeededFor] = React.useState<string | null>(null);

  // Re-seed whenever the dialog opens against a different row — or against no
  // row, which is the add case. Done during render rather than in an effect so
  // the fields are never briefly the previously-edited location's.
  const seedKey = open ? (location?.id ?? "new") : null;
  if (seedKey !== seededFor) {
    setSeededFor(seedKey);
    if (open) setForm(location ? toDraft(location) : BLANK);
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <form
          onSubmit={(e) => {
            e.preventDefault();
            onSave(form);
          }}
          className="space-y-4"
        >
          <DialogHeader>
            <DialogTitle>{form.id ? "Edit location" : "Add location"}</DialogTitle>
          </DialogHeader>

          <div className="space-y-1.5">
            <Label htmlFor="l-name">Name</Label>
            <Input
              id="l-name"
              type="text"
              required
              placeholder="e.g. Bakaara Warehouse"
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="l-kind">Kind</Label>
            <Select
              value={form.kind}
              onValueChange={(kind) =>
                setForm({ ...form, kind: kind as LocationRow["kind"] })
              }
            >
              <SelectTrigger id="l-kind">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {(Object.keys(KIND_DESCRIPTION) as LocationRow["kind"][]).map((k) => (
                  <SelectItem key={k} value={k}>
                    {KIND_DESCRIPTION[k]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="l-code">Short code (optional)</Label>
            <Input
              id="l-code"
              type="text"
              placeholder="WH1"
              maxLength={12}
              value={form.code}
              onChange={(e) => setForm({ ...form, code: e.target.value.toUpperCase() })}
            />
            <p className="text-xs text-muted-foreground">
              Capitals, digits and dashes. Shows on transfer notes and pick lists.
            </p>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="l-address">Address (optional)</Label>
              <Input
                id="l-address"
                type="text"
                value={form.address}
                onChange={(e) => setForm({ ...form, address: e.target.value })}
              />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="l-phone">Phone (optional)</Label>
              <Input
                id="l-phone"
                type="text"
                value={form.phone}
                onChange={(e) => setForm({ ...form, phone: e.target.value })}
              />
            </div>
          </div>

          <div className="space-y-1.5">
            <Label className="flex items-center gap-2.5 font-normal">
              <Checkbox
                checked={form.isDefault}
                onChange={(e) => setForm({ ...form, isDefault: e.target.checked })}
              />
              <span>Make this the default location</span>
            </Label>
            <p className="text-xs text-muted-foreground">
              New sales and stock land here unless someone switches. Only one location
              can be the default.
            </p>
          </div>

          {notice && !notice.ok && <Notice tone="error">{notice.message}</Notice>}

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              disabled={pending}
              onClick={() => onOpenChange(false)}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={pending}>
              {pending ? "Saving…" : "Save location"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
