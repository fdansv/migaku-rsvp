import { BookOpen, Upload } from "lucide-react";
import type { ChangeEvent } from "react";

interface TopbarProps {
  isImporting: boolean;
  migakuParsed: boolean;
  migakuTimedOut: boolean;
  onImportFile: (file: File) => void;
}

export function Topbar({
  isImporting,
  migakuParsed,
  migakuTimedOut,
  onImportFile,
}: TopbarProps) {
  function onFileChange(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.currentTarget.value = "";
    if (file) {
      onImportFile(file);
    }
  }

  return (
    <header className="topbar">
      <div className="brand">
        <BookOpen size={22} aria-hidden="true" />
        <span>Migaku RSVP</span>
      </div>
      <div className="topbar-actions">
        <span
          key={`migaku-${migakuParsed}-${migakuTimedOut}`}
          className={`migaku-pill${migakuParsed ? " is-ready" : ""}`}
        >
          Migaku {migakuParsed ? "parsed" : migakuTimedOut ? "idle" : "waiting"}
        </span>
        <label className="icon-button import-button" title="Import EPUB">
          <Upload size={18} aria-hidden="true" />
          <span>{isImporting ? "Importing" : "Import"}</span>
          <input
            type="file"
            accept=".epub,application/epub+zip"
            disabled={isImporting}
            onChange={onFileChange}
          />
        </label>
      </div>
    </header>
  );
}
