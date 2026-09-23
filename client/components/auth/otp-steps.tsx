"use client";

import { useEffect, useState } from "react";
import { useMutation } from "@tanstack/react-query";

import { Button } from "@/components/ui/button";
import { ArrowRightIcon } from "@/components/icons";
import { ApiError, auth, type AuthResponse, type EmailSetupIdentity } from "@/lib/api-client";

// Email 2FA (21 Sep) — the two post-password steps, shared by /login (a
// locked-out or OTP-pending sign-in, identified by challenge token) and
// /verify-email (a signed-in grace-period account, identified by session).

/** Must match the server's OTP_RESEND_COOLDOWN_SECONDS (lib/auth/emailOtp.js) —
 *  only so the button doesn't offer a resend the server will 429. */
const RESEND_COOLDOWN_SECONDS = 60;

export const authFieldClass =
  "flex h-12 items-center overflow-hidden rounded-[10px] border border-border-strong bg-surface shadow-card transition-[box-shadow,border-color] duration-150 focus-within:border-ink focus-within:ring-[3px] focus-within:ring-ink-10";

function messageOf(error: unknown) {
  return error instanceof ApiError ? error.message : error ? "Something went wrong — try again." : null;
}

export function AuthError({ message }: { message: string | null }) {
  if (!message) return null;
  return (
    <p role="alert" className="rounded-md border border-rose-line bg-rose-soft px-3.5 py-2.5 text-[0.8125rem] font-medium text-rose">
      {message}
    </p>
  );
}

/**
 * Six-digit code entry + resend. `verify` resolves with the session the
 * server issues for a correct code; `resend` re-sends to the same address.
 * The cooldown starts running on mount because a code was just sent to
 * get here.
 */
export function OtpCodeForm({
  emailHint,
  verify,
  resend,
  onVerified,
  submitLabel = "Verify",
  rememberDevice,
}: {
  emailHint: string;
  verify: (code: string) => Promise<AuthResponse>;
  resend: () => Promise<unknown>;
  onVerified: (session: AuthResponse) => void;
  submitLabel?: string;
  /** "Skip OTP for 7 days" (23 Sep) — only the /login OTP step passes this;
   *  EmailSetupFlow's confirm step below omits it, so no checkbox shows
   *  there (that flow has no trusted-device concept). Checked by default,
   *  matching the original always-remember behavior when left untouched. */
  rememberDevice?: { checked: boolean; onChange: (v: boolean) => void };
}) {
  const [code, setCode] = useState("");
  const [cooldown, setCooldown] = useState(RESEND_COOLDOWN_SECONDS);

  useEffect(() => {
    if (cooldown <= 0) return;
    const t = setTimeout(() => setCooldown((s) => s - 1), 1000);
    return () => clearTimeout(t);
  }, [cooldown]);

  const verifyMutation = useMutation({ mutationFn: () => verify(code), onSuccess: onVerified });
  const resendMutation = useMutation({
    mutationFn: resend,
    onSuccess: () => {
      setCooldown(RESEND_COOLDOWN_SECONDS);
      setCode("");
      verifyMutation.reset();
    },
  });

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        resendMutation.reset();
        verifyMutation.mutate();
      }}
      className="flex flex-col gap-5"
    >
      <p className="text-[0.9375rem] text-text-muted">
        We sent a 6-digit code to <span className="font-medium text-text">{emailHint}</span>. It expires in 10 minutes.
      </p>

      <div className="flex flex-col gap-1.5">
        <label className="text-[0.78rem] font-medium text-text-2" htmlFor="otp-code">
          Verification code
        </label>
        <div className={authFieldClass}>
          <input
            id="otp-code"
            name="otp-code"
            inputMode="numeric"
            autoComplete="one-time-code"
            autoFocus
            required
            maxLength={6}
            placeholder="123456"
            value={code}
            onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
            className="h-full flex-1 bg-transparent px-3.5 text-[1.125rem] tracking-[0.4em] text-text placeholder:tracking-[0.4em] placeholder:text-text-faint focus:outline-none"
          />
        </div>
      </div>

      {rememberDevice && (
        <label className="flex cursor-pointer items-center gap-2.5 text-[0.8125rem] text-text-2">
          <input
            type="checkbox"
            checked={rememberDevice.checked}
            onChange={(e) => rememberDevice.onChange(e.target.checked)}
            className="h-4 w-4 rounded border-border-strong text-ink accent-ink focus:outline-none focus-visible:ring-2 focus-visible:ring-ink-30"
          />
          Remember this device for 7 days
        </label>
      )}

      <AuthError message={messageOf(verifyMutation.error) ?? messageOf(resendMutation.error)} />
      {resendMutation.isSuccess && !verifyMutation.error && <p className="text-[0.8125rem] text-text-muted">A new code is on its way.</p>}

      <div className="flex flex-col gap-3">
        <Button type="submit" size="lg" className="w-full" disabled={verifyMutation.isPending || code.length !== 6}>
          {verifyMutation.isPending ? "Verifying…" : submitLabel}
          {!verifyMutation.isPending && <ArrowRightIcon className="h-4 w-4" />}
        </Button>
        <button
          type="button"
          onClick={() => resendMutation.mutate()}
          disabled={cooldown > 0 || resendMutation.isPending}
          className="text-center text-[0.8rem] font-medium text-text-2 transition-colors hover:text-text disabled:cursor-not-allowed disabled:text-text-faint"
        >
          {resendMutation.isPending ? "Sending…" : cooldown > 0 ? `Resend code in ${cooldown}s` : "Resend code"}
        </button>
      </div>
    </form>
  );
}

