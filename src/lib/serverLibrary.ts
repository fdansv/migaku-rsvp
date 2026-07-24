import type { LookupEvent, ReaderPosition, ReadingSession } from "../types";

const API_BASE = "/api";

export interface ServerBookEntry {
  id: string;
  fileName: string;
  relativePath: string;
  modifiedAt: string;
  size: number;
  progress: ReaderPosition;
}

export interface ServerAiStatus {
  enabled: boolean;
  apiUrl: string;
  recapModel: string;
  translationModel: string;
}

export async function loadServerAiStatus() {
  try {
    const response = await fetchApi("/ai/status", {
      headers: { Accept: "application/json" },
      cache: "no-store",
    });
    if (!response.ok) {
      return null;
    }

    return (await response.json()) as ServerAiStatus;
  } catch {
    return null;
  }
}

export async function isServerLibraryEnabled() {
  try {
    const response = await fetchApi("/library/status", {
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
  const response = await fetchApi("/books", {
    headers: { Accept: "application/json" },
    cache: "no-store",
  });
  if (!response.ok) {
    throw new Error("Could not load the server EPUB library.");
  }

  return (await response.json()) as ServerBookEntry[];
}

export async function loadServerBookFile(bookId: string) {
  const response = await fetchApi(`/books/${encodeURIComponent(bookId)}/file`, {
    cache: "no-store",
  });
  if (!response.ok) {
    throw new Error("Could not load this server EPUB.");
  }

  return response.blob();
}

export async function uploadServerBook(file: File) {
  const response = await fetchApi("/books", {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": file.type || "application/epub+zip",
      "X-File-Name": encodeURIComponent(file.name),
    },
    body: file,
  });
  if (!response.ok) {
    throw new Error(await getResponseError(response, "Could not upload this EPUB."));
  }

  return (await response.json()) as ServerBookEntry;
}

export async function loadServerBookProgress(bookId: string) {
  const response = await fetchApi(`/books/${encodeURIComponent(bookId)}/progress`, {
    headers: { Accept: "application/json" },
    cache: "no-store",
  });
  if (!response.ok) {
    throw new Error("Could not load server reading progress.");
  }

  return (await response.json()) as ReaderPosition;
}

export async function saveServerBookProgress(bookId: string, progress: ReaderPosition) {
  const response = await fetchApi(`/books/${encodeURIComponent(bookId)}/progress`, {
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

export async function loadServerReadingSessions() {
  const response = await fetchApi("/reading-sessions", {
    headers: { Accept: "application/json" },
    cache: "no-store",
  });
  if (!response.ok) {
    throw new Error("Could not load server reading stats.");
  }

  return (await response.json()) as ReadingSession[];
}

export async function saveServerReadingSession(session: ReadingSession) {
  const response = await fetchApi("/reading-sessions", {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
    },
    body: JSON.stringify(session),
  });
  if (!response.ok) {
    throw new Error("Could not save server reading stats.");
  }
}

export async function loadServerLookupEvents() {
  const response = await fetchApi("/lookup-events", {
    headers: { Accept: "application/json" },
    cache: "no-store",
  });
  if (!response.ok) {
    throw new Error("Could not load server lookup stats.");
  }

  return (await response.json()) as LookupEvent[];
}

export async function saveServerLookupEvent(event: LookupEvent) {
  const response = await fetchApi("/lookup-events", {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
    },
    body: JSON.stringify(event),
  });
  if (!response.ok) {
    throw new Error("Could not save server lookup stats.");
  }
}

async function fetchApi(path: string, init: RequestInit = {}) {
  const apiBases = getApiBases();
  let lastResponse: Response | null = null;

  for (const apiBase of apiBases) {
    const response = await fetch(`${apiBase}${path}`, init);
    if (response.ok || response.status !== 404) {
      return response;
    }
    lastResponse = response;
  }

  return lastResponse ?? fetch(`${API_BASE}${path}`, init);
}

function getApiBases() {
  const bases = [API_BASE];
  if (typeof window !== "undefined") {
    const mountMatch = window.location.pathname.match(/^\/([^/]+)\//);
    if (mountMatch?.[1]) {
      bases.push(`/${mountMatch[1]}${API_BASE}`);
    }
  }

  return Array.from(new Set(bases));
}

async function getResponseError(response: Response, fallback: string) {
  try {
    const body = (await response.json()) as { error?: string };
    return body.error ?? fallback;
  } catch {
    return fallback;
  }
}
