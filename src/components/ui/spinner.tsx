import { cn } from "@/lib/utils";

export function Spinner({ className, size = "md" }: { className?: string; size?: "sm" | "md" | "lg" }) {
  const s = size === "sm" ? "h-4 w-4 border" : size === "lg" ? "h-8 w-8 border-2" : "h-5 w-5 border-2";
  return (
    <div
      role="status"
      aria-label="Loading"
      className={cn("animate-spin rounded-full border-zinc-600 border-t-emerald-500", s, className)}
    />
  );
}
