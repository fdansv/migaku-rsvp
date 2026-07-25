import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Book, ReaderPosition } from "../types";
import { useBookLibrary } from "./useBookLibrary";

const storageMocks = vi.hoisted(() => ({
  deleteBook: vi.fn(),
  loadBooks: vi.fn(),
  loadSelectedBookId: vi.fn(),
  saveBook: vi.fn(),
  saveBookProgress: vi.fn(),
  saveSelectedBookId: vi.fn(),
}));

const serverLibraryMocks = vi.hoisted(() => ({
  isServerLibraryEnabled: vi.fn(),
  loadServerBookEntries: vi.fn(),
  loadServerBookFile: vi.fn(),
  loadServerBookProgress: vi.fn(),
  saveServerBookProgress: vi.fn(),
  uploadServerBook: vi.fn(),
}));

const epubMocks = vi.hoisted(() => ({
  parseEpub: vi.fn(),
}));

vi.mock("../lib/storage", () => storageMocks);
vi.mock("../lib/serverLibrary", () => serverLibraryMocks);
vi.mock("../lib/epub", () => epubMocks);
vi.mock("../lib/text", () => ({
  CURRENT_TOKENIZER_VERSION: "test-tokenizer",
  tokenizeJapanese: vi.fn(),
  warmJapaneseTokenizer: vi.fn(),
}));

