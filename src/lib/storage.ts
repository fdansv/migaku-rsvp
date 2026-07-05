import { openDB, type DBSchema } from "idb";
import type { Book, ReadingSession } from "../types";

const SELECTED_BOOK_ID_KEY = "migaku-rsvp:selected-book-id";

interface MigakuRsvpDatabase extends DBSchema {
  books: {
    key: string;
    value: Book;
    indexes: { "by-created": string };
  };
  readingSessions: {
    key: string;
    value: ReadingSession;
    indexes: {
      "by-book": string;
      "by-started": string;
    };
  };
}

const dbPromise = openDB<MigakuRsvpDatabase>("migaku-rsvp", 2, {
  upgrade(db) {
    if (!db.objectStoreNames.contains("books")) {
      const store = db.createObjectStore("books", { keyPath: "id" });
      store.createIndex("by-created", "createdAt");
    }

    if (!db.objectStoreNames.contains("readingSessions")) {
      const store = db.createObjectStore("readingSessions", { keyPath: "id" });
      store.createIndex("by-book", "bookId");
      store.createIndex("by-started", "startedAt");
    }
  },
});

export async function loadBooks() {
  const db = await dbPromise;
  const books = await db.getAll("books");
  return books.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export async function saveBook(book: Book) {
  const db = await dbPromise;
  await db.put("books", book);
}

export async function deleteBook(bookId: string) {
  const db = await dbPromise;
  await db.delete("books", bookId);
}

export async function loadReadingSessions() {
  const db = await dbPromise;
  const sessions = await db.getAll("readingSessions");
  return sessions.sort((a, b) => a.startedAt.localeCompare(b.startedAt));
}

export async function saveReadingSession(session: ReadingSession) {
  const db = await dbPromise;
  await db.put("readingSessions", session);
}

export function loadSelectedBookId() {
  return localStorage.getItem(SELECTED_BOOK_ID_KEY);
}

export function saveSelectedBookId(bookId: string | null) {
  if (bookId) {
    localStorage.setItem(SELECTED_BOOK_ID_KEY, bookId);
  } else {
    localStorage.removeItem(SELECTED_BOOK_ID_KEY);
  }
}
