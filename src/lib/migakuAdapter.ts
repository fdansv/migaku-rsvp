import { useEffect, useMemo, useRef, useState, type RefObject } from "react";
import type { MigakuScanResult, MigakuTokenMirror, MigakuTokenStatus, Sentence } from "../types";

const EMPTY_SCAN: MigakuScanResult = {
  detected: false,
  parsed: false,
  timedOut: false,
  statuses: {},
  mirrors: {},
  assignedTokenCount: 0,
};

const STATUS_ATTRIBUTE_NAMES = new Set([
  "data-mgk-known-status",
  "data-known-status",
  "data-status",
  "data-migaku-status",
]);

const STATUS_CLASS_MAP: Record<string, MigakuTokenStatus> = {
  gray: "ignored",
  green: "known",
  grey: "ignored",
  ignored: "ignored",
  known: "known",
  learning: "seen",
  orange: "seen",
  purple: "tracked",
  red: "unknown",
  seen: "seen",
  tracked: "tracked",
  tracking: "tracked",
  unknown: "unknown",
  yellow: "seen",
};

export function useMigakuAdapter(
  rootRef: RefObject<HTMLElement | null>,
  visibleRootRef: RefObject<HTMLElement | null>,
  sentence: Sentence | undefined,
  activeTokenIndexes: number[],
  bufferKey: string,
) {
  const [scan, setScan] = useState<MigakuScanResult>(EMPTY_SCAN);
  const latestRef = useRef({ sentence, activeTokenIndexes });
  const activeTokenKey = activeTokenIndexes.join(",");

  useEffect(() => {
    latestRef.current = { sentence, activeTokenIndexes };
  }, [sentence, activeTokenIndexes]);

  useEffect(() => {
    if (!rootRef.current || !sentence) {
      return;
    }

    requestMigakuParse();
    const timers = [80, 260].map((delay) => window.setTimeout(requestMigakuParse, delay));

    return () => {
      timers.forEach((timer) => window.clearTimeout(timer));
    };
  }, [rootRef, sentence?.id, activeTokenKey]);

  useEffect(() => {
    const root = rootRef.current;
    if (!root || !sentence) {
      setScan(EMPTY_SCAN);
      return;
    }

    setScan(EMPTY_SCAN);
    requestMigakuParse();

    let finished = false;
    const scanNow = (timedOut = false) => {
      if (finished) {
        return;
      }
      const current = latestRef.current;
      if (!current.sentence) {
        setScan(EMPTY_SCAN);
        return;
      }
      const result = scanVisibleDisplay(
        scanMigakuSurface(root, current.sentence),
        visibleRootRef.current,
        current.sentence,
      );
      setScan({ ...result, timedOut: timedOut && !result.parsed });
      markActiveMigakuTokens(root, current.sentence.id, current.activeTokenIndexes);
      if (visibleRootRef.current) {
        markActiveMigakuTokens(
          visibleRootRef.current,
          current.sentence.id,
          current.activeTokenIndexes,
        );
        syncVisibleSentenceContext(
          visibleRootRef.current,
          current.sentence,
          current.activeTokenIndexes,
        );
      }
    };

    const observer = new MutationObserver(() => scanNow(false));
    observer.observe(root, {
      attributes: true,
      childList: true,
      subtree: true,
      characterData: true,
    });
    const visibleObserver = visibleRootRef.current
      ? new MutationObserver(() => scanNow(false))
      : null;
    visibleObserver?.observe(visibleRootRef.current!, {
      attributes: true,
      childList: true,
      subtree: true,
      characterData: true,
    });

    const timers = [120, 350, 800, 1_600].map((delay) =>
      window.setTimeout(() => scanNow(false), delay),
    );
    const timeout = window.setTimeout(() => scanNow(true), 2_500);

    return () => {
      finished = true;
      observer.disconnect();
      visibleObserver?.disconnect();
      timers.forEach((timer) => window.clearTimeout(timer));
      window.clearTimeout(timeout);
    };
  }, [bufferKey, rootRef, visibleRootRef]);

  useEffect(() => {
    const root = rootRef.current;
    if (root && sentence) {
      const result = scanVisibleDisplay(scanMigakuSurface(root, sentence), visibleRootRef.current, sentence);
      setScan(result);
      markActiveMigakuTokens(root, sentence.id, activeTokenIndexes);
      if (visibleRootRef.current) {
        markActiveMigakuTokens(visibleRootRef.current, sentence.id, activeTokenIndexes);
        syncVisibleSentenceContext(visibleRootRef.current, sentence, activeTokenIndexes);
      }
    }
  }, [rootRef, visibleRootRef, sentence?.id, activeTokenIndexes, scan.assignedTokenCount]);

  return useMemo(
    () => (sentence && scan.sentenceId && scan.sentenceId !== sentence.id ? EMPTY_SCAN : scan),
    [scan, sentence?.id],
  );
}