describe("useBookLibrary progress persistence", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    storageMocks.deleteBook.mockResolvedValue(undefined);
    storageMocks.loadBooks.mockResolvedValue([]);
    storageMocks.saveBook.mockResolvedValue(undefined);
    storageMocks.saveBookProgress.mockResolvedValue(undefined);
    storageMocks.loadSelectedBookId.mockReturnValue("book-1");
    serverLibraryMocks.isServerLibraryEnabled.mockResolvedValue(false);
    serverLibraryMocks.loadServerBookEntries.mockResolvedValue([]);
    serverLibraryMocks.loadServerBookFile.mockResolvedValue(new Blob());
    serverLibraryMocks.loadServerBookProgress.mockResolvedValue({
      sentenceIndex: 0,
      tokenIndex: 0,
    });
    serverLibraryMocks.saveServerBookProgress.mockResolvedValue(undefined);
    epubMocks.parseEpub.mockResolvedValue(createBook("parsed-book"));
  });

  it("persists only the position while keeping parsed book identity stable", async () => {
    const book = createBook();
    storageMocks.loadBooks.mockResolvedValue([book]);

    const { result } = renderHook(() => useBookLibrary());

    await waitFor(() => expect(result.current.selectedBook?.id).toBe(book.id));

    const books = result.current.books;
    const selectedBook = result.current.selectedBook;
    const chapters = selectedBook?.chapters;
    const sentences = chapters?.[0]?.sentences;
    const nextPosition: ReaderPosition = { sentenceIndex: 1, tokenIndex: 2 };

    act(() => result.current.setPosition(nextPosition));
    act(() => result.current.saveSelectedBookProgress(nextPosition));

    expect(storageMocks.saveBookProgress).toHaveBeenCalledOnce();
    expect(storageMocks.saveBookProgress).toHaveBeenCalledWith(book.id, nextPosition);
    expect(storageMocks.saveBook).not.toHaveBeenCalled();
    expect(result.current.books).toBe(books);
    expect(result.current.selectedBook).toBe(selectedBook);
    expect(result.current.selectedBook?.chapters).toBe(chapters);
    expect(result.current.selectedBook?.chapters[0]?.sentences).toBe(sentences);

    act(() => result.current.saveSelectedBookProgress(nextPosition));
    expect(storageMocks.saveBookProgress).toHaveBeenCalledOnce();

    act(() => result.current.setPosition({ sentenceIndex: 0, tokenIndex: 0 }));
    act(() => result.current.selectBook(selectedBook!));
    expect(result.current.position).toEqual(nextPosition);
  });

  it("does not restore a book when concurrent removals resolve out of order", async () => {
    const firstBook = createBook("book-1");
    const secondBook = createBook("book-2");
    const firstDelete = createDeferred();
    storageMocks.loadBooks.mockResolvedValue([firstBook, secondBook]);
    storageMocks.deleteBook.mockImplementation((bookId: string) =>
      bookId === firstBook.id ? firstDelete.promise : Promise.resolve(),
    );

    const { result } = renderHook(() => useBookLibrary());

    await waitFor(() => expect(result.current.books).toHaveLength(2));

    let firstRemoval!: Promise<void>;
    act(() => {
      firstRemoval = result.current.removeBook(firstBook.id);
    });
    await waitFor(() =>
      expect(storageMocks.deleteBook).toHaveBeenCalledWith(firstBook.id),
    );

    await act(async () => {
      await result.current.removeBook(secondBook.id);
    });
    expect(result.current.books.map((book) => book.id)).toEqual([firstBook.id]);

    firstDelete.resolve();
    await act(async () => {
      await firstRemoval;
    });

    expect(result.current.books).toEqual([]);
  });

  it("coalesces overlapping server progress saves and persists the latest position last", async () => {
    const serverBookId = "server-book";
    const initialPosition: ReaderPosition = { sentenceIndex: 0, tokenIndex: 0 };
    const firstPosition: ReaderPosition = { sentenceIndex: 1, tokenIndex: 0 };
    const intermediatePosition: ReaderPosition = { sentenceIndex: 2, tokenIndex: 0 };
    const latestPosition: ReaderPosition = { sentenceIndex: 3, tokenIndex: 1 };
    const firstSave = createDeferred();
    serverLibraryMocks.isServerLibraryEnabled.mockResolvedValue(true);
    serverLibraryMocks.loadServerBookEntries.mockResolvedValue([
      {
        id: serverBookId,
        fileName: "server-book.epub",
        relativePath: "server-book.epub",
        modifiedAt: "2026-07-24T00:00:00.000Z",
        size: 1,
        progress: initialPosition,
      },
    ]);
    serverLibraryMocks.loadServerBookProgress.mockResolvedValue(initialPosition);
    serverLibraryMocks.saveServerBookProgress
      .mockImplementationOnce(() => firstSave.promise)
      .mockResolvedValue(undefined);

    const { result } = renderHook(() => useBookLibrary());

    await waitFor(() =>
      expect(result.current.selectedBook).toMatchObject({
        id: serverBookId,
        source: "server",
      }),
    );
    await waitFor(() => expect(result.current.isImporting).toBe(false));

    act(() => {
      result.current.saveSelectedBookProgress(firstPosition);
      result.current.saveSelectedBookProgress(intermediatePosition);
      result.current.saveSelectedBookProgress(latestPosition);
    });

    expect(serverLibraryMocks.saveServerBookProgress).toHaveBeenCalledTimes(1);
    expect(serverLibraryMocks.saveServerBookProgress).toHaveBeenLastCalledWith(
      serverBookId,
      firstPosition,
    );

    firstSave.resolve();
    await waitFor(() =>
      expect(serverLibraryMocks.saveServerBookProgress).toHaveBeenCalledTimes(2),
    );

    expect(serverLibraryMocks.saveServerBookProgress.mock.calls).toEqual([
      [serverBookId, firstPosition],
      [serverBookId, latestPosition],
    ]);
  });
});

function createBook(id = "book-1"): Book {
  return {
    id,
    title: "Test Book",
    fileName: `${id}.epub`,
    createdAt: "2026-07-24T00:00:00.000Z",
    source: "local",
    tokenizerVersion: "test-tokenizer",
    chapters: [
      {
        id: "chapter-1",
        index: 0,
        title: "Chapter 1",
        href: "chapter-1.xhtml",
        sentences: [],
      },
    ],
    progress: { sentenceIndex: 0, tokenIndex: 0 },
  };
}

function createDeferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}
