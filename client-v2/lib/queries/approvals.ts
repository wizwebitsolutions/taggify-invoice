"use client";

import { useQuery } from "@tanstack/react-query";

import { useAuth } from "@/lib/auth-context";
import { assets as assetsApi, billing as billingApi, campaigns as campaignsApi, hasAccess, links as linksApi, plans as plansApi } from "@/lib/api-client";
import { isDecidable } from "@/lib/plans";

/**
 * Everything the Approvals inbox decides, one query per kind. Each kind is its
 * own permission server-side (links.approve, plans.approve, inventory.approve,
 * finance.pay), so a query only runs for someone who can act on it. Home's
 * "Needs your decision" uses the same queries, so its counts always match the inbox.
 */
export function useApprovalSources() {
  const { user, accessToken } = useAuth();
  const can = {
    links: hasAccess(user, "links.approve"),
    plans: hasAccess(user, "plans.approve"),
    pages: hasAccess(user, "inventory.approve"),
    billing: hasAccess(user, "finance.pay"),
    campaigns: hasAccess(user, "campaigns.view"),
    // Matching a sheet row to a page is PUT /campaigns/:id/assignments/:id — campaigns.edit server-side.
    people: hasAccess(user, "campaigns.edit"),
  };
  const token = accessToken ?? "";
  const linksQ = useQuery({ queryKey: ["links", "approvals"], queryFn: () => linksApi.list(token, { status: "PENDING_SCREENSHOT_REVIEW,INSIGHTS_PENDING", pageSize: 100 }), enabled: !!accessToken && can.links });
  const plansQ = useQuery({ queryKey: ["plans", "list"], queryFn: () => plansApi.list(token), enabled: !!accessToken && can.plans });
  const assetsQ = useQuery({ queryKey: ["assets", "all"], queryFn: () => assetsApi.list(token), enabled: !!accessToken && can.pages });
  const billingQ = useQuery({ queryKey: ["billing", "all"], queryFn: () => billingApi.list(token), enabled: !!accessToken && can.billing });
  const campaignsQ = useQuery({ queryKey: ["campaigns", "list"], queryFn: () => campaignsApi.list(token), enabled: !!accessToken && can.people });
  // The list above stops at 100 (the server's page cap); the tile counts come from each status's `total`.
  const proofTotal = useQuery({ queryKey: ["links", "approvals", "count", "proof"], queryFn: () => linksApi.list(token, { status: "PENDING_SCREENSHOT_REVIEW", pageSize: 1 }), enabled: !!accessToken && can.links });
  const insightsTotal = useQuery({ queryKey: ["links", "approvals", "count", "insights"], queryFn: () => linksApi.list(token, { status: "INSIGHTS_PENDING", pageSize: 1 }), enabled: !!accessToken && can.links });
  // These keys are shared with other screens (Plans, Campaigns, Creators), so a
  // query that's switched off can still hold another screen's data. Never let
  // that cached data count as something this user can decide.
  return {
    can,
    linksQ: gate(can.links, linksQ),
    plansQ: gate(can.plans, plansQ),
    assetsQ: gate(can.pages, assetsQ),
    billingQ: gate(can.billing, billingQ),
    campaignsQ: gate(can.people, campaignsQ),
    proofTotal: gate(can.links, proofTotal),
    insightsTotal: gate(can.links, insightsTotal),
  };
}

function gate<Q extends { data: unknown; isLoading: boolean; isError: boolean }>(allowed: boolean, q: Q): Q {
  return allowed ? q : { ...q, data: undefined, status: "pending", isSuccess: false, isLoading: false, isError: false };
}

export type ApprovalCounts = { proof: number; insights: number; plan: number; people: number; page: number; "page-edit": number; billing: number };

/** How many items of each kind wait in the inbox (0 for kinds this user can't decide). */
export function approvalCounts(s: ReturnType<typeof useApprovalSources>): ApprovalCounts {
  const links = s.linksQ.data?.items ?? [];
  return {
    proof: s.proofTotal.data?.total ?? links.filter((l) => l.status === "PENDING_SCREENSHOT_REVIEW").length,
    insights: s.insightsTotal.data?.total ?? links.filter((l) => l.status !== "PENDING_SCREENSHOT_REVIEW").length,
    plan: (s.plansQ.data ?? []).filter(isDecidable).length,
    people: (s.campaignsQ.data ?? []).filter((c) => (c.pendingAssignmentCount ?? 0) > 0).length,
    page: (s.assetsQ.data ?? []).filter((a) => a.approvalStatus === "pending").length,
    // A planner's suggested edit to a page (16 Oct) waits in the same inbox.
    "page-edit": (s.assetsQ.data ?? []).filter((a) => a.pendingEdit && typeof a.pendingEdit === "object" && Object.keys(a.pendingEdit).length > 0).length,
    billing: (s.billingQ.data ?? []).filter((b) => b.approvalStatus === "pending").length,
  };
}
