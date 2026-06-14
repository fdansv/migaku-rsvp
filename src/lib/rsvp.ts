import type { MigakuTokenStatus, ReaderPosition, ReaderSettings, Sentence, StopMode } from "../types";

export type TokenGroups = number[][];
export type TokenGroupsBySentenceId = Record<string, TokenGroups | undefined>;

export const DEFAULT_SETTINGS: ReaderSettings = {
  stepDurationMs: 400,
  fontSize: 64,
  chunkSize: 1,
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

export function getDisplayTokens(
  sentence: Sentence,
  tokenIndex: number,
  chunkSize: number,
  tokenGroups: TokenGroups = [],
) {
  const span = getStepSpan(sentence, tokenIndex, chunkSize, tokenGroups);
  return sentence.tokens.slice(span.start, span.end + 1);
}

export function getDisplayText(
  sentence: Sentence,
  tokenIndex: number,
  chunkSize: number,
  tokenGroups: TokenGroups = [],
) {
  return getDisplayTokens(sentence, tokenIndex, chunkSize, tokenGroups)
    .map((token) => token.text)
    .join("");
}

export function getProgressStats(
  position: ReaderPosition,
  sentences: Sentence[],
  chunkSize = 1,
  tokenGroupsBySentenceId: TokenGroupsBySentenceId = {},
) {
  const total = sentences.reduce(
    (sum, sentence) =>
      sum + getProgressUnitCount(sentence, getTokenGroupsForSentence(sentence, tokenGroupsBySentenceId)),
    0,
  );
  if (total === 0) {
    return { current: 0, total: 0, percent: 0 };
  }

  const current = clampPosition(position, sentences);
  const completedBeforeCurrentSentence = sentences
    .slice(0, current.sentenceIndex)
    .reduce(
      (sum, sentence) =>
        sum + getProgressUnitCount(sentence, getTokenGroupsForSentence(sentence, tokenGroupsBySentenceId)),
      0,
    );
  const sentence = sentences[current.sentenceIndex];
  const tokenGroups = getTokenGroupsForSentence(sentence, tokenGroupsBySentenceId);
  const displayTokens = getDisplayTokens(sentence, current.tokenIndex, chunkSize, tokenGroups);
  const currentSentenceProgress = getProgressThroughToken(
    sentence,
    displayTokens.at(-1)?.index ?? current.tokenIndex,
    tokenGroups,
  );
  const currentToken = Math.min(completedBeforeCurrentSentence + currentSentenceProgress, total);

  return {
    current: currentToken,
    total,
    percent: Math.round((currentToken / total) * 100),
  };
}

export function getPositionForProgressUnit(
  location: number,
  sentences: Sentence[],
  chunkSize = 1,
): ReaderPosition {
  const total = sentences.reduce((sum, sentence) => sum + getProgressUnitCount(sentence), 0);
  if (total === 0) {
    return { sentenceIndex: 0, tokenIndex: 0 };
  }

  let remainingLocation = Math.min(Math.max(Math.round(location), 1), total);
  const normalizedChunkSize = Math.max(1, Math.round(chunkSize));

  for (let sentenceIndex = 0; sentenceIndex < sentences.length; sentenceIndex += 1) {
    const sentence = sentences[sentenceIndex];
    const sentenceUnits = getProgressUnitCount(sentence);
    if (remainingLocation > sentenceUnits) {
      remainingLocation -= sentenceUnits;
      continue;
    }

    return {
      sentenceIndex,
      tokenIndex: getTokenIndexForProgressUnit(sentence, remainingLocation, normalizedChunkSize),
    };
  }

  const lastSentenceIndex = Math.max(sentences.length - 1, 0);
  const lastSentence = sentences[lastSentenceIndex];
  return {
    sentenceIndex: lastSentenceIndex,
    tokenIndex: getTokenIndexForProgressUnit(
      lastSentence,
      getProgressUnitCount(lastSentence),
      normalizedChunkSize,
    ),
  };
}

export function advancePosition(
  position: ReaderPosition,
  sentences: Sentence[],
  chunkSize: number,
  tokenGroupsBySentenceId: TokenGroupsBySentenceId = {},
): ReaderPosition {
  return moveByStep(position, sentences, chunkSize, tokenGroupsBySentenceId, 1);
}

export function retreatPosition(
  position: ReaderPosition,
  sentences: Sentence[],
  chunkSize = 1,
  tokenGroupsBySentenceId: TokenGroupsBySentenceId = {},
): ReaderPosition {
  return moveByStep(position, sentences, chunkSize, tokenGroupsBySentenceId, -1);
}

export function advanceSentencePosition(
  position: ReaderPosition,
  sentences: Sentence[],
  tokenGroupsBySentenceId: TokenGroupsBySentenceId = {},
): ReaderPosition {
  if (sentences.length === 0) {
    return position;
  }

  const current = clampPosition(position, sentences);
  if (current.sentenceIndex + 1 < sentences.length) {
    const nextSentence = sentences[current.sentenceIndex + 1];
    return {
      sentenceIndex: current.sentenceIndex + 1,
      tokenIndex: getFirstStepStart(
        nextSentence,
        getTokenGroupsForSentence(nextSentence, tokenGroupsBySentenceId),
      ),
    };
  }

  return current;
}

export function retreatSentencePosition(
  position: ReaderPosition,
  sentences: Sentence[],
  tokenGroupsBySentenceId: TokenGroupsBySentenceId = {},
): ReaderPosition {
  if (sentences.length === 0) {
    return position;
  }

  const current = clampPosition(position, sentences);
  if (current.sentenceIndex > 0) {
    const previousSentence = sentences[current.sentenceIndex - 1];
    return {
      sentenceIndex: current.sentenceIndex - 1,
      tokenIndex: getFirstStepStart(
        previousSentence,
        getTokenGroupsForSentence(previousSentence, tokenGroupsBySentenceId),
      ),
    };
  }

  return current;
}

export function getStepDelayMs(settings: ReaderSettings) {
  return Math.max(40, Math.round(settings.stepDurationMs));
}

export function shouldStopForMode(
  stopMode: StopMode,
  statuses: Record<number, MigakuTokenStatus>,
  sentence: Sentence,
  tokenIndex: number,
  tokenGroups: TokenGroups = [],
) {
  return shouldStopForTokenIndexes(stopMode, statuses, sentence, [tokenIndex], tokenGroups);
}

export function shouldStopForTokenIndexes(
  stopMode: StopMode,
  statuses: Record<number, MigakuTokenStatus>,
  sentence: Sentence,
  tokenIndexes: number[],
  tokenGroups: TokenGroups = [],
) {
  if (stopMode === "never") {
    return false;
  }

  const unknownVisibleUnitKeys = getUnknownWordUnitKeys(
    sentence,
    statuses,
    tokenIndexes,
    tokenGroups,
  );

  if (unknownVisibleUnitKeys.size === 0) {
    return false;
  }

  if (stopMode === "unknown") {
    return true;
  }

  const unknownWordUnitKeys = getUnknownWordUnitKeys(
    sentence,
    statuses,
    sentence.tokens.map((token) => token.index),
    tokenGroups,
  );

  return (
    unknownWordUnitKeys.size === 1 &&
    Array.from(unknownVisibleUnitKeys).some((unitKey) => unknownWordUnitKeys.has(unitKey))
  );
}

export function getUnknownWordUnitCount(
  sentence: Sentence,
  statuses: Record<number, MigakuTokenStatus>,
  tokenGroups: TokenGroups = [],
) {
  return getUnknownWordUnitKeys(
    sentence,
    statuses,
    sentence.tokens.map((token) => token.index),
    tokenGroups,
  ).size;
}

export function getTokenRenderGroups(sentence: Sentence, tokenGroups: TokenGroups = []) {
  const normalizedGroups = getNormalizedTokenGroups(sentence, tokenGroups);
  const groupRangesByStart = new Map(
    normalizedGroups.map((group) => [group[0], { start: group[0], end: group.at(-1) ?? group[0] }]),
  );
  const renderGroups: Sentence["tokens"][] = [];

  for (let index = 0; index < sentence.tokens.length; index += 1) {
    const range = groupRangesByStart.get(index);
    if (range) {
      renderGroups.push(sentence.tokens.slice(range.start, range.end + 1));
      index = range.end;
      continue;
    }

    renderGroups.push([sentence.tokens[index]]);
  }

  return renderGroups;
}

function getStepSpan(
  sentence: Sentence,
  tokenIndex: number,
  chunkSize: number,
  tokenGroups: TokenGroups = [],
) {
  const units = getStepUnits(sentence, tokenGroups);
  if (sentence.tokens.length === 0) {
    return { start: 0, end: 0 };
  }
  if (units.length === 0) {
    return { start: 0, end: sentence.tokens.length - 1 };
  }

  const startWordIndex = normalizeStepStart(sentence, tokenIndex, tokenGroups);
  const foundStartOffset = units.findIndex(
    (unit) => unit.includes(startWordIndex) || unit[0] >= startWordIndex,
  );
  const startWordOffset = foundStartOffset >= 0 ? foundStartOffset : units.length - 1;
  const endWordOffset = Math.min(startWordOffset + Math.max(1, chunkSize) - 1, units.length - 1);
  const endWordIndex = units[endWordOffset].at(-1) ?? units[endWordOffset][0];
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

function getStepStarts(sentence: Sentence, chunkSize: number, tokenGroups: TokenGroups = []) {
  const units = getStepUnits(sentence, tokenGroups);
  if (units.length === 0) {
    return sentence.tokens.length > 0 ? [0] : [];
  }

  const step = Math.max(1, chunkSize);
  const starts: number[] = [];
  for (let index = 0; index < units.length; index += step) {
    starts.push(units[index][0]);
  }
  return starts;
}

function moveByStep(
  position: ReaderPosition,
  sentences: Sentence[],
  chunkSize: number,
  tokenGroupsBySentenceId: TokenGroupsBySentenceId,
  offset: -1 | 1,
): ReaderPosition {
  if (sentences.length === 0) {
    return position;
  }

  const steps = getBookStepPositions(sentences, chunkSize, tokenGroupsBySentenceId);
  if (steps.length === 0) {
    return clampPosition(position, sentences);
  }

  const current = getCurrentStepPosition(position, sentences, chunkSize, tokenGroupsBySentenceId);
  const currentStepIndex = steps.findIndex(
    (step) => step.sentenceIndex === current.sentenceIndex && step.tokenIndex === current.tokenIndex,
  );
  const safeStepIndex = currentStepIndex >= 0 ? currentStepIndex : findNearestStepIndex(steps, current);
  const nextStepIndex = Math.min(Math.max(safeStepIndex + offset, 0), steps.length - 1);

  return steps[nextStepIndex] ?? current;
}

function getBookStepPositions(
  sentences: Sentence[],
  chunkSize: number,
  tokenGroupsBySentenceId: TokenGroupsBySentenceId,
) {
  return sentences.flatMap((sentence, sentenceIndex) =>
    getStepStarts(sentence, chunkSize, getTokenGroupsForSentence(sentence, tokenGroupsBySentenceId)).map(
      (tokenIndex) => ({ sentenceIndex, tokenIndex }),
    ),
  );
}

function getCurrentStepPosition(
  position: ReaderPosition,
  sentences: Sentence[],
  chunkSize: number,
  tokenGroupsBySentenceId: TokenGroupsBySentenceId,
) {
  const current = clampPosition(position, sentences);
  const sentence = sentences[current.sentenceIndex];
  const tokenGroups = getTokenGroupsForSentence(sentence, tokenGroupsBySentenceId);

  return {
    sentenceIndex: current.sentenceIndex,
    tokenIndex: getStepStartForTokenIndex(sentence, current.tokenIndex, chunkSize, tokenGroups),
  };
}

function getStepStartForTokenIndex(
  sentence: Sentence,
  tokenIndex: number,
  chunkSize: number,
  tokenGroups: TokenGroups = [],
) {
  const starts = getStepStarts(sentence, chunkSize, tokenGroups);
  if (starts.length === 0) {
    return 0;
  }

  const normalizedStart = normalizeStepStart(sentence, tokenIndex, tokenGroups);
  let stepStart = starts[0];
  for (const start of starts) {
    if (start > normalizedStart) {
      break;
    }
    stepStart = start;
  }

  return stepStart;
}

function findNearestStepIndex(steps: ReaderPosition[], position: ReaderPosition) {
  const nextStepIndex = steps.findIndex(
    (step) =>
      step.sentenceIndex > position.sentenceIndex ||
      (step.sentenceIndex === position.sentenceIndex && step.tokenIndex >= position.tokenIndex),
  );

  if (nextStepIndex < 0) {
    return steps.length - 1;
  }

  return nextStepIndex;
}

function getFirstStepStart(sentence: Sentence, tokenGroups: TokenGroups = []) {
  return getStepStarts(sentence, 1, tokenGroups)[0] ?? 0;
}

function normalizeStepStart(sentence: Sentence, tokenIndex: number, tokenGroups: TokenGroups = []) {
  const clampedTokenIndex = Math.min(
    Math.max(tokenIndex, 0),
    Math.max(sentence.tokens.length - 1, 0),
  );
  const currentToken = sentence.tokens[clampedTokenIndex];
  if (!currentToken) {
    return 0;
  }
  const units = getStepUnits(sentence, tokenGroups);
  if (units.length === 0) {
    return 0;
  }
  if (currentToken.isWordLike) {
    return getUnitStartForTokenIndex(units, currentToken.index) ?? currentToken.index;
  }

  const previousWord = [...sentence.tokens]
    .slice(0, clampedTokenIndex + 1)
    .reverse()
    .find((token) => token.isWordLike);
  if (previousWord) {
    return getUnitStartForTokenIndex(units, previousWord.index) ?? previousWord.index;
  }

  const nextWord = sentence.tokens.slice(clampedTokenIndex + 1).find((token) => token.isWordLike);
  return nextWord
    ? getUnitStartForTokenIndex(units, nextWord.index) ?? nextWord.index
    : currentToken.index;
}

function getStepUnits(sentence: Sentence, tokenGroups: TokenGroups = []) {
  const normalizedGroups = getNormalizedTokenGroups(sentence, tokenGroups);
  const groupedTokenIndexes = new Set(normalizedGroups.flat());
  const singleTokenUnits = sentence.tokens
    .filter((token) => token.isWordLike && !groupedTokenIndexes.has(token.index))
    .map((token) => [token.index]);

  return [...normalizedGroups, ...singleTokenUnits].sort((left, right) => left[0] - right[0]);
}

function getWordLikeTokenIndexes(sentence: Sentence) {
  return sentence.tokens.filter((token) => token.isWordLike).map((token) => token.index);
}

function getNormalizedTokenGroups(sentence: Sentence, tokenGroups: TokenGroups = []) {
  const wordLikeIndexes = new Set(
    sentence.tokens.filter((token) => token.isWordLike).map((token) => token.index),
  );
  const claimedIndexes = new Set<number>();
  const normalizedGroups: TokenGroups = [];

  for (const group of tokenGroups) {
    const indexes = Array.from(
      new Set(group.filter((tokenIndex) => wordLikeIndexes.has(tokenIndex))),
    ).sort((left, right) => left - right);

    if (
      indexes.length === 0 ||
      (indexes.length === wordLikeIndexes.size && wordLikeIndexes.size > 1) ||
      indexes.some((tokenIndex) => claimedIndexes.has(tokenIndex))
    ) {
      continue;
    }

    indexes.forEach((tokenIndex) => claimedIndexes.add(tokenIndex));
    normalizedGroups.push(indexes);
  }

  return normalizedGroups.sort((left, right) => left[0] - right[0]);
}

function getUnitStartForTokenIndex(units: TokenGroups, tokenIndex: number) {
  return units.find((unit) => unit.includes(tokenIndex))?.[0];
}

function getUnknownWordUnitKeys(
  sentence: Sentence,
  statuses: Record<number, MigakuTokenStatus>,
  tokenIndexes: number[],
  tokenGroups: TokenGroups = [],
) {
  const candidateIndexes = new Set(tokenIndexes);
  const keys = new Set<string>();

  for (const unit of getStepUnits(sentence, tokenGroups)) {
    if (!unit.some((tokenIndex) => candidateIndexes.has(tokenIndex))) {
      continue;
    }
    if (unit.some((tokenIndex) => statuses[tokenIndex] === "unknown")) {
      keys.add(unit.join(","));
    }
  }

  return keys;
}

function getTokenGroupsForSentence(
  sentence: Sentence,
  tokenGroupsBySentenceId: TokenGroupsBySentenceId,
) {
  return tokenGroupsBySentenceId[sentence.id] ?? [];
}

function getProgressUnitCount(sentence: Sentence, tokenGroups: TokenGroups = []) {
  const unitCount = getStepUnits(sentence, tokenGroups).length;
  return unitCount > 0 ? unitCount : sentence.tokens.length;
}

function getProgressThroughToken(sentence: Sentence, tokenIndex: number, tokenGroups: TokenGroups = []) {
  const units = getStepUnits(sentence, tokenGroups);
  if (units.length > 0) {
    return units.filter((unit) => unit[0] <= tokenIndex).length;
  }

  return Math.min(tokenIndex + 1, sentence.tokens.length);
}

function getTokenIndexForProgressUnit(sentence: Sentence, location: number, chunkSize: number) {
  const wordIndexes = getWordLikeTokenIndexes(sentence);
  if (wordIndexes.length > 0) {
    const targetOffset = Math.min(Math.max(location - 1, 0), wordIndexes.length - 1);
    const chunkStartOffset = Math.floor(targetOffset / chunkSize) * chunkSize;
    return wordIndexes[chunkStartOffset];
  }

  const tokenOffset = Math.min(Math.max(location - 1, 0), Math.max(sentence.tokens.length - 1, 0));
  return sentence.tokens[tokenOffset]?.index ?? 0;
}
