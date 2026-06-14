import type { Book, ReaderSettings, Sentence } from "../types";

export const RECAP_PAGE_LIMIT = 5;

const MAX_RECAP_CONTEXT_CHARS = 16_000;
const MAX_RECAP_TOKENS = 700;
const MAX_TRANSLATION_TOKENS = 160;
const TRANSLATION_MODEL = "gpt-5.4-nano";
const REASONING_FALLBACK_TOKENS = 2_000;

export interface RecapPage {
  index: number;
  title: string;
  text: string;
}

export function getRecapPages(
  book: Book | undefined,
  currentSentence: Sentence | undefined,
  pageLimit = RECAP_PAGE_LIMIT,
) {
  if (!book || !currentSentence) {
    return [];
  }

  const currentChapterIndex = book.chapters.findIndex(
    (chapter) => chapter.id === currentSentence.chapterId,
  );
  if (currentChapterIndex < 0) {
    return [];
  }

  const pages: RecapPage[] = [];
  for (
    let chapterIndex = currentChapterIndex;
    chapterIndex >= 0 && pages.length < pageLimit;
    chapterIndex -= 1
  ) {
    const chapter = book.chapters[chapterIndex];
    const pageSentences =
      chapter.id === currentSentence.chapterId
        ? chapter.sentences.filter(
            (sentence) => sentence.globalIndex < currentSentence.globalIndex,
          )
        : chapter.sentences;
    const text = pageSentences.map((sentence) => sentence.text).join("\n").trim();

    if (text) {
      pages.push({
        index: chapter.index,
        title: chapter.title,
        text,
      });
    }
  }

  return trimRecapPages(pages.reverse(), MAX_RECAP_CONTEXT_CHARS);
}

export async function generateAiRecap({
  settings,
  bookTitle,
  pages,
}: {
  settings: Pick<ReaderSettings, "recapApiKey" | "recapApiUrl" | "recapModel">;
  bookTitle: string;
  pages: RecapPage[];
}) {
  const apiUrl = settings.recapApiUrl.trim();
  const apiKey = settings.recapApiKey.trim();

  if (!apiUrl || !apiKey) {
    throw new Error("Add an AI URL and API key in Settings.");
  }

  if (pages.length === 0) {
    throw new Error("No previous text is available to recap yet.");
  }

  return generateAiText({
    settings,
    messages: [
      {
        role: "system",
        content:
          "You summarize prior context for a reader. Summarize only what happened in the supplied excerpt; do not continue the story or invent details.",
      },
      {
        role: "user",
        content: buildRecapPrompt(bookTitle, pages),
      },
    ],
    maxTokens: MAX_RECAP_TOKENS,
    emptyResponseError: "The AI response did not include a readable summary.",
  });
}

export async function generateAiSentenceTranslation({
  settings,
  sentenceText,
}: {
  settings: Pick<ReaderSettings, "recapApiKey" | "recapApiUrl" | "recapModel">;
  sentenceText: string;
}) {
  const text = sentenceText.trim();
  if (!text) {
    throw new Error("No sentence is available to translate.");
  }

  const translation = await generateAiText({
    settings,
    messages: [
      {
        role: "system",
        content:
          "You translate Japanese sentences for an English-speaking reader. Return only the English translation with no labels, notes, markdown, or alternatives.",
      },
      {
        role: "user",
        content: buildSentenceTranslationPrompt(text),
      },
    ],
    maxTokens: MAX_TRANSLATION_TOKENS,
    model: TRANSLATION_MODEL,
    reasoningEffort: "none",
    emptyResponseError: "The AI response did not include a readable translation.",
  });

  return cleanSentenceTranslation(translation);
}

