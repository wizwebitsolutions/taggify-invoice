"use client";

import { RequireAuth } from "@/components/auth/require-auth";
import { CreatorDashboard } from "@/components/dashboard/creator-dashboard";
import { AdminDashboard } from "@/components/dashboard/admin-dashboard";
import { useAuth } from "@/lib/auth-context";

export default function DashboardPage() {
  return (
    <RequireAuth>
      <DashboardContent />
    </RequireAuth>
  );
}

/**
 * Neither ADMIN nor FINANCE submits or owns links, so the creator's
 * per-link "My Works" table doesn't make sense as their landing page —
 * they get a genuinely different dashboard (finance, pipeline health,
 * pages) instead. See components/dashboard/admin-dashboard.tsx.
 */
function DashboardContent() {
  const { user } = useAuth();
  if (user?.role === "ADMIN" || user?.role === "FINANCE") {
    return <AdminDashboard />;
  }
  return <CreatorDashboard />;
}
