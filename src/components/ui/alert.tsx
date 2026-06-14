import { type HTMLAttributes } from "react";
import { AlertCircle, AlertTriangle, CheckCircle2, Info } from "lucide-react";
import { cn } from "@/lib/utils";

export function Alert({
  variant = "error",
  className,
  children,
  ...props
}: HTMLAttributes<HTMLDivElement> & { variant?: "error" | "success" | "info" | "warning" }) {
  const styles =
    variant === "success"
      ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-200"
      : variant === "info"
        ? "border-sky-500/30 bg-sky-500/10 text-sky-200"
        : variant === "warning"
          ? "border-amber-500/30 bg-amber-500/10 text-amber-200"
          : "border-red-500/30 bg-red-500/10 text-red-200";

  const Icon =
    variant === "success"
      ? CheckCircle2
      : variant === "info"
        ? Info
        : variant === "warning"
          ? AlertTriangle
          : AlertCircle;

  return (
    <div
      className={cn("flex gap-2 rounded-lg border px-3 py-2.5 text-sm", styles, className)}
      {...props}
    >
      <Icon className="h-4 w-4 shrink-0 opacity-90 mt-0.5" aria-hidden />
      <div className="min-w-0 break-words">{children}</div>
    </div>
  );
}
