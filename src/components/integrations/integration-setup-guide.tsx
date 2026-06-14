"use client";

import { BookOpen, ChevronDown } from "lucide-react";
import { useState } from "react";
import type { IntegrationProvider } from "@/lib/integration-types";
import { INTEGRATION_GUIDES } from "@/lib/integration-guides";
import { cn } from "@/lib/utils";

export function IntegrationSetupGuide({ provider }: { provider: IntegrationProvider }) {
  const [open, setOpen] = useState(false);
  const guide = INTEGRATION_GUIDES[provider];

  return (
    <div className="mt-3">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="inline-flex items-center gap-1.5 text-sm text-emerald-400/90 hover:text-emerald-300 transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-500/50 rounded"
        aria-expanded={open}
      >
        <BookOpen className="h-3.5 w-3.5 shrink-0" />
        <span className="underline underline-offset-2 decoration-emerald-500/40">
          View guide here
        </span>
        <ChevronDown
          className={cn("h-3.5 w-3.5 transition-transform", open && "rotate-180")}
          aria-hidden
        />
      </button>

      {open ? (
        <div
          className="mt-4 rounded-lg border border-zinc-800/90 bg-zinc-950/60 p-4 sm:p-5 space-y-5 text-sm text-zinc-300"
          role="region"
          aria-label={`${guide.title} setup guide`}
        >
          <div>
            <h3 className="text-base font-semibold text-zinc-100">{guide.title}</h3>
            <p className="mt-1.5 text-zinc-400 leading-relaxed">{guide.summary}</p>
          </div>

          <div>
            <p className="text-xs font-medium uppercase tracking-wide text-zinc-500 mb-2">
              Before you start
            </p>
            <ul className="list-disc pl-5 space-y-1 text-zinc-400">
              {guide.prerequisites.map((p) => (
                <li key={p}>{p}</li>
              ))}
            </ul>
          </div>

          <div className="space-y-4">
            <p className="text-xs font-medium uppercase tracking-wide text-zinc-500">
              Step-by-step
            </p>
            {guide.steps.map((step) => (
              <div
                key={step.title}
                className="rounded-md border border-zinc-800/70 bg-zinc-900/40 px-4 py-3"
              >
                <h4 className="font-medium text-zinc-100">{step.title}</h4>
                <p className="mt-1 text-zinc-400 leading-relaxed">{step.description}</p>
                {step.bullets?.length ? (
                  <ul className="mt-2 list-disc pl-5 space-y-1 text-zinc-500 text-[13px]">
                    {step.bullets.map((b) => (
                      <li key={b}>{b}</li>
                    ))}
                  </ul>
                ) : null}
              </div>
            ))}
          </div>

          <div>
            <p className="text-xs font-medium uppercase tracking-wide text-zinc-500 mb-2">
              WatchPot fields → platform
            </p>
            <dl className="grid gap-2 sm:grid-cols-2">
              {guide.watchpotFields.map((f) => (
                <div
                  key={f.label}
                  className="rounded border border-zinc-800/60 px-3 py-2 bg-zinc-900/30"
                >
                  <dt className="text-xs font-medium text-zinc-300">{f.label}</dt>
                  <dd className="text-xs text-zinc-500 mt-0.5">{f.mapsTo}</dd>
                </div>
              ))}
            </dl>
          </div>

          <div>
            <p className="text-xs font-medium uppercase tracking-wide text-zinc-500 mb-2">
              Troubleshooting
            </p>
            <ul className="list-disc pl-5 space-y-1 text-zinc-500 text-[13px]">
              {guide.troubleshooting.map((t) => (
                <li key={t}>{t}</li>
              ))}
            </ul>
          </div>
        </div>
      ) : null}
    </div>
  );
}
