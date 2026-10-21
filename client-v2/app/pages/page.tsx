"use client";

import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { ExternalLink, Plus } from "lucide-react";

import { useAuth } from "@/lib/auth-context";
import { ApiError, assets as assetsApi, canUse } from "@/lib/api-client";
import { invalidateCreator, useMyPages } from "@/lib/queries/creator";
import { FORMATS, formatLabel } from "@/lib/formats";
import { AppShell } from "@/components/layout/app-shell";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState } from "@/components/taggify/illustration";
import { PlatformIcon } from "@/components/taggify/platform-icon";
import { SegmentedFilter } from "@/components/taggify/segmented-filter";
import { StatusPill } from "@/components/taggify/status-pill";
import { audienceLabel, displayHandle, PageAvatar } from "@/components/finance/identity";
import { LoadError, NoAccess } from "@/components/finance/states";

const APPROVAL: Record<string, { label: string; tone: "success" | "warning" | "danger" }> = {
  approved: { label: "Approved", tone: "success" },
  pending: { label: "Waiting for approval", tone: "warning" },
  rejected: { label: "Rejected", tone: "danger" },
};

export default function MyPagesPage() {
  return (
    <AppShell active="pages">
      <MyPages />
    </AppShell>
  );
}

/** A creator's own pages (a team member sees their creator's). Creators can add a page; it waits for approval. */
function MyPages() {
  const { user } = useAuth();
  const pages = useMyPages();
  const [adding, setAdding] = useState(false);
  if ((user?.role !== "CREATOR" && user?.role !== "TEAM_MEMBER") || !canUse(user, "inventory.view")) return <NoAccess what="pages" />;
  const canAdd = user?.role === "CREATOR" && canUse(user, "inventory.edit");

  return (
    <div className="flex flex-col gap-6 pt-2">
      <div className="flex flex-wrap items-start gap-4">
        <div>
          <h1 className="text-display">{user?.role === "CREATOR" ? "My pages" : "Pages"}</h1>
          <p className="mt-1 text-body text-muted-foreground">The pages brands can book. Followers refresh from Instagram every day.</p>
        </div>
        {canAdd && (
          <Button className="ml-auto" onClick={() => setAdding(true)}>
            <Plus />
            Add page
          </Button>
        )}
      </div>

      {pages.isError ? (
        <LoadError onRetry={() => pages.refetch()} what="your pages" />
      ) : pages.isLoading ? (
        <Skeleton className="h-32 rounded-card" />
      ) : (pages.data?.length ?? 0) === 0 ? (
        <Card>
          <EmptyState name="page-lifestyle" title="No pages yet">
            {canAdd ? "Add your first page so brands can book it." : "Your creator hasn't added a page yet."}
          </EmptyState>
        </Card>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {pages.data!.map((p) => {
            const st = APPROVAL[p.approvalStatus] ?? APPROVAL.pending;
            const fetching = !!p.scrapeQueuedAt;
            return (
              <Card key={p.id} className="flex flex-col gap-3 p-4">
                <div className="flex items-center gap-3">
                  <PageAvatar assetId={p.id} handle={p.handle} size="lg" />
                  <div className="min-w-0 flex-1">
                    <p className="flex items-center gap-1 truncate text-card-title">
                      <PlatformIcon platform={p.platform} />
                      {displayHandle(p.handle, p.platform)}
                    </p>
                    <p className="text-small text-muted-foreground">{fetching ? "Fetching from Instagram…" : p.lastScrapeError ? "Couldn't fetch the profile" : audienceLabel(p.followers, p.platform)}</p>
                  </div>
                  <a
                    href={p.platform.toLowerCase() === "youtube" ? `https://www.youtube.com/@${p.handle}` : `https://www.instagram.com/${p.handle}/`}
                    target="_blank"
                    rel="noreferrer"
                    aria-label={`Open ${displayHandle(p.handle, p.platform)}`}
                    className="grid h-8 w-8 place-items-center rounded-sm text-muted-foreground hover:bg-muted hover:text-foreground"
                  >
                    <ExternalLink className="h-4 w-4" />
                  </a>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <StatusPill tone={st.tone}>{st.label}</StatusPill>
                  {p.category && <Badge variant="tag">{p.category}</Badge>}
                  {[...(p.rateCards ?? [])]
                    .sort((a, b) => rank(a.format) - rank(b.format))
                    .map((r) => (
                      <Badge key={r.id} variant="tag">
                        {formatLabel(r.format)} ₹{Number(r.amount).toLocaleString("en-IN")}
                      </Badge>
                    ))}
                </div>
                {p.approvalStatus === "pending" && <p className="text-small text-muted-foreground">Waiting for an admin to set rates.</p>}
              </Card>
            );
          })}
        </div>
      )}

      <AddPageDialog open={adding} onOpenChange={setAdding} />
    </div>
  );
}

function AddPageDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const { accessToken } = useAuth();
  const qc = useQueryClient();
  const [handle, setHandle] = useState("");
  const [platform, setPlatform] = useState<"instagram" | "youtube">("instagram");
  const [category, setCategory] = useState("");
  const add = useMutation({
    mutationFn: () => assetsApi.create(accessToken!, handle.trim().replace(/^@+/, ""), platform, category.trim() ? { category: category.trim() } : {}),
    onSuccess: async (a) => {
      await invalidateCreator(qc);
      toast.success(`${displayHandle(a.handle, a.platform)} added. It's waiting for approval.`);
      setHandle("");
      setCategory("");
      onOpenChange(false);
    },
  });
  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        onOpenChange(o);
        if (!o) add.reset();
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Add a page</DialogTitle>
          <DialogDescription>We fetch followers and recent posts from the profile. An admin sets its rates and approves the page before it can be booked.</DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-4">
          <SegmentedFilter
            label="Platform"
            value={platform}
            onChange={setPlatform}
            options={[
              { value: "instagram", label: "Instagram" },
              { value: "youtube", label: "YouTube" },
            ]}
            className="self-start"
          />
          <div className="flex flex-col gap-2">
            <Label htmlFor="page-handle">{platform === "youtube" ? "Channel handle" : "Instagram handle"}</Label>
            <Input id="page-handle" placeholder="@yourpage" value={handle} onChange={(e) => setHandle(e.target.value)} />
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor="page-category">
              Category <span className="font-normal text-muted-foreground">(optional)</span>
            </Label>
            <Input id="page-category" placeholder="e.g. Food, Travel, Meme page" maxLength={40} value={category} onChange={(e) => setCategory(e.target.value)} />
          </div>
        </div>
        {add.isError && (
          <p className="text-small text-danger-helper" role="alert">
            {add.error instanceof ApiError || add.error instanceof Error ? add.error.message : "Couldn't add the page. Try again."}
          </p>
        )}
        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => {
              onOpenChange(false);
              add.reset();
            }}
          >
            Cancel
          </Button>
          <Button disabled={!handle.trim().replace(/^@+/, "") || add.isPending} onClick={() => add.mutate()}>
            Add page
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** Rate badges in the app's format order (Reel, Story, Static / Carousel, …); older formats last. */
function rank(format: string) {
  const i = (FORMATS as readonly string[]).indexOf(format);
  return i === -1 ? FORMATS.length : i;
}
