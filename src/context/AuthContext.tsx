import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
} from "react";
import { apiFetch, getToken, setToken } from "@/utils/api";

export interface Agent {
  id: number;
  first_name: string;
  last_name: string;
  name: string;
  email: string;
  role: string;
  /** Counter this account sells at, set by an admin. Null = cannot issue
   *  numbered tickets until one is assigned. */
  ticket_station: string | null;
}

interface AuthContextValue {
  agent: Agent | null;
  loading: boolean; // true while hydrating the persisted session on startup
  login: (
    email: string,
    password: string
  ) => Promise<{ ok: boolean; error?: string }>;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

export const AuthProvider = ({ children }: { children: React.ReactNode }) => {
  const [agent, setAgent] = useState<Agent | null>(null);
  const [loading, setLoading] = useState(true);

  // Rehydrate the session from a persisted token on app start.
  useEffect(() => {
    (async () => {
      const token = await getToken();
      if (!token) {
        setLoading(false);
        return;
      }
      try {
        const res = await apiFetch("/api/v1/auth/me");
        if (res.ok) setAgent(await res.json());
        else await setToken(null); // token expired/invalid — drop it
      } catch {
        /* server unreachable — leave the token, just no agent yet */
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const login = useCallback(async (email: string, password: string) => {
    try {
      const res = await apiFetch("/api/v1/auth/login", {
        method: "POST",
        body: JSON.stringify({ email, password }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        return { ok: false, error: body?.detail || "Invalid email or password" };
      }
      const data = await res.json();
      await setToken(data.token);
      setAgent(data.agent);
      return { ok: true };
    } catch {
      return { ok: false, error: "Could not reach the server" };
    }
  }, []);

  const logout = useCallback(async () => {
    try {
      await apiFetch("/api/v1/auth/logout", { method: "POST" });
    } catch {
      /* best-effort */
    }
    await setToken(null);
    setAgent(null);
  }, []);

  return (
    <AuthContext.Provider value={{ agent, loading, login, logout }}>
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within an AuthProvider");
  return ctx;
};
