import type { Metadata } from "next";
import Link from "next/link";

import { Brand } from "@/components/layout/brand";

export const metadata: Metadata = {
  title: "Privacy policy · Taggify",
  description: "How Taggify handles your data, including the Google access used to create plan sheets.",
};

const CONTACT_EMAIL = "quaffmedia@gmail.com";
const LAST_UPDATED = "8 October 2026";

/**
 * Public privacy policy, ported from client/app/privacy. Google needs this
 * link on the OAuth consent screen, so it's reachable without signing in
 * (no AppShell / RequireAuth). Linked from the login footer.
 */
export default function PrivacyPage() {
  return (
    <div className="min-h-screen">
      <header className="border-b bg-card">
        <div className="mx-auto flex max-w-3xl items-center justify-between px-4 py-5 sm:px-6">
          <Link href="/login" aria-label="Taggify sign in">
            <Brand />
          </Link>
          <Link href="/login" className="text-small font-medium text-muted-foreground transition-colors hover:text-foreground">
            Sign in
          </Link>
        </div>
      </header>

      <main className="mx-auto max-w-3xl px-4 py-12 sm:px-6">
        <h1 className="text-display">Privacy policy</h1>
        <p className="mt-2 text-small text-muted-foreground">Last updated {LAST_UPDATED}</p>

        <div className="mt-8 flex flex-col gap-8 text-body-lg text-fg-secondary">
          <Section title="Who we are">
            <p>
              Taggify (<A href="https://taggify.in">taggify.in</A>) runs creator campaigns for brands. This app, at creator.taggify.in, is where our team, creators and their teams manage
              campaign plans, posts, invoices and payouts. It is used by people we invite; it is not open for public sign-up.
            </p>
          </Section>

          <Section title="What we collect">
            <ul className="list-disc space-y-2 pl-5">
              <li>
                <b className="text-foreground">Account details:</b> your name, email address, phone number (optional) and role. We send one-time sign-in codes to your email.
              </li>
              <li>
                <b className="text-foreground">Pages:</b> the Instagram or YouTube handles added to the app, and their public profile figures (followers, average views, likes, comments and profile
                picture).
              </li>
              <li>
                <b className="text-foreground">Campaign work:</b> post links, screenshots you upload as proof, and the post figures we read from the public post.
              </li>
              <li>
                <b className="text-foreground">Billing details</b> for creators who are paid: name, PAN, GSTIN (if any) and bank account details, used only to pay you and to prepare invoices and tax
                records.
              </li>
              <li>
                <b className="text-foreground">Client details</b> on plans and invoices: client name, company, GSTIN, address and contact.
              </li>
            </ul>
          </Section>

          <Section title="How we use it">
            <p>Only to run the service: to plan and track campaigns, verify posts, raise invoices and make payouts, and to sign you in. We do not sell your data and we do not use it for advertising.</p>
          </Section>

          <Section title="Google account access">
            <p>An admin can connect one Google account so the app can create Google Sheets for campaign plans. With that access, the app:</p>
            <ul className="mt-2 list-disc space-y-2 pl-5">
              <li>creates spreadsheets for plans and writes the plan details into them;</li>
              <li>edits only the spreadsheets it created itself;</li>
              <li>shares a client sheet as &ldquo;anyone with the link can view&rdquo;, and gives the person who generated a sheet edit access to it.</li>
            </ul>
            <p className="mt-2">
              It does not read, list or change any other files in that Google Drive, and it does not access Gmail, Contacts or any other Google data. Use of information received from Google APIs
              adheres to the <A href="https://developers.google.com/terms/api-services-user-data-policy">Google API Services User Data Policy</A>, including the Limited Use requirements. You can
              remove the app&apos;s access at any time at <A href="https://myaccount.google.com/permissions">myaccount.google.com/permissions</A>.
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
            <p>We keep data while your account is active and for as long as we need it for invoices, payouts and tax records. To see, correct or delete your data, email us at the address below.</p>
          </Section>

          <Section title="Contact">
            <p>
              Questions about this policy or your data:{" "}
              <a className="font-medium text-foreground underline underline-offset-2" href={`mailto:${CONTACT_EMAIL}`}>
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
      <h2 className="mb-2 text-section text-foreground">{title}</h2>
      {children}
    </section>
  );
}

function A({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <a className="underline underline-offset-2 hover:text-foreground" href={href} target="_blank" rel="noopener noreferrer">
      {children}
    </a>
  );
}
