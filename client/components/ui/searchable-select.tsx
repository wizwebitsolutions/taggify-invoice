"use client";

import { useEffect, useId, useMemo, useRef, useState } from "react";

import { SearchIcon, ChevronDownIcon, CheckIcon, CloseIcon } from "@/components/icons";
import { cn } from "@/lib/utils";

export interface SearchableOption {
  value: string;
  label: string;
  /** Secondary line (e.g. phone number); also searched. */
  hint?: string;
  /** Extra text to match against that isn't displayed (e.g. email). */
  keywords?: string;
}

/**
 * A select you can type into (Inventory "Create page", 14 Sep — "searchbar
 * for creator account inside that dropdown"). Filters by label, hint and
 * keywords; arrow keys move, Enter picks, Escape closes. Follows the WAI
 * combobox pattern closely enough for screen readers and for Playwright's
 * getByRole("combobox") / getByRole("option").
 */
export function SearchableSelect({
  value,
  onChange,
  options,
  placeholder = "Search…",
  emptyText = "No matches.",
  disabled,
  invalid,
  "aria-label": ariaLabel,
  className,
}: {
  value: string;
  onChange: (value: string) => void;
  options: SearchableOption[];
  placeholder?: string;
  emptyText?: string;
  disabled?: boolean;
  invalid?: boolean;
  "aria-label"?: string;
  className?: string;
}) {
  const listId = useId();
  const rootRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);

  const selected = options.find((o) => o.value === value) ?? null;
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return options;
    return options.filter((o) => `${o.label} ${o.hint ?? ""} ${o.keywords ?? ""}`.toLowerCase().includes(q));
  }, [options, query]);

  useEffect(() => {
    if (!open) return;
    function onDocClick(e: MouseEvent) {
      if (!rootRef.current?.contains(e.target as Node)) close();
    }
    document.addEventListener("mousedown", onDocClick);
    return () => document.removeEventListener("mousedown", onDocClick);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  useEffect(() => {
    setActive(0);
  }, [query, open]);

  function close() {
    setOpen(false);
    setQuery("");
  }

  function pick(option: SearchableOption) {
    onChange(option.value);
    close();
    inputRef.current?.blur();
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      if (!open) setOpen(true);
      else setActive((i) => Math.min(i + 1, filtered.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((i) => Math.max(i - 1, 0));
    } else if (e.key === "Enter") {
      // Never let Enter fall through to submit the surrounding form while
      // the list is open — even with no matches.
      if (open) {
        e.preventDefault();
        if (filtered[active]) pick(filtered[active]);
      }
    } else if (e.key === "Escape") {
      if (open) {
        e.preventDefault();
        close();
      }
    } else if (e.key === "Backspace" && !query && selected) {
      onChange("");
    }
  }

  const showValue = !open && selected;

  return (
    <div ref={rootRef} className={cn("relative", className)}>
      <div className={cn("flex h-10 items-center gap-2 rounded-md border bg-surface pl-3 pr-2 shadow-card transition-[box-shadow,border-color] duration-150 focus-within:border-ink focus-within:ring-[3px] focus-within:ring-ink-10", invalid ? "border-rose-line" : "border-border-strong", disabled && "opacity-60")}>
        <SearchIcon className="h-3.5 w-3.5 shrink-0 text-text-faint" />
        <input
          ref={inputRef}
          role="combobox"
          aria-label={ariaLabel}
          aria-expanded={open}
          aria-controls={listId}
          aria-autocomplete="list"
          aria-activedescendant={open && filtered[active] ? `${listId}-${active}` : undefined}
          disabled={disabled}
          value={open ? query : selected ? selected.label : ""}
          placeholder={placeholder}
          onChange={(e) => {
            setQuery(e.target.value);
            if (!open) setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          onClick={() => setOpen(true)}
          onBlur={(e) => {
            // Tabbing away closes the list (mouse picks keep focus via the
            // option's onMouseDown preventDefault, so they never blur first).
            if (!rootRef.current?.contains(e.relatedTarget as Node | null)) close();
          }}
          onKeyDown={onKeyDown}
          autoComplete="off"
          className="h-full min-w-0 flex-1 bg-transparent text-[0.875rem] text-text placeholder:text-text-faint focus:outline-none"
        />
        {showValue && selected.hint && <span className="hidden shrink-0 text-[0.75rem] text-text-muted sm:inline">{selected.hint}</span>}
        {selected && !disabled ? (
          <button
            type="button"
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => {
              onChange("");
              setQuery("");
              inputRef.current?.focus();
            }}
            aria-label="Clear selection"
            className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-text-faint hover:bg-surface-2 hover:text-text"
          >
            <CloseIcon className="h-3 w-3" />
          </button>
        ) : (
          <ChevronDownIcon className="h-3 w-3 shrink-0 text-text-faint" />
        )}
      </div>
      {open && (
        <ul id={listId} role="listbox" className="absolute left-0 right-0 z-20 mt-1 max-h-56 overflow-y-auto rounded-md border border-border bg-surface py-1 shadow-card">
          {filtered.length === 0 ? (
            <li className="px-3 py-2 text-[0.8125rem] text-text-muted">{emptyText}</li>
          ) : (
            filtered.map((o, i) => (
              <li
                key={o.value}
                id={`${listId}-${i}`}
                role="option"
                aria-selected={o.value === value}
                onMouseDown={(e) => e.preventDefault()}
                onMouseEnter={() => setActive(i)}
                onClick={() => pick(o)}
                className={cn("flex cursor-pointer items-center gap-2 px-3 py-2 text-[0.8125rem]", i === active && "bg-surface-2")}
              >
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-medium text-text">{o.label}</span>
                  {o.hint && <span className="block truncate text-[0.72rem] text-text-muted">{o.hint}</span>}
                </span>
                {o.value === value && <CheckIcon className="h-3.5 w-3.5 shrink-0 text-text" />}
              </li>
            ))
          )}
        </ul>
      )}
    </div>
  );
}
