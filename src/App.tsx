import { useEffect, useMemo, useRef, useState } from "react";
import { DropOverlay } from "./components/DropOverlay";
import { LibrarySidebar } from "./components/LibrarySidebar";
import { ReaderPane } from "./components/ReaderPane";
import { SettingsPanel } from "./components/SettingsPanel";
import { StatsPanel } from "./components/StatsPanel";
import { Topbar } from "./components/Topbar";
import { useBookLibrary } from "./hooks/useBookLibrary";
import { useFileDrop } from "./hooks/useFileDrop";
import { useMigakuAdapter } from "./lib/migakuAdapter";
import {
  estimateRemainingReadingTime,
  getDailyReadingStats,
  getReadingStepStats,
  type ReadingStepStats,
} from "./lib/readingStats";
import {
  advancePosition,
  advanceSentencePosition,
  clampPosition,
  flattenSentences,
  getDisplayStep,
  getPositionForProgressUnit,
  getProgressStats,
  getStepConfig,
  getStepDelayMs,
  getUnknownWordUnitCount,
  retreatPosition,
  retreatSentencePosition,
  shouldStopForTokenIndexes,
  type ReaderStepConfig,
  type TokenGroupsBySentenceId,
} from "./lib/rsvp";
import { generateAiRecap, generateAiSentenceTranslation, getRecapPages } from "./lib/recap";
import { loadSettings, saveSettings } from "./lib/settings";
import {
  isServerLibraryEnabled,
  loadServerAiStatus,
  loadServerReadingSessions,
  saveServerReadingSession,
} from "./lib/serverLibrary";
import { loadReadingSessions, saveReadingSession } from "./lib/storage";
import type {
  Book,
  ReaderSettings,
  ReadingSession,
  ReadingSessionLocation,
  Sentence,
} from "./types";

const BUFFER_SENTENCES_BEHIND = 20;
const BUFFER_SENTENCES_AHEAD = 100;
const BUFFER_WINDOW_SIZE = 40;
const SERVER_AI_API_URL = "/api/ai/chat";
const MIN_READING_SESSION_MS = 100;
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

interface ActiveReadingSession {
  id: string;
  bookId: string;
  startedAt: string;
  startedAtMs: number;
  currentStepKey: string;
  currentStepStartedAtMs: number;
  currentStepStats: ReadingStepStats;
  startLocation: ReadingSessionLocation;
  currentLocation: ReadingSessionLocation;
  wordCount: number;
  characterCount: number;
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
  const [readingSessions, setReadingSessions] = useState<ReadingSession[]>([]);
  const migakuRootRef = useRef<HTMLDivElement>(null);
  const rsvpDisplayRef = useRef<HTMLDivElement>(null);
  const playbackTimerRef = useRef<number | null>(null);
  const playbackStepRef = useRef<{
    sentences: Sentence[];
    stepConfig: ReaderStepConfig;
    tokenGroupsBySentenceId: TokenGroupsBySentenceId;
  }>({
    sentences: [],
    stepConfig: getStepConfig(settings),
    tokenGroupsBySentenceId: {},
  });
  const activeReadingSessionRef = useRef<ActiveReadingSession | null>(null);
  const translationRequestsRef = useRef(new Set<string>());
  const serverReadingSessionsEnabledRef = useRef(false);

  useEffect(() => {
    saveSettings(settings);
  }, [settings]);

