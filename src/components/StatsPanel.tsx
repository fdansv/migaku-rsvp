import { BarChart3, BookOpen } from "lucide-react";
import { memo, useMemo, useState, type CSSProperties } from "react";
import {
  formatReadingDuration,
  getRecentBookReadingRate,
  type BookLookupStats,
  type BookLookupRateDay,
  type BookProgressDay,
  type BookReadingStats,
  type BookSpeedDay,
  type ReadingStatsDay,
} from "../lib/readingStats";

const lastReadDateFormatter = new Intl.DateTimeFormat(undefined, {
  month: "short",
  day: "numeric",
});
const chartDateFormatter = new Intl.DateTimeFormat(undefined, {
  weekday: "short",
  month: "short",
  day: "numeric",
});

interface StatsPanelProps {
  days: ReadingStatsDay[];
  bookStats: BookReadingStats | null;
  bookLookupStats: BookLookupStats | null;
  bookProgressDays: BookProgressDay[];
  bookSpeedDays: BookSpeedDay[];
  bookLookupDays: BookLookupRateDay[];
  progressPercent: number | null;
}

export function StatsPanel({
  days,
  bookStats,
  bookLookupStats,
  bookProgressDays,
  bookSpeedDays,
  bookLookupDays,
  progressPercent,
}: StatsPanelProps) {
  const today = days.at(-1);
  const hasBookStats = Boolean(bookStats || bookLookupStats);
  const recentBookPace = useMemo(
    () => getRecentBookReadingRate(bookSpeedDays, 3),
    [bookSpeedDays],
  );

  return (
    <section className="stats-section" aria-labelledby="reading-stats-title">
      <div className="section-title" id="reading-stats-title">
        <BarChart3 size={17} aria-hidden="true" />
        <span>Stats</span>
      </div>
      <div className="stats-summary">
        <span>
          <strong>{formatReadingDuration(today?.durationMs ?? 0)}</strong>
          <small>Today</small>
        </span>
        <span>
          <strong>{(today?.characterCount ?? 0).toLocaleString()}</strong>
          <small>Chars</small>
        </span>
      </div>
      {hasBookStats ? (
        <div className="book-stats" aria-labelledby="book-stats-title">
          <div className="stats-subtitle" id="book-stats-title">
            <BookOpen size={15} aria-hidden="true" />
            <span>This book</span>
          </div>
          <div className="book-stats-grid">
            <StatTile
              value={formatReadingDuration(bookStats?.totalDurationMs ?? 0)}
              label="Time read"
            />
            <StatTile value={formatProgressPercent(progressPercent)} label="Progress" />
            <StatTile value={formatReadingRate(recentBookPace)} label="3d pace" />
            <StatTile value={(bookStats?.activeDayCount ?? 0).toLocaleString()} label="Days" />
            <StatTile value={(bookLookupStats?.lookupCount ?? 0).toLocaleString()} label="Lookups" />
          </div>
          {bookStats ? (
            <p className="book-stats-meta">
              <span>{bookStats.characterCount.toLocaleString()} characters</span>
              <span>{formatSessionCount(bookStats.sessionCount)}</span>
              <span>{formatLastRead(bookStats.lastReadAt)}</span>
            </p>
          ) : null}
          <BookProgressChart days={bookProgressDays} />
          <BookSpeedChart days={bookSpeedDays} />
          <BookLookupChart days={bookLookupDays} />
        </div>
      ) : null}
      <ReadingTimeChart days={days} />
    </section>
  );
}

