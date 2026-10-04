"use client";

import { FormEvent, useEffect, useState } from "react";
import Link from "next/link";
import { Globe, Plug, Settings2, Shield } from "lucide-react";
import { apiFetch } from "@/lib/api";
import type { OperatorSettings } from "@/lib/types";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Spinner } from "@/components/ui/spinner";
import { notify } from "@/lib/toast";

type Props = {
  settings: OperatorSettings;
  onUpdated: () => void;
};

export function AccessPanel({ settings, onUpdated }: Props) {
  const [allowRegistration, setAllowRegistration] = useState(settings.allow_public_registration);
  const [heartbeatStale, setHeartbeatStale] = useState(String(settings.heartbeat_stale_minutes));
  const [sessionMinutes, setSessionMinutes] = useState(String(settings.access_token_expire_minutes));
  const [eventCap, setEventCap] = useState(String(settings.event_retention_max));
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setAllowRegistration(settings.allow_public_registration);
    setHeartbeatStale(String(settings.heartbeat_stale_minutes));
    setSessionMinutes(String(settings.access_token_expire_minutes));
    setEventCap(String(settings.event_retention_max));
  }, [settings]);

  async function onSave(e: FormEvent) {
    e.preventDefault();
    const stale = Number(heartbeatStale);
    const session = Number(sessionMinutes);
    const events = Number(eventCap);
    if (!Number.isFinite(stale) || stale < 1 || stale > 1440) {
      notify.error("Heartbeat stale minutes must be between 1 and 1440");
      return;
    }
    if (!Number.isFinite(session) || session < 15 || session > 10080) {
      notify.error("Session length must be between 15 minutes and 7 days");
      return;
    }
    if (!Number.isFinite(events) || events < 1000 || events > 2_000_000) {
      notify.error("Stored events must be between 1,000 and 2,000,000");
      return;
    }
    setSaving(true);
    try {
      await apiFetch<OperatorSettings>("/settings", {
        method: "PUT",
        json: {
          allow_public_registration: allowRegistration,
          heartbeat_stale_minutes: stale,
          access_token_expire_minutes: session,
          event_retention_max: events,
        },
      });
      onUpdated();
      notify.success("Settings saved");
    } catch (err) {
      notify.apiError(err, "Could not save settings");
    } finally {
      setSaving(false);
    }
  }

  const dirty =
    allowRegistration !== settings.allow_public_registration ||
    Number(heartbeatStale) !== settings.heartbeat_stale_minutes ||
    Number(sessionMinutes) !== settings.access_token_expire_minutes ||
    Number(eventCap) !== settings.event_retention_max;

  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Globe className="h-4 w-4 text-zinc-500" />
            Access policy
          </CardTitle>
          <CardDescription>
            Control who can sign up and how quickly pots are marked offline.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={onSave} className="space-y-4">
            <label className="flex cursor-pointer items-start gap-3 rounded-lg border border-zinc-800/80 bg-zinc-950/40 p-3">
              <input
                type="checkbox"
                checked={allowRegistration}
                onChange={(e) => setAllowRegistration(e.target.checked)}
                className="mt-0.5 rounded border-zinc-600"
              />
              <span>
                <span className="block text-sm font-medium text-zinc-200">Allow public registration</span>
                <span className="mt-0.5 block text-xs text-zinc-500">
                  When enabled, anyone can create an account from the login page. When disabled, add users above.
                </span>
              </span>
            </label>
            <div>
              <Label htmlFor="heartbeat-stale">Pot offline after (minutes)</Label>
              <Input
                id="heartbeat-stale"
                type="number"
                min={1}
                max={1440}
                value={heartbeatStale}
                onChange={(e) => setHeartbeatStale(e.target.value)}
                className="mt-1 max-w-[8rem]"
              />
              <p className="mt-1 text-xs text-zinc-600">
                Pots without a heartbeat within this window show as offline in the UI.
              </p>
            </div>
            <div>
              <Label htmlFor="session-minutes">Session length (minutes)</Label>
              <Input
                id="session-minutes"
                type="number"
                min={15}
                max={10080}
                value={sessionMinutes}
                onChange={(e) => setSessionMinutes(e.target.value)}
                className="mt-1 max-w-[8rem]"
              />
              <p className="mt-1 text-xs text-zinc-600">
                New sign-ins expire after this long. Changing a password or signing out revokes
                existing sessions immediately.
              </p>
            </div>
            <div>
              <Label htmlFor="event-cap">Stored events (max)</Label>
              <Input
                id="event-cap"
                type="number"
                min={1000}
                max={2000000}
                step={1000}
                value={eventCap}
                onChange={(e) => setEventCap(e.target.value)}
                className="mt-1 max-w-[10rem]"
              />
              <p className="mt-1 text-xs text-zinc-600">
                Oldest events are deleted once the store passes this count. Default is 50,000.
              </p>
            </div>
            <p className="text-xs text-zinc-500">
              Agent install assets at <code className="text-zinc-400">/api/public/agent/*</code>{" "}
              {settings.public_agent_enrollment_required ? (
                <>require a short-lived enrollment token (minted when you create or rotate a pot).</>
              ) : (
                <>are open (lab mode). Set <code className="text-zinc-400">WATCHPOT_PUBLIC_AGENT_OPEN=false</code> in production.</>
              )}
            </p>
            <Button type="submit" size="sm" disabled={saving || !dirty}>
              {saving ? (
                <>
                  <Spinner size="sm" className="mr-2 border-t-zinc-100" />
                  Saving…
                </>
              ) : (
                "Save changes"
              )}
            </Button>
          </form>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Settings2 className="h-4 w-4 text-zinc-500" />
            Related settings
          </CardTitle>
          <CardDescription>Configure integrations and enrichment on their dedicated pages.</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-2 sm:flex-row sm:flex-wrap">
          <Button asChild variant="outline" size="sm">
            <Link href="/integrations">
              <Plug className="mr-1.5 h-3.5 w-3.5" />
              SIEM integrations
            </Link>
          </Button>
          <Button asChild variant="outline" size="sm">
            <Link href="/threat-intel">
              <Shield className="mr-1.5 h-3.5 w-3.5" />
              Threat intel
            </Link>
          </Button>
        </CardContent>
      </Card>

      <Card className="lg:col-span-2">
        <CardHeader>
          <CardTitle className="text-base">Control plane info</CardTitle>
          <CardDescription>
            Read-only values from <code className="text-zinc-500">app_settings</code>. JWT secrets stay server-side.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <dl className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <div className="rounded-lg border border-zinc-800/80 bg-zinc-950/50 p-3">
              <dt className="text-[10px] font-semibold uppercase tracking-wider text-zinc-600">Deployment</dt>
              <dd className="mt-1 text-sm text-zinc-200">{settings.deployment_stack_mode}</dd>
            </div>
            <div className="rounded-lg border border-zinc-800/80 bg-zinc-950/50 p-3">
              <dt className="text-[10px] font-semibold uppercase tracking-wider text-zinc-600">JWT algorithm</dt>
              <dd className="mt-1 text-sm text-zinc-200">{settings.jwt_algorithm}</dd>
            </div>
            <div className="rounded-lg border border-zinc-800/80 bg-zinc-950/50 p-3">
              <dt className="text-[10px] font-semibold uppercase tracking-wider text-zinc-600">Token TTL</dt>
              <dd className="mt-1 text-sm text-zinc-200">{settings.access_token_expire_minutes} min</dd>
            </div>
            <div className="rounded-lg border border-zinc-800/80 bg-zinc-950/50 p-3">
              <dt className="text-[10px] font-semibold uppercase tracking-wider text-zinc-600">Registration</dt>
              <dd className="mt-1">
                <Badge tone={settings.allow_public_registration ? "success" : "default"}>
                  {settings.allow_public_registration ? "Open" : "Invite only"}
                </Badge>
              </dd>
            </div>
            {settings.cors_origins.length > 0 ? (
              <div className="rounded-lg border border-zinc-800/80 bg-zinc-950/50 p-3 sm:col-span-2 lg:col-span-4">
                <dt className="text-[10px] font-semibold uppercase tracking-wider text-zinc-600">CORS origins</dt>
                <dd className="mt-1.5 flex flex-wrap gap-1.5">
                  {settings.cors_origins.map((o) => (
                    <Badge key={o} tone="info">
                      {o}
                    </Badge>
                  ))}
                </dd>
              </div>
            ) : null}
          </dl>
        </CardContent>
      </Card>
    </div>
  );
}
