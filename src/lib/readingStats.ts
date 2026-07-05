import type { DisplayStep } from "./rsvp";
import type { ReadingSession, Sentence } from "../types";

export interface ReadingStepStats {
  wordCount: number;
  characterCount: number;
}

export interface ReadingStatsDay {
  date: string;
  label: string;
  durationMs: number;
  wordCount: number;
  characterCount: number;
}

export interface ReadingTimeEstimate {
  durationMs: number;
  remainingUnits: number;
  unitsPerMinute: number;
  sessionCount: number;
}

interface MutableReadingStatsDay extends ReadingStatsDay {
  wordCount: number;
  characterCount: number;
}

export function getReadingStepStats(
  sentence: Sentence,
  display: Pick<DisplayStep, "startOffset" | "endOffset" | "tokenIndexes" | "text">,
): ReadingStepStats {
  const displayedTokenIndexes = new Set(display.tokenIndexes);
  const wordCount = sentence.tokens.filter(
    (token) => token.isWordLike && displayedTokenIndexes.has(token.index),
  ).length;

  return {
    wordCount,
    characterCount: Array.from(display.text).filter((character) => character.trim()).length,
  };
}

export function getDailyReadingStats(
  sessions: ReadingSession[],
  referenceDate = new Date(),
  dayCount = 7,
): ReadingStatsDay[] {
  const safeDayCount = Math.max(1, Math.round(dayCount));
  const referenceDayStart = startOfLocalDay(referenceDate);
  const firstDayStart = addDays(referenceDayStart, -(safeDayCount - 1));
  const rangeStartMs = firstDayStart.getTime();
  const rangeEndMs = addDays(referenceDayStart, 1).getTime();

  const days: MutableReadingStatsDay[] = Array.from({ length: safeDayCount }, (_, index) => {
    const date = addDays(firstDayStart, index);
    return {
      date: getLocalDayKey(date),
      label: new Intl.DateTimeFormat(undefined, { weekday: "short" }).format(date),
      durationMs: 0,
      wordCount: 0,
      characterCount: 0,
    };
  });
  const daysByDate = new Map(days.map((day) => [day.date, day]));

  for (const session of sessions) {
    const startedAtMs = Date.parse(session.startedAt);
    const parsedEndedAtMs = Date.parse(session.endedAt);
    if (!Number.isFinite(startedAtMs)) {
      continue;
    }

    const endedAtMs =
      Number.isFinite(parsedEndedAtMs) && parsedEndedAtMs > startedAtMs
        ? parsedEndedAtMs
        : startedAtMs + Math.max(0, session.durationMs);
    const elapsedMs = endedAtMs - startedAtMs;
    const durationMs = Math.max(0, session.durationMs || elapsedMs);

    if (elapsedMs <= 0 || durationMs <= 0 || endedAtMs <= rangeStartMs || startedAtMs >= rangeEndMs) {
      continue;
    }

    let cursorMs = Math.max(startedAtMs, rangeStartMs);
    const sessionEndMs = Math.min(endedAtMs, rangeEndMs);

    while (cursorMs < sessionEndMs) {
      const cursorDate = new Date(cursorMs);
      const nextDayMs = addDays(startOfLocalDay(cursorDate), 1).getTime();
      const segmentEndMs = Math.min(nextDayMs, sessionEndMs);
      const segmentMs = segmentEndMs - cursorMs;
      const ratio = segmentMs / elapsedMs;
      const day = daysByDate.get(getLocalDayKey(cursorDate));

      if (day) {
        day.durationMs += durationMs * ratio;
        day.wordCount += session.wordCount * ratio;
        day.characterCount += session.characterCount * ratio;
      }

      cursorMs = segmentEndMs;
    }
  }

  return days.map((day) => ({
    ...day,
    durationMs: Math.round(day.durationMs),
    wordCount: Math.round(day.wordCount),
    characterCount: Math.round(day.characterCount),
  }));
}

export function estimateRemainingReadingTime(
  sessions: ReadingSession[],
  bookId: string,
  progress: { current: number; total: number },
): ReadingTimeEstimate | null {
  const remainingUnits = Math.max(0, progress.total - progress.current);
  if (progress.total <= 0 || remainingUnits === 0) {
    return {
      durationMs: 0,
      remainingUnits,
      unitsPerMinute: 0,
      sessionCount: 0,
    };
  }

  const comparableSessions = sessions
    .filter((session) => {
      const start = session.startLocation;
      const end = session.endLocation;
      return (
        session.bookId === bookId &&
        start !== undefined &&
        end !== undefined &&
        start.progressTotal === progress.total &&
        end.progressTotal === progress.total &&
        end.progressCurrent > start.progressCurrent &&
        session.durationMs > 0
      );
    })
    .slice(-20);

  const progressUnitsRead = comparableSessions.reduce(
    (sum, session) => {
      const start = session.startLocation;
      const end = session.endLocation;
      if (!start || !end) {
        return sum;
      }

      return sum + Math.max(0, end.progressCurrent - start.progressCurrent);
    },
    0,
  );
  const durationMs = comparableSessions.reduce(
    (sum, session) => sum + Math.max(0, session.durationMs),
    0,
  );

  if (progressUnitsRead <= 0 || durationMs <= 0) {
    return null;
  }

  const unitsPerMs = progressUnitsRead / durationMs;

  return {
    durationMs: Math.round(remainingUnits / unitsPerMs),
    remainingUnits,
    unitsPerMinute: unitsPerMs * 60_000,
    sessionCount: comparableSessions.length,
  };
}

export function formatReadingDuration(durationMs: number) {
  if (!Number.isFinite(durationMs) || durationMs <= 0) {
    return "0m";
  }

  if (durationMs < 60_000) {
    return "<1m";
  }

  const totalMinutes = Math.max(1, Math.round(durationMs / 60_000));
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;

  if (hours === 0) {
    return `${minutes}m`;
  }

  return minutes === 0 ? `${hours}h` : `${hours}h ${minutes}m`;
}

function startOfLocalDay(date: Date) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

function addDays(date: Date, days: number) {
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  return next;
}

function getLocalDayKey(date: Date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}
