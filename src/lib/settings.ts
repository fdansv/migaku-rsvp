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

type StoredSettings = Partial<ReaderSettings> & {
  wpm?: unknown;
};

export function normalizeSettings(value: StoredSettings): ReaderSettings {
  return {
    stepDurationMs: clampNumber(
      value.stepDurationMs ?? legacyStepDurationMs(value.wpm),
      100,
      2_000,
      DEFAULT_SETTINGS.stepDurationMs,
    ),
    fontSize: clampNumber(value.fontSize, 36, 96, DEFAULT_SETTINGS.fontSize),
    chunkSize: clampNumber(value.chunkSize, 1, 4, DEFAULT_SETTINGS.chunkSize),
    stopMode:
      value.stopMode && STOP_MODES.has(value.stopMode) ? value.stopMode : DEFAULT_SETTINGS.stopMode,
    theme: value.theme && THEMES.has(value.theme) ? value.theme : DEFAULT_SETTINGS.theme,
    recapApiUrl: normalizeString(value.recapApiUrl, DEFAULT_SETTINGS.recapApiUrl, 2_048),
    recapApiKey: normalizeString(value.recapApiKey, DEFAULT_SETTINGS.recapApiKey, 4_096),
    recapModel: normalizeString(value.recapModel, DEFAULT_SETTINGS.recapModel, 256),
  };
}

function legacyStepDurationMs(wpm: unknown) {
  if (typeof wpm !== "number" || Number.isNaN(wpm) || wpm <= 0) {
    return undefined;
  }
  return 60_000 / wpm;
}

function clampNumber(value: unknown, min: number, max: number, fallback: number) {
  if (typeof value !== "number" || Number.isNaN(value)) {
    return fallback;
  }
  return Math.min(max, Math.max(min, Math.round(value)));
}

function normalizeString(value: unknown, fallback: string, maxLength: number) {
  if (typeof value !== "string") {
    return fallback;
  }
  return value.trim().slice(0, maxLength);
}
