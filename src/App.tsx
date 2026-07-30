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
  getBookLookupRateDays,
  getBookLookupStats,
  getBookProgressDays,
  getBookReadingStats,
  getBookSpeedDays,
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
  getPositionForTextMatch,
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
import {
  generateAiRecap,
  generateAiRecapFollowUp,
  generateAiSentenceTranslation,
  getRecapPages,
  type RecapFollowUpHistoryEntry,
  type RecapPage,
} from "./lib/recap";
import { loadSettings, saveSettings } from "./lib/settings";
import {
  isServerLibraryEnabled,
  loadServerAiStatus,
  loadServerLookupEvents,
  loadServerReadingSessions,
  saveServerLookupEvent,
  saveServerReadingSession,
} from "./lib/serverLibrary";
import {
  loadLookupEvents,
  loadReadingSessions,
  saveLookupEvent,
  saveReadingSession,
} from "./lib/storage";
import type {
  Book,
  LookupEvent,
  MigakuTokenStatus,
  ReaderSettings,
  ReadingSession,
  ReadingSessionLocation,
  Sentence,
} from "./types";

const BUFFER_SENTENCES_BEHIND = 10;
const BUFFER_SENTENCES_AHEAD = 30;
const BUFFER_WINDOW_SIZE = 40;
const READING_STATS_DAY_COUNT = 31;
const PLAYBACK_PROGRESS_SAVE_INTERVAL_MS = 5_000;
const IDLE_PROGRESS_SAVE_DELAY_MS = 300;
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
type RecapFollowUpStatus = "loading" | "success" | "error";
type SentenceTranslationStatus = "loading" | "success" | "error";

interface RecapFollowUp {
  id: string;
  status: RecapFollowUpStatus;
  question: string;
  answer: string;
  error: string;
}

