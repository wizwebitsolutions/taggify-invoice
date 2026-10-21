"use client";

import { useId, type ReactNode } from "react";

import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";

/**
 * Label (13/500) + control + description (12) or error (#B91C1C), with ids and
 * aria wired to the child control: `{(a) => <Input {...a} />}`.
 */
export function Field({
  label,
  description,
  error,
  className,
  labelAction,
  children,
}: {
  label: string;
  description?: string;
  error?: string | null;
  className?: string;
  /** Right-aligned link on the label row (e.g. "Forgot?"). */
  labelAction?: ReactNode;
  children: (a: { id: string; "aria-describedby"?: string; "aria-invalid"?: boolean }) => ReactNode;
}) {
  const id = useId();
  const noteId = description || error ? `${id}-note` : undefined;
  return (
    <div className={cn("flex flex-col gap-2", className)}>
      <div className="flex items-center justify-between gap-2">
        <Label htmlFor={id}>{label}</Label>
        {labelAction}
      </div>
      {children({ id, "aria-describedby": noteId, "aria-invalid": error ? true : undefined })}
      {error ? (
        <p id={noteId} role="alert" className="text-caption font-normal text-danger-helper">
          {error}
        </p>
      ) : description ? (
        <p id={noteId} className="text-caption font-normal text-muted-foreground">
          {description}
        </p>
      ) : null}
    </div>
  );
}
