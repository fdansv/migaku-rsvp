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
  const span = getStepSpan(sentence, tokenIndex, chunkSize);
  return sentence.tokens.slice(span.start, span.end + 1);
}

export function getDisplayText(sentence: Sentence, tokenIndex: number, chunkSize: number) {
  return getDisplayTokens(sentence, tokenIndex, chunkSize)
    .map((token) => token.text)
    .join("");
}

export function getProgressStats(position: ReaderPosition, sentences: Sentence[], chunkSize = 1) {
  const total = sentences.reduce((sum, sentence) => sum + getProgressUnitCount(sentence), 0);
  if (total === 0) {
    return { current: 0, total: 0, percent: 0 };
  }

  const current = clampPosition(position, sentences);
  const completedBeforeCurrentSentence = sentences
    .slice(0, current.sentenceIndex)
    .reduce((sum, sentence) => sum + getProgressUnitCount(sentence), 0);
  const sentence = sentences[current.sentenceIndex];
  const displayTokens = getDisplayTokens(sentence, current.tokenIndex, chunkSize);
  const currentSentenceProgress = getProgressThroughToken(
    sentence,
    displayTokens.at(-1)?.index ?? current.tokenIndex,
  );
  const currentToken = Math.min(completedBeforeCurrentSentence + currentSentenceProgress, total);

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
  const currentDisplay = getDisplayTokens(sentence, current.tokenIndex, chunkSize);
  const displayEndIndex = currentDisplay.at(-1)?.index ?? current.tokenIndex;
  const nextToken = sentence.tokens.find(
    (token) => token.index > displayEndIndex && token.isWordLike,
  );

  if (nextToken) {
    return { sentenceIndex: current.sentenceIndex, tokenIndex: nextToken.index };
  }

  if (current.sentenceIndex + 1 < sentences.length) {
    return {
      sentenceIndex: current.sentenceIndex + 1,
      tokenIndex: getFirstStepStart(sentences[current.sentenceIndex + 1]),
    };
  }

  return {
    sentenceIndex: current.sentenceIndex,
    tokenIndex: normalizeStepStart(sentence, current.tokenIndex),
  };
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
  const sentence = sentences[current.sentenceIndex];
  const starts = getStepStarts(sentence, chunkSize);
  const currentStart = normalizeStepStart(sentence, current.tokenIndex);
  const startOffset = starts.indexOf(currentStart);

  if (startOffset > 0) {
    return { sentenceIndex: current.sentenceIndex, tokenIndex: starts[startOffset - 1] };
  }

  if (current.sentenceIndex > 0) {
    const previousSentence = sentences[current.sentenceIndex - 1];
    return {
      sentenceIndex: current.sentenceIndex - 1,
      tokenIndex: getLastStepStart(previousSentence, chunkSize),
    };
  }

  return { sentenceIndex: current.sentenceIndex, tokenIndex: currentStart };
}

export function advanceSentencePosition(
  position: ReaderPosition,
  sentences: Sentence[],
): ReaderPosition {
  if (sentences.length === 0) {
    return position;
  }

  const current = clampPosition(position, sentences);
  if (current.sentenceIndex + 1 < sentences.length) {
    return {
      sentenceIndex: current.sentenceIndex + 1,
      tokenIndex: getFirstStepStart(sentences[current.sentenceIndex + 1]),
    };
  }

  return current;
}

export function retreatSentencePosition(
  position: ReaderPosition,
  sentences: Sentence[],
): ReaderPosition {
  if (sentences.length === 0) {
    return position;
  }

  const current = clampPosition(position, sentences);
  if (current.sentenceIndex > 0) {
    return {
      sentenceIndex: current.sentenceIndex - 1,
      tokenIndex: getFirstStepStart(sentences[current.sentenceIndex - 1]),
    };
  }

  return current;
}

export function getTokenDelayMs(displayTokens: Sentence["tokens"], settings: ReaderSettings) {
  const wordCount = Math.max(1, displayTokens.filter((token) => token.isWordLike).length);
  const baseDelay = (60_000 * wordCount) / settings.wpm;
  const punctuationDelay = displayTokens.some((token) => /[、。！？!?]$/u.test(token.text))
    ? settings.punctuationDelayMs
    : 0;
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

function getStepSpan(sentence: Sentence, tokenIndex: number, chunkSize: number) {
  const wordIndexes = getWordLikeTokenIndexes(sentence);
  if (sentence.tokens.length === 0) {
    return { start: 0, end: 0 };
  }
  if (wordIndexes.length === 0) {
    return { start: 0, end: sentence.tokens.length - 1 };
  }

  const startWordIndex = normalizeStepStart(sentence, tokenIndex);
  const startWordOffset = Math.max(
    0,
    wordIndexes.findIndex((index) => index >= startWordIndex),
  );
  const endWordOffset = Math.min(
    startWordOffset + Math.max(1, chunkSize) - 1,
    wordIndexes.length - 1,
  );
  const endWordIndex = wordIndexes[endWordOffset];
  let start = startWordIndex;
  let end = endWordIndex;

  if (!sentence.tokens.some((token) => token.index < startWordIndex && token.isWordLike)) {
    start = 0;
  }

  while (end + 1 < sentence.tokens.length && !sentence.tokens[end + 1].isWordLike) {
    end += 1;
  }

  return { start, end };
}

function getStepStarts(sentence: Sentence, chunkSize: number) {
  const wordIndexes = getWordLikeTokenIndexes(sentence);
  if (wordIndexes.length === 0) {
    return sentence.tokens.length > 0 ? [0] : [];
  }

  const step = Math.max(1, chunkSize);
  const starts: number[] = [];
  for (let index = 0; index < wordIndexes.length; index += step) {
    starts.push(wordIndexes[index]);
  }
  return starts;
}

function getFirstStepStart(sentence: Sentence) {
  return getStepStarts(sentence, 1)[0] ?? 0;
}

function getLastStepStart(sentence: Sentence, chunkSize: number) {
  const starts = getStepStarts(sentence, chunkSize);
  return starts.at(-1) ?? 0;
}

function normalizeStepStart(sentence: Sentence, tokenIndex: number) {
  const clampedTokenIndex = Math.min(
    Math.max(tokenIndex, 0),
    Math.max(sentence.tokens.length - 1, 0),
  );
  const currentToken = sentence.tokens[clampedTokenIndex];
  if (!currentToken) {
    return 0;
  }
  if (!sentence.tokens.some((token) => token.isWordLike)) {
    return 0;
  }
  if (currentToken.isWordLike) {
    return currentToken.index;
  }

  const previousWord = [...sentence.tokens]
    .slice(0, clampedTokenIndex + 1)
    .reverse()
    .find((token) => token.isWordLike);
  if (previousWord) {
    return previousWord.index;
  }

  const nextWord = sentence.tokens.slice(clampedTokenIndex + 1).find((token) => token.isWordLike);
  return nextWord?.index ?? currentToken.index;
}

function getWordLikeTokenIndexes(sentence: Sentence) {
  return sentence.tokens.filter((token) => token.isWordLike).map((token) => token.index);
}

function getProgressUnitCount(sentence: Sentence) {
  const wordCount = sentence.tokens.filter((token) => token.isWordLike).length;
  return wordCount > 0 ? wordCount : sentence.tokens.length;
}

function getProgressThroughToken(sentence: Sentence, tokenIndex: number) {
  const wordCount = sentence.tokens.filter(
    (token) => token.index <= tokenIndex && token.isWordLike,
  ).length;
  if (wordCount > 0) {
    return wordCount;
  }

  return Math.min(tokenIndex + 1, sentence.tokens.length);
}
