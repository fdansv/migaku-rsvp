import type { ReaderPosition } from "../types";

const API_BASE = "/api";

export interface ServerBookEntry {
  id: string;
  fileName: string;
  relativePath: string;
  modifiedAt: string;
  size: number;
  progress: ReaderPosition;
}

export async function isServerLibraryEnabled() {
  try {
    const response = await fetch(`${API_BASE}/library/status`, {
      headers: { Accept: "application/json" },
      cache: "no-store",
    });
    if (!response.ok) {
      return false;
    }

    const status = (await response.json()) as { enabled?: boolean };
    return status.enabled === true;
  } catch {
    return false;
  }
}

export async function loadServerBookEntries() {
  const response = await fetch(`${API_BASE}/books`, {
    headers: { Accept: "application/json" },
    cache: "no-store",
  });
  if (!response.ok) {
    throw new Error("Could not load the server EPUB library.");
  }

  return (await response.json()) as ServerBookEntry[];
}

export async function loadServerBookFile(bookId: string) {
  const response = await fetch(`${API_BASE}/books/${encodeURIComponent(bookId)}/file`, {
    cache: "no-store",
  });
  if (!response.ok) {
    throw new Error("Could not load this server EPUB.");
  }

  return response.blob();
}

export async function loadServerBookProgress(bookId: string) {
  const response = await fetch(`${API_BASE}/books/${encodeURIComponent(bookId)}/progress`, {
    headers: { Accept: "application/json" },
    cache: "no-store",
  });
  if (!response.ok) {
    throw new Error("Could not load server reading progress.");
  }

  return (await response.json()) as ReaderPosition;
}

export async function saveServerBookProgress(bookId: string, progress: ReaderPosition) {
  const response = await fetch(`${API_BASE}/books/${encodeURIComponent(bookId)}/progress`, {
    method: "PUT",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
    },
    body: JSON.stringify(progress),
  });
  if (!response.ok) {
    throw new Error("Could not save server reading progress.");
  }
}
