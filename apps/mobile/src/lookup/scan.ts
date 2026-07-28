import type { CartLine, MatchSource, ProductUnit } from "@ai-pos/shared";

import { openLocalDb } from "@/db/local";

/**
 * The lookup ladder from the PRD, in order of preference:
 *
 *   1. barcode  — exact, offline, free, ~1ms. Handles the overwhelming majority.
 *   2. vision   — on-device CLIP against the local mirror. Week 9.
 *   3. search   — fuzzy name match, cashier picks.
 *
 * Note what none of these do: hit the network. The sale screen is expected to
 * work with the phone in aeroplane mode, so anything that can't be answered
 * from SQLite isn't part of the fast path.
 */

interface LocalProduct {
  id: string;
  name: string;
  price_cents: number;
  unit: string;
  stock_on_hand: number;
}

function toCartLine(p: LocalProduct, quantity: number, source: MatchSource): CartLine {
  return {
    productId: p.id,
    name: p.name,
    unitPriceCents: p.price_cents,
    quantity,
    unit: p.unit as ProductUnit,
    ...(source === "vision" ? { matchConfidence: 1 } : {}),
  };
}

/** Step 1. Exact barcode hit, straight from the index. */
export async function findByBarcode(barcode: string): Promise<CartLine | null> {
  const db = await openLocalDb();

  const row = await db.getFirstAsync<LocalProduct>(
    "SELECT id, name, price_cents, unit, stock_on_hand FROM products WHERE barcode = ? AND is_active = 1",
    [barcode.trim()],
  );

  return row ? toCartLine(row, 1, "barcode") : null;
}

/** Step 3. Type-ahead fallback when barcode and vision both come up empty. */
export async function searchByName(query: string, limit = 20): Promise<CartLine[]> {
  const trimmed = query.trim();
  if (trimmed.length < 2) return [];

  const db = await openLocalDb();

  const rows = await db.getAllAsync<LocalProduct>(
    `SELECT id, name, price_cents, unit, stock_on_hand
     FROM products
     WHERE is_active = 1 AND name LIKE ? COLLATE NOCASE
     ORDER BY
       -- Prefix matches first: someone typing "co" wants Coca-Cola, not
       -- "Bar Soap (coconut)".
       CASE WHEN name LIKE ? COLLATE NOCASE THEN 0 ELSE 1 END,
       length(name),
       name
     LIMIT ?`,
    [`%${trimmed}%`, `${trimmed}%`, limit],
  );

  return rows.map((r) => toCartLine(r, 1, "search"));
}

/**
 * Step 2, stubbed until week 9.
 *
 * The shape is fixed now because the sale screen is built against it: run the
 * frame through on-device CLIP, cosine-compare against `product_embeddings`,
 * return the top candidates above VISION_THRESHOLDS.show. Until the model
 * ships this returns nothing, and the UI falls through to search — which is
 * exactly what should happen if vision is ever cut.
 */
export async function findByVision(_frame: ArrayBuffer): Promise<CartLine[]> {
  return [];
}
