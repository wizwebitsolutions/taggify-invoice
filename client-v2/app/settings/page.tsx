"use client";

import { Suspense } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";

import { useAuth } from "@/lib/auth-context";
import { canConnectGoogle, canEditNumbering, canSeeAllBilling, canSeeJobs, canSeeOwnBilling, canSeePeople, canSeeTeam } from "@/lib/settings";
import { AppShell } from "@/components/layout/app-shell";
import { Card } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { BillingProfilesTab } from "@/components/settings/billing-profiles-tab";
import { JobsTab } from "@/components/settings/jobs-tab";
import { NumberingTab } from "@/components/settings/numbering-tab";
import { PeopleTab, usePeople } from "@/components/settings/people-tab";
import { ProfileTab } from "@/components/settings/profile-tab";
import { GoogleTab } from "@/components/settings/google-tab";
import { TeamTab } from "@/components/settings/team-tab";

export default function SettingsPage() {
  return (
    <AppShell active="settings">
      <Suspense>
        <Settings />
      </Suspense>
    </AppShell>
  );
}

type Tab = "people" | "numbering" | "jobs" | "google" | "billing" | "profile";

/**
 * Settings (prototype S.settings): people and access, client invoice numbering,
 * background jobs and your own profile, in one place. Each tab shows only for
 * people the server lets use it (lib/settings.ts); everyone gets My profile.
 * The open tab lives in ?tab= so other screens can link straight to one.
 */
function Settings() {
  const { user } = useAuth();
  const params = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const people = usePeople(canSeePeople(user));

  const tabs: { value: Tab; label: string }[] = [
    ...(canSeePeople(user) ? [{ value: "people" as const, label: people.data ? `People & access (${people.data.length})` : "People & access" }] : []),
    ...(canEditNumbering(user) ? [{ value: "numbering" as const, label: "Invoice numbering" }] : []),
    ...(canSeeJobs(user) ? [{ value: "jobs" as const, label: "Background jobs" }] : []),
    ...(canConnectGoogle(user) ? [{ value: "google" as const, label: "Google Sheets" }] : []),
    // Everyone's bank details (v1 Profile → Billing for Admin / Finance): finance.view.
    ...(canSeeAllBilling(user) ? [{ value: "billing" as const, label: "Billing profiles" }] : []),
    { value: "profile", label: "My profile" },
  ];
  const asked = params.get("tab");
  const tab = tabs.find((t) => t.value === asked)?.value ?? tabs[0].value;
  // Creators, team members and planners only have My profile: no tab strip, no card around its cards.
  // A creator's team sits under their profile as one more card (v1 /team).
  const staff = tabs.length > 1;
  const team = !staff && canSeeTeam(user);

  return (
    <div className="flex flex-col gap-5 pt-2">
      <div>
        <h1 className="text-display">Settings</h1>
        <p className="mt-1 text-body text-muted-foreground">{staff ? "People and access, numbering, and background jobs in one place." : ownLine(canSeeOwnBilling(user), team)}</p>
      </div>

      {!staff ? (
        <>
          <ProfileTab bare />
          {team && <TeamTab bare />}
        </>
      ) : (
        <Card className="overflow-hidden">
          <Tabs value={tab} onValueChange={(v) => router.replace(`${pathname}?tab=${v}`, { scroll: false })}>
            <div className="overflow-x-auto px-5 pt-2">
              <TabsList className="border-b-0">
                {tabs.map((t) => (
                  <TabsTrigger key={t.value} value={t.value}>
                    {t.label}
                  </TabsTrigger>
                ))}
              </TabsList>
            </div>
            {tabs.map((t) => (
              <TabsContent key={t.value} value={t.value} className="mt-0">
                {t.value === "people" ? <PeopleTab /> : t.value === "numbering" ? <NumberingTab /> : t.value === "jobs" ? <JobsTab /> : t.value === "google" ? <GoogleTab /> : t.value === "billing" ? <BillingProfilesTab /> : <ProfileTab />}
              </TabsContent>
            ))}
          </Tabs>
        </Card>
      )}
    </div>
  );
}

/** "Your details, password, bank details and team." with only what this person has. */
function ownLine(bank: boolean, team: boolean) {
  const parts = ["Your details", "password", ...(bank ? ["bank details"] : []), ...(team ? ["team"] : [])];
  return `${parts.slice(0, -1).join(", ")} and ${parts[parts.length - 1]}.`;
}
