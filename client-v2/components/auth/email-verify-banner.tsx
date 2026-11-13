"use client";

import { Notice } from "@/components/taggify/notice";
import Link from "next/link";

import { Button } from "@/components/ui/button";

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
    <Notice
      tone="warning"
      className="mb-4"
      action={
        <Button asChild size="sm" variant="outline" className="rounded-pill">
          <Link href="/verify-email">Verify email</Link>
        </Button>
      }
    >
      <p>
        <strong>Verify your email to keep access.</strong> Only 2 sign-ins are allowed without one. After that you&apos;ll need it to get in.
      </p>
    </Notice>
  );
}
