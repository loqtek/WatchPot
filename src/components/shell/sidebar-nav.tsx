"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";
import { navSections } from "./nav-config";

export function SidebarNav({
  collapsed,
  onNavigate,
}: {
  collapsed?: boolean;
  onNavigate?: () => void;
}) {
  const pathname = usePathname() || "";

  return (
    <nav className={cn("flex flex-col py-3", collapsed ? "px-2" : "px-3")} aria-label="Main">
      {navSections.map((section, index) => (
        <div key={section.id} className={cn(index > 0 && (collapsed ? "mt-2" : "mt-5"))}>
          {collapsed ? (
            index > 0 ? <div className="mx-auto mb-2 h-px w-5 bg-black/10" /> : null
          ) : (
            <p className="px-3 pb-1.5 text-[11px] font-medium text-faint">{section.label}</p>
          )}
          <div className="flex flex-col gap-0.5">
            {section.items.map((item) => {
              const active = item.isActive(pathname);
              const Icon = item.icon;
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  onClick={onNavigate}
                  title={collapsed ? item.label : undefined}
                  aria-label={collapsed ? item.label : undefined}
                  aria-current={active ? "page" : undefined}
                  className={cn(
                    "group flex items-center rounded-full text-sm font-medium transition-colors",
                    collapsed ? "justify-center px-0 py-2.5" : "gap-3 px-3 py-2",
                    active
                      ? "bg-primary text-on-primary"
                      : "text-muted hover:bg-hover hover:text-ink",
                  )}
                >
                  <Icon
                    className={cn("h-[18px] w-[18px] shrink-0", active ? "text-on-primary" : "text-faint group-hover:text-muted")}
                    strokeWidth={1.75}
                    aria-hidden
                  />
                  {collapsed ? <span className="sr-only">{item.label}</span> : <span>{item.label}</span>}
                </Link>
              );
            })}
          </div>
        </div>
      ))}
    </nav>
  );
}
