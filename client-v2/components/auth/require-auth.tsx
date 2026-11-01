"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

import { SessionLoader } from "@/components/auth/session-loader";
import { useAuth } from "@/lib/auth-context";

/**
 * Client-side route guard: redirects to /login when there is no session, once
 * the initial localStorage read has settled (isLoading avoids a false redirect
 * on first paint). UI only — every server route checks the role itself.
 */
export function RequireAuth({ children }: { children: React.ReactNode }) {
  const { user, isLoading } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (!isLoading && !user) router.replace("/login");
  }, [isLoading, user, router]);

  if (isLoading || !user) return <SessionLoader />;

  return <>{children}</>;
}