/** Add an email → confirm the code sent to it. Ends with a fresh session whose user is emailVerified. */
export function EmailSetupFlow({ identity, onVerified }: { identity: EmailSetupIdentity; onVerified: (session: AuthResponse) => void }) {
  const [email, setEmail] = useState("");
  const [sentTo, setSentTo] = useState<{ email: string; hint: string } | null>(null);

  const startMutation = useMutation({
    mutationFn: () => auth.startEmailVerification(identity, email.trim()),
    onSuccess: (result) => setSentTo({ email: email.trim(), hint: result.emailHint }),
  });

  if (sentTo) {
    return (
      <div className="flex flex-col gap-4">
        <OtpCodeForm
          emailHint={sentTo.email}
          verify={(code) => auth.confirmEmailVerification(identity, code)}
          resend={() => auth.startEmailVerification(identity, sentTo.email)}
          onVerified={onVerified}
          submitLabel="Verify email"
        />
        <button
          type="button"
          onClick={() => {
            setSentTo(null);
            startMutation.reset();
          }}
          className="text-center text-[0.8rem] text-text-muted transition-colors hover:text-text"
        >
          Use a different email
        </button>
      </div>
    );
  }

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        startMutation.mutate();
      }}
      className="flex flex-col gap-5"
    >
      <div className="flex flex-col gap-1.5">
        <label className="text-[0.78rem] font-medium text-text-2" htmlFor="setup-email">
          Email address
        </label>
        <div className={authFieldClass}>
          <input
            id="setup-email"
            name="email"
            type="email"
            autoComplete="email"
            autoFocus
            required
            placeholder="you@gmail.com"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="h-full flex-1 bg-transparent px-3.5 text-[0.9375rem] text-text placeholder:text-text-faint focus:outline-none"
          />
        </div>
        <p className="text-[0.78rem] text-text-muted">From now on you&apos;ll sign in with this email, and every sign-in sends a code to it.</p>
      </div>

      <AuthError message={messageOf(startMutation.error)} />

      <Button type="submit" size="lg" className="w-full" disabled={startMutation.isPending || !email.trim()}>
        {startMutation.isPending ? "Sending code…" : "Send verification code"}
        {!startMutation.isPending && <ArrowRightIcon className="h-4 w-4" />}
      </Button>
    </form>
  );
}
