"use client";

import { useEffect, useState } from "react";
import { OverviewDashboard } from "@/components/dashboard/overview-dashboard";
import { notify } from "@/lib/toast";

const RANGE_STORAGE_KEY = "watchpot_dashboard_range";
const VALID_RANGES = ["1d", "7d", "14d", "31d"] as const;

function readStoredRange(): string {
  if (typeof window === "undefined") return "1d";
  const saved = localStorage.getItem(RANGE_STORAGE_KEY);
  return saved && VALID_RANGES.includes(saved as (typeof VALID_RANGES)[number]) ? saved : "1d";
}

function readLocalAgentNotice(): string | null {
  if (typeof window === "undefined") return null;
  const msg = sessionStorage.getItem("watchpot_local_agent_notice");
  if (!msg) return null;
  sessionStorage.removeItem("watchpot_local_agent_notice");
  return msg;
}

export default function DashboardPage() {
  const [range, setRange] = useState(readStoredRange);

  useEffect(() => {
    const msg = readLocalAgentNotice();
    if (msg) notify.success(msg);
  }, []);

  function onRangeChange(r: string) {
    setRange(r);
    localStorage.setItem(RANGE_STORAGE_KEY, r);
  }

  return (
    <div className="space-y-6">
      <OverviewDashboard range={range} onRangeChange={onRangeChange} />
    </div>
  );
}
