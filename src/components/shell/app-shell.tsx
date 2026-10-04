"use client";

import { Menu, X } from "lucide-react";
import { usePathname } from "next/navigation";
import { startTransition, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { useSidebarCollapsed } from "@/hooks/use-sidebar-collapsed";
import { cn } from "@/lib/utils";
import { AppSidebar } from "./app-sidebar";
import { Logo } from "./logo";

export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const { collapsed: sidebarCollapsed, toggle: toggleSidebar, ready: sidebarReady } = useSidebarCollapsed();
  const [mobileOpen, setMobileOpen] = useState(false);

  useEffect(() => {
    startTransition(() => setMobileOpen(false));
  }, [pathname]);

  useEffect(() => {
    const mq = window.matchMedia("(min-width: 768px)");
    const onChange = () => {
      if (mq.matches) setMobileOpen(false);
    };
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);

  useEffect(() => {
    document.body.style.overflow = mobileOpen ? "hidden" : "";
    return () => {
      document.body.style.overflow = "";
    };
  }, [mobileOpen]);

  const desktopCollapsed = sidebarReady && sidebarCollapsed;

  return (
    <div className="min-h-dvh bg-paper text-ink">
      <AppSidebar
        collapsed={desktopCollapsed}
        onToggleCollapse={toggleSidebar}
        className="fixed inset-y-0 left-0 z-30 hidden transition-[width] duration-200 ease-in-out md:flex"
      />

      <div
        className={cn(
          "flex min-h-dvh min-w-0 flex-col transition-[padding] duration-200 ease-in-out",
          desktopCollapsed ? "md:pl-[4.5rem]" : "md:pl-[15.5rem]",
        )}
      >
        <header className="sticky top-0 z-20 flex h-14 shrink-0 items-center justify-between gap-3 border-b border-line bg-sidebar/90 px-4 backdrop-blur-md md:hidden">
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="text-muted"
            aria-label={mobileOpen ? "Close menu" : "Open menu"}
            onClick={() => setMobileOpen((open) => !open)}
          >
            {mobileOpen ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
          </Button>
          <Logo collapsed className="mx-auto" />
          <span className="w-10 shrink-0" aria-hidden />
        </header>

        {mobileOpen ? (
          <>
            <button
              type="button"
              className="fixed inset-0 z-40 bg-black/40 backdrop-blur-[2px] md:hidden"
              aria-label="Close menu"
              onClick={() => setMobileOpen(false)}
            />
            <AppSidebar
              onNavigate={() => setMobileOpen(false)}
              showCollapseToggle={false}
              className="fixed inset-y-0 left-0 z-50 w-[min(18rem,88vw)] shadow-pop md:hidden"
            />
          </>
        ) : null}

        <main className="mx-auto w-full max-w-[min(100%,88rem)] flex-1 px-4 py-6 sm:px-6 sm:py-8 lg:px-8">
          {children}
        </main>
      </div>
    </div>
  );
}
