"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { notify } from "@/lib/toast";

type AsyncDataOptions = {
  /** Poll interval in ms. 0 = disabled. */
  refreshInterval?: number;
};

/**
 * Loads async data when `fetcher` changes (stabilize fetcher with `useCallback` + deps).
 * Supports background polling without clearing existing data.
 */
export function useAsyncData<T>(
  fetcher: () => Promise<T>,
  options?: AsyncDataOptions,
): {
  data: T | undefined;
  loading: boolean;
  refreshing: boolean;
  error: string | null;
  refetch: () => Promise<void>;
} {
  const [data, setData] = useState<T | undefined>();
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const mountedRef = useRef(true);
  const hasDataRef = useRef(false);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const run = useCallback(
    async (background = false) => {
      if (!background) {
        setLoading(true);
      } else if (hasDataRef.current) {
        setRefreshing(true);
      } else {
        setLoading(true);
      }
      setError(null);
      try {
        const d = await fetcher();
        if (mountedRef.current) {
          setData(d);
          hasDataRef.current = true;
        }
      } catch (e) {
        if (mountedRef.current) {
          const message = e instanceof Error ? e.message : "Request failed";
          setError(message);
          if (!background) notify.apiError(e);
          if (!background) setData(undefined);
        }
      } finally {
        if (mountedRef.current) {
          setLoading(false);
          setRefreshing(false);
        }
      }
    },
    [fetcher],
  );

  useEffect(() => {
    hasDataRef.current = false;
    void run(false);
  }, [run]);

  const interval = options?.refreshInterval ?? 0;
  useEffect(() => {
    if (interval <= 0) return;
    const id = setInterval(() => void run(true), interval);
    return () => clearInterval(id);
  }, [interval, run]);

  return { data, loading, error, refreshing, refetch: () => run(false) };
}
