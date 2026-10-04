"use client";

import { startTransition, useEffect, useState } from "react";
import { AppShell } from "@/components/shell/app-shell";
import { AuthProvider } from "@/contexts/auth-context";
import { getApiBase } from "@/lib/api";
import type { UserOut } from "@/lib/types";

export default function ShellLayout({ children }: { children: React.ReactNode }) {
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let cancelled = false;

    void (async () => {
      try {
        const res = await fetch(`${getApiBase().replace(/\/$/, "")}/auth/me`, { credentials: "include" });
        if (cancelled) return;
        if (!res.ok) {
          window.location.replace("/login");
          return;
        }
        const user = (await res.json()) as UserOut;
        if (user.must_change_password) {
          window.location.replace("/change-password");
          return;
        }
        startTransition(() => setReady(true));
      } catch {
        if (!cancelled) window.location.replace("/login");
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  if (!ready) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-paper">
        <div className="flex flex-col items-center gap-3 text-muted">
          <div className="h-6 w-6 animate-spin rounded-full border-2 border-spinner border-t-ink" />
          <span className="text-sm">Loading workspace…</span>
        </div>
      </div>
    );
  }

  return (
    <AuthProvider>
      <AppShell>{children}</AppShell>
    </AuthProvider>
  );
}
