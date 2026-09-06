"use client";

import { startTransition, useEffect, useState } from "react";
import { AppShell } from "@/components/shell/app-shell";
import { AuthProvider } from "@/contexts/auth-context";
import { probeSession } from "@/lib/api";

export default function ShellLayout({ children }: { children: React.ReactNode }) {
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let cancelled = false;

    void probeSession().then((ok) => {
      if (cancelled) return;
      if (!ok) {
        window.location.replace("/login");
        return;
      }
      startTransition(() => setReady(true));
    });

    return () => {
      cancelled = true;
    };
  }, []);

  if (!ready) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-zinc-950">
        <div className="flex flex-col items-center gap-3 text-zinc-500">
          <div className="h-6 w-6 animate-spin rounded-full border-2 border-zinc-700 border-t-emerald-500" />
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