const BookProgressChart = memo(function BookProgressChart({
  days,
}: {
  days: BookProgressDay[];
}) {
  const [activeDate, setActiveDate] = useState<string | null>(null);
  const visibleDays = useMemo(() => getVisibleBookProgressDays(days), [days]);

  return (
    <>
      <div className="book-chart-caption">Progress by day</div>
      <div
        className="reading-chart book-progress-chart"
        role="group"
        aria-label="Cumulative book progress by day"
      >
        <div className="reading-chart-axis" aria-hidden="true">
          <span>100%</span>
          <span>50%</span>
          <span>0%</span>
        </div>
        <div
          className="reading-chart-bars"
          style={{ "--reading-chart-days": visibleDays.length } as CSSProperties}
        >
          {visibleDays.map((day, index) => {
            const height = day.cumulativePercent > 0 ? Math.max(day.cumulativePercent, 3) : 0;
            const tooltipLabel = formatBookProgressTooltip(day);
            const shouldShowLabel = shouldShowBookProgressDayLabel(
              day,
              index,
              visibleDays.length,
            );

            return (
              <div
                className={`reading-chart-day${shouldShowLabel ? " has-visible-label" : ""}`}
                key={day.date}
              >
                <button
                  className={`reading-chart-bar-track${
                    activeDate === day.date ? " is-active" : ""
                  }`}
                  type="button"
                  aria-label={`${formatChartDateLabel(day.date)}: ${tooltipLabel}`}
                  onClick={() =>
                    setActiveDate((currentDate) =>
                      currentDate === day.date ? null : day.date,
                    )
                  }
                  onBlur={() => setActiveDate(null)}
                >
                  <div
                    className="reading-chart-bar"
                    style={{ height: `${height}%` }}
                    aria-hidden="true"
                  />
                  <span className="reading-chart-tooltip" role="tooltip">
                    {tooltipLabel}
                  </span>
                </button>
                <span aria-hidden={!shouldShowLabel}>{formatChartTickLabel(day.date)}</span>
              </div>
            );
          })}
        </div>
      </div>
    </>
  );
});

const BookSpeedChart = memo(function BookSpeedChart({ days }: { days: BookSpeedDay[] }) {
  const [activeDate, setActiveDate] = useState<string | null>(null);
  const visibleDays = useMemo(() => getVisibleBookSpeedDays(days), [days]);
  const maxSpeed = useMemo(
    () => Math.max(...visibleDays.map((day) => day.charactersPerMinute), 0),
    [visibleDays],
  );

  return (
    <>
      <div className="book-chart-caption">Speed by day</div>
      <div
        className="reading-chart book-speed-chart"
        role="group"
        aria-label="Book reading speed by day"
      >
        <div className="reading-chart-axis" aria-hidden="true">
          <span>{formatReadingRate(maxSpeed)}</span>
          <span>{formatReadingRate(maxSpeed / 2)}</span>
          <span>0/min</span>
        </div>
        <div
          className="reading-chart-bars"
          style={{ "--reading-chart-days": visibleDays.length } as CSSProperties}
        >
          {visibleDays.map((day, index) => {
            const height =
              maxSpeed > 0 ? Math.max((day.charactersPerMinute / maxSpeed) * 100, 3) : 0;
            const tooltipLabel = formatBookSpeedTooltip(day);
            const shouldShowLabel = shouldShowBookSpeedDayLabel(
              day,
              index,
              visibleDays.length,
            );

            return (
              <div
                className={`reading-chart-day${shouldShowLabel ? " has-visible-label" : ""}`}
                key={day.date}
              >
                <button
                  className={`reading-chart-bar-track${
                    activeDate === day.date ? " is-active" : ""
                  }`}
                  type="button"
                  aria-label={`${formatChartDateLabel(day.date)}: ${tooltipLabel}`}
                  onClick={() =>
                    setActiveDate((currentDate) =>
                      currentDate === day.date ? null : day.date,
                    )
                  }
                  onBlur={() => setActiveDate(null)}
                >
                  <div
                    className="reading-chart-bar"
                    style={{ height: `${height}%` }}
                    aria-hidden="true"
                  />
                  <span className="reading-chart-tooltip" role="tooltip">
                    {tooltipLabel}
                  </span>
                </button>
                <span aria-hidden={!shouldShowLabel}>{formatChartTickLabel(day.date)}</span>
              </div>
            );
          })}
        </div>
      </div>
    </>
  );
});