export function scanMigakuSurface(root: HTMLElement, sentence: Sentence): MigakuScanResult {
  const sentenceRoot = getSentenceRoot(root, sentence.id);
  const candidates = getMigakuCandidates(sentenceRoot);
  const detected =
    candidates.length > 0 ||
    Boolean(root.querySelector("[class*='migaku'], [data-migaku], [data-status]"));
  const statuses: Record<number, MigakuTokenStatus> = {};
  const mirrors: MigakuScanResult["mirrors"] = {};
  let cursor = 0;
  let assignedTokenCount = 0;

  for (const element of candidates) {
    const text = candidateSurfaceText(element);
    if (!text) {
      continue;
    }

    const start = findCandidateOffset(sentence.text, text, cursor);
    if (start < 0) {
      continue;
    }

    const end = start + text.length;
    const tokens = sentence.tokens.filter(
      (candidate) => rangesOverlap(candidate.start, candidate.end, start, end) && candidate.isWordLike,
    );

    if (tokens.length === 0) {
      cursor = Math.max(cursor, end);
      continue;
    }

    const status = statusFromElement(element);
    if (status !== "unparsed") {
      for (const token of tokens) {
        const nextStatus = mergeTokenStatus(statuses[token.index], status);
        statuses[token.index] = nextStatus;
        if (nextStatus === status || !mirrors[token.index]) {
          mirrors[token.index] = mirrorFromElement(element, nextStatus);
        }
      }
    }
    if (!element.classList.contains("rsvp-migaku-token")) {
      element.classList.add("rsvp-migaku-token");
    }
    const tokenIndexes = tokens.map((token) => token.index).join(",");
    if (element.getAttribute("data-rsvp-token-index") !== tokenIndexes) {
      element.setAttribute("data-rsvp-token-index", tokenIndexes);
    }
    assignedTokenCount += tokens.length;
    cursor = Math.max(cursor, end);
  }

  return {
    detected,
    parsed: assignedTokenCount > 0,
    timedOut: false,
    sentenceId: sentence.id,
    statuses,
    mirrors,
    assignedTokenCount,
  };
}

export function markActiveMigakuToken(
  root: HTMLElement,
  sentenceId: string,
  activeTokenIndex: number,
) {
  markActiveMigakuTokens(root, sentenceId, [activeTokenIndex]);
}

export function markActiveMigakuTokens(
  root: HTMLElement,
  sentenceId: string,
  activeTokenIndexes: number[],
) {
  const sentenceRoot = getSentenceRoot(root, sentenceId);
  const activeIndexSet = new Set(activeTokenIndexes.map(String));
  const active = Array.from(
    sentenceRoot.querySelectorAll<HTMLElement>("[data-rsvp-token-index]"),
  ).filter((element) =>
    splitTokenIndexes(element.getAttribute("data-rsvp-token-index")).some((tokenIndex) =>
      activeIndexSet.has(tokenIndex),
    ),
  );

  root
    .querySelectorAll(".rsvp-active-token")
    .forEach((element) => {
      if (!active.includes(element as HTMLElement)) {
        element.classList.remove("rsvp-active-token");
      }
    });

  for (const element of active) {
    if (!element.classList.contains("rsvp-active-token")) {
      element.classList.add("rsvp-active-token");
    }
  }
}

