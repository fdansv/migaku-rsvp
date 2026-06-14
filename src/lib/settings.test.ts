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
        stepDurationMs: 9_000,
        fontSize: 500,
        chunkSize: 99,
        stopMode: "unknown",
      }),
    ).toMatchObject({
      stepDurationMs: 2_000,
      fontSize: 96,
      chunkSize: 4,
      stopMode: "unknown",
    });
  });

  it("clamps lower bounds and rejects unknown select values", () => {
    expect(
      normalizeSettings({
        stepDurationMs: 1,
        fontSize: 1,
        chunkSize: 0,
        stopMode: "sometimes" as never,
        theme: "sepia" as never,
      }),
    ).toMatchObject({
      stepDurationMs: 100,
      fontSize: 36,
      chunkSize: 1,
      stopMode: DEFAULT_SETTINGS.stopMode,
      theme: DEFAULT_SETTINGS.theme,
    });
  });

  it("falls back to defaults when localStorage contains invalid JSON", () => {
    localStorage.setItem("migaku-rsvp:settings", "{not-json");
    expect(loadSettings()).toEqual(DEFAULT_SETTINGS);
  });

  it("loads saved settings from localStorage", () => {
    saveSettings({ ...DEFAULT_SETTINGS, stepDurationMs: 500, stopMode: "never" });
    expect(loadSettings()).toMatchObject({ stepDurationMs: 500, stopMode: "never" });
  });

  it("rounds numeric settings before saving", () => {
    saveSettings({ ...DEFAULT_SETTINGS, stepDurationMs: 150.6, fontSize: 63.2 });
    expect(loadSettings()).toMatchObject({ stepDurationMs: 151, fontSize: 63 });
  });

  it("migrates legacy WPM settings to step duration", () => {
    localStorage.setItem("migaku-rsvp:settings", JSON.stringify({ wpm: 300 }));
    expect(loadSettings()).toMatchObject({ stepDurationMs: 200 });
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
