"use client";

import { useId } from "react";

import { isOwnScopeRole, type PermissionAction, type PermissionSection, type Permissions, type Role } from "@/lib/api-client";
import { actionsOf, keyOf, metaFor, sectionsFor, sectionSummary } from "@/lib/settings";
import { cn } from "@/lib/utils";
import { Checkbox } from "@/components/ui/checkbox";

/**
 * Per-section access (server lib/permissions.js): the section's own box is its
 * `view` key; ticking it shows the section's actions. edit / approve / pay each
 * imply view, so what's shown is exactly what the server stores.
 */
export function AccessEditor({ value, onChange, role, disabled }: { value: Permissions; onChange: (next: Permissions) => void; role: Role; disabled?: boolean }) {
  const uid = useId();
  function setSection(section: PermissionSection, on: boolean) {
    const next = { ...value, [keyOf(section, "view")]: on };
    if (!on) for (const a of actionsOf(section, role)) next[keyOf(section, a)] = false;
    onChange(next);
  }
  function setAction(section: PermissionSection, action: PermissionAction, on: boolean) {
    const next = { ...value, [keyOf(section, action)]: on };
    if (on) next[keyOf(section, "view")] = true;
    onChange(next);
  }

  return (
    <div className="flex flex-col gap-3" data-testid="access-editor">
      {isOwnScopeRole(role) && <p className="text-small text-muted-foreground">Only ever their own content. Nothing here opens anyone else&apos;s. Everything starts on; untick what they shouldn&apos;t have.</p>}
      {/* One list, one row per section (2nd check #3): no box-in-box, actions indented under their section. */}
      <div className="divide-y rounded-card border">
      {sectionsFor(role).map((section) => {
        const meta = metaFor(section, role);
        const actions = actionsOf(section, role);
        const viewOn = value[keyOf(section, "view")] === true;
        const id = `${uid}-${section}`;
        return (
          <div key={section}>
            <div className="flex items-start gap-3 px-4 py-3.5">
              <Checkbox
                id={id}
                checked={viewOn}
                disabled={disabled}
                aria-label={`${meta.label} access`}
                className="mt-0.5"
                // The box is the section's view; the summary on the right says which actions are on.
                onCheckedChange={(c) => setSection(section, c === true)}
              />
              <label htmlFor={id} className="min-w-0 flex-1 cursor-pointer">
                <span className="block text-body-strong">{meta.label}</span>
                <span className="block text-small text-muted-foreground">{meta.view}</span>
              </label>
              <span className={cn("shrink-0 rounded-pill px-2 py-0.5 text-caption", viewOn ? "bg-brand-soft font-semibold text-brand-ink" : "bg-muted text-muted-foreground")} data-testid={`access-summary-${section}`}>
                {sectionSummary(section, value, role)}
              </span>
            </div>
            {viewOn && actions.length > 0 && (
              <fieldset className="-mt-1 flex flex-col gap-2 pb-3.5 pl-11 pr-4">
                <legend className="sr-only">{meta.label} actions</legend>
                {actions.map((action) => {
                  const a = meta.actions[action];
                  const aid = `${id}-${action}`;
                  return (
                    <div key={action} className="flex items-start gap-3">
                      <Checkbox
                        id={aid}
                        className="mt-0.5"
                        checked={value[keyOf(section, action)] === true}
                        disabled={disabled}
                        aria-label={`${meta.label}: ${a?.label ?? action}`}
                        onCheckedChange={(c) => setAction(section, action, c === true)}
                      />
                      <label htmlFor={aid} className="cursor-pointer text-small">
                        <span className="block font-semibold text-foreground">{a?.label ?? action}</span>
                        {a?.hint && <span className="block text-muted-foreground">{a.hint}</span>}
                      </label>
                    </div>
                  );
                })}
              </fieldset>
            )}
          </div>
        );
      })}
      </div>
    </div>
  );
}
