"use client";

import { useAuth } from "@/lib/auth-context";
import { AppShell } from "@/components/layout/app-shell";
import { CreatorHome } from "@/components/creator/creator-home";
import { StaffHome } from "@/components/home/staff-home";

/** Home: creators and team members get their phone-first home; Admin, Finance and Planner get the staff home. */
export default function DashboardPage() {
  const { user } = useAuth();
  return <AppShell active="dashboard">{user?.role === "CREATOR" || user?.role === "TEAM_MEMBER" ? <CreatorHome /> : <StaffHome />}</AppShell>;
}
