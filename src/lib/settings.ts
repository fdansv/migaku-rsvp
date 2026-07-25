import type { ReaderSettings, StepGroupingMode, StopMode, ThemeMode } from "../types";
import { DEFAULT_SETTINGS } from "./rsvp";

const SETTINGS_KEY = "migaku-rsvp:settings";
const STOP_MODES = new Set<StopMode>(["unknown", "never", "i+1"]);
const STEP_GROUPING_MODES = new Set<StepGroupingMode>(["words", "characters"]);
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
  stepDurationMs?: unknown;
  wpm?: unknown;
};

export function normalizeSettings(value: StoredSettings): ReaderSettings {
  return {
    stepsPerMinute: clampNumber(
      value.stepsPerMinute ?? legacyStepsPerMinute(value.stepDurationMs, value.wpm),
      80,
      300,
      DEFAULT_SETTINGS.stepsPerMinute,
    ),
    fontSize: clampNumber(value.fontSize, 36, 96, DEFAULT_SETTINGS.fontSize),
    stepGroupingMode:
      value.stepGroupingMode && STEP_GROUPING_MODES.has(value.stepGroupingMode)
        ? value.stepGroupingMode
        : DEFAULT_SETTINGS.stepGroupingMode,
    chunkSize: clampNumber(value.chunkSize, 1, 4, DEFAULT_SETTINGS.chunkSize),
    characterChunkSize: clampNumber(
      value.characterChunkSize,
      1,
      24,
      DEFAULT_SETTINGS.characterChunkSize,
    ),
    maxWordStepCharacters: clampNumber(
      value.maxWordStepCharacters,
      1,
      64,
      DEFAULT_SETTINGS.maxWordStepCharacters,
    ),
    stopMode:
      value.stopMode && STOP_MODES.has(value.stopMode) ? value.stopMode : DEFAULT_SETTINGS.stopMode,
    theme: value.theme && THEMES.has(value.theme) ? value.theme : DEFAULT_SETTINGS.theme,
    recapApiUrl: normalizeString(value.recapApiUrl, DEFAULT_SETTINGS.recapApiUrl, 2_048),
    recapApiKey: normalizeString(value.recapApiKey, DEFAULT_SETTINGS.recapApiKey, 4_096),
    recapModel: normalizeString(value.recapModel, DEFAULT_SETTINGS.recapModel, 256),
    translationModel: normalizeString(
      value.translationModel,
      DEFAULT_SETTINGS.translationModel,
      256,
    ),
  };
}

function legacyStepsPerMinute(stepDurationMs: unknown, wpm: unknown) {
  if (typeof stepDurationMs === "number" && Number.isFinite(stepDurationMs) && stepDurationMs > 0) {
    return 60_000 / stepDurationMs;
  }

  if (typeof wpm === "number" && Number.isFinite(wpm) && wpm > 0) {
    return wpm;
  }

  return undefined;
}

function clampNumber(value: unknown, min: number, max: number, fallback: number) {
  if (typeof value !== "number" || !Number.isFinite(value)) {
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
