"use client";

import { useCallback, useEffect, useState, startTransition } from "react";
import { X } from "lucide-react";
import { apiFetch } from "@/lib/api";
import type { DashboardWidget } from "@/lib/monitoring-types";
import type { Pot } from "@/lib/types";
import {
  BUCKET_OPTIONS,
  TIME_RANGE_OPTIONS,
  parseWidgetConfig,
  toWidgetConfig,
  widgetSupportsBucket,
  widgetSupportsLimit,
  widgetSupportsPotFilter,
  widgetSupportsRange,
  type WidgetDisplayConfig,
} from "@/lib/widget-config";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

type Props = {
  widget: DashboardWidget;
  open: boolean;
  onClose: () => void;
  onApply: (widgetId: string, title: string, config: Record<string, unknown>) => void;
};

function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-1.5">
      <label className="text-xs font-medium text-zinc-400">{label}</label>
      {children}
      {hint ? <p className="text-[10px] text-zinc-600">{hint}</p> : null}
    </div>
  );
}

const inputClass =
  "w-full rounded-lg border border-zinc-800 bg-zinc-950 px-2.5 py-1.5 text-sm text-zinc-100 outline-none focus:border-emerald-500/40 focus:ring-1 focus:ring-emerald-500/20";

export function WidgetConfigEditor({ widget, open, onClose, onApply }: Props) {
  const [title, setTitle] = useState(widget.title);
  const [cfg, setCfg] = useState<WidgetDisplayConfig>(() => parseWidgetConfig(widget.config));
  const [pots, setPots] = useState<Pot[]>([]);

  useEffect(() => {
    if (!open) return;
    startTransition(() => {
      setTitle(widget.title);
      setCfg(parseWidgetConfig(widget.config));
    });
  }, [open, widget]);

  useEffect(() => {
    if (!open || !widgetSupportsPotFilter(widget.widget_type)) return;
    void apiFetch<Pot[]>("/pots")
      .then(setPots)
      .catch(() => setPots([]));
  }, [open, widget.widget_type]);

  const apply = useCallback(() => {
    onApply(widget.id, title.trim() || widget.title, toWidgetConfig(cfg));
    onClose();
  }, [cfg, onApply, onClose, title, widget.id, widget.title]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;

  const showRange = widgetSupportsRange(widget.widget_type);
  const showBucket = widgetSupportsBucket(widget.widget_type);
  const showLimit = widgetSupportsLimit(widget.widget_type);
  const showPot = widgetSupportsPotFilter(widget.widget_type);

  return (
    <>
      <button
        type="button"
        className="fixed inset-0 z-[120] bg-black/50 backdrop-blur-[1px]"
        aria-label="Close panel settings"
        onClick={onClose}
      />
      <aside
        className="fixed inset-y-0 right-0 z-[130] flex w-full max-w-sm flex-col border-l border-zinc-800 bg-zinc-950 shadow-2xl shadow-black/60"
        role="dialog"
        aria-labelledby="widget-config-title"
      >
        <header className="flex shrink-0 items-center justify-between gap-3 border-b border-zinc-800 px-4 py-3">
          <div className="min-w-0">
            <p id="widget-config-title" className="truncate text-sm font-semibold text-zinc-100">
              Panel settings
            </p>
            <p className="truncate text-[10px] text-zinc-600">{widget.widget_type}</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-md p-1.5 text-zinc-500 hover:bg-zinc-800 hover:text-zinc-200"
            aria-label="Close"
          >
            <X className="h-4 w-4" />
          </button>
        </header>

        <div className="flex-1 space-y-5 overflow-y-auto px-4 py-4">
          <Field label="Title">
            <input className={inputClass} value={title} onChange={(e) => setTitle(e.target.value)} />
          </Field>

          <Field label="Panel header" hint="Hide for dense metric tiles or full-bleed charts.">
            <label className="flex cursor-pointer items-center gap-2 text-sm text-zinc-300">
              <input
                type="checkbox"
                checked={cfg.show_header !== false}
                onChange={(e) => setCfg((c) => ({ ...c, show_header: e.target.checked }))}
                className="rounded border-zinc-700 bg-zinc-900 text-emerald-500 focus:ring-emerald-500/30"
              />
              Show header
            </label>
          </Field>

          {widget.widget_type === "comparison_24h" ? (
            <Field label="Layout" hint="Compact fits KPI rows with hidden headers.">
              <label className="flex cursor-pointer items-center gap-2 text-sm text-zinc-300">
                <input
                  type="checkbox"
                  checked={cfg.compact === true}
                  onChange={(e) => setCfg((c) => ({ ...c, compact: e.target.checked }))}
                  className="rounded border-zinc-700 bg-zinc-900 text-emerald-500 focus:ring-emerald-500/30"
                />
                Compact tile
              </label>
            </Field>
          ) : null}

          {showRange ? (
            <>
              <Field label="Time range" hint="Use dashboard range or set a fixed window for this panel.">
                <label className="mb-2 flex cursor-pointer items-center gap-2 text-sm text-zinc-300">
                  <input
                    type="checkbox"
                    checked={cfg.use_global_range !== false}
                    onChange={(e) => setCfg((c) => ({ ...c, use_global_range: e.target.checked }))}
                    className="rounded border-zinc-700 bg-zinc-900 text-emerald-500 focus:ring-emerald-500/30"
                  />
                  Follow dashboard range
                </label>
                <select
                  className={cn(inputClass, cfg.use_global_range !== false && "opacity-50")}
                  disabled={cfg.use_global_range !== false}
                  value={cfg.range ?? "24h"}
                  onChange={(e) => setCfg((c) => ({ ...c, range: e.target.value }))}
                >
                  {TIME_RANGE_OPTIONS.map((o) => (
                    <option key={o.value} value={o.value}>
                      {o.label}
                    </option>
                  ))}
                </select>
              </Field>
            </>
          ) : null}

          {showBucket ? (
            <Field label="Bucket size">
              <select
                className={inputClass}
                value={cfg.bucket ?? "hour"}
                onChange={(e) => setCfg((c) => ({ ...c, bucket: e.target.value }))}
              >
                {BUCKET_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
            </Field>
          ) : null}

          {showLimit ? (
            <Field label="Row limit">
              <input
                type="number"
                min={1}
                max={100}
                className={inputClass}
                value={cfg.limit ?? 10}
                onChange={(e) => setCfg((c) => ({ ...c, limit: Number(e.target.value) || 10 }))}
              />
            </Field>
          ) : null}

          {showPot ? (
            <Field label="Pot filter" hint="Scope events to a single honeypot node.">
              <select
                className={inputClass}
                value={cfg.pot_id ?? ""}
                onChange={(e) => setCfg((c) => ({ ...c, pot_id: e.target.value || undefined }))}
              >
                <option value="">All pots</option>
                {pots.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
            </Field>
          ) : null}
        </div>

        <footer className="flex shrink-0 items-center justify-end gap-2 border-t border-zinc-800 px-4 py-3">
          <Button type="button" variant="outline" size="sm" onClick={onClose}>
            Cancel
          </Button>
          <Button type="button" variant="primary" size="sm" onClick={apply}>
            Apply
          </Button>
        </footer>
      </aside>
    </>
  );
}
