import { type ClassValue, clsx } from "clsx";
import { extendTailwindMerge } from "tailwind-merge";

// tailwind-merge only knows Tailwind's default font sizes. Without this it reads
// our type-scale classes (text-h3, text-body, …) as text COLOURS and drops them
// when a colour class like text-foreground follows. Keep in step with fontSize
// in tailwind.config.ts. (Diverges from client/lib/utils.ts on purpose.)
// The custom spacing keys need the same: unknown to it, `h-control h-auto` kept
// both and h-control won on CSS order, pinning textareas at 40px (13 Oct review).
const twMerge = extendTailwindMerge({
  extend: {
    theme: { spacing: ["sidebar", "sidebar-compact", "rail", "topbar", "context-rail", "control", "control-sm", "control-lg", "pill"] },
    classGroups: {
      "font-size": [{ text: ["display-xl", "display", "section", "card-title", "h1", "h2", "h3", "h4", "body-lg", "body", "body-strong", "small", "caption", "micro", "kpi", "label", "nav-label", "th", "wordmark"] }],
    },
  },
});

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/**
 * Click handler for a table row that opens `href` (design-fix #2/#7: clicking
 * anywhere on a list row should open it, not only the name link). Clicks on
 * a link, button or input inside the row, or while selecting text, are left
 * alone; the name stays a real <Link> for keyboard users and middle-click.
 */
export function openRow(push: (href: string) => void, href: string) {
  return (e: React.MouseEvent<HTMLElement>) => {
    if ((e.target as HTMLElement).closest("a,button,input,label,[role=menuitem]")) return;
    if (window.getSelection()?.toString()) return;
    // Ctrl/⌘-click opens a new tab, like it would on the name link.
    if (e.ctrlKey || e.metaKey) return void window.open(href, "_blank", "noopener");
    push(href);
  };
}
