import { afterEach, describe, expect, it, vi } from "vitest";
import type { Book, Chapter, ReaderSettings, Sentence } from "../types";
import { createSentence } from "./text";
import { DEFAULT_SETTINGS } from "./rsvp";
import {
  buildSentenceTranslationPrompt,
  buildRecapPrompt,
  extractSummaryFromResponse,
  generateAiRecap,
  generateAiSentenceTranslation,
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

  it("builds a sentence translation prompt without provider details", () => {
    const prompt = buildSentenceTranslationPrompt("猫が走る。");

    expect(prompt).toContain("猫が走る。");
    expect(prompt).toContain("natural English");
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
      max_completion_tokens: 700,
    });
    expect(JSON.parse(String(init?.body))).not.toHaveProperty("temperature");
  });

  it("posts an OpenAI-compatible sentence translation request", async () => {
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => {
      return new Response(
        JSON.stringify({ choices: [{ message: { content: '"The cat runs."' } }] }),
        { status: 200 },
      );
    });
    globalThis.fetch = fetchMock;

    const settings: ReaderSettings = {
      ...DEFAULT_SETTINGS,
      recapApiUrl: "https://example.invalid/chat",
      recapApiKey: "user-entered-key",
      recapModel: "user-entered-model",
    };

    await expect(
      generateAiSentenceTranslation({
        settings,
        sentenceText: "猫が走る。",
      }),
    ).resolves.toBe("The cat runs.");

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [, init] = fetchMock.mock.calls[0];
    expect(init?.headers).toMatchObject({
      Authorization: "Bearer user-entered-key",
      "Content-Type": "application/json",
    });
    const payload = JSON.parse(String(init?.body));
    expect(payload).toMatchObject({
      model: "gpt-5.4-nano",
      max_completion_tokens: 160,
      reasoning_effort: "none",
    });
    expect(payload.messages[1].content).toContain("猫が走る。");
  });

  it("switches to max_tokens when the model rejects max_completion_tokens", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            error: {
              message:
                "Unsupported parameter: 'max_completion_tokens' is not supported with this model. Use 'max_tokens' instead.",
            },
          }),
          { status: 400 },
        ),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ choices: [{ message: { content: "Summary." } }] }), {
          status: 200,
        }),
      );
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

    expect(fetchMock).toHaveBeenCalledTimes(2);
    const [, firstInit] = fetchMock.mock.calls[0];
    const [, secondInit] = fetchMock.mock.calls[1];
    expect(JSON.parse(String(firstInit?.body))).toMatchObject({
      max_completion_tokens: 700,
    });
    expect(JSON.parse(String(secondInit?.body))).toMatchObject({
      max_tokens: 700,
    });
    expect(JSON.parse(String(secondInit?.body))).not.toHaveProperty("max_completion_tokens");
  });

  it("retries when the response is reasoning-only for gpt-5 style models", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            id: "chatcmpl-test",
            object: "chat.completion",
            created: 1780425090,
            model: "gpt-5-nano-2025-08-07",
            choices: [
              {
                index: 0,
                message: {
                  role: "assistant",
                  content: "",
                  refusal: null,
                  annotations: [],
                },
                finish_reason: "length",
              },
            ],
            usage: {
              completion_tokens: 700,
              prompt_tokens: 985,
              total_tokens: 1685,
              completion_tokens_details: {
                reasoning_tokens: 700,
              },
            },
          }),
          { status: 200 },
        ),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ choices: [{ message: { content: "Summary." } }] }), {
          status: 200,
        }),
      );
    globalThis.fetch = fetchMock;

    const settings: ReaderSettings = {
      ...DEFAULT_SETTINGS,
      recapApiUrl: "https://example.invalid/recap",
      recapApiKey: "user-entered-key",
      recapModel: "gpt-5-nano-2025-08-07",
    };

    await expect(
      generateAiRecap({
        settings,
        bookTitle: "本",
        pages: [{ index: 0, title: "第一章", text: "猫が走る。" }],
      }),
    ).resolves.toBe("Summary.");

    expect(fetchMock).toHaveBeenCalledTimes(2);
    const [, firstInit] = fetchMock.mock.calls[0];
    const [, secondInit] = fetchMock.mock.calls[1];
    expect(JSON.parse(String(firstInit?.body))).toMatchObject({
      max_completion_tokens: 700,
    });
    expect(JSON.parse(String(firstInit?.body))).not.toHaveProperty("reasoning_effort");
    expect(JSON.parse(String(secondInit?.body))).toMatchObject({
      reasoning_effort: "low",
    });
  });

  it("does not retry with max_tokens when max_completion_tokens is already in use", async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          error: {
            message:
              "Unsupported parameter: 'max_tokens' is not supported with this model. Use 'max_completion_tokens' instead.",
          },
        }),
        { status: 400 },
      ),
    );
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
    ).rejects.toThrow("AI request failed.");

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [, firstInit] = fetchMock.mock.calls[0];
    expect(JSON.parse(String(firstInit?.body))).toMatchObject({
      max_completion_tokens: 700,
    });
    expect(JSON.parse(String(firstInit?.body))).not.toHaveProperty("max_tokens");
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
