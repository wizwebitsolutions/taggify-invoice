import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { initialsOf } from "@/lib/format";
import { cn } from "@/lib/utils";

const SIZES = { xs: "h-6 w-6 text-micro", sm: "h-control-sm w-control-sm text-micro", md: "h-control w-control text-caption", lg: "h-16 w-16 text-card-title", xl: "h-28 w-28 text-section" } as const;

/** shadcn Avatar with an initials fallback (peach tint, 600 initials) for people/pages without a photo. */
export function UserAvatar({
  name,
  src,
  size = "md",
  className,
  fallbackClassName,
  onImageStatus,
}: {
  name?: string | null;
  src?: string | null;
  size?: keyof typeof SIZES;
  className?: string;
  fallbackClassName?: string;
  onImageStatus?: (status: "idle" | "loading" | "loaded" | "error") => void;
}) {
  return (
    <Avatar className={cn(SIZES[size], className)}>
      {src && <AvatarImage src={src} alt={name ?? ""} onLoadingStatusChange={onImageStatus} />}
      <AvatarFallback className={cn("text-[inherit]", fallbackClassName)} title={name ?? undefined}>
        {initialsOf(name)}
      </AvatarFallback>
    </Avatar>
  );
}
