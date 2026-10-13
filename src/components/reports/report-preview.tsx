"use client";

import type { ReactNode } from "react";
import { ATTACK_TYPE_LABELS } from "@/lib/enrichment-types";
import type { IncidentReport, ReportAttacker, ReportCommand, ReportGeo } from "@/lib/incident-report";
import { severityTone } from "@/lib/event-display";
import { Badge } from "@/components/ui/badge";
import { useFormatDateTime } from "@/hooks/use-format-datetime";

const KIND_LABELS: Record<string, string> = {
  shell: "Shell commands",
  http: "HTTP requests",
  login: "Login attempts",
  download: "Downloads",
};

const KIND_ORDER = ["shell", "http", "login", "download"];

function attackLabel(key: string): string {
  return ATTACK_TYPE_LABELS[key] ?? key.replace(/_/g, " ");
}

function place(geo: ReportGeo | null): string | null {
  if (!geo) return null;
  const where = [geo.city, geo.region, geo.country].filter(Boolean).join(", ");
  const network = geo.asn_label || geo.org || geo.isp;
  const line = [where, network].filter(Boolean).join(" · ");
  return line || null;
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-xl border border-line bg-recessed px-3 py-2.5">
      <p className="text-[11px] font-medium uppercase tracking-wide text-faint">{label}</p>
      <p className="mt-0.5 text-lg font-semibold tabular-nums text-ink">{value}</p>
    </div>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="space-y-3">
      <h3 className="text-[13px] font-semibold uppercase tracking-[0.12em] text-faint">{title}</h3>
      {children}
    </section>
  );
}

function BulletList({ items, empty }: { items: string[]; empty: string }) {
  if (items.length === 0) return <p className="text-sm text-muted">{empty}</p>;
  return (
    <ul className="flex flex-wrap gap-1.5">
      {items.map((item) => (
        <li key={item}>
          <span className="inline-flex rounded-full border border-line bg-recessed px-2.5 py-0.5 font-mono text-[12px] text-body">
            {item}
          </span>
        </li>
      ))}
    </ul>
  );
}

function groupCommands(commands: ReportCommand[]) {
  const byKind = new Map<string, ReportCommand[]>();
  for (const command of commands) {
    const list = byKind.get(command.kind) ?? [];
    list.push(command);
    byKind.set(command.kind, list);
  }
  const kinds = [...KIND_ORDER.filter((kind) => byKind.has(kind)), ...[...byKind.keys()].filter((kind) => !KIND_ORDER.includes(kind))];
  return kinds.map((kind) => ({ kind, commands: byKind.get(kind) ?? [] }));
}

function AttackerCard({
  attacker,
  formatWhen,
}: {
  attacker: ReportAttacker;
  formatWhen: (iso: string) => string;
}) {
  const where = place(attacker.geo);
  const facts = [
    attacker.tracked ? attacker.status : `${attacker.status}, not in the IP tracker`,
    where,
    attacker.abuse_score != null ? `abuse score ${attacker.abuse_score}` : null,
    attacker.is_tor ? "Tor exit" : null,
    attacker.is_hosting ? "hosting" : null,
    attacker.geo?.is_proxy ? "proxy" : null,
  ].filter(Boolean);
  return (
    <article className="rounded-xl border border-line bg-recessed p-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h4 className="font-mono text-sm font-semibold text-ink">{attacker.ip_address}</h4>
        <p className="text-xs text-muted">
          {attacker.command_count} commands · {attacker.event_count} events
        </p>
      </div>
      <p className="mt-1 text-sm text-body">{facts.join(" · ")}</p>
      <dl className="mt-3 grid gap-1 text-xs text-muted sm:grid-cols-2">
        <div>First seen {attacker.first_seen_at ? formatWhen(attacker.first_seen_at) : "—"}</div>
        <div>Last seen {attacker.last_seen_at ? formatWhen(attacker.last_seen_at) : "—"}</div>
      </dl>
      {attacker.attack_types.length > 0 || attacker.tools.length > 0 || attacker.cve_ids.length > 0 ? (
        <p className="mt-2 text-xs text-muted">
          {[
            attacker.attack_types.map(attackLabel).join(", "),
            attacker.tools.join(", "),
            attacker.cve_ids.join(", "),
          ]
            .filter(Boolean)
            .join(" · ")}
        </p>
      ) : null}
      {attacker.usernames.length > 0 ? (
        <p className="mt-1 text-xs text-muted">Usernames: {attacker.usernames.join(", ")}</p>
      ) : null}
      {attacker.user_notes ? (
        <p className="mt-3 whitespace-pre-wrap border-l-2 border-emerald-600/70 pl-3 text-sm text-body">{attacker.user_notes}</p>
      ) : null}
    </article>
  );
}

