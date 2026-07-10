import type {
  MigakuTokenStatus,
  ReaderPosition,
  ReaderSettings,
  Sentence,
  StepGroupingMode,
  StopMode,
} from "../types";

export type TokenGroups = number[][];
export type TokenGroupsBySentenceId = Record<string, TokenGroups | undefined>;

export interface ReaderStepConfig {
  mode: StepGroupingMode;
  wordCount: number;
  characterCount: number;
}

export interface DisplayStep {
  startOffset: number;
  endOffset: number;
  tokenIndexes: number[];
  text: string;
}

export interface DisplayRenderSegment {
  key: string;
  text: string;
  tokenIndexes: number[];
  isDisplay: boolean;
  isWordLike: boolean;
}

type StepConfigInput = number | Partial<ReaderStepConfig> | undefined;
type PositionInput = number | Pick<ReaderPosition, "tokenIndex" | "characterOffset">;

export const DEFAULT_SETTINGS: ReaderSettings = {
  stepsPerMinute: 150,
  fontSize: 64,
  stepGroupingMode: "words",
  chunkSize: 1,
  characterChunkSize: 4,
  stopMode: "unknown",
  theme: "paper",
  recapApiUrl: "",
  recapApiKey: "",
  recapModel: "",
  translationModel: "",
};

export function flattenSentences(book?: { chapters: { sentences: Sentence[] }[] }) {
  return book?.chapters.flatMap((chapter) => chapter.sentences) ?? [];
}

export function getStepConfig(settings: ReaderSettings): ReaderStepConfig {
  return normalizeStepConfig({
    mode: settings.stepGroupingMode,
    wordCount: settings.chunkSize,
    characterCount: settings.characterChunkSize,
  });
}

export function clampPosition(position: ReaderPosition, sentences: Sentence[]): ReaderPosition {
  if (sentences.length === 0) {
    return { sentenceIndex: 0, tokenIndex: 0 };
  }

  const sentenceIndex = Math.min(Math.max(position.sentenceIndex, 0), sentences.length - 1);
  const sentence = sentences[sentenceIndex];
  const tokenIndex = Math.min(Math.max(position.tokenIndex, 0), sentence.tokens.length - 1);
  const characterOffset =
    typeof position.characterOffset === "number" && Number.isFinite(position.characterOffset)
      ? Math.min(Math.max(Math.round(position.characterOffset), 0), sentence.text.length)
      : undefined;

  return characterOffset === undefined
    ? { sentenceIndex, tokenIndex }
    : { sentenceIndex, tokenIndex, characterOffset };
}

export function getDisplayTokens(
  sentence: Sentence,
  position: PositionInput,
  stepConfig: StepConfigInput,
  tokenGroups: TokenGroups = [],
) {
  const display = getDisplayStep(sentence, position, stepConfig, tokenGroups);
  return getTokensInRange(sentence, display.startOffset, display.endOffset);
}

export function getDisplayText(
  sentence: Sentence,
  position: PositionInput,
  stepConfig: StepConfigInput,
  tokenGroups: TokenGroups = [],
) {
  return getDisplayStep(sentence, position, stepConfig, tokenGroups).text;
}

export function getDisplayStep(
  sentence: Sentence,
  position: PositionInput,
  stepConfig: StepConfigInput,
  tokenGroups: TokenGroups = [],
): DisplayStep {
  const config = normalizeStepConfig(stepConfig);
  if (config.mode === "characters") {
    return getCharacterDisplayStep(sentence, position, config);
  }

  return getWordDisplayStep(sentence, position, config, tokenGroups);
}

