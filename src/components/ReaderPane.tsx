import {
  BookOpen,
  Check,
  ChevronLeft,
  ChevronRight,
  Pause,
  Play,
  Search,
  Send,
  Sparkles,
  X,
} from "lucide-react";
import {
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type PointerEvent,
  type RefObject,
} from "react";
import type {
  Book,
  MigakuScanResult,
  MigakuTokenMirror,
  MigakuTokenStatus,
  Sentence,
} from "../types";
import { formatReadingDuration } from "../lib/readingStats";
import { getDisplayRenderSegments } from "../lib/rsvp";
import { MigakuSentenceSurface } from "./MigakuSentenceSurface";

interface ReaderPaneProps {
  error: string | null;
  selectedBook: Book | undefined;
  currentSentence: Sentence | undefined;
  progress: {
    current: number;
    total: number;
    percent: number;
  };
  displayText: string;
  displayRange: {
    startOffset: number;
    endOffset: number;
  };
  displayTokenIndexes: number[];
  displayTokenKey: string;
  bufferSentences: Sentence[];
  migaku: MigakuScanResult;
  rsvpDisplayRef: RefObject<HTMLDivElement | null>;
  migakuRootRef: RefObject<HTMLDivElement | null>;
  fontSize: number;
  remainingReadingDurationMs: number | null;
  playing: boolean;
  recapStatus: "idle" | "loading" | "success" | "error";
  recapSummary: string;
  recapError: string;
  recapSourceLabel: string;
  recapFollowUps: RecapFollowUpView[];
  sentenceSubtitle: string;
  sentenceDifficulty: "none" | "i-plus-one" | "beyond-i-plus-one";
  onPrevious: () => void;
  onNext: () => void;
  onTogglePlayback: () => void;
  onBeginProgressJump: () => void;
  onProgressJump: (location: number) => void;
  onBookSearch: (query: string) => boolean;
  onRecap: () => void;
  onRecapFollowUp: (question: string) => void;
  onCloseRecap: () => void;
  onMigakuLookup: (lookup: MigakuLookupDetails) => void;
}

interface MigakuLookupDetails {
  term: string;
  status?: MigakuTokenStatus;
}

interface RecapFollowUpView {
  id: string;
  status: "loading" | "success" | "error";
  question: string;
  answer: string;
  error: string;
}

