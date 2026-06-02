import type { Book, ReaderSettings, Sentence } from "../types";

export const RECAP_PAGE_LIMIT = 5;

const MAX_RECAP_CONTEXT_CHARS = 16_000;
const MAX_RECAP_TOKENS = 700;

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
  const model = settings.recapModel.trim();

  if (!apiUrl || !apiKey) {
    throw new Error("Add an AI URL and API key in Settings.");
  }

  if (pages.length === 0) {
    throw new Error("No previous text is available to recap yet.");
  }

  const payload: Record<string, unknown> = {
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
    max_tokens: MAX_RECAP_TOKENS,
    temperature: 0.2,
  };

  if (model) {
    payload.model = model;
  }

  const response = await fetch(apiUrl, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    throw new Error(`AI request failed (${response.status}).`);
  }

  const bodyText = await response.text();
  const summary = extractSummaryFromResponse(bodyText);
  if (!summary) {
    throw new Error("The AI response did not include a readable summary.");
  }

  return summary;
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

function textFromValue(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
