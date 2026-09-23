"use client";

import { useEffect, useRef } from "react";

import { cn } from "@/lib/utils";
import { PERMISSION_SECTIONS, type PermissionAction, type PermissionKey, type PermissionSection, type Permissions, type Role } from "@/lib/api-client";

/**
 * Per-section access editor (user request, 23 Sep — "user selects Invoices,
 * then checkboxes for edit, approve … appear below"). One row per section:
 * the row's own checkbox *is* that section's `view` key; checking it expands
 * the section's other actions beneath it, unchecking it clears them all and
 * collapses. Mirrors the server's key model in lib/permissions.js (edit /
 * approve / pay each imply view), so what's shown is exactly what's stored.
 */
export const SECTION_META: Record<PermissionSection, { label: string; view: string; actions: Partial<Record<PermissionAction, { label: string; hint: string }>> }> = {
  users: {
    label: "People",
    view: "See every account",
    actions: { edit: { label: "Edit", hint: "Create accounts, change roles, reset passwords, edit access" } },
  },
  campaigns: {
    label: "Campaigns",
    view: "See every campaign and its full assignment sheet",
    actions: { edit: { label: "Edit", hint: "Create and edit campaigns, phases, assignments, sheet import" } },
  },
  inventory: {
    label: "Inventory",
    view: "See every page",
    actions: {
      edit: { label: "Edit", hint: "Add pages for any creator, rate cards, refresh, import" },
      approve: { label: "Approve", hint: "Approve or reject pages" },
    },
  },
  links: {
    label: "Link review",
    view: "See every posted link",
    actions: {
      edit: { label: "Edit", hint: "Revise cost, bulk import, mark invalid, refresh metrics" },
      approve: { label: "Approve", hint: "Approve screenshots and insights" },
    },
  },
  finance: {
    label: "Finance",
    view: "See every invoice and billing profile",
    actions: {
      edit: { label: "Edit", hint: "GST / payment status, billing details, invoice numbering, exports" },
      approve: { label: "Approve", hint: "Sign off a raised invoice" },
      pay: { label: "Pay", hint: "Mark paid, reject, approve bank details" },
    },
  },
  plans: {
    label: "Plans",
    view: "See every plan and saved client",
    actions: {
      edit: { label: "Edit", hint: "Create, edit and delete any plan, sheets, client invoice" },
      approve: { label: "Approve", hint: "Approve or reject any plan" },
    },
  },
};

export const SECTION_ORDER = Object.keys(PERMISSION_SECTIONS) as PermissionSection[];

const keyOf = (section: PermissionSection, action: PermissionAction) => `${section}.${action}` as PermissionKey;
const actionsOf = (section: PermissionSection) => PERMISSION_SECTIONS[section].filter((a) => a !== "view") as PermissionAction[];

/** "View · Pay" — what's on in a section, for the collapsed row and the read-only summary. */
export function sectionSummary(section: PermissionSection, value: Partial<Permissions>) {
  if (!value[keyOf(section, "view")]) return "Off";
  const on = actionsOf(section).filter((a) => value[keyOf(section, a)]);
  return ["View", ...on.map((a) => SECTION_META[section].actions[a]?.label ?? a)].join(" · ");
}

function IndeterminateCheckbox({ indeterminate, ...props }: React.InputHTMLAttributes<HTMLInputElement> & { indeterminate?: boolean }) {
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (ref.current) ref.current.indeterminate = !!indeterminate && !props.checked;
  }, [indeterminate, props.checked]);
  return <input ref={ref} type="checkbox" {...props} />;
}

