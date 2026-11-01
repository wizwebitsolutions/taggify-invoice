import { Brand } from "@/components/layout/brand";

/**
 * Full-screen wait state shown while RequireAuth reads the stored session.
 * Wordmark over an orbiting brand ring, with three ticking dots underneath;
 * the message fades in late so a fast session read never flashes text.
 * Colours and timing come from the tokens (brand, card, fg-muted, --ease-out);
 * the keyframes live in globals.css (.session-loader-*).
 */
export function SessionLoader({ message = "Checking your session…" }: { message?: string }) {
  return (
    <div className="session-loader flex h-screen flex-col items-center justify-center gap-6 bg-surface-app" role="status" aria-live="polite">
      <div className="relative grid h-20 w-20 place-items-center">
        <span className="session-loader-ring absolute inset-0 rounded-full" aria-hidden />
        <span className="session-loader-ring session-loader-ring-two absolute inset-0 rounded-full" aria-hidden />
        <span className="grid h-14 w-14 place-items-center rounded-full bg-card shadow-2">
          <Brand compact />
        </span>
      </div>
      <div className="flex items-center gap-3 text-fg-muted">
        <span className="flex items-center gap-1" aria-hidden>
          <span className="session-loader-dot" />
          <span className="session-loader-dot" />
          <span className="session-loader-dot" />
        </span>
        <p className="session-loader-text text-small font-medium">{message}</p>
      </div>
    </div>
  );
}
