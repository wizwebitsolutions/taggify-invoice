"use client";

import { useMemo, useState } from "react";
import { motion } from "motion/react";
import { toast } from "sonner";
import { CircleCheck, CircleX, Loader2, PlusCircle } from "lucide-react";

import type { AddTrackedPostsResult } from "@/lib/api-client";
import { parseInstagramPostUrl, splitPastedLinks } from "@/lib/post-tracker-url";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { CARD, FIELD, MICRO, errorMessage, fadeRise } from "@/components/bulk-track/shared";

const MAX_LINKS = 50;

/**
 * Paste box (24 Oct): every pasted line gets a ✓ or a reason straight away,
 * before anything is sent — the same rules the server applies
 * (lib/post-tracker-url.ts mirrors postTracker/url.js). After adding, lines
 * the server turned down stay in the box so they can be fixed in place.
 */
export function PasteLinks({ onAdd }: { onAdd: (body: { urls: string[]; note?: string }) => Promise<AddTrackedPostsResult> }) {
  const [text, setText] = useState("");
  const [note, setNote] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const entries = useMemo(() => splitPastedLinks(text).map((input) => ({ input, parsed: parseInstagramPostUrl(input) })), [text]);
  const ready = entries.filter((e) => e.parsed.ok);
  const tooMany = entries.length > MAX_LINKS;

  async function submit() {
    setPending(true);
    setError(null);
    try {
      const res = await onAdd({ urls: entries.map((e) => e.input), note: note.trim() || undefined });
      const parts = [res.created && `${res.created} added`, res.existing && `${res.existing} already tracked`, res.rejected && `${res.rejected} skipped`].filter(Boolean);
      toast.success(parts.join(" · ") || "Nothing to add");
      setText(res.results.filter((r) => r.result === "rejected").map((r) => r.input).join("\n"));
      if (!res.rejected) setNote("");
    } catch (err) {
      setError(errorMessage(err, "Couldn't add these links — try again."));
    } finally {
      setPending(false);
    }
  }

  return (
    <motion.div {...fadeRise(1)} className={cn(CARD, "mb-5 border-input p-6")} data-testid="post-tracker-paste">
      <div className="mb-3 flex items-center gap-2">
        <PlusCircle className="h-3.5 w-3.5 text-info-fg" />
        <h3 className="text-body-strong font-bold">Add links</h3>
      </div>
      <div className="grid gap-4 lg:grid-cols-2">
        <div className="flex flex-col gap-3">
          <label className="block">
            <span className={cn(MICRO, "mb-1.5 block")}>Reel or post links (one per line, max {MAX_LINKS})</span>
            <textarea
              value={text}
              onChange={(e) => setText(e.target.value)}
              rows={5}
              placeholder={"https://www.instagram.com/reel/…\nhttps://www.instagram.com/p/…"}
              className={cn(FIELD, "font-mono")}
            />
          </label>
          <label className="block">
            <span className={cn(MICRO, "mb-1.5 block")}>Note (optional)</span>
            <Input value={note} onChange={(e) => setNote(e.target.value)} maxLength={200} placeholder="e.g. Diwali campaign" />
          </label>
        </div>

        <div className="flex min-h-0 flex-col">
          <span className={cn(MICRO, "mb-1.5 block")}>Check</span>
          {entries.length === 0 ? (
            <p className="rounded-md border border-dashed px-4 py-6 text-center text-caption font-normal text-muted-foreground">Paste links to check them here.</p>
          ) : (
            <ul className="max-h-56 overflow-y-auto rounded-md border" data-testid="post-tracker-check">
              {entries.map(({ input, parsed }, i) => (
                <li key={`${i}-${input}`} className="flex items-start gap-2 border-b px-3 py-2 last:border-0">
                  {parsed.ok ? <CircleCheck className="mt-0.5 h-3.5 w-3.5 shrink-0 text-success-fg" aria-label="OK" /> : <CircleX className="mt-0.5 h-3.5 w-3.5 shrink-0 text-danger-fg" aria-label="Can't add" />}
                  <div className="min-w-0">
                    <p className="truncate font-mono text-caption text-foreground">{input}</p>
                    {parsed.ok ? (
                      <p className="text-caption font-normal text-muted-foreground">
                        {parsed.kind === "reel" ? "Reel" : "Post"} · {parsed.shortcode}
                      </p>
                    ) : (
                      <p className="text-caption font-normal text-danger-fg">{parsed.reason}</p>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-3">
        <Button onClick={submit} disabled={pending || ready.length === 0 || tooMany}>
          {pending ? <Loader2 className="animate-spin" /> : null}
          {ready.length > 1 ? `Add ${ready.length} links` : "Add link"}
        </Button>
        {entries.length > 0 && (
          <p className="text-caption font-normal text-muted-foreground">
            {tooMany ? `That's ${entries.length} lines — add up to ${MAX_LINKS} at a time.` : `${ready.length} ready${entries.length > ready.length ? ` · ${entries.length - ready.length} can't be added` : ""}`}
          </p>
        )}
      </div>
      {error && <p className="mt-2 text-caption font-normal text-danger-fg">{error}</p>}
    </motion.div>
  );
}
