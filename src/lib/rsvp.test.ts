import { describe, expect, it } from "vitest";
import type { Sentence } from "../types";
import { createSentence } from "./text";
import {
  DEFAULT_SETTINGS,
  advancePosition,
  clampPosition,
  flattenSentences,
  getDisplayText,
  getDisplayTokens,
  getProgressStats,
  getTokenDelayMs,
  retreatPosition,
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

    expect(advancePosition(endOfSentence, sentences, 1)).toEqual({
      sentenceIndex: 1,
      tokenIndex: 0,
    });
    expect(retreatPosition({ sentenceIndex: 1, tokenIndex: 0 }, sentences)).toEqual(endOfSentence);
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

  it("groups display tokens by chunk size", () => {
    expect(getDisplayText(sentence, 0, 2)).toBe(
      sentence.tokens
        .slice(0, 2)
        .map((token) => token.text)
        .join(""),
    );
    expect(getDisplayTokens(sentence, sentence.tokens.length - 1, 4)).toHaveLength(1);
  });

  it("tracks progress by active token instead of sentence only", () => {
    const sentences = [sentence, nextSentence];
    const total = sentence.tokens.length + nextSentence.tokens.length;

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
      current: sentence.tokens.length + 1,
      total,
      percent: Math.round(((sentence.tokens.length + 1) / total) * 100),
    });
  });

  it("adds extra delay after punctuation", () => {
    const delay = getTokenDelayMs("。", DEFAULT_SETTINGS);
    const base = getTokenDelayMs("猫", DEFAULT_SETTINGS);
    expect(delay).toBeGreaterThan(base);
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
