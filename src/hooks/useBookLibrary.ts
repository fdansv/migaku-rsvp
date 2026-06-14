import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { parseEpub } from "../lib/epub";
import {
  isServerLibraryEnabled,
  loadServerBookEntries,
  loadServerBookFile,
  loadServerBookProgress,
  saveServerBookProgress,
  uploadServerBook,
  type ServerBookEntry,
} from "../lib/serverLibrary";
import { deleteBook, loadBooks, saveBook } from "../lib/storage";
import { CURRENT_TOKENIZER_VERSION, tokenizeJapanese, warmJapaneseTokenizer } from "../lib/text";
import type { Book, ReaderPosition } from "../types";

const EMPTY_POSITION: ReaderPosition = { sentenceIndex: 0, tokenIndex: 0 };

export function useBookLibrary() {
  const [books, setBooks] = useState<Book[]>([]);
  const [selectedBookId, setSelectedBookId] = useState<string | null>(null);
  const [position, setPosition] = useState<ReaderPosition>(EMPTY_POSITION);
  const [isImporting, setIsImporting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [serverLibraryEnabled, setServerLibraryEnabled] = useState(false);
  const selectedBookIdRef = useRef<string | null>(null);

  useEffect(() => {
    selectedBookIdRef.current = selectedBookId;
  }, [selectedBookId]);

  const hydrateServerBook = useCallback(async (book: Book) => {
    if (book.source !== "server") {
      return;
    }

    setError(null);
    setIsImporting(true);
    try {
      const [file, progress] = await Promise.all([
        loadServerBookFile(book.id),
        loadServerBookProgress(book.id).catch(() => book.progress),
      ]);
      const parsedBook = await parseEpub(file, book.fileName);
      const serverBook: Book = {
        ...parsedBook,
        id: book.id,
        source: "server",
        fileName: book.fileName,
        createdAt: book.createdAt,
        progress,
      };

      setBooks((currentBooks) =>
        currentBooks.map((candidate) => (candidate.id === book.id ? serverBook : candidate)),
      );

      if (selectedBookIdRef.current === book.id) {
        setPosition(progress);
      }
    } catch (serverError) {
      setError(serverError instanceof Error ? serverError.message : "Could not load server EPUB.");
    } finally {
      setIsImporting(false);
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    warmJapaneseTokenizer();
    Promise.all([
      loadBooks(),
      loadServerBooks().catch((serverError: unknown) => {
        if (!cancelled) {
          setError(
            serverError instanceof Error
              ? serverError.message
              : "Could not load the server EPUB library.",
          );
        }
        return { enabled: false, books: [] };
      }),
    ])
      .then(async ([storedBooks, serverLibrary]) => {
        const upgradedBooks = await Promise.all(
          storedBooks.map((book) => upgradeBookTokenization({ ...book, source: "local" })),
        );
        if (cancelled) {
          return;
        }

        setServerLibraryEnabled(serverLibrary.enabled);
        const serverBooks = serverLibrary.books;
        const nextBooks = [...serverBooks, ...upgradedBooks];
        setBooks(nextBooks);
        if (nextBooks[0]) {
          setSelectedBookId(nextBooks[0].id);
          setPosition(nextBooks[0].progress);
          if (nextBooks[0].source === "server") {
            void hydrateServerBook(nextBooks[0]);
          }
        }
      })
      .catch((loadError: unknown) => {
        setError(loadError instanceof Error ? loadError.message : "Could not load stored books.");
      });

    return () => {
      cancelled = true;
    };
  }, [hydrateServerBook]);

  const selectedBook = useMemo(
    () => books.find((book) => book.id === selectedBookId),
    [books, selectedBookId],
  );

  const importBook = useCallback(async (file: File) => {
    setError(null);
    setIsImporting(true);
    try {
      if (serverLibraryEnabled) {
        const entry = await uploadServerBook(file);
        const parsedBook = await parseEpub(file, entry.fileName);
        const serverBook: Book = {
          ...parsedBook,
          id: entry.id,
          source: "server",
          fileName: entry.fileName,
          createdAt: entry.modifiedAt,
          progress: entry.progress,
        };
        setBooks((currentBooks) => [
          serverBook,
          ...currentBooks.filter((candidate) => candidate.id !== serverBook.id),
        ]);
        setSelectedBookId(serverBook.id);
        setPosition(serverBook.progress);
        return;
      }

      const book = await parseEpub(file);
      const localBook: Book = { ...book, source: "local" };
      await saveBook(localBook);
      setBooks((currentBooks) => [
        localBook,
        ...currentBooks.filter((candidate) => candidate.id !== localBook.id),
      ]);
      setSelectedBookId(localBook.id);
      setPosition(localBook.progress);
    } catch (importError) {
      setError(importError instanceof Error ? importError.message : "Could not import this EPUB.");
    } finally {
      setIsImporting(false);
    }
  }, [serverLibraryEnabled]);

  const selectBook = useCallback((book: Book) => {
    setSelectedBookId(book.id);
    setPosition(book.progress);
    if (book.source === "server" && book.chapters.length === 0) {
      void hydrateServerBook(book);
    }
  }, [hydrateServerBook]);

  const removeBook = useCallback(
    async (bookId: string) => {
      const book = books.find((candidate) => candidate.id === bookId);
      if (book?.source === "server") {
        return;
      }

      await deleteBook(bookId);
      setBooks((currentBooks) => {
        const nextBooks = currentBooks.filter((book) => book.id !== bookId);
        if (selectedBookId === bookId) {
          setSelectedBookId(nextBooks[0]?.id ?? null);
          setPosition(nextBooks[0]?.progress ?? EMPTY_POSITION);
        }
        return nextBooks;
      });
    },
    [books, selectedBookId],
  );

  const saveSelectedBookProgress = useCallback(
    (progress: ReaderPosition) => {
      setBooks((currentBooks) => {
        const book = currentBooks.find((candidate) => candidate.id === selectedBookId);
        if (
          !book ||
          (book.progress.sentenceIndex === progress.sentenceIndex &&
            book.progress.tokenIndex === progress.tokenIndex)
        ) {
          return currentBooks;
        }

        const updatedBook = { ...book, progress };
        if (updatedBook.source === "server") {
          void saveServerBookProgress(updatedBook.id, progress).catch((saveError) => {
            setError(
              saveError instanceof Error
                ? saveError.message
                : "Could not save server reading progress.",
            );
          });
        } else {
          void saveBook(updatedBook);
        }
        return currentBooks.map((candidate) =>
          candidate.id === selectedBookId ? updatedBook : candidate,
        );
      });
    },
    [selectedBookId],
  );

  return {
    books,
    selectedBook,
    selectedBookId,
    position,
    setPosition,
    isImporting,
    error,
    importBook,
    selectBook,
    removeBook,
    saveSelectedBookProgress,
  };
}

async function loadServerBooks() {
  if (!(await isServerLibraryEnabled())) {
    return { enabled: false, books: [] };
  }

  const entries = await loadServerBookEntries();
  return { enabled: true, books: entries.map(createServerBookPlaceholder) };
}

function createServerBookPlaceholder(entry: ServerBookEntry): Book {
  return {
    id: entry.id,
    title: entry.fileName.replace(/\.epub$/i, ""),
    fileName: entry.fileName,
    createdAt: entry.modifiedAt,
    source: "server",
    chapters: [],
    progress: entry.progress,
  };
}

async function upgradeBookTokenization(book: Book) {
  if (book.tokenizerVersion === CURRENT_TOKENIZER_VERSION) {
    return book;
  }

  const chapters = await Promise.all(
    book.chapters.map(async (chapter) => ({
      ...chapter,
      sentences: await Promise.all(
        chapter.sentences.map(async (sentence) => ({
          ...sentence,
          tokens: await tokenizeJapanese(sentence.text, sentence.id),
        })),
      ),
    })),
  );
  const upgradedBook = { ...book, chapters, tokenizerVersion: CURRENT_TOKENIZER_VERSION };
  await saveBook(upgradedBook);
  return upgradedBook;
}
