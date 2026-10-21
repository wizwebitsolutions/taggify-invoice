"use client";

import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Plus } from "lucide-react";

import { useAuth } from "@/lib/auth-context";
import { admin as adminApi, type Role, type User } from "@/lib/api-client";
import { accessTag,canEditAccessOf, canEditPeople, ROLE_NAMES, ROLES } from "@/lib/settings";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { EmptyState } from "@/components/taggify/illustration";
import { FilterSelect } from "@/components/taggify/filter-select";
import { SearchField } from "@/components/taggify/search-field";
import { StatusPill } from "@/components/taggify/status-pill";
import { UserAvatar } from "@/components/taggify/user-avatar";
import { Pager, PER_PAGE } from "@/components/finance/pager";
import { LoadError } from "@/components/finance/states";
import { AddPersonDialog } from "@/components/settings/add-person-dialog";
import { PersonSheet } from "@/components/settings/person-sheet";

const joined = (iso?: string) => (iso ? new Date(iso).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" }) : "—");

export const usePeople = (enabled: boolean) => {
  const { accessToken } = useAuth();
  return useQuery({ queryKey: ["adminUsers"], queryFn: () => adminApi.users(accessToken!), enabled: !!accessToken && enabled });
};

/**
 * People & access (prototype S.settings): every account, its role and what it can
 * do. GET /admin/users is one unpaged list, so search, role filter and paging run
 * here. Opening a row shows the person sheet; changes need users.edit.
 */
export function PeopleTab() {
  const { user } = useAuth();
  const people = usePeople(true);
  const [q, setQ] = useState("");
  const [role, setRole] = useState<"all" | Role>("all");
  const [page, setPage] = useState(1);
  const [openId, setOpenId] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const editable = canEditPeople(user);

  const all = useMemo(() => people.data ?? [], [people.data]);
  const needle = q.trim().toLowerCase();
  const rows = all.filter((u) => (role === "all" || u.role === role) && (!needle || `${u.name ?? ""} ${u.email ?? ""} ${u.phoneNumber ?? ""}`.toLowerCase().includes(needle)));
  const pages = Math.max(1, Math.ceil(rows.length / PER_PAGE));
  useEffect(() => {
    if (page > pages) setPage(pages);
  }, [page, pages]);
  const current = Math.min(page, pages);
  const shown = rows.slice((current - 1) * PER_PAGE, current * PER_PAGE);
  // Looked up by id so the sheet shows fresh data after a save.
  const open = all.find((u) => u.id === openId) ?? null;

  return (
    <>
      <div className="flex flex-wrap items-center gap-2 border-t px-5 py-4">
        <SearchField
          label="Search people"
          placeholder="Search name or email..."
          className="w-full sm:w-80"
          value={q}
          onChange={(e) => {
            setQ(e.target.value);
            setPage(1);
          }}
        />
        <FilterSelect
          label="Role"
          value={role}
          onValueChange={(v) => {
            setRole(v as "all" | Role);
            setPage(1);
          }}
          options={[{ value: "all", label: "All" }, ...ROLES.map((r) => ({ value: r, label: ROLE_NAMES[r] }))]}
        />
        {editable && (
          <Button className="sm:ml-auto" onClick={() => setAdding(true)}>
            <Plus />
            Add person
          </Button>
        )}
      </div>

      {people.isError ? (
        <LoadError onRetry={() => people.refetch()} what="people" />
      ) : people.isLoading ? (
        <div className="flex flex-col gap-3 px-5 pb-5" aria-busy="true" aria-label="Loading people">
          {Array.from({ length: 5 }, (_, i) => (
            <Skeleton key={i} className="h-12" />
          ))}
        </div>
      ) : rows.length === 0 ? (
        <EmptyState name="empty-search" title={all.length === 0 ? "No one here yet" : "No one matches"}>
          {all.length === 0 ? "Add the first person to give them a login." : "Try another name, or clear the role filter."}
        </EmptyState>
      ) : (
        <>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Person</TableHead>
                <TableHead>Role</TableHead>
                <TableHead className="hidden lg:table-cell">Joined</TableHead>
                <TableHead className="text-right">
                  <span className="sr-only">Actions</span>
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {shown.map((u) => (
                <PersonRow key={u.id} person={u} me={u.id === user?.id} canEdit={canEditAccessOf(user, u)} onOpen={() => setOpenId(u.id)} />
              ))}
            </TableBody>
          </Table>
          <Pager total={rows.length} page={current} pages={pages} noun={rows.length === 1 ? "person" : "people"} onPage={setPage} />
        </>
      )}

      <PersonSheet person={open} onClose={() => setOpenId(null)} />
      {editable && <AddPersonDialog open={adding} onClose={() => setAdding(false)} />}
    </>
  );
}

function PersonRow({ person: u, me, canEdit, onOpen }: { person: User; me: boolean; canEdit: boolean; onOpen: () => void }) {
  const tag = accessTag(u);
  return (
    <TableRow>
      <TableCell>
        <div className="flex min-w-0 items-center gap-3">
          <UserAvatar name={u.name ?? u.email} size="sm" />
          <span className="min-w-0">
            <span className="block truncate text-body-strong">
              {u.name?.trim() || u.email || u.phoneNumber || "—"}
              {me && <span className="font-normal text-muted-foreground"> (you)</span>}
            </span>
            {u.name?.trim() && <span className="block truncate text-small text-muted-foreground">{u.email ?? u.phoneNumber}</span>}
          </span>
        </div>
      </TableCell>
      <TableCell>
        <div className="flex flex-wrap items-center gap-1.5">
          <StatusPill tone="neutral">{ROLE_NAMES[u.role]}</StatusPill>
          {tag && <StatusPill tone="warning">{tag}</StatusPill>}
        </div>
      </TableCell>
      <TableCell className="hidden whitespace-nowrap text-small text-muted-foreground lg:table-cell">{joined(u.createdAt)}</TableCell>
      <TableCell className="text-right">
        <Button variant="outline" size="sm" onClick={onOpen} aria-label={`${canEdit ? "Edit access for" : "View"} ${u.name?.trim() || u.email || "this person"}`}>
          {canEdit ? "Edit access" : "View"}
        </Button>
      </TableCell>
    </TableRow>
  );
}
