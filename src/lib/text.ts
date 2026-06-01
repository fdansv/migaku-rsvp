import TinySegmenter from "tiny-segmenter";
import type { RsvpToken, Sentence } from "../types";

const JAPANESE_CHAR =
  /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\u3005\u30fc]/u;
const SENTENCE_END = /[。！？!?]/u;
const CLOSING_PUNCTUATION = /[」』”’）)］\]｝}〉》】]/u;
const PUNCTUATION_ONLY = /^[\p{P}\p{S}\s]+$/u;
export const CURRENT_TOKENIZER_VERSION = "tiny-segmenter-merge-v2";
const MERGE_PATTERNS = [
  ["だっ", "た"],
  ["だ", "った"],
  ["で", "し", "た"],
  ["でし", "た"],
  ["じゃ", "ない"],
  ["で", "は", "ない"],
  ["では", "ない"],
];

let segmenter: Intl.Segmenter | undefined;
let tinySegmenter: TinySegmenter | undefined;

interface TokenDraft {
  text: string;
  start: number;
  end: number;
  isWordLike: boolean;
  isPunctuation: boolean;
}

function getSegmenter() {
  if (!segmenter && "Segmenter" in Intl) {
    segmenter = new Intl.Segmenter("ja", { granularity: "word" });
  }
  return segmenter;
}

export function normalizeText(value: string) {
  return value
    .replace(/\u00a0/g, " ")
    .replace(/\r/g, "\n")
    .replace(/([一-龯ぁ-ゖァ-ヺ々ー])\s+([一-龯ぁ-ゖァ-ヺ々ー])/gu, "$1$2")
    .replace(/[ \t\f\v]+/g, " ")
    .replace(/\n+/g, "\n")
    .trim();
}

export function splitIntoSentences(text: string) {
  const normalized = normalizeText(text);
  const sentences: string[] = [];
  let buffer = "";
  const chars = Array.from(normalized);

  for (let index = 0; index < chars.length; index += 1) {
    const char = chars[index];
    buffer += char;

    if (!SENTENCE_END.test(char)) {
      continue;
    }

    while (index + 1 < chars.length && CLOSING_PUNCTUATION.test(chars[index + 1])) {
      index += 1;
      buffer += chars[index];
    }

    const sentence = normalizeText(buffer);
    if (sentence) {
      sentences.push(sentence);
    }
    buffer = "";
  }

  const remainder = normalizeText(buffer);
  if (remainder) {
    sentences.push(remainder);
  }

  return sentences;
}

export async function tokenizeJapanese(text: string, sentenceId = "sentence"): Promise<RsvpToken[]> {
  const normalized = normalizeText(text);
  return tokenizeWithTinySegmenter(normalized, sentenceId);
}

export function warmJapaneseTokenizer() {
  tinySegmenter ??= new TinySegmenter();
}

function tokenizeWithTinySegmenter(text: string, sentenceId = "sentence") {
  warmJapaneseTokenizer();
  const normalized = normalizeText(text);
  let cursor = 0;
  const drafts = tinySegmenter!
    .segment(normalized)
    .filter((tokenText) => tokenText.trim().length > 0)
    .map((tokenText) => {
      const start = normalized.indexOf(tokenText, cursor);
      const safeStart = start >= 0 ? start : cursor;
      cursor = safeStart + tokenText.length;

      return {
        text: tokenText,
        start: safeStart,
        end: cursor,
        isWordLike: isJapaneseWordLike(tokenText) && !PUNCTUATION_ONLY.test(tokenText),
        isPunctuation: PUNCTUATION_ONLY.test(tokenText),
      };
    });

  return finalizeTokens(mergeTokenDrafts(drafts), sentenceId);
}

function tokenizeJapaneseFallback(text: string, sentenceId = "sentence"): RsvpToken[] {
  const normalized = normalizeText(text);
  const intlSegmenter = getSegmenter();

  if (!intlSegmenter) {
    return fallbackTokenize(normalized, sentenceId);
  }

  const drafts = Array.from(intlSegmenter.segment(normalized))
    .filter((segment) => segment.segment.trim().length > 0)
    .map((segment) => {
      const tokenText = segment.segment;

      return {
        text: tokenText,
        start: segment.index,
        end: segment.index + tokenText.length,
        isWordLike: Boolean(segment.isWordLike) && isJapaneseWordLike(tokenText),
        isPunctuation: PUNCTUATION_ONLY.test(tokenText),
      };
    });

  return finalizeTokens(mergeTokenDrafts(drafts), sentenceId);
}

