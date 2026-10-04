export const THEME_STORAGE_KEY = "watchpot-theme";
export const THEME_EVENT = "watchpot-theme";

export type ThemeMode = "light" | "dark";

/** Runs before paint so the saved theme does not flash the other mode. */
export const THEME_BOOT_SCRIPT = `(function(){try{var k=${JSON.stringify(THEME_STORAGE_KEY)};var s=localStorage.getItem(k);var t=s==="dark"||s==="light"?s:(matchMedia("(prefers-color-scheme: dark)").matches?"dark":"light");var d=document.documentElement;d.dataset.theme=t;d.style.colorScheme=t;}catch(e){}})();`;

export function currentTheme(): ThemeMode {
  if (typeof document === "undefined") return "light";
  return document.documentElement.dataset.theme === "dark" ? "dark" : "light";
}

export function applyTheme(theme: ThemeMode) {
  const root = document.documentElement;
  root.dataset.theme = theme;
  root.style.colorScheme = theme;
  try {
    localStorage.setItem(THEME_STORAGE_KEY, theme);
  } catch {
    /* private mode */
  }
  window.dispatchEvent(new Event(THEME_EVENT));
}

export function toggleTheme() {
  applyTheme(currentTheme() === "dark" ? "light" : "dark");
}
