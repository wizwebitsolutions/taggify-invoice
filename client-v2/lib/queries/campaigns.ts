"use client";

import { useQuery, type QueryClient } from "@tanstack/react-query";

import { useAuth } from "@/lib/auth-context";
import { campaigns as campaignsApi, canUse, hasAccess, links as linksApi, type Link } from "@/lib/api-client";

/** Campaign hooks. Keys start with "campaigns" / "links" so post actions refresh both. */
export const campaignKeys = {
  all: ["campaigns", "list"] as const,
  one: (id: string) => ["campaigns", "one", id] as const,
  assignments: (id: string) => ["campaigns", "assignments", id] as const,
  links: (id: string) => ["links", "campaign", id] as const,
};

function useCampaignToken() {
  const { accessToken, user } = useAuth();
  return canUse(user, "campaigns.view") ? accessToken : null;
}

export function useCampaigns() {
  const token = useCampaignToken();
  return useQuery({ queryKey: campaignKeys.all, queryFn: () => campaignsApi.list(token!), enabled: !!token });
}

export function useCampaign(id: string) {
  const token = useCampaignToken();
  return useQuery({ queryKey: campaignKeys.one(id), queryFn: () => campaignsApi.get(token!, id), enabled: !!token && !!id });
}

/** Bookings per page. The server needs the global campaigns.view key (not the own-content one), so creators don't ask. */
export function useAssignments(id: string) {
  const { accessToken, user } = useAuth();
  const token = hasAccess(user, "campaigns.view") ? accessToken : null;
  return useQuery({ queryKey: campaignKeys.assignments(id), queryFn: () => campaignsApi.listAssignments(token!, id), enabled: !!token && !!id });
}

export function useCampaignLinks(id: string) {
  const { accessToken, user } = useAuth();
  const token = canUse(user, "links.view") ? accessToken : null;
  return useQuery({
    queryKey: campaignKeys.links(id),
    // The API pages at 100; a campaign is read whole (up to 1,000 posts) so counts are never cut short.
    queryFn: async () => {
      const items: Link[] = [];
      for (let page = 1; page <= 10; page++) {
        const r = await linksApi.list(token!, { campaignId: id, page, pageSize: 100 });
        items.push(...r.items);
        if (items.length >= r.total || r.items.length === 0) return { items, total: r.total };
      }
      return { items, total: items.length };
    },
    enabled: !!token && !!id,
  });
}

export function invalidateAfterPostChange(qc: QueryClient) {
  return Promise.all([qc.invalidateQueries({ queryKey: ["links"] }), qc.invalidateQueries({ queryKey: ["campaigns"] }), qc.invalidateQueries({ queryKey: ["payments"] })]);
}
