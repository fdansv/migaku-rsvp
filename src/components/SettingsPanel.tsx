import { BarChart3, ChevronDown, Settings2 } from "lucide-react";
import {
  useEffect,
  useRef,
  useState,
  type FormEvent,
} from "react";
import { formatReadingDuration, type ReadingStatsDay } from "../lib/readingStats";
import type { ReaderSettings, StepGroupingMode, StopMode, ThemeMode } from "../types";

interface SettingsPanelProps {
  settings: ReaderSettings;
  isOpen: boolean;
  readingStatsDays: ReadingStatsDay[];
  remainingReadingDurationMs: number | null;
  onToggle: () => void;
  onChange: (nextSettings: Partial<ReaderSettings>) => void;
}

interface RangeSettingProps {
  label: string;
  min: number;
  max: number;
  step: number;
  value: number;
  format: (value: number) => string;
  onValue: (value: number) => void;
}

const STOP_MODE_OPTIONS: Array<{ value: StopMode; label: string }> = [
  { value: "unknown", label: "Unknown" },
  { value: "never", label: "Never" },
  { value: "i+1", label: "i+1" },
];

const THEME_OPTIONS: Array<{ value: ThemeMode; label: string }> = [
  { value: "paper", label: "Paper" },
  { value: "dark", label: "Dark" },
  { value: "contrast", label: "Contrast" },
];

const STEP_GROUPING_OPTIONS: Array<{ value: StepGroupingMode; label: string }> = [
  { value: "words", label: "Words" },
  { value: "characters", label: "Characters" },
];

export function SettingsPanel({
  settings,
  isOpen,
  readingStatsDays,
  remainingReadingDurationMs,
  onToggle,
  onChange,
}: SettingsPanelProps) {
  return (
    <aside className={`settings${isOpen ? "" : " is-collapsed"}`} aria-label="Reader settings">
      <button
        className="settings-toggle"
        type="button"
        aria-label="Settings"
        aria-expanded={isOpen}
        onClick={onToggle}
      >
        <Settings2 size={17} aria-hidden="true" />
        <span>Settings</span>
        <ChevronDown className="settings-toggle-icon" size={16} aria-hidden="true" />
      </button>
      {isOpen ? (
        <div className="settings-body">
          <ReadingStatsSection
            days={readingStatsDays}
            remainingReadingDurationMs={remainingReadingDurationMs}
          />
          <RangeSetting
            label="Steps/min"
            min={80}
            max={300}
            step={1}
            value={settings.stepsPerMinute}
            format={(value) => String(value)}
            onValue={(value) => onChange({ stepsPerMinute: value })}
          />
          <label>
            Group by
            <select
              value={settings.stepGroupingMode}
              onChange={(event) =>
                onChange({ stepGroupingMode: event.currentTarget.value as StepGroupingMode })
              }
            >
              {STEP_GROUPING_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>
          <RangeSetting
            label="Font"
            min={36}
            max={96}
            step={2}
            value={settings.fontSize}
            format={(value) => `${value}px`}
            onValue={(value) => onChange({ fontSize: value })}
          />
          <RangeSetting
            label={settings.stepGroupingMode === "characters" ? "Characters" : "Words"}
            min={1}
            max={settings.stepGroupingMode === "characters" ? 24 : 4}
            step={1}
            value={
              settings.stepGroupingMode === "characters"
                ? settings.characterChunkSize
                : settings.chunkSize
            }
            format={(value) => String(value)}
            onValue={(value) =>
              onChange(
                settings.stepGroupingMode === "characters"
                  ? { characterChunkSize: value }
                  : { chunkSize: value },
              )
            }
          />
          <OptionGroup
            label="Pause"
            options={STOP_MODE_OPTIONS}
            value={settings.stopMode}
            onValue={(value) => onChange({ stopMode: value })}
          />
          <OptionGroup
            label="Theme"
            options={THEME_OPTIONS}
            value={settings.theme}
            onValue={(value) => onChange({ theme: value })}
          />
          <label>
            AI URL
            <input
              type="url"
              value={settings.recapApiUrl}
              autoComplete="off"
              spellCheck={false}
              onChange={(event) => onChange({ recapApiUrl: event.currentTarget.value })}
            />
          </label>
          <label>
            API key
            <input
              type="password"
              value={settings.recapApiKey}
              autoComplete="new-password"
              spellCheck={false}
              onChange={(event) => onChange({ recapApiKey: event.currentTarget.value })}
            />
          </label>
          <label>
            Model
            <input
              type="text"
              value={settings.recapModel}
              autoComplete="off"
              spellCheck={false}
              onChange={(event) => onChange({ recapModel: event.currentTarget.value })}
            />
          </label>
        </div>
      ) : null}
    </aside>
  );
}

function ReadingStatsSection({
  days,
  remainingReadingDurationMs,
}: {
  days: ReadingStatsDay[];
  remainingReadingDurationMs: number | null;
}) {
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
        <span>
          <strong>
            {remainingReadingDurationMs === null
              ? "--"
              : formatReadingDuration(remainingReadingDurationMs)}
          </strong>
          <small>Left</small>
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

function OptionGroup<T extends string>({
  label,
  options,
  value,
  onValue,
}: {
  label: string;
  options: Array<{ value: T; label: string }>;
  value: T;
  onValue: (value: T) => void;
}) {
  return (
    <fieldset className="setting-group">
      <legend>{label}</legend>
      <div className="setting-options" role="group" aria-label={label}>
        {options.map((option) => (
          <button
            key={option.value}
            className={option.value === value ? "is-selected" : undefined}
            type="button"
            aria-pressed={option.value === value}
            onClick={() => onValue(option.value)}
          >
            {option.label}
          </button>
        ))}
      </div>
    </fieldset>
  );
}

function RangeSetting({ label, min, max, step, value, format, onValue }: RangeSettingProps) {
  const [displayValue, setDisplayValue] = useState(value);
  const valueRef = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    setDisplayValue(value);
    if (valueRef.current) {
      valueRef.current.textContent = format(value);
    }
  }, [format, value]);

  function commit(nextValue: number) {
    setDisplayValue(nextValue);
    if (valueRef.current) {
      valueRef.current.textContent = format(nextValue);
    }
    onValue(nextValue);
  }

  function onRangeEvent(event: FormEvent<HTMLInputElement>) {
    commit(Number(event.currentTarget.value));
  }

  return (
    <label>
      {label}
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onInput={onRangeEvent}
        onChange={onRangeEvent}
        onPointerMove={(event) => {
          if (event.buttons === 1) {
            commit(Number(event.currentTarget.value));
          }
        }}
      />
      <span ref={valueRef} className="setting-value">
        {format(displayValue)}
      </span>
    </label>
  );
}
