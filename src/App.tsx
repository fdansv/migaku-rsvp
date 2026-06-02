import {
  BookOpen,
  ChevronLeft,
  ChevronRight,
  Pause,
  Play,
  Settings2,
  Trash2,
  Upload,
} from "lucide-react";
import {
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type DragEvent as ReactDragEvent,
  type FormEvent,
} from "react";
import { MigakuSentenceSurface } from "./components/MigakuSentenceSurface";
import { parseEpub } from "./lib/epub";
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
import { deleteBook, loadBooks, saveBook } from "./lib/storage";
import { CURRENT_TOKENIZER_VERSION, tokenizeJapanese, warmJapaneseTokenizer } from "./lib/text";
import type { Book, ReaderPosition, ReaderSettings } from "./types";

const BUFFER_SENTENCES_BEHIND = 20;
const BUFFER_SENTENCES_AHEAD = 100;
const BUFFER_WINDOW_SIZE = 40;

function hasDraggedFiles(dataTransfer: DataTransfer) {
  return Array.from(dataTransfer.types).includes("Files");
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

export function App() {
  const [books, setBooks] = useState<Book[]>([]);
  const [selectedBookId, setSelectedBookId] = useState<string | null>(null);
  const [settings, setSettings] = useState<ReaderSettings>(() => loadSettings());
  const [position, setPosition] = useState<ReaderPosition>({ sentenceIndex: 0, tokenIndex: 0 });
  const [playing, setPlaying] = useState(false);
  const [autoPaused, setAutoPaused] = useState(false);
  const [skipStopKey, setSkipStopKey] = useState<string | null>(null);
  const [isImporting, setIsImporting] = useState(false);
  const [isFileDragActive, setIsFileDragActive] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileDragDepthRef = useRef(0);
  const migakuRootRef = useRef<HTMLDivElement>(null);
  const rsvpDisplayRef = useRef<HTMLDivElement>(null);
  const sentenceTrackRef = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    let cancelled = false;
    warmJapaneseTokenizer();
    loadBooks()
      .then(async (storedBooks) => {
        if (cancelled) {
          return;
        }
        const upgradedBooks = await Promise.all(storedBooks.map(upgradeBookTokenization));
        setBooks(upgradedBooks);
        if (upgradedBooks[0]) {
          setSelectedBookId(upgradedBooks[0].id);
          setPosition(upgradedBooks[0].progress);
        }
      })
      .catch((loadError: unknown) => {
        setError(loadError instanceof Error ? loadError.message : "Could not load stored books.");
      });

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    saveSettings(settings);
  }, [settings]);

  const selectedBook = books.find((book) => book.id === selectedBookId);
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
  const displayTokenIndexSet = useMemo(() => new Set(displayTokenIndexes), [displayTokenIndexes]);
  const bufferAnchor = Math.floor(safePosition.sentenceIndex / BUFFER_WINDOW_SIZE);
  const bufferWindow = useMemo(() => {
    const blockStart = bufferAnchor * BUFFER_WINDOW_SIZE;
    const start = Math.max(0, blockStart - BUFFER_SENTENCES_BEHIND);
    const end = Math.min(
      sentences.length,
      blockStart + BUFFER_WINDOW_SIZE + BUFFER_SENTENCES_AHEAD,
    );

    return {
      key: `${selectedBook?.id ?? "no-book"}:${start}:${end}`,
      sentences: sentences.slice(start, end),
    };
  }, [bufferAnchor, selectedBook?.id, sentences]);
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
      displayTokens.map((token) => token.index),
    );

  useEffect(() => {
    setPosition((previous) => clampPosition(previous, sentences));
  }, [sentences]);

  useEffect(() => {
    setAutoPaused(false);
    setSkipStopKey(null);
  }, [activeKey]);

  useEffect(() => {
    if (!selectedBookId || !currentSentence) {
      return;
    }

    const timer = window.setTimeout(() => {
      setBooks((currentBooks) => {
        const book = currentBooks.find((candidate) => candidate.id === selectedBookId);
        if (
          !book ||
          (book.progress.sentenceIndex === safePosition.sentenceIndex &&
            book.progress.tokenIndex === safePosition.tokenIndex)
        ) {
          return currentBooks;
        }

        const updatedBook = { ...book, progress: safePosition };
        void saveBook(updatedBook);
        return currentBooks.map((candidate) =>
          candidate.id === selectedBookId ? updatedBook : candidate,
        );
      });
    }, 300);

    return () => window.clearTimeout(timer);
  }, [selectedBookId, currentSentence, safePosition.sentenceIndex, safePosition.tokenIndex]);

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
  ]);

  useLayoutEffect(() => {
    const display = rsvpDisplayRef.current;
    const track = sentenceTrackRef.current;
    if (!display || !track || displayTokenIndexes.length === 0) {
      return;
    }

    function alignTrack() {
      if (!track) {
        return;
      }

      const activeElements = displayTokenIndexes
        .map((tokenIndex) =>
          track.querySelector<HTMLElement>(
            `[data-rsvp-display-token-index="${tokenIndex}"]`,
          ),
        )
        .filter((element): element is HTMLElement => Boolean(element));

      if (activeElements.length === 0) {
        track.style.setProperty("--rsvp-track-offset", "0px");
        return;
      }

      const activeLeft = Math.min(...activeElements.map((element) => element.offsetLeft));
      const activeRight = Math.max(
        ...activeElements.map((element) => element.offsetLeft + element.offsetWidth),
      );
      const activeCenter = activeLeft + (activeRight - activeLeft) / 2;
      const trackCenter = track.scrollWidth / 2;
      const offset = trackCenter - activeCenter;
      track.style.setProperty("--rsvp-track-offset", `${Math.round(offset * 100) / 100}px`);
    }

    alignTrack();
    const animationFrame = window.requestAnimationFrame(alignTrack);
    const resizeObserver =
      "ResizeObserver" in window
        ? new ResizeObserver(() => alignTrack())
        : null;
    resizeObserver?.observe(display);
    resizeObserver?.observe(track);

    return () => {
      window.cancelAnimationFrame(animationFrame);
      resizeObserver?.disconnect();
    };
  }, [currentSentence?.id, displayTokenKey, displayTokenIndexes, settings.fontSize, migaku.assignedTokenCount]);

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

  async function importBook(file: File) {
    setError(null);
    setIsImporting(true);
    setPlaying(false);
    try {
      const book = await parseEpub(file);
      await saveBook(book);
      setBooks((currentBooks) => [book, ...currentBooks.filter((candidate) => candidate.id !== book.id)]);
      setSelectedBookId(book.id);
      setPosition(book.progress);
    } catch (importError) {
      setError(importError instanceof Error ? importError.message : "Could not import this EPUB.");
    } finally {
      setIsImporting(false);
    }
  }

  async function upgradeBookTokenization(book: Book) {
    if (book.tokenizerVersion === CURRENT_TOKENIZER_VERSION) {
      return book;
    }

    const chapters = await Promise.all(
      book.chapters.map(async (chapter) => ({
        ...chapter,
        sentences: await Promise.all(
          chapter.sentences.map(async (sentence) => ({
            ...sentence,
            tokens: await tokenizeJapanese(sentence.text, sentence.id),
          })),
        ),
      })),
    );
    const upgradedBook = { ...book, chapters, tokenizerVersion: CURRENT_TOKENIZER_VERSION };
    await saveBook(upgradedBook);
    return upgradedBook;
  }

  function selectBook(book: Book) {
    setSelectedBookId(book.id);
    setPosition(book.progress);
    setPlaying(false);
  }

  async function removeBook(bookId: string) {
    setPlaying(false);
    await deleteBook(bookId);
    setBooks((currentBooks) => {
      const nextBooks = currentBooks.filter((book) => book.id !== bookId);
      if (selectedBookId === bookId) {
        setSelectedBookId(nextBooks[0]?.id ?? null);
        setPosition(nextBooks[0]?.progress ?? { sentenceIndex: 0, tokenIndex: 0 });
      }
      return nextBooks;
    });
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

  function resetFileDrag() {
    fileDragDepthRef.current = 0;
    setIsFileDragActive(false);
  }

  function onFileDragEnter(event: ReactDragEvent<HTMLDivElement>) {
    if (!hasDraggedFiles(event.dataTransfer)) {
      return;
    }

    event.preventDefault();
    fileDragDepthRef.current += 1;
    setIsFileDragActive(true);
  }

  function onFileDragOver(event: ReactDragEvent<HTMLDivElement>) {
    if (!hasDraggedFiles(event.dataTransfer)) {
      return;
    }

    event.preventDefault();
    event.dataTransfer.dropEffect = isImporting ? "none" : "copy";
    setIsFileDragActive(true);
  }

  function onFileDragLeave(event: ReactDragEvent<HTMLDivElement>) {
    if (!hasDraggedFiles(event.dataTransfer)) {
      return;
    }

    fileDragDepthRef.current = Math.max(0, fileDragDepthRef.current - 1);
    if (fileDragDepthRef.current === 0) {
      setIsFileDragActive(false);
    }
  }

  function onFileDrop(event: ReactDragEvent<HTMLDivElement>) {
    if (!hasDraggedFiles(event.dataTransfer)) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();
    resetFileDrag();

    if (isImporting) {
      return;
    }

    const file = event.dataTransfer.files[0];
    if (file) {
      void importBook(file);
    }
  }

  const progressPercent =
    sentences.length > 0 ? Math.round((safePosition.sentenceIndex / sentences.length) * 100) : 0;
  const activeStatus =
    displayTokenIndexes
      .map((tokenIndex) => migaku.statuses[tokenIndex])
      .find((status) => status === "unknown") ??
    displayTokenIndexes.map((tokenIndex) => migaku.statuses[tokenIndex]).find(Boolean) ??
    "unparsed";

  function reactDataAttributes(attributes: Record<string, string>) {
    return Object.fromEntries(
      Object.entries(attributes).filter(
        ([name]) => (name.startsWith("data-") || name === "lang") && name !== "data-mgk-sentence",
      ),
    );
  }

  return (
    <div
      className="app"
      data-theme={settings.theme}
      onDragEnter={onFileDragEnter}
      onDragOver={onFileDragOver}
      onDragLeave={onFileDragLeave}
      onDrop={onFileDrop}
    >
      {isFileDragActive ? (
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
      ) : null}
      <header className="topbar">
        <div className="brand">
          <BookOpen size={22} aria-hidden="true" />
          <span>Migaku RSVP</span>
        </div>
        <div className="topbar-actions">
          <span
            key={`migaku-${migaku.parsed}-${migaku.timedOut}`}
            className={`migaku-pill${migaku.parsed ? " is-ready" : ""}`}
          >
            Migaku {migaku.parsed ? "parsed" : migaku.timedOut ? "idle" : "waiting"}
          </span>
          <label className="icon-button import-button" title="Import EPUB">
            <Upload size={18} aria-hidden="true" />
            <span>{isImporting ? "Importing" : "Import"}</span>
            <input
              type="file"
              accept=".epub,application/epub+zip"
              disabled={isImporting}
              onChange={(event) => {
                const file = event.target.files?.[0];
                event.currentTarget.value = "";
                if (file) {
                  void importBook(file);
                }
              }}
            />
          </label>
        </div>
      </header>

      <div className="shell">
        <aside className="library" aria-label="Library">
          <div className="section-title">Library</div>
          {books.length === 0 ? (
            <p className="empty-note">Import an EPUB to begin.</p>
          ) : (
            <div className="book-list">
              {books.map((book) => (
                <div
                  key={book.id}
                  className={`book-row${book.id === selectedBookId ? " is-selected" : ""}`}
                >
                  <button className="book-select" onClick={() => selectBook(book)} type="button">
                    <strong>{book.title}</strong>
                    <small>{book.author ?? book.fileName}</small>
                  </button>
                  <button
                    className="delete-button"
                    aria-label="Delete book"
                    title="Delete book"
                    type="button"
                    onClick={() => void removeBook(book.id)}
                  >
                    <Trash2 size={16} aria-hidden="true" />
                  </button>
                </div>
              ))}
            </div>
          )}
        </aside>

        <main className="reader" aria-live="polite">
          {error ? <div className="error-banner">{error}</div> : null}

          {!currentSentence ? (
            <div className="empty-reader">
              <BookOpen size={34} aria-hidden="true" />
              <p>No book loaded.</p>
            </div>
          ) : (
            <>
              <div className="reader-meta">
                <span>{selectedBook?.title}</span>
                <span>
                  {progressPercent}% · {safePosition.sentenceIndex + 1}/{sentences.length}
                </span>
              </div>

              <div className="reader-stage">
                <div
                  ref={rsvpDisplayRef}
                  className="rsvp-token-display"
                  lang="ja"
                  data-rsvp-sentence-id={currentSentence.id}
                  data-rsvp-display-text={displayText}
                  data-mgk-sentence={currentSentence.text}
                  aria-label={displayText}
                  style={{ "--reader-font-size": `${settings.fontSize}px` } as CSSProperties}
                >
                  <span
                    ref={sentenceTrackRef}
                    className="rsvp-sentence-track"
                    data-mgk-sentence={currentSentence.text}
                  >
                    {currentSentence.tokens.map((token) => {
                      const mirror = migaku.mirrors[token.index];
                      const mirrorAttributes = mirror ? reactDataAttributes(mirror.attributes) : {};
                      const isDisplayToken = displayTokenIndexSet.has(token.index);
                      const tokenStatus = migaku.statuses[token.index];

                      return (
                        <span
                          key={token.id}
                          className={[
                            "rsvp-display-token",
                            isDisplayToken
                              ? "rsvp-display-token--active"
                              : "rsvp-display-token--context",
                            mirror?.className,
                            tokenStatus && tokenStatus !== "unparsed"
                              ? `rsvp-display-token--${tokenStatus}`
                              : undefined,
                          ]
                            .filter(Boolean)
                            .join(" ")}
                          data-rsvp-display-token-index={token.index}
                          data-rsvp-visible-token={isDisplayToken ? "true" : undefined}
                          {...mirrorAttributes}
                          data-mgk-sentence={currentSentence.text}
                        >
                          {token.text}
                        </span>
                      );
                    })}
                  </span>
                </div>
                <MigakuSentenceSurface
                  ref={migakuRootRef}
                  activeSentenceId={currentSentence.id}
                  sentences={bufferWindow.sentences}
                />
              </div>

              <div
                key={`status-${activeStatus}-${playing}-${autoPaused}`}
                className="status-strip"
              >
                <span>Token: {activeStatus}</span>
                <span>{autoPaused ? "Paused on stop rule" : playing ? "Reading" : "Paused"}</span>
              </div>

              <div className="transport">
                <button
                  aria-label="Previous"
                  className="icon-button"
                  type="button"
                  onClick={goPrevious}
                  title="Previous"
                >
                  <ChevronLeft size={22} aria-hidden="true" />
                </button>
                <button className="play-button" type="button" onClick={togglePlayback}>
                  {playing ? <Pause size={28} aria-hidden="true" /> : <Play size={28} aria-hidden="true" />}
                  <span>{playing ? "Pause" : "Play"}</span>
                </button>
                <button
                  aria-label="Next"
                  className="icon-button"
                  type="button"
                  onClick={goNext}
                  title="Next"
                >
                  <ChevronRight size={22} aria-hidden="true" />
                </button>
              </div>

              <progress value={safePosition.sentenceIndex} max={Math.max(sentences.length - 1, 1)} />
            </>
          )}
        </main>

        <aside className="settings" aria-label="Reader settings">
          <div className="section-title">
            <Settings2 size={17} aria-hidden="true" />
            Settings
          </div>
          <RangeSetting
            label="Speed"
            min={80}
            max={600}
            step={10}
            value={settings.wpm}
            format={(value) => `${value} wpm`}
            onValue={(value) => updateSettings({ wpm: value })}
          />
          <RangeSetting
            label="Font"
            min={36}
            max={96}
            step={2}
            value={settings.fontSize}
            format={(value) => `${value}px`}
            onValue={(value) => updateSettings({ fontSize: value })}
          />
          <RangeSetting
            label="Words"
            min={1}
            max={4}
            step={1}
            value={settings.chunkSize}
            format={(value) => String(value)}
            onValue={(value) => updateSettings({ chunkSize: value })}
          />
          <label>
            Pause
            <select
              value={settings.stopMode}
              onChange={(event) =>
                updateSettings({ stopMode: event.currentTarget.value as ReaderSettings["stopMode"] })
              }
            >
              <option value="unknown">Unknown</option>
              <option value="never">Never</option>
              <option value="i+1">i+1</option>
            </select>
          </label>
          <RangeSetting
            label="Punctuation"
            min={0}
            max={1200}
            step={20}
            value={settings.punctuationDelayMs}
            format={(value) => `${value}ms`}
            onValue={(value) => updateSettings({ punctuationDelayMs: value })}
          />
          <label>
            Theme
            <select
              value={settings.theme}
              onChange={(event) =>
                updateSettings({ theme: event.currentTarget.value as ReaderSettings["theme"] })
              }
            >
              <option value="paper">Paper</option>
              <option value="dark">Dark</option>
              <option value="contrast">Contrast</option>
            </select>
          </label>
        </aside>
      </div>
    </div>
  );
}
