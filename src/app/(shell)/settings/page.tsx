"use client";

import { useCallback, useState } from "react";
import { RefreshCw } from "lucide-react";
import { apiFetch } from "@/lib/api";
import type { OperatorSettings } from "@/lib/types";
import { AccountPanel } from "@/components/settings/account-panel";
import { AccessPanel } from "@/components/settings/access-panel";
import { UsersPanel } from "@/components/settings/users-panel";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/ui/page-header";
import { Spinner } from "@/components/ui/spinner";
import { useAsyncData } from "@/hooks/use-async-data";
import { useAuth } from "@/hooks/use-auth";
import { cn } from "@/lib/utils";

type Tab = "users" | "account" | "access";

const TABS: { id: Tab; label: string }[] = [
  { id: "users", label: "Users" },
  { id: "account", label: "Your account" },
  { id: "access", label: "Access & system" },
];

export default function SettingsPage() {
  const { user } = useAuth();
  const [tab, setTab] = useState<Tab>("users");

  const fetchSettings = useCallback(() => apiFetch<OperatorSettings>("/settings"), []);
  const { data: settings, loading: settingsLoading, error: settingsError, refetch: refetchSettings } =
    useAsyncData(fetchSettings);

  return (
    <div className="space-y-8">
      <PageHeader
        title="Settings"
        description="Manage operator accounts, access policy, and your profile."
        actions={
          <Button type="button" variant="outline" size="sm" onClick={() => void refetchSettings()}>
            <RefreshCw className="mr-1.5 h-3.5 w-3.5" />
            Refresh
          </Button>
        }
      />

      <div className="flex flex-wrap gap-1 rounded-lg border border-zinc-800/90 bg-zinc-950/80 p-1">
        {TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => setTab(t.id)}
            className={cn(
              "rounded-md px-3 py-1.5 text-sm font-medium transition-colors",
              tab === t.id ? "bg-zinc-800 text-zinc-100" : "text-zinc-500 hover:text-zinc-300",
            )}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === "users" ? <UsersPanel currentUserId={user?.id} /> : null}

      {tab === "account" ? <AccountPanel /> : null}

      {tab === "access" ? (
        settingsLoading ? (
          <div className="flex items-center justify-center gap-2 py-16 text-zinc-500">
            <Spinner />
            Loading settings…
          </div>
        ) : settingsError ? (
          <p className="text-sm text-rose-400">{settingsError}</p>
        ) : settings ? (
          <AccessPanel settings={settings} onUpdated={() => void refetchSettings()} />
        ) : null
      ) : null}
    </div>
  );
}
