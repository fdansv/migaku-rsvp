import { useEffect, useMemo, useRef, useState } from "react";
import { DropOverlay } from "./components/DropOverlay";
import { LibrarySidebar } from "./components/LibrarySidebar";
import { ReaderPane } from "./components/ReaderPane";
import { SettingsPanel } from "./components/SettingsPanel";
import { Topbar } from "./components/Topbar";
import { useBookLibrary } from "./hooks/useBookLibrary";
import { useFileDrop } from "./hooks/useFileDrop";
import { useMigakuAdapter } from "./lib/migakuAdapter";
import {
  advancePosition,
  clampPosition,
  flattenSentences,
  getDisplayText,
  getDisplayTokens,
  getTokenDelayMs,
  retreatPosition,
  shouldStopForTokenIndexes,
} from "./lib/rsvp";
import { loadSettings, saveSettings } from "./lib/settings";
import type { Book, ReaderSettings, Sentence } from "./types";

const BUFFER_SENTENCES_BEHIND = 20;
const BUFFER_SENTENCES_AHEAD = 100;
const BUFFER_WINDOW_SIZE = 40;

export function App() {
  const {
    books,
    selectedBook,
    selectedBookId,
    position,
    setPosition,
    isImporting,
    error,
    importBook,
    selectBook,
    removeBook,
    saveSelectedBookProgress,
  } = useBookLibrary();
  const [settings, setSettings] = useState<ReaderSettings>(() => loadSettings());
  const [playing, setPlaying] = useState(false);
  const [autoPaused, setAutoPaused] = useState(false);
  const [skipStopKey, setSkipStopKey] = useState<string | null>(null);
  const migakuRootRef = useRef<HTMLDivElement>(null);
  const rsvpDisplayRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    saveSettings(settings);
  }, [settings]);

  const sentences = useMemo(() => flattenSentences(selectedBook), [selectedBook]);
  const safePosition = useMemo(() => clampPosition(position, sentences), [position, sentences]);
  const currentSentence = sentences[safePosition.sentenceIndex];
  const displayTokens = useMemo(
    () =>
      currentSentence
        ? getDisplayTokens(currentSentence, safePosition.tokenIndex, settings.chunkSize)
        : [],
    [currentSentence, safePosition.tokenIndex, settings.chunkSize],
  );
  const displayTokenIndexes = useMemo(
    () => displayTokens.map((token) => token.index),
    [displayTokens],
  );
  const displayTokenKey = displayTokenIndexes.join(",");
  const displayText = currentSentence
    ? getDisplayText(currentSentence, safePosition.tokenIndex, settings.chunkSize)
    : "";
  const bufferWindow = useMemo(
    () => getMigakuBufferWindow(selectedBook?.id, sentences, safePosition.sentenceIndex),
    [safePosition.sentenceIndex, selectedBook?.id, sentences],
  );
  const migaku = useMigakuAdapter(
    migakuRootRef,
    rsvpDisplayRef,
    currentSentence,
    displayTokenIndexes,
    bufferWindow.key,
  );
  const activeKey = currentSentence ? `${currentSentence.id}:${safePosition.tokenIndex}` : "";
  const shouldStop =
    Boolean(currentSentence) &&
    shouldStopForTokenIndexes(
      settings.stopMode,
      migaku.statuses,
      currentSentence,
      displayTokenIndexes,
    );
  const { isFileDragActive, dragHandlers } = useFileDrop({
    disabled: isImporting,
    onFile: handleImportFile,
  });

  useEffect(() => {
    setPosition((previous) => clampPosition(previous, sentences));
  }, [sentences, setPosition]);

  useEffect(() => {
    setAutoPaused(false);
    setSkipStopKey(null);
  }, [activeKey]);

  useEffect(() => {
    if (!selectedBookId || !currentSentence) {
      return;
    }

    const timer = window.setTimeout(() => {
      saveSelectedBookProgress(safePosition);
    }, 300);

    return () => window.clearTimeout(timer);
  }, [currentSentence, safePosition, saveSelectedBookProgress, selectedBookId]);

  useEffect(() => {
    if (!playing || !currentSentence) {
      return;
    }

    if (shouldStop && skipStopKey !== activeKey) {
      setPlaying(false);
      setAutoPaused(true);
      return;
    }

    const timer = window.setTimeout(() => {
      setPosition((previous) => {
        const next = advancePosition(previous, sentences, settings.chunkSize);
        if (
          next.sentenceIndex === previous.sentenceIndex &&
          next.tokenIndex === previous.tokenIndex
        ) {
          setPlaying(false);
        }
        return next;
      });
    }, getTokenDelayMs(displayText, settings));

    return () => window.clearTimeout(timer);
  }, [
    activeKey,
    currentSentence,
    displayText,
    migaku.statuses,
    playing,
    sentences,
    settings,
    shouldStop,
    skipStopKey,
    setPosition,
  ]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (target?.matches("input, select, textarea, button")) {
        return;
      }

      if (event.code === "Space") {
        event.preventDefault();
        togglePlayback();
      }
      if (event.code === "ArrowRight") {
        event.preventDefault();
        goNext();
      }
      if (event.code === "ArrowLeft") {
        event.preventDefault();
        goPrevious();
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  });

  function handleImportFile(file: File) {
    setPlaying(false);
    void importBook(file);
  }

  function handleSelectBook(book: Book) {
    setPlaying(false);
    selectBook(book);
  }

  function handleRemoveBook(bookId: string) {
    setPlaying(false);
    void removeBook(bookId);
  }

  function updateSettings(nextSettings: Partial<ReaderSettings>) {
    setSettings((previous) => ({ ...previous, ...nextSettings }));
  }

  function togglePlayback() {
    if (!currentSentence) {
      return;
    }

    if (!playing && autoPaused && shouldStop) {
      setSkipStopKey(activeKey);
    }
    setAutoPaused(false);
    setPlaying((previous) => !previous);
  }

  function goNext() {
    setAutoPaused(false);
    setPlaying(false);
    setPosition((previous) => advancePosition(previous, sentences, settings.chunkSize));
  }

  function goPrevious() {
    setAutoPaused(false);
    setPlaying(false);
    setPosition((previous) => retreatPosition(previous, sentences, settings.chunkSize));
  }

  return (
    <div className="app" data-theme={settings.theme} {...dragHandlers}>
      {isFileDragActive ? <DropOverlay isImporting={isImporting} /> : null}
      <Topbar
        isImporting={isImporting}
        migakuParsed={migaku.parsed}
        migakuTimedOut={migaku.timedOut}
        onImportFile={handleImportFile}
      />

      <div className="shell">
        <LibrarySidebar
          books={books}
          selectedBookId={selectedBookId}
          onSelectBook={handleSelectBook}
          onRemoveBook={handleRemoveBook}
        />
        <ReaderPane
          error={error}
          selectedBook={selectedBook}
          currentSentence={currentSentence}
          sentences={sentences}
          safePosition={safePosition}
          displayText={displayText}
          displayTokenIndexes={displayTokenIndexes}
          displayTokenKey={displayTokenKey}
          bufferSentences={bufferWindow.sentences}
          migaku={migaku}
          rsvpDisplayRef={rsvpDisplayRef}
          migakuRootRef={migakuRootRef}
          fontSize={settings.fontSize}
          playing={playing}
          autoPaused={autoPaused}
          onPrevious={goPrevious}
          onNext={goNext}
          onTogglePlayback={togglePlayback}
        />
        <SettingsPanel settings={settings} onChange={updateSettings} />
      </div>
    </div>
  );
}

function getMigakuBufferWindow(
  bookId: string | undefined,
  sentences: Sentence[],
  sentenceIndex: number,
) {
  const bufferAnchor = Math.floor(sentenceIndex / BUFFER_WINDOW_SIZE);
  const blockStart = bufferAnchor * BUFFER_WINDOW_SIZE;
  const start = Math.max(0, blockStart - BUFFER_SENTENCES_BEHIND);
  const end = Math.min(sentences.length, blockStart + BUFFER_WINDOW_SIZE + BUFFER_SENTENCES_AHEAD);

  return {
    key: `${bookId ?? "no-book"}:${start}:${end}`,
    sentences: sentences.slice(start, end),
  };
}
