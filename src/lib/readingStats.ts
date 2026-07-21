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

export interface BookReadingStats {
  totalDurationMs: number;
  wordCount: number;
  characterCount: number;
  sessionCount: number;
  activeDayCount: number;
  firstReadAt: string | null;
  lastReadAt: string | null;
  wordsPerMinute: number;
  charactersPerMinute: number;
}

export interface BookProgressDay {
  date: string;
  dailyPercent: number;
  cumulativePercent: number;
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

export function getBookReadingStats(
  sessions: ReadingSession[],
  bookId: string | null | undefined,
): BookReadingStats | null {
  if (!bookId) {
    return null;
  }

  const activeDays = new Set<string>();
  let totalDurationMs = 0;
  let wordCount = 0;
  let characterCount = 0;
  let sessionCount = 0;
  let firstReadMs = Number.POSITIVE_INFINITY;
  let lastReadMs = Number.NEGATIVE_INFINITY;

  for (const session of sessions) {
    if (session.bookId !== bookId) {
      continue;
    }

    sessionCount += 1;
    const durationMs = getNonNegativeNumber(session.durationMs);
    totalDurationMs += durationMs;
    wordCount += getNonNegativeNumber(session.wordCount);
    characterCount += getNonNegativeNumber(session.characterCount);

    const bounds = getSessionBounds(session);
    if (!bounds) {
      continue;
    }

    firstReadMs = Math.min(firstReadMs, bounds.startMs);
    lastReadMs = Math.max(lastReadMs, bounds.endMs);

    if (durationMs > 0) {
      addActiveDayKeys(activeDays, bounds.startMs, bounds.endMs);
    }
  }

  const totalMinutes = totalDurationMs / 60_000;

  return {
    totalDurationMs,
    wordCount: Math.round(wordCount),
    characterCount: Math.round(characterCount),
    sessionCount,
    activeDayCount: activeDays.size,
    firstReadAt: Number.isFinite(firstReadMs) ? new Date(firstReadMs).toISOString() : null,
    lastReadAt: Number.isFinite(lastReadMs) ? new Date(lastReadMs).toISOString() : null,
    wordsPerMinute: totalMinutes > 0 ? wordCount / totalMinutes : 0,
    charactersPerMinute: totalMinutes > 0 ? characterCount / totalMinutes : 0,
  };
}

export function getBookProgressDays(
  sessions: ReadingSession[],
  bookId: string | null | undefined,
  referenceDate = new Date(),
  dayCount = 7,
): BookProgressDay[] {
  if (!bookId) {
    return [];
  }

  const safeDayCount = Math.max(1, Math.round(dayCount));
  const referenceDayStart = startOfLocalDay(referenceDate);
  const firstDayStart = addDays(referenceDayStart, -(safeDayCount - 1));
  const rangeStartMs = firstDayStart.getTime();
  const rangeEndMs = addDays(referenceDayStart, 1).getTime();
  const days: BookProgressDay[] = Array.from({ length: safeDayCount }, (_, index) => ({
    date: getLocalDayKey(addDays(firstDayStart, index)),
    dailyPercent: 0,
    cumulativePercent: 0,
  }));
  const daysByDate = new Map(days.map((day) => [day.date, day]));
  let cumulativeBeforeRange = 0;

  for (const session of sessions) {
    if (session.bookId !== bookId) {
      continue;
    }

    const bounds = getSessionBounds(session);
    const progressPercent = getSessionProgressPercent(session);
    if (!bounds || progressPercent <= 0) {
      continue;
    }

    const elapsedMs = bounds.endMs - bounds.startMs;
    if (elapsedMs <= 0 || bounds.startMs >= rangeEndMs) {
      continue;
    }

    if (bounds.startMs < rangeStartMs) {
      const previousSegmentEndMs = Math.min(bounds.endMs, rangeStartMs);
      if (previousSegmentEndMs > bounds.startMs) {
        cumulativeBeforeRange +=
          progressPercent * ((previousSegmentEndMs - bounds.startMs) / elapsedMs);
      }
    }

    if (bounds.endMs <= rangeStartMs) {
      continue;
    }

    let cursorMs = Math.max(bounds.startMs, rangeStartMs);
    const sessionEndMs = Math.min(bounds.endMs, rangeEndMs);

    while (cursorMs < sessionEndMs) {
      const cursorDate = new Date(cursorMs);
      const nextDayMs = addDays(startOfLocalDay(cursorDate), 1).getTime();
      const segmentEndMs = Math.min(nextDayMs, sessionEndMs);
      const day = daysByDate.get(getLocalDayKey(cursorDate));

      if (day) {
        day.dailyPercent += progressPercent * ((segmentEndMs - cursorMs) / elapsedMs);
      }

      cursorMs = segmentEndMs;
    }
  }

  let cumulativePercent = cumulativeBeforeRange;
  return days.map((day) => {
    cumulativePercent += day.dailyPercent;

    return {
      date: day.date,
      dailyPercent: roundProgressPercent(day.dailyPercent),
      cumulativePercent: roundProgressPercent(cumulativePercent),
    };
  });
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

function getSessionBounds(session: ReadingSession) {
  const startMs = Date.parse(session.startedAt);
  if (!Number.isFinite(startMs)) {
    return null;
  }

  const parsedEndMs = Date.parse(session.endedAt);
  const fallbackEndMs = startMs + getNonNegativeNumber(session.durationMs);
  const endMs =
    Number.isFinite(parsedEndMs) && parsedEndMs > startMs ? parsedEndMs : fallbackEndMs;

  return {
    startMs,
    endMs: Math.max(startMs, endMs),
  };
}

function addActiveDayKeys(activeDays: Set<string>, startMs: number, endMs: number) {
  const lastActiveMs = Math.max(startMs, endMs - 1);
  let cursor = startOfLocalDay(new Date(startMs));
  const lastDayMs = startOfLocalDay(new Date(lastActiveMs)).getTime();

  while (cursor.getTime() <= lastDayMs) {
    activeDays.add(getLocalDayKey(cursor));
    cursor = addDays(cursor, 1);
  }
}

function getNonNegativeNumber(value: number) {
  return Number.isFinite(value) ? Math.max(0, value) : 0;
}

function getSessionProgressPercent(session: ReadingSession) {
  const start = session.startLocation;
  const end = session.endLocation;
  if (!start || !end) {
    return 0;
  }

  const startPercent = getLocationProgressPercent(start.progressCurrent, start.progressTotal);
  const endPercent = getLocationProgressPercent(end.progressCurrent, end.progressTotal);
  if (startPercent === null || endPercent === null || endPercent <= startPercent) {
    return 0;
  }

  return Math.min(100, endPercent - startPercent);
}

function getLocationProgressPercent(current: number, total: number) {
  if (!Number.isFinite(current) || !Number.isFinite(total) || total <= 0) {
    return null;
  }

  return (Math.min(Math.max(0, current), total) / total) * 100;
}

function roundProgressPercent(percent: number) {
  return Math.max(0, Math.min(100, Math.round(percent * 10) / 10));
}
