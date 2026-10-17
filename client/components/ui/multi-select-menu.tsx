"use client";

import { useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

import { ChevronDownIcon } from "@/components/icons";
import { cn } from "@/lib/utils";

export interface MultiSelectOption {
  value: string;
  label: string;
  /** Right-aligned note (e.g. the page's rate, or "no rate"). */
  hint?: string;
  /** Show the option quieter (e.g. a format the page has no rate for). */
  muted?: boolean;
}

/**
 * A compact "pick several" dropdown (plan wizard formats, 14 Oct — "give
 * format dropdown"). A button showing the current choice opens a checklist;
 * each tick calls onToggle and the menu stays open so several can be picked.
 * Closes on an outside click, Escape, or focus leaving both the button and
 * the menu; Escape and tabbing out of it return focus to the button.
 *
 * Keyboard (review fix, 16 Oct): opening moves focus to the first checkbox.
 * Tab / Shift+Tab move between the checkboxes; Tab past the last one or
 * Shift+Tab before the first closes the menu and puts focus back on the
 * button. The button is aria-haspopup="dialog" + aria-controls, matching the
 * menu's role="dialog" (it's a checklist, not an ARIA menu).
 *
 * The menu is portalled to <body> and position: fixed under the button, so a
 * horizontally scrolling table (or a transformed parent) can't clip or shift
 * it; it follows the button on scroll. (React events still bubble from the portal,
 * so Escape and Tab inside it reach the wrapper's onKeyDown — but the browser's
 * own Tab order puts the portal at the end of the page, hence the handling below.)
 */
export function MultiSelectMenu({
  options,
  selected,
  onToggle,
  buttonLabel,
  placeholder = "Choose…",
  "aria-label": ariaLabel,
  className,
}: {
  options: MultiSelectOption[];
  selected: readonly string[];
  onToggle: (value: string) => void;
  /** What the closed button shows; defaults to the picked labels (or "N selected" past two). */
  buttonLabel?: string;
  placeholder?: string;
  "aria-label": string;
  className?: string;
}) {
  const menuId = useId();
  const buttonRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);

  const selectedKey = selected.join(",");
  const pickedLabels = options.filter((o) => selected.includes(o.value)).map((o) => o.label);
  const shown = buttonLabel ?? (pickedLabels.length === 0 ? placeholder : pickedLabels.length <= 2 ? pickedLabels.join(", ") : `${pickedLabels.length} selected`);

  /** Puts the menu under the button (or above it when there's no room below). Uses only refs, so it's safe from listeners. */
  function place() {
    if (!buttonRef.current) return;
    const r = buttonRef.current.getBoundingClientRect();
    const menuH = menuRef.current?.offsetHeight ?? 0;
    const below = r.bottom + 4;
    const top = menuH && below + menuH > window.innerHeight && r.top - 4 - menuH > 0 ? r.top - 4 - menuH : below;
    setPos({ top, left: Math.max(8, Math.min(r.left, window.innerWidth - (menuRef.current?.offsetWidth ?? 240) - 8)) });
  }

  // Re-placed after each pick too — a message above the table can move the button.
  useLayoutEffect(() => {
    if (open) place();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, selectedKey]);

  /** The menu's checkboxes, in order. */
  function items(): HTMLInputElement[] {
    return Array.from(menuRef.current?.querySelectorAll<HTMLInputElement>("input[type=\"checkbox\"]") ?? []);
  }

  function closeToButton() {
    setOpen(false);
    buttonRef.current?.focus();
  }

  // Opening moves focus into the menu (its first checkbox).
  useEffect(() => {
    if (open) items()[0]?.focus({ preventScroll: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  useEffect(() => {
    if (!open) return;
    // Focus moving anywhere other than the button or the menu closes it.
    function onFocusIn(e: FocusEvent) {
      const t = e.target as Node;
      if (!menuRef.current?.contains(t) && !buttonRef.current?.contains(t)) setOpen(false);
    }
    function onDown(e: MouseEvent) {
      const t = e.target as Node;
      if (!menuRef.current?.contains(t) && !buttonRef.current?.contains(t)) setOpen(false);
    }
    // The page (or the table) scrolling keeps the menu with its button.
    function onMove(e: Event) {
      if (menuRef.current?.contains(e.target as Node)) return;
      place();
    }
    document.addEventListener("mousedown", onDown);
    document.addEventListener("focusin", onFocusIn);
    window.addEventListener("scroll", onMove, true);
    window.addEventListener("resize", onMove);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("focusin", onFocusIn);
      window.removeEventListener("scroll", onMove, true);
      window.removeEventListener("resize", onMove);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  function onKeyDown(e: React.KeyboardEvent) {
    if (!open) return;
    if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      closeToButton();
      return;
    }
    if (e.key !== "Tab") return;
    const list = items();
    if (list.length === 0) return;
    const at = list.indexOf(document.activeElement as HTMLInputElement);
    if (document.activeElement === buttonRef.current) {
      // Tab from the open menu's button goes into the menu (it sits at the end of the page otherwise).
      if (!e.shiftKey) {
        e.preventDefault();
        list[0].focus();
      }
      return;
    }
    if (at === -1) return;
    if ((e.shiftKey && at === 0) || (!e.shiftKey && at === list.length - 1)) {
      e.preventDefault();
      closeToButton();
    } else {
      e.preventDefault();
      list[at + (e.shiftKey ? -1 : 1)].focus();
    }
  }

  return (
    <div className={cn("relative inline-block", className)} onKeyDown={onKeyDown}>
      <button
        ref={buttonRef}
        type="button"
        aria-label={ariaLabel}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        onClick={() => {
          setPos(null);
          setOpen((o) => !o);
        }}
        title={pickedLabels.join(", ") || undefined}
        className="inline-flex h-8 max-w-[180px] items-center gap-1.5 whitespace-nowrap rounded-[6px] border border-border-strong bg-surface px-2.5 text-[0.78rem] text-text-2 hover:bg-surface-2 focus:border-ink focus:outline-none"
      >
        <span className="truncate">{shown}</span>
        <ChevronDownIcon className="h-3 w-3 shrink-0 text-text-faint" />
      </button>
      {open &&
        createPortal(
          <div
            ref={menuRef}
            id={menuId}
            role="dialog"
            aria-label={ariaLabel}
            style={{ position: "fixed", top: pos?.top ?? -9999, left: pos?.left ?? -9999 }}
            className="z-30 max-h-72 min-w-[240px] overflow-y-auto rounded-md border border-border bg-surface py-1 shadow-card"
          >
            {options.map((o) => {
              const on = selected.includes(o.value);
              return (
                <label key={o.value} className={cn("flex cursor-pointer items-center gap-2 px-3 py-1.5 text-[0.8125rem] hover:bg-surface-2", o.muted && !on && "text-text-muted")}>
                  <input type="checkbox" checked={on} onChange={() => onToggle(o.value)} aria-label={o.label} className="h-3.5 w-3.5 rounded accent-[var(--ink)]" />
                  <span className="min-w-0 flex-1 whitespace-nowrap">{o.label}</span>
                  {o.hint && <span className={cn("whitespace-nowrap text-[0.72rem] tabular-nums", o.muted ? "text-text-faint" : "text-text-muted")}>{o.hint}</span>}
                </label>
              );
            })}
          </div>,
          document.body
        )}
    </div>
  );
}
