"use client";

import { Moon, Sun } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { toggleTheme } from "@/lib/theme";

export function ThemeToggle({ collapsed = false, className }: { collapsed?: boolean; className?: string }) {
  return (
    <Button
      type="button"
      variant="ghost"
      size={collapsed ? "icon" : "md"}
      className={cn(!collapsed && "w-full justify-start", className)}
      onClick={toggleTheme}
      aria-label="Toggle color theme"
      title="Toggle color theme"
    >
      <Sun className="theme-when-dark h-4 w-4" />
      <Moon className="theme-when-light h-4 w-4" />
      {!collapsed ? (
        <>
          <span className="theme-when-light">Dark mode</span>
          <span className="theme-when-dark">Light mode</span>
        </>
      ) : null}
    </Button>
  );
}
