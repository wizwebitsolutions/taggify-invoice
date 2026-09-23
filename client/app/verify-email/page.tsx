"use client";

import Link from "next/link";

import { RequireAuth } from "@/components/auth/require-auth";
import { AppShell } from "@/components/layout/app-shell";
import { EmailSetupFlow } from "@/components/auth/otp-steps";
import { Note } from "@/components/ui/note";
import { useAuth } from "@/lib/auth-context";
import { initialsOf, roleLabel } from "@/lib/format";

// Email 2FA (21 Sep) — where a signed-in account that hasn't verified an
// email yet does so (EmailVerifyBanner links here). The locked-out version
// of this same flow lives on /login, identified by challenge token instead
// of a session.
export default function VerifyEmailPage() {
  return (
    <RequireAuth>
      <VerifyEmailContent />
    </RequireAuth>
  );
}

function VerifyEmailContent() {
  const { user, accessToken, adoptSession } = useAuth();

  return (
    <AppShell
      active="profile"
      user={{ initials: initialsOf(user?.name), name: user?.name ?? "—", role: roleLabel(user?.role), tone: user?.role === "FINANCE" ? "blue" : "emerald" }}
      searchPlaceholder="Search…"
      hideEmailVerifyBanner
    >
      <div className="flex max-w-[440px] flex-col gap-7">
        <div>
          <p className="mb-1 text-[0.68rem] font-medium uppercase tracking-[0.06em] text-text-faint">Account</p>
          <h1 className="mb-1 text-[1.5rem] font-semibold leading-tight tracking-[-0.03em] md:text-[1.625rem]">Verify your email</h1>
          <p className="text-[0.875rem] text-text-muted">
            Two-step sign-in is required for every account. Once verified, you&apos;ll sign in with this email instead of your phone number, and we&apos;ll email you a code each time.
          </p>
        </div>

        {user?.emailVerified ? (
          <Note tone="ok" action={<Link href="/dashboard" className="shrink-0 font-semibold underline underline-offset-2">Go to dashboard</Link>}>
            <span className="font-semibold">{user.email}</span> is verified. Use it with your password next time you sign in.
          </Note>
        ) : (
          // adoptSession swaps in the session the server returns, whose user
          // is emailVerified — which flips this page to the branch above.
          <EmailSetupFlow identity={{ token: accessToken! }} onVerified={adoptSession} />
        )}
      </div>
    </AppShell>
  );
}
