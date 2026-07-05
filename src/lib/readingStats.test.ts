import { describe, expect, it } from "vitest";
import type { ReadingSession, Sentence } from "../types";
import { createSentence } from "./text";
import {
  estimateRemainingReadingTime,
  formatReadingDuration,
  getDailyReadingStats,
  getReadingStepStats,
} from "./readingStats";

const sentence = createSentence("猫が走る。", "chapter:0", 0, 0, 0) as Sentence;

describe("reading stats", () => {
  it("counts displayed word-like tokens and characters", () => {
    expect(
      getReadingStepStats(sentence, {
        startOffset: 0,
        endOffset: 2,
        tokenIndexes: [0, 1],
        text: "猫が",
      }),
    ).toEqual({
      wordCount: 2,
      characterCount: 2,
    });
  });

  it("aggregates reading sessions into local days", () => {
    const sessions: ReadingSession[] = [
      {
        id: "morning",
        bookId: "book:1",
        startedAt: new Date(2026, 0, 10, 9, 0).toISOString(),
        endedAt: new Date(2026, 0, 10, 9, 30).toISOString(),
        durationMs: 30 * 60_000,
        wordCount: 120,
        characterCount: 480,
        startLocation: createLocation(1, 100),
        endLocation: createLocation(31, 100),
      },
      {
        id: "overnight",
        bookId: "book:1",
        startedAt: new Date(2026, 0, 9, 23, 50).toISOString(),
        endedAt: new Date(2026, 0, 10, 0, 10).toISOString(),
        durationMs: 20 * 60_000,
        wordCount: 40,
        characterCount: 200,
        startLocation: createLocation(31, 100),
        endLocation: createLocation(51, 100),
      },
    ];

    const days = getDailyReadingStats(sessions, new Date(2026, 0, 10, 12), 2);

    expect(days.map((day) => ({ date: day.date, durationMs: day.durationMs }))).toEqual([
      { date: "2026-01-09", durationMs: 10 * 60_000 },
      { date: "2026-01-10", durationMs: 40 * 60_000 },
    ]);
    expect(days[0]).toMatchObject({ wordCount: 20, characterCount: 100 });
    expect(days[1]).toMatchObject({ wordCount: 140, characterCount: 580 });
  });

  it("estimates remaining book time from matching progress-location spans", () => {
    const sessions: ReadingSession[] = [
      {
        id: "words-mode",
        bookId: "book:1",
        startedAt: new Date(2026, 0, 10, 9, 0).toISOString(),
        endedAt: new Date(2026, 0, 10, 9, 10).toISOString(),
        durationMs: 10 * 60_000,
        wordCount: 80,
        characterCount: 320,
        startLocation: createLocation(10, 100),
        endLocation: createLocation(30, 100),
      },
      {
        id: "other-total",
        bookId: "book:1",
        startedAt: new Date(2026, 0, 10, 9, 20).toISOString(),
        endedAt: new Date(2026, 0, 10, 9, 30).toISOString(),
        durationMs: 10 * 60_000,
        wordCount: 80,
        characterCount: 320,
        startLocation: createLocation(10, 200),
        endLocation: createLocation(50, 200),
      },
    ];

    expect(estimateRemainingReadingTime(sessions, "book:1", { current: 50, total: 100 }))
      .toMatchObject({
        durationMs: 25 * 60_000,
        remainingUnits: 50,
        sessionCount: 1,
      });
  });

  it("formats chart duration labels", () => {
    expect(formatReadingDuration(0)).toBe("0m");
    expect(formatReadingDuration(30_000)).toBe("<1m");
    expect(formatReadingDuration(90 * 60_000)).toBe("1h 30m");
  });
});

function createLocation(progressCurrent: number, progressTotal: number) {
  return {
    position: {
      sentenceIndex: 0,
      tokenIndex: 0,
    },
    progressCurrent,
    progressTotal,
  };
}
