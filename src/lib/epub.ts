import JSZip from "jszip";
import type { Book, Chapter } from "../types";
import {
  CURRENT_TOKENIZER_VERSION,
  createSentenceWithTokenizer,
  normalizeText,
  sentenceTextFromParagraphs,
} from "./text";

const XHTML_MEDIA_TYPES = new Set([
  "application/xhtml+xml",
  "text/html",
  "application/xml",
]);

export async function parseEpub(input: File | Blob | ArrayBuffer, fileName?: string): Promise<Book> {
  const sourceName = fileName ?? (input instanceof File ? input.name : "Imported book.epub");
  const buffer = input instanceof ArrayBuffer ? input : await input.arrayBuffer();
  const zip = await JSZip.loadAsync(buffer);
  const container = await readRequiredText(zip, "META-INF/container.xml");
  const containerDoc = parseXml(container, "container.xml");
  const rootFile = firstElement(containerDoc, "rootfile");
  const opfPath = rootFile?.getAttribute("full-path");

  if (!opfPath) {
    throw new Error("This EPUB does not declare a package document.");
  }

  const opfText = await readRequiredText(zip, opfPath);
  const opf = parseXml(opfText, opfPath);
  const opfBase = directoryName(opfPath);
  const metadata = readMetadata(opf, sourceName);
  const manifest = readManifest(opf, opfBase);
  const spine = readSpine(opf);

  const chapters: Chapter[] = [];
  let globalSentenceIndex = 0;

  for (const [chapterIndex, idref] of spine.entries()) {
    const item = manifest.get(idref);
    if (!item || !XHTML_MEDIA_TYPES.has(item.mediaType)) {
      continue;
    }

    const xhtml = await zip.file(item.href)?.async("text");
    if (!xhtml) {
      continue;
    }

    const paragraphs = extractParagraphs(xhtml, item.href);
    const sentenceTexts = sentenceTextFromParagraphs(paragraphs);
    const chapterId = `chapter:${chapters.length}`;
    const title = firstUsefulText(paragraphs) ?? `Chapter ${chapters.length + 1}`;
    const sentences: Chapter["sentences"] = [];
    for (const [sentenceIndex, sentenceText] of sentenceTexts.entries()) {
      const sentence = await createSentenceWithTokenizer(
        sentenceText,
        chapterId,
        chapterIndex,
        sentenceIndex,
        globalSentenceIndex,
      );
      if (sentence) {
        sentences.push(sentence);
        globalSentenceIndex += 1;
      }
    }

    if (sentences.length > 0) {
      chapters.push({
        id: chapterId,
        index: chapters.length,
        title,
        href: item.href,
        sentences,
      });
    }
  }

  if (chapters.length === 0) {
    throw new Error("No readable text chapters were found in this EPUB.");
  }

  return {
    id: createId(),
    title: metadata.title,
    author: metadata.author,
    fileName: sourceName,
    createdAt: new Date().toISOString(),
    tokenizerVersion: CURRENT_TOKENIZER_VERSION,
    chapters,
    progress: { sentenceIndex: 0, tokenIndex: 0 },
  };
}

async function readRequiredText(zip: JSZip, path: string) {
  const file = zip.file(path);
  if (!file) {
    throw new Error(`Missing EPUB file: ${path}`);
  }
  return file.async("text");
}

function parseXml(source: string, name: string) {
  const doc = new DOMParser().parseFromString(source, "application/xml");
  const error = doc.querySelector("parsererror");
  if (error) {
    throw new Error(`Could not parse ${name}.`);
  }
  return doc;
}

function readMetadata(opf: Document, sourceName: string) {
  const title = textOfFirst(opf, "title") ?? sourceName.replace(/\.epub$/i, "");
  const author = textOfFirst(opf, "creator") ?? undefined;
  return { title: normalizeText(title), author: author ? normalizeText(author) : undefined };
}

function readManifest(opf: Document, opfBase: string) {
  const manifest = new Map<string, { href: string; mediaType: string }>();

  for (const item of elements(opf, "item")) {
    const id = item.getAttribute("id");
    const href = item.getAttribute("href");
    const mediaType = item.getAttribute("media-type") ?? "";

    if (id && href) {
      manifest.set(id, {
        href: normalizePath(`${opfBase}${href}`),
        mediaType,
      });
    }
  }

  return manifest;
}

function readSpine(opf: Document) {
  return elements(opf, "itemref")
    .map((itemref) => itemref.getAttribute("idref"))
    .filter((idref): idref is string => Boolean(idref));
}

function extractParagraphs(xhtml: string, href: string) {
  const doc = parseXml(xhtml, href);
  const body = firstElement(doc, "body");
  if (!body) {
    return [];
  }

  body.querySelectorAll("script, style, nav, rt, rp").forEach((node) => node.remove());
  const blockSelector = "p, h1, h2, h3, h4, h5, h6, li, blockquote";
  const blocks = Array.from(body.querySelectorAll(blockSelector));
  const sources = blocks.length > 0 ? blocks : [body];

  return sources
    .map((element) => normalizeText(element.textContent ?? ""))
    .filter((text) => text.length > 0);
}

function firstUsefulText(values: string[]) {
  return values.find((value) => {
    const normalized = normalizeText(value);
    return normalized.length > 0 && normalized.length <= 80;
  });
}

function firstElement(doc: Document | Element, localName: string) {
  return (
    doc.getElementsByTagNameNS("*", localName)[0] ??
    doc.getElementsByTagName(localName)[0] ??
    null
  );
}

function elements(doc: Document | Element, localName: string) {
  return Array.from(
    new Set([
      ...Array.from(doc.getElementsByTagNameNS("*", localName)),
      ...Array.from(doc.getElementsByTagName(localName)),
    ]),
  );
}

function textOfFirst(doc: Document, localName: string) {
  return firstElement(doc, localName)?.textContent ?? null;
}

function directoryName(path: string) {
  const slash = path.lastIndexOf("/");
  return slash >= 0 ? `${path.slice(0, slash)}/` : "";
}

function normalizePath(path: string) {
  const parts: string[] = [];
  for (const part of path.split("/")) {
    if (!part || part === ".") {
      continue;
    }
    if (part === "..") {
      parts.pop();
      continue;
    }
    parts.push(part);
  }
  return parts.join("/");
}

function createId() {
  if ("crypto" in globalThis && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return `book:${Date.now()}:${Math.random().toString(36).slice(2)}`;
}
