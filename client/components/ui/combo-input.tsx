"use client";

import { useEffect, useId, useMemo, useRef, useState } from "react";

import { cn } from "@/lib/utils";

export interface ComboSuggestion {
  /** Unique per suggestion — two suggestions may share a label (one client, two GST registrations). */
  key: string;
  label: string;
  /** Secondary line (e.g. GSTIN · city); also searched. */
  hint?: string;
}

/**
 * A free-text input that also suggests (saved clients, 21 Sep — "on
 * entering client name ... it will have dropdown of client name").
 * Deliberately not SearchableSelect: that one can only hold a value from
 * its options, and a brand-new client has to stay typeable. The typed text
 * is always the value; picking a suggestion is a shortcut that sets it and
 * tells the caller which suggestion it was (so it can fill sibling fields).
 *
 * The list only opens when there is something to suggest, so with no saved
 * clients this behaves exactly like the TextField it replaced. Same WAI
 * combobox roles as SearchableSelect — getByRole("combobox"/"option").
 */
export function ComboInput({
  value,
  onChange,
  onPick,
  suggestions,
  className,
  ...rest
}: {
  value: string;
  onChange: (value: string) => void;
  onPick?: (suggestion: ComboSuggestion) => void;
  suggestions: ComboSuggestion[];
  className?: string;
} & Omit<React.InputHTMLAttributes<HTMLInputElement>, "value" | "onChange" | "role" | "className">) {
  const listId = useId();
  const rootRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);

  const filtered = useMemo(() => {
    const q = value.trim().toLowerCase();
    if (!q) return suggestions;
    return suggestions.filter((s) => `${s.label} ${s.hint ?? ""}`.toLowerCase().includes(q));
  }, [suggestions, value]);
  const showList = open && filtered.length > 0;

  useEffect(() => {
    if (!open) return;
    function onDocMouseDown(e: MouseEvent) {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onDocMouseDown);
    return () => document.removeEventListener("mousedown", onDocMouseDown);
  }, [open]);

  // No row is highlighted until an arrow key moves onto one — so Enter on
  // freshly typed text submits the form as typed instead of silently
  // swapping in the first suggestion.
  useEffect(() => {
    setActive(-1);
  }, [value, open]);

  function pick(suggestion: ComboSuggestion) {
    onChange(suggestion.label);
    onPick?.(suggestion);
    setOpen(false);
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      if (!open) setOpen(true);
      else setActive((i) => Math.min(i + 1, filtered.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((i) => Math.max(i - 1, -1));
    } else if (e.key === "Enter" && showList && filtered[active]) {
      e.preventDefault();
      pick(filtered[active]);
    } else if (e.key === "Escape" && showList) {
      // Only swallow Escape when it actually closed the list, so any outer Escape handler still gets the rest.
      e.preventDefault();
      e.stopPropagation();
      setOpen(false);
    }
  }

  return (
    <div ref={rootRef} className={cn("relative flex flex-col", className)}>
      <input
        {...rest}
        role="combobox"
        aria-expanded={showList}
        aria-controls={listId}
        aria-autocomplete="list"
        aria-activedescendant={showList && filtered[active] ? `${listId}-${active}` : undefined}
        autoComplete="off"
        value={value}
        onChange={(e) => {
          onChange(e.target.value);
          setOpen(true);
        }}
        // Opens on click / typing / ArrowDown, not on focus alone — the invoice
        // popup autofocuses this field, and a list dropping over the form
        // the instant it opens would hide the fields below it.
        onClick={() => setOpen(true)}
        onBlur={(e) => {
          if (!rootRef.current?.contains(e.relatedTarget as Node | null)) setOpen(false);
        }}
        onKeyDown={onKeyDown}
        className="h-10 rounded-md border border-border-strong bg-surface px-3 text-[0.875rem] text-text shadow-card transition-[box-shadow,border-color] duration-150 placeholder:text-text-faint hover:border-text-faint focus:outline-none focus-visible:border-ink focus-visible:ring-[3px] focus-visible:ring-ink-10"
      />
      {showList && (
        <ul id={listId} role="listbox" className="absolute left-0 right-0 top-full z-20 mt-1 max-h-56 overflow-y-auto rounded-md border border-border bg-surface py-1 shadow-card">
          {filtered.map((s, i) => (
            <li
              key={s.key}
              id={`${listId}-${i}`}
              role="option"
              aria-selected={i === active}
              // Keeps focus in the input, so the click lands before any blur closes the list.
              onMouseDown={(e) => e.preventDefault()}
              onMouseEnter={() => setActive(i)}
              onClick={() => pick(s)}
              className={cn("cursor-pointer px-3 py-2 text-[0.8125rem]", i === active && "bg-surface-2")}
            >
              <span className="block truncate font-medium text-text">{s.label}</span>
              {s.hint && <span className="block truncate text-[0.72rem] text-text-muted">{s.hint}</span>}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
