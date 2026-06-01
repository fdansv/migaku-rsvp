import { forwardRef, memo, type ForwardedRef } from "react";
import type { Sentence } from "../types";

interface MigakuSentenceSurfaceProps {
  activeSentenceId: string;
  sentences: Sentence[];
}

function MigakuSentenceSurfaceBase(
  { activeSentenceId, sentences }: MigakuSentenceSurfaceProps,
  ref: ForwardedRef<HTMLDivElement>,
) {
  return (
    <div ref={ref} className="migaku-buffer-surface" lang="ja">
      {sentences.map((sentence) => (
        <p
          key={sentence.id}
          className={sentence.id === activeSentenceId ? "is-active-sentence" : undefined}
          data-rsvp-sentence-id={sentence.id}
          data-mgk-sentence={sentence.text}
        >
          {sentence.text}
        </p>
      ))}
    </div>
  );
}

export const MigakuSentenceSurface = memo(
  forwardRef(MigakuSentenceSurfaceBase),
  (previous, next) =>
    previous.activeSentenceId === next.activeSentenceId &&
    previous.sentences.length === next.sentences.length &&
    previous.sentences[0]?.id === next.sentences[0]?.id &&
    previous.sentences.at(-1)?.id === next.sentences.at(-1)?.id,
);
