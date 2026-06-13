import { describe, expect, it } from "vitest";
import type { Sentence } from "../types";
import { createSentence } from "./text";
import {
  DEFAULT_SETTINGS,
  advancePosition,
  advanceSentencePosition,
  clampPosition,
  flattenSentences,
  getDisplayText,
  getDisplayTokens,
  getPositionForProgressUnit,
  getProgressStats,
  getStepDelayMs,
  retreatPosition,
  retreatSentencePosition,
  shouldStopForMode,
  shouldStopForTokenIndexes,
} from "./rsvp";

const sentence = createSentence("猫が走る。", "chapter:0", 0, 0, 0) as Sentence;
const nextSentence = createSentence("犬も走る。", "chapter:0", 0, 1, 1) as Sentence;

describe("RSVP reader logic", () => {
  it("flattens chapters without changing sentence order", () => {
    expect(
      flattenSentences({
        chapters: [{ sentences: [sentence] }, { sentences: [nextSentence] }],
      }).map((candidate) => candidate.text),
    ).toEqual(["猫が走る。", "犬も走る。"]);
  });

  it("clamps empty and out-of-range positions", () => {
    expect(clampPosition({ sentenceIndex: 99, tokenIndex: 99 }, [sentence])).toEqual({
      sentenceIndex: 0,
      tokenIndex: sentence.tokens.length - 1,
    });
    expect(clampPosition({ sentenceIndex: 1, tokenIndex: 1 }, [])).toEqual({
      sentenceIndex: 0,
      tokenIndex: 0,
    });
  });

  it("advances and retreats across sentence boundaries", () => {
    const sentences = [sentence, nextSentence];
    const endOfSentence = { sentenceIndex: 0, tokenIndex: sentence.tokens.length - 1 };
    const finalWordIndex =
      [...sentence.tokens].reverse().find((token) => token.isWordLike)?.index ?? 0;

    expect(advancePosition(endOfSentence, sentences, 1)).toEqual({
      sentenceIndex: 1,
      tokenIndex: 0,
    });
    expect(retreatPosition({ sentenceIndex: 1, tokenIndex: 0 }, sentences)).toEqual({
      sentenceIndex: 0,
      tokenIndex: finalWordIndex,
    });
  });

  it("retreats by the same chunk size used for advancing", () => {
    const chunkedSentence = createSentence("の職場だった。", "chapter:0", 0, 0, 0) as Sentence;
    const sentences = [chunkedSentence];
    const start = { sentenceIndex: 0, tokenIndex: 0 };
    const afterRight = advancePosition(start, sentences, 2);

    expect(retreatPosition(afterRight, sentences, 2)).toEqual(start);
  });

  it("retreats to the previous sentence's final full chunk", () => {
    const sentences = [sentence, nextSentence];

    expect(retreatPosition({ sentenceIndex: 1, tokenIndex: 0 }, sentences, 2)).toEqual({
      sentenceIndex: 0,
      tokenIndex: Math.max(sentence.tokens.length - 2, 0),
    });
  });

  it("jumps between sentence starts independently of chunk position", () => {
    const sentences = [sentence, nextSentence];

    expect(advanceSentencePosition({ sentenceIndex: 0, tokenIndex: 2 }, sentences)).toEqual({
      sentenceIndex: 1,
      tokenIndex: 0,
    });
    expect(retreatSentencePosition({ sentenceIndex: 1, tokenIndex: 2 }, sentences)).toEqual({
      sentenceIndex: 0,
      tokenIndex: 0,
    });
  });

  it("keeps sentence jumps inside the book", () => {
    const sentences = [sentence, nextSentence];

    expect(retreatSentencePosition({ sentenceIndex: 0, tokenIndex: 2 }, sentences)).toEqual({
      sentenceIndex: 0,
      tokenIndex: 2,
    });
    expect(advanceSentencePosition({ sentenceIndex: 1, tokenIndex: 2 }, sentences)).toEqual({
      sentenceIndex: 1,
      tokenIndex: 2,
    });
  });

  it("groups display tokens by word count and keeps punctuation attached", () => {
    expect(getDisplayText(sentence, 0, 2)).toBe(
      sentence.tokens
        .slice(0, 2)
        .map((token) => token.text)
        .join(""),
    );
    expect(getDisplayText(sentence, 2, 1)).toBe("走る。");
    expect(getDisplayText(sentence, sentence.tokens.length - 1, 4)).toBe("走る。");
  });

  it("tracks progress by active token instead of sentence only", () => {
    const sentences = [sentence, nextSentence];
    const sentenceWordCount = sentence.tokens.filter((token) => token.isWordLike).length;
    const total =
      sentenceWordCount + nextSentence.tokens.filter((token) => token.isWordLike).length;

    expect(getProgressStats({ sentenceIndex: 0, tokenIndex: 0 }, sentences)).toEqual({
      current: 1,
      total,
      percent: Math.round((1 / total) * 100),
    });
    expect(getProgressStats({ sentenceIndex: 0, tokenIndex: 1 }, sentences)).toEqual({
      current: 2,
      total,
      percent: Math.round((2 / total) * 100),
    });
    expect(getProgressStats({ sentenceIndex: 1, tokenIndex: 0 }, sentences)).toEqual({
      current: sentenceWordCount + 1,
      total,
      percent: Math.round(((sentenceWordCount + 1) / total) * 100),
    });
  });

  it("maps progress locations back to reader positions", () => {
    const sentences = [sentence, nextSentence];
    const sentenceWordCount = sentence.tokens.filter((token) => token.isWordLike).length;

    expect(getPositionForProgressUnit(0, sentences)).toEqual({
      sentenceIndex: 0,
      tokenIndex: 0,
    });
    expect(getPositionForProgressUnit(sentenceWordCount + 1, sentences)).toEqual({
      sentenceIndex: 1,
      tokenIndex: 0,
    });
    expect(getPositionForProgressUnit(999, sentences)).toEqual({
      sentenceIndex: 1,
      tokenIndex: [...nextSentence.tokens].reverse().find((token) => token.isWordLike)?.index ?? 0,
    });
  });

  it("maps progress locations to the visible chunk containing them", () => {
    const runIndex = sentence.tokens.find((token) => token.text.includes("走る"))?.index ?? 0;

    expect(getPositionForProgressUnit(2, [sentence], 2)).toEqual({
      sentenceIndex: 0,
      tokenIndex: 0,
    });
    expect(getPositionForProgressUnit(3, [sentence], 2)).toEqual({
      sentenceIndex: 0,
      tokenIndex: runIndex,
    });
  });

  it("uses a constant step delay from settings", () => {
    const settings = { ...DEFAULT_SETTINGS, stepDurationMs: 550 };

    expect(getStepDelayMs(settings)).toBe(550);
  });

  it("uses Migaku token groups as display and navigation boundaries", () => {
    const catIndex = sentence.tokens.find((token) => token.text.includes("猫"))?.index ?? 0;
    const particleIndex = sentence.tokens.find((token) => token.text.includes("が"))?.index ?? 1;
    const runIndex = sentence.tokens.find((token) => token.text.includes("走る"))?.index ?? 2;
    const tokenGroups = [[catIndex, particleIndex], [runIndex]];
    const sentences = [sentence];

    expect(getDisplayTokens(sentence, catIndex, 1, tokenGroups).map((token) => token.index)).toEqual([
      catIndex,
      particleIndex,
    ]);
    expect(getDisplayText(sentence, particleIndex, 1, tokenGroups)).toBe("猫が");
    expect(advancePosition({ sentenceIndex: 0, tokenIndex: catIndex }, sentences, 1, {
      [sentence.id]: tokenGroups,
    })).toEqual({ sentenceIndex: 0, tokenIndex: runIndex });
    expect(retreatPosition({ sentenceIndex: 0, tokenIndex: runIndex }, sentences, 1, {
      [sentence.id]: tokenGroups,
    })).toEqual({ sentenceIndex: 0, tokenIndex: catIndex });
  });

  it("counts a grouped Migaku token as one i+1 unit", () => {
    const catIndex = sentence.tokens.find((token) => token.text.includes("猫"))?.index ?? 0;
    const particleIndex = sentence.tokens.find((token) => token.text.includes("が"))?.index ?? 1;
    const tokenGroups = [[catIndex, particleIndex]];

    expect(
      shouldStopForTokenIndexes(
        "i+1",
        { [catIndex]: "unknown", [particleIndex]: "unknown" },
        sentence,
        [catIndex, particleIndex],
        tokenGroups,
      ),
    ).toBe(true);
  });

  it("stops on unknown and i+1 tokens only when the active token qualifies", () => {
    const catIndex = sentence.tokens.find((token) => token.text.includes("猫"))?.index ?? 0;
    const statuses = { [catIndex]: "unknown" as const };

    expect(shouldStopForMode("unknown", statuses, sentence, catIndex)).toBe(true);
    expect(shouldStopForMode("i+1", statuses, sentence, catIndex)).toBe(true);
    expect(shouldStopForMode("never", statuses, sentence, catIndex)).toBe(false);
  });

  it("does not stop i+1 mode when the sentence has multiple unknown words", () => {
    const catIndex = sentence.tokens.find((token) => token.text.includes("猫"))?.index ?? 0;
    const runIndex = sentence.tokens.find((token) => token.text.includes("走る"))?.index ?? 0;

    expect(
      shouldStopForMode(
        "i+1",
        { [catIndex]: "unknown", [runIndex]: "unknown" },
        sentence,
        catIndex,
      ),
    ).toBe(false);
  });

  it("checks all visible tokens for chunked stop decisions and ignores punctuation", () => {
    const runIndex = sentence.tokens.find((token) => token.text.includes("走る"))?.index ?? 0;
    const punctuationIndex = sentence.tokens.find((token) => token.isPunctuation)?.index ?? 0;

    expect(
      shouldStopForTokenIndexes("unknown", { [runIndex]: "unknown" }, sentence, [0, runIndex]),
    ).toBe(true);
    expect(
      shouldStopForTokenIndexes(
        "unknown",
        { [punctuationIndex]: "unknown" },
        sentence,
        [punctuationIndex],
      ),
    ).toBe(false);
  });
});
