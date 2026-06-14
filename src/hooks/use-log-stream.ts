"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { apiFetch } from "@/lib/api";
import { fetchCachedContainerLogs } from "@/lib/container-logs";
import type { CachedContainerLogs } from "@/lib/container-logs";
import { usePotCommand } from "@/hooks/use-pot-command";

export type LogStreamState = {
  text: string;
  source: "cached" | "live" | null;
  updatedAt: string | null;
  loading: boolean;
  liveFetching: boolean;
  error: string | null;
};

type Options = {
  potId: string;
  container: string;
  tail: number;
  /** Poll cached logs from the event stream (ms). 0 = off. */
  cachedPollMs?: number;
  /** Periodically fetch live logs via agent (ms). 0 = off. */
  livePollMs?: number;
  enabled?: boolean;
};

export function useLogStream({
  potId,
  container,
  tail,
  cachedPollMs = 5000,
  livePollMs = 30000,
  enabled = true,
}: Options) {
  const { runCommand } = usePotCommand(potId || "noop");
  const [state, setState] = useState<LogStreamState>({
    text: "",
    source: null,
    updatedAt: null,
    loading: false,
    liveFetching: false,
    error: null,
  });
  const mountedRef = useRef(true);
  const textRef = useRef("");

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const loadCached = useCallback(async (): Promise<boolean> => {
    if (!potId || !container) return false;
    try {
      const id = encodeURIComponent(container);
      const hit = await apiFetch<CachedContainerLogs | { raw_log: string | null; received_at: string | null }>(
        `/pots/${potId}/containers/${id}/logs/cached`,
      );
      if (hit.raw_log) {
        textRef.current = hit.raw_log;
        if (mountedRef.current) {
          setState((s) => ({
            ...s,
            text: hit.raw_log!,
            source: s.source === "live" ? "live" : "cached",
            updatedAt: hit.received_at ?? s.updatedAt,
            error: null,
          }));
        }
        return true;
      }
      const fallback = await fetchCachedContainerLogs(potId, container);
      if (fallback?.raw_log) {
        textRef.current = fallback.raw_log;
        if (mountedRef.current) {
          setState((s) => ({
            ...s,
            text: fallback.raw_log,
            source: s.source === "live" ? "live" : "cached",
            updatedAt: fallback.received_at,
            error: null,
          }));
        }
        return true;
      }
    } catch {
      /* fall through */
    }
    return false;
  }, [potId, container]);

  const fetchLive = useCallback(async () => {
    if (!potId || !container) return;
    if (mountedRef.current) setState((s) => ({ ...s, liveFetching: true, error: null }));
    try {
      const result = await runCommand({
        action: "logs",
        container,
        tail,
      });
      const output = result.output || result.error || "";
      textRef.current = output || "(empty)";
      if (mountedRef.current) {
        setState((s) => ({
          ...s,
          text: output || "(empty)",
          source: "live",
          updatedAt: new Date().toISOString(),
          liveFetching: false,
          error: result.status === "failed" ? result.error || "Failed to load logs" : null,
        }));
      }
    } catch (e) {
      if (mountedRef.current) {
        setState((s) => ({
          ...s,
          liveFetching: false,
          error: e instanceof Error ? e.message : "Failed to load logs",
        }));
      }
    }
  }, [potId, container, tail, runCommand]);

  const refresh = useCallback(async () => {
    if (!potId || !container) return;
    setState((s) => ({ ...s, loading: true, error: null }));
    await loadCached();
    await fetchLive();
    if (mountedRef.current) setState((s) => ({ ...s, loading: false }));
  }, [potId, container, loadCached, fetchLive]);

  useEffect(() => {
    if (!enabled || !potId || !container) {
      setState({
        text: "",
        source: null,
        updatedAt: null,
        loading: false,
        liveFetching: false,
        error: null,
      });
      return;
    }
    void refresh();
  }, [enabled, potId, container, tail, refresh]);

  useEffect(() => {
    if (!enabled || !potId || !container || cachedPollMs <= 0) return;
    const id = setInterval(() => void loadCached(), cachedPollMs);
    return () => clearInterval(id);
  }, [enabled, potId, container, cachedPollMs, loadCached]);

  useEffect(() => {
    if (!enabled || !potId || !container || livePollMs <= 0) return;
    const id = setInterval(() => void fetchLive(), livePollMs);
    return () => clearInterval(id);
  }, [enabled, potId, container, livePollMs, fetchLive]);

  return { ...state, refresh, fetchLive };
}
