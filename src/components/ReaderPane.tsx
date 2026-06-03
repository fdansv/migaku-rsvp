import { BookOpen, ChevronLeft, ChevronRight, Pause, Play, Sparkles, X } from "lucide-react";
import {
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type RefObject,
} from "react";
import type {
  Book,
  MigakuScanResult,
  MigakuTokenStatus,
  ReaderPosition,
  Sentence,
} from "../types";
import { MigakuSentenceSurface } from "./MigakuSentenceSurface";

interface ReaderPaneProps {
  error: string | null;
  selectedBook: Book | undefined;
  currentSentence: Sentence | undefined;
  sentences: Sentence[];
  safePosition: ReaderPosition;
  displayText: string;
  displayTokenIndexes: number[];
  displayTokenKey: string;
  bufferSentences: Sentence[];
  migaku: MigakuScanResult;
  rsvpDisplayRef: RefObject<HTMLDivElement | null>;
  migakuRootRef: RefObject<HTMLDivElement | null>;
  fontSize: number;
  playing: boolean;
  autoPaused: boolean;
  recapStatus: "idle" | "loading" | "success" | "error";
  recapSummary: string;
  recapError: string;
  recapSourceLabel: string;
  onPrevious: () => void;
  onNext: () => void;
  onTogglePlayback: () => void;
  onRecap: () => void;
  onCloseRecap: () => void;
}

export function ReaderPane({
  error,
  selectedBook,
  currentSentence,
  sentences,
  safePosition,
  displayText,
  displayTokenIndexes,
  displayTokenKey,
  bufferSentences,
  migaku,
  rsvpDisplayRef,
  migakuRootRef,
  fontSize,
  playing,
  autoPaused,
  recapStatus,
  recapSummary,
  recapError,
  recapSourceLabel,
  onPrevious,
  onNext,
  onTogglePlayback,
  onRecap,
  onCloseRecap,
}: ReaderPaneProps) {
  const sentenceTrackRef = useRef<HTMLSpanElement>(null);
  const [sentenceContextHovered, setSentenceContextHovered] = useState(false);
  const displayTokenIndexSet = useMemo(() => new Set(displayTokenIndexes), [displayTokenIndexes]);
  const displayStartTokenIndex =
    displayTokenIndexes.length > 0 ? Math.min(...displayTokenIndexes) : -1;
  const displayEndTokenIndex =
    displayTokenIndexes.length > 0 ? Math.max(...displayTokenIndexes) : -1;
  const sentenceContextBefore =
    currentSentence && displayStartTokenIndex > 0
      ? currentSentence.tokens
          .slice(0, displayStartTokenIndex)
          .map((token) => token.text)
          .join("")
      : "";
  const sentenceContextAfter =
    currentSentence && displayEndTokenIndex >= 0
      ? currentSentence.tokens
          .slice(displayEndTokenIndex + 1)
          .map((token) => token.text)
          .join("")
      : "";
  const showSentenceContext = !playing && sentenceContextHovered;
  const progressPercent =
    sentences.length > 0 ? Math.round((safePosition.sentenceIndex / sentences.length) * 100) : 0;
  const activeStatus = getActiveStatus(displayTokenIndexes, migaku.statuses);

  useLayoutEffect(() => {
    if (playing && sentenceContextHovered) {
      setSentenceContextHovered(false);
    }
  }, [playing, sentenceContextHovered]);

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
          track.querySelector<HTMLElement>(`[data-rsvp-display-token-index="${tokenIndex}"]`),
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
      track.style.setProperty("--rsvp-track-offset", `${Math.round(offset)}px`);
    }

    alignTrack();
    const animationFrame = window.requestAnimationFrame(alignTrack);
    const resizeObserver =
      "ResizeObserver" in window ? new ResizeObserver(() => alignTrack()) : null;
    resizeObserver?.observe(display);
    resizeObserver?.observe(track);

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
    rsvpDisplayRef,
  ]);

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
            <div className="reader-progress">
              <span>
                {progressPercent}% · {safePosition.sentenceIndex + 1}/{sentences.length}
              </span>
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
              <p className="recap-text">
                {recapStatus === "loading"
                  ? "Waiting for the configured AI endpoint."
                  : recapStatus === "error"
                    ? recapError
                    : recapSummary}
              </p>
            </section>
          ) : null}

          <div className="reader-stage">
            <div
              ref={rsvpDisplayRef}
              className={[
                "rsvp-token-display",
                playing ? undefined : "rsvp-token-display--stopped",
                showSentenceContext ? "rsvp-token-display--show-context" : undefined,
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
              style={{ "--reader-font-size": `${fontSize}px` } as CSSProperties}
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
                        mirror ? "migaku-token" : undefined,
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
              sentences={bufferSentences}
            />
          </div>

          <div key={`status-${activeStatus}-${playing}-${autoPaused}`} className="status-strip">
            <span>Token: {activeStatus}</span>
            <span>{autoPaused ? "Paused on stop rule" : playing ? "Reading" : "Paused"}</span>
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

          <progress value={safePosition.sentenceIndex} max={Math.max(sentences.length - 1, 1)} />
        </>
      )}
    </main>
  );
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

function reactDataAttributes(attributes: Record<string, string>) {
  return Object.fromEntries(
    Object.entries(attributes).filter(
      ([name]) => (name.startsWith("data-") || name === "lang") && name !== "data-mgk-sentence",
    ),
  );
}
