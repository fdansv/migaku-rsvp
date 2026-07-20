import { afterEach, describe, expect, it, vi } from "vitest";
import type { Book, Chapter, ReaderSettings, Sentence } from "../types";
import { createSentence } from "./text";
import { DEFAULT_SETTINGS } from "./rsvp";
import {
  buildRecapFollowUpPrompt,
  buildSentenceTranslationPrompt,
  buildRecapPrompt,
  extractSummaryFromResponse,
  generateAiRecap,
  generateAiRecapFollowUp,
  generateAiSentenceTranslation,
  getRecapPages,
} from "./recap";

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
  vi.restoreAllMocks();
});

describe("recap helpers", () => {
  it("collects up to three prior readable pages in reading order", () => {
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

  it("can trim recap context for constrained local server models", () => {
    const book = makeBook([
      ["前の文。"],
      ["あ".repeat(1_500), "現在の文。"],
    ]);
    const currentSentence = book.chapters[1].sentences[1];

    const pages = getRecapPages(book, currentSentence, 1, 20);

    expect(pages).toHaveLength(1);
    expect(pages[0].text).toHaveLength(20);
    expect(pages[0].text).toBe("あ".repeat(20));
  });

  it("builds the recap prompt without including provider details", () => {
    const prompt = buildRecapPrompt("本", [{ index: 0, title: "第一章", text: "猫が走る。" }]);

    expect(prompt).toContain("Book: 本");
    expect(prompt).toContain("猫が走る。");
    expect(prompt).toContain("no more than three short paragraphs");
    expect(prompt).toContain("120 words or fewer");
    expect(prompt).not.toContain("Authorization");
  });

  it("builds a recap follow-up prompt from the recap context and prior Q&A", () => {
    const prompt = buildRecapFollowUpPrompt({
      bookTitle: "本",
      pages: [{ index: 0, title: "第一章", text: "猫が走る。" }],
      summary: "A cat runs through the room.",
      history: [{ question: "Where is the cat?", answer: "The excerpt does not say." }],
      question: "Who runs?",
    });

    expect(prompt).toContain("Book: 本");
    expect(prompt).toContain("猫が走る。");
    expect(prompt).toContain("A cat runs through the room.");
    expect(prompt).toContain("Q1: Where is the cat?");
    expect(prompt).toContain("Question:");
    expect(prompt).toContain("Who runs?");
    expect(prompt).toContain("about one short paragraph");
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
      max_completion_tokens: 320,
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
      translationModel: "user-entered-translation-model",
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
      model: "user-entered-translation-model",
      max_completion_tokens: 160,
      reasoning_effort: "none",
    });
    expect(payload.messages[1].content).toContain("猫が走る。");
  });

  it("falls back to the recap model for sentence translations", async () => {
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => {
      return new Response(JSON.stringify({ choices: [{ message: { content: "The cat runs." } }] }), {
        status: 200,
      });
    });
    globalThis.fetch = fetchMock;

    await generateAiSentenceTranslation({
      settings: {
        ...DEFAULT_SETTINGS,
        recapApiUrl: "https://example.invalid/chat",
        recapApiKey: "user-entered-key",
        recapModel: "shared-local-model",
        translationModel: "",
      },
      sentenceText: "猫が走る。",
    });

    const [, init] = fetchMock.mock.calls[0];
    expect(JSON.parse(String(init?.body))).toMatchObject({
      model: "shared-local-model",
    });
  });

  it("allows same-origin server AI proxy requests without a browser API key", async () => {
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => {
      return new Response(JSON.stringify({ choices: [{ message: { content: "The cat runs." } }] }), {
        status: 200,
      });
    });
    globalThis.fetch = fetchMock;

    await expect(
      generateAiSentenceTranslation({
        settings: {
          ...DEFAULT_SETTINGS,
          recapApiUrl: "/api/ai/chat",
          recapApiKey: "",
          recapModel: "user-entered-model",
        },
        sentenceText: "猫が走る。",
      }),
    ).resolves.toBe("The cat runs.");

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [, init] = fetchMock.mock.calls[0];
    expect(init?.headers).toMatchObject({
      "Content-Type": "application/json",
    });
    expect(init?.headers).not.toHaveProperty("Authorization");
  });

  it("allows same-origin server AI recap requests without a browser API key", async () => {
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => {
      return new Response(JSON.stringify({ choices: [{ message: { content: "Summary." } }] }), {
        status: 200,
      });
    });
    globalThis.fetch = fetchMock;

    await expect(
      generateAiRecap({
        settings: {
          ...DEFAULT_SETTINGS,
          recapApiUrl: "/api/ai/chat",
          recapApiKey: "",
          recapModel: "local-summary-model",
        },
        bookTitle: "本",
        pages: [{ index: 0, title: "第一章", text: "猫が走る。" }],
      }),
    ).resolves.toBe("Summary.");

    const [, init] = fetchMock.mock.calls[0];
    expect(init?.headers).toMatchObject({
      "Content-Type": "application/json",
    });
    expect(init?.headers).not.toHaveProperty("Authorization");
    expect(JSON.parse(String(init?.body))).toMatchObject({
      max_completion_tokens: 320,
    });
  });

  it("posts a recap follow-up request with the recap and prior answers", async () => {
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => {
      return new Response(JSON.stringify({ choices: [{ message: { content: "The cat runs." } }] }), {
        status: 200,
      });
    });
    globalThis.fetch = fetchMock;

    await expect(
      generateAiRecapFollowUp({
        settings: {
          ...DEFAULT_SETTINGS,
          recapApiUrl: "/api/ai/chat",
          recapApiKey: "",
          recapModel: "local-summary-model",
        },
        bookTitle: "本",
        pages: [{ index: 0, title: "第一章", text: "猫が走る。" }],
        summary: "A cat runs through the room.",
        history: [{ question: "Where is it?", answer: "The excerpt does not say." }],
        question: "Who runs?",
      }),
    ).resolves.toBe("The cat runs.");

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [, init] = fetchMock.mock.calls[0];
    const payload = JSON.parse(String(init?.body));
    expect(payload).toMatchObject({
      model: "local-summary-model",
      max_completion_tokens: 260,
      reasoning_effort: "none",
    });
    expect(payload.messages[1].content).toContain("A cat runs through the room.");
    expect(payload.messages[1].content).toContain("Q1: Where is it?");
    expect(payload.messages[1].content).toContain("Who runs?");
  });

  it("surfaces AI request timeouts", async () => {
    const abortError = new Error("The operation was aborted.");
    abortError.name = "AbortError";
    globalThis.fetch = vi.fn(async () => {
      throw abortError;
    });

    await expect(
      generateAiRecapFollowUp({
        settings: {
          ...DEFAULT_SETTINGS,
          recapApiUrl: "/api/ai/chat",
          recapApiKey: "",
          recapModel: "local-summary-model",
        },
        bookTitle: "本",
        pages: [{ index: 0, title: "第一章", text: "猫が走る。" }],
        summary: "A cat runs through the room.",
        history: [],
        question: "Who runs?",
      }),
    ).rejects.toThrow("AI request timed out.");
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
      max_completion_tokens: 320,
    });
    expect(JSON.parse(String(secondInit?.body))).toMatchObject({
      max_tokens: 320,
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
              completion_tokens: 320,
              prompt_tokens: 985,
              total_tokens: 1305,
              completion_tokens_details: {
                reasoning_tokens: 320,
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
      max_completion_tokens: 320,
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
      max_completion_tokens: 320,
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
