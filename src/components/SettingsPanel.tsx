import { ChevronDown, Settings2 } from "lucide-react";
import {
  useEffect,
  useRef,
  useState,
  type FormEvent,
} from "react";
import type { ReaderSettings } from "../types";

interface SettingsPanelProps {
  settings: ReaderSettings;
  isOpen: boolean;
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

export function SettingsPanel({ settings, isOpen, onToggle, onChange }: SettingsPanelProps) {
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
          <RangeSetting
            label="Step time"
            min={100}
            max={2000}
            step={50}
            value={settings.stepDurationMs}
            format={formatStepDuration}
            onValue={(value) => onChange({ stepDurationMs: value })}
          />
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
            label="Words"
            min={1}
            max={4}
            step={1}
            value={settings.chunkSize}
            format={(value) => String(value)}
            onValue={(value) => onChange({ chunkSize: value })}
          />
          <label>
            Pause
            <select
              value={settings.stopMode}
              onChange={(event) =>
                onChange({ stopMode: event.currentTarget.value as ReaderSettings["stopMode"] })
              }
            >
              <option value="unknown">Unknown</option>
              <option value="never">Never</option>
              <option value="i+1">i+1</option>
            </select>
          </label>
          <label>
            Theme
            <select
              value={settings.theme}
              onChange={(event) =>
                onChange({ theme: event.currentTarget.value as ReaderSettings["theme"] })
              }
            >
              <option value="paper">Paper</option>
              <option value="dark">Dark</option>
              <option value="contrast">Contrast</option>
            </select>
          </label>
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

function formatStepDuration(value: number) {
  return `${(value / 1000).toFixed(2)}s`;
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
