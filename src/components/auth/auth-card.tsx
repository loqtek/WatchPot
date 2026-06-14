import { type ReactNode } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Logo } from "@/components/shell/logo";
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
    <div
      className={cn(
        "relative min-h-screen overflow-hidden bg-zinc-950 flex flex-col items-center justify-center px-4 py-12",
        className,
      )}
    >
      <div
        className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_80%_50%_at_50%_-20%,rgba(16,185,129,0.12),transparent)]"
        aria-hidden
      />
      <div className="relative w-full max-w-[420px] space-y-8">
        <div className="flex flex-col items-center text-center gap-2">
          <Logo size="lg" collapsed />
          <h1 className="text-xl font-semibold tracking-tight text-zinc-50">{title}</h1>
          {subtitle ? <p className="text-sm text-zinc-500 max-w-sm leading-relaxed">{subtitle}</p> : null}
        </div>
        <Card className="overflow-hidden">
          <CardContent className="p-6 sm:p-8">{children}</CardContent>
        </Card>
        {footer ? <div className="text-center text-sm text-zinc-500">{footer}</div> : null}
      </div>
    </div>
  );
}
