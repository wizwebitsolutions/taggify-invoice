"use client";

import { createContext, useContext, useEffect, useState, type ReactNode } from "react";

import { auth, type User } from "@/lib/api-client";

const STORAGE_KEY = "taggify_auth";

interface StoredAuth {
  user: User;
  accessToken: string;
  refreshToken: string;
}

interface AuthContextValue {
  user: User | null;
  accessToken: string | null;
  /** True until the initial localStorage read completes — avoids a login-page flash. */
  isLoading: boolean;
  login: (phoneNumber: string, password: string) => Promise<void>;
  logout: () => void;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [stored, setStored] = useState<StoredAuth | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) setStored(JSON.parse(raw));
    } catch {
      // corrupted/blocked storage — fall through to logged-out state
    }
    setIsLoading(false);
  }, []);

  async function login(phoneNumber: string, password: string) {
    const result = await auth.login(phoneNumber, password);
    const next: StoredAuth = { user: result.user, accessToken: result.accessToken, refreshToken: result.refreshToken };
    setStored(next);
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
    } catch {
      // best-effort; session still works for this tab via state
    }
  }

  function logout() {
    // best-effort server-side revoke — UI logs out regardless of the result
    if (stored?.refreshToken) {
      auth.logout(stored.refreshToken).catch(() => {});
    }
    setStored(null);
    try {
      localStorage.removeItem(STORAGE_KEY);
    } catch {
      // ignore
    }
  }

  return (
    <AuthContext.Provider
      value={{
        user: stored?.user ?? null,
        accessToken: stored?.accessToken ?? null,
        isLoading,
        login,
        logout,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used inside <AuthProvider>");
  return ctx;
}
