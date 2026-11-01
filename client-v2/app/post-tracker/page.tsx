"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { motion } from "motion/react";
import { toast } from "sonner";
import { Search, Smartphone } from "lucide-react";

import { useAuth } from "@/lib/auth-context";
import { hasAccess, postTracker as postTrackerApi, type TrackedPostStatus } from "@/lib/api-client";
import { isFullAdmin } from "@/lib/settings";
import { cn } from "@/lib/utils";
import { AppShell } from "@/components/layout/app-shell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { errorMessage, fadeRise } from "@/components/bulk-track/shared";
import { PasteLinks } from "@/components/post-tracker/paste-links";
import { SnapshotCard } from "@/components/post-tracker/snapshot-card";

const PAGE_SIZE = 24;
const TABS: { key: TrackedPostStatus; label: string }[] = [
  { key: "all", label: "All" },
  { key: "ok", label: "OK" },
  { key: "broken", label: "Broken" },
  { key: "archived", label: "Archived" },
];

/**
 * Post Tracker (24 Oct): paste public Instagram reel/post links; the server
 * takes two snapshots of each as a logged-out phone visitor sees it (the reel
 * screen, and its likes/comments). Kept apart from campaign posts, plans and payouts. Gated on the opt-in
 * `postTracker.view` key (server-enforced on every /api/post-tracker route;
 * this redirect is only UI).
 */
export default function PostTrackerPage() {
  return (
    <AppShell active="post-tracker">
      <PostTrackerContent />
    </AppShell>
  );
}

function PostTrackerContent() {
  const { user, accessToken } = useAuth();
  const token = accessToken!;
  const router = useRouter();
  const allowed = hasAccess(user, "postTracker.view");
  const seesAll = isFullAdmin(user);

  useEffect(() => {
    if (user && !allowed) router.replace("/dashboard");
  }, [user, allowed, router]);

  const qc = useQueryClient();
  const [status, setStatus] = useState<TrackedPostStatus>("all");
  const [search, setSearch] = useState("");
  const [q, setQ] = useState("");
  const [page, setPage] = useState(1);

  useEffect(() => {
    const t = window.setTimeout(() => {
      setQ(search.trim());
      setPage(1);
    }, 300);
    return () => window.clearTimeout(t);
  }, [search]);

  const { data, isLoading, isError } = useQuery({
    queryKey: ["post-tracker", status, q, page],
    queryFn: () => postTrackerApi.list(token, { status, q: q || undefined, page, pageSize: PAGE_SIZE }),
    enabled: allowed && !!accessToken,
    placeholderData: (prev) => prev,
    // Snapshots are taken in the background, one at a time — poll until they land.
    refetchInterval: (query) => (query.state.data?.items.some((p) => p.snapshot.status === "queued") ? 5000 : false),
  });

  const invalidate = () => qc.invalidateQueries({ queryKey: ["post-tracker"] });

  const update = useMutation({
    mutationFn: ({ id, patch }: { id: string; patch: { broken?: boolean; archived?: boolean } }) => postTrackerApi.update(token, id, patch),
    onSuccess: (_post, { patch }) => {
      invalidate();
      if (patch.archived !== undefined) toast.success(patch.archived ? "Archived" : "Restored");
    },
    onError: (err) => toast.error(errorMessage(err, "Couldn't save that — try again.")),
  });

  const recapture = useMutation({
    mutationFn: (id: string) => postTrackerApi.recapture(token, id),
    onSuccess: () => {
      invalidate();
      toast.success("Taking a new snapshot");
    },
    onError: (err) => toast.error(errorMessage(err, "Couldn't start a new snapshot — try again.")),
  });

  const remove = useMutation({
    mutationFn: (id: string) => postTrackerApi.remove(token, id),
    onSuccess: () => {
      invalidate();
      toast.success("Deleted");
    },
    onError: (err) => toast.error(errorMessage(err, "Couldn't delete that — try again.")),
  });

  const items = data?.items ?? [];
  const pages = data ? Math.max(1, Math.ceil(data.total / PAGE_SIZE)) : 1;

  // Archiving the last card on the last page shouldn't strand the view past the end.
  useEffect(() => {
    if (page > pages) setPage(pages);
  }, [page, pages]);

  if (!allowed) return null;

  return (
    <div className="flex flex-col pt-2 pb-20">
      <motion.div {...fadeRise(0)} className="page-heading mb-6 items-center">
        <div className="page-symbol">
          <Smartphone className="h-4 w-4 text-info-fg" />
        </div>
        <div>
          <h1 className="text-display text-foreground">Post Tracker</h1>
          <p className="mt-1 text-body text-muted-foreground">Paste public Instagram reel or post links. Each gets two snapshots: the reel as a phone shows it, and its likes and comments.</p>
        </div>
      </motion.div>

      <PasteLinks
        onAdd={async (body) => {
          const res = await postTrackerApi.add(token, body);
          if (res.created || res.existing) {
            setStatus("all");
            setPage(1);
          }
          invalidate();
          return res;
        }}
      />

      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-1.5" role="tablist">
          {TABS.map((t) => (
            <button
              key={t.key}
              type="button"
              role="tab"
              aria-selected={status === t.key}
              onClick={() => {
                setStatus(t.key);
                setPage(1);
              }}
              className={cn(
                "rounded-pill border px-3.5 py-1.5 text-caption transition-colors",
                status === t.key ? "border-info bg-info-soft text-info-fg" : "border-border text-muted-foreground hover:text-foreground"
              )}
            >
              {t.label}
              {data?.counts && <span className="num ml-1.5">{data.counts[t.key]}</span>}
            </button>
          ))}
        </div>
        <label className="relative w-full sm:w-64">
          <span className="sr-only">Search notes</span>
          <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" aria-hidden />
          <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search notes or post code" className="pl-9" />
        </label>
      </div>

      {isLoading ? (
        <p className="py-12 text-center text-body text-muted-foreground">Loading…</p>
      ) : isError ? (
        <p className="py-12 text-center text-body text-danger-fg">Couldn&apos;t load your posts. Refresh the page to try again.</p>
      ) : items.length === 0 ? (
        <p className="py-12 text-center text-body text-muted-foreground">
          {q ? "Nothing matches that search." : status === "all" ? "No links yet. Paste one above to get its snapshots." : "Nothing here."}
        </p>
      ) : (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2 2xl:grid-cols-3" data-testid="post-tracker-grid">
          {items.map((post, i) => (
            <SnapshotCard
              key={post.id}
              post={post}
              index={i}
              showOwner={seesAll}
              busy={(update.isPending && update.variables?.id === post.id) || (remove.isPending && remove.variables === post.id) || (recapture.isPending && recapture.variables === post.id)}
              onUpdate={(patch) => update.mutate({ id: post.id, patch })}
              onRecapture={() => recapture.mutate(post.id)}
              onDelete={() => remove.mutate(post.id)}
            />
          ))}
        </div>
      )}

      {pages > 1 && (
        <div className="mt-6 flex items-center justify-center gap-3">
          <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>
            Previous
          </Button>
          <span className="num text-caption text-muted-foreground">
            Page {page} of {pages}
          </span>
          <Button variant="outline" size="sm" disabled={page >= pages} onClick={() => setPage((p) => p + 1)}>
            Next
          </Button>
        </div>
      )}
    </div>
  );
}
