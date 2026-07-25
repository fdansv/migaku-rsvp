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
  maxWordStepCharacters: number;
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
type StepStart = Pick<ReaderPosition, "tokenIndex" | "characterOffset">;

interface WordSubunit {
  startOffset: number;
  endOffset: number;
  tokenIndexes: number[];
  tokenIndex: number;
  characterOffset?: number;
  isSplit: boolean;
}

interface WordDisplayStep extends DisplayStep {
  start: StepStart;
  subunitStartIndex: number;
  subunitEndIndex: number;
}

interface ProgressCounts {
  counts: number[];
  prefixTotals: number[];
  sentenceIndexById: Map<string, number>;
  total: number;
}

const progressCountsCache = new WeakMap<Sentence[], Map<string, ProgressCounts>>();

export const DEFAULT_SETTINGS: ReaderSettings = {
  stepsPerMinute: 150,
  fontSize: 64,
  stepGroupingMode: "words",
  chunkSize: 1,
  characterChunkSize: 4,
  maxWordStepCharacters: 4,
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
    maxWordStepCharacters: settings.maxWordStepCharacters,
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

export function getPositionForTextMatch(
  query: string,
  sentences: Sentence[],
  stepConfig: StepConfigInput = 1,
): ReaderPosition | null {
  const needle = query.trim();
  if (!needle) {
    return null;
  }

  const config = normalizeStepConfig(stepConfig);
  for (let sentenceIndex = 0; sentenceIndex < sentences.length; sentenceIndex += 1) {
    const sentence = sentences[sentenceIndex];
    const matchOffset = sentence.text.indexOf(needle);
    if (matchOffset < 0) {
      continue;
    }

    const tokenIndex = getTokenIndexAtOffset(sentence, matchOffset);
    if (config.mode === "characters") {
      return {
        sentenceIndex,
        tokenIndex,
        characterOffset: matchOffset,
      };
    }

    return getWordPositionForOffset(sentence, sentenceIndex, matchOffset, config);
  }

  return null;
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
  const cachedCounts = getProgressCounts(sentences, config);
  const groupedDeltas = getGroupedProgressDeltas(
    sentences,
    config,
    cachedCounts,
    tokenGroupsBySentenceId,
  );
  const total = cachedCounts.total + groupedDeltas.totalDelta;
  if (total === 0) {
    return { current: 0, total: 0, percent: 0 };
  }

  const current = clampPosition(position, sentences);
  const completedBeforeCurrentSentence =
    (cachedCounts.prefixTotals[current.sentenceIndex] ?? 0) +
    groupedDeltas.deltasBeforeSentence(current.sentenceIndex);
  const sentence = sentences[current.sentenceIndex];
  const tokenGroups = getTokenGroupsForSentence(sentence, tokenGroupsBySentenceId);
  const display = getDisplayStep(sentence, current, config, tokenGroups);
  const currentSentenceProgress =
    config.mode === "characters"
      ? getCharacterCountThroughOffset(sentence, display.endOffset)
      : getWordProgressThroughOffset(
          sentence,
          display.endOffset,
          config,
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
  const subunits = getWordSubunits(sentence, config, tokenGroups);
  if (subunits.length === 0) {
    return { startOffset: 0, endOffset: 0, tokenIndexes: [], text: "" };
  }

  const startIndex = getWordSubunitIndexForPosition(subunits, sentence, position);
  const step = createWordDisplayStep(
    sentence,
    subunits,
    startIndex,
    getWordDisplayEndIndex(subunits, startIndex, config.wordCount),
  );
  return {
    startOffset: step.startOffset,
    endOffset: step.endOffset,
    tokenIndexes: step.tokenIndexes,
    text: step.text,
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

function getWordDisplaySteps(
  sentence: Sentence,
  config: ReaderStepConfig,
  tokenGroups: TokenGroups = [],
): WordDisplayStep[] {
  const subunits = getWordSubunits(sentence, config, tokenGroups);
  const steps: WordDisplayStep[] = [];
  const wordCount = Math.max(1, config.wordCount);

  for (let index = 0; index < subunits.length;) {
    const endIndex = getWordDisplayEndIndex(subunits, index, wordCount);

    steps.push(createWordDisplayStep(sentence, subunits, index, endIndex));
    index = endIndex + 1;
  }

  return steps;
}

function getWordDisplayEndIndex(
  subunits: WordSubunit[],
  startIndex: number,
  wordCount: number,
) {
  let endIndex = startIndex;

  if (!subunits[startIndex].isSplit) {
    let remainingWords = Math.max(1, wordCount) - 1;
    while (
      remainingWords > 0 &&
      endIndex + 1 < subunits.length &&
      !subunits[endIndex + 1].isSplit
    ) {
      endIndex += 1;
      remainingWords -= 1;
    }
  }

  return endIndex;
}

function createWordDisplayStep(
  sentence: Sentence,
  subunits: WordSubunit[],
  subunitStartIndex: number,
  subunitEndIndex: number,
): WordDisplayStep {
  const first = subunits[subunitStartIndex];
  const last = subunits[subunitEndIndex];
  const endOffset = getWordStepEndOffset(sentence, last);
  const tokenIndexes = getTokensInRange(sentence, first.startOffset, endOffset).map(
    (token) => token.index,
  );

  return {
    startOffset: first.startOffset,
    endOffset,
    tokenIndexes,
    text: sentence.text.slice(first.startOffset, endOffset),
    start: createWordStepStart(first),
    subunitStartIndex,
    subunitEndIndex,
  };
}

function getWordStepEndOffset(sentence: Sentence, subunit: WordSubunit) {
  let endOffset = subunit.endOffset;
  const lastTokenIndex = subunit.tokenIndexes.at(-1);
  const tokenArrayIndex = sentence.tokens.findIndex((token) => token.index === lastTokenIndex);
  const lastToken = tokenArrayIndex >= 0 ? sentence.tokens[tokenArrayIndex] : undefined;

  if (!lastToken || endOffset < lastToken.end) {
    return endOffset;
  }

  for (let index = tokenArrayIndex + 1; index < sentence.tokens.length; index += 1) {
    const token = sentence.tokens[index];
    if (token.isWordLike) {
      break;
    }
    endOffset = token.end;
  }

  return endOffset;
}

function createWordStepStart(subunit: WordSubunit): StepStart {
  if (typeof subunit.characterOffset === "number") {
    return {
      tokenIndex: subunit.tokenIndex,
      characterOffset: subunit.characterOffset,
    };
  }

  return { tokenIndex: subunit.tokenIndex };
}

function getStepStarts(
  sentence: Sentence,
  config: ReaderStepConfig,
  tokenGroups: TokenGroups = [],
): StepStart[] {
  if (config.mode === "characters") {
    return getCharacterStepStarts(sentence, config.characterCount);
  }

  return getWordDisplaySteps(sentence, config, tokenGroups).map((step) => step.start);
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
  const current = getCurrentStepPosition(position, sentences, config, tokenGroupsBySentenceId);
  const currentSentence = sentences[current.sentenceIndex];
  const currentStepStarts = getStepStarts(
    currentSentence,
    config,
    getTokenGroupsForSentence(currentSentence, tokenGroupsBySentenceId),
  );

  if (currentStepStarts.length === 0) {
    return (
      getBoundaryStepPosition(
        sentences,
        current.sentenceIndex + offset,
        offset,
        config,
        tokenGroupsBySentenceId,
      ) ?? current
    );
  }

  const currentStepIndex = getStepStartIndex(currentStepStarts, current, currentSentence, config);
  const nextStep = currentStepStarts[currentStepIndex + offset];
  if (nextStep) {
    return createStepPosition(current.sentenceIndex, nextStep);
  }

  return (
    getBoundaryStepPosition(
      sentences,
      current.sentenceIndex + offset,
      offset,
      config,
      tokenGroupsBySentenceId,
    ) ?? current
  );
}

function getStepStartIndex(
  starts: StepStart[],
  position: PositionInput,
  sentence: Sentence,
  config: ReaderStepConfig,
) {
  const positionOffset = getStepComparableOffset(position, sentence, config);
  let currentIndex = 0;

  for (let index = 0; index < starts.length; index += 1) {
    if (getStepComparableOffset(starts[index], sentence, config) > positionOffset) {
      break;
    }
    currentIndex = index;
  }

  return currentIndex;
}

function getBoundaryStepPosition(
  sentences: Sentence[],
  sentenceIndex: number,
  direction: -1 | 1,
  config: ReaderStepConfig,
  tokenGroupsBySentenceId: TokenGroupsBySentenceId,
) {
  for (
    let index = sentenceIndex;
    index >= 0 && index < sentences.length;
    index += direction
  ) {
    const sentence = sentences[index];
    const starts = getStepStarts(
      sentence,
      config,
      getTokenGroupsForSentence(sentence, tokenGroupsBySentenceId),
    );
    const start = direction > 0 ? starts[0] : starts.at(-1);
    if (start) {
      return createStepPosition(index, start);
    }
  }

  return undefined;
}

function createStepPosition(sentenceIndex: number, start: StepStart): ReaderPosition {
  const position: ReaderPosition = {
    sentenceIndex,
    tokenIndex: start.tokenIndex,
  };
  if (typeof start.characterOffset === "number") {
    position.characterOffset = start.characterOffset;
  }
  return position;
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
    ...getWordStepStartForPosition(
      sentence,
      current,
      config,
      tokenGroups,
    ),
  };
}

function getWordStepStartForPosition(
  sentence: Sentence,
  position: PositionInput,
  config: ReaderStepConfig,
  tokenGroups: TokenGroups = [],
) {
  const steps = getWordDisplaySteps(sentence, config, tokenGroups);
  return steps[getWordDisplayStepIndex(steps, sentence, position)]?.start ?? { tokenIndex: 0 };
}

function getWordPositionForOffset(
  sentence: Sentence,
  sentenceIndex: number,
  offset: number,
  config: ReaderStepConfig,
): ReaderPosition {
  const subunits = getWordSubunits(sentence, config);
  if (subunits.length === 0) {
    return { sentenceIndex, tokenIndex: getTokenIndexAtOffset(sentence, offset) };
  }

  const subunitIndex = getWordSubunitIndexForPosition(
    subunits,
    sentence,
    {
      tokenIndex: getTokenIndexAtOffset(sentence, offset),
      characterOffset: offset,
    },
  );
  return createStepPosition(sentenceIndex, createWordStepStart(subunits[subunitIndex]));
}

function getFirstStepStart(sentence: Sentence, tokenGroups: TokenGroups = []) {
  const units = getStepUnits(sentence, tokenGroups);
  return units[0]?.[0] ?? 0;
}

function getWordDisplayStepIndex(
  steps: WordDisplayStep[],
  sentence: Sentence,
  position: PositionInput,
) {
  const positionOffset = getPositionWordOffset(sentence, position);
  let stepIndex = 0;

  for (let index = 0; index < steps.length; index += 1) {
    if (steps[index].startOffset > positionOffset) {
      break;
    }
    stepIndex = index;
  }

  return stepIndex;
}

function getWordSubunitIndexForPosition(
  subunits: WordSubunit[],
  sentence: Sentence,
  position: PositionInput,
) {
  const positionOffset = getPositionWordOffset(sentence, position);
  let subunitIndex = 0;

  for (let index = 0; index < subunits.length; index += 1) {
    if (subunits[index].startOffset > positionOffset) {
      break;
    }
    subunitIndex = index;
  }

  return subunitIndex;
}

function getWordSubunits(
  sentence: Sentence,
  config: ReaderStepConfig,
  tokenGroups: TokenGroups = [],
): WordSubunit[] {
  if (sentence.tokens.length === 0) {
    return [];
  }

  const units = getStepUnits(sentence, tokenGroups);
  if (units.length === 0) {
    return [
      {
        startOffset: sentence.tokens[0]?.start ?? 0,
        endOffset: sentence.tokens.at(-1)?.end ?? sentence.text.length,
        tokenIndexes: sentence.tokens.map((token) => token.index),
        tokenIndex: sentence.tokens[0]?.index ?? 0,
        isSplit: false,
      },
    ];
  }

  return units.flatMap((unit) => {
    const unitTokens = sentence.tokens
      .filter((token) => unit.includes(token.index))
      .sort((left, right) => left.start - right.start);
    const firstToken = unitTokens[0];
    const lastToken = unitTokens.at(-1);
    if (!firstToken || !lastToken) {
      return [];
    }

    const splitOffsets = getBalancedWordSplitOffsets(
      sentence.text,
      firstToken.start,
      lastToken.end,
      config.maxWordStepCharacters,
    );
    const isSplit = splitOffsets.length > 2;

    return splitOffsets.slice(0, -1).map((startOffset, index) => {
      const endOffset = splitOffsets[index + 1] ?? lastToken.end;
      const tokens = getTokensInRange(sentence, startOffset, endOffset).filter((token) =>
        unit.includes(token.index),
      );
      const firstPartToken = tokens[0] ?? getTokenAtOffset(sentence, startOffset) ?? firstToken;
      const subunit: WordSubunit = {
        startOffset,
        endOffset,
        tokenIndexes: tokens.length > 0 ? tokens.map((token) => token.index) : [firstPartToken.index],
        tokenIndex: firstPartToken.index,
        isSplit,
      };

      if (isSplit && startOffset > firstPartToken.start) {
        subunit.characterOffset = startOffset;
      }

      return subunit;
    });
  });
}

function getBalancedWordSplitOffsets(
  text: string,
  startOffset: number,
  endOffset: number,
  maxCharacters: number,
) {
  const relativeOffsets = getCharacterOffsets(text.slice(startOffset, endOffset));
  const characterCount = Math.max(relativeOffsets.length - 1, 0);
  const safeMaxCharacters = Math.max(1, Math.round(maxCharacters));

  if (characterCount <= safeMaxCharacters) {
    return [startOffset, endOffset];
  }

  const partCount = Math.min(
    characterCount,
    Math.max(2, Math.round(characterCount / safeMaxCharacters)),
  );
  const basePartSize = Math.floor(characterCount / partCount);
  const largerPartCount = characterCount % partCount;
  const shorterPartCount = partCount - largerPartCount;
  const offsets = [startOffset];
  let characterIndex = 0;

  for (let partIndex = 0; partIndex < partCount; partIndex += 1) {
    characterIndex += basePartSize + (partIndex >= shorterPartCount ? 1 : 0);
    offsets.push(startOffset + (relativeOffsets[characterIndex] ?? endOffset - startOffset));
  }

  return offsets;
}

function getStepUnits(sentence: Sentence, tokenGroups: TokenGroups = []) {
  const normalizedGroups = getNormalizedTokenGroups(sentence, tokenGroups);
  const groupedTokenIndexes = new Set(normalizedGroups.flat());
  const singleTokenUnits = sentence.tokens
    .filter((token) => token.isWordLike && !groupedTokenIndexes.has(token.index))
    .map((token) => [token.index]);

  return [...normalizedGroups, ...singleTokenUnits].sort((left, right) => left[0] - right[0]);
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

function getProgressCounts(sentences: Sentence[], config: ReaderStepConfig): ProgressCounts {
  const key = getProgressCountsKey(config);
  let countsByConfig = progressCountsCache.get(sentences);
  if (!countsByConfig) {
    countsByConfig = new Map();
    progressCountsCache.set(sentences, countsByConfig);
  }

  const cachedCounts = countsByConfig.get(key);
  if (cachedCounts) {
    return cachedCounts;
  }

  const counts: number[] = [];
  const prefixTotals: number[] = [];
  const sentenceIndexById = new Map<string, number>();
  let total = 0;

  sentences.forEach((sentence, index) => {
    sentenceIndexById.set(sentence.id, index);
    prefixTotals.push(total);
    const count = getProgressUnitCount(sentence, config);
    counts.push(count);
    total += count;
  });

  const progressCounts = { counts, prefixTotals, sentenceIndexById, total };
  countsByConfig.set(key, progressCounts);
  return progressCounts;
}

function getGroupedProgressDeltas(
  sentences: Sentence[],
  config: ReaderStepConfig,
  baseCounts: ProgressCounts,
  tokenGroupsBySentenceId: TokenGroupsBySentenceId,
) {
  const deltaBySentenceIndex = new Map<number, number>();
  let totalDelta = 0;

  for (const [sentenceId, tokenGroups] of Object.entries(tokenGroupsBySentenceId)) {
    if (!tokenGroups || tokenGroups.length === 0) {
      continue;
    }

    const sentenceIndex = baseCounts.sentenceIndexById.get(sentenceId);
    if (sentenceIndex === undefined) {
      continue;
    }

    const sentence = sentences[sentenceIndex];
    const groupedCount = getProgressUnitCount(sentence, config, tokenGroups);
    const delta = groupedCount - (baseCounts.counts[sentenceIndex] ?? 0);
    if (delta === 0) {
      continue;
    }

    deltaBySentenceIndex.set(sentenceIndex, delta);
    totalDelta += delta;
  }

  return {
    totalDelta,
    deltasBeforeSentence(sentenceIndex: number) {
      let delta = 0;
      deltaBySentenceIndex.forEach((value, index) => {
        if (index < sentenceIndex) {
          delta += value;
        }
      });
      return delta;
    },
  };
}

function getProgressCountsKey(config: ReaderStepConfig) {
  return `${config.mode}:${config.wordCount}:${config.characterCount}:${config.maxWordStepCharacters}`;
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

  return getWordSubunits(sentence, config, tokenGroups).length;
}

function getWordProgressThroughOffset(
  sentence: Sentence,
  offset: number,
  config: ReaderStepConfig,
  tokenGroups: TokenGroups = [],
) {
  const subunits = getWordSubunits(sentence, config, tokenGroups);
  const safeOffset = Math.min(Math.max(offset, 0), sentence.text.length);
  return subunits.filter((subunit) => subunit.endOffset <= safeOffset).length;
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

  const steps = getWordDisplaySteps(sentence, config);
  if (steps.length === 0) {
    return { sentenceIndex, tokenIndex: 0 };
  }

  const targetSubunitIndex = Math.min(
    Math.max(location - 1, 0),
    steps.at(-1)?.subunitEndIndex ?? 0,
  );
  const step =
    steps.find(
      (candidate) =>
        candidate.subunitStartIndex <= targetSubunitIndex &&
        targetSubunitIndex <= candidate.subunitEndIndex,
    ) ?? steps.at(-1);

  return createStepPosition(sentenceIndex, step?.start ?? { tokenIndex: 0 });
}

function normalizeStepConfig(stepConfig: StepConfigInput): ReaderStepConfig {
  if (typeof stepConfig === "number") {
    return {
      mode: "words",
      wordCount: clampPositiveInteger(stepConfig, DEFAULT_SETTINGS.chunkSize),
      characterCount: DEFAULT_SETTINGS.characterChunkSize,
      maxWordStepCharacters: DEFAULT_SETTINGS.maxWordStepCharacters,
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
    maxWordStepCharacters: clampPositiveInteger(
      stepConfig?.maxWordStepCharacters,
      DEFAULT_SETTINGS.maxWordStepCharacters,
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

function getPositionWordOffset(sentence: Sentence, position: PositionInput) {
  return getPositionCharacterOffset(sentence, position);
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
  return getTokenAtOffset(sentence, offset)?.index ?? 0;
}

function getTokenAtOffset(sentence: Sentence, offset: number) {
  const token =
    sentence.tokens.find((candidate) => candidate.start <= offset && offset < candidate.end) ??
    sentence.tokens.find((candidate) => candidate.start >= offset) ??
    sentence.tokens.at(-1);
  return token;
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

function getStepComparableOffset(
  position: PositionInput,
  sentence: Sentence,
  config: ReaderStepConfig,
) {
  if (config.mode === "characters") {
    return getPositionCharacterOffset(sentence, position);
  }
  return getPositionWordOffset(sentence, position);
}

function rangesOverlap(aStart: number, aEnd: number, bStart: number, bEnd: number) {
  return aStart < bEnd && bStart < aEnd;
}
