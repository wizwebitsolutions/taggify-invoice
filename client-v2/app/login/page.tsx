"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import Image from "next/image";
import { useRouter } from "next/navigation";
import { useMutation } from "@tanstack/react-query";
import { ArrowRight, BarChart3, CalendarCheck2, Eye, EyeOff, FileCheck2, LockKeyhole, Mail } from "lucide-react";

import { useAuth } from "@/lib/auth-context";
import { auth } from "@/lib/api-client";
import { Brand } from "@/components/layout/brand";
import { Button } from "@/components/ui/button";
import { Input, inputClass } from "@/components/ui/input";
import { Field } from "@/components/taggify/field";
import { AuthError, OtpCodeForm, messageOf } from "@/components/auth/otp-steps";
import { cn } from "@/lib/utils";

// Same flow as client/app/login: email + password, then an emailed code unless
// the device is remembered. The server's answer decides the next step.
type Step = { name: "credentials" } | { name: "otp"; challengeToken: string; emailHint: string };

const EMAIL_PATTERN = /^\S+@\S+\.\S+$/;

const campaignPulse = [
  { step: "01", label: "Campaign booked", icon: CalendarCheck2 },
  { step: "02", label: "Content live", icon: FileCheck2 },
  { step: "03", label: "Payout processed", icon: BarChart3 },
] as const;

function CampaignPulse() {
  return (
    <div className="relative mt-8 min-h-auth-hero w-full" data-testid="login-campaign-pulse" aria-hidden>
      <svg className="absolute inset-x-0 top-3 h-48 w-full overflow-visible" viewBox="0 0 760 190" fill="none">
        <path className="auth-pulse-path" d="M38 136C132 24 218 184 324 78S502 166 722 42" pathLength="1" />
        <circle className="auth-pulse-dot auth-pulse-dot-one" cx="154" cy="100" r="6" />
        <circle className="auth-pulse-dot auth-pulse-dot-two" cx="384" cy="82" r="6" />
        <circle className="auth-pulse-dot auth-pulse-dot-three" cx="620" cy="84" r="6" />
      </svg>

      <div className="relative z-10 grid grid-cols-3 gap-4 px-4">
        {campaignPulse.map(({ step, label, icon: Icon }, index) => (
          <div key={step} className={cn("auth-pulse-card flex items-center gap-3 rounded-card border border-brand-200/70 bg-surface-card/90 p-4 shadow-2", index === 1 && "mt-16", index === 2 && "mt-8")}>
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md bg-brand-soft text-brand">
              <Icon className="h-5 w-5" strokeWidth={1.75} />
            </span>
            <span>
              <span className="block text-label font-semibold text-brand-ink">{step}</span>
              <span className="block text-small text-fg-secondary">{label}</span>
            </span>
          </div>
        ))}
      </div>

      <span className="contents dark:hidden">
        <Image
          src="/illustrations/login-team-premium.webp"
          alt=""
          width={1536}
          height={768}
          priority
          data-testid="login-hero-illustration-light"
          className="auth-hero-illustration absolute inset-x-0 bottom-0 z-20 h-auto w-full select-none object-contain"
        />
      </span>
      <span className="hidden dark:contents">
        <Image
          src="/illustrations/login-team-premium-dark.webp"
          alt=""
          width={1536}
          height={768}
          priority
          data-testid="login-hero-illustration-dark"
          className="auth-hero-illustration absolute inset-x-0 bottom-0 z-20 h-auto w-full select-none object-contain"
        />
      </span>
    </div>
  );
}

