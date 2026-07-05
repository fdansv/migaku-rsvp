import { BarChart3 } from "lucide-react";
import { formatReadingDuration, type ReadingStatsDay } from "../lib/readingStats";

interface StatsPanelProps {
  days: ReadingStatsDay[];
}

export function StatsPanel({ days }: StatsPanelProps) {
  const maxDurationMs = Math.max(...days.map((day) => day.durationMs), 0);
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
        role="img"
        aria-label="Daily reading time for the last seven days"
      >
        <div className="reading-chart-axis" aria-hidden="true">
          <span>{formatReadingDuration(maxDurationMs)}</span>
          <span>{formatReadingDuration(maxDurationMs / 2)}</span>
          <span>0m</span>
        </div>
        <div className="reading-chart-bars">
          {days.map((day) => {
            const height =
              maxDurationMs > 0 ? Math.max((day.durationMs / maxDurationMs) * 100, 3) : 0;

            return (
              <div className="reading-chart-day" key={day.date}>
                <div
                  className="reading-chart-bar-track"
                  title={`${day.label}: ${formatReadingDuration(day.durationMs)}`}
                >
                  <div
                    className="reading-chart-bar"
                    style={{ height: `${height}%` }}
                    aria-hidden="true"
                  />
                </div>
                <span>{day.label}</span>
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
}
