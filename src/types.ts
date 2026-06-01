export type StopMode = "unknown" | "never" | "i+1";

export type ThemeMode = "paper" | "dark" | "contrast";

export type MigakuTokenStatus =
  | "unknown"
  | "seen"
  | "known"
  | "ignored"
  | "tracked"
  | "unparsed";

export interface RsvpToken {
  id: string;
  index: number;
  text: string;
  start: number;
  end: number;
  isWordLike: boolean;
  isPunctuation: boolean;
}

export interface Sentence {
  id: string;
  chapterId: string;
  chapterIndex: number;
  index: number;
  globalIndex: number;
  text: string;
  tokens: RsvpToken[];
}

export interface Chapter {
  id: string;
  index: number;
  title: string;
  href: string;
  sentences: Sentence[];
}

export interface ReaderPosition {
  sentenceIndex: number;
  tokenIndex: number;
}

export interface Book {
  id: string;
  title: string;
  author?: string;
  fileName: string;
  createdAt: string;
  tokenizerVersion?: string;
  chapters: Chapter[];
  progress: ReaderPosition;
}

export interface ReaderSettings {
  wpm: number;
  fontSize: number;
  chunkSize: number;
  punctuationDelayMs: number;
  stopMode: StopMode;
  theme: ThemeMode;
}

export interface MigakuScanResult {
  detected: boolean;
  parsed: boolean;
  timedOut: boolean;
  sentenceId?: string;
  statuses: Record<number, MigakuTokenStatus>;
  mirrors: Record<number, MigakuTokenMirror>;
  assignedTokenCount: number;
}

export interface MigakuTokenMirror {
  text: string;
  status: MigakuTokenStatus;
  className: string;
  attributes: Record<string, string>;
}