export function getDisplayRenderSegments(
  sentence: Sentence,
  display: Pick<DisplayStep, "startOffset" | "endOffset">,
  tokenGroups: TokenGroups = [],
): DisplayRenderSegment[] {
  return getTokenRenderGroups(sentence, tokenGroups).flatMap((tokens) => {
    const firstToken = tokens[0];
    const lastToken = tokens.at(-1);
    if (!firstToken || !lastToken) {
      return [];
    }

    const groupStart = firstToken.start;
    const groupEnd = lastToken.end;
    const boundaries = [groupStart, groupEnd];
    if (display.startOffset > groupStart && display.startOffset < groupEnd) {
      boundaries.push(display.startOffset);
    }
    if (display.endOffset > groupStart && display.endOffset < groupEnd) {
      boundaries.push(display.endOffset);
    }

    const sortedBoundaries = Array.from(new Set(boundaries)).sort((left, right) => left - right);
    const segments: DisplayRenderSegment[] = [];

    for (let index = 0; index < sortedBoundaries.length - 1; index += 1) {
      const start = sortedBoundaries[index];
      const end = sortedBoundaries[index + 1];
      if (start >= end) {
        continue;
      }

      const segmentTokens = tokens.filter((token) => rangesOverlap(token.start, token.end, start, end));
      if (segmentTokens.length === 0) {
        continue;
      }

      segments.push({
        key: `${start}:${end}:${segmentTokens.map((token) => token.index).join(",")}`,
        text: sentence.text.slice(start, end),
        tokenIndexes: segmentTokens.map((token) => token.index),
        isDisplay: rangesOverlap(start, end, display.startOffset, display.endOffset),
        isWordLike: segmentTokens.some((token) => token.isWordLike),
      });
    }

    return segments;
  });
}

