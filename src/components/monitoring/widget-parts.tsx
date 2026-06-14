"use client";

import Link from "next/link";
import { Minus, TrendingDown, TrendingUp } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Table, TableEmptyRow, TableWrap, TBody, Td, THead, Th, Tr } from "@/components/ui/data-table";
import { formatCount } from "@/lib/chart-theme";
import { severityTone } from "@/lib/severity";
import { cn } from "@/lib/utils";
import { useFormatDateTime } from "@/hooks/use-format-datetime";

export function StatPanel({
  label,
  value,
  sub,
  delta,
  deltaPercent,
  icon: Icon,
}: {
  label: string;
  value: string | number;
  sub?: string;
  delta?: number;
  deltaPercent?: number | null;
  icon?: React.ComponentType<{ className?: string }>;
}) {
  const up = delta != null && delta > 0;
  const down = delta != null && delta < 0;
  const flat = delta != null && delta === 0;

  return (
    <div className="flex h-full min-h-0 flex-col justify-center px-1 py-0.5">
      <div className="flex items-start justify-between gap-2">
        <p className="text-[10px] font-semibold uppercase tracking-wider text-zinc-500">{label}</p>
        {Icon ? <Icon className="h-3.5 w-3.5 shrink-0 text-zinc-600" aria-hidden /> : null}
      </div>
      <p className="mt-0.5 text-2xl font-semibold tabular-nums tracking-tight text-zinc-50">
        {typeof value === "number" ? formatCount(value) : value}
      </p>
      {sub ? <p className="mt-1 text-xs text-zinc-500">{sub}</p> : null}
      {delta != null ? (
        <div className="mt-2 flex items-center gap-1.5">
          {up ? (
            <TrendingUp className="h-3.5 w-3.5 text-red-400" />
          ) : down ? (
            <TrendingDown className="h-3.5 w-3.5 text-emerald-400" />
          ) : flat ? (
            <Minus className="h-3.5 w-3.5 text-zinc-500" />
          ) : null}
          <span
            className={cn(
              "text-xs font-medium tabular-nums",
              up ? "text-red-400" : down ? "text-emerald-400" : "text-zinc-500",
            )}
          >
            {delta > 0 ? "+" : ""}
            {formatCount(delta)}
            {deltaPercent != null ? ` (${deltaPercent > 0 ? "+" : ""}${deltaPercent}%)` : ""}
          </span>
        </div>
      ) : null}
    </div>
  );
}

export function ComparisonPanel({
  current,
  previous,
  delta,
  deltaPercent,
  compact = false,
}: {
  current: number;
  previous: number;
  delta: number;
  deltaPercent: number | null;
  compact?: boolean;
}) {
  const up = delta > 0;
  if (compact) {
    return (
      <div className="flex h-full min-h-0 flex-col justify-center px-1 py-0.5">
        <p className="text-[10px] font-semibold uppercase tracking-wider text-zinc-500">24h change</p>
        <div className="mt-0.5 flex items-center gap-1.5">
          {up ? (
            <TrendingUp className="h-3.5 w-3.5 shrink-0 text-red-400" />
          ) : (
            <TrendingDown className="h-3.5 w-3.5 shrink-0 text-emerald-400" />
          )}
          <span className="text-xl font-semibold tabular-nums text-zinc-50">{formatCount(current)}</span>
          <span className={cn("text-xs font-medium tabular-nums", up ? "text-red-400" : "text-emerald-400")}>
            {delta > 0 ? "+" : ""}
            {deltaPercent != null ? `${deltaPercent}%` : formatCount(delta)}
          </span>
        </div>
        <p className="text-[10px] tabular-nums text-zinc-600">prev {formatCount(previous)}</p>
      </div>
    );
  }
  return (
    <div className="grid h-full grid-cols-2 gap-4 px-1">
      <div className="rounded-lg border border-zinc-800/60 bg-zinc-950/40 p-3">
        <p className="text-[10px] font-semibold uppercase tracking-wider text-zinc-500">Current period</p>
        <p className="mt-1 text-2xl font-semibold tabular-nums text-zinc-100">{formatCount(current)}</p>
      </div>
      <div className="rounded-lg border border-zinc-800/60 bg-zinc-950/40 p-3">
        <p className="text-[10px] font-semibold uppercase tracking-wider text-zinc-500">Previous period</p>
        <p className="mt-1 text-2xl font-semibold tabular-nums text-zinc-400">{formatCount(previous)}</p>
      </div>
      <div className="col-span-2 flex items-center gap-2 border-t border-zinc-800/60 pt-3">
        {up ? <TrendingUp className="h-4 w-4 text-red-400" /> : <TrendingDown className="h-4 w-4 text-emerald-400" />}
        <span className={cn("text-sm font-medium tabular-nums", up ? "text-red-400" : "text-emerald-400")}>
          Δ {delta > 0 ? "+" : ""}
          {formatCount(delta)}
          {deltaPercent != null ? ` (${deltaPercent > 0 ? "+" : ""}${deltaPercent}%)` : ""}
        </span>
        <span className="text-xs text-zinc-600">vs prior window</span>
      </div>
    </div>
  );
}

