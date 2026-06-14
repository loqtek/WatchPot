"use client";

import { Plug } from "lucide-react";
import { IntegrationsPanel } from "@/components/integrations/integrations-panel";
import { PageHeader } from "@/components/ui/page-header";

export default function IntegrationsPage() {
  return (
    <div className="space-y-8">
      <PageHeader
        title="Integrations"
        description="Send WatchPot events to Grafana Loki, Grafana Alerting webhooks, Zabbix trapper items, or the Wazuh indexer using each platform’s native ingestion format."
        actions={
          <div className="flex h-9 w-9 items-center justify-center rounded-lg border border-zinc-800 bg-zinc-900/50">
            <Plug className="h-4 w-4 text-emerald-500/90" />
          </div>
        }
      />
      <IntegrationsPanel />
    </div>
  );
}