export function ReportPreview({ report }: { report: IncidentReport }) {
  const { formatDateTime } = useFormatDateTime();
  const { scope, counts } = report;
  const commandGroups = groupCommands(report.commands);

  return (
    <article className="overflow-hidden rounded-2xl border border-line bg-surface shadow-card">
      <header className="border-b border-line px-5 py-6 sm:px-8">
        <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-emerald-500">watchPot report</p>
        <h2 className="mt-2 text-2xl font-semibold tracking-tight text-ink">{scope.title}</h2>
        <p className="mt-2 max-w-2xl text-sm text-muted">
          {scope.focus_label}
          {scope.pot_name ? ` · ${scope.pot_name}` : " · all pots"}
          {scope.src_ip ? ` · ${scope.src_ip}` : ""}
          {" · "}
          {formatDateTime(scope.since)} to {formatDateTime(scope.until)}
        </p>
        <p className="mt-2 text-xs text-faint">
          Preview times follow your account timezone. The downloaded file uses UTC and was prepared for {scope.generated_by}.
        </p>
      </header>

      <div className="space-y-8 px-5 py-6 sm:px-8">
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <Stat label="Events" value={counts.events} />
          <Stat label="Commands" value={counts.commands} />
          <Stat label="Sources" value={counts.source_ips} />
          <Stat label="CVEs" value={counts.cves} />
        </div>

        <Section title="Summary">
          <div className="space-y-3 text-[15px] leading-relaxed text-body">
            {report.paragraphs.map((paragraph, index) => (
              <p key={index}>{paragraph}</p>
            ))}
          </div>
        </Section>

        <Section title="Analyst notes">
          {scope.analyst_notes ? (
            <p className="whitespace-pre-wrap text-[15px] leading-relaxed text-body">{scope.analyst_notes}</p>
          ) : (
            <p className="text-sm text-muted">No analyst notes were added. They appear near the top of the download.</p>
          )}
        </Section>

        <Section title="Indicators">
          <div className="space-y-4">
            <div>
              <p className="mb-1.5 text-xs font-medium text-muted">Source addresses</p>
              <BulletList items={report.attackers.map((item) => item.ip_address)} empty="None recorded." />
            </div>
            <div>
              <p className="mb-1.5 text-xs font-medium text-muted">Usernames</p>
              <BulletList items={report.usernames} empty="None recorded." />
            </div>
            <div>
              <p className="mb-1.5 text-xs font-medium text-muted">Attack types</p>
              <BulletList
                items={report.by_attack_type.map((item) => `${item.label} (${item.count})`)}
                empty="None recorded."
              />
            </div>
            <div>
              <p className="mb-1.5 text-xs font-medium text-muted">Tools and CVEs</p>
              <BulletList
                items={[...report.by_tool.map((item) => item.label), ...report.cves.map((item) => item.cve_id)]}
                empty="None recorded."
              />
            </div>
          </div>
        </Section>

        <Section title="Attacker profiles">
          {report.attackers.length === 0 ? (
            <p className="text-sm text-muted">No source addresses were recorded for this scope.</p>
          ) : (
            <div className="space-y-3">
              {report.attackers.map((attacker) => (
                <AttackerCard key={attacker.ip_address} attacker={attacker} formatWhen={formatDateTime} />
              ))}
            </div>
          )}
        </Section>

        <Section title="Timeline">
          {report.timeline.length === 0 ? (
            <p className="text-sm text-muted">No events were included.</p>
          ) : (
            <div className="overflow-x-auto rounded-xl border border-line">
              <table className="w-full min-w-[720px] text-left text-sm">
                <thead className="bg-recessed text-xs uppercase tracking-wide text-faint">
                  <tr>
                    <th className="px-3 py-2 font-medium">Time</th>
                    <th className="px-3 py-2 font-medium">Pot</th>
                    <th className="px-3 py-2 font-medium">What happened</th>
                    <th className="px-3 py-2 font-medium">Severity</th>
                  </tr>
                </thead>
                <tbody>
                  {report.timeline.map((event) => (
                    <tr key={event.id} className="border-t border-line">
                      <td className="whitespace-nowrap px-3 py-2 text-xs text-muted">{formatDateTime(event.received_at)}</td>
                      <td className="px-3 py-2 text-body">{event.pot_name ?? event.pot_id.slice(0, 8)}</td>
                      <td className="px-3 py-2">
                        <p className="text-ink">{event.summary || event.event_title}</p>
                        <p className="mt-0.5 text-xs text-muted">
                          {[event.service_name, ...event.source_ips, ...event.attack_types.map(attackLabel), ...event.cve_ids]
                            .filter(Boolean)
                            .join(" · ") || event.event_type}
                        </p>
                      </td>
                      <td className="px-3 py-2">
                        <Badge tone={severityTone(event.severity)}>{event.severity}</Badge>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Section>

        <Section title="Commands and requests">
          {commandGroups.length === 0 ? (
            <p className="text-sm text-muted">No commands or requests were captured in this scope.</p>
          ) : (
            <div className="space-y-5">
              {commandGroups.map((group) => (
                <div key={group.kind} className="space-y-2">
                  <h4 className="text-sm font-medium text-ink">{KIND_LABELS[group.kind] ?? group.kind}</h4>
                  {group.commands.map((command) => (
                    <div key={command.id} className="rounded-xl border border-line bg-recessed p-3">
                      <p className="text-xs text-muted">
                        {formatDateTime(command.observed_at)}
                        {command.src_ip ? ` · ${command.src_ip}` : ""}
                        {command.username ? ` · ${command.username}` : ""}
                        {command.pot_name ? ` · ${command.pot_name}` : ""}
                        {command.container ? ` · ${command.container}` : ""}
                        {command.hit_count > 1 ? ` · seen ${command.hit_count} times` : ""}
                      </p>
                      <pre className="mt-2 overflow-x-auto whitespace-pre-wrap break-words font-mono text-xs text-ink">
                        {command.command}
                      </pre>
                      {command.context ? (
                        <details className="mt-2">
                          <summary className="cursor-pointer text-xs text-muted">Surrounding log</summary>
                          <pre className="mt-2 max-h-64 overflow-auto whitespace-pre-wrap break-words rounded-lg bg-zinc-950 p-3 font-mono text-xs text-zinc-300">
                            {command.context}
                          </pre>
                        </details>
                      ) : null}
                    </div>
                  ))}
                </div>
              ))}
            </div>
          )}
        </Section>

        <Section title="Vulnerabilities">
          {report.cves.length === 0 ? (
            <p className="text-sm text-muted">No CVEs were correlated with this activity.</p>
          ) : (
            <div className="space-y-3">
              {report.cves.map((cve) => (
                <article key={cve.cve_id} className="rounded-xl border border-line p-4">
                  <div className="flex flex-wrap items-center gap-2">
                    <h4 className="font-mono text-sm font-semibold text-ink">{cve.cve_id}</h4>
                    {cve.severity ? <Badge tone={severityTone(cve.severity)}>{cve.severity}</Badge> : null}
                    {cve.cvss_score != null ? <span className="text-xs text-muted">CVSS {cve.cvss_score}</span> : null}
                  </div>
                  {cve.summary ? <p className="mt-2 text-sm leading-relaxed text-body">{cve.summary}</p> : null}
                  <p className="mt-2 text-xs text-muted">
                    {[cve.vendor, cve.product].filter(Boolean).join(" ") || "Product not recorded"}
                    {` · ${cve.event_count} events`}
                    {cve.source_ips.length ? ` · ${cve.source_ips.join(", ")}` : ""}
                    {cve.in_cache ? "" : " · not in the local CVE cache"}
                  </p>
                </article>
              ))}
            </div>
          )}
        </Section>

        <Section title="Evidence">
          {report.timeline.length === 0 ? (
            <p className="text-sm text-muted">No event evidence was included.</p>
          ) : (
            <div className="space-y-2">
              <p className="text-sm text-muted">
                {report.timeline.length} events. Open a row for the payload and raw log. The download contains every row in full.
              </p>
              {report.timeline.map((event, index) => (
                <details key={event.id} className="rounded-xl border border-line px-3 py-2">
                  <summary className="cursor-pointer text-sm text-ink">
                    <span className="text-muted">{index + 1}.</span> {formatDateTime(event.received_at)} · {event.event_title}
                    {event.summary ? ` · ${event.summary}` : ""}
                  </summary>
                  <dl className="mt-3 grid gap-1 text-xs sm:grid-cols-[8rem_1fr]">
                    <dt className="text-muted">Event id</dt>
                    <dd className="font-mono text-body break-all">{event.id}</dd>
                    <dt className="text-muted">Pot</dt>
                    <dd className="text-body">{event.pot_name ?? event.pot_id}</dd>
                    <dt className="text-muted">Service</dt>
                    <dd className="text-body">{event.service_name ?? "—"}</dd>
                    <dt className="text-muted">Enrichment</dt>
                    <dd className="text-body">
                      {event.enrichment_status ?? "—"}
                      {event.confidence != null ? ` · ${Math.round(event.confidence * 100)}%` : ""}
                    </dd>
                  </dl>
                  {event.payload ? (
                    <pre className="mt-3 max-h-64 overflow-auto whitespace-pre-wrap break-words rounded-lg bg-zinc-950 p-3 font-mono text-xs text-zinc-300">
                      {JSON.stringify(event.payload, null, 2)}
                    </pre>
                  ) : null}
                  {event.raw_log ? (
                    <pre className="mt-3 max-h-72 overflow-auto whitespace-pre-wrap break-words rounded-lg bg-zinc-950 p-3 font-mono text-xs text-zinc-300">
                      {event.raw_log}
                    </pre>
                  ) : (
                    <p className="mt-3 text-xs text-muted">Raw log was not included.</p>
                  )}
                </details>
              ))}
            </div>
          )}
        </Section>
      </div>
    </article>
  );
}
