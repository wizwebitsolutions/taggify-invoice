"use client";

import Link from "next/link";

import { useAuth } from "@/lib/auth-context";
import { AppShell } from "@/components/layout/app-shell";
import { EmailSetupFlow } from "@/components/auth/otp-steps";
import { Card } from "@/components/ui/card";

/**
 * Where a signed-in account without a verified email verifies one (the banner
 * on every page links here). Ported from client/app/verify-email. adoptSession
 * swaps in the returned session, whose user is emailVerified, so the page
 * flips to the done state.
 */
export default function VerifyEmailPage() {
  return (
    <AppShell active="settings" hideEmailVerifyBanner>
      <VerifyEmail />
    </AppShell>
  );
}

function VerifyEmail() {
  const { user, accessToken, adoptSession } = useAuth();
  return (
    <div className="mx-auto flex w-full max-w-xl flex-col gap-6 pt-2">
      <div className="page-heading">
        <div className="page-heading-copy">
          <h1 className="text-display">Verify your email</h1>
          <p className="mt-1 text-body text-muted-foreground">
            Every account signs in with an email and a code. Once it&apos;s verified, you&apos;ll sign in with this email and we&apos;ll send a code to it each time.
          </p>
        </div>
      </div>
      <Card className="form-panel p-6">
        {user?.emailVerified ? (
          <div role="status" className="flex flex-col gap-3">
            <p className="text-body">
              <span className="font-semibold">{user.email}</span> is verified. Use it with your password next time you sign in.
            </p>
            <Link href="/dashboard" className="self-start text-small font-semibold text-brand-ink underline underline-offset-2">
              Go to Home
            </Link>
          </div>
        ) : accessToken ? (
          <EmailSetupFlow identity={{ token: accessToken }} onVerified={adoptSession} />
        ) : null}
      </Card>
    </div>
  );
}
