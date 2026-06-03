import type { MigakuTokenStatus, ReaderPosition, ReaderSettings, Sentence, StopMode } from "../types";

export const DEFAULT_SETTINGS: ReaderSettings = {
  wpm: 150,
  fontSize: 64,
  chunkSize: 1,
  punctuationDelayMs: 260,
  stopMode: "unknown",
  theme: "paper",
  recapApiUrl: "",
  recapApiKey: "",
  recapModel: "",
};

export function flattenSentences(book?: { chapters: { sentences: Sentence[] }[] }) {
  return book?.chapters.flatMap((chapter) => chapter.sentences) ?? [];
}

export function clampPosition(position: ReaderPosition, sentences: Sentence[]): ReaderPosition {
  if (sentences.length === 0) {
    return { sentenceIndex: 0, tokenIndex: 0 };
  }

  const sentenceIndex = Math.min(Math.max(position.sentenceIndex, 0), sentences.length - 1);
  const sentence = sentences[sentenceIndex];
  const tokenIndex = Math.min(Math.max(position.tokenIndex, 0), sentence.tokens.length - 1);

  return { sentenceIndex, tokenIndex };
}

export function getDisplayTokens(sentence: Sentence, tokenIndex: number, chunkSize: number) {
  const start = Math.min(tokenIndex, sentence.tokens.length - 1);
  const end = Math.min(start + chunkSize, sentence.tokens.length);
  return sentence.tokens.slice(start, end);
}

export function getDisplayText(sentence: Sentence, tokenIndex: number, chunkSize: number) {
  return getDisplayTokens(sentence, tokenIndex, chunkSize)
    .map((token) => token.text)
    .join("");
}

export function getProgressStats(position: ReaderPosition, sentences: Sentence[]) {
  const total = sentences.reduce((sum, sentence) => sum + sentence.tokens.length, 0);
  if (total === 0) {
    return { current: 0, total: 0, percent: 0 };
  }

  const current = clampPosition(position, sentences);
  const completedBeforeCurrentSentence = sentences
    .slice(0, current.sentenceIndex)
    .reduce((sum, sentence) => sum + sentence.tokens.length, 0);
  const currentToken = completedBeforeCurrentSentence + current.tokenIndex + 1;

  return {
    current: currentToken,
    total,
    percent: Math.round((currentToken / total) * 100),
  };
}

export function advancePosition(
  position: ReaderPosition,
  sentences: Sentence[],
  chunkSize: number,
): ReaderPosition {
  if (sentences.length === 0) {
    return position;
  }

  const current = clampPosition(position, sentences);
  const sentence = sentences[current.sentenceIndex];
  const nextTokenIndex = current.tokenIndex + Math.max(1, chunkSize);

  if (nextTokenIndex < sentence.tokens.length) {
    return { sentenceIndex: current.sentenceIndex, tokenIndex: nextTokenIndex };
  }

  if (current.sentenceIndex + 1 < sentences.length) {
    return { sentenceIndex: current.sentenceIndex + 1, tokenIndex: 0 };
  }

  return { sentenceIndex: current.sentenceIndex, tokenIndex: sentence.tokens.length - 1 };
}

export function retreatPosition(
  position: ReaderPosition,
  sentences: Sentence[],
  chunkSize = 1,
): ReaderPosition {
  if (sentences.length === 0) {
    return position;
  }

  const current = clampPosition(position, sentences);
  const step = Math.max(1, chunkSize);
  if (current.tokenIndex - step >= 0) {
    return { sentenceIndex: current.sentenceIndex, tokenIndex: current.tokenIndex - step };
  }

  if (current.tokenIndex > 0) {
    return { sentenceIndex: current.sentenceIndex, tokenIndex: 0 };
  }

  if (current.sentenceIndex > 0) {
    const previousSentence = sentences[current.sentenceIndex - 1];
    return {
      sentenceIndex: current.sentenceIndex - 1,
      tokenIndex: Math.max(previousSentence.tokens.length - step, 0),
    };
  }

  return current;
}

export function getTokenDelayMs(displayText: string, settings: ReaderSettings) {
  const baseDelay = 60_000 / settings.wpm;
  const punctuationDelay = /[、。！？!?]$/u.test(displayText) ? settings.punctuationDelayMs : 0;
  return Math.max(40, Math.round(baseDelay + punctuationDelay));
}

export function shouldStopForMode(
  stopMode: StopMode,
  statuses: Record<number, MigakuTokenStatus>,
  sentence: Sentence,
  tokenIndex: number,
) {
  return shouldStopForTokenIndexes(stopMode, statuses, sentence, [tokenIndex]);
}

export function shouldStopForTokenIndexes(
  stopMode: StopMode,
  statuses: Record<number, MigakuTokenStatus>,
  sentence: Sentence,
  tokenIndexes: number[],
) {
  if (stopMode === "never") {
    return false;
  }

  const unknownVisibleIndexes = tokenIndexes.filter((tokenIndex) => {
    const activeToken = sentence.tokens[tokenIndex];
    return Boolean(activeToken?.isWordLike && statuses[tokenIndex] === "unknown");
  });

  if (unknownVisibleIndexes.length === 0) {
    return false;
  }

  if (stopMode === "unknown") {
    return true;
  }

  const unknownWordIndexes = sentence.tokens
    .filter((token) => token.isWordLike && statuses[token.index] === "unknown")
    .map((token) => token.index);

  return (
    unknownWordIndexes.length === 1 &&
    unknownVisibleIndexes.includes(unknownWordIndexes[0])
  );
}
