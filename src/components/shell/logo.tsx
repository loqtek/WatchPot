import Image from "next/image";
import Link from "next/link";
import { cn } from "@/lib/utils";

const LOGO_SRC = "/watchPotLogoNoBg.png";

const sizeClasses = {
  sm: "h-8 w-8",
  md: "h-9 w-9",
  lg: "h-28 w-28",
} as const;

export function Logo({
  className,
  collapsed,
  size = "md",
  href = "/dashboard",
  asLink = true,
}: {
  className?: string;
  collapsed?: boolean;
  size?: keyof typeof sizeClasses;
  href?: string;
  asLink?: boolean;
}) {
  const mark = (
    <span className={cn("relative block shrink-0", sizeClasses[size])}>
      <Image
        src={LOGO_SRC}
        alt="watchPot"
        fill
        className="object-contain"
        sizes={size === "lg" ? "112px" : size === "md" ? "36px" : "32px"}
        priority={size !== "sm"}
      />
    </span>
  );

  const label = !collapsed ? (
    <span className="truncate font-semibold tracking-tight text-zinc-100">
      watch<span className="text-emerald-400">Pot</span>
    </span>
  ) : null;

  if (!asLink) {
    return (
      <div className={cn("flex min-w-0 items-center gap-2.5", className)}>
        {mark}
        {label}
      </div>
    );
  }

  return (
    <Link
      href={href}
      className={cn(
        "flex min-w-0 items-center gap-2.5 rounded-lg outline-none focus-visible:ring-2 focus-visible:ring-emerald-500/40",
        className,
      )}
    >
      {mark}
      {label}
    </Link>
  );
}
