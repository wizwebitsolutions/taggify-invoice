"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { RequireAuth } from "@/components/auth/require-auth";
import { AppShell } from "@/components/layout/app-shell";
import { Button } from "@/components/ui/button";
import { Field, TextField } from "@/components/ui/form-field";
import { TableSkeleton, EmptyState, ErrorNotice } from "@/components/ui/table-parts";
import { PlusIcon, CampaignIcon } from "@/components/icons";
import { useAuth } from "@/lib/auth-context";
import { campaigns as campaignsApi, ApiError } from "@/lib/api-client";
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
  const token = accessToken!;

  const campaignsQuery = useQuery({ queryKey: ["campaigns"], queryFn: () => campaignsApi.list(token) });
  const items = campaignsQuery.data ?? [];
  const canCreate = user?.role === "ADMIN";

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
        <div>
          <p className="mb-1.5 text-[0.6875rem] font-bold uppercase tracking-[0.08em] text-text-faint">Work</p>
          <h1 className="mb-1.5 text-[1.625rem] font-bold">Campaigns</h1>
          <p className="text-[0.9375rem] text-text-muted">Brand deals assigned to your pages.</p>
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
          <div className="grid grid-cols-3 gap-4">
            {items.map((c) => (
              <div key={c.id} className="flex flex-col gap-4 rounded-lg border border-border bg-surface p-5 shadow-card">
                <div className="flex h-9 w-9 items-center justify-center rounded-[10px] bg-surface-2">
                  <CampaignIcon className="h-4 w-4 text-text-muted" />
                </div>
                <div>
                  <p className="text-xs font-semibold text-text-faint">{c.brandName}</p>
                  <p className="mt-1 text-[0.9375rem] font-bold leading-snug">{c.title}</p>
                </div>
                <p className="text-xs text-text-faint">Created {new Date(c.createdAt).toLocaleDateString()}</p>
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
    </AppShell>
  );
}

function NewCampaignModal({ token, onClose, onCreated }: { token: string; onClose: () => void; onCreated: () => void }) {
  const [brandName, setBrandName] = useState("");
  const [title, setTitle] = useState("");

  const createMutation = useMutation({
    mutationFn: () => campaignsApi.create(token, brandName, title),
    onSuccess: onCreated,
  });

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-6" onClick={onClose}>
      <form
        onClick={(e) => e.stopPropagation()}
        onSubmit={(e) => {
          e.preventDefault();
          createMutation.mutate();
        }}
        className="flex w-full max-w-[420px] flex-col gap-5 rounded-lg border border-border bg-surface p-6 shadow-card"
      >
        <h2 className="text-lg font-bold">New campaign</h2>
        <Field label="Brand name">
          <TextField required value={brandName} onChange={setBrandName} placeholder="e.g. Solmate Coffee" />
        </Field>
        <Field label="Campaign title">
          <TextField required value={title} onChange={setTitle} placeholder="e.g. Solmate Coffee × Launch Week" />
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
    </div>
  );
}
