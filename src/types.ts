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
  source?: "local" | "server";
  tokenizerVersion?: string;
  chapters: Chapter[];
  progress: ReaderPosition;
}

export interface ReaderSettings {
  stepDurationMs: number;
  fontSize: number;
  chunkSize: number;
  stopMode: StopMode;
  theme: ThemeMode;
  recapApiUrl: string;
  recapApiKey: string;
  recapModel: string;
}

export interface MigakuScanResult {
  detected: boolean;
  parsed: boolean;
  timedOut: boolean;
  sentenceId?: string;
  statuses: Record<number, MigakuTokenStatus>;
  mirrors: Record<number, MigakuTokenMirror>;
  tokenGroups: number[][];
  assignedTokenCount: number;
}

export interface MigakuTokenMirror {
  text: string;
  status: MigakuTokenStatus;
  className: string;
  attributes: Record<string, string>;
}
