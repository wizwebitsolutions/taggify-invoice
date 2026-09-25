"use client";

import { createContext, useContext, useEffect, useState, type ReactNode } from "react";

import { auth, AUTH_STORAGE_KEY, type AuthResponse, type LoginResult, type User, users as usersApi } from "@/lib/api-client";

const STORAGE_KEY = AUTH_STORAGE_KEY;

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
  /** Password step only (email 2FA, 21 Sep). Signs in when the server says
   *  AUTHENTICATED; for any other step the caller walks the user through it
   *  and finishes with adoptSession(). */
  login: (email: string, password: string) => Promise<LoginResult>;
  /** Installs a session the server issued outside login() — OTP verified, or email just verified. */
  adoptSession: (session: AuthResponse) => void;
  logout: () => void;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [stored, setStored] = useState<StoredAuth | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    function readFromStorage() {
      try {
        const raw = localStorage.getItem(STORAGE_KEY);
        setStored(raw ? JSON.parse(raw) : null);
      } catch {
        // corrupted/blocked storage — fall through to logged-out state
        setStored(null);
      }
    }

    readFromStorage();
    setIsLoading(false);

    // api-client's background token refresh (or a forced logout when the
    // refresh token itself is dead) writes localStorage directly, outside
    // React — this is how that becomes visible here instead of this
    // context silently holding an access token api-client has already
    // replaced or cleared.
    window.addEventListener("taggify:auth-sync", readFromStorage);

    // Cross-tab: the native "storage" event fires in *other* tabs whenever
    // one tab writes this key (login, logout, or a background refresh).
    // Without this, a second open tab never learns its session was rotated
    // until its own access token expires and it races the first tab to
    // redeem the same (now single-use) refresh token — the loser looked
    // logged out until a manual sign-out/sign-in. Picking up the rotated
    // pair here as soon as it happens avoids that race in the first place.
    function onStorage(e: StorageEvent) {
      if (e.key === STORAGE_KEY) readFromStorage();
    }
    window.addEventListener("storage", onStorage);

    return () => {
      window.removeEventListener("taggify:auth-sync", readFromStorage);
      window.removeEventListener("storage", onStorage);
    };
  }, []);

  // Fresh access (24 Sep): an admin can switch a section off for a creator /
  // planner at any time — re-read the user's access on load and when the tab
  // regains focus, so the nav follows without waiting for the next token
  // refresh (the server enforces it immediately either way). Only merged when
  // it's the same account and role as the stored session.
  const accessToken = stored?.accessToken;
  const storedUserId = stored?.user?.id;
  const storedRole = stored?.user?.role;
  useEffect(() => {
    if (!accessToken || !storedUserId) return;
    let cancelled = false;
    async function syncAccess() {
      try {
        const me = await usersApi.me(accessToken!);
        if (cancelled || me.id !== storedUserId || me.role !== storedRole) return;
        setStored((prev) => {
          if (!prev?.user) return prev;
          const next = { ...prev, user: { ...prev.user, permissions: me.permissions ?? prev.user.permissions, ownAccess: me.ownAccess ?? prev.user.ownAccess } };
          try {
            localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
          } catch {
            // best-effort
          }
          return next;
        });
      } catch {
        // offline / expired — the normal refresh path handles it
      }
    }
    syncAccess();
    window.addEventListener("focus", syncAccess);
    return () => {
      cancelled = true;
      window.removeEventListener("focus", syncAccess);
    };
  }, [accessToken, storedUserId, storedRole]);

  function adoptSession(session: AuthResponse) {
    const next: StoredAuth = { user: session.user, accessToken: session.accessToken, refreshToken: session.refreshToken };
    setStored(next);
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
    } catch {
      // best-effort; session still works for this tab via state
    }
  }

  async function login(email: string, password: string) {
    const result = await auth.login(email, password);
    if (result.step === "AUTHENTICATED") adoptSession(result);
    return result;
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
        adoptSession,
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
