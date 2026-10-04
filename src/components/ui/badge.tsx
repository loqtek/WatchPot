import { type HTMLAttributes } from "react";
import { cn } from "@/lib/utils";

const tones = {
  default: "bg-[var(--badge-default-bg)] text-[var(--badge-default-fg)]",
  success: "bg-[var(--badge-success-bg)] text-[var(--badge-success-fg)]",
  warning: "bg-[var(--badge-warning-bg)] text-[var(--badge-warning-fg)]",
  danger: "bg-[var(--badge-danger-bg)] text-[var(--badge-danger-fg)]",
  info: "bg-[var(--badge-info-bg)] text-[var(--badge-info-fg)]",
} as const;

export function Badge({
  className,
  tone = "default",
  ...props
}: HTMLAttributes<HTMLSpanElement> & { tone?: keyof typeof tones }) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full px-2.5 py-0.5 text-[12px] font-medium leading-5",
        tones[tone],
        className,
      )}
      {...props}
    />
  );
}
