"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useMutation } from "@tanstack/react-query";

import { Button } from "@/components/ui/button";
import { EyeIcon, ArrowRightIcon } from "@/components/icons";
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

  return (
    <div className="flex min-h-screen">
      {/* Editorial panel */}
      <div
        className="relative hidden w-[56%] flex-col justify-between overflow-hidden border-r border-border p-14 lg:flex"
        style={{
          background:
            "radial-gradient(circle at 12% 8%, color-mix(in oklch, var(--accent) 20%, transparent), transparent 42%), radial-gradient(circle at 88% 92%, color-mix(in oklch, var(--accent-2) 14%, transparent), transparent 46%), var(--bg)",
        }}
      >
        <div className="flex items-center gap-2.5">
          <div className="flex h-[30px] w-[30px] items-center justify-center rounded-lg bg-accent text-[0.9375rem] font-extrabold text-accent-ink">
            T
          </div>
          <span className="text-[1.0625rem] font-bold tracking-tight">Taggify</span>
        </div>

        <div>
          <p className="max-w-[560px] font-display text-[3.25rem] italic leading-[1.08] tracking-tight">
            Track every post.
            <br />
            Get paid on time.
          </p>
          <p className="mt-5 max-w-[420px] text-base leading-relaxed text-text-muted">
            The operations layer for creator campaigns — link submission, screenshot approval,
            insight verification, and payout in one continuous thread.
          </p>
        </div>

        <div>
          <svg width="420" height="120" viewBox="0 0 420 160" fill="none" className="mb-8">
            <path
              d="M0 130 C 90 40, 180 40, 270 90 S 400 140, 420 60"
              style={{ stroke: "color-mix(in oklch, var(--accent) 35%, transparent)" }}
              strokeWidth="1.5"
            />
            <path
              d="M0 150 C 100 90, 200 90, 300 130 S 400 160, 420 110"
              style={{ stroke: "color-mix(in oklch, var(--accent-2) 28%, transparent)" }}
              strokeWidth="1.5"
            />
            <circle cx="270" cy="90" r="4" style={{ fill: "var(--accent)" }} />
            <circle cx="300" cy="130" r="4" style={{ fill: "var(--accent-2)" }} />
          </svg>
          <div className="flex items-center gap-2.5 text-[0.8125rem] text-text-faint">
            <span>Links</span>
            <Dot />
            <span>Screenshots</span>
            <Dot />
            <span>Invoices</span>
            <Dot />
            <span>Payouts</span>
          </div>
        </div>
      </div>

      {/* Form */}
      <div className="flex flex-1 items-center justify-center bg-bg p-8">
        <form onSubmit={handleSubmit} className="flex w-full max-w-[380px] flex-col gap-7">
          <div>
            <h1 className="mb-2 text-2xl font-bold">Welcome back</h1>
            <p className="text-[0.9375rem] text-text-muted">Sign in with the phone number on your account.</p>
          </div>

          <div className="flex flex-col gap-2">
            <label className="text-[0.8125rem] font-semibold text-text-muted" htmlFor="phone">
              Phone number
            </label>
            <div className="flex h-12 items-center overflow-hidden rounded-md border border-border-strong bg-surface-2 focus-within:ring-2 focus-within:ring-accent">
              <span className="flex h-full items-center border-r border-border-strong bg-surface-2 px-3.5 text-[0.9375rem] text-text-muted">
                +91
              </span>
              <input
                id="phone"
                name="phone"
                type="tel"
                autoComplete="tel-national"
                placeholder="98765 43210"
                required
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                className="h-full flex-1 bg-transparent px-3.5 text-[0.9375rem] text-text placeholder:text-text-faint focus:outline-none"
              />
            </div>
          </div>

          <div className="flex flex-col gap-2">
            <label className="text-[0.8125rem] font-semibold text-text-muted" htmlFor="password">
              Password
            </label>
            <div className="flex h-12 items-center justify-between rounded-md border border-border-strong bg-surface-2 px-3.5 focus-within:ring-2 focus-within:ring-accent">
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
                className="shrink-0 text-text-faint hover:text-text-muted"
              >
                <EyeIcon className="h-[18px] w-[18px]" />
              </button>
            </div>
            <p className="text-[0.8125rem] text-text-faint">
              Password was issued by your account admin —{" "}
              <a href="#" className="text-accent hover:text-accent-2">
                contact them
              </a>{" "}
              if you&apos;ve lost it.
            </p>
          </div>

          {errorMessage && (
            <p className="rounded-md border border-rose/30 bg-rose-soft px-3.5 py-2.5 text-[0.8125rem] font-medium text-rose">
              {errorMessage}
            </p>
          )}

          <Button type="submit" size="lg" className="w-full" disabled={loginMutation.isPending}>
            {loginMutation.isPending ? "Signing in…" : "Sign in"}
            {!loginMutation.isPending && <ArrowRightIcon className="h-4 w-4 text-accent-ink" />}
          </Button>

          <div className="h-px bg-border" />
          <p className="text-center text-[0.8125rem] text-text-faint">
            New creators are added by an admin — no self-signup.
          </p>
        </form>
      </div>
    </div>
  );
}

function Dot() {
  return <span className="h-[5px] w-[5px] rounded-full bg-text-faint" />;
}
