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
      ? "border-[var(--alert-success-border)] bg-[var(--alert-success-bg)] text-[var(--alert-success-fg)]"
      : variant === "info"
        ? "border-[var(--alert-info-border)] bg-[var(--alert-info-bg)] text-[var(--alert-info-fg)]"
        : variant === "warning"
          ? "border-[var(--alert-warning-border)] bg-[var(--alert-warning-bg)] text-[var(--alert-warning-fg)]"
          : "border-[var(--alert-danger-border)] bg-[var(--alert-danger-bg)] text-[var(--alert-danger-fg)]";

  const Icon =
    variant === "success" ? CheckCircle2 : variant === "info" ? Info : variant === "warning" ? AlertTriangle : AlertCircle;

  return (
    <div className={cn("flex gap-2.5 rounded-2xl border px-3.5 py-3 text-sm", styles, className)} {...props}>
      <Icon className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
      <div className="min-w-0 break-words">{children}</div>
    </div>
  );
}
