"use client";

import Link from "next/link";

import { Note } from "@/components/ui/note";
import { useAuth } from "@/lib/auth-context";

/**
 * Shown on every AppShell page to an account still signing in by phone
 * number (email 2FA, 21 Sep) — it only gets a couple of those before login
 * refuses to issue a session without a verified email, so the prompt has to
 * be somewhere it can't be missed, not buried in the profile.
 *
 * Strictly `=== false`: a session stored before emailVerified existed has
 * it undefined until its next token refresh, and shouldn't flash a warning
 * off a missing field.
 */
export function EmailVerifyBanner({ hidden }: { hidden?: boolean }) {
  const { user } = useAuth();
  if (hidden || user?.emailVerified !== false) return null;

  return (
    <Note
      tone="warn"
      className="mb-4 md:mb-5"
      action={
        <Link href="/verify-email" className="shrink-0 whitespace-nowrap font-semibold underline underline-offset-2">
          Verify email
        </Link>
      }
    >
      <span className="font-semibold">Verify your email to keep access.</span> Only 2 sign-ins are allowed without one — after that you&apos;ll need it to get in.
    </Note>
  );
}
