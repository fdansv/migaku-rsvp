import { openDB, type DBSchema } from "idb";
import type { Book } from "../types";

const SELECTED_BOOK_ID_KEY = "migaku-rsvp:selected-book-id";

interface MigakuRsvpDatabase extends DBSchema {
  books: {
    key: string;
    value: Book;
    indexes: { "by-created": string };
  };
}

const dbPromise = openDB<MigakuRsvpDatabase>("migaku-rsvp", 1, {
  upgrade(db) {
    const store = db.createObjectStore("books", { keyPath: "id" });
    store.createIndex("by-created", "createdAt");
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
