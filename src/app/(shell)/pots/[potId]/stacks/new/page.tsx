"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { ChevronRight } from "lucide-react";
import { NewStackForm } from "@/components/stacks/new-stack-form";
import { PageHeader } from "@/components/ui/page-header";

export default function NewStackPage() {
  const params = useParams();
  const potId = params.potId as string;

  return (
    <div className="space-y-8">
      <nav className="flex items-center gap-1 text-sm text-zinc-500" aria-label="Breadcrumb">
        <Link href="/pots" className="hover:text-emerald-400 transition-colors">
          Pots
        </Link>
        <ChevronRight className="h-4 w-4 shrink-0 opacity-60" aria-hidden />
        <Link href={`/pots/${potId}`} className="hover:text-emerald-400 transition-colors truncate max-w-[10rem]">
          Pot
        </Link>
        <ChevronRight className="h-4 w-4 shrink-0 opacity-60" aria-hidden />
        <span className="text-zinc-400">Deploy stack</span>
      </nav>

      <PageHeader
        title="Deploy a new stack"
        description="Choose from honeypot images, protocol traps, vulnerable lab apps, or multi-service bundles. Tune ports and policies, then edit the generated Compose YAML if you need full control."
      />

      <NewStackForm potId={potId} />
    </div>
  );
}
