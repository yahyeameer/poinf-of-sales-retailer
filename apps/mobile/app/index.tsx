import { useCallback, useEffect, useMemo, useState } from "react";
import { Redirect } from "expo-router";
import { CameraView, useCameraPermissions } from "expo-camera";
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import type { CartLine, PaymentMethod } from "@ai-pos/shared";
import { addScan, computeTotals, formatMoney, setQuantity } from "@ai-pos/shared";

import { findByBarcode, searchByName } from "@/lookup/scan";
import { useSession } from "@/state/session";
import { commitSaleLocally } from "@/sync/queue";
import { theme } from "@/ui/theme";

/**
 * The sale screen. Flow B, target under 8 seconds per item.
 *
 * The camera is always live and always the default view — the fastest sale is
 * the one where the cashier does nothing but point. Search is there for when
 * recognition fails, not as the primary path.
 */
export default function SaleScreen() {
  const { session, tenant, tenantId, ready, pendingCount, refreshPending } = useSession();
  const [permission, requestPermission] = useCameraPermissions();

  const [lines, setLines] = useState<CartLine[]>([]);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<CartLine[]>([]);
  const [lastScan, setLastScan] = useState<string | null>(null);
  const [charging, setCharging] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const totals = useMemo(
    () =>
      computeTotals(lines, {
        rate: tenant?.taxRate ?? 0,
        inclusive: tenant?.taxInclusive ?? true,
      }),
    [lines, tenant],
  );

  const onBarcode = useCallback(
    async ({ data }: { data: string }) => {
      // The scanner fires many times a second on the same code; ignore repeats
      // until the cashier moves to a different product.
      if (data === lastScan) return;
      setLastScan(data);
      setTimeout(() => setLastScan(null), 1500);

      const line = await findByBarcode(data);

      if (!line) {
        setMessage(`Unknown barcode ${data}. Search for it, or add it in the catalog.`);
        return;
      }

      setMessage(null);
      setLines((current) => addScan(current, line));
    },
    [lastScan],
  );

  useEffect(() => {
    if (query.trim().length < 2) {
      setResults([]);
      return;
    }
    let cancelled = false;
    void searchByName(query).then((rows) => {
      if (!cancelled) setResults(rows);
    });
    return () => {
      cancelled = true;
    };
  }, [query]);

  async function charge(method: PaymentMethod) {
    if (lines.length === 0 || !tenantId) return;

    setCharging(true);
    try {
      await commitSaleLocally(tenantId, lines, method, totals.totalCents, totals.discountCents);

      setLines([]);
      setQuery("");
      setMessage(`Sale recorded · ${formatMoney(totals.totalCents, tenant?.currency ?? "USD")}`);
      await refreshPending();
    } catch (err) {
      // Local commit failing means the disk write failed — genuinely bad, and
      // the cashier needs to know before the customer walks away.
      setMessage(`Could not record the sale: ${String(err)}`);
    } finally {
      setCharging(false);
    }
  }

  if (!ready) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator color={theme.accentText} />
      </View>
    );
  }

  if (!session) return <Redirect href="/login" />;

  if (!tenantId) {
    return (
      <SafeAreaView style={styles.safe}>
        <View style={styles.centered}>
          <Text style={styles.title}>No shop yet</Text>
          <Text style={styles.muted}>
            Finish setting up on the web dashboard, then sign in again here.
          </Text>
        </View>
      </SafeAreaView>
    );
  }

  const currency = tenant?.currency ?? "USD";

  return (
    <SafeAreaView style={styles.safe}>
      <View style={styles.header}>
        <Text style={styles.shopName}>{tenant?.name ?? "Sale"}</Text>
        {pendingCount > 0 && (
          <Text style={styles.pending}>{pendingCount} waiting to sync</Text>
        )}
      </View>

      <View style={styles.camera}>
        {permission?.granted ? (
          <CameraView
            style={StyleSheet.absoluteFill}
            barcodeScannerSettings={{
              barcodeTypes: ["ean13", "ean8", "upc_a", "upc_e", "code128", "code39", "itf14"],
            }}
            onBarcodeScanned={onBarcode}
          />
        ) : (
          <Pressable style={styles.permission} onPress={requestPermission}>
            <Text style={styles.permissionText}>
              {permission ? "Allow camera access to scan" : "Checking camera…"}
            </Text>
          </Pressable>
        )}
      </View>

      {message ? <Text style={styles.message}>{message}</Text> : null}

      <TextInput
        style={styles.search}
        placeholder="Or search by name"
        placeholderTextColor={theme.muted}
        value={query}
        onChangeText={setQuery}
        autoCapitalize="none"
      />

      {results.length > 0 && (
        <FlatList
          style={styles.results}
          data={results}
          keyExtractor={(item) => item.productId}
          keyboardShouldPersistTaps="handled"
          renderItem={({ item }) => (
            <Pressable
              style={styles.resultRow}
              onPress={() => {
                setLines((current) => addScan(current, item));
                setQuery("");
              }}
            >
              <Text style={styles.resultName}>{item.name}</Text>
              <Text style={styles.resultPrice}>
                {formatMoney(item.unitPriceCents, currency)}
              </Text>
            </Pressable>
          )}
        />
      )}

      <FlatList
        style={styles.cart}
        data={lines}
        keyExtractor={(item) => item.productId}
        ListEmptyComponent={
          <Text style={styles.empty}>Point the camera at a product to start.</Text>
        }
        renderItem={({ item }) => (
          <View style={styles.cartRow}>
            <View style={styles.cartInfo}>
              <Text style={styles.cartName}>{item.name}</Text>
              <Text style={styles.cartMeta}>
                {item.quantity} × {formatMoney(item.unitPriceCents, currency)}
              </Text>
            </View>
            <Text style={styles.cartTotal}>
              {formatMoney(Math.round(item.quantity * item.unitPriceCents), currency)}
            </Text>
            <Pressable
              style={styles.remove}
              onPress={() => setLines((c) => setQuantity(c, item.productId, 0))}
            >
              <Text style={styles.removeText}>×</Text>
            </Pressable>
          </View>
        )}
      />

      <View style={styles.footer}>
        <View style={styles.totalRow}>
          <Text style={styles.totalLabel}>Total</Text>
          <Text style={styles.totalValue}>{formatMoney(totals.totalCents, currency)}</Text>
        </View>

        <View style={styles.payments}>
          {(["cash", "mobile_money", "card"] as const).map((method) => (
            <Pressable
              key={method}
              style={[
                styles.payButton,
                (lines.length === 0 || charging) && styles.payButtonDisabled,
              ]}
              disabled={lines.length === 0 || charging}
              onPress={() => charge(method)}
            >
              <Text style={styles.payText}>
                {method === "mobile_money" ? "Mobile" : method === "card" ? "Card" : "Cash"}
              </Text>
            </Pressable>
          ))}
        </View>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: theme.bg },
  centered: { flex: 1, alignItems: "center", justifyContent: "center", padding: 24, gap: 8 },
  title: { fontSize: 20, fontWeight: "600", color: theme.text },
  muted: { color: theme.muted, textAlign: "center" },

  header: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingHorizontal: 16,
    paddingVertical: 10,
  },
  shopName: { color: theme.text, fontSize: 16, fontWeight: "600" },
  pending: { color: theme.warn, fontSize: 12 },

  camera: {
    height: 190,
    marginHorizontal: 16,
    borderRadius: theme.radius,
    overflow: "hidden",
    backgroundColor: "#000",
  },
  permission: { flex: 1, alignItems: "center", justifyContent: "center" },
  permissionText: { color: theme.muted },

  message: { color: theme.warn, fontSize: 13, paddingHorizontal: 16, paddingTop: 10 },

  search: {
    margin: 16,
    marginBottom: 8,
    backgroundColor: theme.surface,
    borderWidth: 1,
    borderColor: theme.border,
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 11,
    color: theme.text,
    fontSize: 15,
  },
  results: { maxHeight: 180, marginHorizontal: 16 },
  resultRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    paddingVertical: 11,
    borderBottomWidth: 1,
    borderBottomColor: theme.border,
  },
  resultName: { color: theme.text, fontSize: 15, flex: 1 },
  resultPrice: { color: theme.muted, fontSize: 15 },

  cart: { flex: 1, marginHorizontal: 16 },
  empty: { color: theme.muted, textAlign: "center", paddingVertical: 32, fontSize: 14 },
  cartRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: theme.border,
  },
  cartInfo: { flex: 1 },
  cartName: { color: theme.text, fontSize: 15 },
  cartMeta: { color: theme.muted, fontSize: 13, marginTop: 2 },
  cartTotal: { color: theme.text, fontSize: 15, fontVariant: ["tabular-nums"] },
  remove: { paddingHorizontal: 12, paddingVertical: 4 },
  removeText: { color: theme.muted, fontSize: 22 },

  footer: {
    borderTopWidth: 1,
    borderTopColor: theme.border,
    padding: 16,
    backgroundColor: theme.surface,
  },
  totalRow: { flexDirection: "row", justifyContent: "space-between", marginBottom: 14 },
  totalLabel: { color: theme.muted, fontSize: 15 },
  totalValue: {
    color: theme.text,
    fontSize: 26,
    fontWeight: "700",
    fontVariant: ["tabular-nums"],
  },
  payments: { flexDirection: "row", gap: 8 },
  payButton: {
    flex: 1,
    backgroundColor: theme.accent,
    borderRadius: 10,
    paddingVertical: 16,
    alignItems: "center",
  },
  payButtonDisabled: { opacity: 0.4 },
  payText: { color: "#fff", fontSize: 15, fontWeight: "600" },
});
