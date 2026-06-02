import { Upload } from "lucide-react";

interface DropOverlayProps {
  isImporting: boolean;
}

export function DropOverlay({ isImporting }: DropOverlayProps) {
  return (
    <div className="drop-overlay" aria-hidden="true">
      <div className="drop-overlay-panel">
        <Upload size={34} aria-hidden="true" />
        <strong>{isImporting ? "Import in progress" : "Drop EPUB to import"}</strong>
        <span>
          {isImporting
            ? "Wait for the current import to finish."
            : "Release anywhere on this page."}
        </span>
      </div>
    </div>
  );
}
