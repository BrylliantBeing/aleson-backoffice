import AsyncStorage from "@react-native-async-storage/async-storage";

// Base host for the shared FastAPI backend. Request paths below already carry
// the `/api/v1` prefix, so this must be the host ONLY (no `/api/v1` suffix —
// unlike the website's EXPO_PUBLIC_API_BASE_URL, which bakes the prefix in).
// Override with EXPO_PUBLIC_API_BASE_URL to point at a local server.
export const API_BASE =
  process.env.EXPO_PUBLIC_API_BASE_URL ?? "https://aleson-shipping.com";

// Where the agent session token is persisted. AsyncStorage works across native
// and Expo web (localStorage); it is not encrypted at rest — acceptable for an
// internal tool. Swap to expo-secure-store on native if stronger storage is needed.
const TOKEN_KEY = "aleson.agent.token";

export async function getToken(): Promise<string | null> {
  try {
    return await AsyncStorage.getItem(TOKEN_KEY);
  } catch {
    return null;
  }
}

export async function setToken(token: string | null): Promise<void> {
  try {
    if (token) await AsyncStorage.setItem(TOKEN_KEY, token);
    else await AsyncStorage.removeItem(TOKEN_KEY);
  } catch {
    /* storage unavailable — ignore */
  }
}

/**
 * fetch wrapper that prefixes API_BASE and injects the agent bearer token.
 * Use for auth, the office booking submit, and the performance endpoints.
 */
export async function apiFetch(path: string, options: RequestInit = {}) {
  const token = await getToken();
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...((options.headers as Record<string, string>) ?? {}),
  };
  if (token) headers["Authorization"] = `Bearer ${token}`;
  const url = path.startsWith("http") ? path : `${API_BASE}${path}`;
  return fetch(url, { ...options, headers });
}