  useEffect(() => {
    let canceled = false;

    void loadReadingSessionStore()
      .then(({ sessions, serverEnabled }) => {
        if (!canceled) {
          serverReadingSessionsEnabledRef.current = serverEnabled;
          setReadingSessions(sessions);
        }
      })
      .catch((loadError) => {
        console.error(loadError);
      });

    return () => {
      canceled = true;
    };
  }, []);

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
  const stepConfig = useMemo(
    () => getStepConfig(settings),
    [settings.characterChunkSize, settings.chunkSize, settings.stepGroupingMode],
  );
  const currentSentence = sentences[safePosition.sentenceIndex];
  const fallbackDisplayStep = useMemo(
    () =>
      currentSentence
        ? getDisplayStep(currentSentence, safePosition, stepConfig)
        : { startOffset: 0, endOffset: 0, tokenIndexes: [], text: "" },
    [currentSentence, safePosition, stepConfig],
  );
  const fallbackDisplayTokenIndexes = useMemo(
    () => fallbackDisplayStep.tokenIndexes,
    [fallbackDisplayStep],
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
    () => getProgressStats(safePosition, sentences, stepConfig, tokenGroupsBySentenceId),
    [safePosition, sentences, stepConfig, tokenGroupsBySentenceId],
  );
  const currentReadingLocation = useMemo(
    () => getReadingSessionLocation(safePosition, progress),
    [progress, safePosition],
  );
  const displayStep = useMemo(
    () =>
      currentSentence
        ? getDisplayStep(currentSentence, safePosition, stepConfig, migakuTokenGroups)
        : { startOffset: 0, endOffset: 0, tokenIndexes: [], text: "" },
    [currentSentence, safePosition, stepConfig, migakuTokenGroups],
  );
  const displayTokenIndexes = useMemo(
    () => displayStep.tokenIndexes,
    [displayStep],
  );
  const displayTokenKey = `${displayStep.startOffset}:${displayStep.endOffset}:${displayTokenIndexes.join(",")}`;
  const displayText = displayStep.text;
  const stepDelayMs = useMemo(() => getStepDelayMs(settings), [settings.stepsPerMinute]);
  const readingStatsDays = useMemo(
    () => getDailyReadingStats(readingSessions),
    [readingSessions],
  );
  const remainingReadingTimeEstimate = useMemo(
    () =>
      selectedBookId
        ? estimateRemainingReadingTime(readingSessions, selectedBookId, progress)
        : null,
    [progress, readingSessions, selectedBookId],
  );
  const activeStepKey = currentSentence
    ? `${currentSentence.id}:${displayStep.startOffset}:${displayStep.endOffset}:${displayTokenIndexes.join(",")}`
    : "";
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
  }, [activeStepKey]);

  useEffect(() => {
    playbackStepRef.current = {
      sentences,
      stepConfig,
      tokenGroupsBySentenceId,
    };
  }, [sentences, stepConfig, tokenGroupsBySentenceId]);

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

    if (shouldStop && skipStopKey !== activeStepKey) {
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
          playbackStep.stepConfig,
          playbackStep.tokenGroupsBySentenceId,
        );
        if (isSameReaderPosition(next, previous)) {
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
    activeStepKey,
    currentSentence?.id,
    playing,
    shouldStop,
    skipStopKey,
    setPosition,
    stepDelayMs,
  ]);

  useEffect(() => {
    if (!playing || !selectedBookId || !currentSentence) {
      finishReadingSession(Date.now(), { endLocation: currentReadingLocation });
      return;
    }

    updateReadingSessionStep(
      selectedBookId,
      activeStepKey,
      getReadingStepStats(currentSentence, displayStep),
      currentReadingLocation,
    );
  }, [
    activeStepKey,
    currentReadingLocation,
    currentSentence,
    displayStep,
    playing,
    selectedBookId,
  ]);

  useEffect(() => () => {
    finishReadingSession(Date.now(), { updateState: false });
  }, []);

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
      setSkipStopKey(activeStepKey);
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
      advancePosition(previous, sentences, stepConfig, tokenGroupsBySentenceId),
    );
  }

  function goPrevious() {
    setAutoPaused(false);
    stopPlayback();
    setPosition((previous) =>
      retreatPosition(previous, sentences, stepConfig, tokenGroupsBySentenceId),
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
    setPosition(getPositionForProgressUnit(location, sentences, stepConfig));
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

  function updateReadingSessionStep(
    bookId: string,
    stepKey: string,
    stepStats: ReadingStepStats,
    location: ReadingSessionLocation,
  ) {
    const nowMs = Date.now();
    const active = activeReadingSessionRef.current;

    if (!active || active.bookId !== bookId) {
      finishReadingSession(nowMs);
      activeReadingSessionRef.current = {
        id: createReadingSessionId(),
        bookId,
        startedAt: new Date(nowMs).toISOString(),
        startedAtMs: nowMs,
        currentStepKey: stepKey,
        currentStepStartedAtMs: nowMs,
        currentStepStats: stepStats,
        startLocation: location,
        currentLocation: location,
        wordCount: 0,
        characterCount: 0,
      };
      return;
    }

    active.currentLocation = location;

    if (active.currentStepKey === stepKey) {
      return;
    }

    commitActiveReadingStep(nowMs);
    active.currentStepKey = stepKey;
    active.currentStepStartedAtMs = nowMs;
    active.currentStepStats = stepStats;
  }

  function commitActiveReadingStep(nowMs = Date.now()) {
    const active = activeReadingSessionRef.current;
    if (!active || nowMs <= active.currentStepStartedAtMs) {
      return;
    }

    active.wordCount += active.currentStepStats.wordCount;
    active.characterCount += active.currentStepStats.characterCount;
    active.currentStepStartedAtMs = nowMs;
  }

  function finishReadingSession(
    nowMs = Date.now(),
    options: { updateState?: boolean; endLocation?: ReadingSessionLocation } = {},
  ) {
    const active = activeReadingSessionRef.current;
    if (!active) {
      return;
    }

    commitActiveReadingStep(nowMs);
    activeReadingSessionRef.current = null;

    const durationMs = Math.max(0, nowMs - active.startedAtMs);
    if (durationMs < MIN_READING_SESSION_MS) {
      return;
    }

    const session: ReadingSession = {
      id: active.id,
      bookId: active.bookId,
      startedAt: active.startedAt,
      endedAt: new Date(nowMs).toISOString(),
      durationMs,
      wordCount: active.wordCount,
      characterCount: active.characterCount,
      startLocation: active.startLocation,
      endLocation: options.endLocation ?? active.currentLocation,
    };

    if (options.updateState ?? true) {
      setReadingSessions((previous) => [...previous, session]);
    }
    void saveReadingSession(session).catch((saveError) => {
      console.error(saveError);
    });
    if (serverReadingSessionsEnabledRef.current) {
      void saveServerReadingSession(session).catch((saveError) => {
        console.error(saveError);
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
          displayRange={{
            startOffset: displayStep.startOffset,
            endOffset: displayStep.endOffset,
          }}
          displayTokenIndexes={displayTokenIndexes}
          displayTokenKey={displayTokenKey}
          bufferSentences={bufferWindow.sentences}
          migaku={migaku}
          rsvpDisplayRef={rsvpDisplayRef}
          migakuRootRef={migakuRootRef}
          fontSize={settings.fontSize}
          remainingReadingDurationMs={remainingReadingTimeEstimate?.durationMs ?? null}
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
        <aside className="right-rail" aria-label="Reader tools">
          <StatsPanel days={readingStatsDays} />
          <SettingsPanel
            settings={settings}
            isOpen={settingsOpen}
            onToggle={() => setSettingsOpen((previous) => !previous)}
            onChange={updateSettings}
          />
        </aside>
      </div>
    </div>
  );
}

function isSameReaderPosition(
  left: { sentenceIndex: number; tokenIndex: number; characterOffset?: number },
  right: { sentenceIndex: number; tokenIndex: number; characterOffset?: number },
) {
  return (
    left.sentenceIndex === right.sentenceIndex &&
    left.tokenIndex === right.tokenIndex &&
    left.characterOffset === right.characterOffset
  );
}

function createReadingSessionId() {
  if ("randomUUID" in crypto) {
    return crypto.randomUUID();
  }

  return `reading:${Date.now()}:${Math.random().toString(36).slice(2)}`;
}

async function loadReadingSessionStore() {
  const localSessions = await loadReadingSessions();

  if (!(await isServerLibraryEnabled())) {
    return { sessions: localSessions, serverEnabled: false };
  }

  try {
    const serverSessions = await loadServerReadingSessions();
    const serverSessionIds = new Set(serverSessions.map((session) => session.id));
    const localOnlySessions = localSessions.filter((session) => !serverSessionIds.has(session.id));

    if (localOnlySessions.length > 0) {
      void Promise.allSettled(
        localOnlySessions.map((session) => saveServerReadingSession(session)),
      ).then((results) => {
        const failed = results.filter((result) => result.status === "rejected");
        if (failed.length > 0) {
          console.error(`Could not migrate ${failed.length} local reading session(s) to server.`);
        }
      });
    }

    return {
      sessions: mergeReadingSessions(localSessions, serverSessions),
      serverEnabled: true,
    };
  } catch (serverError) {
    console.error(serverError);
    return { sessions: localSessions, serverEnabled: false };
  }
}

function mergeReadingSessions(...sessionGroups: ReadingSession[][]) {
  const sessionsById = new Map<string, ReadingSession>();
  for (const sessions of sessionGroups) {
    for (const session of sessions) {
      sessionsById.set(session.id, session);
    }
  }

  return Array.from(sessionsById.values()).sort(compareReadingSessions);
}

function compareReadingSessions(left: ReadingSession, right: ReadingSession) {
  return left.startedAt.localeCompare(right.startedAt) || left.id.localeCompare(right.id);
}

function getReadingSessionLocation(
  position: { sentenceIndex: number; tokenIndex: number; characterOffset?: number },
  progress: { current: number; total: number },
): ReadingSessionLocation {
  return {
    position: {
      sentenceIndex: position.sentenceIndex,
      tokenIndex: position.tokenIndex,
      characterOffset: position.characterOffset,
    },
    progressCurrent: progress.current,
    progressTotal: progress.total,
  };
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
