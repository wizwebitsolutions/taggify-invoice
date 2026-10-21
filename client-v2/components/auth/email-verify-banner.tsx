"use client";

import Link from "next/link";

import { useAuth } from "@/lib/auth-context";

/**
 * Shown on every AppShell page to an account that hasn't verified an email yet
 * (v1 EmailVerifyBanner): it only gets a couple of sign-ins before login needs
 * a verified email, so the prompt can't be buried in the profile.
 * Strictly `=== false`: an older stored session has the field undefined until
 * its next refresh and shouldn't flash a warning.
 */
export function EmailVerifyBanner({ hidden }: { hidden?: boolean }) {
  const { user } = useAuth();
  if (hidden || user?.emailVerified !== false) return null;
  return (
    <div role="status" className="mb-4 flex flex-wrap items-center justify-between gap-x-4 gap-y-2 rounded-md bg-warning-soft px-4 py-3 text-small text-warning-fg">
      <p>
        <span className="font-semibold">Verify your email to keep access.</span> Only 2 sign-ins are allowed without one. After that you&apos;ll need it to get in.
      </p>
      <Link href="/verify-email" className="shrink-0 font-semibold underline underline-offset-2">
        Verify email
      </Link>
    </div>
  );
}
