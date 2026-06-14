"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";
import { mainNav } from "./nav-config";

export function SidebarNav({
  collapsed,
  onNavigate,
}: {
  collapsed?: boolean;
  onNavigate?: () => void;
}) {
  const pathname = usePathname() || "";

  return (
    <nav
      className={cn("flex flex-col gap-0.5 py-3", collapsed ? "px-1.5" : "px-2")}
      aria-label="Main"
    >
      {mainNav.map((item) => {
        const active = item.isActive(pathname);
        const Icon = item.icon;
        return (
          <Link
            key={item.href}
            href={item.href}
            onClick={onNavigate}
            title={collapsed ? item.label : undefined}
            aria-label={collapsed ? item.label : undefined}
            className={cn(
              "group flex items-center rounded-lg text-sm font-medium transition-colors",
              collapsed ? "justify-center px-2 py-2.5" : "gap-3 px-3 py-2.5",
              active
                ? collapsed
                  ? "bg-emerald-500/12 text-emerald-300 ring-1 ring-emerald-500/30"
                  : "bg-emerald-500/12 text-emerald-300 shadow-[inset_3px_0_0_0] shadow-emerald-500"
                : "text-zinc-400 hover:bg-zinc-800/60 hover:text-zinc-100",
            )}
          >
            <Icon
              className={cn(
                "h-[18px] w-[18px] shrink-0 transition-colors",
                active ? "text-emerald-400" : "text-zinc-500 group-hover:text-zinc-400",
              )}
              strokeWidth={2}
              aria-hidden
            />
            {collapsed ? (
              <span className="sr-only">{item.label}</span>
            ) : (
              <span>{item.label}</span>
            )}
          </Link>
        );
      })}
    </nav>
  );
}
