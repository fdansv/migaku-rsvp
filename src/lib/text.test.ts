import { describe, expect, it } from "vitest";
import {
  createSentence,
  createSentenceWithTokenizer,
  normalizeText,
  sentenceTextFromParagraphs,
  splitIntoSentences,
  tokenizeJapanese,
} from "./text";

describe("Japanese text utilities", () => {
  it("removes EPUB line breaks between Japanese characters", () => {
    expect(normalizeText("猫が\n走る。")).toBe("猫が走る。");
  });

  it("splits Japanese punctuation into full sentences", () => {
    expect(splitIntoSentences("猫が走る。犬も走る！「鳥は？」")).toEqual([
      "猫が走る。",
      "犬も走る！",
      "「鳥は？」",
    ]);
  });

  it("tokenizes Japanese text with word and punctuation metadata", async () => {
    const tokens = await tokenizeJapanese("猫が走る。", "s1");
    expect(tokens.map((token) => token.text).join("")).toBe("猫が走る。");
    expect(tokens.some((token) => token.isWordLike)).toBe(true);
    expect(tokens.at(-1)?.isPunctuation).toBe(true);
    for (const token of tokens) {
      expect("猫が走る。".slice(token.start, token.end)).toBe(token.text);
    }
  });

  it("keeps common inflected constructions together", async () => {
    const tokens = await tokenizeJapanese("の職場だった。", "s1");
    expect(tokens.map((token) => token.text)).toEqual(["の", "職場", "だった", "。"]);
  });

  it("keeps negative and polite constructions together", async () => {
    await expect(tokenizeJapanese("雨ではない。", "s1").then((tokens) => tokens.map((token) => token.text))).resolves.toEqual([
      "雨",
      "ではない",
      "。",
    ]);
    await expect(tokenizeJapanese("静かでした。", "s2").then((tokens) => tokens.map((token) => token.text))).resolves.toEqual([
      "静か",
      "でした",
      "。",
    ]);
  });

  it("creates asynchronously tokenized sentences for imported EPUB text", async () => {
    const sentence = await createSentenceWithTokenizer("の職場だった。", "chapter:0", 0, 2, 7);
    expect(sentence?.tokens.map((token) => token.text)).toEqual(["の", "職場", "だった", "。"]);
    expect(sentence?.globalIndex).toBe(7);
  });

  it("splits sentence text from multiple paragraphs without crossing paragraph order", () => {
    expect(sentenceTextFromParagraphs(["猫が走る。犬も走る。", "「鳥は？」"])).toEqual([
      "猫が走る。",
      "犬も走る。",
      "「鳥は？」",
    ]);
  });

  it("creates sentence ids and token ids from chapter context", () => {
    const sentence = createSentence("猫が走る。", "chapter:0", 0, 2, 7);
    expect(sentence?.id).toBe("chapter:0:sentence:2");
    expect(sentence?.globalIndex).toBe(7);
    expect(sentence?.tokens[0].id).toContain("chapter:0:sentence:2");
  });
});
