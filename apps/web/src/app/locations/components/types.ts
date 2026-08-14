/** Shapes shared by the locations screen and its dialog. */

export interface LocationRow {
  id: string;
  name: string;
  kind: "shop" | "warehouse" | "van";
  code: string | null;
  address: string | null;
  phone: string | null;
  is_default: boolean;
  is_active: boolean;
  lines: number;
  units: number;
  valueCents: number;
}

/** What a location is for, which decides whether it can take money. */
export const KIND_LABEL: Record<LocationRow["kind"], string> = {
  shop: "Shop floor",
  warehouse: "Warehouse",
  van: "Delivery van",
};

export const KIND_DESCRIPTION: Record<LocationRow["kind"], string> = {
  shop: "Shop floor — sells to customers",
  warehouse: "Warehouse — holds stock, no till",
  van: "Delivery van — stock on the road",
};

/** What the save action needs. `id` null means this is a new location. */
export interface LocationDraft {
  id: string | null;
  name: string;
  kind: LocationRow["kind"];
  code: string;
  address: string;
  phone: string;
  isDefault: boolean;
}

export type Notice = { ok: boolean; message: string } | null;

/**
 * The form is the only dialog here, and it is either adding or editing — the
 * row it carries is what tells it which, rather than a second flag that could
 * disagree with it.
 */
export type LocationsDialog = { name: "form"; location: LocationRow | null } | null;
