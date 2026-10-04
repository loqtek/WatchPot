"use client";

import { PanelLeft, PanelLeftClose } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/hooks/use-auth";
import { cn } from "@/lib/utils";
import { Logo } from "./logo";
import { SidebarNav } from "./sidebar-nav";
import { ThemeToggle } from "./theme-toggle";
import { UserMenu } from "./user-menu";

export function AppSidebar({
  collapsed = false,
  onToggleCollapse,
  onNavigate,
  showCollapseToggle = true,
  className,
}: {
  collapsed?: boolean;
  onToggleCollapse?: () => void;
  onNavigate?: () => void;
  showCollapseToggle?: boolean;
  className?: string;
}) {
  const { user, loading, logout } = useAuth();

  return (
    <aside
      className={cn(
        "flex h-dvh flex-col overflow-hidden border-r border-line bg-sidebar",
        collapsed ? "w-[4.5rem]" : "w-[15.5rem]",
        className,
      )}
      aria-label="Application sidebar"
    >
      <div className={cn("flex h-16 shrink-0 items-center", collapsed ? "justify-center px-2" : "px-4")}>
        <Logo collapsed={collapsed} />
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
        <SidebarNav collapsed={collapsed} onNavigate={onNavigate} />
      </div>

      <div className="shrink-0 border-t border-line bg-sidebar">
        <div className={cn("px-2 pt-2", collapsed && "flex justify-center")}>
          <ThemeToggle collapsed={collapsed} />
        </div>
        {showCollapseToggle && onToggleCollapse ? (
          <div className={cn("px-2", collapsed && "flex justify-center")}>
            <Button
              type="button"
              variant="ghost"
              size={collapsed ? "icon" : "md"}
              className={cn("text-faint hover:text-ink", !collapsed && "w-full justify-start")}
              onClick={onToggleCollapse}
              aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
              title={collapsed ? "Expand sidebar" : "Collapse sidebar"}
            >
              {collapsed ? (
                <PanelLeft className="h-4 w-4" />
              ) : (
                <>
                  <PanelLeftClose className="h-4 w-4" />
                  Collapse
                </>
              )}
            </Button>
          </div>
        ) : null}
        <UserMenu user={user} loading={loading} onLogout={logout} collapsed={collapsed} className="border-t-0" />
      </div>
    </aside>
  );
}
