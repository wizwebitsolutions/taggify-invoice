"use client";

import { RequireAuth } from "@/components/auth/require-auth";
import { CreatorDashboard } from "@/components/dashboard/creator-dashboard";
import { AdminDashboard } from "@/components/dashboard/admin-dashboard";
import { FinanceDashboard } from "@/components/dashboard/finance-dashboard";
import { PlanMakerDashboard } from "@/components/dashboard/plan-maker-dashboard";
import { useAuth } from "@/lib/auth-context";

export default function DashboardPage() {
  return (
    <RequireAuth>
      <DashboardContent />
    </RequireAuth>
  );
}

/**
 * Three separate dashboards for the three non-Creator roles (newTask.md, 8
 * Sep — "separate dashboard for finance" / "separate dashboard for plan
 * maker"), not one shared view gated by role: Admin, Finance, and Plan
 * Maker each see and can act on a genuinely different slice of the app —
 * see the three dashboard components for what each one covers and why.
 * CREATOR/TEAM_MEMBER still get the per-link "My Works" table, which
 * doesn't make sense for any of the other three (none of them submit or
 * own links themselves).
 */
function DashboardContent() {
  const { user } = useAuth();
  if (user?.role === "ADMIN") return <AdminDashboard />;
  if (user?.role === "FINANCE") return <FinanceDashboard />;
  if (user?.role === "PLAN_MAKER") return <PlanMakerDashboard />;
  return <CreatorDashboard />;
}
