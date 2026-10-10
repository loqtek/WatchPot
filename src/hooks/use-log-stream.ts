"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { apiFetch } from "@/lib/api";
import { fetchCachedContainerLogs } from "@/lib/container-logs";
import type { CachedContainerLogs } from "@/lib/container-logs";
import { mergeLogText } from "@/lib/log-text";
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

const EMPTY: LogStreamState = {
  text: "",
  source: null,
  updatedAt: null,
  loading: false,
  liveFetching: false,
  error: null,
};

export function useLogStream({
  potId,
  container,
  tail,
  cachedPollMs = 8000,
  livePollMs = 15000,
  enabled = true,
}: Options) {
  const { runCommand } = usePotCommand(potId || "noop");
  const [state, setState] = useState<LogStreamState>(EMPTY);
  const mountedRef = useRef(true);
  const textRef = useRef("");
  const generation = useRef(0);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const applyIncoming = useCallback((incoming: string, patch: Partial<LogStreamState>, token: number) => {
    if (!mountedRef.current || generation.current !== token) return;
    const merged = mergeLogText(textRef.current, incoming, 2500, patch.source === "live");
    const changed = merged !== textRef.current;
    if (changed) textRef.current = merged;
    setState((current) => {
      const source =
        patch.source === "cached" && current.source === "live" ? "live" : (patch.source ?? current.source);
      const next: LogStreamState = {
        ...current,
        ...patch,
        source,
        text: changed ? merged : current.text,
      };
      if (
        next.text === current.text &&
        next.source === current.source &&
        next.updatedAt === current.updatedAt &&
        next.loading === current.loading &&
        next.liveFetching === current.liveFetching &&
        next.error === current.error
      ) {
        return current;
      }
      return next;
    });
  }, []);

  const loadCached = useCallback(
    async (token: number): Promise<boolean> => {
      if (!potId || !container) return false;
      try {
        const id = encodeURIComponent(container);
        const hit = await apiFetch<CachedContainerLogs | { raw_log: string | null; received_at: string | null }>(
          `/pots/${potId}/containers/${id}/logs/cached`,
        );
        if (generation.current !== token) return false;
        if (hit.raw_log) {
          applyIncoming(hit.raw_log, { source: "cached", updatedAt: hit.received_at ?? null, error: null }, token);
          return true;
        }
        const fallback = await fetchCachedContainerLogs(potId, container);
        if (generation.current !== token) return false;
        if (fallback?.raw_log) {
          applyIncoming(
            fallback.raw_log,
            { source: "cached", updatedAt: fallback.received_at, error: null },
            token,
          );
          return true;
        }
      } catch {
        /* live fetch still runs */
      }
      return false;
    },
    [potId, container, applyIncoming],
  );

  const fetchLive = useCallback(
    async (token: number) => {
      if (!potId || !container) return;
      if (mountedRef.current && generation.current === token) {
        setState((current) => ({ ...current, liveFetching: true, error: null }));
      }
      try {
        const result = await runCommand({
          action: "logs",
          container,
          tail,
        });
        if (generation.current !== token) return;
        if (result.status === "failed") {
          setState((current) => ({
            ...current,
            liveFetching: false,
            error: result.error || "Failed to load logs",
          }));
          return;
        }
        applyIncoming(
          result.output || "",
          { source: "live", updatedAt: new Date().toISOString(), liveFetching: false, error: null },
          token,
        );
      } catch (e) {
        if (!mountedRef.current || generation.current !== token) return;
        setState((current) => ({
          ...current,
          liveFetching: false,
          error: e instanceof Error ? e.message : "Failed to load logs",
        }));
      }
    },
    [potId, container, tail, runCommand, applyIncoming],
  );

  const refresh = useCallback(async () => {
    const token = generation.current;
    if (!potId || !container) return;
    setState((current) => ({ ...current, loading: true, error: null }));
    await loadCached(token);
    await fetchLive(token);
    if (mountedRef.current && generation.current === token) {
      setState((current) => ({ ...current, loading: false }));
    }
  }, [potId, container, loadCached, fetchLive]);

  useEffect(() => {
    const token = ++generation.current;
    textRef.current = "";
    if (!enabled || !potId || !container) {
      setState(EMPTY);
      return;
    }
    setState({ ...EMPTY, loading: true });
    void (async () => {
      await loadCached(token);
      if (generation.current !== token) return;
      await fetchLive(token);
      if (mountedRef.current && generation.current === token) {
        setState((current) => ({ ...current, loading: false }));
      }
    })();
  }, [enabled, potId, container, tail, loadCached, fetchLive]);

  useEffect(() => {
    if (!enabled || !potId || !container || cachedPollMs <= 0) return;
    const id = setInterval(() => void loadCached(generation.current), cachedPollMs);
    return () => clearInterval(id);
  }, [enabled, potId, container, cachedPollMs, loadCached]);

  useEffect(() => {
    if (!enabled || !potId || !container || livePollMs <= 0) return;
    const id = setInterval(() => void fetchLive(generation.current), livePollMs);
    return () => clearInterval(id);
  }, [enabled, potId, container, livePollMs, fetchLive]);

  return { ...state, refresh };
}
