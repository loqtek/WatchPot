import { type ReactNode } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Logo } from "@/components/shell/logo";
import { ThemeToggle } from "@/components/shell/theme-toggle";
import { cn } from "@/lib/utils";

export function AuthPageLayout({
  title,
  subtitle,
  children,
  footer,
  className,
}: {
  title: string;
  subtitle?: string;
  children: ReactNode;
  footer?: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("relative flex min-h-screen flex-col items-center justify-center overflow-hidden bg-paper px-4 py-12", className)}>
      <div className="absolute right-4 top-4 z-10">
        <ThemeToggle collapsed />
      </div>
      <div
        className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_70%_40%_at_50%_-10%,rgba(226,61,18,0.08),transparent)]"
        aria-hidden
      />
      <div className="relative w-full max-w-[420px] space-y-8">
        <div className="flex flex-col items-center gap-3 text-center">
          <Logo size="lg" collapsed />
          <div className="space-y-1.5">
            <h1 className="text-[1.75rem] font-semibold tracking-[-0.03em] text-ink">{title}</h1>
            {subtitle ? <p className="mx-auto max-w-sm text-sm leading-relaxed text-muted">{subtitle}</p> : null}
          </div>
        </div>
        <Card className="overflow-hidden shadow-pop">
          <CardContent className="p-6 sm:p-8">{children}</CardContent>
        </Card>
        {footer ? <div className="text-center text-sm text-muted">{footer}</div> : null}
      </div>
    </div>
  );
}
