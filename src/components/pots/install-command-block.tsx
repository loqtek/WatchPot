"use client";

import { useState } from "react";
import { Check, Copy } from "lucide-react";
import { Button } from "@/components/ui/button";
import { notify } from "@/lib/toast";
import { cn } from "@/lib/utils";

type InstallCommandBlockProps = {
  command: string;
  label: string;
  className?: string;
};

export function InstallCommandBlock({ command, label, className }: InstallCommandBlockProps) {
  const [copied, setCopied] = useState(false);

  async function copy() {
    try {
      await navigator.clipboard.writeText(command);
      setCopied(true);
      notify.success("Copied to clipboard");
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      setCopied(false);
      notify.error("Could not copy to clipboard");
    }
  }

  return (
    <div className={cn("space-y-2", className)}>
      <div className="flex items-center justify-between gap-2">
        <p className="text-xs font-medium text-zinc-300">{label}</p>
        <Button type="button" variant="secondary" size="sm" onClick={() => void copy()}>
          {copied ? <Check className="mr-1 h-3 w-3 text-emerald-400" /> : <Copy className="mr-1 h-3 w-3" />}
          {copied ? "Copied" : "Copy"}
        </Button>
      </div>
      <pre className="overflow-x-auto rounded-lg border border-zinc-800 bg-zinc-950/90 p-3 font-mono text-[11px] leading-relaxed text-zinc-200 whitespace-pre-wrap break-all">
        {command}
      </pre>
    </div>
  );
}
