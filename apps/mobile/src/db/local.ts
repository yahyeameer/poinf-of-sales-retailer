import * as SQLite from "expo-sqlite";

/**
 * The device's local mirror.
 *
 * Two jobs: serve the sale screen with zero network calls, and hold sales that
 * haven't reached the server yet. Everything here is disposable *except*
 * `pending_sales` — the catalog can always be re-pulled, but a queued sale
 * exists nowhere else in the world until it syncs.
 */

let database: SQLite.SQLiteDatabase | null = null;

export async function openLocalDb(): Promise<SQLite.SQLiteDatabase> {
  if (database) return database;

  database = await SQLite.openDatabaseAsync("aipos.db");

  // WAL: the sync worker writes while the sale screen reads, and without it
  // they block each other mid-checkout.
  await database.execAsync("PRAGMA journal_mode = WAL;");
  await database.execAsync("PRAGMA foreign_keys = ON;");

  await migrate(database);
  return database;
}

async function migrate(db: SQLite.SQLiteDatabase): Promise<void> {
  const row = await db.getFirstAsync<{ user_version: number }>("PRAGMA user_version;");
  const version = row?.user_version ?? 0;

  if (version < 1) {
    await db.execAsync(`
      -- Catalog mirror. Rebuilt wholesale on login; patched by realtime after.
      CREATE TABLE IF NOT EXISTS products (
        id             TEXT PRIMARY KEY,
        tenant_id      TEXT NOT NULL,
        name           TEXT NOT NULL,
        barcode        TEXT,
        sku            TEXT,
        price_cents    INTEGER NOT NULL,
        unit           TEXT NOT NULL DEFAULT 'each',
        stock_on_hand  REAL NOT NULL DEFAULT 0,
        is_active      INTEGER NOT NULL DEFAULT 1,
        updated_at     TEXT
      );

      -- The index the whole barcode path exists for. Lookup must be instant and
      -- offline; everything else in the scan flow is a fallback from here.
      CREATE INDEX IF NOT EXISTS products_barcode_idx ON products (barcode)
        WHERE barcode IS NOT NULL;
      CREATE INDEX IF NOT EXISTS products_name_idx ON products (name);

      -- CLIP vectors, stored as raw float32 BLOBs. A 2,000-SKU shop is ~4MB.
      CREATE TABLE IF NOT EXISTS product_embeddings (
        product_id TEXT NOT NULL,
        image_id   TEXT,
        embedding  BLOB NOT NULL,
        PRIMARY KEY (product_id, image_id)
      );

      -- Sales rung up on this device. Rows survive until the server confirms.
      CREATE TABLE IF NOT EXISTS pending_sales (
        client_id       TEXT PRIMARY KEY,
        tenant_id       TEXT NOT NULL,
        payload         TEXT NOT NULL,   -- JSON, exactly as process_sale wants it
        total_cents     INTEGER NOT NULL,
        created_at      TEXT NOT NULL,
        status          TEXT NOT NULL DEFAULT 'pending',
                        -- pending | syncing | synced | rejected
        attempts        INTEGER NOT NULL DEFAULT 0,
        last_attempt_at TEXT,
        last_error      TEXT,
        error_code      TEXT,
        server_sale_id  TEXT
      );

      CREATE INDEX IF NOT EXISTS pending_sales_status_idx
        ON pending_sales (status, created_at);

      -- Optimistic local stock, so a cashier scanning the same item repeatedly
      -- offline still sees the count fall.
      CREATE TABLE IF NOT EXISTS local_stock_deltas (
        product_id TEXT NOT NULL,
        client_id  TEXT NOT NULL,
        delta      REAL NOT NULL,
        PRIMARY KEY (product_id, client_id)
      );

      CREATE TABLE IF NOT EXISTS sync_state (
        key   TEXT PRIMARY KEY,
        value TEXT
      );

      PRAGMA user_version = 1;
    `);
  }
}

export async function getSyncState(key: string): Promise<string | null> {
  const db = await openLocalDb();
  const row = await db.getFirstAsync<{ value: string }>(
    "SELECT value FROM sync_state WHERE key = ?",
    [key],
  );
  return row?.value ?? null;
}

export async function setSyncState(key: string, value: string): Promise<void> {
  const db = await openLocalDb();
  await db.runAsync(
    "INSERT INTO sync_state (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
    [key, value],
  );
}

/**
 * Signing out drops the catalog but deliberately keeps `pending_sales`.
 *
 * If a shop signs out with sales still queued, those sales are real money that
 * has already changed hands. They stay on the device until they sync, even
 * though nobody can see them in the meantime.
 */
export async function clearCatalogOnSignOut(): Promise<void> {
  const db = await openLocalDb();
  await db.execAsync(`
    DELETE FROM products;
    DELETE FROM product_embeddings;
    DELETE FROM sync_state WHERE key <> 'pending_warning_shown';
  `);
}

export async function countPendingSales(): Promise<number> {
  const db = await openLocalDb();
  const row = await db.getFirstAsync<{ n: number }>(
    "SELECT COUNT(*) AS n FROM pending_sales WHERE status IN ('pending', 'syncing')",
  );
  return row?.n ?? 0;
}
