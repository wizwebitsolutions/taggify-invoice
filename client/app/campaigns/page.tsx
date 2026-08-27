"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { RequireAuth } from "@/components/auth/require-auth";
import { AppShell } from "@/components/layout/app-shell";
import { Button } from "@/components/ui/button";
import { Sheet } from "@/components/ui/sheet";
import { Field, TextField } from "@/components/ui/form-field";
import { TableSkeleton, EmptyState, ErrorNotice } from "@/components/ui/table-parts";
import { UploadLinksModal } from "@/components/links/upload-links-modal";
import { PlusIcon, CampaignIcon } from "@/components/icons";
import { useAuth } from "@/lib/auth-context";
import { campaigns as campaignsApi, assets as assetsApi, ApiError, type Campaign } from "@/lib/api-client";
import { initialsOf, roleLabel } from "@/lib/format";

export default function CampaignsPage() {
  return (
    <RequireAuth>
      <CampaignsContent />
    </RequireAuth>
  );
}

function CampaignsContent() {
  const { user, accessToken } = useAuth();
  const queryClient = useQueryClient();
  const [showForm, setShowForm] = useState(false);
  const [uploadCampaign, setUploadCampaign] = useState<Campaign | null>(null);
  const token = accessToken!;

  const campaignsQuery = useQuery({ queryKey: ["campaigns"], queryFn: () => campaignsApi.list(token) });
  const assetsQuery = useQuery({ queryKey: ["assets"], queryFn: () => assetsApi.list(token) });
  const items = campaignsQuery.data ?? [];
  const canCreate = user?.role === "ADMIN";
  const canUploadLinks = user?.role === "CREATOR" || user?.role === "TEAM_MEMBER";

  return (
    <AppShell
      active="campaigns"
      user={{ initials: initialsOf(user?.name), name: user?.name ?? "—", role: roleLabel(user?.role), tone: user?.role === "FINANCE" ? "blue" : "emerald" }}
      searchPlaceholder="Search campaigns…"
      topbarActions={
        canCreate ? (
          <Button size="default" onClick={() => setShowForm(true)}>
            <PlusIcon className="h-[15px] w-[15px] text-accent-ink" />
            New campaign
          </Button>
        ) : undefined
      }
    >
      <div className="flex flex-col gap-7">
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="mb-1.5 text-[0.6875rem] font-bold uppercase tracking-[0.08em] text-text-faint">Work</p>
            <h1 className="mb-1.5 text-[1.625rem] font-bold">Campaigns</h1>
            <p className="text-[0.9375rem] text-text-muted">Brand deals assigned to your pages.</p>
          </div>
          {/* Desktop carries this same action in the topbar (hidden below md). */}
          {canCreate && (
            <Button size="icon" className="shrink-0 md:hidden" onClick={() => setShowForm(true)} aria-label="New campaign">
              <PlusIcon className="h-4 w-4 text-accent-ink" />
            </Button>
          )}
        </div>

        {campaignsQuery.isLoading ? (
          <div className="rounded-lg border border-border bg-surface shadow-card">
            <TableSkeleton />
          </div>
        ) : items.length === 0 ? (
          <div className="rounded-lg border border-border bg-surface shadow-card">
            <EmptyState label="No campaigns yet." />
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {items.map((c) => (
              <div key={c.id} className="flex flex-col gap-4 rounded-lg border border-border bg-surface p-5 shadow-card">
                <div className="flex h-9 w-9 items-center justify-center rounded-[10px] bg-surface-2">
                  <CampaignIcon className="h-4 w-4 text-text-muted" />
                </div>
                <div>
                  <p className="text-xs font-semibold text-text-faint">{c.brandName}</p>
                  <p className="mt-1 text-[0.9375rem] font-bold leading-snug">{c.title}</p>
                </div>
                <div className="flex items-center justify-between text-xs text-text-faint">
                  <span>Created {new Date(c.createdAt).toLocaleDateString()}</span>
                  {c.deadline && (
                    <span className={new Date(c.deadline) < new Date() ? "font-semibold text-rose" : "font-semibold text-text-muted"}>
                      Deadline {new Date(c.deadline).toLocaleDateString()}
                    </span>
                  )}
                </div>
                {canUploadLinks && (
                  <Button size="sm" variant="secondary" className="w-full" onClick={() => setUploadCampaign(c)}>
                    Upload Links
                  </Button>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      {showForm && (
        <NewCampaignModal
          token={token}
          onClose={() => setShowForm(false)}
          onCreated={() => {
            setShowForm(false);
            queryClient.invalidateQueries({ queryKey: ["campaigns"] });
          }}
        />
      )}

      {uploadCampaign && (
        <UploadLinksModal
          token={token}
          campaigns={[uploadCampaign]}
          initialCampaignId={uploadCampaign.id}
          assets={assetsQuery.data ?? []}
          onClose={() => setUploadCampaign(null)}
          onCreated={() => {
            setUploadCampaign(null);
            queryClient.invalidateQueries({ queryKey: ["links"] });
          }}
        />
      )}
    </AppShell>
  );
}

function NewCampaignModal({ token, onClose, onCreated }: { token: string; onClose: () => void; onCreated: () => void }) {
  const [brandName, setBrandName] = useState("");
  const [title, setTitle] = useState("");
  const [deadline, setDeadline] = useState("");

  const createMutation = useMutation({
    mutationFn: () => campaignsApi.create(token, brandName, title, deadline || undefined),
    onSuccess: onCreated,
  });

  return (
    <Sheet onClose={onClose} panelClassName="md:max-w-[420px]">
      <form
        onSubmit={(e) => {
          e.preventDefault();
          createMutation.mutate();
        }}
        className="flex flex-col gap-5 overflow-y-auto p-6 pt-1"
      >
        <h2 className="text-lg font-bold">New campaign</h2>
        <Field label="Brand name">
          <TextField required value={brandName} onChange={setBrandName} placeholder="e.g. Solmate Coffee" />
        </Field>
        <Field label="Campaign title">
          <TextField required value={title} onChange={setTitle} placeholder="e.g. Solmate Coffee × Launch Week" />
        </Field>
        <Field label="Deadline (optional)">
          <TextField type="date" value={deadline} onChange={setDeadline} />
        </Field>
        {createMutation.isError && (
          <ErrorNotice message={createMutation.error instanceof ApiError ? createMutation.error.message : "Couldn't create the campaign."} />
        )}
        <div className="flex gap-2.5">
          <Button type="button" variant="ghost" className="flex-1" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" className="flex-1" disabled={createMutation.isPending}>
            {createMutation.isPending ? "Creating…" : "Create campaign"}
          </Button>
        </div>
      </form>
    </Sheet>
  );
}
