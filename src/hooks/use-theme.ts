"use client";

import { useSyncExternalStore } from "react";
import { THEME_EVENT, currentTheme, type ThemeMode } from "@/lib/theme";

function subscribe(onStoreChange: () => void) {
  window.addEventListener(THEME_EVENT, onStoreChange);
  return () => window.removeEventListener(THEME_EVENT, onStoreChange);
}

export function useTheme(): ThemeMode {
  return useSyncExternalStore(subscribe, currentTheme, () => "light");
}