type EventRow = {
  id: string;
  pot_id: string;
  event_type: string;
  severity: string;
  source: string;
  received_at: string;
};

export function EventLogTable({
  items,
  variant = "table",
  maxHeight = "100%",
}: {
  items: EventRow[];
  variant?: "table" | "stream";
  maxHeight?: string;
}) {
  const { formatDateTime } = useFormatDateTime();
  if (items.length === 0) {
    return <p className="py-6 text-center text-xs text-zinc-500">No events in this window</p>;
  }

  const isStream = variant === "stream";

  return (
    <TableWrap className="border-0 bg-transparent" style={{ maxHeight, overflow: "auto" }}>
      <Table className={cn(isStream && "font-mono text-[11px]")}>
        <THead className="sticky top-0 z-10 bg-zinc-950/95 backdrop-blur-sm">
          <tr>
            <Th className="py-2 pr-2">Time</Th>
            <Th className="py-2 pr-2">Severity</Th>
            <Th className="py-2 pr-2">Event type</Th>
            <Th className="py-2 pr-2">Source</Th>
            <Th className="py-2">Pot</Th>
          </tr>
        </THead>
        <TBody>
          {items.length === 0 ? (
            <TableEmptyRow colSpan={5}>No events</TableEmptyRow>
          ) : (
            items.map((e) => (
              <Tr key={e.id} className="text-xs">
                <Td className="whitespace-nowrap py-2 pr-2 text-zinc-500 tabular-nums">
                  {formatDateTime(e.received_at, {
                    month: "short",
                    day: "numeric",
                    hour: "2-digit",
                    minute: "2-digit",
                    second: "2-digit",
                  })}
                </Td>
                <Td className="py-2 pr-2">
                  <Badge tone={severityTone(e.severity)} className="normal-case tracking-normal text-[10px]">
                    {e.severity}
                  </Badge>
                </Td>
                <Td className="max-w-[10rem] truncate py-2 pr-2 text-emerald-400/90">{e.event_type}</Td>
                <Td className="max-w-[8rem] truncate py-2 pr-2 text-zinc-500">{e.source || "—"}</Td>
                <Td className="py-2">
                  <Link href={`/pots/${e.pot_id}`} className="text-zinc-400 hover:text-emerald-400 transition-colors">
                    {e.pot_id.slice(0, 8)}…
                  </Link>
                </Td>
              </Tr>
            ))
          )}
        </TBody>
      </Table>
    </TableWrap>
  );
}

export function TopPotsList({
  items,
  linkToPots = true,
}: {
  items: { pot_id: string; name: string; count: number }[];
  linkToPots?: boolean;
}) {
  if (items.length === 0) {
    return <p className="py-4 text-center text-xs text-zinc-500">No pot activity in range</p>;
  }
  const max = Math.max(...items.map((p) => p.count), 1);

  return (
    <ul className="space-y-2.5 overflow-y-auto pr-1">
      {items.map((p, i) => {
        const pct = (p.count / max) * 100;
        const inner = (
          <>
            <div className="flex items-center justify-between gap-2">
              <span className="flex min-w-0 items-center gap-2">
                <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-md bg-zinc-800/80 text-[10px] font-semibold tabular-nums text-zinc-500">
                  {i + 1}
                </span>
                <span className="truncate text-sm text-zinc-200">{p.name}</span>
              </span>
              <span className="shrink-0 font-mono text-xs tabular-nums text-emerald-400/90">{formatCount(p.count)}</span>
            </div>
            <div className="mt-1.5 h-1 overflow-hidden rounded-full bg-zinc-800/80">
              <div className="h-full rounded-full bg-emerald-500/70" style={{ width: `${pct}%` }} />
            </div>
          </>
        );
        return (
          <li key={p.pot_id}>
            {linkToPots ? (
              <Link href={`/pots/${p.pot_id}`} className="block rounded-lg px-1 py-0.5 transition-colors hover:bg-zinc-800/30">
                {inner}
              </Link>
            ) : (
              inner
            )}
          </li>
        );
      })}
    </ul>
  );
}