export function getProgressStats(
  position: ReaderPosition,
  sentences: Sentence[],
  stepConfig: StepConfigInput = 1,
  tokenGroupsBySentenceId: TokenGroupsBySentenceId = {},
) {
  const config = normalizeStepConfig(stepConfig);
  const total = sentences.reduce(
    (sum, sentence) =>
      sum +
      getProgressUnitCount(
        sentence,
        config,
        getTokenGroupsForSentence(sentence, tokenGroupsBySentenceId),
      ),
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
        sum +
        getProgressUnitCount(
          sentence,
          config,
          getTokenGroupsForSentence(sentence, tokenGroupsBySentenceId),
        ),
      0,
    );
  const sentence = sentences[current.sentenceIndex];
  const tokenGroups = getTokenGroupsForSentence(sentence, tokenGroupsBySentenceId);
  const display = getDisplayStep(sentence, current, config, tokenGroups);
  const currentSentenceProgress =
    config.mode === "characters"
      ? getCharacterCountThroughOffset(sentence, display.endOffset)
      : getProgressThroughToken(
          sentence,
          display.tokenIndexes.at(-1) ?? current.tokenIndex,
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
  stepConfig: StepConfigInput = 1,
): ReaderPosition {
  const config = normalizeStepConfig(stepConfig);
  const total = sentences.reduce(
    (sum, sentence) => sum + getProgressUnitCount(sentence, config),
    0,
  );
  if (total === 0) {
    return { sentenceIndex: 0, tokenIndex: 0 };
  }

  let remainingLocation = Math.min(Math.max(Math.round(location), 1), total);

  for (let sentenceIndex = 0; sentenceIndex < sentences.length; sentenceIndex += 1) {
    const sentence = sentences[sentenceIndex];
    const sentenceUnits = getProgressUnitCount(sentence, config);
    if (remainingLocation > sentenceUnits) {
      remainingLocation -= sentenceUnits;
      continue;
    }

    return getPositionForSentenceProgressUnit(sentence, sentenceIndex, remainingLocation, config);
  }

  const lastSentenceIndex = Math.max(sentences.length - 1, 0);
  const lastSentence = sentences[lastSentenceIndex];
  return getPositionForSentenceProgressUnit(
    lastSentence,
    lastSentenceIndex,
    getProgressUnitCount(lastSentence, config),
    config,
  );
}

export function advancePosition(
  position: ReaderPosition,
  sentences: Sentence[],
  stepConfig: StepConfigInput,
  tokenGroupsBySentenceId: TokenGroupsBySentenceId = {},
): ReaderPosition {
  return moveByStep(position, sentences, stepConfig, tokenGroupsBySentenceId, 1);
}

export function retreatPosition(
  position: ReaderPosition,
  sentences: Sentence[],
  stepConfig: StepConfigInput = 1,
  tokenGroupsBySentenceId: TokenGroupsBySentenceId = {},
): ReaderPosition {
  return moveByStep(position, sentences, stepConfig, tokenGroupsBySentenceId, -1);
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
  return Math.max(40, Math.round(60_000 / Math.max(1, settings.stepsPerMinute)));
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

function getWordDisplayStep(
  sentence: Sentence,
  position: PositionInput,
  config: ReaderStepConfig,
  tokenGroups: TokenGroups = [],
): DisplayStep {
  const span = getWordStepSpan(sentence, getPositionTokenIndex(position), config.wordCount, tokenGroups);
  const tokens = sentence.tokens.slice(span.start, span.end + 1);
  const startOffset = tokens[0]?.start ?? 0;
  const endOffset = tokens.at(-1)?.end ?? sentence.text.length;

  return {
    startOffset,
    endOffset,
    tokenIndexes: tokens.map((token) => token.index),
    text: tokens.map((token) => token.text).join(""),
  };
}

function getCharacterDisplayStep(
  sentence: Sentence,
  position: PositionInput,
  config: ReaderStepConfig,
): DisplayStep {
  if (sentence.text.length === 0) {
    return { startOffset: 0, endOffset: 0, tokenIndexes: [], text: "" };
  }

  const startOffset = normalizeCharacterStepOffset(
    sentence,
    getPositionCharacterOffset(sentence, position),
    config.characterCount,
  );
  const endOffset = getCharacterStepEndOffset(sentence, startOffset, config.characterCount);
  const tokens = getTokensInRange(sentence, startOffset, endOffset);

  return {
    startOffset,
    endOffset,
    tokenIndexes: tokens.map((token) => token.index),
    text: sentence.text.slice(startOffset, endOffset),
  };
}

function getWordStepSpan(
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

function getWordStepStarts(sentence: Sentence, chunkSize: number, tokenGroups: TokenGroups = []) {
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

function getStepStarts(
  sentence: Sentence,
  config: ReaderStepConfig,
  tokenGroups: TokenGroups = [],
): Array<Pick<ReaderPosition, "tokenIndex" | "characterOffset">> {
  if (config.mode === "characters") {
    return getCharacterStepStarts(sentence, config.characterCount);
  }

  return getWordStepStarts(sentence, config.wordCount, tokenGroups).map((tokenIndex) => ({
    tokenIndex,
  }));
}

function moveByStep(
  position: ReaderPosition,
  sentences: Sentence[],
  stepConfig: StepConfigInput,
  tokenGroupsBySentenceId: TokenGroupsBySentenceId,
  offset: -1 | 1,
): ReaderPosition {
  if (sentences.length === 0) {
    return position;
  }

  const config = normalizeStepConfig(stepConfig);
  const steps = getBookStepPositions(sentences, config, tokenGroupsBySentenceId);
  if (steps.length === 0) {
    return clampPosition(position, sentences);
  }

  const current = getCurrentStepPosition(position, sentences, config, tokenGroupsBySentenceId);
  const currentStepIndex = steps.findIndex(
    (step) => getStepPositionKey(step, config) === getStepPositionKey(current, config),
  );
  const safeStepIndex =
    currentStepIndex >= 0 ? currentStepIndex : findNearestStepIndex(steps, current, sentences, config);
  const nextStepIndex = Math.min(Math.max(safeStepIndex + offset, 0), steps.length - 1);

  return steps[nextStepIndex] ?? current;
}

function getBookStepPositions(
  sentences: Sentence[],
  config: ReaderStepConfig,
  tokenGroupsBySentenceId: TokenGroupsBySentenceId,
) {
  return sentences.flatMap((sentence, sentenceIndex) =>
    getStepStarts(
      sentence,
      config,
      getTokenGroupsForSentence(sentence, tokenGroupsBySentenceId),
    ).map(
      (start) => ({ sentenceIndex, ...start }),
    ),
  );
}

function getCurrentStepPosition(
  position: ReaderPosition,
  sentences: Sentence[],
  config: ReaderStepConfig,
  tokenGroupsBySentenceId: TokenGroupsBySentenceId,
) {
  const current = clampPosition(position, sentences);
  const sentence = sentences[current.sentenceIndex];
  const tokenGroups = getTokenGroupsForSentence(sentence, tokenGroupsBySentenceId);

  if (config.mode === "characters") {
    const characterOffset = normalizeCharacterStepOffset(
      sentence,
      getPositionCharacterOffset(sentence, current),
      config.characterCount,
    );
    return {
      sentenceIndex: current.sentenceIndex,
      tokenIndex: getTokenIndexAtOffset(sentence, characterOffset),
      characterOffset,
    };
  }

  return {
    sentenceIndex: current.sentenceIndex,
    tokenIndex: getWordStepStartForTokenIndex(
      sentence,
      current.tokenIndex,
      config.wordCount,
      tokenGroups,
    ),
  };
}

function getWordStepStartForTokenIndex(
  sentence: Sentence,
  tokenIndex: number,
  chunkSize: number,
  tokenGroups: TokenGroups = [],
) {
  const starts = getWordStepStarts(sentence, chunkSize, tokenGroups);
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

function findNearestStepIndex(
  steps: ReaderPosition[],
  position: ReaderPosition,
  sentences: Sentence[],
  config: ReaderStepConfig,
) {
  const nextStepIndex = steps.findIndex(
    (step) => {
      if (step.sentenceIndex > position.sentenceIndex) {
        return true;
      }
      if (step.sentenceIndex !== position.sentenceIndex) {
        return false;
      }

      const sentence = sentences[position.sentenceIndex];
      return getStepComparableOffset(step, sentence, config) >= getStepComparableOffset(position, sentence, config);
    },
  );

  if (nextStepIndex < 0) {
    return steps.length - 1;
  }

  return nextStepIndex;
}

function getFirstStepStart(sentence: Sentence, tokenGroups: TokenGroups = []) {
  return getWordStepStarts(sentence, 1, tokenGroups)[0] ?? 0;
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

function getProgressUnitCount(
  sentence: Sentence,
  config: ReaderStepConfig,
  tokenGroups: TokenGroups = [],
) {
  if (config.mode === "characters") {
    return getCharacterCount(sentence);
  }

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

function getPositionForSentenceProgressUnit(
  sentence: Sentence,
  sentenceIndex: number,
  location: number,
  config: ReaderStepConfig,
): ReaderPosition {
  if (config.mode === "characters") {
    const offsets = getCharacterOffsets(sentence.text);
    const targetCharacterIndex = Math.min(
      Math.max(location - 1, 0),
      Math.max(offsets.length - 2, 0),
    );
    const stepStartCharacterIndex =
      Math.floor(targetCharacterIndex / config.characterCount) * config.characterCount;
    const characterOffset = offsets[stepStartCharacterIndex] ?? 0;

    return {
      sentenceIndex,
      tokenIndex: getTokenIndexAtOffset(sentence, characterOffset),
      characterOffset,
    };
  }

  return {
    sentenceIndex,
    tokenIndex: getTokenIndexForProgressUnit(sentence, location, config.wordCount),
  };
}

function normalizeStepConfig(stepConfig: StepConfigInput): ReaderStepConfig {
  if (typeof stepConfig === "number") {
    return {
      mode: "words",
      wordCount: clampPositiveInteger(stepConfig, DEFAULT_SETTINGS.chunkSize),
      characterCount: DEFAULT_SETTINGS.characterChunkSize,
    };
  }

  const mode = stepConfig?.mode === "characters" ? "characters" : "words";
  return {
    mode,
    wordCount: clampPositiveInteger(stepConfig?.wordCount, DEFAULT_SETTINGS.chunkSize),
    characterCount: clampPositiveInteger(
      stepConfig?.characterCount,
      DEFAULT_SETTINGS.characterChunkSize,
    ),
  };
}

function clampPositiveInteger(value: unknown, fallback: number) {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
    return fallback;
  }
  return Math.max(1, Math.round(value));
}

function getPositionTokenIndex(position: PositionInput) {
  return typeof position === "number" ? position : position.tokenIndex;
}

function getPositionCharacterOffset(sentence: Sentence, position: PositionInput) {
  if (
    typeof position !== "number" &&
    typeof position.characterOffset === "number" &&
    Number.isFinite(position.characterOffset)
  ) {
    return Math.min(Math.max(Math.round(position.characterOffset), 0), sentence.text.length);
  }

  const tokenIndex = getPositionTokenIndex(position);
  const token = sentence.tokens[Math.min(Math.max(tokenIndex, 0), sentence.tokens.length - 1)];
  return token?.start ?? 0;
}

function getCharacterStepStarts(
  sentence: Sentence,
  characterCount: number,
): Array<Pick<ReaderPosition, "tokenIndex" | "characterOffset">> {
  const offsets = getCharacterOffsets(sentence.text);
  if (offsets.length <= 1) {
    return sentence.tokens.length > 0 ? [{ tokenIndex: 0, characterOffset: 0 }] : [];
  }

  const starts: Array<Pick<ReaderPosition, "tokenIndex" | "characterOffset">> = [];
  for (let characterIndex = 0; characterIndex < offsets.length - 1; characterIndex += characterCount) {
    const characterOffset = offsets[characterIndex] ?? 0;
    starts.push({
      tokenIndex: getTokenIndexAtOffset(sentence, characterOffset),
      characterOffset,
    });
  }

  return starts;
}

function normalizeCharacterStepOffset(sentence: Sentence, offset: number, characterCount: number) {
  const offsets = getCharacterOffsets(sentence.text);
  if (offsets.length <= 1) {
    return 0;
  }

  const characterIndex = getCharacterIndexAtOffset(offsets, offset);
  const stepStartCharacterIndex = Math.floor(characterIndex / characterCount) * characterCount;
  return offsets[Math.min(stepStartCharacterIndex, offsets.length - 2)] ?? 0;
}

function getCharacterStepEndOffset(sentence: Sentence, startOffset: number, characterCount: number) {
  const offsets = getCharacterOffsets(sentence.text);
  if (offsets.length <= 1) {
    return 0;
  }

  const startCharacterIndex = getCharacterIndexAtOffset(offsets, startOffset);
  const endCharacterIndex = Math.min(startCharacterIndex + characterCount, offsets.length - 1);
  return offsets[endCharacterIndex] ?? sentence.text.length;
}

function getCharacterCount(sentence: Sentence) {
  return Math.max(getCharacterOffsets(sentence.text).length - 1, 0);
}

function getCharacterCountThroughOffset(sentence: Sentence, offset: number) {
  const offsets = getCharacterOffsets(sentence.text);
  if (offsets.length <= 1) {
    return 0;
  }

  const safeOffset = Math.min(Math.max(offset, 0), sentence.text.length);
  const exactIndex = offsets.indexOf(safeOffset);
  if (exactIndex >= 0) {
    return exactIndex;
  }

  return getCharacterIndexAtOffset(offsets, safeOffset) + 1;
}

function getCharacterOffsets(text: string) {
  const offsets = [0];
  let offset = 0;
  for (const character of Array.from(text)) {
    offset += character.length;
    offsets.push(offset);
  }
  return offsets;
}

function getCharacterIndexAtOffset(offsets: number[], offset: number) {
  const safeOffset = Math.min(Math.max(Math.round(offset), 0), offsets.at(-1) ?? 0);
  const nextIndex = offsets.findIndex((candidate) => candidate > safeOffset);
  if (nextIndex < 0) {
    return Math.max(offsets.length - 2, 0);
  }
  return Math.max(nextIndex - 1, 0);
}

function getTokenIndexAtOffset(sentence: Sentence, offset: number) {
  const token =
    sentence.tokens.find((candidate) => candidate.start <= offset && offset < candidate.end) ??
    sentence.tokens.find((candidate) => candidate.start >= offset) ??
    sentence.tokens.at(-1);
  return token?.index ?? 0;
}

function getTokensInRange(sentence: Sentence, startOffset: number, endOffset: number) {
  const tokens = sentence.tokens.filter((token) =>
    rangesOverlap(token.start, token.end, startOffset, endOffset),
  );
  if (tokens.length > 0) {
    return tokens;
  }

  const token = sentence.tokens.find((candidate) => candidate.start >= startOffset) ?? sentence.tokens.at(-1);
  return token ? [token] : [];
}

function getStepPositionKey(position: ReaderPosition, config: ReaderStepConfig) {
  if (config.mode === "characters") {
    return `${position.sentenceIndex}:${position.characterOffset ?? position.tokenIndex}`;
  }
  return `${position.sentenceIndex}:${position.tokenIndex}`;
}

function getStepComparableOffset(
  position: ReaderPosition,
  sentence: Sentence,
  config: ReaderStepConfig,
) {
  if (config.mode === "characters") {
    return getPositionCharacterOffset(sentence, position);
  }
  return position.tokenIndex;
}

function rangesOverlap(aStart: number, aEnd: number, bStart: number, bEnd: number) {
  return aStart < bEnd && bStart < aEnd;
}
