"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Plus } from "lucide-react";

import { useAuth } from "@/lib/auth-context";
import { ApiError, users as usersApi, type TeamMembership } from "@/lib/api-client";
import { canManageTeam } from "@/lib/settings";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Field } from "@/components/taggify/field";
import { EmptyState } from "@/components/taggify/illustration";
import { StatusPill } from "@/components/taggify/status-pill";
import { LoadError } from "@/components/finance/states";

const errText = (e: unknown, fallback: string) =>
  e instanceof ApiError ? (e.code === "INVALID_TEAM_MEMBER" ? "No team member account has that user ID. Ask an admin to create one with the Team member role first." : e.message) : fallback;
const added = (iso: string) => new Date(iso).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });

/**
 * My team (creators only; v1 /team): team members who help run this creator's
 * pages and posts. GET/POST /users/me/team are CREATOR-only and gated on the
 * own users.view / users.edit switches. The server only returns user IDs, and
 * POST is an upsert, so "Change money access" re-sends the same member.
 */
export function TeamTab({ bare = false }: { bare?: boolean }) {
  const { user, accessToken } = useAuth();
  const qc = useQueryClient();
  const canManage = canManageTeam(user);
  const [adding, setAdding] = useState(false);
  const team = useQuery({ queryKey: ["team"], queryFn: () => usersApi.team(accessToken!), enabled: !!accessToken });

  const setMoney = useMutation({
    mutationFn: (m: TeamMembership) => usersApi.addTeamMember(accessToken!, m.userId, !m.canSeeMoney),
    onSuccess: (m) => toast.success(m.canSeeMoney ? "They can now see invoices and payment amounts." : "They can no longer see invoices and payment amounts."),
    onError: (e) => toast.error(errText(e, "Couldn't change their access.")),
    onSettled: () => qc.invalidateQueries({ queryKey: ["team"] }),
  });

  const rows = team.data ?? [];

  return (
    <section aria-labelledby="team-title" className={bare ? "ledger-panel rounded-card border bg-card" : "border-t"}>
      <div className="panel-heading justify-between">
        <div>
          <h2 id="team-title" className="text-card-title">
            My team
          </h2>
          <p className="mt-1 text-small text-muted-foreground">People who help run your pages and submit posts for you.</p>
        </div>
        {canManage && (
          <Button onClick={() => setAdding(true)}>
            <Plus />
            Add member
          </Button>
        )}
      </div>

      {team.isError ? (
        <LoadError onRetry={() => team.refetch()} what="your team" />
      ) : team.isLoading ? (
        <div className="flex flex-col gap-3 px-5 pb-5" aria-busy="true" aria-label="Loading your team">
          {Array.from({ length: 3 }, (_, i) => (
            <Skeleton key={i} className="h-12" />
          ))}
        </div>
      ) : rows.length === 0 ? (
        <EmptyState name="team-01" title="No team members yet">
          {canManage ? "Add someone with a Team member login to let them submit posts for your pages." : "Ask an admin if you need to add someone."}
        </EmptyState>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Member</TableHead>
              <TableHead>Money</TableHead>
              <TableHead className="hidden sm:table-cell">Added</TableHead>
              {canManage && (
                <TableHead className="text-right">
                  <span className="sr-only">Actions</span>
                </TableHead>
              )}
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((m) => (
              <TableRow key={m.id}>
                <TableCell className="max-w-0 text-small">
                  {/* Name and email when the server sends them; the id is the fallback (and how they were added). */}
                  {m.user?.name?.trim() || m.user?.email ? (
                    <>
                      <span className="block truncate font-semibold text-fg-strong">{m.user?.name?.trim() || m.user?.email}</span>
                      {m.user?.name?.trim() && m.user?.email && <span className="block truncate text-muted-foreground">{m.user.email}</span>}
                    </>
                  ) : (
                    <span className="num block truncate text-fg-strong">{m.userId}</span>
                  )}
                </TableCell>
                <TableCell>{m.canSeeMoney ? <StatusPill tone="success">Can see amounts</StatusPill> : <StatusPill tone="neutral">Hidden</StatusPill>}</TableCell>
                <TableCell className="hidden whitespace-nowrap text-small text-muted-foreground sm:table-cell">{added(m.createdAt)}</TableCell>
                {canManage && (
                  <TableCell className="text-right">
                    <Button variant="outline" size="sm" disabled={setMoney.isPending} onClick={() => setMoney.mutate(m)}>
                      {m.canSeeMoney ? "Hide amounts" : "Show amounts"}
                    </Button>
                  </TableCell>
                )}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}

      {canManage && <AddMemberDialog open={adding} onClose={() => setAdding(false)} />}
    </section>
  );
}

function AddMemberDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent>{open && <AddMemberForm onClose={onClose} />}</DialogContent>
    </Dialog>
  );
}

function AddMemberForm({ onClose }: { onClose: () => void }) {
  const { accessToken } = useAuth();
  const qc = useQueryClient();
  const [userId, setUserId] = useState("");
  const [canSeeMoney, setCanSeeMoney] = useState(false);
  const add = useMutation({
    mutationFn: () => usersApi.addTeamMember(accessToken!, userId.trim(), canSeeMoney),
    onSuccess: () => {
      toast.success("Team member added.");
      qc.invalidateQueries({ queryKey: ["team"] });
      onClose();
    },
  });

  return (
    <form
      className="flex flex-col gap-5"
      onSubmit={(e) => {
        e.preventDefault();
        if (userId.trim()) add.mutate();
      }}
    >
      <DialogHeader>
        <DialogTitle>Add a team member</DialogTitle>
        <DialogDescription>They need a login with the Team member role first. Ask your admin for their user ID.</DialogDescription>
      </DialogHeader>
      <Field label="Their user ID" error={add.isError ? errText(add.error, "Couldn't add this member.") : null}>
        {(a) => <Input {...a} required autoComplete="off" spellCheck={false} value={userId} onChange={(e) => setUserId(e.target.value)} />}
      </Field>
      <div className="flex items-center gap-3 rounded-card border p-4">
        <div className="min-w-0 flex-1">
          <Label htmlFor="team-money" className="text-body-strong">
            Can see money
          </Label>
          <p className="text-small text-muted-foreground">Invoices and payment amounts. You can change this later.</p>
        </div>
        <Switch id="team-money" checked={canSeeMoney} onCheckedChange={setCanSeeMoney} />
      </div>
      <DialogFooter>
        <Button type="button" variant="ghost" onClick={onClose}>
          Cancel
        </Button>
        <Button type="submit" disabled={!userId.trim() || add.isPending}>
          {add.isPending ? "Adding…" : "Add member"}
        </Button>
      </DialogFooter>
    </form>
  );
}
