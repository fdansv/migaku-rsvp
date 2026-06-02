import { useCallback, useEffect, useMemo, useState } from "react";
import { parseEpub } from "../lib/epub";
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

  useEffect(() => {
    let cancelled = false;
    warmJapaneseTokenizer();
    loadBooks()
      .then(async (storedBooks) => {
        const upgradedBooks = await Promise.all(storedBooks.map(upgradeBookTokenization));
        if (cancelled) {
          return;
        }

        setBooks(upgradedBooks);
        if (upgradedBooks[0]) {
          setSelectedBookId(upgradedBooks[0].id);
          setPosition(upgradedBooks[0].progress);
        }
      })
      .catch((loadError: unknown) => {
        setError(loadError instanceof Error ? loadError.message : "Could not load stored books.");
      });

    return () => {
      cancelled = true;
    };
  }, []);

  const selectedBook = useMemo(
    () => books.find((book) => book.id === selectedBookId),
    [books, selectedBookId],
  );

  const importBook = useCallback(async (file: File) => {
    setError(null);
    setIsImporting(true);
    try {
      const book = await parseEpub(file);
      await saveBook(book);
      setBooks((currentBooks) => [
        book,
        ...currentBooks.filter((candidate) => candidate.id !== book.id),
      ]);
      setSelectedBookId(book.id);
      setPosition(book.progress);
    } catch (importError) {
      setError(importError instanceof Error ? importError.message : "Could not import this EPUB.");
    } finally {
      setIsImporting(false);
    }
  }, []);

  const selectBook = useCallback((book: Book) => {
    setSelectedBookId(book.id);
    setPosition(book.progress);
  }, []);

  const removeBook = useCallback(
    async (bookId: string) => {
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
    [selectedBookId],
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
        void saveBook(updatedBook);
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
