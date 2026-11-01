"use client";

import { useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { ExternalLink, RotateCw } from "lucide-react";

import { useAuth } from "@/lib/auth-context";
import { integrations } from "@/lib/api-client";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { StatusPill } from "@/components/taggify/status-pill";
import { LoadError } from "@/components/finance/states";

/**
 * Google Sheets (admins): the one Google account the app uses to create plan
 * sheets and the execution-sheet template. GET /integrations/google/status says
 * whether it's set up, connected and still working; Connect runs Google's
 * consent in a new tab (/authorize takes the token as a query param and only
 * accepts an ADMIN). Status is re-checked when you come back to this tab.
 */
export function GoogleTab() {
  const { accessToken } = useAuth();
  const status = useQuery({ queryKey: ["googleStatus"], queryFn: () => integrations.googleStatus(accessToken!), enabled: !!accessToken });

  const { refetch } = status;
  useEffect(() => {
    const onFocus = () => refetch();
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, [refetch]);

  const s = status.data;
  const state = !s ? null : !s.configured ? "unconfigured" : !s.connected ? "disconnected" : !s.healthy ? "expired" : "ok";
  const copy = {
    unconfigured: { tone: "neutral", pill: "Not set up", text: "The server doesn't have Google sign-in keys yet. A developer needs to add them before an account can be connected." },
    disconnected: { tone: "warning", pill: "Not connected", text: "Connect a Google account so plans can create their client sheets." },
    expired: { tone: "danger", pill: "Needs reconnecting", text: "The connected account stopped working (access was removed or expired). Plan sheets will fail until you reconnect it." },
    ok: { tone: "success", pill: "Connected", text: "Plan sheets are created with this account. It only edits sheets the app created." },
  } as const;

  return (
    <section aria-labelledby="google-title" className="flex flex-col gap-5 border-t p-6">
      <div>
        <h2 id="google-title" className="text-card-title">
          Google Sheets
        </h2>
        <p className="mt-1 text-small text-muted-foreground">The Google account used to create plan sheets.</p>
      </div>
      {status.isError ? (
        <LoadError onRetry={() => status.refetch()} what="the Google connection" />
      ) : !state ? (
        <Skeleton className="h-20 max-w-xl" aria-label="Checking the Google connection" />
      ) : (
        <div className="flex max-w-xl flex-col gap-4 rounded-card border border-input bg-muted/40 p-5">
          <StatusPill className="self-start" tone={copy[state].tone}>
            {copy[state].pill}
          </StatusPill>
          <p className="text-body text-fg-strong">{copy[state].text}</p>
          <div className="flex flex-wrap gap-2">
            {state !== "unconfigured" && accessToken && (
              <Button variant={state === "ok" ? "outline" : "default"} onClick={() => window.open(integrations.googleAuthorizeUrl(accessToken), "_blank", "noopener,noreferrer")}>
                {state === "disconnected" ? "Connect Google" : state === "ok" ? "Switch account" : "Reconnect Google"}
                <ExternalLink aria-hidden />
              </Button>
            )}
            <Button variant="ghost" onClick={() => status.refetch()} disabled={status.isFetching}>
              <RotateCw aria-hidden />
              {status.isFetching ? "Checking…" : "Check again"}
            </Button>
          </div>
          {state !== "unconfigured" && <p className="text-small text-muted-foreground">Finish Google&apos;s consent in the new tab, then come back here.</p>}
        </div>
      )}
    </section>
  );
}