export default function LoginPage() {
  const router = useRouter();
  const { user, isLoading, login, adoptSession } = useAuth();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [step, setStep] = useState<Step>({ name: "credentials" });
  const [rememberDevice, setRememberDevice] = useState(true);

  // Already signed in, or a step just produced a session → go to the app.
  useEffect(() => {
    if (!isLoading && user) router.replace("/dashboard");
  }, [isLoading, user, router]);

  const [formError, setFormError] = useState<string | null>(null);

  // Takes the values explicitly: browser autofill can fill the boxes without
  // React's onChange ever firing, so submit reads the form itself (see onSubmit).
  const loginMutation = useMutation({
    mutationFn: (creds: { email: string; password: string }) => login(creds.email, creds.password),
    onSuccess: (result) => {
      if (result.step === "OTP_REQUIRED") setStep({ name: "otp", challengeToken: result.challengeToken, emailHint: result.emailHint });
    },
  });

  function backToCredentials() {
    setStep({ name: "credentials" });
    setPassword("");
    loginMutation.reset();
  }

  return (
    <main className="flex min-h-screen overflow-hidden bg-surface-card">
      <section className="relative z-10 flex w-full flex-col justify-between bg-surface-card px-6 py-8 sm:px-12 lg:w-5/12 lg:shrink-0 lg:px-16 lg:py-10 xl:px-20">
        <Brand />

        <div className="my-auto flex w-full max-w-sm flex-col gap-8 py-10">
          {step.name === "otp" ? (
            <>
              <h1 className="text-h1">Check your email</h1>
              <OtpCodeForm
                emailHint={step.emailHint}
                verify={(code) => auth.verifyLoginOtp(step.challengeToken, code, rememberDevice)}
                resend={() => auth.resendLoginOtp(step.challengeToken)}
                onVerified={adoptSession}
                submitLabel="Verify and sign in"
                rememberDevice={{ checked: rememberDevice, onChange: setRememberDevice }}
              />
              <Button variant="ghost" onClick={backToCredentials}>
                Back to sign in
              </Button>
            </>
          ) : (
            <form
              onSubmit={(e) => {
                e.preventDefault();
                const data = new FormData(e.currentTarget);
                const nextEmail = String(data.get("email") ?? "").trim();
                const nextPassword = String(data.get("password") ?? "");
                setEmail(nextEmail);
                setPassword(nextPassword);
                if (!EMAIL_PATTERN.test(nextEmail)) return setFormError("Enter the email your admin registered, like name@company.com.");
                if (!nextPassword) return setFormError("Enter your password.");
                setFormError(null);
                loginMutation.mutate({ email: nextEmail, password: nextPassword });
              }}
              className="flex flex-col gap-8"
            >
              <div className="space-y-2">
                <h1 className="text-display">Welcome back</h1>
                <p className="max-w-sm text-body text-fg-secondary">Sign in with the email your admin registered. We&apos;ll email you a code to confirm it&apos;s you.</p>
              </div>

              <div className="flex flex-col gap-4">
                <Field label="Email">
                  {(a) => (
                    <div className="relative">
                      <Mail className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-fg-muted" aria-hidden />
                      <Input
                        {...a}
                        name="email"
                        type="email"
                        inputMode="email"
                        autoComplete="username"
                        autoCapitalize="none"
                        spellCheck={false}
                        placeholder="you@gmail.com"
                        required
                        value={email}
                        onChange={(e) => setEmail(e.target.value)}
                        className="pl-10"
                      />
                    </div>
                  )}
                </Field>
                <Field label="Password">
                  {(a) => (
                    <div className="relative">
                      <LockKeyhole className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-fg-muted" aria-hidden />
                      <input
                        {...a}
                        name="password"
                        type={showPassword ? "text" : "password"}
                        autoComplete="current-password"
                        placeholder="••••••••••"
                        required
                        value={password}
                        onChange={(e) => setPassword(e.target.value)}
                        className={cn(inputClass, "pl-10 pr-11")}
                      />
                      <button
                        type="button"
                        onClick={() => setShowPassword((v) => !v)}
                        aria-label={showPassword ? "Hide password" : "Show password"}
                        className="absolute right-1 top-1/2 inline-flex h-9 w-9 -translate-y-1/2 items-center justify-center rounded-sm text-fg-muted transition-colors hover:text-fg"
                      >
                        {showPassword ? <EyeOff className="h-[18px] w-[18px]" /> : <Eye className="h-[18px] w-[18px]" />}
                      </button>
                    </div>
                  )}
                </Field>
              </div>

              <AuthError message={formError ?? messageOf(loginMutation.error)} />

              <div className="flex flex-col gap-3">
                <Button type="submit" size="lg" className="group w-full shadow-premium" disabled={loginMutation.isPending}>
                  {loginMutation.isPending ? "Signing in…" : "Sign in"}
                  {!loginMutation.isPending && <ArrowRight className="h-4 w-4 transition-transform duration-hover ease-out group-hover:translate-x-1" aria-hidden />}
                </Button>
                <p className="text-center text-small text-fg-muted">Forgot your password? Ask your admin to reset it.</p>
              </div>
            </form>
          )}
        </div>

        <p className="flex flex-wrap gap-x-4 gap-y-1 text-caption font-normal text-fg-muted">
          <span>© Taggify · Creator campaign operations</span>
          <Link href="/privacy" className="underline underline-offset-2 hover:text-fg">
            Privacy policy
          </Link>
        </p>
      </section>

      <section className="auth-hero relative hidden flex-1 overflow-hidden border-l border-brand-200/70 lg:flex lg:items-center lg:justify-center" aria-label="From campaign booking to payout">
        <div className="relative z-10 flex w-full max-w-3xl flex-col px-12 py-10 xl:px-16">
          <div className="max-w-2xl">
            <p className="text-display text-foreground">Every post,<br />from booking to payout<span className="text-brand">.</span></p>
            <p className="mt-3 max-w-lg text-body-lg text-fg-secondary">One status line per post, and you always know who it&apos;s waiting on.</p>
          </div>
          <CampaignPulse />
        </div>
      </section>
    </main>
  );
}
