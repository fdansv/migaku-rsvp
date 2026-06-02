import { BookOpen, ChevronLeft, ChevronRight, Pause, Play } from "lucide-react";
import {
  useLayoutEffect,
  useMemo,
  useRef,
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
  onPrevious: () => void;
  onNext: () => void;
  onTogglePlayback: () => void;
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
  onPrevious,
  onNext,
  onTogglePlayback,
}: ReaderPaneProps) {
  const sentenceTrackRef = useRef<HTMLSpanElement>(null);
  const displayTokenIndexSet = useMemo(() => new Set(displayTokenIndexes), [displayTokenIndexes]);
  const progressPercent =
    sentences.length > 0 ? Math.round((safePosition.sentenceIndex / sentences.length) * 100) : 0;
  const activeStatus = getActiveStatus(displayTokenIndexes, migaku.statuses);

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
      track.style.setProperty("--rsvp-track-offset", `${Math.round(offset * 100) / 100}px`);
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
