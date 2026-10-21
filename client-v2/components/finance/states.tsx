import Link from "next/link";
import { Lock, RotateCw } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Illustration } from "@/components/taggify/illustration";

/** Shown when the signed-in role can't use this screen. The server refuses the data anyway; this explains it. */
export function NoAccess({ what, hint = "Ask an admin if you need it." }: { what: string; hint?: string }) {
  return (
    <div className="mx-auto mt-16 flex max-w-md flex-col items-center gap-3 text-center">
      <span className="grid h-14 w-14 place-items-center rounded-card bg-brand-soft text-brand-ink">
        <Lock className="h-6 w-6" aria-hidden />
      </span>
      <h1 className="text-h3 font-bold">You don&apos;t have access to {what}</h1>
      <p className="text-body text-muted-foreground">{hint}</p>
      <Button asChild variant="outline" className="mt-2">
        <Link href="/dashboard">Go to Home</Link>
      </Button>
    </div>
  );
}

export function LoadError({ onRetry, what = "this list" }: { onRetry: () => void; what?: string }) {
  return (
    <div className="flex flex-col items-center gap-3 px-5 py-12 text-center" role="alert">
      <Illustration name="error-state" className="h-24 w-auto" />
      <p className="text-body text-fg-strong">Couldn&apos;t load {what}. Check your connection, then try again.</p>
      <Button variant="outline" size="sm" onClick={onRetry}>
        <RotateCw />
        Try again
      </Button>
    </div>
  );
}
