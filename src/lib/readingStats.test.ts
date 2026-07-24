import { describe, expect, it } from "vitest";
import type { LookupEvent, ReadingSession, Sentence } from "../types";
import { createSentence } from "./text";
import {
  estimateRemainingReadingTime,
  formatReadingDuration,
  getBookLookupDays,
  getBookLookupStats,
  getBookProgressDays,
  getBookReadingStats,
  getBookSpeedDays,
  getDailyLookupStats,
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

  it("summarizes reading sessions for a single book", () => {
    const sessions: ReadingSession[] = [
      {
        id: "first",
        bookId: "book:1",
        startedAt: new Date(2026, 0, 9, 23, 50).toISOString(),
        endedAt: new Date(2026, 0, 10, 0, 10).toISOString(),
        durationMs: 20 * 60_000,
        wordCount: 80,
        characterCount: 320,
        startLocation: createLocation(1, 100),
        endLocation: createLocation(21, 100),
      },
      {
        id: "second",
        bookId: "book:1",
        startedAt: new Date(2026, 0, 12, 9, 0).toISOString(),
        endedAt: new Date(2026, 0, 12, 9, 10).toISOString(),
        durationMs: 10 * 60_000,
        wordCount: 40,
        characterCount: 200,
        startLocation: createLocation(21, 100),
        endLocation: createLocation(31, 100),
      },
      {
        id: "other-book",
        bookId: "book:2",
        startedAt: new Date(2026, 0, 12, 10, 0).toISOString(),
        endedAt: new Date(2026, 0, 12, 10, 10).toISOString(),
        durationMs: 10 * 60_000,
        wordCount: 400,
        characterCount: 1600,
        startLocation: createLocation(1, 100),
        endLocation: createLocation(11, 100),
      },
    ];

    expect(getBookReadingStats(sessions, "book:1")).toMatchObject({
      totalDurationMs: 30 * 60_000,
      wordCount: 120,
      characterCount: 520,
      sessionCount: 2,
      activeDayCount: 3,
      wordsPerMinute: 4,
      charactersPerMinute: 520 / 30,
    });
  });

  it("builds cumulative book progress from daily reading percentages", () => {
    const sessions: ReadingSession[] = [
      {
        id: "day-one",
        bookId: "book:1",
        startedAt: new Date(2026, 0, 10, 9, 0).toISOString(),
        endedAt: new Date(2026, 0, 10, 9, 10).toISOString(),
        durationMs: 10 * 60_000,
        wordCount: 10,
        characterCount: 40,
        startLocation: createLocation(0, 100),
        endLocation: createLocation(1, 100),
      },
      {
        id: "day-two",
        bookId: "book:1",
        startedAt: new Date(2026, 0, 11, 9, 0).toISOString(),
        endedAt: new Date(2026, 0, 11, 9, 10).toISOString(),
        durationMs: 10 * 60_000,
        wordCount: 10,
        characterCount: 40,
        startLocation: createLocation(1, 100),
        endLocation: createLocation(2, 100),
      },
      {
        id: "other-book",
        bookId: "book:2",
        startedAt: new Date(2026, 0, 11, 10, 0).toISOString(),
        endedAt: new Date(2026, 0, 11, 10, 10).toISOString(),
        durationMs: 10 * 60_000,
        wordCount: 10,
        characterCount: 40,
        startLocation: createLocation(20, 100),
        endLocation: createLocation(30, 100),
      },
    ];

    expect(
      getBookProgressDays(sessions, "book:1", new Date(2026, 0, 12, 12), 3).map((day) => ({
        date: day.date,
        dailyPercent: day.dailyPercent,
        cumulativePercent: day.cumulativePercent,
      })),
    ).toEqual([
      { date: "2026-01-10", dailyPercent: 1, cumulativePercent: 1 },
      { date: "2026-01-11", dailyPercent: 1, cumulativePercent: 2 },
      { date: "2026-01-12", dailyPercent: 0, cumulativePercent: 2 },
    ]);
  });

  it("calculates selected-book reading speed by day", () => {
    const sessions: ReadingSession[] = [
      {
        id: "book-one",
        bookId: "book:1",
        startedAt: new Date(2026, 0, 10, 9, 0).toISOString(),
        endedAt: new Date(2026, 0, 10, 9, 10).toISOString(),
        durationMs: 10 * 60_000,
        wordCount: 30,
        characterCount: 300,
        startLocation: createLocation(0, 100),
        endLocation: createLocation(1, 100),
      },
      {
        id: "book-two",
        bookId: "book:2",
        startedAt: new Date(2026, 0, 10, 9, 0).toISOString(),
        endedAt: new Date(2026, 0, 10, 9, 10).toISOString(),
        durationMs: 10 * 60_000,
        wordCount: 90,
        characterCount: 900,
        startLocation: createLocation(0, 100),
        endLocation: createLocation(1, 100),
      },
    ];

    expect(getBookSpeedDays(sessions, "book:1", new Date(2026, 0, 10, 12), 1))
      .toMatchObject([
        {
          date: "2026-01-10",
          durationMs: 10 * 60_000,
          characterCount: 300,
          charactersPerMinute: 30,
        },
      ]);
  });

  it("aggregates lookup events into local days", () => {
    const events: LookupEvent[] = [
      {
        id: "first",
        bookId: "book:1",
        occurredAt: new Date(2026, 0, 10, 9, 0).toISOString(),
        term: "猫",
        status: "known",
      },
      {
        id: "second",
        bookId: "book:1",
        occurredAt: new Date(2026, 0, 10, 9, 5).toISOString(),
        term: "走る",
        status: "unknown",
      },
      {
        id: "third",
        bookId: "book:1",
        occurredAt: new Date(2026, 0, 11, 9, 0).toISOString(),
        term: "犬",
      },
    ];

    expect(getDailyLookupStats(events, new Date(2026, 0, 11, 12), 3)).toMatchObject([
      { date: "2026-01-09", lookupCount: 0 },
      { date: "2026-01-10", lookupCount: 2 },
      { date: "2026-01-11", lookupCount: 1 },
    ]);
  });

  it("summarizes and charts selected-book lookup events", () => {
    const events: LookupEvent[] = [
      {
        id: "book-one-first",
        bookId: "book:1",
        occurredAt: new Date(2026, 0, 10, 9, 0).toISOString(),
        term: "猫",
      },
      {
        id: "book-one-second",
        bookId: "book:1",
        occurredAt: new Date(2026, 0, 11, 9, 0).toISOString(),
        term: "走る",
      },
      {
        id: "other-book",
        bookId: "book:2",
        occurredAt: new Date(2026, 0, 11, 10, 0).toISOString(),
        term: "犬",
      },
    ];

    expect(getBookLookupStats(events, "book:1")).toMatchObject({
      lookupCount: 2,
      activeDayCount: 2,
      firstLookupAt: new Date(2026, 0, 10, 9, 0).toISOString(),
      lastLookupAt: new Date(2026, 0, 11, 9, 0).toISOString(),
    });
    expect(getBookLookupDays(events, "book:1", new Date(2026, 0, 11, 12), 2)).toMatchObject([
      { date: "2026-01-10", lookupCount: 1 },
      { date: "2026-01-11", lookupCount: 1 },
    ]);
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
