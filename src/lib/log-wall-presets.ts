export const MAX_LOG_WINDOWS = 8;
export const MIN_LOG_WINDOWS = 1;

export type LogWindowConfig = {
  id: string;
  potId: string;
  container: string;
  tail: number;
  /** Grid column position. */
  x: number;
  /** Grid row position. */
  y: number;
  /** Grid width in columns (max 12). */
  w: number;
  /** Grid height in row units (resizable). */
  h: number;
};

export type LogWallPreset = {
  id: string;
  name: string;
  windows: LogWindowConfig[];
};

const PRESETS_KEY = "watchpot.log-wall.presets";
const DEFAULT_PRESET_KEY = "watchpot.log-wall.default-preset-id";

export const BUILTIN_DEFAULT_PRESET_ID = "builtin-default";

function newWindowId(): string {
  return `w-${crypto.randomUUID().slice(0, 8)}`;
}

export function createEmptyWindow(h = 10, x = 0, y = 0, w = 12): LogWindowConfig {
  return { id: newWindowId(), potId: "", container: "", tail: 150, x, y, w, h };
}

export function createBuiltinDefaultPreset(): LogWallPreset {
  return {
    id: BUILTIN_DEFAULT_PRESET_ID,
    name: "Default",
    windows: [createEmptyWindow(14, 0, 0, 12)],
  };
}

function normalizeWindow(w: Partial<LogWindowConfig>, index: number, stackedY: number): LogWindowConfig {
  const h = typeof w.h === "number" && w.h >= 4 ? Math.min(w.h, 48) : 10;
  const hasPos = typeof w.x === "number" && typeof w.y === "number" && typeof w.w === "number";
  return {
    id: typeof w.id === "string" && w.id ? w.id : newWindowId(),
    potId: typeof w.potId === "string" ? w.potId : "",
    container: typeof w.container === "string" ? w.container : "",
    tail: typeof w.tail === "number" && w.tail > 0 ? Math.min(w.tail, 5000) : 150,
    x: hasPos ? Math.min(Math.max(w.x!, 0), 11) : 0,
    y: hasPos ? Math.max(w.y!, 0) : stackedY,
    w: hasPos ? Math.min(Math.max(w.w!, 3), 12) : 12,
    h,
  };
}

function normalizePreset(p: Partial<LogWallPreset>): LogWallPreset | null {
  if (!p || typeof p.id !== "string" || !p.id || typeof p.name !== "string" || !p.name) return null;
  const windows = Array.isArray(p.windows)
    ? p.windows
        .map((w, i, arr) => {
          const prevY = arr.slice(0, i).reduce((sum, item) => {
            const hh = typeof item.h === "number" && item.h >= 4 ? item.h : 10;
            return sum + hh;
          }, 0);
          return normalizeWindow(w, i, prevY);
        })
        .slice(0, MAX_LOG_WINDOWS)
    : [];
  if (windows.length < MIN_LOG_WINDOWS) return null;
  return { id: p.id, name: p.name, windows };
}

export function loadPresets(): LogWallPreset[] {
  if (typeof window === "undefined") return [createBuiltinDefaultPreset()];
  try {
    const raw = localStorage.getItem(PRESETS_KEY);
    if (!raw) return [createBuiltinDefaultPreset()];
    const parsed = JSON.parse(raw) as Partial<LogWallPreset>[];
    if (!Array.isArray(parsed) || parsed.length === 0) return [createBuiltinDefaultPreset()];
    const presets = parsed.map(normalizePreset).filter((p): p is LogWallPreset => p !== null);
    if (!presets.some((p) => p.id === BUILTIN_DEFAULT_PRESET_ID)) {
      presets.unshift(createBuiltinDefaultPreset());
    }
    return presets.length > 0 ? presets : [createBuiltinDefaultPreset()];
  } catch {
    return [createBuiltinDefaultPreset()];
  }
}

export function savePresets(presets: LogWallPreset[]): void {
  if (typeof window === "undefined") return;
  localStorage.setItem(PRESETS_KEY, JSON.stringify(presets));
}

export function loadDefaultPresetId(): string {
  if (typeof window === "undefined") return BUILTIN_DEFAULT_PRESET_ID;
  return localStorage.getItem(DEFAULT_PRESET_KEY) || BUILTIN_DEFAULT_PRESET_ID;
}

export function saveDefaultPresetId(id: string): void {
  if (typeof window === "undefined") return;
  localStorage.setItem(DEFAULT_PRESET_KEY, id);
}

export function getPresetById(presets: LogWallPreset[], id: string): LogWallPreset | undefined {
  return presets.find((p) => p.id === id);
}

export function clonePreset(preset: LogWallPreset, name: string): LogWallPreset {
  return {
    id: `preset-${crypto.randomUUID().slice(0, 8)}`,
    name,
    windows: preset.windows.map((w) => ({ ...w, id: newWindowId() })),
  };
}
