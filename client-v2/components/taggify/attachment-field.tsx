"use client";

import { useRef } from "react";
import { useMutation } from "@tanstack/react-query";
import { toast } from "sonner";
import { FileText, Paperclip, X } from "lucide-react";

import { ApiError } from "@/lib/api-client";
import { ATTACHMENT_ACCEPT, attachmentProblem, PDF_ACCEPT, type Attachment, type AttachmentKind } from "@/lib/attachments";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";

/** Server refusals in plain words; anything else as the server or browser said it. */
function errText(e: unknown, fallback: string) {
  if (e instanceof ApiError && e.code === "VALIDATION_ERROR") return "That file couldn't be saved. Check its name and type, then try again.";
  if (e instanceof ApiError && e.code === "UPLOAD_NOT_FOUND") return "The upload didn't finish. Try again.";
  return e instanceof ApiError || e instanceof Error ? e.message : fallback;
}

/**
 * One attached document: open it, replace it, remove it, or attach one.
 * `onUpload` / `onRemove` do the API work; this owns the file picker, the
 * file checks, busy state and messages. `readOnly` shows the file (or
 * "None attached") without controls, e.g. once an invoice is paid.
 */
export function AttachmentField({
  attachment,
  readOnly,
  readOnlyNote,
  attachLabel,
  what,
  onUpload,
  onRemove,
  compact,
  kind = "pdf-or-image",
  className,
}: {
  attachment: Attachment;
  readOnly?: boolean;
  /** Why it can't change, shown under a read-only file (e.g. "Paid invoices can't change."). */
  readOnlyNote?: string;
  /** The empty state's button, e.g. "Attach your invoice". */
  attachLabel: string;
  /** For messages: "invoice file", "client invoice". */
  what: string;
  onUpload: (file: File) => Promise<unknown>;
  onRemove: () => Promise<unknown>;
  /** One line for a list row: smaller attach button, no format hint. */
  compact?: boolean;
  /** Which files it takes; the hint and the file picker follow it. */
  kind?: AttachmentKind;
  className?: string;
}) {
  const input = useRef<HTMLInputElement>(null);
  const upload = useMutation({
    mutationFn: async (file: File) => {
      const problem = attachmentProblem(file, kind);
      if (problem) throw new Error(problem);
      await onUpload(file);
      return file.name;
    },
    onSuccess: (name) => toast.success(`${name} attached.`),
  });
  const remove = useMutation({
    mutationFn: onRemove,
    onSuccess: () => toast.success(`The ${what} was removed.`),
  });
  const busy = upload.isPending || remove.isPending;
  const error = upload.error ?? remove.error;
  const pick = () => input.current?.click();

  return (
    <div className={cn("flex flex-col gap-2", className)}>
      <input
        ref={input}
        type="file"
        accept={kind === "pdf" ? PDF_ACCEPT : ATTACHMENT_ACCEPT}
        className="sr-only"
        tabIndex={-1}
        aria-hidden
        onChange={(e) => {
          const file = e.target.files?.[0];
          e.target.value = "";
          if (file) {
            remove.reset();
            upload.mutate(file);
          }
        }}
      />
      {attachment ? (
        <div className="flex items-center gap-2 rounded-md border bg-card px-3 py-2">
          <FileText className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
          {attachment.url ? (
            <a href={attachment.url} target="_blank" rel="noreferrer" className="min-w-0 flex-1 truncate text-body-strong text-foreground hover:text-brand-ink hover:underline">
              {attachment.name}
            </a>
          ) : (
            <span className="min-w-0 flex-1 truncate text-body-strong">{attachment.name}</span>
          )}
          {!readOnly && (
            <>
              <Button size="sm" variant="ghost" disabled={busy} onClick={pick}>
                {upload.isPending ? "Uploading…" : "Replace"}
              </Button>
              <Button
                size="icon"
                variant="ghost"
                disabled={busy}
                aria-label={`Remove ${attachment.name}`}
                onClick={() => {
                  upload.reset();
                  remove.mutate();
                }}
              >
                <X />
              </Button>
            </>
          )}
        </div>
      ) : readOnly ? (
        <p className="text-small text-muted-foreground">None attached.</p>
      ) : (
        <Button variant={compact ? "ghost" : "outline"} size={compact ? "sm" : "default"} className="self-start" disabled={busy} onClick={pick}>
          <Paperclip />
          {upload.isPending ? "Uploading…" : attachLabel}
        </Button>
      )}
      {readOnly && readOnlyNote && <p className="text-small text-muted-foreground">{readOnlyNote}</p>}
      {!readOnly && !attachment && !compact && <p className="text-small text-muted-foreground">{kind === "pdf" ? "PDF, up to 10 MB." : "PDF or image, up to 10 MB."}</p>}
      {error && (
        <p className="text-small text-danger-helper" role="alert">
          {errText(error, `Couldn't update the ${what}. Try again.`)}
        </p>
      )}
    </div>
  );
}