export function statusFromElement(element: Element): MigakuTokenStatus {
  const explicitStatus = explicitStatusFromElement(element);
  if (explicitStatus) {
    return explicitStatus;
  }

  return statusFromComputedStyle(element) ?? "unparsed";
}

function explicitStatusFromElement(element: Element): MigakuTokenStatus | null {
  const classStatus = statusFromClassList(element);
  if (classStatus) {
    return classStatus;
  }

  for (const attribute of Array.from(element.attributes)) {
    const name = attribute.name.toLowerCase();
    if (!STATUS_ATTRIBUTE_NAMES.has(name)) {
      continue;
    }

    const status = statusFromStatusText(attribute.value);
    if (status) {
      return status;
    }
  }

  return null;
}

function statusFromClassList(element: Element) {
  return Array.from(element.classList)
    .filter((className) => !className.startsWith("rsvp-") && !isAggregateMigakuClass(className))
    .map((className) => STATUS_CLASS_MAP[normalizeStatusClassName(className)])
    .find(Boolean) ?? null;
}

function isAggregateMigakuClass(className: string) {
  return (
    className.includes("has-") ||
    className.includes("show-") ||
    className.includes("sentence") ||
    className.includes("branch") ||
    className.includes("group") ||
    className.includes("processed") ||
    className.includes("parsed")
  );
}

function normalizeStatusClassName(className: string) {
  return className.replace(/^[-_]+/, "").toLowerCase();
}

function statusFromStatusText(value: string): MigakuTokenStatus | null {
  return STATUS_CLASS_MAP[value.trim().toLowerCase()] ?? null;
}

function scanVisibleDisplay(
  scan: MigakuScanResult,
  visibleRoot: HTMLElement | null,
  sentence: Sentence,
): MigakuScanResult {
  if (!visibleRoot) {
    return scan;
  }

  const visibleSentenceScan = scanMigakuSurface(visibleRoot, sentence);
  const statuses = mergeTokenStatuses(scan.statuses, visibleSentenceScan.statuses);
  const mirrors = mergeTokenMirrors(scan.mirrors, visibleSentenceScan.mirrors);
  let assignedTokenCount = scan.assignedTokenCount + visibleSentenceScan.assignedTokenCount;
  let detected = scan.detected || visibleSentenceScan.detected;

  for (const element of Array.from(
    visibleRoot.querySelectorAll<HTMLElement>("[data-rsvp-display-token-index]"),
  )) {
    const tokenIndex = Number(element.getAttribute("data-rsvp-display-token-index"));
    if (!Number.isInteger(tokenIndex)) {
      continue;
    }

    if (statuses[tokenIndex]) {
      continue;
    }

    const candidate = bestStatusElement(element);
    const status = statusFromElement(candidate);
    if (status === "unparsed") {
      continue;
    }

    detected = true;
    assignedTokenCount += 1;
    const nextStatus = mergeTokenStatus(statuses[tokenIndex], status);
    statuses[tokenIndex] = nextStatus;
    mirrors[tokenIndex] = chooseTokenMirror(
      mirrors[tokenIndex],
      mirrorFromElement(candidate, nextStatus),
    );
  }

  return {
    ...scan,
    detected,
    parsed: scan.parsed || visibleSentenceScan.parsed || assignedTokenCount > 0,
    sentenceId: sentence.id,
    statuses,
    mirrors,
    assignedTokenCount,
  };
}

function mergeTokenStatuses(
  baseStatuses: MigakuScanResult["statuses"],
  nextStatuses: MigakuScanResult["statuses"],
) {
  const merged = { ...baseStatuses };
  for (const [tokenIndex, status] of Object.entries(nextStatuses)) {
    merged[Number(tokenIndex)] = mergeTokenStatus(merged[Number(tokenIndex)], status);
  }
  return merged;
}

function mergeTokenMirrors(
  baseMirrors: MigakuScanResult["mirrors"],
  nextMirrors: MigakuScanResult["mirrors"],
) {
  const merged = { ...baseMirrors };
  for (const [tokenIndex, mirror] of Object.entries(nextMirrors)) {
    merged[Number(tokenIndex)] = chooseTokenMirror(merged[Number(tokenIndex)], mirror);
  }
  return merged;
}

