import type { CartLine, PaymentMethod } from "@ai-pos/shared";
import { POS_ERROR, toSalePayload } from "@ai-pos/shared";

import { openLocalDb } from "@/db/local";
import { supabase } from "@/lib/supabase";

/**
 * The sync queue.
 *
 * Rules that hold no matter what:
 *   1. A sale is committed locally before any network call. The customer has
 *      already paid; the network is not allowed a vote.
 *   2. Every sale carries a client_id from birth. The server is idempotent on
 *      it, so retrying is always safe — which is what lets rule 1 work.
 *   3. A rejected sale is flagged, never deleted. The one failure mode worth
 *      being paranoid about is a shop losing money without knowing it did.
 */

const MAX_ATTEMPTS = 12;
const BATCH_SIZE = 50;

export interface QueuedSale {
  clientId: string;
  totalCents: number;
  createdAt: string;
  status: "pending" | "syncing" | "synced" | "rejected";
  attempts: number;
  lastError: string | null;
  errorCode: string | null;
}

/** 26 chars of crypto-random, enough that two offline devices won't collide. */
function newClientId(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

/**
 * Step 1 of the write path: commit locally, decrement stock optimistically,
 * enqueue. Returns as soon as it's on disk — the cashier moves on.
 */
export async function commitSaleLocally(
  tenantId: string,
  lines: readonly CartLine[],
  paymentMethod: PaymentMethod,
  totalCents: number,
  discountCents = 0,
): Promise<string> {
  const db = await openLocalDb();
  const clientId = newClientId();
  const createdAt = new Date();
  const payload = toSalePayload(lines, clientId, paymentMethod, discountCents, createdAt);

  await db.withTransactionAsync(async () => {
    await db.runAsync(
      `INSERT INTO pending_sales (client_id, tenant_id, payload, total_cents, created_at, status)
       VALUES (?, ?, ?, ?, ?, 'pending')`,
      [clientId, tenantId, JSON.stringify(payload), totalCents, createdAt.toISOString()],
    );

    for (const line of lines) {
      await db.runAsync(
        `INSERT INTO local_stock_deltas (product_id, client_id, delta) VALUES (?, ?, ?)
         ON CONFLICT(product_id, client_id) DO UPDATE SET delta = delta + excluded.delta`,
        [line.productId, clientId, -line.quantity],
      );
      await db.runAsync(
        "UPDATE products SET stock_on_hand = stock_on_hand - ? WHERE id = ?",
        [line.quantity, line.productId],
      );
    }
  });

  // Fire and forget. If it fails, the sale is already safe on disk.
  void drainQueue();

  return clientId;
}

/**
 * Step 2: push everything pending. Safe to call whenever — on app resume, when
 * connectivity returns, on a timer, after a sale. Concurrent calls are guarded.
 */
let draining = false;

export async function drainQueue(): Promise<{ synced: number; rejected: number } | null> {
  if (draining) return null;
  draining = true;

  try {
    const db = await openLocalDb();

    const rows = await db.getAllAsync<{
      client_id: string;
      payload: string;
      attempts: number;
    }>(
      `SELECT client_id, payload, attempts FROM pending_sales
       WHERE status IN ('pending', 'syncing') AND attempts < ?
       ORDER BY created_at ASC LIMIT ?`,
      [MAX_ATTEMPTS, BATCH_SIZE],
    );

    if (rows.length === 0) return { synced: 0, rejected: 0 };

    await db.runAsync(
      `UPDATE pending_sales SET status = 'syncing', last_attempt_at = ?
       WHERE client_id IN (${rows.map(() => "?").join(",")})`,
      [new Date().toISOString(), ...rows.map((r) => r.client_id)],
    );

    const { data, error } = await supabase.functions.invoke("process-sale", {
      body: { sales: rows.map((r) => JSON.parse(r.payload)) },
    });

    // Network failure. Not the sale's fault — put it back and try again later.
    if (error) {
      await db.runAsync(
        `UPDATE pending_sales
         SET status = 'pending', attempts = attempts + 1, last_error = ?
         WHERE client_id IN (${rows.map(() => "?").join(",")})`,
        [String(error.message ?? error), ...rows.map((r) => r.client_id)],
      );
      return null;
    }

    let synced = 0;
    let rejected = 0;

    // Which sales the server actually spoke about. Every row in this batch was
    // moved to 'syncing' above, and only an outcome moves it out again — so a
    // sale the response skips would sit in 'syncing' forever: re-selected on
    // every drain (the query takes 'syncing' too), never incrementing attempts,
    // never reaching MAX_ATTEMPTS, and therefore never appearing in
    // listProblemSales(). Silent, unbounded, and invisible to the owner, which
    // is exactly the failure rule 3 exists to prevent.
    //
    // The server can skip one: a sale that reaches it without a client_id is
    // reported against the literal "unknown", so the real row hears nothing
    // back. A truncated or partial response does the same to the tail of the
    // batch.
    const answered = new Set<string>();

    for (const result of data?.results ?? []) {
      answered.add(result.client_id);

      if (result.status === "ok") {
        synced++;
        await db.withTransactionAsync(async () => {
          await db.runAsync(
            "UPDATE pending_sales SET status = 'synced', server_sale_id = ?, last_error = NULL WHERE client_id = ?",
            [result.sale_id, result.client_id],
          );
          // The server's stock is authoritative now; drop our optimistic delta.
          await db.runAsync("DELETE FROM local_stock_deltas WHERE client_id = ?", [
            result.client_id,
          ]);
        });
        continue;
      }

      rejected++;

      // PS422 means the shop had already sold it. The sale still happened —
      // money changed hands — so it is flagged for the owner, not discarded.
      const terminal =
        result.code === POS_ERROR.UNPROCESSABLE || result.code === POS_ERROR.NOT_FOUND;

      await db.runAsync(
        `UPDATE pending_sales
         SET status = ?, attempts = attempts + 1, last_error = ?, error_code = ?
         WHERE client_id = ?`,
        [
          terminal ? "rejected" : "pending",
          result.error ?? "Rejected",
          result.code ?? null,
          result.client_id,
        ],
      );
    }

    const unanswered = rows.map((r) => r.client_id).filter((id) => !answered.has(id));
    if (unanswered.length > 0) {
      // Back to 'pending' with the attempt counted, so these retry like any
      // other transient failure and eventually surface as problem sales rather
      // than spinning. Not terminal: we have no idea whether the server took
      // them, and process_sale() is idempotent on client_id, so retrying is
      // always safe and is the only answer that can't lose money.
      await db.runAsync(
        `UPDATE pending_sales
         SET status = 'pending', attempts = attempts + 1, last_error = ?
         WHERE client_id IN (${unanswered.map(() => "?").join(",")})`,
        ["The server did not report on this sale.", ...unanswered],
      );
    }

    return { synced, rejected };
  } finally {
    draining = false;
  }
}

/** Sales the owner needs to look at: rejected, or retried past the point of hope. */
export async function listProblemSales(): Promise<QueuedSale[]> {
  const db = await openLocalDb();
  const rows = await db.getAllAsync<{
    client_id: string;
    total_cents: number;
    created_at: string;
    status: QueuedSale["status"];
    attempts: number;
    last_error: string | null;
    error_code: string | null;
  }>(
    `SELECT client_id, total_cents, created_at, status, attempts, last_error, error_code
     FROM pending_sales
     WHERE status = 'rejected' OR attempts >= ?
     ORDER BY created_at DESC`,
    [MAX_ATTEMPTS],
  );

  return rows.map((r) => ({
    clientId: r.client_id,
    totalCents: r.total_cents,
    createdAt: r.created_at,
    status: r.status,
    attempts: r.attempts,
    lastError: r.last_error,
    errorCode: r.error_code,
  }));
}

/**
 * Housekeeping. Synced sales are kept for a week so a cashier can still reprint
 * a receipt from a day they were offline; older ones live on the server.
 */
export async function pruneSyncedSales(): Promise<void> {
  const db = await openLocalDb();
  const cutoff = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
  await db.runAsync("DELETE FROM pending_sales WHERE status = 'synced' AND created_at < ?", [
    cutoff,
  ]);
}
