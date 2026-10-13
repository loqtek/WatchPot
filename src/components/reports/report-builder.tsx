"use client";

import { useCallback, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import { Copy, Download, FileText } from "lucide-react";
import { apiFetch, apiPostDownload } from "@/lib/api";
import type { Pot } from "@/lib/types";
import {
  FOCUS_OPTIONS,
  RANGE_OPTIONS,
  isReportFocus,
  isReportRange,
  type IncidentReport,
  type IncidentReportRequest,
  type ReportFocus,
  type ReportRange,
} from "@/lib/incident-report";
import { useAsyncData } from "@/hooks/use-async-data";
import { notify } from "@/lib/toast";
import { ReportPreview } from "@/components/reports/report-preview";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { PageHeader } from "@/components/ui/page-header";
import { Spinner } from "@/components/ui/spinner";
import { Textarea } from "@/components/ui/textarea";

const fieldClass = "mt-1.5 flex h-11 w-full rounded-xl border border-line bg-field px-3.5 text-sm text-ink";

type WindowChoice = ReportRange | "custom";

function saveBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}

export function ReportBuilder() {
  const searchParams = useSearchParams();
  const initialPot = searchParams.get("pot_id") ?? "";
  const initialIp = searchParams.get("src_ip") ?? "";
  const initialFocus = searchParams.get("focus");
  const initialRange = searchParams.get("range");

  const [title, setTitle] = useState("Honeypot activity report");
  const [range, setRange] = useState<WindowChoice>(isReportRange(initialRange) ? initialRange : "7d");
  const [since, setSince] = useState("");
  const [until, setUntil] = useState("");
  const [potId, setPotId] = useState(initialPot);
  const [srcIp, setSrcIp] = useState(initialIp);
  const [focus, setFocus] = useState<ReportFocus>(isReportFocus(initialFocus) ? initialFocus : "activity");
  const [includeRaw, setIncludeRaw] = useState(true);
  const [limit, setLimit] = useState(200);
  const [notes, setNotes] = useState("");
  const [building, setBuilding] = useState(false);
  const [exporting, setExporting] = useState<"markdown" | "html" | "json" | "copy" | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [report, setReport] = useState<IncidentReport | null>(null);
  const [builtBody, setBuiltBody] = useState<IncidentReportRequest | null>(null);

  const fetchPots = useCallback(() => apiFetch<Pot[]>("/pots"), []);
  const { data: pots } = useAsyncData(fetchPots);

  const focusHelp = FOCUS_OPTIONS.find((item) => item.value === focus)?.help ?? "";

  const requestBody = useMemo<IncidentReportRequest | null>(() => {
    const body: IncidentReportRequest = {
      title: title.trim() || "Honeypot activity report",
      focus,
      analyst_notes: notes,
      include_raw: includeRaw,
      limit,
      pot_id: potId.trim() || null,
      src_ip: srcIp.trim() || null,
    };
    if (range === "custom") {
      if (!since || !until) return null;
      const start = new Date(since);
      const end = new Date(until);
      if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || start >= end) return null;
      body.since = start.toISOString();
      body.until = end.toISOString();
      body.range = null;
      return body;
    }
    body.range = range;
    return body;
  }, [focus, includeRaw, limit, notes, potId, range, since, srcIp, title, until]);

  const dirty = report != null && JSON.stringify(requestBody) !== JSON.stringify(builtBody);

  async function buildReport() {
    setFormError(null);
    if (range === "custom") {
      if (!since || !until) {
        setFormError("Choose both a start and an end for the custom window.");
        return;
      }
      const start = new Date(since);
      const end = new Date(until);
      if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || start >= end) {
        setFormError("The window has to start before it ends.");
        return;
      }
      if (end.getTime() - start.getTime() > 366 * 24 * 60 * 60 * 1000) {
        setFormError("The window cannot be longer than 366 days.");
        return;
      }
    }
    if (!requestBody) {
      setFormError("Check the window and try again.");
      return;
    }
    setBuilding(true);
    try {
      const next = await apiFetch<IncidentReport>("/reports/incident", { method: "POST", json: requestBody });
      setReport(next);
      setBuiltBody(requestBody);
    } catch (err) {
      notify.apiError(err, "Could not build the report");
    } finally {
      setBuilding(false);
    }
  }

  async function download(format: "markdown" | "html" | "json") {
    if (!builtBody) return;
    setExporting(format);
    try {
      const { blob, filename } = await apiPostDownload(`/reports/incident/export?format=${format}`, builtBody);
      saveBlob(blob, filename);
      notify.success(format === "markdown" ? "Markdown report downloaded" : format === "html" ? "HTML report downloaded" : "JSON report downloaded");
    } catch (err) {
      notify.apiError(err, "Could not download the report");
    } finally {
      setExporting(null);
    }
  }

  async function copyMarkdown() {
    if (!builtBody) return;
    setExporting("copy");
    try {
      const { blob } = await apiPostDownload("/reports/incident/export?format=markdown", builtBody);
      await navigator.clipboard.writeText(await blob.text());
      notify.success("Markdown copied");
    } catch (err) {
      notify.apiError(err, "Could not copy the report");
    } finally {
      setExporting(null);
    }
  }

  const potMissing = potId && (pots ?? []).every((pot) => pot.id !== potId);

  return (
    <div className="space-y-8">
      <PageHeader
        title="Reports"
        description="Export a writeup of honeypot activity: what happened, who did it, the commands they ran, related vulnerabilities, and the evidence underneath."
      />

      <Card>
        <CardHeader>
          <CardTitle>Report scope</CardTitle>
          <CardDescription>
            Build the report first, then download Markdown for a writeup, HTML for printing or PDF, or JSON if you want the structured record.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-5">
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
            <div className="md:col-span-2">
              <Label htmlFor="report-title">Title</Label>
              <Input id="report-title" value={title} onChange={(event) => setTitle(event.target.value)} className="mt-1.5" />
            </div>
            <div>
              <Label htmlFor="report-range">Window</Label>
              <select id="report-range" className={fieldClass} value={range} onChange={(event) => setRange(event.target.value as WindowChoice)}>
                {RANGE_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <Label htmlFor="report-pot">Pot</Label>
              <select id="report-pot" className={fieldClass} value={potId} onChange={(event) => setPotId(event.target.value)}>
                <option value="">All pots</option>
                {potMissing ? <option value={potId}>{potId}</option> : null}
                {(pots ?? []).map((pot) => (
                  <option key={pot.id} value={pot.id}>
                    {pot.name}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <Label htmlFor="report-focus">What to include</Label>
              <select
                id="report-focus"
                className={fieldClass}
                value={focus}
                onChange={(event) => setFocus(event.target.value as ReportFocus)}
              >
                {FOCUS_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <Label htmlFor="report-ip">Source address</Label>
              <Input
                id="report-ip"
                value={srcIp}
                onChange={(event) => setSrcIp(event.target.value)}
                placeholder="Optional"
                className="mt-1.5 font-mono text-xs"
              />
            </div>
            <div>
              <Label htmlFor="report-limit">Evidence cap</Label>
              <select
                id="report-limit"
                className={fieldClass}
                value={String(limit)}
                onChange={(event) => setLimit(Number(event.target.value))}
              >
                <option value="50">50 records</option>
                <option value="100">100 records</option>
                <option value="200">200 records</option>
                <option value="400">400 records</option>
              </select>
            </div>
            <label className="flex items-end gap-2 pb-2 text-sm text-body">
              <input
                type="checkbox"
                checked={includeRaw}
                onChange={(event) => setIncludeRaw(event.target.checked)}
                className="rounded border-zinc-600"
              />
              Include raw logs
            </label>
          </div>

          {range === "custom" ? (
            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <Label htmlFor="report-since">From</Label>
                <Input id="report-since" type="datetime-local" value={since} onChange={(event) => setSince(event.target.value)} className="mt-1.5" />
              </div>
              <div>
                <Label htmlFor="report-until">To</Label>
                <Input id="report-until" type="datetime-local" value={until} onChange={(event) => setUntil(event.target.value)} className="mt-1.5" />
              </div>
            </div>
          ) : null}

          <p className="text-sm text-muted">{focusHelp}</p>

          <div>
            <Label htmlFor="report-notes">Analyst notes</Label>
            <Textarea
              id="report-notes"
              value={notes}
              onChange={(event) => setNotes(event.target.value)}
              placeholder="What stands out, what you ruled out, and what a reader should take from this activity."
              className="mt-1.5 font-sans"
            />
          </div>

          {formError ? <Alert variant="warning">{formError}</Alert> : null}

          <div className="flex flex-wrap items-center gap-2">
            <Button type="button" onClick={() => void buildReport()} disabled={building}>
              {building ? <Spinner className="h-4 w-4" /> : <FileText className="h-4 w-4" />}
              {building ? "Building" : report ? "Rebuild report" : "Build report"}
            </Button>
            {report ? (
              <>
                <Button type="button" variant="outline" onClick={() => void download("markdown")} disabled={exporting != null || dirty}>
                  {exporting === "markdown" ? <Spinner className="h-4 w-4" /> : <Download className="h-4 w-4" />}
                  Markdown
                </Button>
                <Button type="button" variant="outline" onClick={() => void download("html")} disabled={exporting != null || dirty}>
                  {exporting === "html" ? <Spinner className="h-4 w-4" /> : <Download className="h-4 w-4" />}
                  HTML
                </Button>
                <Button type="button" variant="outline" onClick={() => void download("json")} disabled={exporting != null || dirty}>
                  {exporting === "json" ? <Spinner className="h-4 w-4" /> : <Download className="h-4 w-4" />}
                  JSON
                </Button>
                <Button type="button" variant="ghost" onClick={() => void copyMarkdown()} disabled={exporting != null || dirty}>
                  {exporting === "copy" ? <Spinner className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
                  Copy Markdown
                </Button>
              </>
            ) : null}
          </div>
        </CardContent>
      </Card>

      {dirty ? (
        <Alert variant="info">The scope changed after this preview was built. Rebuild the report before downloading so the file matches what you see.</Alert>
      ) : null}

      {report?.scope.truncation_notes.length ? (
        <Alert variant="warning">
          <ul className="list-disc space-y-1 pl-4">
            {report.scope.truncation_notes.map((note) => (
              <li key={note}>{note}</li>
            ))}
          </ul>
        </Alert>
      ) : null}

      {report ? (
        <ReportPreview report={report} />
      ) : (
        <EmptyState
          icon={FileText}
          title="No report yet"
          description="Choose a window and build the report. The preview lists every section that will be in the download."
        />
      )}
    </div>
  );
}