const BookLookupChart = memo(function BookLookupChart({ days }: { days: BookLookupRateDay[] }) {
  const [activeDate, setActiveDate] = useState<string | null>(null);
  const visibleDays = useMemo(() => getVisibleBookLookupDays(days), [days]);
  const maxLookupRate = useMemo(
    () => Math.max(...visibleDays.map((day) => day.lookupsPerThousandCharacters), 0),
    [visibleDays],
  );

  return (
    <>
      <div className="book-chart-caption">Lookup rate by day</div>
      <div
        className="reading-chart book-lookups-chart"
        role="group"
        aria-label="Book lookup rate by day"
      >
        <div className="reading-chart-axis" aria-hidden="true">
          <span>{formatLookupRateAxis(maxLookupRate)}</span>
          <span>{formatLookupRateAxis(maxLookupRate / 2)}</span>
          <span>0/1k</span>
        </div>
        <div
          className="reading-chart-bars"
          style={{ "--reading-chart-days": visibleDays.length } as CSSProperties}
        >
          {visibleDays.map((day, index) => {
            const height =
              maxLookupRate > 0
                ? Math.max((day.lookupsPerThousandCharacters / maxLookupRate) * 100, 3)
                : 0;
            const tooltipLabel = formatLookupRateTooltip(day);
            const shouldShowLabel = shouldShowBookLookupDayLabel(
              day,
              index,
              visibleDays.length,
            );

            return (
              <div
                className={`reading-chart-day${shouldShowLabel ? " has-visible-label" : ""}`}
                key={day.date}
              >
                <button
                  className={`reading-chart-bar-track${
                    activeDate === day.date ? " is-active" : ""
                  }`}
                  type="button"
                  aria-label={`${formatChartDateLabel(day.date)}: ${tooltipLabel}`}
                  onClick={() =>
                    setActiveDate((currentDate) =>
                      currentDate === day.date ? null : day.date,
                    )
                  }
                  onBlur={() => setActiveDate(null)}
                >
                  <div
                    className="reading-chart-bar"
                    style={{ height: `${height}%` }}
                    aria-hidden="true"
                  />
                  <span className="reading-chart-tooltip" role="tooltip">
                    {tooltipLabel}
                  </span>
                </button>
                <span aria-hidden={!shouldShowLabel}>{formatChartTickLabel(day.date)}</span>
              </div>
            );
          })}
        </div>
      </div>
    </>
  );
});

