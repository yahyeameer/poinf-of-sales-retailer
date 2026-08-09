"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { formatMoney } from "@ai-pos/shared";

import { saveLocation, setLocationActive } from "@/app/warehouse-actions";

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

const KIND_LABEL: Record<string, string> = {
  shop: "Shop floor",
  warehouse: "Warehouse",
  van: "Delivery van",
};

const BLANK = {
  id: null as string | null,
  name: "",
  kind: "shop" as LocationRow["kind"],
  code: "",
  address: "",
  phone: "",
  isDefault: false,
};

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

  const [form, setForm] = useState(BLANK);
  const [showForm, setShowForm] = useState(false);
  const [notice, setNotice] = useState<{ ok: boolean; message: string } | null>(null);

  function openNew() {
    setForm(BLANK);
    setNotice(null);
    setShowForm(true);
  }

  function openEdit(l: LocationRow) {
    setForm({
      id: l.id,
      name: l.name,
      kind: l.kind,
      code: l.code ?? "",
      address: l.address ?? "",
      phone: l.phone ?? "",
      isDefault: l.is_default,
    });
    setNotice(null);
    setShowForm(true);
  }

  function handleSave(e: React.FormEvent) {
    e.preventDefault();
    setNotice(null);
    startTransition(async () => {
      const result = await saveLocation({
        id: form.id,
        name: form.name,
        kind: form.kind,
        code: form.code || null,
        address: form.address || null,
        phone: form.phone || null,
        isDefault: form.isDefault,
      });
      setNotice(result);
      if (result.ok) {
        setShowForm(false);
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
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
        <div>
          <h1>Locations</h1>
          <p className="subtitle">
            Every place stock can sit. Balances are held per location — a warehouse
            full of stock doesn&apos;t help a customer standing at the till.
          </p>
        </div>
        {canEdit && (
          <button type="button" onClick={openNew} style={{ width: "auto", marginTop: 0 }}>
            + Add Location
          </button>
        )}
      </div>

      {notice && !showForm && (
        <div className={notice.ok ? "notice success" : "notice"}>{notice.message}</div>
      )}

      <section className="panel">
        <header>
          <span>Locations ({locations.length})</span>
          <span className="hint">value shown at cost</span>
        </header>
        <table>
          <thead>
            <tr>
              <th>Name</th>
              <th>Kind</th>
              <th>Code</th>
              <th className="num">Products</th>
              <th className="num">Units</th>
              <th className="num">Stock value</th>
              {canEdit && <th />}
            </tr>
          </thead>
          <tbody>
            {locations.map((l) => (
              <tr key={l.id} style={{ opacity: l.is_active ? 1 : 0.55 }}>
                <td style={{ fontWeight: 550 }}>
                  {l.name}
                  {l.is_default && <span className="pill" style={{ marginLeft: 6 }}>Default</span>}
                  {!l.is_active && <span className="pill danger" style={{ marginLeft: 6 }}>Closed</span>}
                  {l.address && <div className="hint">{l.address}</div>}
                </td>
                <td>{KIND_LABEL[l.kind] ?? l.kind}</td>
                <td><code>{l.code ?? "—"}</code></td>
                <td className="num">{l.lines}</td>
                <td className="num">{Math.round(l.units * 1000) / 1000}</td>
                <td className="num">{formatMoney(Math.round(l.valueCents), currency)}</td>
                {canEdit && (
                  <td className="num" style={{ whiteSpace: "nowrap" }}>
                    <button
                      type="button"
                      className="chip-button"
                      onClick={() => openEdit(l)}
                      disabled={pending}
                    >
                      Edit
                    </button>{" "}
                    <button
                      type="button"
                      className="chip-button"
                      onClick={() => toggleActive(l)}
                      disabled={pending}
                    >
                      {l.is_active ? "Close" : "Reopen"}
                    </button>
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      {showForm && (
        <div className="modal-backdrop">
          <form onSubmit={handleSave} className="modal">
            <h2 style={{ fontSize: "18px", marginTop: 0 }}>
              {form.id ? "Edit location" : "Add location"}
            </h2>

            <label htmlFor="l-name">Name</label>
            <input
              id="l-name"
              type="text"
              required
              placeholder="e.g. Bakaara Warehouse"
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
            />

            <label htmlFor="l-kind">Kind</label>
            <select
              id="l-kind"
              value={form.kind}
              onChange={(e) => setForm({ ...form, kind: e.target.value as LocationRow["kind"] })}
            >
              <option value="shop">Shop floor — sells to customers</option>
              <option value="warehouse">Warehouse — holds stock, no till</option>
              <option value="van">Delivery van — stock on the road</option>
            </select>

            <label htmlFor="l-code">Short code (optional)</label>
            <input
              id="l-code"
              type="text"
              placeholder="WH1"
              maxLength={12}
              value={form.code}
              onChange={(e) => setForm({ ...form, code: e.target.value.toUpperCase() })}
            />
            <p className="hint" style={{ marginTop: 4 }}>
              Capitals, digits and dashes. Shows on transfer notes and pick lists.
            </p>

            <label htmlFor="l-address">Address (optional)</label>
            <input
              id="l-address"
              type="text"
              value={form.address}
              onChange={(e) => setForm({ ...form, address: e.target.value })}
            />

            <label htmlFor="l-phone">Phone (optional)</label>
            <input
              id="l-phone"
              type="text"
              value={form.phone}
              onChange={(e) => setForm({ ...form, phone: e.target.value })}
            />

            <label style={{ display: "flex", gap: 8, alignItems: "center", marginTop: 12 }}>
              <input
                type="checkbox"
                checked={form.isDefault}
                onChange={(e) => setForm({ ...form, isDefault: e.target.checked })}
                style={{ width: "auto" }}
              />
              <span>Make this the default location</span>
            </label>
            <p className="hint" style={{ marginTop: 4 }}>
              New sales and stock land here unless someone switches. Only one location
              can be the default.
            </p>

            {notice && !notice.ok && <div className="notice">{notice.message}</div>}

            <div style={{ display: "flex", gap: "10px", marginTop: "20px" }}>
              <button type="submit" disabled={pending}>
                {pending ? "Saving…" : "Save location"}
              </button>
              <button
                type="button"
                onClick={() => setShowForm(false)}
                disabled={pending}
                style={{ background: "transparent", color: "var(--muted)", border: "1px solid var(--border)" }}
              >
                Cancel
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}
