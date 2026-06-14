import { Trash2 } from "lucide-react";
import type { Book } from "../types";

interface LibrarySidebarProps {
  books: Book[];
  selectedBookId: string | null;
  onSelectBook: (book: Book) => void;
  onRemoveBook: (bookId: string) => void;
}

export function LibrarySidebar({
  books,
  selectedBookId,
  onSelectBook,
  onRemoveBook,
}: LibrarySidebarProps) {
  return (
    <aside className="library" aria-label="Library">
      <div className="section-title">Library</div>
      {books.length === 0 ? (
        <p className="empty-note">Import an EPUB to begin.</p>
      ) : (
        <div className="book-list">
          {books.map((book) => (
            <div
              key={book.id}
              className={`book-row${book.id === selectedBookId ? " is-selected" : ""}`}
            >
              <button className="book-select" onClick={() => onSelectBook(book)} type="button">
                <strong>{book.title}</strong>
                <small>
                  {book.author ?? (book.source === "server" ? "Server library" : book.fileName)}
                </small>
              </button>
              {book.source === "server" ? (
                <span className="book-source" title="Server library">
                  EPUB
                </span>
              ) : (
                <button
                  className="delete-button"
                  aria-label="Delete book"
                  title="Delete book"
                  type="button"
                  onClick={() => onRemoveBook(book.id)}
                >
                  <Trash2 size={16} aria-hidden="true" />
                </button>
              )}
            </div>
          ))}
        </div>
      )}
    </aside>
  );
}