const ReadingTimeChart = memo(function ReadingTimeChart({ days }: { days: ReadingStatsDay[] }) {
  const [activeDate, setActiveDate] = useState<string | null>(null);
  const visibleDays = useMemo(() => getVisibleChartDays(days), [days]);
  const maxDurationMs = useMemo(
    () => Math.max(...visibleDays.map((day) => day.durationMs), 0),
    [visibleDays],
  );

  return (
    <div
      className="reading-chart"
      role="group"
      aria-label="Daily reading time for the last month"
    >
      <div className="reading-chart-axis" aria-hidden="true">
        <span>{formatReadingDuration(maxDurationMs)}</span>
        <span>{formatReadingDuration(maxDurationMs / 2)}</span>
        <span>0m</span>
      </div>
      <div
        className="reading-chart-bars"
        style={{ "--reading-chart-days": visibleDays.length } as CSSProperties}
      >
        {visibleDays.map((day, index) => {
          const height =
            maxDurationMs > 0 ? Math.max((day.durationMs / maxDurationMs) * 100, 3) : 0;
          const tooltipLabel = formatReadingMinutes(day.durationMs);
          const shouldShowLabel = shouldShowChartDayLabel(day, index, visibleDays.length);

          return (
            <div
              className={`reading-chart-day${shouldShowLabel ? " has-visible-label" : ""}`}
              key={day.date}
            >
              <button
                className={`reading-chart-bar-track${
                  activeDate === day.date ? " is-active" : ""
                }`}
                type="button"
                aria-label={`${formatChartDateLabel(day.date)}: ${tooltipLabel}`}
                onClick={() =>
                  setActiveDate((currentDate) =>
                    currentDate === day.date ? null : day.date,
                  )
                }
                onBlur={() => setActiveDate(null)}
              >
                <div
                  className="reading-chart-bar"
                  style={{ height: `${height}%` }}
                  aria-hidden="true"
                />
                <span className="reading-chart-tooltip" role="tooltip">
                  {tooltipLabel}
                </span>
              </button>
              <span aria-hidden={!shouldShowLabel}>{formatChartTickLabel(day.date)}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
});

function StatTile({ value, label }: { value: string; label: string }) {
  return (
    <span>
      <strong>{value}</strong>
      <small>{label}</small>
    </span>
  );
}

export function getVisibleChartDays(days: ReadingStatsDay[]) {
  const firstDayWithDataIndex = days.findIndex((day) => day.durationMs > 0);
  if (firstDayWithDataIndex >= 0) {
    return days.slice(firstDayWithDataIndex);
  }

  return days.slice(-1);
}

function getVisibleBookProgressDays(days: BookProgressDay[]) {
  const firstDayWithProgressIndex = days.findIndex(
    (day) => day.dailyPercent > 0 || day.cumulativePercent > 0,
  );
  if (firstDayWithProgressIndex >= 0) {
    return days.slice(firstDayWithProgressIndex);
  }

  return days.slice(-1);
}

function getVisibleBookSpeedDays(days: BookSpeedDay[]) {
  const firstDayWithSpeedIndex = days.findIndex(
    (day) => day.durationMs > 0 || day.charactersPerMinute > 0,
  );
  if (firstDayWithSpeedIndex >= 0) {
    return days.slice(firstDayWithSpeedIndex);
  }

  return days.slice(-1);
}

function getVisibleBookLookupDays(days: BookLookupRateDay[]) {
  const firstDayWithLookupDataIndex = days.findIndex(
    (day) => day.lookupCount > 0 || day.characterCount > 0,
  );
  if (firstDayWithLookupDataIndex >= 0) {
    return days.slice(firstDayWithLookupDataIndex);
  }

  return days.slice(-1);
}

function shouldShowChartDayLabel(day: ReadingStatsDay, index: number, dayCount: number) {
  if (dayCount <= 14) {
    return true;
  }

  return index === 0 || index === dayCount - 1 || day.durationMs > 0 || index % 7 === 0;
}

function shouldShowBookProgressDayLabel(day: BookProgressDay, index: number, dayCount: number) {
  if (dayCount <= 14) {
    return true;
  }

  return index === 0 || index === dayCount - 1 || day.dailyPercent > 0 || index % 7 === 0;
}

function shouldShowBookSpeedDayLabel(day: BookSpeedDay, index: number, dayCount: number) {
  if (dayCount <= 14) {
    return true;
  }

  return index === 0 || index === dayCount - 1 || day.durationMs > 0 || index % 7 === 0;
}

function shouldShowBookLookupDayLabel(day: BookLookupRateDay, index: number, dayCount: number) {
  if (dayCount <= 14) {
    return true;
  }

  return (
    index === 0 ||
    index === dayCount - 1 ||
    day.lookupCount > 0 ||
    day.characterCount > 0 ||
    index % 7 === 0
  );
}

function formatReadingMinutes(durationMs: number) {
  if (!Number.isFinite(durationMs) || durationMs <= 0) {
    return "0 min";
  }

  if (durationMs < 60_000) {
    return "<1 min";
  }

  const minutes = Math.max(1, Math.round(durationMs / 60_000));
  return `${minutes} min`;
}

function formatProgressPercent(progressPercent: number | null) {
  if (!Number.isFinite(progressPercent)) {
    return "0%";
  }

  return `${Math.max(0, Math.min(100, Math.round(progressPercent ?? 0)))}%`;
}

function formatReadingRate(charactersPerMinute: number) {
  if (!Number.isFinite(charactersPerMinute) || charactersPerMinute <= 0) {
    return "0/min";
  }

  return `${Math.max(1, Math.round(charactersPerMinute)).toLocaleString()}/min`;
}

function formatCompactNumber(value: number) {
  if (!Number.isFinite(value) || value <= 0) {
    return "0";
  }

  if (value < 10) {
    const rounded = Math.round(value * 10) / 10;
    return Number.isInteger(rounded) ? rounded.toFixed(0) : rounded.toFixed(1);
  }

  return Math.round(value).toLocaleString();
}

function formatLookupRateAxis(lookupsPerThousandCharacters: number) {
  const value = formatCompactNumber(lookupsPerThousandCharacters);
  return `${value}/1k`;
}

function formatLookupRateTooltip(day: BookLookupRateDay) {
  const rate = formatCompactNumber(day.lookupsPerThousandCharacters);
  const lookupLabel = `${day.lookupCount.toLocaleString()} ${
    day.lookupCount === 1 ? "lookup" : "lookups"
  }`;
  const characterLabel = `${day.characterCount.toLocaleString()} chars`;
  const inverseLabel =
    day.charactersPerLookup === null
      ? "no chars/lookup"
      : `${formatCompactNumber(day.charactersPerLookup)} chars/lookup`;

  return `${rate}/1k chars, ${inverseLabel}, ${lookupLabel}, ${characterLabel}`;
}

function formatBookProgressTooltip(day: BookProgressDay) {
  return `${formatBookProgressPercent(day.cumulativePercent)} total, +${formatBookProgressPercent(
    day.dailyPercent,
  )}`;
}

function formatBookSpeedTooltip(day: BookSpeedDay) {
  return `${formatReadingRate(day.charactersPerMinute)}, ${formatReadingDuration(day.durationMs)}`;
}

function formatBookProgressPercent(percent: number) {
  if (!Number.isFinite(percent) || percent <= 0) {
    return "0%";
  }

  if (percent < 0.1) {
    return "<0.1%";
  }

  const rounded = Math.round(percent * 10) / 10;
  return `${Number.isInteger(rounded) ? rounded.toFixed(0) : rounded.toFixed(1)}%`;
}

function formatSessionCount(sessionCount: number) {
  return `${sessionCount.toLocaleString()} ${sessionCount === 1 ? "session" : "sessions"}`;
}

function formatLastRead(lastReadAt: string | null) {
  if (!lastReadAt) {
    return "Not read yet";
  }

  const lastReadDate = getLocalDate(lastReadAt);
  if (!lastReadDate) {
    return "Last read";
  }

  const today = startOfLocalDay(new Date());
  const yesterday = new Date(today);
  yesterday.setDate(yesterday.getDate() - 1);
  const lastReadDay = startOfLocalDay(lastReadDate);

  if (lastReadDay.getTime() === today.getTime()) {
    return "Last read today";
  }

  if (lastReadDay.getTime() === yesterday.getTime()) {
    return "Last read yesterday";
  }

  return `Last read ${lastReadDateFormatter.format(lastReadDate)}`;
}

function getLocalDate(dateValue: string) {
  const date = new Date(dateValue);
  return Number.isNaN(date.getTime()) ? null : date;
}

function startOfLocalDay(date: Date) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

function formatChartDateLabel(dateKey: string) {
  return chartDateFormatter.format(getLocalDateFromKey(dateKey));
}

function formatChartTickLabel(dateKey: string) {
  return String(getLocalDateFromKey(dateKey).getDate());
}

function getLocalDateFromKey(dateKey: string) {
  const [year, month, day] = dateKey.split("-").map(Number);
  return new Date(year, month - 1, day);
}
