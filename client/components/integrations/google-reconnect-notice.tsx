"use client";

import { Button } from "@/components/ui/button";
import { ErrorNotice } from "@/components/ui/table-parts";
import { ApiError, integrations, needsGoogleReconnect } from "@/lib/api-client";
import { useAuth } from "@/lib/auth-context";

/**
 * The error notice for anything that needs the connected Google account
 * (plan sheets, the execution-sheet template). When the failure is the
 * connection itself — expired/revoked refresh token, or never connected
 * (user report, 22 Sep: every sheet action said "Something went wrong") —
 * an Admin gets a Reconnect Google button that runs the consent flow in a
 * new tab; anyone else is told to ask an admin. Any other error shows as
 * before.
 */
export function GoogleAwareError({ error, fallback }: { error: unknown; fallback: string }) {
  const { user, accessToken } = useAuth();
  if (!(error instanceof Error)) return null;
  const message = error instanceof ApiError ? error.message : fallback;
  if (!needsGoogleReconnect(error)) return <ErrorNotice message={message} />;
  const isAdmin = user?.role === "ADMIN";
  return (
    <div className="flex flex-col gap-2 rounded-md border border-rose/30 bg-rose-soft px-3 py-2.5 text-[0.8125rem]" data-testid="google-reconnect-notice">
      <p className="text-rose">{message}</p>
      {isAdmin && accessToken ? (
        <div>
          <Button size="sm" variant="secondary" onClick={() => window.open(integrations.googleAuthorizeUrl(accessToken), "_blank", "noopener,noreferrer")}>
            Reconnect Google ↗
          </Button>
          <p className="mt-1 text-[0.72rem] text-text-faint">Finish the Google consent in the new tab, then try again here.</p>
        </div>
      ) : (
        <p className="text-[0.72rem] text-text-faint">Ask an admin to reconnect the Google account from the Plans page.</p>
      )}
    </div>
  );
}
