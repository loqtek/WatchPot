"use client";

import { LogOut, User } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { cn } from "@/lib/utils";
import type { UserOut } from "@/lib/types";

function initials(u: UserOut) {
  const s = u.username?.trim() || u.email;
  const parts = s.split(/[@._\s-]+/).filter(Boolean);
  if (parts.length >= 2) return (parts[0]![0] + parts[1]![0]).toUpperCase();
  return s.slice(0, 2).toUpperCase();
}

export function UserMenu({
  user,
  loading,
  onLogout,
  collapsed,
  className,
}: {
  user: UserOut | null;
  loading: boolean;
  onLogout: () => void;
  collapsed?: boolean;
  className?: string;
}) {
  return (
    <div className={cn("border-t border-zinc-800/90 p-3", className)}>
      {loading ? (
        <div
          className={cn(
            "flex items-center text-zinc-500",
            collapsed ? "justify-center px-0 py-2" : "gap-3 px-2 py-2",
          )}
        >
          <Spinner size="sm" />
          {!collapsed ? <span className="text-xs">Loading account…</span> : null}
        </div>
      ) : user ? (
        <div className={cn("space-y-3", collapsed && "space-y-2")}>
          <div
            className={cn(
              "flex items-center rounded-lg py-1.5",
              collapsed ? "justify-center px-0" : "gap-3 px-2",
            )}
            title={collapsed ? `${user.username || user.email.split("@")[0]} · ${user.email}` : undefined}
          >
            <span
              className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-zinc-800 text-xs font-semibold text-zinc-300 ring-1 ring-zinc-700"
              aria-hidden
            >
              {initials(user)}
            </span>
            {!collapsed ? (
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium text-zinc-200">
                  {user.username || user.email.split("@")[0]}
                </p>
                <p className="truncate text-xs text-zinc-500">{user.email}</p>
              </div>
            ) : null}
          </div>
          <Button
            type="button"
            variant="ghost"
            size={collapsed ? "icon" : "md"}
            className={cn(
              "text-zinc-400",
              collapsed ? "mx-auto" : "w-full justify-start",
            )}
            onClick={onLogout}
            title={collapsed ? "Sign out" : undefined}
            aria-label={collapsed ? "Sign out" : undefined}
          >
            <LogOut className="h-4 w-4" />
            {!collapsed ? "Sign out" : null}
          </Button>
        </div>
      ) : (
        <div
          className={cn(
            "flex items-center text-xs text-zinc-500",
            collapsed ? "justify-center px-0 py-2" : "gap-2 px-2 py-2",
          )}
        >
          <User className="h-4 w-4 shrink-0" />
          {!collapsed ? "Session unavailable" : null}
        </div>
      )}
    </div>
  );
}
