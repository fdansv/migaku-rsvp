import { BarChart3 } from "lucide-react";
import { useMemo, useState, type CSSProperties } from "react";
import { formatReadingDuration, type ReadingStatsDay } from "../lib/readingStats";

interface StatsPanelProps {
  days: ReadingStatsDay[];
}

export function StatsPanel({ days }: StatsPanelProps) {
  const [activeTooltipDate, setActiveTooltipDate] = useState<string | null>(null);
  const chartDays = useMemo(() => getVisibleChartDays(days), [days]);
  const maxDurationMs = Math.max(...chartDays.map((day) => day.durationMs), 0);
  const today = days.at(-1);

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

export function getVisibleChartDays(days: ReadingStatsDay[]) {
  const firstDayWithDataIndex = days.findIndex((day) => day.durationMs > 0);
  if (firstDayWithDataIndex >= 0) {
    return days.slice(firstDayWithDataIndex);
  }

  return days.slice(-1);
}

function shouldShowChartDayLabel(day: ReadingStatsDay, index: number, dayCount: number) {
  if (dayCount <= 14) {
    return true;
  }

  return index === 0 || index === dayCount - 1 || day.durationMs > 0 || index % 7 === 0;
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
