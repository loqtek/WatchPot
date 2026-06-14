"use client";

import { useState } from "react";
import { Check, Copy, Download } from "lucide-react";
import { Button } from "@/components/ui/button";
import { notify } from "@/lib/toast";
import {
  ZABBIX_DASHBOARD_STEPS,
  ZABBIX_HOST_PRESETS,
  ZABBIX_JSONPATH_PRESETS,
  ZABBIX_SEVERITY_LEGEND,
  ZABBIX_TEMPLATE_URL,
  ZABBIX_TRIGGER_PRESETS,
  type ZabbixPreset,
} from "@/lib/zabbix-presets";

function CopyRow({ preset }: { preset: ZabbixPreset }) {
  const [copied, setCopied] = useState(false);

  async function copy() {
    try {
      await navigator.clipboard.writeText(preset.value);
      setCopied(true);
      notify.success("Copied to clipboard");
      setTimeout(() => setCopied(false), 2000);
    } catch {
      notify.error("Could not copy to clipboard");
    }
  }

  return (
    <div className="rounded-md border border-zinc-800/70 bg-zinc-900/50 px-3 py-2.5">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <p className="text-xs font-medium text-zinc-300">{preset.label}</p>
          {preset.hint ? <p className="text-[11px] text-zinc-500 mt-0.5">{preset.hint}</p> : null}
          <code className="mt-1.5 block text-[12px] text-emerald-400/90 break-all font-mono">
            {preset.value}
          </code>
        </div>
        <Button type="button" variant="outline" size="sm" className="shrink-0" onClick={() => void copy()}>
          {copied ? (
            <>
              <Check className="mr-1 h-3 w-3" />
              Copied
            </>
          ) : (
            <>
              <Copy className="mr-1 h-3 w-3" />
              Copy
            </>
          )}
        </Button>
      </div>
    </div>
  );
}

export function ZabbixPresetsPanel() {
  return (
    <div className="rounded-lg border border-emerald-500/20 bg-emerald-950/20 p-4 space-y-4">
      <div>
        <h4 className="text-sm font-semibold text-zinc-100">Quick setup — import template</h4>
        <p className="text-xs text-zinc-400 mt-1 leading-relaxed">
          WatchPot sends JSON plus ready-to-graph numbers. Import once, link the template to your host, add a
          dashboard graph — no manual JSONPath required.
        </p>
      </div>

      <ol className="text-xs text-zinc-400 space-y-1.5 list-decimal pl-4">
        <li>
          Download{" "}
          <a
            href={ZABBIX_TEMPLATE_URL}
            download="watchpot-template.xml"
            className="text-emerald-400 hover:underline inline-flex items-center gap-1"
          >
            watchpot-template.xml
            <Download className="h-3 w-3" />
          </a>{" "}
          (items + trigger — no bundled graphs; Zabbix 7.4 cannot resolve them on import)
        </li>
        <li>Data collection → Templates → Import → link template <strong>WatchPot</strong> to host <strong>watchpot</strong></li>
        <li>Run WatchPot test connection, then check Latest data on host watchpot for the three keys</li>
      </ol>

      <div className="rounded-md border border-zinc-800/70 bg-zinc-900/40 px-3 py-3 space-y-1.5">
        <p className="text-xs font-medium text-zinc-300">Add the graph (30 seconds)</p>
        <ol className="text-[11px] text-zinc-500 list-decimal pl-4 space-y-1">
          {ZABBIX_DASHBOARD_STEPS.map((step) => (
            <li key={step}>{step}</li>
          ))}
        </ol>
        <p className="text-[11px] text-amber-400/90">
          Pick your <strong>host</strong> (watchpot), not template name WatchPot — that fixes “Cannot find item on
          WatchPot”.
        </p>
      </div>

      <p className="text-[11px] text-zinc-500">{ZABBIX_SEVERITY_LEGEND}</p>

      <div className="space-y-2">
        <p className="text-[11px] font-medium uppercase tracking-wide text-zinc-500">Copy into WatchPot</p>
        {ZABBIX_HOST_PRESETS.map((p) => (
          <CopyRow key={p.id} preset={p} />
        ))}
      </div>

      <details className="text-xs">
        <summary className="cursor-pointer text-zinc-500 hover:text-zinc-300">Advanced: JSONPath & triggers</summary>
        <div className="mt-3 space-y-2">
          {ZABBIX_JSONPATH_PRESETS.map((p) => (
            <CopyRow key={p.id} preset={p} />
          ))}
          {ZABBIX_TRIGGER_PRESETS.map((p) => (
            <CopyRow key={p.id} preset={p} />
          ))}
        </div>
      </details>
    </div>
  );
}
