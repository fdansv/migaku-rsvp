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
        wpm: 2_000,
        fontSize: 500,
        chunkSize: 99,
        stopMode: "unknown",
      }),
    ).toMatchObject({
      wpm: 600,
      fontSize: 96,
      chunkSize: 4,
      stopMode: "unknown",
    });
  });

  it("clamps lower bounds and rejects unknown select values", () => {
    expect(
      normalizeSettings({
        wpm: 1,
        fontSize: 1,
        chunkSize: 0,
        punctuationDelayMs: -10,
        stopMode: "sometimes" as never,
        theme: "sepia" as never,
      }),
    ).toMatchObject({
      wpm: 80,
      fontSize: 36,
      chunkSize: 1,
      punctuationDelayMs: 0,
      stopMode: DEFAULT_SETTINGS.stopMode,
      theme: DEFAULT_SETTINGS.theme,
    });
  });

  it("falls back to defaults when localStorage contains invalid JSON", () => {
    localStorage.setItem("migaku-rsvp:settings", "{not-json");
    expect(loadSettings()).toEqual(DEFAULT_SETTINGS);
  });

  it("loads saved settings from localStorage", () => {
    saveSettings({ ...DEFAULT_SETTINGS, wpm: 500, stopMode: "never" });
    expect(loadSettings()).toMatchObject({ wpm: 500, stopMode: "never" });
  });

  it("rounds numeric settings before saving", () => {
    saveSettings({ ...DEFAULT_SETTINGS, wpm: 150.6, fontSize: 63.2 });
    expect(loadSettings()).toMatchObject({ wpm: 151, fontSize: 63 });
  });
});
