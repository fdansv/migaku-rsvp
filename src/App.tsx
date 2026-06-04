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
  advanceSentencePosition,
  clampPosition,
  flattenSentences,
  getDisplayText,
  getDisplayTokens,
  getProgressStats,
  getTokenDelayMs,
  retreatPosition,
  retreatSentencePosition,
  shouldStopForTokenIndexes,
} from "./lib/rsvp";
import { generateAiRecap, getRecapPages } from "./lib/recap";
import { loadSettings, saveSettings } from "./lib/settings";
import type { Book, ReaderSettings, Sentence } from "./types";

const BUFFER_SENTENCES_BEHIND = 20;
const BUFFER_SENTENCES_AHEAD = 100;
const BUFFER_WINDOW_SIZE = 40;

type RecapStatus = "idle" | "loading" | "success" | "error";

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
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [recap, setRecap] = useState<{
    status: RecapStatus;
    summary: string;
    error: string;
    sourceLabel: string;
  }>({
    status: "idle",
    summary: "",
    error: "",
    sourceLabel: "",
  });
  const migakuRootRef = useRef<HTMLDivElement>(null);
  const rsvpDisplayRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    saveSettings(settings);
  }, [settings]);

  const sentences = useMemo(() => flattenSentences(selectedBook), [selectedBook]);
  const safePosition = useMemo(() => clampPosition(position, sentences), [position, sentences]);
  const currentSentence = sentences[safePosition.sentenceIndex];
  const fallbackDisplayTokens = useMemo(
    () =>
      currentSentence
        ? getDisplayTokens(currentSentence, safePosition.tokenIndex, settings.chunkSize)
        : [],
    [currentSentence, safePosition.tokenIndex, settings.chunkSize],
  );
  const fallbackDisplayTokenIndexes = useMemo(
    () => fallbackDisplayTokens.map((token) => token.index),
    [fallbackDisplayTokens],
  );
  const bufferWindow = useMemo(
    () => getMigakuBufferWindow(selectedBook?.id, sentences, safePosition.sentenceIndex),
    [safePosition.sentenceIndex, selectedBook?.id, sentences],
  );
  const migaku = useMigakuAdapter(
    migakuRootRef,
    rsvpDisplayRef,
    currentSentence,
    fallbackDisplayTokenIndexes,
    bufferWindow.key,
  );
  const migakuTokenGroups = useMemo(
    () => (migaku.parsed ? migaku.tokenGroups : []),
    [migaku.parsed, migaku.tokenGroups],
  );
  const tokenGroupsBySentenceId = useMemo(
    () => (currentSentence ? { [currentSentence.id]: migakuTokenGroups } : {}),
    [currentSentence, migakuTokenGroups],
  );
  const progress = useMemo(
    () => getProgressStats(safePosition, sentences, settings.chunkSize, tokenGroupsBySentenceId),
    [safePosition, sentences, settings.chunkSize, tokenGroupsBySentenceId],
  );
  const displayTokens = useMemo(
    () =>
      currentSentence
        ? getDisplayTokens(
            currentSentence,
            safePosition.tokenIndex,
            settings.chunkSize,
            migakuTokenGroups,
          )
        : [],
    [currentSentence, safePosition.tokenIndex, settings.chunkSize, migakuTokenGroups],
  );
  const displayTokenIndexes = useMemo(
    () => displayTokens.map((token) => token.index),
    [displayTokens],
  );
  const displayTokenKey = displayTokenIndexes.join(",");
  const displayText = currentSentence
    ? getDisplayText(
        currentSentence,
        safePosition.tokenIndex,
        settings.chunkSize,
        migakuTokenGroups,
      )
    : "";
  const activeKey = currentSentence ? `${currentSentence.id}:${safePosition.tokenIndex}` : "";
  const shouldStop =
    Boolean(currentSentence) &&
    shouldStopForTokenIndexes(
      settings.stopMode,
      migaku.statuses,
      currentSentence,
      displayTokenIndexes,
      migakuTokenGroups,
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
    setRecap({ status: "idle", summary: "", error: "", sourceLabel: "" });
  }, [selectedBookId]);

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
        const next = advancePosition(
          previous,
          sentences,
          settings.chunkSize,
          tokenGroupsBySentenceId,
        );
        if (
          next.sentenceIndex === previous.sentenceIndex &&
          next.tokenIndex === previous.tokenIndex
        ) {
          setPlaying(false);
        }
        return next;
      });
    }, getTokenDelayMs(displayTokens, settings, migakuTokenGroups));

    return () => window.clearTimeout(timer);
  }, [
    activeKey,
    currentSentence,
    displayTokens,
    migakuTokenGroups,
    migaku.statuses,
    playing,
    sentences,
    settings,
    shouldStop,
    skipStopKey,
    setPosition,
    tokenGroupsBySentenceId,
  ]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (target?.matches("input, select, textarea, [contenteditable='true']")) {
        return;
      }

      if (event.code === "Space" && !target?.matches("button")) {
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
      if (event.code === "ArrowDown") {
        event.preventDefault();
        goNextSentence();
      }
      if (event.code === "ArrowUp") {
        event.preventDefault();
        goPreviousSentence();
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
    setPosition((previous) =>
      advancePosition(previous, sentences, settings.chunkSize, tokenGroupsBySentenceId),
    );
  }

  function goPrevious() {
    setAutoPaused(false);
    setPlaying(false);
    setPosition((previous) =>
      retreatPosition(previous, sentences, settings.chunkSize, tokenGroupsBySentenceId),
    );
  }

  function goNextSentence() {
    setAutoPaused(false);
    setPlaying(false);
    setPosition((previous) => advanceSentencePosition(previous, sentences, tokenGroupsBySentenceId));
  }

  function goPreviousSentence() {
    setAutoPaused(false);
    setPlaying(false);
    setPosition((previous) => retreatSentencePosition(previous, sentences, tokenGroupsBySentenceId));
  }

  async function handleRecap() {
    setAutoPaused(false);
    setPlaying(false);

    const pages = getRecapPages(selectedBook, currentSentence);
    const sourceLabel =
      pages.length === 1 ? "1 previous page" : pages.length > 1 ? `${pages.length} previous pages` : "";

    setRecap({ status: "loading", summary: "", error: "", sourceLabel });

    try {
      const summary = await generateAiRecap({
        settings,
        bookTitle: selectedBook?.title ?? "Untitled book",
        pages,
      });
      setRecap({ status: "success", summary, error: "", sourceLabel });
    } catch (error) {
      setRecap({
        status: "error",
        summary: "",
        error: error instanceof Error ? error.message : "Could not generate recap.",
        sourceLabel,
      });
    }
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

      <div className={`shell${settingsOpen ? "" : " shell--settings-collapsed"}`}>
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
          progress={progress}
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
          recapStatus={recap.status}
          recapSummary={recap.summary}
          recapError={recap.error}
          recapSourceLabel={recap.sourceLabel}
          onPrevious={goPrevious}
          onNext={goNext}
          onTogglePlayback={togglePlayback}
          onRecap={handleRecap}
          onCloseRecap={() =>
            setRecap({ status: "idle", summary: "", error: "", sourceLabel: "" })
          }
        />
        <SettingsPanel
          settings={settings}
          isOpen={settingsOpen}
          onToggle={() => setSettingsOpen((previous) => !previous)}
          onChange={updateSettings}
        />
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