export function ReaderPane({
  error,
  selectedBook,
  currentSentence,
  progress,
  displayText,
  displayRange,
  displayTokenIndexes,
  displayTokenKey,
  bufferSentences,
  migaku,
  rsvpDisplayRef,
  migakuRootRef,
  fontSize,
  remainingReadingDurationMs,
  playing,
  recapStatus,
  recapSummary,
  recapError,
  recapSourceLabel,
  recapFollowUps,
  sentenceSubtitle,
  sentenceDifficulty,
  onPrevious,
  onNext,
  onTogglePlayback,
  onBeginProgressJump,
  onProgressJump,
  onBookSearch,
  onRecap,
  onRecapFollowUp,
  onCloseRecap,
  onMigakuLookup,
}: ReaderPaneProps) {
  const sentenceTrackRef = useRef<HTMLSpanElement>(null);
  const sentenceScaleRef = useRef<HTMLSpanElement>(null);
  const progressInputRef = useRef<HTMLInputElement>(null);
  const bookSearchInputRef = useRef<HTMLInputElement>(null);
  const [sentenceContextHovered, setSentenceContextHovered] = useState(false);
  const [progressEditing, setProgressEditing] = useState(false);
  const [progressInput, setProgressInput] = useState("");
  const [progressInputInvalid, setProgressInputInvalid] = useState(false);
  const [bookSearchOpen, setBookSearchOpen] = useState(false);
  const [bookSearchInput, setBookSearchInput] = useState("");
  const [bookSearchInvalid, setBookSearchInvalid] = useState(false);
  const [recapFollowUpInput, setRecapFollowUpInput] = useState("");
  const displayTokenIndexSet = useMemo(() => new Set(displayTokenIndexes), [displayTokenIndexes]);
  const recapFollowUpPending = recapFollowUps.some((followUp) => followUp.status === "loading");
  const remainingReadingLabel =
    remainingReadingDurationMs === null ? "" : formatReadingDuration(remainingReadingDurationMs);
  const sentenceContextBefore =
    currentSentence && displayRange.startOffset > 0
      ? currentSentence.text.slice(0, displayRange.startOffset)
      : "";
  const sentenceContextAfter =
    currentSentence && displayRange.endOffset < currentSentence.text.length
      ? currentSentence.text.slice(displayRange.endOffset)
      : "";
  const showSentenceContext = !playing && sentenceContextHovered;
  const displayRenderSegments = useMemo(
    () =>
      currentSentence
        ? getDisplayRenderSegments(
            currentSentence,
            displayRange,
            migaku.parsed ? migaku.tokenGroups : [],
          )
        : [],
    [currentSentence, displayRange, migaku.parsed, migaku.tokenGroups],
  );

  useLayoutEffect(() => {
    if (playing && sentenceContextHovered) {
      setSentenceContextHovered(false);
    }
  }, [playing, sentenceContextHovered]);

  useLayoutEffect(() => {
    if (!progressEditing) {
      return;
    }

    progressInputRef.current?.focus();
    progressInputRef.current?.select();
  }, [progressEditing]);

  useLayoutEffect(() => {
    if (!bookSearchOpen) {
      return;
    }

    bookSearchInputRef.current?.focus();
    bookSearchInputRef.current?.select();
  }, [bookSearchOpen]);

  useLayoutEffect(() => {
    if (recapStatus !== "success") {
      setRecapFollowUpInput("");
    }
  }, [recapStatus]);

  useLayoutEffect(() => {
    const display = rsvpDisplayRef.current;
    const track = sentenceTrackRef.current;
    const scale = sentenceScaleRef.current;
    if (!display || !track || !scale || displayTokenIndexes.length === 0) {
      return;
    }
    const displayElement = display;
    const scaleElement = scale;

    function alignTrack() {
      if (!track) {
        return;
      }

      const activeElements = Array.from(
        scaleElement.querySelectorAll<HTMLElement>('[data-rsvp-visible-token="true"]'),
      );

      if (activeElements.length === 0) {
        track.style.setProperty("--rsvp-track-offset", "0px");
        track.style.setProperty("--rsvp-track-scale", "1");
        return;
      }

      const activeLeft = Math.min(...activeElements.map((element) => element.offsetLeft));
      const activeRight = Math.max(
        ...activeElements.map((element) => element.offsetLeft + element.offsetWidth),
      );
      const activeCenter = activeLeft + (activeRight - activeLeft) / 2;
      const trackCenter = scaleElement.scrollWidth / 2;
      const activeWidth = activeRight - activeLeft;
      const availableWidth = displayElement.clientWidth * 0.96;
      const scale = activeWidth > 0 ? Math.min(1, availableWidth / activeWidth) : 1;
      const offset = (trackCenter - activeCenter) * scale;
      track.style.setProperty("--rsvp-track-offset", `${Math.round(offset)}px`);
      track.style.setProperty("--rsvp-track-scale", String(Number(scale.toFixed(4))));
    }

    alignTrack();
    const animationFrame = window.requestAnimationFrame(alignTrack);
    const resizeObserver =
      "ResizeObserver" in window ? new ResizeObserver(() => alignTrack()) : null;
    resizeObserver?.observe(display);
    resizeObserver?.observe(scale);

    return () => {
      window.cancelAnimationFrame(animationFrame);
      resizeObserver?.disconnect();
    };
  }, [
    currentSentence?.id,
    displayTokenIndexes,
    displayTokenKey,
    fontSize,
    migaku.assignedTokenCount,
    migaku.tokenGroups,
    rsvpDisplayRef,
  ]);

  function handleMigakuTokenPointerUp(event: PointerEvent<HTMLDivElement>) {
    if (!event.isPrimary || (event.pointerType === "mouse" && event.button !== 0)) {
      return;
    }

    const target = event.target instanceof Element ? event.target : null;
    const token = target?.closest<HTMLElement>(".migaku-token[data-mgk-term]");
    if (!token || !event.currentTarget.contains(token)) {
      return;
    }

    const term = token.getAttribute("data-mgk-term")?.trim();
    if (!term) {
      return;
    }

    onMigakuLookup({
      term,
      status: getLookupStatusFromElement(token),
    });
  }

  return (
    <main
      className={`reader${recapStatus === "idle" ? "" : " reader--with-recap"}`}
      aria-live="polite"
    >
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
            <div
              className={`reader-progress${bookSearchOpen ? " reader-progress--search-open" : ""}`}
            >
              {bookSearchOpen ? (
                <form
                  className="book-search-form"
                  noValidate
                  onSubmit={(event) => {
                    event.preventDefault();
                    submitBookSearch();
                  }}
                >
                  <input
                    ref={bookSearchInputRef}
                    className="book-search-input"
                    type="search"
                    aria-label="Search in book"
                    aria-invalid={bookSearchInvalid}
                    placeholder="Search in book"
                    value={bookSearchInput}
                    onChange={(event) => {
                      setBookSearchInput(event.target.value);
                      setBookSearchInvalid(false);
                    }}
                    onKeyDown={(event) => {
                      if (event.key === "Escape") {
                        closeBookSearch();
                      }
                    }}
                  />
                  <button
                    className="book-search-submit"
                    type="submit"
                    aria-label="Find passage"
                    title="Find passage"
                    disabled={!bookSearchInput.trim()}
                  >
                    <Search size={14} aria-hidden="true" />
                  </button>
                  <button
                    className="book-search-close"
                    type="button"
                    aria-label="Close search"
                    title="Close search"
                    onClick={closeBookSearch}
                  >
                    <X size={14} aria-hidden="true" />
                  </button>
                  <span className="book-search-status" role="status">
                    {bookSearchInvalid ? "No match" : ""}
                  </span>
                </form>
              ) : (
                <>
                  <button
                    aria-label="Search in book"
                    className="icon-button book-search-toggle"
                    type="button"
                    title="Search in book"
                    onClick={() => {
                      setBookSearchOpen(true);
                      setBookSearchInvalid(false);
                    }}
                  >
                    <Search size={17} aria-hidden="true" />
                  </button>
                  {progressEditing ? (
                    <form
                      className="progress-jump-form"
                      noValidate
                      onSubmit={(event) => {
                        event.preventDefault();
                        submitProgressJump();
                      }}
                    >
                      <input
                        ref={progressInputRef}
                        className="progress-jump-input"
                        type="text"
                        inputMode="numeric"
                        pattern="[0-9]*"
                        aria-label="Location"
                        aria-invalid={progressInputInvalid}
                        value={progressInput}
                        onChange={(event) => {
                          setProgressInput(event.target.value);
                          setProgressInputInvalid(false);
                        }}
                        onKeyDown={(event) => {
                          if (event.key === "Escape") {
                            setProgressEditing(false);
                            setProgressInputInvalid(false);
                          }
                          if (event.key === "Enter") {
                            event.preventDefault();
                            submitProgressJump();
                          }
                        }}
                      />
                      <button
                        className="progress-jump-submit"
                        type="button"
                        aria-label="Go to location"
                        title="Go to location"
                        onClick={submitProgressJump}
                      >
                        <Check size={14} aria-hidden="true" />
                      </button>
                    </form>
                  ) : (
                    <button
                      key={`${progress.current}:${progress.total}:${progress.percent}`}
                      className={`progress-jump-button${
                        remainingReadingLabel ? " progress-jump-button--with-remaining" : ""
                      }`}
                      type="button"
                      aria-label={`Jump to location, current ${progress.current} of ${progress.total}`}
                      title={`${progress.percent}%${
                        remainingReadingLabel ? ` · ${remainingReadingLabel} left` : ""
                      } · ${progress.current}/${progress.total}`}
                      onClick={beginProgressJump}
                    >
                      <span className="reader-progress-value reader-progress-value--full reader-progress-value--percent">
                        {progress.percent}%
                      </span>
                      {remainingReadingLabel ? (
                        <span
                          className="reader-progress-value reader-progress-value--remaining"
                          aria-hidden="true"
                        >
                          {" "}
                          · {remainingReadingLabel} left
                        </span>
                      ) : null}
                      <span
                        className="reader-progress-value reader-progress-value--location"
                        aria-hidden="true"
                      >
                        {" "}
                        · {progress.current}/{progress.total}
                      </span>
                    </button>
                  )}
                  <button
                    className="recap-button"
                    type="button"
                    disabled={recapStatus === "loading"}
                    aria-busy={recapStatus === "loading"}
                    onClick={onRecap}
                  >
                    <Sparkles size={15} aria-hidden="true" />
                    <span>Recap</span>
                  </button>
                </>
              )}
            </div>
          </div>

          {recapStatus !== "idle" ? (
            <section
              className={`recap-panel recap-panel--${recapStatus}`}
              aria-live="polite"
              aria-label="Recap"
            >
              <div className="recap-panel-header">
                <div>
                  <strong>
                    {recapStatus === "loading"
                      ? "Generating recap"
                      : recapStatus === "error"
                        ? "Recap unavailable"
                        : "Recap"}
                  </strong>
                  {recapSourceLabel ? <span>{recapSourceLabel}</span> : null}
                </div>
                <button
                  aria-label="Close recap"
                  className="icon-button recap-close"
                  type="button"
                  onClick={onCloseRecap}
                  title="Close recap"
                >
                  <X size={16} aria-hidden="true" />
                </button>
              </div>
              <div
                key={`recap:${recapStatus}:${recapSummary}:${recapError}`}
                className="recap-copy recap-text"
                translate="no"
              >
                {recapStatus === "loading"
                  ? "Waiting for the configured AI endpoint."
                  : recapStatus === "error"
                    ? recapError
                    : recapSummary}
              </div>
              {recapStatus === "success" ? (
                <>
                  {recapFollowUps.length > 0 ? (
                    <div className="recap-followups" aria-live="polite">
                      {recapFollowUps.map((followUp) => (
                        <article
                          className="recap-followup"
                          key={`${followUp.id}:${followUp.status}`}
                        >
                          <div className="recap-followup-question">
                            <span className="recap-followup-label">You</span>
                            <div className="recap-copy" translate="no">
                              {followUp.question}
                            </div>
                          </div>
                          <div
                            className={`recap-followup-answer${
                              followUp.status === "error" ? " recap-followup-answer--error" : ""
                            }`}
                          >
                            <span className="recap-followup-label">Answer</span>
                            <div className="recap-copy" translate="no">
                              {followUp.status === "loading"
                                ? "Answering..."
                                : followUp.status === "error"
                                  ? followUp.error
                                  : followUp.answer}
                            </div>
                          </div>
                        </article>
                      ))}
                    </div>
                  ) : null}
                  <form
                    className="recap-followup-form"
                    onSubmit={(event) => {
                      event.preventDefault();
                      submitRecapFollowUp();
                    }}
                  >
                    <input
                      className="recap-followup-input"
                      type="text"
                      aria-label="Follow-up question"
                      placeholder="Ask a follow-up"
                      disabled={recapFollowUpPending}
                      value={recapFollowUpInput}
                      onChange={(event) => setRecapFollowUpInput(event.target.value)}
                    />
                    <button
                      className="recap-followup-send"
                      type="submit"
                      aria-label="Send follow-up"
                      disabled={recapFollowUpPending || !recapFollowUpInput.trim()}
                    >
                      <Send size={15} aria-hidden="true" />
                      <span>Send</span>
                    </button>
                  </form>
                </>
              ) : null}
            </section>
          ) : null}

          <div className="reader-stage">
            <div
              ref={rsvpDisplayRef}
              className={[
                "rsvp-token-display",
                playing ? undefined : "rsvp-token-display--stopped",
                showSentenceContext ? "rsvp-token-display--show-context" : undefined,
                sentenceDifficulty !== "none"
                  ? `rsvp-token-display--${sentenceDifficulty}`
                  : undefined,
              ]
                .filter(Boolean)
                .join(" ")}
              lang="ja"
              data-rsvp-sentence-id={currentSentence.id}
              data-rsvp-display-text={displayText}
              data-rsvp-context-before={sentenceContextBefore}
              data-rsvp-context-after={sentenceContextAfter}
              data-mgk-sentence={currentSentence.text}
              aria-label={displayText}
              onMouseEnter={() => {
                if (!playing) {
                  setSentenceContextHovered(true);
                }
              }}
              onMouseLeave={() => setSentenceContextHovered(false)}
              onPointerUpCapture={handleMigakuTokenPointerUp}
              style={{ "--reader-font-size": `${fontSize}px` } as CSSProperties}
            >
              <span
                ref={sentenceTrackRef}
                className="rsvp-sentence-track"
                data-mgk-sentence={currentSentence.text}
              >
                <span ref={sentenceScaleRef} className="rsvp-sentence-scale">
                  {displayRenderSegments.map((segment) => {
                    const tokenIndexValue = segment.tokenIndexes.join(",");
                    const tokenStatus = getActiveStatus(segment.tokenIndexes, migaku.statuses);
                    const mirror = getGroupMirror(segment.tokenIndexes, migaku.mirrors, tokenStatus);
                    const mirrorAttributes = mirror ? reactDataAttributes(mirror.attributes) : {};
                    const isDisplayToken = segment.isDisplay && segment.tokenIndexes.some((tokenIndex) =>
                      displayTokenIndexSet.has(tokenIndex),
                    );

                    return (
                      <span
                        key={segment.key}
                        className={[
                          "rsvp-display-token",
                          isDisplayToken
                            ? "rsvp-display-token--active"
                            : "rsvp-display-token--context",
                          mirror ? "migaku-token" : undefined,
                          tokenStatus && tokenStatus !== "unparsed"
                            ? `rsvp-display-token--${tokenStatus}`
                            : undefined,
                        ]
                          .filter(Boolean)
                          .join(" ")}
                        data-rsvp-display-token-index={tokenIndexValue}
                        data-rsvp-visible-token={isDisplayToken ? "true" : undefined}
                        data-rsvp-visible-word={
                          isDisplayToken && segment.isWordLike ? "true" : undefined
                        }
                        {...mirrorAttributes}
                        data-mgk-sentence={currentSentence.text}
                      >
                        {segment.text}
                      </span>
                    );
                  })}
                </span>
              </span>
            </div>
            <p className="sentence-subtitle" aria-live="polite">
              {sentenceSubtitle}
            </p>
            <MigakuSentenceSurface
              ref={migakuRootRef}
              activeSentenceId={currentSentence.id}
              sentences={bufferSentences}
            />
          </div>

          <div className="transport">
            <button
              aria-label="Previous"
              className="icon-button"
              type="button"
              onClick={onPrevious}
              title="Previous"
            >
              <ChevronLeft size={22} aria-hidden="true" />
            </button>
            <button className="play-button" type="button" onClick={onTogglePlayback}>
              {playing ? (
                <Pause size={28} aria-hidden="true" />
              ) : (
                <Play size={28} aria-hidden="true" />
              )}
              <span>{playing ? "Pause" : "Play"}</span>
            </button>
            <button
              aria-label="Next"
              className="icon-button"
              type="button"
              onClick={onNext}
              title="Next"
            >
              <ChevronRight size={22} aria-hidden="true" />
            </button>
          </div>

          <progress value={progress.current} max={Math.max(progress.total, 1)} />
        </>
      )}
    </main>
  );

  function beginProgressJump() {
    if (progress.total === 0) {
      return;
    }

    onBeginProgressJump();
    setProgressInput(String(progress.current));
    setProgressInputInvalid(false);
    setProgressEditing(true);
  }

  function submitProgressJump() {
    const location = parseProgressLocation(progressInput, progress.total);
    if (location === null) {
      setProgressInputInvalid(true);
      progressInputRef.current?.focus();
      return;
    }

    onProgressJump(location);
    setProgressEditing(false);
    setProgressInputInvalid(false);
  }

  function submitBookSearch() {
    const query = bookSearchInput.trim();
    if (!query) {
      bookSearchInputRef.current?.focus();
      return;
    }

    const found = onBookSearch(query);
    setBookSearchInvalid(!found);
    if (!found) {
      bookSearchInputRef.current?.focus();
      return;
    }

    setBookSearchOpen(false);
  }

  function closeBookSearch() {
    setBookSearchOpen(false);
    setBookSearchInvalid(false);
  }

  function submitRecapFollowUp() {
    const question = recapFollowUpInput.trim();
    if (!question || recapFollowUpPending) {
      return;
    }

    onRecapFollowUp(question);
    setRecapFollowUpInput("");
  }
}

