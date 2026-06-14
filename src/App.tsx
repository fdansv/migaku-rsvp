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
  getPositionForProgressUnit,
  getProgressStats,
  getStepDelayMs,
  getUnknownWordUnitCount,
  retreatPosition,
  retreatSentencePosition,
  shouldStopForTokenIndexes,
  type TokenGroupsBySentenceId,
} from "./lib/rsvp";
import { generateAiRecap, generateAiSentenceTranslation, getRecapPages } from "./lib/recap";
import { loadSettings, saveSettings } from "./lib/settings";
import { loadServerAiStatus } from "./lib/serverLibrary";
import type { Book, ReaderSettings, Sentence } from "./types";

const BUFFER_SENTENCES_BEHIND = 20;
const BUFFER_SENTENCES_AHEAD = 100;
const BUFFER_WINDOW_SIZE = 40;
const SERVER_AI_API_URL = "/api/ai/chat";
const TRANSPORT_KEY_CODES = new Set([
  "Space",
  "ArrowRight",
  "ArrowLeft",
  "ArrowDown",
  "ArrowUp",
]);

type RecapStatus = "idle" | "loading" | "success" | "error";
type SentenceTranslationStatus = "loading" | "success" | "error";

interface SentenceTranslation {
  status: SentenceTranslationStatus;
  text: string;
  error: string;
  sourceText: string;
}

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
  const [sentenceTranslations, setSentenceTranslations] = useState<
    Record<string, SentenceTranslation>
  >({});
  const migakuRootRef = useRef<HTMLDivElement>(null);
  const rsvpDisplayRef = useRef<HTMLDivElement>(null);
  const playbackTimerRef = useRef<number | null>(null);
  const playbackStepRef = useRef<{
    sentences: Sentence[];
    chunkSize: number;
    tokenGroupsBySentenceId: TokenGroupsBySentenceId;
  }>({
    sentences: [],
    chunkSize: settings.chunkSize,
    tokenGroupsBySentenceId: {},
  });
  const translationRequestsRef = useRef(new Set<string>());

  useEffect(() => {
    saveSettings(settings);
  }, [settings]);

  useEffect(() => {
    let canceled = false;

    void loadServerAiStatus().then((status) => {
      if (canceled || !status?.enabled) {
        return;
      }

      setSettings((previous) => {
        if (previous.recapApiUrl.trim() || previous.recapApiKey.trim()) {
          return previous;
        }

        return {
          ...previous,
          recapApiUrl: status.apiUrl || SERVER_AI_API_URL,
          recapModel: previous.recapModel || status.recapModel,
        };
      });
    });

    return () => {
      canceled = true;
    };
  }, []);

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
  const stepDelayMs = useMemo(() => getStepDelayMs(settings), [settings.stepDurationMs]);
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
  const unknownWordUnitCount =
    currentSentence && migaku.parsed
      ? getUnknownWordUnitCount(currentSentence, migaku.statuses, migakuTokenGroups)
      : 0;
  const shouldTranslateCurrentSentence =
    currentSentence !== undefined && migaku.parsed && unknownWordUnitCount > 1;
  const sentenceDifficulty =
    unknownWordUnitCount === 1
      ? "i-plus-one"
      : unknownWordUnitCount > 1
        ? "beyond-i-plus-one"
        : "none";
  const currentSentenceTranslation =
    currentSentence && shouldTranslateCurrentSentence
      ? sentenceTranslations[currentSentence.id]
      : undefined;
  const sentenceSubtitle =
    currentSentenceTranslation?.status === "success" ? currentSentenceTranslation.text : "";
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
    playbackStepRef.current = {
      sentences,
      chunkSize: settings.chunkSize,
      tokenGroupsBySentenceId,
    };
  }, [sentences, settings.chunkSize, tokenGroupsBySentenceId]);

  useEffect(() => {
    setRecap({ status: "idle", summary: "", error: "", sourceLabel: "" });
    setSentenceTranslations({});
    translationRequestsRef.current.clear();
  }, [selectedBookId]);

  useEffect(() => {
    setSentenceTranslations({});
    translationRequestsRef.current.clear();
  }, [settings.recapApiUrl, settings.recapApiKey]);

  useEffect(() => {
    if (!currentSentence || !shouldTranslateCurrentSentence) {
      return;
    }
    const apiUrl = settings.recapApiUrl.trim();
    const usesServerAi = apiUrl === SERVER_AI_API_URL;
    if (!apiUrl || (!settings.recapApiKey.trim() && !usesServerAi)) {
      return;
    }

    const sentenceId = currentSentence.id;
    const sentenceText = currentSentence.text;
    const cached = sentenceTranslations[sentenceId];
    if (cached?.sourceText === sentenceText) {
      return;
    }
    if (translationRequestsRef.current.has(sentenceId)) {
      return;
    }

    translationRequestsRef.current.add(sentenceId);
    setSentenceTranslations((previous) => ({
      ...previous,
      [sentenceId]: {
        status: "loading",
        text: "",
        error: "",
        sourceText: sentenceText,
      },
    }));

    void generateAiSentenceTranslation({
      settings,
      sentenceText,
    })
      .then((translation) => {
        setSentenceTranslations((previous) => ({
          ...previous,
          [sentenceId]: {
            status: "success",
            text: translation,
            error: "",
            sourceText: sentenceText,
          },
        }));
      })
      .catch((error) => {
        setSentenceTranslations((previous) => ({
          ...previous,
          [sentenceId]: {
            status: "error",
            text: "",
            error: error instanceof Error ? error.message : "Could not translate sentence.",
            sourceText: sentenceText,
          },
        }));
      })
      .finally(() => {
        translationRequestsRef.current.delete(sentenceId);
      });
  }, [
    currentSentence,
    sentenceTranslations,
    settings,
    shouldTranslateCurrentSentence,
  ]);

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
      clearPlaybackTimer();
      return;
    }

    if (shouldStop && skipStopKey !== activeKey) {
      clearPlaybackTimer();
      setPlaying(false);
      setAutoPaused(true);
      return;
    }

    const timer = window.setTimeout(() => {
      if (playbackTimerRef.current === timer) {
        playbackTimerRef.current = null;
      }
      setPosition((previous) => {
        const playbackStep = playbackStepRef.current;
        const next = advancePosition(
          previous,
          playbackStep.sentences,
          playbackStep.chunkSize,
          playbackStep.tokenGroupsBySentenceId,
        );
        if (
          next.sentenceIndex === previous.sentenceIndex &&
          next.tokenIndex === previous.tokenIndex
        ) {
          setPlaying(false);
        }
        return next;
      });
    }, stepDelayMs);
    playbackTimerRef.current = timer;

    return () => {
      window.clearTimeout(timer);
      if (playbackTimerRef.current === timer) {
        playbackTimerRef.current = null;
      }
    };
  }, [
    activeKey,
    currentSentence?.id,
    playing,
    shouldStop,
    skipStopKey,
    setPosition,
    stepDelayMs,
  ]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (target?.matches("input, select, textarea, [contenteditable='true']")) {
        return;
      }

      if (event.repeat && TRANSPORT_KEY_CODES.has(event.code)) {
        event.preventDefault();
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
    stopPlayback();
    void importBook(file);
  }

  function handleSelectBook(book: Book) {
    stopPlayback();
    selectBook(book);
  }

  function handleRemoveBook(bookId: string) {
    stopPlayback();
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
    if (playing) {
      clearPlaybackTimer();
    }
    setAutoPaused(false);
    setPlaying((previous) => !previous);
  }

  function goNext() {
    setAutoPaused(false);
    stopPlayback();
    setPosition((previous) =>
      advancePosition(previous, sentences, settings.chunkSize, tokenGroupsBySentenceId),
    );
  }

  function goPrevious() {
    setAutoPaused(false);
    stopPlayback();
    setPosition((previous) =>
      retreatPosition(previous, sentences, settings.chunkSize, tokenGroupsBySentenceId),
    );
  }

  function goNextSentence() {
    setAutoPaused(false);
    stopPlayback();
    setPosition((previous) => advanceSentencePosition(previous, sentences, tokenGroupsBySentenceId));
  }

  function goPreviousSentence() {
    setAutoPaused(false);
    stopPlayback();
    setPosition((previous) => retreatSentencePosition(previous, sentences, tokenGroupsBySentenceId));
  }

  function beginProgressJump() {
    setAutoPaused(false);
    stopPlayback();
  }

  function jumpToProgressLocation(location: number) {
    setAutoPaused(false);
    stopPlayback();
    setPosition(getPositionForProgressUnit(location, sentences, settings.chunkSize));
  }

  async function handleRecap() {
    setAutoPaused(false);
    stopPlayback();

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

  function stopPlayback() {
    clearPlaybackTimer();
    setPlaying(false);
  }

  function clearPlaybackTimer() {
    if (playbackTimerRef.current === null) {
      return;
    }

    window.clearTimeout(playbackTimerRef.current);
    playbackTimerRef.current = null;
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
          recapStatus={recap.status}
          recapSummary={recap.summary}
          recapError={recap.error}
          recapSourceLabel={recap.sourceLabel}
          sentenceSubtitle={sentenceSubtitle}
          sentenceDifficulty={sentenceDifficulty}
          onPrevious={goPrevious}
          onNext={goNext}
          onTogglePlayback={togglePlayback}
          onBeginProgressJump={beginProgressJump}
          onProgressJump={jumpToProgressLocation}
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
