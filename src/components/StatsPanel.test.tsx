import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type { BookProgressDay } from "../lib/readingStats";
import { StatsPanel } from "./StatsPanel";

describe("StatsPanel", () => {
  it("keeps unchanged charts memoized while playback progress updates", () => {
    let progressValueReads = 0;
    const bookProgressDay: BookProgressDay = {
      date: "2026-07-24",
      dailyPercent: 2,
      get cumulativePercent() {
        progressValueReads += 1;
        return 42;
      },
    };
    const props = {
      days: [
        {
          date: "2026-07-24",
          label: "Fri",
          durationMs: 60_000,
          wordCount: 100,
          characterCount: 500,
        },
      ],
      bookStats: {
        totalDurationMs: 60_000,
        wordCount: 100,
        characterCount: 500,
        sessionCount: 1,
        activeDayCount: 1,
        firstReadAt: "2026-07-24T12:00:00.000Z",
        lastReadAt: "2026-07-24T12:01:00.000Z",
        wordsPerMinute: 100,
        charactersPerMinute: 500,
      },
      bookLookupStats: null,
      bookProgressDays: [bookProgressDay],
      bookSpeedDays: [
        {
          date: "2026-07-24",
          durationMs: 60_000,
          characterCount: 500,
          charactersPerMinute: 500,
        },
      ],
      bookLookupDays: [
        {
          date: "2026-07-24",
          label: "Fri",
          lookupCount: 0,
          characterCount: 500,
          lookupsPerThousandCharacters: 0,
          charactersPerLookup: null,
        },
      ],
      progressPercent: 42,
    };
    const { rerender } = render(<StatsPanel {...props} />);
    const progressChart = screen.getByRole("group", {
      name: "Cumulative book progress by day",
    });
    const progressBar = within(progressChart).getByRole("button");

    fireEvent.click(progressBar);
    expect(progressBar).toHaveClass("is-active");

    const readsAfterInitialRender = progressValueReads;
    rerender(<StatsPanel {...props} progressPercent={43} />);

    expect(progressValueReads).toBe(readsAfterInitialRender);
    expect(progressBar).toHaveClass("is-active");
    expect(screen.getByText("43%")).toBeInTheDocument();
  });
});
