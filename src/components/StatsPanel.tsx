import { BarChart3, BookOpen } from "lucide-react";
import { useMemo, useState, type CSSProperties } from "react";
import {
  formatReadingDuration,
  type BookLookupStats,
  type BookProgressDay,
  type BookReadingStats,
  type BookSpeedDay,
  type LookupStatsDay,
  type ReadingStatsDay,
} from "../lib/readingStats";

interface StatsPanelProps {
  days: ReadingStatsDay[];
  bookStats: BookReadingStats | null;
  bookLookupStats: BookLookupStats | null;
  bookProgressDays: BookProgressDay[];
  bookSpeedDays: BookSpeedDay[];
  bookLookupDays: LookupStatsDay[];
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
  const [activeTooltipDate, setActiveTooltipDate] = useState<string | null>(null);
  const [activeBookProgressDate, setActiveBookProgressDate] = useState<string | null>(null);
  const [activeBookSpeedDate, setActiveBookSpeedDate] = useState<string | null>(null);
  const [activeBookLookupDate, setActiveBookLookupDate] = useState<string | null>(null);
  const chartDays = useMemo(() => getVisibleChartDays(days), [days]);
  const visibleBookProgressDays = useMemo(
    () => getVisibleBookProgressDays(bookProgressDays),
    [bookProgressDays],
  );
  const visibleBookSpeedDays = useMemo(
    () => getVisibleBookSpeedDays(bookSpeedDays),
    [bookSpeedDays],
  );
  const visibleBookLookupDays = useMemo(
    () => getVisibleBookLookupDays(bookLookupDays),
    [bookLookupDays],
  );
  const maxDurationMs = Math.max(...chartDays.map((day) => day.durationMs), 0);
  const maxBookSpeed = Math.max(
    ...visibleBookSpeedDays.map((day) => day.charactersPerMinute),
    0,
  );
  const maxBookLookups = Math.max(...visibleBookLookupDays.map((day) => day.lookupCount), 0);
  const today = days.at(-1);
  const hasBookStats = Boolean(bookStats || bookLookupStats);

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
            <StatTile value={formatReadingRate(bookStats?.charactersPerMinute ?? 0)} label="Pace" />
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
              style={
                { "--reading-chart-days": visibleBookProgressDays.length } as CSSProperties
              }
            >
              {visibleBookProgressDays.map((day, index) => {
                const height =
                  day.cumulativePercent > 0 ? Math.max(day.cumulativePercent, 3) : 0;
                const tooltipLabel = formatBookProgressTooltip(day);
                const shouldShowLabel = shouldShowBookProgressDayLabel(
                  day,
                  index,
                  visibleBookProgressDays.length,
                );

                return (
                  <div
                    className={`reading-chart-day${
                      shouldShowLabel ? " has-visible-label" : ""
                    }`}
                    key={day.date}
                  >
                    <button
                      className={`reading-chart-bar-track${
                        activeBookProgressDate === day.date ? " is-active" : ""
                      }`}
                      type="button"
                      aria-label={`${formatChartDateLabel(day.date)}: ${tooltipLabel}`}
                      onClick={() =>
                        setActiveBookProgressDate((currentDate) =>
                          currentDate === day.date ? null : day.date,
                        )
                      }
                      onBlur={() => setActiveBookProgressDate(null)}
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
          <div className="book-chart-caption">Speed by day</div>
          <div
            className="reading-chart book-speed-chart"
            role="group"
            aria-label="Book reading speed by day"
          >
            <div className="reading-chart-axis" aria-hidden="true">
              <span>{formatReadingRate(maxBookSpeed)}</span>
              <span>{formatReadingRate(maxBookSpeed / 2)}</span>
              <span>0/min</span>
            </div>
            <div
              className="reading-chart-bars"
              style={{ "--reading-chart-days": visibleBookSpeedDays.length } as CSSProperties}
            >
              {visibleBookSpeedDays.map((day, index) => {
                const height =
                  maxBookSpeed > 0
                    ? Math.max((day.charactersPerMinute / maxBookSpeed) * 100, 3)
                    : 0;
                const tooltipLabel = formatBookSpeedTooltip(day);
                const shouldShowLabel = shouldShowBookSpeedDayLabel(
                  day,
                  index,
                  visibleBookSpeedDays.length,
                );

                return (
                  <div
                    className={`reading-chart-day${
                      shouldShowLabel ? " has-visible-label" : ""
                    }`}
                    key={day.date}
                  >
                    <button
                      className={`reading-chart-bar-track${
                        activeBookSpeedDate === day.date ? " is-active" : ""
                      }`}
                      type="button"
                      aria-label={`${formatChartDateLabel(day.date)}: ${tooltipLabel}`}
                      onClick={() =>
                        setActiveBookSpeedDate((currentDate) =>
                          currentDate === day.date ? null : day.date,
                        )
                      }
                      onBlur={() => setActiveBookSpeedDate(null)}
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
          <div className="book-chart-caption">Lookups by day</div>
          <div
            className="reading-chart book-lookups-chart"
            role="group"
            aria-label="Book lookups by day"
          >
            <div className="reading-chart-axis" aria-hidden="true">
              <span>{formatLookupAxisCount(maxBookLookups)}</span>
              <span>{formatLookupAxisCount(Math.ceil(maxBookLookups / 2))}</span>
              <span>0</span>
            </div>
            <div
              className="reading-chart-bars"
              style={{ "--reading-chart-days": visibleBookLookupDays.length } as CSSProperties}
            >
              {visibleBookLookupDays.map((day, index) => {
                const height =
                  maxBookLookups > 0
                    ? Math.max((day.lookupCount / maxBookLookups) * 100, 3)
                    : 0;
                const tooltipLabel = formatLookupCount(day.lookupCount);
                const shouldShowLabel = shouldShowBookLookupDayLabel(
                  day,
                  index,
                  visibleBookLookupDays.length,
                );

                return (
                  <div
                    className={`reading-chart-day${
                      shouldShowLabel ? " has-visible-label" : ""
                    }`}
                    key={day.date}
                  >
                    <button
                      className={`reading-chart-bar-track${
                        activeBookLookupDate === day.date ? " is-active" : ""
                      }`}
                      type="button"
                      aria-label={`${formatChartDateLabel(day.date)}: ${tooltipLabel}`}
                      onClick={() =>
                        setActiveBookLookupDate((currentDate) =>
                          currentDate === day.date ? null : day.date,
                        )
                      }
                      onBlur={() => setActiveBookLookupDate(null)}
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
        </div>
      ) : null}
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
          style={{ "--reading-chart-days": chartDays.length } as CSSProperties}
        >
          {chartDays.map((day, index) => {
            const height =
              maxDurationMs > 0 ? Math.max((day.durationMs / maxDurationMs) * 100, 3) : 0;
            const tooltipLabel = formatReadingMinutes(day.durationMs);
            const shouldShowLabel = shouldShowChartDayLabel(day, index, chartDays.length);

            return (
              <div
                className={`reading-chart-day${shouldShowLabel ? " has-visible-label" : ""}`}
                key={day.date}
              >
                <button
                  className={`reading-chart-bar-track${
                    activeTooltipDate === day.date ? " is-active" : ""
                  }`}
                  type="button"
                  aria-label={`${formatChartDateLabel(day.date)}: ${tooltipLabel}`}
                  onClick={() =>
                    setActiveTooltipDate((currentDate) =>
                      currentDate === day.date ? null : day.date,
                    )
                  }
                  onBlur={() => setActiveTooltipDate(null)}
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
    </section>
  );
}

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

function getVisibleBookLookupDays(days: LookupStatsDay[]) {
  const firstDayWithLookupsIndex = days.findIndex((day) => day.lookupCount > 0);
  if (firstDayWithLookupsIndex >= 0) {
    return days.slice(firstDayWithLookupsIndex);
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

function shouldShowBookLookupDayLabel(day: LookupStatsDay, index: number, dayCount: number) {
  if (dayCount <= 14) {
    return true;
  }

  return index === 0 || index === dayCount - 1 || day.lookupCount > 0 || index % 7 === 0;
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

function formatLookupCount(lookupCount: number) {
  return `${lookupCount.toLocaleString()} ${lookupCount === 1 ? "lookup" : "lookups"}`;
}

function formatLookupAxisCount(lookupCount: number) {
  return Math.max(0, lookupCount).toLocaleString();
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

  return `Last read ${new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
  }).format(lastReadDate)}`;
}

function getLocalDate(dateValue: string) {
  const date = new Date(dateValue);
  return Number.isNaN(date.getTime()) ? null : date;
}

function startOfLocalDay(date: Date) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

function formatChartDateLabel(dateKey: string) {
  return new Intl.DateTimeFormat(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
  }).format(getLocalDateFromKey(dateKey));
}

function formatChartTickLabel(dateKey: string) {
  return String(getLocalDateFromKey(dateKey).getDate());
}

function getLocalDateFromKey(dateKey: string) {
  const [year, month, day] = dateKey.split("-").map(Number);
  return new Date(year, month - 1, day);
}