interface RecapState {
  status: RecapStatus;
  summary: string;
  error: string;
  sourceLabel: string;
  bookTitle: string;
  pages: RecapPage[];
  followUps: RecapFollowUp[];
}

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
  const [recap, setRecap] = useState<RecapState>(() => createEmptyRecapState());
  const [sentenceTranslations, setSentenceTranslations] = useState<
    Record<string, SentenceTranslation>
  >({});
  const [readingSessions, setReadingSessions] = useState<ReadingSession[]>([]);
  const [lookupEvents, setLookupEvents] = useState<LookupEvent[]>([]);
  const readingSessionsRef = useRef<ReadingSession[]>([]);
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
  const currentReadingLocationRef = useRef<{
    bookId: string;
    location: ReadingSessionLocation;
  } | null>(null);
  const transportActionsRef = useRef<{
    togglePlayback: () => void;
    goNext: () => void;
    goPrevious: () => void;
    goNextSentence: () => void;
    goPreviousSentence: () => void;
  } | null>(null);
  const translationRequestsRef = useRef(new Set<string>());
  const serverReadingSessionsEnabledRef = useRef(false);
  const serverLookupEventsEnabledRef = useRef(false);

  useEffect(() => {
    saveSettings(settings);
  }, [settings]);

  useEffect(() => {
    let canceled = false;

    void loadStatsStores()
      .then(({ sessions, lookupEvents, serverReadingSessionsEnabled, serverLookupEventsEnabled }) => {
        if (!canceled) {
          serverReadingSessionsEnabledRef.current = serverReadingSessionsEnabled;
          serverLookupEventsEnabledRef.current = serverLookupEventsEnabled;
          readingSessionsRef.current = sessions;
          setReadingSessions(sessions);
          setLookupEvents(lookupEvents);
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
        const previousApiUrl = previous.recapApiUrl.trim();
        const usesServerApi =
          previousApiUrl === SERVER_AI_API_URL ||
          (!previousApiUrl && !previous.recapApiKey.trim());
        if (!usesServerApi) {
          return previous;
        }

        return {
          ...previous,
          recapApiUrl: previousApiUrl || status.apiUrl || SERVER_AI_API_URL,
          recapModel: status.recapModel || previous.recapModel,
          translationModel: status.translationModel || previous.translationModel,
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
    [
      settings.characterChunkSize,
      settings.chunkSize,
      settings.maxWordStepCharacters,
      settings.stepGroupingMode,
    ],
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
  currentReadingLocationRef.current = selectedBookId
    ? { bookId: selectedBookId, location: currentReadingLocation }
    : null;
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
    () => getDailyReadingStats(readingSessions, new Date(), READING_STATS_DAY_COUNT),
    [readingSessions],
  );
  const bookReadingStats = useMemo(
    () => getBookReadingStats(readingSessions, selectedBookId),
    [readingSessions, selectedBookId],
  );
  const bookProgressDays = useMemo(
    () =>
      getBookProgressDays(
        readingSessions,
        selectedBookId,
        new Date(),
        READING_STATS_DAY_COUNT,
        getCurrentProgressPercent(progress),
      ),
    [progress, readingSessions, selectedBookId],
  );
  const bookSpeedDays = useMemo(
    () => getBookSpeedDays(readingSessions, selectedBookId, new Date(), READING_STATS_DAY_COUNT),
    [readingSessions, selectedBookId],
  );
  const bookLookupStats = useMemo(
    () => getBookLookupStats(lookupEvents, selectedBookId),
    [lookupEvents, selectedBookId],
  );
  const bookLookupDays = useMemo(
    () =>
      getBookLookupRateDays(
        readingSessions,
        lookupEvents,
        selectedBookId,
        new Date(),
        READING_STATS_DAY_COUNT,
      ),
    [lookupEvents, readingSessions, selectedBookId],
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
    setRecap(createEmptyRecapState());
    setSentenceTranslations({});
    translationRequestsRef.current.clear();
  }, [selectedBookId]);

  useEffect(() => {
    setSentenceTranslations({});
    translationRequestsRef.current.clear();
  }, [settings.recapApiUrl, settings.recapApiKey, settings.recapModel, settings.translationModel]);

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
    if (!playing || !selectedBookId || !currentSentence) {
      return;
    }

    const activeBookId = selectedBookId;
    const timer = window.setInterval(() => {
      const current = currentReadingLocationRef.current;
      if (current?.bookId === activeBookId) {
        saveSelectedBookProgress(current.location.position);
      }
    }, PLAYBACK_PROGRESS_SAVE_INTERVAL_MS);

    return () => window.clearInterval(timer);
  }, [playing, saveSelectedBookProgress, selectedBookId]);

  useEffect(() => {
    if (playing || !selectedBookId || !currentSentence) {
      return;
    }

    const activeBookId = selectedBookId;
    const timer = window.setTimeout(() => {
      const current = currentReadingLocationRef.current;
      if (current?.bookId === activeBookId) {
        saveSelectedBookProgress(current.location.position);
      }
    }, IDLE_PROGRESS_SAVE_DELAY_MS);

    return () => window.clearTimeout(timer);
  }, [
    currentSentence,
    playing,
    safePosition,
    saveSelectedBookProgress,
    selectedBookId,
  ]);

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

  useEffect(() => {
    if (!playing) {
      return;
    }

    function finishForLostFocus() {
      const current = currentReadingLocationRef.current;
      const location = current?.bookId === selectedBookId ? current.location : undefined;
      if (location) {
        saveSelectedBookProgress(location.position);
      }
      finishReadingSession(Date.now(), { endLocation: location });
      setPlaying(false);
    }

    function onVisibilityChange() {
      if (document.hidden) {
        finishForLostFocus();
      }
    }

    document.addEventListener("visibilitychange", onVisibilityChange);
    window.addEventListener("blur", finishForLostFocus);
    window.addEventListener("pagehide", finishForLostFocus);

    return () => {
      document.removeEventListener("visibilitychange", onVisibilityChange);
      window.removeEventListener("blur", finishForLostFocus);
      window.removeEventListener("pagehide", finishForLostFocus);
    };
  }, [playing, saveSelectedBookProgress]);

  useEffect(() => () => {
    finishReadingSession(Date.now(), { updateState: false });
  }, []);

  transportActionsRef.current = {
    togglePlayback,
    goNext,
    goPrevious,
    goNextSentence,
    goPreviousSentence,
  };

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
        transportActionsRef.current?.togglePlayback();
      }
      if (event.code === "ArrowRight") {
        event.preventDefault();
        transportActionsRef.current?.goNext();
      }
      if (event.code === "ArrowLeft") {
        event.preventDefault();
        transportActionsRef.current?.goPrevious();
      }
      if (event.code === "ArrowDown") {
        event.preventDefault();
        transportActionsRef.current?.goNextSentence();
      }
      if (event.code === "ArrowUp") {
        event.preventDefault();
        transportActionsRef.current?.goPreviousSentence();
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  function handleImportFile(file: File) {
    saveCurrentBookProgress();
    stopPlayback();
    void importBook(file);
  }

  function handleSelectBook(book: Book) {
    saveCurrentBookProgress();
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
    const nowMs = finishSessionBeforeManualNavigation();
    const nextPosition = advancePosition(
      safePosition,
      sentences,
      stepConfig,
      tokenGroupsBySentenceId,
    );
    recordProgressCheckpoint(nextPosition, nowMs);
    setPosition(nextPosition);
  }

  function goPrevious() {
    setAutoPaused(false);
    finishSessionBeforeManualNavigation();
    setPosition(retreatPosition(safePosition, sentences, stepConfig, tokenGroupsBySentenceId));
  }

  function goNextSentence() {
    setAutoPaused(false);
    const nowMs = finishSessionBeforeManualNavigation();
    const nextPosition = advanceSentencePosition(
      safePosition,
      sentences,
      tokenGroupsBySentenceId,
    );
    recordProgressCheckpoint(nextPosition, nowMs);
    setPosition(nextPosition);
  }

  function goPreviousSentence() {
    setAutoPaused(false);
    finishSessionBeforeManualNavigation();
    setPosition(retreatSentencePosition(safePosition, sentences, tokenGroupsBySentenceId));
  }

  function beginProgressJump() {
    setAutoPaused(false);
    finishSessionBeforeManualNavigation();
  }

  function jumpToProgressLocation(location: number) {
    setAutoPaused(false);
    const nowMs = finishSessionBeforeManualNavigation();
    const nextPosition = getPositionForProgressUnit(location, sentences, stepConfig);
    recordProgressCheckpoint(nextPosition, nowMs);
    setPosition(nextPosition);
  }

  function jumpToTextMatch(query: string) {
    setAutoPaused(false);
    const nowMs = finishSessionBeforeManualNavigation();

    const match = getPositionForTextMatch(query, sentences, stepConfig);
    if (!match) {
      return false;
    }

    recordProgressCheckpoint(match, nowMs);
    setPosition(match);
    return true;
  }

  async function handleRecap() {
    setAutoPaused(false);
    stopPlayback();

    const pages = getRecapPages(selectedBook, currentSentence);
    const bookTitle = selectedBook?.title ?? "Untitled book";
    const sourceLabel =
      pages.length === 1 ? "1 previous page" : pages.length > 1 ? `${pages.length} previous pages` : "";

    setRecap({
      status: "loading",
      summary: "",
      error: "",
      sourceLabel,
      bookTitle,
      pages,
      followUps: [],
    });

    try {
      const summary = await generateAiRecap({
        settings,
        bookTitle,
        pages,
      });
      setRecap({
        status: "success",
        summary,
        error: "",
        sourceLabel,
        bookTitle,
        pages,
        followUps: [],
      });
    } catch (error) {
      setRecap({
        status: "error",
        summary: "",
        error: error instanceof Error ? error.message : "Could not generate recap.",
        sourceLabel,
        bookTitle,
        pages,
        followUps: [],
      });
    }
  }

  async function handleRecapFollowUp(question: string) {
    const trimmedQuestion = question.trim();
    if (!trimmedQuestion) {
      return;
    }

    setAutoPaused(false);
    stopPlayback();

    const followUpId = createRecapFollowUpId();
    if (
      recap.status !== "success" ||
      !recap.summary.trim() ||
      recap.followUps.some((followUp) => followUp.status === "loading")
    ) {
      return;
    }

    const requestContext: {
      bookTitle: string;
      pages: RecapPage[];
      summary: string;
      history: RecapFollowUpHistoryEntry[];
    } = {
      bookTitle: recap.bookTitle,
      pages: recap.pages,
      summary: recap.summary,
      history: recap.followUps
        .filter((followUp) => followUp.status === "success")
        .map((followUp) => ({
          question: followUp.question,
          answer: followUp.answer,
        })),
    };

    setRecap((previous) => {
      if (
        previous.status !== "success" ||
        !previous.summary.trim() ||
        previous.followUps.some((followUp) => followUp.status === "loading")
      ) {
        return previous;
      }

      return {
        ...previous,
        followUps: [
          ...previous.followUps,
          {
            id: followUpId,
            status: "loading",
            question: trimmedQuestion,
            answer: "",
            error: "",
          },
        ],
      };
    });

    try {
      const answer = await generateAiRecapFollowUp({
        settings,
        bookTitle: requestContext.bookTitle,
        pages: requestContext.pages,
        summary: requestContext.summary,
        history: requestContext.history,
        question: trimmedQuestion,
      });
      setRecap((previous) => ({
        ...previous,
        followUps: previous.followUps.map((followUp) =>
          followUp.id === followUpId
            ? { ...followUp, status: "success", answer, error: "" }
            : followUp,
        ),
      }));
    } catch (error) {
      setRecap((previous) => ({
        ...previous,
        followUps: previous.followUps.map((followUp) =>
          followUp.id === followUpId
            ? {
                ...followUp,
                status: "error",
                answer: "",
                error: error instanceof Error ? error.message : "Could not answer follow-up.",
              }
            : followUp,
        ),
      }));
    }
  }

  function handleMigakuLookup({
    term,
    status,
  }: {
    term: string;
    status?: MigakuTokenStatus;
  }) {
    if (!selectedBookId || !currentSentence) {
      return;
    }

    const event: LookupEvent = {
      id: createLookupEventId(),
      bookId: selectedBookId,
      occurredAt: new Date().toISOString(),
      term,
      status,
      readingSessionId: activeReadingSessionRef.current?.id,
      sentenceId: currentSentence.id,
      position: {
        sentenceIndex: safePosition.sentenceIndex,
        tokenIndex: safePosition.tokenIndex,
        characterOffset: safePosition.characterOffset,
      },
    };

    setLookupEvents((previous) => mergeLookupEvents(previous, [event]));
    void saveLookupEvent(event).catch((saveError) => {
      console.error(saveError);
    });
    if (serverLookupEventsEnabledRef.current) {
      void saveServerLookupEvent(event).catch((saveError) => {
        console.error(saveError);
      });
    }
  }

  function stopPlayback() {
    clearPlaybackTimer();
    setPlaying(false);
  }

  function saveCurrentBookProgress() {
    const current = currentReadingLocationRef.current;
    if (current?.bookId === selectedBookId) {
      saveSelectedBookProgress(current.location.position);
    }
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

  function finishSessionBeforeManualNavigation() {
    const nowMs = Date.now();
    const current = currentReadingLocationRef.current;
    const endLocation = current?.bookId === selectedBookId ? current.location : undefined;
    finishReadingSession(nowMs, { endLocation });
    stopPlayback();
    return nowMs;
  }

  function recordProgressCheckpoint(
    nextPosition: { sentenceIndex: number; tokenIndex: number; characterOffset?: number },
    nowMs = Date.now(),
  ) {
    const current = currentReadingLocationRef.current;
    if (!selectedBookId || current?.bookId !== selectedBookId) {
      return;
    }

    const nextProgress = getProgressStats(
      nextPosition,
      sentences,
      stepConfig,
      tokenGroupsBySentenceId,
    );
    const endLocation = getReadingSessionLocation(nextPosition, nextProgress);
    const furthestProgressCurrent = getFurthestProgressCurrent(
      readingSessionsRef.current,
      selectedBookId,
      endLocation.progressTotal,
    );
    const startLocation = {
      ...current.location,
      progressCurrent: Math.max(
        current.location.progressCurrent,
        furthestProgressCurrent,
      ),
    };
    if (!didReadingSessionAdvance(startLocation, endLocation)) {
      return;
    }

    persistReadingSession({
      id: createProgressCheckpointId(),
      bookId: selectedBookId,
      kind: "progress",
      startedAt: new Date(nowMs).toISOString(),
      endedAt: new Date(nowMs).toISOString(),
      durationMs: 0,
      wordCount: 0,
      characterCount: 0,
      startLocation,
      endLocation,
    });
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

    const endLocation = options.endLocation ?? active.currentLocation;
    if (!didReadingSessionAdvance(active.startLocation, endLocation)) {
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
      endLocation,
    };

    persistReadingSession(session, options.updateState ?? true);
  }

  function persistReadingSession(session: ReadingSession, updateState = true) {
    if (updateState) {
      readingSessionsRef.current = mergeReadingSessions(
        readingSessionsRef.current,
        [session],
      );
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
          recapFollowUps={recap.followUps}
          sentenceSubtitle={sentenceSubtitle}
          sentenceDifficulty={sentenceDifficulty}
          onPrevious={goPrevious}
          onNext={goNext}
          onTogglePlayback={togglePlayback}
          onBeginProgressJump={beginProgressJump}
          onProgressJump={jumpToProgressLocation}
          onBookSearch={jumpToTextMatch}
          onRecap={handleRecap}
          onRecapFollowUp={handleRecapFollowUp}
          onCloseRecap={() => setRecap(createEmptyRecapState())}
          onMigakuLookup={handleMigakuLookup}
        />
        <aside className="right-rail" aria-label="Reader tools">
          <StatsPanel
            days={readingStatsDays}
            bookStats={bookReadingStats}
            bookLookupStats={bookLookupStats}
            bookProgressDays={bookProgressDays}
            bookSpeedDays={bookSpeedDays}
            bookLookupDays={bookLookupDays}
            progressPercent={selectedBookId ? progress.percent : null}
          />
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

function createEmptyRecapState(): RecapState {
  return {
    status: "idle",
    summary: "",
    error: "",
    sourceLabel: "",
    bookTitle: "",
    pages: [],
    followUps: [],
  };
}

function createRecapFollowUpId() {
  if ("randomUUID" in crypto) {
    return `recap-follow-up:${crypto.randomUUID()}`;
  }

  return `recap-follow-up:${Date.now()}:${Math.random().toString(36).slice(2)}`;
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

function createProgressCheckpointId() {
  if ("randomUUID" in crypto) {
    return `progress:${crypto.randomUUID()}`;
  }

  return `progress:${Date.now()}:${Math.random().toString(36).slice(2)}`;
}

function createLookupEventId() {
  if ("randomUUID" in crypto) {
    return `lookup:${crypto.randomUUID()}`;
  }

  return `lookup:${Date.now()}:${Math.random().toString(36).slice(2)}`;
}

async function loadStatsStores() {
  const localSessions = await loadReadingSessions();
  const localLookupEvents = await loadLookupEvents();

  if (!(await isServerLibraryEnabled())) {
    return {
      sessions: localSessions,
      lookupEvents: localLookupEvents,
      serverReadingSessionsEnabled: false,
      serverLookupEventsEnabled: false,
    };
  }

  let sessions = localSessions;
  let lookupEvents = localLookupEvents;
  let serverReadingSessionsEnabled = false;
  let serverLookupEventsEnabled = false;

  try {
    const serverSessions = await loadServerReadingSessions();
    const serverSessionIds = new Set(serverSessions.map((session) => session.id));
    const localOnlySessions = localSessions.filter((session) => !serverSessionIds.has(session.id));

    if (localOnlySessions.length > 0) {
      void migrateLocalReadingSessions(localOnlySessions);
    }

    sessions = mergeReadingSessions(localSessions, serverSessions);
    serverReadingSessionsEnabled = true;
  } catch (serverError) {
    console.error(serverError);
  }

  try {
    const serverLookupEvents = await loadServerLookupEvents();
    const serverLookupEventIds = new Set(serverLookupEvents.map((event) => event.id));
    const localOnlyLookupEvents = localLookupEvents.filter(
      (event) => !serverLookupEventIds.has(event.id),
    );

    if (localOnlyLookupEvents.length > 0) {
      void migrateLocalLookupEvents(localOnlyLookupEvents);
    }

    lookupEvents = mergeLookupEvents(localLookupEvents, serverLookupEvents);
    serverLookupEventsEnabled = true;
  } catch (serverError) {
    console.error(serverError);
  }

  return {
    sessions,
    lookupEvents,
    serverReadingSessionsEnabled,
    serverLookupEventsEnabled,
  };
}

async function migrateLocalReadingSessions(sessions: ReadingSession[]) {
  let failedCount = 0;
  for (const session of sessions) {
    try {
      await saveServerReadingSession(session);
    } catch (error) {
      failedCount += 1;
      console.error(error);
    }
  }

  if (failedCount > 0) {
    console.error(`Could not migrate ${failedCount} local reading session(s) to server.`);
  }
}

async function migrateLocalLookupEvents(events: LookupEvent[]) {
  let failedCount = 0;
  for (const event of events) {
    try {
      await saveServerLookupEvent(event);
    } catch (error) {
      failedCount += 1;
      console.error(error);
    }
  }

  if (failedCount > 0) {
    console.error(`Could not migrate ${failedCount} local lookup event(s) to server.`);
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

function mergeLookupEvents(...eventGroups: LookupEvent[][]) {
  const eventsById = new Map<string, LookupEvent>();
  for (const events of eventGroups) {
    for (const event of events) {
      eventsById.set(event.id, event);
    }
  }

  return Array.from(eventsById.values()).sort(compareLookupEvents);
}

function compareReadingSessions(left: ReadingSession, right: ReadingSession) {
  return left.startedAt.localeCompare(right.startedAt) || left.id.localeCompare(right.id);
}

function compareLookupEvents(left: LookupEvent, right: LookupEvent) {
  return left.occurredAt.localeCompare(right.occurredAt) || left.id.localeCompare(right.id);
}

function getCurrentProgressPercent(progress: { current: number; total: number }) {
  if (progress.total <= 0) {
    return 0;
  }

  const completedBeforeCurrentStep = Math.max(0, progress.current - 1);
  return (completedBeforeCurrentStep / progress.total) * 100;
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

function didReadingSessionAdvance(
  startLocation: ReadingSessionLocation,
  endLocation: ReadingSessionLocation,
) {
  return endLocation.progressCurrent > startLocation.progressCurrent;
}

function getFurthestProgressCurrent(
  sessions: ReadingSession[],
  bookId: string,
  progressTotal: number,
) {
  let furthestProgressCurrent = 0;

  for (const session of sessions) {
    if (session.bookId !== bookId) {
      continue;
    }

    for (const location of [session.startLocation, session.endLocation]) {
      if (location?.progressTotal === progressTotal) {
        furthestProgressCurrent = Math.max(
          furthestProgressCurrent,
          location.progressCurrent,
        );
      }
    }
  }

  return furthestProgressCurrent;
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
