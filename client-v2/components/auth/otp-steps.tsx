"use client";

import { useEffect, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { AlertCircle, ArrowRight } from "lucide-react";

import { ApiError, auth, type AuthResponse, type EmailSetupIdentity } from "@/lib/api-client";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Field } from "@/components/taggify/field";

// Ported from client/components/auth/otp-steps.tsx (email 2FA) — same flow and
// server contract, restyled with the v2 UI kit.

/** Must match the server's OTP_RESEND_COOLDOWN_SECONDS (lib/auth/emailOtp.js). */
const RESEND_COOLDOWN_SECONDS = 60;

export function messageOf(error: unknown) {
  return error instanceof ApiError ? error.message : error ? "Something went wrong — try again." : null;
}

export function AuthError({ message }: { message: string | null }) {
  if (!message) return null;
  return (
    <p role="alert" className="flex items-start gap-3 rounded-md border border-danger/40 border-l-3 border-l-danger bg-danger-soft px-4 py-3 text-small font-semibold text-danger-fg animate-fade-in">
      <AlertCircle className="mt-px h-4 w-4 shrink-0 text-danger" aria-hidden />
      <span>{message}</span>
    </p>
  );
}

/** Six-digit code + resend. The cooldown starts on mount because a code was just sent. */
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
      <p className="text-body text-fg-secondary">
        We sent a 6-digit code to <span className="font-medium text-fg">{emailHint}</span>. It expires in 10 minutes.
      </p>

      <Field label="Verification code">
        {(a) => (
          <Input
            {...a}
            name="otp-code"
            inputMode="numeric"
            autoComplete="one-time-code"
            autoFocus
            required
            maxLength={6}
            placeholder="123456"
            value={code}
            onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
            className="num h-12 text-body-lg tracking-widest placeholder:tracking-widest"
          />
        )}
      </Field>

      {rememberDevice && (
        <label className="flex cursor-pointer items-center gap-3 text-small text-fg-strong">
          <Checkbox checked={rememberDevice.checked} onCheckedChange={(v) => rememberDevice.onChange(v === true)} />
          Remember this device for 7 days
        </label>
      )}

      <AuthError message={messageOf(verifyMutation.error) ?? messageOf(resendMutation.error)} />
      {resendMutation.isSuccess && !verifyMutation.error && <p className="text-small text-fg-secondary">A new code is on its way.</p>}

      <div className="flex flex-col gap-3">
        <Button type="submit" size="lg" className="w-full" disabled={verifyMutation.isPending || code.length !== 6}>
          {verifyMutation.isPending ? "Verifying…" : submitLabel}
          {!verifyMutation.isPending && <ArrowRight className="h-4 w-4" aria-hidden />}
        </Button>
        <Button variant="ghost" onClick={() => resendMutation.mutate()} disabled={cooldown > 0 || resendMutation.isPending}>
          {resendMutation.isPending ? "Sending…" : cooldown > 0 ? `Resend code in ${cooldown}s` : "Resend code"}
        </Button>
      </div>
    </form>
  );
}

/** Add an email → confirm the code sent to it. Ends with a fresh session whose user is emailVerified (v1 EmailSetupFlow). */
export function EmailSetupFlow({ identity, onVerified }: { identity: EmailSetupIdentity; onVerified: (session: AuthResponse) => void }) {
  const [email, setEmail] = useState("");
  const [sentTo, setSentTo] = useState<{ email: string; hint: string } | null>(null);

  const startMutation = useMutation({
    mutationFn: () => auth.startEmailVerification(identity, email.trim()),
    onSuccess: (result) => setSentTo({ email: email.trim(), hint: result.emailHint }),
  });

  if (sentTo) {
    return (
      <div className="flex flex-col gap-3">
        <OtpCodeForm
          emailHint={sentTo.email}
          verify={(code) => auth.confirmEmailVerification(identity, code)}
          resend={() => auth.startEmailVerification(identity, sentTo.email)}
          onVerified={onVerified}
          submitLabel="Verify email"
        />
        <Button
          variant="ghost"
          onClick={() => {
            setSentTo(null);
            startMutation.reset();
          }}
        >
          Use a different email
        </Button>
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
      <Field label="Email address" description="From now on you'll sign in with this email, and every sign-in sends a code to it.">
        {(a) => <Input {...a} name="email" type="email" autoComplete="email" autoFocus required placeholder="you@gmail.com" value={email} onChange={(e) => setEmail(e.target.value)} />}
      </Field>
      <AuthError message={messageOf(startMutation.error)} />
      <Button type="submit" size="lg" className="w-full" disabled={startMutation.isPending || !email.trim()}>
        {startMutation.isPending ? "Sending code…" : "Send verification code"}
        {!startMutation.isPending && <ArrowRight className="h-4 w-4" aria-hidden />}
      </Button>
    </form>
  );
}