function chooseTokenMirror(
  currentMirror: MigakuTokenMirror | undefined,
  nextMirror: MigakuTokenMirror,
) {
  if (!currentMirror) {
    return normalizeMirrorStatusAttribute(nextMirror);
  }

  const currentPriority = statusPriority(currentMirror.status);
  const nextPriority = statusPriority(nextMirror.status);

  if (nextPriority > currentPriority) {
    return mergeMirrorWithIdentity(nextMirror, currentMirror);
  }

  if (currentPriority > nextPriority) {
    return mergeMirrorWithIdentity(currentMirror, nextMirror);
  }

  if (hasTokenIdentity(nextMirror)) {
    return normalizeMirrorStatusAttribute(nextMirror);
  }

  if (hasTokenIdentity(currentMirror)) {
    return mergeMirrorWithIdentity(nextMirror, currentMirror);
  }

  return normalizeMirrorStatusAttribute(nextMirror);
}

function mergeMirrorWithIdentity(
  preferredMirror: MigakuTokenMirror,
  identityFallback: MigakuTokenMirror,
) {
  if (hasTokenIdentity(preferredMirror)) {
    return normalizeMirrorStatusAttribute(preferredMirror);
  }

  if (!hasTokenIdentity(identityFallback)) {
    return normalizeMirrorStatusAttribute(preferredMirror);
  }

  return normalizeMirrorStatusAttribute({
    ...preferredMirror,
    text: preferredMirror.text || identityFallback.text,
    className: combineClassNames(identityFallback.className, preferredMirror.className),
    attributes: { ...identityFallback.attributes, ...preferredMirror.attributes },
  });
}

function normalizeMirrorStatusAttribute(mirror: MigakuTokenMirror) {
  if (mirror.status === "unparsed") {
    return mirror;
  }

  return {
    ...mirror,
    attributes: {
      ...mirror.attributes,
      "data-mgk-known-status": mirror.status.toUpperCase(),
    },
  };
}

function hasTokenIdentity(mirror: MigakuTokenMirror) {
  return Boolean(
    mirror.attributes["data-mgk-term"] ||
      mirror.attributes["data-migaku-id"] ||
      /\bmigaku-(token|word)/.test(mirror.className),
  );
}

function combineClassNames(...values: string[]) {
  return Array.from(
    new Set(values.flatMap((value) => value.split(/\s+/).filter(Boolean))),
  ).join(" ");
}

function bestStatusElement(element: HTMLElement) {
  const elements = [element, ...Array.from(element.querySelectorAll<HTMLElement>("*"))];
  const explicit = elements.find((candidate) => explicitStatusFromElement(candidate));
  if (explicit) {
    return explicit;
  }

  return elements.find((candidate) => statusFromElement(candidate) !== "unparsed") ?? element;
}

function requestMigakuParse() {
  const event = new CustomEvent("migakuParsePage");
  document.head?.dispatchEvent(event);
  document.body?.dispatchEvent(new CustomEvent("migakuParsePage"));
}

export function syncVisibleSentenceContext(
  visibleRoot: HTMLElement,
  sentence: Sentence,
  activeTokenIndexes: number[],
) {
  const tokenRoots = Array.from(
    visibleRoot.querySelectorAll<HTMLElement>("[data-rsvp-display-token-index]"),
  );
  const sentenceElements = [
    visibleRoot,
    ...Array.from(
      visibleRoot.querySelectorAll<HTMLElement>(
        ".rsvp-sentence-track, [data-rsvp-display-token-index], [data-mgk-sentence], [data-mgk-term], .migaku-token, .migaku-fragment, .migaku-surface, .migaku-ruby, ruby",
      ),
    ),
  ];

  for (const element of sentenceElements) {
    setFullSentenceContext(element, sentence.text);
  }

  const activeIndexSet = new Set(activeTokenIndexes.map(String));
  const activeTokens = tokenRoots.filter((element) =>
    activeIndexSet.has(element.getAttribute("data-rsvp-display-token-index") ?? ""),
  );

  for (const token of activeTokens) {
    let element: HTMLElement | null = token;
    while (element && visibleRoot.contains(element)) {
      setFullSentenceContext(element, sentence.text);
      if (element === visibleRoot) {
        break;
      }
      element = element.parentElement;
    }
  }
}

