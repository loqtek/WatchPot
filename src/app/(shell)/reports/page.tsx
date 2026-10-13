"use client";

import { Suspense } from "react";
import { ReportBuilder } from "@/components/reports/report-builder";
import { Spinner } from "@/components/ui/spinner";

export default function ReportsPage() {
  return (
    <Suspense
      fallback={
        <div className="flex items-center gap-3 py-16 text-muted">
          <Spinner />
          <span className="text-sm">Loading reports…</span>
        </div>
      }
    >
      <ReportBuilder />
    </Suspense>
  );
}
