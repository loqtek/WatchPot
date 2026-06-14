"use client";

import { useCallback, useSyncExternalStore } from "react";

const STORAGE_KEY = "watchpot_sidebar_collapsed";

function subscribe(onChange: () => void) {
  const handler = () => onChange();
  window.addEventListener("storage", handler);
  window.addEventListener("watchpot-sidebar", handler);
  return () => {
    window.removeEventListener("storage", handler);
    window.removeEventListener("watchpot-sidebar", handler);
  };
}

function readCollapsed(): boolean {
  return localStorage.getItem(STORAGE_KEY) === "true";
}

function getServerSnapshot(): boolean {
  return false;
}

export function useSidebarCollapsed() {
  const collapsed = useSyncExternalStore(subscribe, readCollapsed, getServerSnapshot);

  const toggle = useCallback(() => {
    const next = !readCollapsed();
    localStorage.setItem(STORAGE_KEY, String(next));
    window.dispatchEvent(new Event("watchpot-sidebar"));
  }, []);

  return { collapsed, toggle, ready: true };
}