function setFullSentenceContext(element: HTMLElement, sentenceText: string) {
  if (element.getAttribute("data-mgk-sentence") !== sentenceText) {
    element.setAttribute("data-mgk-sentence", sentenceText);
  }
}

function getMigakuCandidates(root: HTMLElement) {
  const elements = Array.from(root.querySelectorAll<HTMLElement>("*")).filter((element) => {
    const explicitStatus = explicitStatusFromElement(element);
    const computedStatus =
      explicitStatus ||
      hasExplicitStatusDescendant(element) ||
      hasExplicitStatusAncestor(element, root)
        ? null
        : statusFromComputedStyle(element);
    if (!explicitStatus && !computedStatus) {
      return false;
    }
    return candidateSurfaceText(element).length > 0;
  });

  return elements.filter((element) => {
    const text = candidateSurfaceText(element);
    const hasExplicitStatus = Boolean(explicitStatusFromElement(element));
    return !elements.some(
      (other) => {
        if (
          other === element ||
          !element.contains(other) ||
          candidateSurfaceText(other) !== text
        ) {
          return false;
        }

        return !hasExplicitStatus || Boolean(explicitStatusFromElement(other));
      },
    );
  });
}

function hasExplicitStatusDescendant(element: HTMLElement) {
  return Array.from(element.querySelectorAll("*")).some((child) =>
    Boolean(explicitStatusFromElement(child)),
  );
}

function hasExplicitStatusAncestor(element: HTMLElement, root: HTMLElement) {
  let parent = element.parentElement;
  while (parent && root.contains(parent)) {
    if (explicitStatusFromElement(parent)) {
      return true;
    }
    parent = parent.parentElement;
  }
  return false;
}

function getSentenceRoot(root: HTMLElement, sentenceId: string) {
  if (root.matches(`[data-rsvp-sentence-id="${escapeAttribute(sentenceId)}"]`)) {
    return root;
  }

  return (
    root.querySelector<HTMLElement>(`[data-rsvp-sentence-id="${escapeAttribute(sentenceId)}"]`) ??
    root
  );
}

