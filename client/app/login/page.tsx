"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useMutation } from "@tanstack/react-query";

import { Button } from "@/components/ui/button";
import { Logo } from "@/components/ui/logo";
import { EyeIcon, ArrowRightIcon, CheckCircleIcon } from "@/components/icons";
import { useAuth } from "@/lib/auth-context";
import { ApiError } from "@/lib/api-client";

export default function LoginPage() {
  const router = useRouter();
  const { user, isLoading, login } = useAuth();
  const [phone, setPhone] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);

  // Already signed in (e.g. token still in localStorage) — skip the form.
  useEffect(() => {
    if (!isLoading && user) router.replace("/dashboard");
  }, [isLoading, user, router]);

  const loginMutation = useMutation({
    mutationFn: () => login(`+91${phone.replace(/\s/g, "")}`, password),
    onSuccess: () => router.push("/dashboard"),
  });

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    loginMutation.mutate();
  }

  const errorMessage =
    loginMutation.error instanceof ApiError
      ? loginMutation.error.message
      : loginMutation.error
        ? "Something went wrong — try again."
        : null;

  const fieldClass =
    "flex h-12 items-center overflow-hidden rounded-[10px] border border-border-strong bg-surface shadow-card transition-[box-shadow,border-color] duration-150 focus-within:border-ink focus-within:ring-[3px] focus-within:ring-ink-10";

  return (
    <div className="flex min-h-screen bg-bg">
      {/* Form column */}
      <div className="flex w-full flex-col justify-between border-r border-border bg-surface px-6 py-8 sm:px-10 lg:w-[520px] lg:shrink-0 lg:px-16 lg:py-10">
        <Wordmark />

        <form onSubmit={handleSubmit} className="page-stagger my-auto flex w-full max-w-[400px] flex-col gap-7 py-10">
          <div>
            <h1 className="mb-2 text-[2rem] font-semibold leading-[1.1] tracking-[-0.03em]">
              Welcome <span className="serif text-[1.15em]">back.</span>
            </h1>
            <p className="text-[0.9375rem] text-text-muted">Sign in with the phone number and password your admin shared with you.</p>
          </div>

          <div className="flex flex-col gap-4">
            <div className="flex flex-col gap-1.5">
              <label className="text-[0.78rem] font-medium text-text-2" htmlFor="phone">
                Phone number
              </label>
              <div className={fieldClass}>
                <span className="flex h-full items-center border-r border-border px-3.5 text-[0.9rem] font-medium text-text-muted">+91</span>
                <input
                  id="phone"
                  name="phone"
                  type="tel"
                  inputMode="numeric"
                  autoComplete="tel-national"
                  placeholder="9876543210"
                  required
                  maxLength={10}
                  value={phone}
                  onChange={(e) => setPhone(e.target.value.replace(/\D/g, "").slice(0, 10))}
                  className="h-full flex-1 bg-transparent px-3.5 text-[0.9375rem] text-text placeholder:text-text-faint focus:outline-none"
                />
              </div>
            </div>

            <div className="flex flex-col gap-1.5">
              <label className="text-[0.78rem] font-medium text-text-2" htmlFor="password">
                Password
              </label>
              <div className={`${fieldClass} justify-between px-3.5`}>
                <input
                  id="password"
                  name="password"
                  type={showPassword ? "text" : "password"}
                  autoComplete="new-password"
                  placeholder="••••••••••"
                  required
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="h-full flex-1 bg-transparent text-[0.9375rem] text-text placeholder:text-text-faint focus:outline-none"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword((v) => !v)}
                  aria-label={showPassword ? "Hide password" : "Show password"}
                  className="shrink-0 text-text-faint transition-colors hover:text-text"
                >
                  <EyeIcon className="h-[18px] w-[18px]" />
                </button>
              </div>
            </div>
          </div>

          {errorMessage && (
            <p className="rounded-md border border-rose-line bg-rose-soft px-3.5 py-2.5 text-[0.8125rem] font-medium text-rose">{errorMessage}</p>
          )}

          <div className="flex flex-col gap-3">
            <Button type="submit" size="lg" className="w-full" disabled={loginMutation.isPending || phone.length !== 10}>
              {loginMutation.isPending ? "Signing in…" : "Sign in"}
              {!loginMutation.isPending && <ArrowRightIcon className="h-4 w-4" />}
            </Button>
            <p className="text-center text-[0.8rem] text-text-muted">
              Forgot your password? Ask your admin to reset it — you&apos;ll get a new one on WhatsApp.
            </p>
          </div>
        </form>

        <p className="text-[0.75rem] text-text-faint">© Taggify · Creator campaign operations</p>
      </div>

      {/* Editorial panel — a single product moment, not a marketing wall. */}
      <div className="relative hidden flex-1 items-center justify-center overflow-hidden p-16 lg:flex">
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-0 opacity-[0.55] [background-image:linear-gradient(var(--border)_1px,transparent_1px),linear-gradient(90deg,var(--border)_1px,transparent_1px)] [background-size:48px_48px] [mask-image:radial-gradient(ellipse_at_center,black_20%,transparent_72%)]"
        />
        <div className="page-stagger relative flex w-full max-w-[560px] flex-col gap-6">
          <div className="flex flex-col gap-4 rounded-lg border border-border bg-surface p-5 shadow-lg">
            <div className="flex items-center gap-3">
              <span className="h-10 w-10 shrink-0 rounded-md bg-gradient-to-br from-surface-2 to-border-strong" />
              <div className="min-w-0">
                <p className="text-[0.875rem] font-semibold">@meme.mafia · Reel</p>
                <p className="text-[0.78rem] text-text-muted">Zomato Diwali · Phase 2</p>
              </div>
              <span className="ml-auto inline-flex items-center gap-1.5 rounded-[6px] border border-accent-line bg-accent-soft px-2 py-[3px] text-[0.7rem] font-medium text-accent">
                <CheckCircleIcon className="h-3 w-3" />
                Insights approved
              </span>
            </div>
            <div className="flex items-center gap-1">
              {[1, 2, 3, 4].map((i) => (
                <span key={i} className="h-[3px] w-6 origin-left rounded-full bg-ink motion-safe:animate-grow-x" style={{ animationDelay: `${0.3 + i * 0.1}s` }} />
              ))}
              <span className="h-[3px] w-6 rounded-full bg-accent-2" />
            </div>
            <div className="flex items-center justify-between gap-3">
              <p className="text-[0.78rem] text-text-muted">
                Submitted → Proof → Verified → Approved → <span className="font-medium text-text">Invoice</span>
              </p>
              <span className="inline-flex h-[30px] items-center rounded-[7px] bg-ink px-2.5 text-[0.78rem] font-semibold text-ink-fg">Raise invoice</span>
            </div>
          </div>
          <div className="px-1">
            <p className="text-[1.5rem] font-semibold leading-tight tracking-[-0.03em]">
              One status line per post. <span className="serif text-[1.15em] text-text-muted">Nothing to guess.</span>
            </p>
            <p className="mt-2 max-w-[44ch] text-[0.9375rem] text-text-muted">
              Every link shows exactly which step it is on and who it is waiting for — from submission to payout.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}

function Wordmark() {
  return <Logo className="h-[26px]" />;
}
