import { afterEach, describe, expect, it, vi } from "vitest";
import type { Book, Chapter, ReaderSettings, Sentence } from "../types";
import { createSentence } from "./text";
import { DEFAULT_SETTINGS } from "./rsvp";
import {
  buildRecapPrompt,
  extractSummaryFromResponse,
  generateAiRecap,
  getRecapPages,
} from "./recap";

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
  vi.restoreAllMocks();
});

describe("recap helpers", () => {
  it("collects up to five prior readable pages in reading order", () => {
    const book = makeBook([
      ["一ページ目。"],
      ["二ページ目。"],
      ["三ページ目。"],
      ["四ページ目。"],
      ["五ページ目。"],
      ["六ページ目の前半。", "六ページ目の現在。"],
    ]);
    const currentSentence = book.chapters[5].sentences[1];

    expect(getRecapPages(book, currentSentence).map((page) => page.text)).toEqual([
      "二ページ目。",
      "三ページ目。",
      "四ページ目。",
      "五ページ目。",
      "六ページ目の前半。",
    ]);
  });

  it("skips the current page when there is no prior text on it", () => {
    const book = makeBook([
      ["一ページ目。"],
      ["二ページ目。"],
      ["三ページ目。"],
    ]);
    const currentSentence = book.chapters[2].sentences[0];

    expect(getRecapPages(book, currentSentence).map((page) => page.text)).toEqual([
      "一ページ目。",
      "二ページ目。",
    ]);
  });

  it("builds the recap prompt without including provider details", () => {
    const prompt = buildRecapPrompt("本", [{ index: 0, title: "第一章", text: "猫が走る。" }]);

    expect(prompt).toContain("Book: 本");
    expect(prompt).toContain("猫が走る。");
    expect(prompt).not.toContain("Authorization");
  });

  it("extracts summaries from common AI response shapes", () => {
    expect(
      extractSummaryFromResponse(
        JSON.stringify({ choices: [{ message: { content: "A concise summary." } }] }),
      ),
    ).toBe("A concise summary.");
    expect(extractSummaryFromResponse(JSON.stringify({ output_text: "Output summary." }))).toBe(
      "Output summary.",
    );
    expect(extractSummaryFromResponse("Plain summary.")).toBe("Plain summary.");
  });

  it("posts an OpenAI-compatible recap request to the user-entered endpoint", async () => {
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => {
      return new Response(JSON.stringify({ choices: [{ message: { content: "Summary." } }] }), {
        status: 200,
      });
    });
    globalThis.fetch = fetchMock;

    const settings: ReaderSettings = {
      ...DEFAULT_SETTINGS,
      recapApiUrl: "https://example.invalid/recap",
      recapApiKey: "user-entered-key",
      recapModel: "user-entered-model",
    };

    await expect(
      generateAiRecap({
        settings,
        bookTitle: "本",
        pages: [{ index: 0, title: "第一章", text: "猫が走る。" }],
      }),
    ).resolves.toBe("Summary.");

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [, init] = fetchMock.mock.calls[0];
    expect(init?.headers).toMatchObject({
      Authorization: "Bearer user-entered-key",
      "Content-Type": "application/json",
    });
    expect(JSON.parse(String(init?.body))).toMatchObject({
      model: "user-entered-model",
      temperature: 0.2,
    });
  });
});

function makeBook(chapterTexts: string[][]): Book {
  let globalIndex = 0;
  const chapters: Chapter[] = chapterTexts.map((sentences, chapterIndex) => {
    const chapterId = `chapter:${chapterIndex}`;
    const chapterSentences = sentences.map((text, sentenceIndex) => {
      const sentence = createSentence(
        text,
        chapterId,
        chapterIndex,
        sentenceIndex,
        globalIndex,
      ) as Sentence;
      globalIndex += 1;
      return sentence;
    });

    return {
      id: chapterId,
      index: chapterIndex,
      title: `Chapter ${chapterIndex + 1}`,
      href: `chapter-${chapterIndex + 1}.xhtml`,
      sentences: chapterSentences,
    };
  });

  return {
    id: "book:recap",
    title: "本",
    fileName: "book.epub",
    createdAt: "2026-06-02T00:00:00.000Z",
    chapters,
    progress: { sentenceIndex: 0, tokenIndex: 0 },
  };
}
