"use client";

import type { ReactNode } from "react";
import { BarChart3 } from "lucide-react";
import { cn } from "@/lib/utils";

export function ChartEmpty({ message = "No data in selected range" }: { message?: string }) {
  return (
    <div className="flex h-full min-h-[120px] flex-col items-center justify-center gap-2 text-zinc-600">
      <BarChart3 className="h-8 w-8 opacity-40" strokeWidth={1.25} />
      <p className="text-xs text-zinc-500">{message}</p>
    </div>
  );
}

export function ChartContainer({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div className={cn("h-full w-full min-h-[140px]", className)}>
      {children}
    </div>
  );
}
