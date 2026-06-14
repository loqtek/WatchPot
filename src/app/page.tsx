"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { Logo } from "@/components/shell/logo";
import { getToken } from "@/lib/api";
import { Spinner } from "@/components/ui/spinner";

export default function Home() {
  const router = useRouter();

  useEffect(() => {
    if (getToken()) router.replace("/dashboard");
    else router.replace("/login");
  }, [router]);

  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-4 bg-zinc-950 text-zinc-500">
      <Logo size="lg" className="pointer-events-none" />
      <Spinner size="lg" />
      <span className="text-sm">Loading…</span>
    </div>
  );
}