function escapeAttribute(value: string) {
  return value.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

function findCandidateOffset(sentenceText: string, candidateText: string, cursor: number) {
  const fromCursor = sentenceText.indexOf(candidateText, cursor);
  if (fromCursor >= 0) {
    return fromCursor;
  }
  return sentenceText.indexOf(candidateText);
}

function rangesOverlap(aStart: number, aEnd: number, bStart: number, bEnd: number) {
  return aStart < bEnd && bStart < aEnd;
}

function normalizeCandidateText(value: string) {
  return value.replace(/[\s\u200b\ufeff]+/g, "").trim();
}

function candidateSurfaceText(element: HTMLElement) {
  const surfaces = Array.from(element.querySelectorAll<HTMLElement>(".migaku-surface"));
  if (surfaces.length > 0) {
    return normalizeCandidateText(surfaces.map((surface) => surface.textContent ?? "").join(""));
  }

  const clone = element.cloneNode(true) as HTMLElement;
  clone
    .querySelectorAll("rt, rp, .migaku-reading, .migaku-spacer")
    .forEach((node) => node.remove());
  return normalizeCandidateText(clone.textContent ?? "");
}

function splitTokenIndexes(value: string | null) {
  return value?.split(",").filter(Boolean) ?? [];
}

function mergeTokenStatus(
  currentStatus: MigakuTokenStatus | undefined,
  nextStatus: MigakuTokenStatus,
) {
  if (!currentStatus || statusPriority(nextStatus) >= statusPriority(currentStatus)) {
    return nextStatus;
  }
  return currentStatus;
}

function statusPriority(status: MigakuTokenStatus) {
  switch (status) {
    case "unknown":
      return 5;
    case "tracked":
    case "seen":
      return 4;
    case "known":
      return 3;
    case "ignored":
      return 2;
    case "unparsed":
      return 1;
  }
}

function statusFromComputedStyle(element: Element): MigakuTokenStatus | null {
  if (typeof window === "undefined" || !("getComputedStyle" in window) || !(element instanceof HTMLElement)) {
    return null;
  }
  if (isAppTokenWithoutMigakuMarker(element)) {
    return null;
  }

  for (const style of computedStylesFor(element)) {
    const hasDecoration =
      style.textDecorationLine !== "" && style.textDecorationLine !== "none";
    const hasBorder =
      style.borderBottomStyle !== "" &&
      style.borderBottomStyle !== "none" &&
      style.borderBottomWidth !== "" &&
      style.borderBottomWidth !== "0px";
    const hasBackground = !isTransparent(style.backgroundColor);
    if (!hasDecoration && !hasBorder && !hasBackground) {
      continue;
    }

    const status =
      statusFromCssColor(style.textDecorationColor) ??
      statusFromCssColor(style.borderBottomColor) ??
      statusFromCssColor(style.backgroundColor);
    if (status) {
      return status;
    }
  }

  return null;
}

function isAppTokenWithoutMigakuMarker(element: HTMLElement) {
  if (!element.hasAttribute("data-rsvp-display-token-index")) {
    return false;
  }

  const hasMigakuClass = Array.from(element.classList).some(
    (className) => !className.startsWith("rsvp-"),
  );
  const hasMigakuAttribute = Array.from(element.attributes).some(
    (attribute) => attribute.name.startsWith("data-") && !attribute.name.startsWith("data-rsvp-"),
  );

  return !hasMigakuClass && !hasMigakuAttribute;
}

function computedStylesFor(element: HTMLElement) {
  const styles = [window.getComputedStyle(element)];
  if (typeof navigator !== "undefined" && /jsdom/i.test(navigator.userAgent)) {
    return styles;
  }
  for (const pseudoElement of ["::before", "::after"]) {
    try {
      styles.push(window.getComputedStyle(element, pseudoElement));
    } catch {
      // Some test DOM implementations do not support pseudo-element styles.
    }
  }
  return styles;
}

function statusFromCssColor(value: string): MigakuTokenStatus | null {
  const color = parseRgb(value);
  if (!color || color.alpha === 0) {
    return null;
  }

  const { red, green, blue } = color;
  if (red >= 180 && green <= 160 && blue <= 180) {
    return "unknown";
  }
  if (green >= 120 && red <= 170 && blue <= 170) {
    return "known";
  }
  if (red >= 120 && blue >= 140 && green <= 140) {
    return "tracked";
  }
  if (red >= 170 && green >= 110 && blue <= 120) {
    return "seen";
  }
  if (Math.abs(red - green) <= 18 && Math.abs(green - blue) <= 18) {
    return "ignored";
  }

  return null;
}

function parseRgb(value: string) {
  const match = value.match(/rgba?\(([^)]+)\)/i);
  if (!match) {
    return null;
  }

  const [red, green, blue, alphaValue] = match[1]
    .split(/,\s*/)
    .map((part) => Number(part.trim()));
  const alpha = alphaValue ?? 1;
  if ([red, green, blue, alpha].some((part) => Number.isNaN(part))) {
    return null;
  }
  return { red, green, blue, alpha };
}

function isTransparent(value: string) {
  return value === "transparent" || value === "rgba(0, 0, 0, 0)";
}

function mirrorFromElement(element: HTMLElement, status: MigakuTokenStatus) {
  const attributes: Record<string, string> = {};

  for (const attribute of Array.from(element.attributes)) {
    if (
      attribute.name === "class" ||
      attribute.name === "style" ||
      attribute.name === "id" ||
      attribute.name.startsWith("data-rsvp-") ||
      attribute.name.startsWith("on")
    ) {
      continue;
    }

    if (attribute.name.startsWith("data-") || attribute.name === "lang") {
      attributes[attribute.name] = attribute.value;
    }
  }

  return {
    text: element.textContent ?? "",
    status,
    className: element.className
      .toString()
      .split(/\s+/)
      .filter((className) => className && !className.startsWith("rsvp-"))
      .join(" "),
    attributes,
  };
}
