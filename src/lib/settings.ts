import type { ReaderSettings, StopMode, ThemeMode } from "../types";
import { DEFAULT_SETTINGS } from "./rsvp";

const SETTINGS_KEY = "migaku-rsvp:settings";
const STOP_MODES = new Set<StopMode>(["unknown", "never", "i+1"]);
const THEMES = new Set<ThemeMode>(["paper", "dark", "contrast"]);

export function loadSettings(): ReaderSettings {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    if (!raw) {
      return DEFAULT_SETTINGS;
    }
    return normalizeSettings(JSON.parse(raw));
  } catch {
    return DEFAULT_SETTINGS;
  }
}

export function saveSettings(settings: ReaderSettings) {
  localStorage.setItem(SETTINGS_KEY, JSON.stringify(normalizeSettings(settings)));
}

export function normalizeSettings(value: Partial<ReaderSettings>): ReaderSettings {
  return {
    wpm: clampNumber(value.wpm, 80, 600, DEFAULT_SETTINGS.wpm),
    fontSize: clampNumber(value.fontSize, 36, 96, DEFAULT_SETTINGS.fontSize),
    chunkSize: clampNumber(value.chunkSize, 1, 4, DEFAULT_SETTINGS.chunkSize),
    punctuationDelayMs: clampNumber(
      value.punctuationDelayMs,
      0,
      1_200,
      DEFAULT_SETTINGS.punctuationDelayMs,
    ),
    stopMode:
      value.stopMode && STOP_MODES.has(value.stopMode) ? value.stopMode : DEFAULT_SETTINGS.stopMode,
    theme: value.theme && THEMES.has(value.theme) ? value.theme : DEFAULT_SETTINGS.theme,
  };
}

function clampNumber(value: unknown, min: number, max: number, fallback: number) {
  if (typeof value !== "number" || Number.isNaN(value)) {
    return fallback;
  }
  return Math.min(max, Math.max(min, Math.round(value)));
}