function parseProgressLocation(input: string, total: number) {
  const trimmed = input.trim();
  if (trimmed === "" || total <= 0 || !/^\d+$/.test(trimmed)) {
    return null;
  }

  return Math.min(Math.max(Number.parseInt(trimmed, 10), 1), total);
}

function getActiveStatus(
  displayTokenIndexes: number[],
  statuses: MigakuScanResult["statuses"],
): MigakuTokenStatus {
  return (
    displayTokenIndexes
      .map((tokenIndex) => statuses[tokenIndex])
      .find((status) => status === "unknown") ??
    displayTokenIndexes.map((tokenIndex) => statuses[tokenIndex]).find(Boolean) ??
    "unparsed"
  );
}

function getLookupStatusFromElement(element: HTMLElement): MigakuTokenStatus | undefined {
  const statusAttribute = element.getAttribute("data-mgk-known-status")?.trim().toLowerCase();
  const attributeStatus = toMigakuTokenStatus(statusAttribute);
  if (attributeStatus) {
    return attributeStatus;
  }

  for (const className of Array.from(element.classList)) {
    const classStatus = toMigakuTokenStatus(
      className.startsWith("rsvp-display-token--")
        ? className.slice("rsvp-display-token--".length)
        : className,
    );
    if (classStatus) {
      return classStatus;
    }
  }

  return undefined;
}

function toMigakuTokenStatus(value: string | undefined): MigakuTokenStatus | undefined {
  if (
    value === "unknown" ||
    value === "seen" ||
    value === "known" ||
    value === "ignored" ||
    value === "tracked" ||
    value === "unparsed"
  ) {
    return value;
  }

  return undefined;
}

function reactDataAttributes(attributes: Record<string, string>) {
  return Object.fromEntries(
    Object.entries(attributes).filter(
      ([name]) => (name.startsWith("data-") || name === "lang") && name !== "data-mgk-sentence",
    ),
  );
}

function getGroupMirror(
  tokenIndexes: number[],
  mirrors: MigakuScanResult["mirrors"],
  status: MigakuTokenStatus,
): MigakuTokenMirror | undefined {
  const groupMirrors = tokenIndexes
    .map((tokenIndex) => mirrors[tokenIndex])
    .filter((mirror): mirror is MigakuTokenMirror => Boolean(mirror));

  return groupMirrors.find((mirror) => mirror.status === status) ?? groupMirrors[0];
}