async function generateAiText({
  settings,
  messages,
  maxTokens,
  model,
  reasoningEffort,
  emptyResponseError,
}: {
  settings: Pick<ReaderSettings, "recapApiKey" | "recapApiUrl" | "recapModel">;
  messages: Array<{ role: "system" | "user"; content: string }>;
  maxTokens: number;
  model?: string;
  reasoningEffort?: "none" | "low";
  emptyResponseError: string;
}) {
  const apiUrl = settings.recapApiUrl.trim();
  const apiKey = settings.recapApiKey.trim();
  const selectedModel = model ?? settings.recapModel.trim();

  if (!apiUrl || !apiKey) {
    throw new Error("Add an AI URL and API key in Settings.");
  }

  const basePayload: Record<string, unknown> = { messages };
  if (selectedModel) {
    basePayload.model = selectedModel;
  }

  async function post(payloadToSend: Record<string, unknown>) {
    const response = await fetch(apiUrl, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payloadToSend),
    });

    const bodyText = await response.text();
    const parsedBody = parseJson(bodyText);

    if (!response.ok) {
      let parsedMessage = `AI request failed (${response.status}).`;
      try {
        const parsed = JSON.parse(bodyText) as { error?: { message?: string } };
        if (typeof parsed?.error?.message === "string") {
          parsedMessage = parsed.error.message;
        }
      } catch {
        // keep fallback message
      }

      const error = new Error(parsedMessage) as Error & {
        status?: number;
        body?: string;
      };
      error.status = response.status;
      error.body = bodyText;
      throw error;
    }

    const summary = extractSummaryFromJson(parsedBody ?? bodyText).trim();

    return {
      summary,
      parsedBody,
    };
  }

  const buildPayload = ({
    useMaxCompletionTokens,
    maxCompletionTokens,
    useReasoningEffort,
  }: {
    useMaxCompletionTokens: boolean;
    maxCompletionTokens: number;
    useReasoningEffort: boolean;
  }) => {
    const payload = { ...basePayload };
    if (useMaxCompletionTokens) {
      payload.max_completion_tokens = maxCompletionTokens;
      delete payload.max_tokens;
    } else {
      payload.max_tokens = maxCompletionTokens;
      delete payload.max_completion_tokens;
    }
    if (useReasoningEffort) {
      payload.reasoning_effort = reasoningEffort ?? "low";
    } else {
      delete payload.reasoning_effort;
    }
    return payload;
  };

  let useMaxCompletionTokens = true;
  let maxCompletionTokens = maxTokens;
  let useReasoningEffort = Boolean(reasoningEffort);
  const maxAttempts = 5;
  let didIncreaseTokens = false;

  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    try {
      const { summary, parsedBody } = await post(
        buildPayload({
          useMaxCompletionTokens,
          maxCompletionTokens,
          useReasoningEffort,
        }),
      );
      if (summary) {
        return summary;
      }

      const reasoningOnlyOutput = hasReasoningOnlyOutput({ parsedBody, summary });

      if (reasoningOnlyOutput && !useReasoningEffort) {
        useReasoningEffort = true;
        continue;
      }

      if (reasoningOnlyOutput && !didIncreaseTokens) {
        maxCompletionTokens = Math.max(REASONING_FALLBACK_TOKENS, maxCompletionTokens * 2);
        didIncreaseTokens = true;
        continue;
      }

      throw new Error(emptyResponseError);
    } catch (error) {
      const parsedMessage = error instanceof Error ? error.message : "";
      const status = (error as Error & { status?: number }).status;

      if (status !== 400) {
        if (parsedMessage.includes("AI request failed (")) {
          throw error instanceof Error
            ? error
            : new Error("AI request failed with an unknown error.");
        }

        throw error instanceof Error
          ? new Error(`AI request failed. ${parsedMessage || "Please check your endpoint and model."}`)
          : new Error("AI request failed.");
      }

      if (
        parsedMessage.includes("Unsupported parameter: 'max_tokens'") &&
        !useMaxCompletionTokens
      ) {
        useMaxCompletionTokens = true;
        continue;
      }

      if (
        parsedMessage.includes("Unsupported parameter: 'max_completion_tokens'") &&
        useMaxCompletionTokens
      ) {
        useMaxCompletionTokens = false;
        continue;
      }

      if (
        parsedMessage.includes("Unsupported parameter: 'reasoning_effort'") &&
        useReasoningEffort
      ) {
        useReasoningEffort = false;
        if (!didIncreaseTokens) {
          maxCompletionTokens = Math.max(REASONING_FALLBACK_TOKENS, maxCompletionTokens * 2);
          didIncreaseTokens = true;
          continue;
        }
        throw new Error(`AI request failed. ${parsedMessage}`);
      }

      if (parsedMessage.includes("AI request failed (")) {
        throw error instanceof Error
          ? error
          : new Error("AI request failed with an unknown error.");
      }

      throw error instanceof Error
        ? new Error(`AI request failed. ${parsedMessage || "Please check your endpoint and model."}`)
        : new Error("AI request failed.");
    }
  }

  throw new Error("AI request failed. No compatible payload was accepted.");
}

