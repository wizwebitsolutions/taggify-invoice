import type { Metadata } from "next";
import Link from "next/link";

import { Logo } from "@/components/ui/logo";

export const metadata: Metadata = {
  title: "Privacy policy · Taggify",
  description: "How Taggify handles your data, including the Google access used to create plan sheets.",
};

const CONTACT_EMAIL = "quaffmedia@gmail.com";
const LAST_UPDATED = "8 October 2026";

/**
 * Public privacy policy (8 Oct): Google requires a privacy policy link on the
 * OAuth consent screen before the app can be published, so this page is
 * reachable without signing in (no <RequireAuth>). Served at
 * https://creator.taggify.in/privacy from the static export.
 */
export default function PrivacyPage() {
  return (
    <div className="min-h-screen bg-bg">
      <header className="border-b border-border bg-surface">
        <div className="mx-auto flex max-w-[760px] items-center justify-between px-6 py-5">
          <Link href="/login" aria-label="Taggify home">
            <Logo className="h-[24px]" />
          </Link>
          <Link href="/login" className="text-[0.8125rem] font-medium text-text-muted transition-colors hover:text-text">
            Sign in
          </Link>
        </div>
      </header>

      <main className="mx-auto max-w-[760px] px-6 py-12">
        <h1 className="text-[2rem] font-semibold leading-[1.1] tracking-[-0.03em]">Privacy policy</h1>
        <p className="mt-2 text-[0.875rem] text-text-muted">Last updated {LAST_UPDATED}</p>

        <div className="mt-8 flex flex-col gap-8 text-[0.9375rem] leading-relaxed text-text-2">
          <Section title="Who we are">
            <p>
              Taggify (<a className="underline hover:text-text" href="https://taggify.in">taggify.in</a>) runs creator campaigns for brands. This app, at creator.taggify.in, is
              where our team, creators and their teams manage campaign plans, posts, invoices and payouts. It is used by people we invite; it is not open for public sign-up.
            </p>
          </Section>

          <Section title="What we collect">
            <ul className="list-disc space-y-2 pl-5">
              <li>
                <b>Account details:</b> your name, email address, phone number (optional) and role. We send one-time sign-in codes to your email.
              </li>
              <li>
                <b>Pages:</b> the Instagram or YouTube handles added to the app, and their public profile figures (followers, average views, likes, comments and profile picture).
              </li>
              <li>
                <b>Campaign work:</b> post links, screenshots you upload as proof, and the post figures we read from the public post.
              </li>
              <li>
                <b>Billing details</b> for creators who are paid: name, PAN, GSTIN (if any) and bank account details, used only to pay you and to prepare invoices and tax records.
              </li>
              <li>
                <b>Client details</b> on plans and invoices: client name, company, GSTIN, address and contact.
              </li>
            </ul>
          </Section>

          <Section title="How we use it">
            <p>
              Only to run the service: to plan and track campaigns, verify posts, raise invoices and make payouts, and to sign you in. We do not sell your data and we do not use it for
              advertising.
            </p>
          </Section>

          <Section title="Google account access">
            <p>An admin can connect one Google account so the app can create Google Sheets for campaign plans. With that access, the app:</p>
            <ul className="mt-2 list-disc space-y-2 pl-5">
              <li>creates spreadsheets for plans and writes the plan details into them;</li>
              <li>edits only the spreadsheets it created itself;</li>
              <li>shares a client sheet as &ldquo;anyone with the link can view&rdquo;, and gives the person who generated a sheet edit access to it.</li>
            </ul>
            <p className="mt-2">
              It does not read, list or change any other files in that Google Drive, and it does not access Gmail, Contacts or any other Google data. Use of information received from
              Google APIs adheres to the{" "}
              <a className="underline hover:text-text" href="https://developers.google.com/terms/api-services-user-data-policy" target="_blank" rel="noopener noreferrer">
                Google API Services User Data Policy
              </a>
              , including the Limited Use requirements. You can remove the app&apos;s access at any time at{" "}
              <a className="underline hover:text-text" href="https://myaccount.google.com/permissions" target="_blank" rel="noopener noreferrer">
                myaccount.google.com/permissions
              </a>
              .
            </p>
          </Section>

          <Section title="Services we use">
            <p>We rely on a few providers to run the app, and share with each only what it needs:</p>
            <ul className="mt-2 list-disc space-y-2 pl-5">
              <li>Render (hosting) and DigitalOcean (database);</li>
              <li>Cloudinary (storing uploaded screenshots, invoices and profile pictures);</li>
              <li>Resend (sending sign-in code emails);</li>
              <li>Apify (reading public Instagram profile and post figures);</li>
              <li>Google (the plan sheets described above).</li>
            </ul>
          </Section>

          <Section title="Keeping and deleting your data">
            <p>
              We keep data while your account is active and for as long as we need it for invoices, payouts and tax records. To see, correct or delete your data, email us at the address
              below.
            </p>
          </Section>

          <Section title="Contact">
            <p>
              Questions about this policy or your data:{" "}
              <a className="font-medium underline hover:text-text" href={`mailto:${CONTACT_EMAIL}`}>
                {CONTACT_EMAIL}
              </a>
            </p>
          </Section>
        </div>
      </main>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section>
      <h2 className="mb-2 text-[1.125rem] font-semibold tracking-[-0.01em] text-text">{title}</h2>
      {children}
    </section>
  );
}
