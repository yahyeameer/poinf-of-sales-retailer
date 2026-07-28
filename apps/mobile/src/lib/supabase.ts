import "react-native-url-polyfill/auto";
import AsyncStorage from "@react-native-async-storage/async-storage";
import * as SecureStore from "expo-secure-store";
import { createClient } from "@supabase/supabase-js";

/**
 * Session storage.
 *
 * SecureStore is hardware-backed but caps values at 2048 bytes, and a Supabase
 * session with a fat JWT can exceed that. So: refresh token in SecureStore,
 * the rest in AsyncStorage. Losing the AsyncStorage half only forces a token
 * refresh; losing the SecureStore half is what would sign the shop out.
 */
const SECURE_KEY_PREFIX = "sb-secure-";

const hybridStorage = {
  async getItem(key: string): Promise<string | null> {
    const secure = await SecureStore.getItemAsync(SECURE_KEY_PREFIX + hash(key));
    if (secure) return secure;
    return AsyncStorage.getItem(key);
  },
  async setItem(key: string, value: string): Promise<void> {
    if (value.length < 2000) {
      await SecureStore.setItemAsync(SECURE_KEY_PREFIX + hash(key), value);
      await AsyncStorage.removeItem(key);
      return;
    }
    await AsyncStorage.setItem(key, value);
  },
  async removeItem(key: string): Promise<void> {
    await SecureStore.deleteItemAsync(SECURE_KEY_PREFIX + hash(key));
    await AsyncStorage.removeItem(key);
  },
};

/** SecureStore keys must be alphanumeric plus ._-; Supabase's contain colons. */
function hash(key: string): string {
  return key.replace(/[^A-Za-z0-9._-]/g, "_");
}

export const supabase = createClient(
  process.env.EXPO_PUBLIC_SUPABASE_URL!,
  process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY!,
  {
    auth: {
      storage: hybridStorage,
      autoRefreshToken: true,
      persistSession: true,
      // No URL to detect in a native app, and leaving it on makes the client
      // touch window.location, which doesn't exist here.
      detectSessionInUrl: false,
    },
    global: {
      // A till on 4G that has dropped should fail fast and queue, not hang for
      // 30 seconds with a customer waiting.
      fetch: (input, init) =>
        fetch(input, { ...init, signal: AbortSignal.timeout(8000) }),
    },
  },
);

/** Reads tenant_id straight off the JWT rather than re-querying for it. */
export function tenantIdFromSession(accessToken: string | undefined): string | null {
  if (!accessToken) return null;
  try {
    const payload = accessToken.split(".")[1];
    if (!payload) return null;
    const json = JSON.parse(
      decodeBase64(payload.replace(/-/g, "+").replace(/_/g, "/")),
    );
    return json.tenant_id ?? null;
  } catch {
    return null;
  }
}

function decodeBase64(value: string): string {
  // Hermes has atob; keep the fallback for older runtimes.
  if (typeof atob === "function") return atob(value);
  return Buffer.from(value, "base64").toString("utf8");
}