function fallbackTokenize(text: string, sentenceId: string): RsvpToken[] {
  let cursor = 0;
  return Array.from(text)
    .filter((char) => char.trim().length > 0)
    .map((char, index) => {
      const start = cursor;
      cursor += char.length;

      return {
        id: `${sentenceId}:token:${index}`,
        index,
        text: char,
        start,
        end: cursor,
        isWordLike: JAPANESE_CHAR.test(char),
        isPunctuation: PUNCTUATION_ONLY.test(char),
      };
    });
}

function mergeTokenDrafts(tokens: TokenDraft[]) {
  const merged: TokenDraft[] = [];

  for (let index = 0; index < tokens.length; index += 1) {
    const pattern = findMergePattern(tokens, index);
    if (pattern) {
      merged.push(combineDrafts(tokens.slice(index, index + pattern.length)));
      index += pattern.length - 1;
      continue;
    }

    const token = tokens[index];
    const previous = merged.at(-1);
    if (previous && shouldMergeWithPrevious(previous, token)) {
      mergeInto(previous, token);
      continue;
    }

    merged.push({ ...token });
  }

  return merged;
}

function findMergePattern(tokens: TokenDraft[], startIndex: number) {
  return MERGE_PATTERNS.find((pattern) =>
    pattern.every((text, offset) => tokens[startIndex + offset]?.text === text),
  );
}

function combineDrafts(tokens: TokenDraft[]) {
  const [first] = tokens;
  const combined = { ...first };
  for (const token of tokens.slice(1)) {
    mergeInto(combined, token);
  }
  return combined;
}

function mergeInto(target: TokenDraft, token: TokenDraft) {
  target.text += token.text;
  target.end = token.end;
  target.isWordLike = target.isWordLike || token.isWordLike;
  target.isPunctuation = target.isPunctuation && token.isPunctuation;
}

function shouldMergeWithPrevious(previous: TokenDraft, token: TokenDraft) {
  const combined = `${previous.text}${token.text}`;

  if (new Set(["だった", "でした", "じゃない", "ではない"]).has(combined)) {
    return true;
  }

  if (previous.text.endsWith("っ") && token.text === "た") {
    return true;
  }

  return false;
}

function finalizeTokens(tokens: TokenDraft[], sentenceId: string): RsvpToken[] {
  return tokens.map((token, index) => ({
    id: `${sentenceId}:token:${index}`,
    index,
    text: token.text,
    start: token.start,
    end: token.end,
    isWordLike: token.isWordLike,
    isPunctuation: token.isPunctuation,
  }));
}

function isJapaneseWordLike(text: string) {
  return Array.from(text).some((char) => JAPANESE_CHAR.test(char));
}

export function createSentence(
  text: string,
  chapterId: string,
  chapterIndex: number,
  index: number,
  globalIndex: number,
): Sentence | null {
  const normalized = normalizeText(text);
  if (!normalized) {
    return null;
  }

  const id = `${chapterId}:sentence:${index}`;
  const tokens = tokenizeJapaneseFallback(normalized, id);
  if (tokens.length === 0) {
    return null;
  }

  return {
    id,
    chapterId,
    chapterIndex,
    index,
    globalIndex,
    text: normalized,
    tokens,
  };
}

export async function createSentenceWithTokenizer(
  text: string,
  chapterId: string,
  chapterIndex: number,
  index: number,
  globalIndex: number,
): Promise<Sentence | null> {
  const normalized = normalizeText(text);
  if (!normalized) {
    return null;
  }

  const id = `${chapterId}:sentence:${index}`;
  const tokens = await tokenizeJapanese(normalized, id);
  if (tokens.length === 0) {
    return null;
  }

  return {
    id,
    chapterId,
    chapterIndex,
    index,
    globalIndex,
    text: normalized,
    tokens,
  };
}

export function sentenceTextFromParagraphs(paragraphs: string[]) {
  return paragraphs.flatMap((paragraph) => splitIntoSentences(paragraph));
}
