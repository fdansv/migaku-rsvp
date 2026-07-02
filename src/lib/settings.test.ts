import { beforeEach, describe, expect, it } from "vitest";
import { DEFAULT_SETTINGS } from "./rsvp";
import { loadSettings, normalizeSettings, saveSettings } from "./settings";

describe("settings persistence", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("normalizes invalid values back to safe defaults", () => {
    expect(
      normalizeSettings({
        stepsPerMinute: 9_000,
        fontSize: 500,
        chunkSize: 99,
        characterChunkSize: 99,
        stepGroupingMode: "characters",
        stopMode: "unknown",
      }),
    ).toMatchObject({
      stepsPerMinute: 300,
      fontSize: 96,
      chunkSize: 4,
      characterChunkSize: 24,
      stepGroupingMode: "characters",
      stopMode: "unknown",
    });
  });

  it("clamps lower bounds and rejects unknown select values", () => {
    expect(
      normalizeSettings({
        stepsPerMinute: 1,
        fontSize: 1,
        chunkSize: 0,
        characterChunkSize: 0,
        stepGroupingMode: "paragraphs" as never,
        stopMode: "sometimes" as never,
        theme: "sepia" as never,
      }),
    ).toMatchObject({
      stepsPerMinute: 80,
      fontSize: 36,
      chunkSize: 1,
      characterChunkSize: 1,
      stepGroupingMode: DEFAULT_SETTINGS.stepGroupingMode,
      stopMode: DEFAULT_SETTINGS.stopMode,
      theme: DEFAULT_SETTINGS.theme,
    });
  });

  it("falls back to defaults when localStorage contains invalid JSON", () => {
    localStorage.setItem("migaku-rsvp:settings", "{not-json");
    expect(loadSettings()).toEqual(DEFAULT_SETTINGS);
  });

  it("loads saved settings from localStorage", () => {
    saveSettings({ ...DEFAULT_SETTINGS, stepsPerMinute: 120, stopMode: "never" });
    expect(loadSettings()).toMatchObject({ stepsPerMinute: 120, stopMode: "never" });
  });

  it("rounds numeric settings before saving", () => {
    saveSettings({ ...DEFAULT_SETTINGS, stepsPerMinute: 150.6, fontSize: 63.2 });
    expect(loadSettings()).toMatchObject({ stepsPerMinute: 151, fontSize: 63 });
  });

  it("migrates legacy step durations to steps per minute", () => {
    localStorage.setItem("migaku-rsvp:settings", JSON.stringify({ stepDurationMs: 450 }));
    expect(loadSettings()).toMatchObject({ stepsPerMinute: 133 });
  });

  it("migrates legacy WPM settings to steps per minute", () => {
    localStorage.setItem("migaku-rsvp:settings", JSON.stringify({ wpm: 300 }));
    expect(loadSettings()).toMatchObject({ stepsPerMinute: 300 });
  });

  it("persists user-entered recap AI settings", () => {
    saveSettings({
      ...DEFAULT_SETTINGS,
      recapApiUrl: " user-entered-url ",
      recapApiKey: " user-entered-key ",
      recapModel: " user-entered-model ",
    });

    expect(loadSettings()).toMatchObject({
      recapApiUrl: "user-entered-url",
      recapApiKey: "user-entered-key",
      recapModel: "user-entered-model",
    });
  });
});
