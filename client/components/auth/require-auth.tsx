"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

import { useAuth } from "@/lib/auth-context";

/**
 * Client-side route guard. Every protected page wraps its content in
 * this — redirects to /login if there's no session once the initial
 * localStorage read has settled (isLoading avoids a false redirect on
 * first paint).
 */
export function RequireAuth({ children }: { children: React.ReactNode }) {
  const { user, isLoading } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (!isLoading && !user) router.replace("/login");
  }, [isLoading, user, router]);

  if (isLoading || !user) {
    return (
      <div className="flex h-screen items-center justify-center bg-bg text-text-faint">
        <p className="text-sm">Checking your session…</p>
      </div>
    );
  }

  return <>{children}</>;
}
