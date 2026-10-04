"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { ArrowLeft, LayoutDashboard, LogIn } from "lucide-react";
import { Logo } from "@/components/shell/logo";
import { ThemeToggle } from "@/components/shell/theme-toggle";
import { Button } from "@/components/ui/button";
import { probeSession } from "@/lib/api";

export default function NotFound() {
  const [authed, setAuthed] = useState(false);

  useEffect(() => {
    void probeSession().then(setAuthed);
  }, []);

  return (
    <div className="relative flex min-h-screen flex-col items-center justify-center overflow-hidden bg-paper px-4 py-12">
      <div className="absolute right-4 top-4 z-10">
        <ThemeToggle collapsed />
      </div>
      <div
        className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_70%_40%_at_50%_-10%,rgba(226,61,18,0.08),transparent)]"
        aria-hidden
      />

      <div className="relative w-full max-w-md space-y-8 text-center">
        <div className="flex flex-col items-center gap-4">
          <Logo size="lg" collapsed asLink={false} />
          <div>
            <p className="text-6xl font-semibold tabular-nums tracking-tight text-chip">404</p>
            <h1 className="mt-2 text-xl font-semibold text-zinc-100">Page not found</h1>
            <p className="mt-2 text-sm leading-relaxed text-zinc-500">
              This URL doesn&apos;t exist, was moved, or you don&apos;t have access to it.
            </p>
          </div>
        </div>

        <div className="flex flex-col gap-2 sm:flex-row sm:justify-center">
          {authed ? (
            <Button asChild className="gap-2">
              <Link href="/dashboard">
                <LayoutDashboard className="h-4 w-4" />
                Open dashboard
              </Link>
            </Button>
          ) : (
            <Button asChild className="gap-2">
              <Link href="/login">
                <LogIn className="h-4 w-4" />
                Sign in
              </Link>
            </Button>
          )}
          <Button asChild variant="outline" className="gap-2">
            <Link href="/">
              <ArrowLeft className="h-4 w-4" />
              Go home
            </Link>
          </Button>
        </div>

        <p className="text-xs text-zinc-600">
          Signed in but expected something here? Check the URL or ask your operator for access.
        </p>
      </div>
    </div>
  );
}