export function buildRecapPrompt(bookTitle: string, pages: RecapPage[]) {
  const excerpts = pages
    .map(
      (page, pageIndex) =>
        `Page ${pageIndex + 1}: ${page.title || `Section ${page.index + 1}`}\n${page.text}`,
    )
    .join("\n\n");

  return [
    `Book: ${bookTitle}`,
    "Previous reading context:",
    excerpts,
    "Write a concise recap in English. Keep names and important source-language terms as written.",
  ].join("\n\n");
}

export function buildSentenceTranslationPrompt(sentenceText: string) {
  return [
    "Translate this Japanese sentence into natural English.",
    "Preserve names and do not explain grammar.",
    "",
    sentenceText,
  ].join("\n");
}

export function extractSummaryFromResponse(bodyText: string) {
  const trimmed = bodyText.trim();
  if (!trimmed) {
    return "";
  }

  try {
    const parsed = JSON.parse(trimmed) as unknown;
    return extractSummaryFromJson(parsed).trim();
  } catch {
    return trimmed;
  }
}

function trimRecapPages(pages: RecapPage[], maxChars: number) {
  let remaining = maxChars;
  const trimmed: RecapPage[] = [];

  for (let index = pages.length - 1; index >= 0 && remaining > 0; index -= 1) {
    const page = pages[index];
    const text =
      page.text.length <= remaining ? page.text : page.text.slice(page.text.length - remaining);

    if (text.trim()) {
      trimmed.push({ ...page, text: text.trimStart() });
      remaining -= text.length;
    }
  }

  return trimmed.reverse();
}

function extractSummaryFromJson(value: unknown): string {
  if (typeof value === "string") {
    return value;
  }

  if (Array.isArray(value)) {
    return value.map(extractSummaryFromJson).filter(Boolean).join("\n").trim();
  }

  if (!isRecord(value)) {
    return "";
  }

  const directText = textFromValue(value.summary) || textFromValue(value.text);
  if (directText) {
    return directText;
  }

  const outputText = textFromValue(value.output_text);
  if (outputText) {
    return outputText;
  }

  const choices = Array.isArray(value.choices) ? value.choices : [];
  for (const choice of choices) {
    if (!isRecord(choice)) {
      continue;
    }

    const message = isRecord(choice.message) ? choice.message : null;
    const messageText = message ? extractSummaryFromJson(message.content) : "";
    const choiceText = messageText || textFromValue(choice.text) || extractSummaryFromJson(choice);
    if (choiceText) {
      return choiceText;
    }
  }

  const contentText = extractSummaryFromJson(value.content);
  if (contentText) {
    return contentText;
  }

  const output = Array.isArray(value.output) ? value.output : [];
  for (const item of output) {
    const itemText = extractSummaryFromJson(item);
    if (itemText) {
      return itemText;
    }
  }

  return "";
}

function parseJson(bodyText: string) {
  try {
    return JSON.parse(bodyText) as unknown;
  } catch {
    return undefined;
  }
}

function hasReasoningOnlyOutput({
  parsedBody,
  summary,
}: {
  parsedBody: unknown;
  summary: string;
}) {
  if (summary.trim()) {
    return false;
  }

  if (!isRecord(parsedBody) || !isRecord(parsedBody.usage)) {
    return false;
  }

  const usage = parsedBody.usage as Record<string, unknown>;
  const completionTokens = typeof usage.completion_tokens === "number" ? usage.completion_tokens : null;
  const completionDetails = isRecord(usage.completion_tokens_details)
    ? usage.completion_tokens_details
    : null;
  const reasoningTokens =
    typeof completionDetails?.reasoning_tokens === "number" ? completionDetails.reasoning_tokens : 0;

  if (!completionTokens || reasoningTokens < completionTokens) {
    return false;
  }

  const choices = Array.isArray(parsedBody.choices) ? parsedBody.choices : [];
  const firstChoice = (choices[0] ?? null) as unknown;
  if (!isRecord(firstChoice)) {
    return false;
  }
  const finishReason = firstChoice.finish_reason;
  return (
    finishReason === "length" ||
    finishReason === "incomplete"
  );
}

function textFromValue(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function cleanSentenceTranslation(value: string) {
  return value
    .trim()
    .replace(/^["“](.*)["”]$/s, "$1")
    .replace(/^(translation|english):\s*/i, "")
    .trim();
}