export function AccessEditor({
  value,
  onChange,
  role,
  disabled,
}: {
  value: Permissions;
  onChange: (next: Permissions) => void;
  /** Only used for copy — a Finance account's baseline sections read differently from a sub-admin's. */
  role?: Role;
  disabled?: boolean;
}) {
  function setSection(section: PermissionSection, on: boolean) {
    const next = { ...value };
    next[keyOf(section, "view")] = on;
    if (!on) for (const a of actionsOf(section)) next[keyOf(section, a)] = false;
    onChange(next);
  }
  function setAction(section: PermissionSection, action: PermissionAction, on: boolean) {
    const next = { ...value, [keyOf(section, action)]: on } as Permissions;
    if (on) next[keyOf(section, "view")] = true;
    onChange(next);
  }

  return (
    <div className="flex flex-col gap-2" data-testid="access-editor">
      {SECTION_ORDER.map((section) => {
        const meta = SECTION_META[section];
        const actions = actionsOf(section);
        const viewOn = value[keyOf(section, "view")] === true;
        const onCount = actions.filter((a) => value[keyOf(section, a)]).length;
        const allOn = viewOn && onCount === actions.length;
        const summary = sectionSummary(section, value);
        return (
          <div key={section} className={cn("rounded-md border border-border", viewOn && "bg-surface-2/40")} data-testid={`access-section-${section}`}>
            <label className="flex cursor-pointer items-center gap-3 p-3 hover:bg-surface-2">
              <IndeterminateCheckbox
                checked={viewOn}
                indeterminate={viewOn && !allOn}
                disabled={disabled}
                aria-expanded={viewOn}
                aria-label={`${meta.label} access`}
                onChange={(e) => setSection(section, e.target.checked)}
                className="h-4 w-4 shrink-0 accent-accent"
              />
              <span className="min-w-0 flex-1">
                <span className="block text-[0.8125rem] font-semibold text-text">{meta.label}</span>
                <span className="block text-[0.75rem] text-text-muted">{meta.view}</span>
              </span>
              <span className={cn("shrink-0 rounded-full px-2 py-0.5 text-[0.7rem] font-medium", viewOn ? "bg-ink text-white" : "bg-surface-2 text-text-faint")} data-testid={`access-summary-${section}`}>
                {summary}
              </span>
            </label>
            {viewOn && (
              <fieldset className="flex flex-col gap-1 border-t border-border px-3 py-2 pl-10" data-testid={`access-actions-${section}`}>
                <legend className="sr-only">{meta.label} actions</legend>
                {actions.map((action) => {
                  const a = meta.actions[action];
                  return (
                    <label key={action} className="flex cursor-pointer items-start gap-3 rounded-md px-2 py-1.5 hover:bg-surface-2">
                      <input
                        type="checkbox"
                        checked={value[keyOf(section, action)] === true}
                        disabled={disabled}
                        onChange={(e) => setAction(section, action, e.target.checked)}
                        aria-label={`${meta.label}: ${a?.label ?? action}`}
                        className="mt-0.5 h-4 w-4 shrink-0 accent-accent"
                      />
                      <span className="text-[0.8125rem] text-text">
                        <span className="font-medium">{a?.label ?? action}</span>
                        {a?.hint && <span className="text-text-muted"> — {a.hint}</span>}
                      </span>
                    </label>
                  );
                })}
              </fieldset>
            )}
          </div>
        );
      })}
      {role && role !== "ADMIN" && (
        <p className="text-[0.72rem] text-text-faint">Unchecked sections stay at a plain {role === "FINANCE" ? "Finance" : role === "PLAN_MAKER" ? "Plan maker" : role.toLowerCase()} account&apos;s normal access.</p>
      )}
    </div>
  );
}

/** Read-only version for the person detail panel: one line per section with its summary chip. */
export function AccessSummary({ value }: { value: Partial<Permissions> }) {
  return (
    <div className="flex flex-col gap-1.5" data-testid="access-summary">
      {SECTION_ORDER.map((section) => {
        const summary = sectionSummary(section, value);
        const on = summary !== "Off";
        return (
          <div key={section} className="flex items-center justify-between gap-3 text-[0.8125rem]">
            <span className="text-text-2">{SECTION_META[section].label}</span>
            <span className={cn("rounded-full px-2 py-0.5 text-[0.7rem] font-medium", on ? "bg-ink text-white" : "bg-surface-2 text-text-faint")}>{summary}</span>
          </div>
        );
      })}
    </div>
  );
}
