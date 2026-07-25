import { expect, test, type Locator, type Page } from "@playwright/test";
import fs from "node:fs/promises";
import path from "node:path";
import { createSmallEpub } from "../fixtures/createSmallEpub";
import type { LookupEvent, ReaderPosition, ReadingSession } from "../../src/types";

test("imports an EPUB and reacts to Migaku-like parsed tokens", async ({ page }, testInfo) => {
  const epubPath = path.join(testInfo.outputDir, "small.epub");
  await createSmallEpub(epubPath);

  await page.goto("/");
  await page.evaluate(async () => {
    localStorage.clear();
    await indexedDB.deleteDatabase("migaku-rsvp");
  });
  await page.reload();
  await page.locator('input[type="file"]').setInputFiles(epubPath);

  await expect(page.getByRole("button", { name: "小さな本 Fixture" })).toBeVisible({
    timeout: 30_000,
  });
  await expect(page.locator(".rsvp-token-display")).toHaveText("猫が走る。");
  await expectVisibleSentenceText(page, "猫が走る。");
  await expectRsvpDisplayText(page, "猫");
  await expect(activeRsvpToken(page)).toHaveText("猫");
  await expect(page.locator(".rsvp-token-display .rsvp-display-token--context")).not.toHaveCount(0);
  await expect(page.locator(".rsvp-token-display .rsvp-display-token--context").first()).toHaveCSS(
    "opacity",
    "0",
  );
  await expect(page.locator(".rsvp-token-display")).toHaveClass(/rsvp-token-display--stopped/);
  await page.locator(".rsvp-token-display").hover();
  await expectContextSentenceVisible(page);
  await page.mouse.move(0, 0);
  await expectContextSentenceHidden(page);
  await expectRsvpTokensHaveNoTransition(page);
  await expectActiveTokenCentered(page);
  const initialActiveMiddle = await activeTokenMiddle(page);
  const progressLabel = page.locator(".reader-progress-value--full");
  const progressMeter = page.locator("progress");
  const initialProgressLabel = await progressLabel.innerText();
  const initialProgressValue = await progressMeter.getAttribute("value");

  await page.getByRole("button", { name: "Next" }).click();
  await expect.poll(() => progressLabel.innerText()).not.toBe(initialProgressLabel);
  await expect.poll(() => progressMeter.getAttribute("value")).not.toBe(initialProgressValue);
  await expect(page.locator(".rsvp-token-display")).toHaveText("猫が走る。");
  await expectVisibleSentenceText(page, "猫が走る。");
  await expectRsvpDisplayText(page, "が");
  await expect(activeRsvpToken(page)).toHaveText("が");
  await expectContextSentenceHidden(page);
  await expectRsvpTokensHaveNoTransition(page);
  await expectActiveTokenCentered(page);
  await expectActiveTokenMiddleToMatch(page, initialActiveMiddle);
  await page.getByRole("button", { name: "Previous" }).click();
  await expectRsvpDisplayText(page, "猫");
  await expect(activeRsvpToken(page)).toHaveText("猫");
  await expectActiveTokenCentered(page);

  await page.getByRole("button", { name: /Jump to location/ }).click();
  const locationInput = page.getByRole("textbox", { name: "Location" });
  await expect(locationInput).toHaveValue("1");
  await locationInput.fill("4");
  await locationInput.press("Enter");
  await expectRsvpDisplayText(page, "犬");
  await expect(activeRsvpToken(page)).toHaveText("犬");
  await expectProgressCurrent(page, 4);

  await page.getByRole("button", { name: /Jump to location/ }).click();
  await page.getByRole("textbox", { name: "Location" }).fill("1");
  await page.getByRole("textbox", { name: "Location" }).press("Enter");
  await expectRsvpDisplayText(page, "猫");
  await expect(activeRsvpToken(page)).toHaveText("猫");
  await expectProgressCurrent(page, 1);

  await page.getByRole("button", { name: /Jump to location/ }).click();
  await page.getByRole("textbox", { name: "Location" }).fill("4");
  await page.getByRole("button", { name: "Go to location" }).click();
  await expectRsvpDisplayText(page, "犬");
  await expect(activeRsvpToken(page)).toHaveText("犬");
  await expectProgressCurrent(page, 4);

  await page.getByRole("button", { name: /Jump to location/ }).click();
  await page.getByRole("textbox", { name: "Location" }).fill("1");
  await page.getByRole("textbox", { name: "Location" }).blur();
  await expect(page.getByRole("textbox", { name: "Location" })).toBeVisible();
  await page.getByRole("button", { name: "Go to location" }).click();
  await expectRsvpDisplayText(page, "猫");
  await expect(activeRsvpToken(page)).toHaveText("猫");
  await expectProgressCurrent(page, 1);

  await page.getByRole("button", { name: "Search in book" }).click();
  const bookSearchInput = page.getByRole("searchbox", { name: "Search in book" });
  await expect(bookSearchInput).toBeFocused();
  await bookSearchInput.fill("鳥は空");
  await bookSearchInput.press("Enter");
  await expectVisibleSentenceText(page, "鳥は空を見る。");
  await expectRsvpDisplayText(page, "鳥");
  await expect(activeRsvpToken(page)).toHaveText("鳥");
  await expectProgressCurrent(page, 7);

  await page.getByRole("button", { name: "Search in book" }).click();
  const unmatchedSearchInput = page.getByRole("searchbox", { name: "Search in book" });
  await unmatchedSearchInput.fill("鳥 は 空");
  await page.getByRole("button", { name: "Find passage" }).click();
  await expect(unmatchedSearchInput).toHaveAttribute("aria-invalid", "true");
  await expect(page.locator(".book-search-status")).toHaveText("No match");
  await expect(page.locator("progress")).toHaveAttribute("value", "7");
  await page.getByRole("button", { name: "Close search" }).click();

  await page.getByRole("button", { name: /Jump to location/ }).click();
  await page.getByRole("textbox", { name: "Location" }).fill("1");
  await page.getByRole("textbox", { name: "Location" }).press("Enter");
  await expectRsvpDisplayText(page, "猫");
  await expect(activeRsvpToken(page)).toHaveText("猫");
  await expectProgressCurrent(page, 1);

  await expect(page.getByRole("button", { name: "Recap" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Settings" })).toHaveAttribute(
    "aria-expanded",
    "false",
  );
  await page.getByRole("button", { name: "Settings" }).click();
  await setRangeValue(page.locator("label", { hasText: "Steps/min" }).locator("input"), "133");
  await expect(page.locator("label", { hasText: "Steps/min" }).locator(".setting-value")).toHaveText(
    "133",
  );
  await setRangeValue(page.locator("label", { hasText: "Font" }).locator("input"), "80");
  await expect(page.locator("label", { hasText: "Font" }).locator(".setting-value")).toHaveText(
    "80px",
  );
  await setRangeValue(page.locator("label", { hasText: "Words" }).locator("input"), "3");
  await expect(page.locator("label", { hasText: "Words" }).locator(".setting-value")).toHaveText(
    "3",
  );
  await expect(page.locator("label", { hasText: "Max chars" }).locator(".setting-value")).toHaveText(
    "4",
  );
  await setRangeValue(page.locator("label", { hasText: "Max chars" }).locator("input"), "5");
  await expect(page.locator("label", { hasText: "Max chars" }).locator(".setting-value")).toHaveText(
    "5",
  );
  const groupBy = page.locator("fieldset", { hasText: "Group by" });
  await expect(groupBy.getByRole("button")).toHaveText(["Words", "Characters"]);
  await groupBy.getByRole("button", { name: "Characters" }).click();
  await expect(page.locator("label", { hasText: "Max chars" })).toHaveCount(0);
  await setRangeValue(page.locator("label", { hasText: "Characters" }).locator("input"), "3");
  await expectRsvpDisplayText(page, "猫が走");
  await groupBy.getByRole("button", { name: "Words" }).click();
  await expect(page.locator("label", { hasText: "Max chars" }).locator(".setting-value")).toHaveText(
    "5",
  );
  await expectRsvpDisplayText(page, "猫が走る。");
  await page.getByRole("button", { name: "Never" }).click();
  await expect(page.getByRole("button", { name: "Never" })).toHaveAttribute("aria-pressed", "true");
  await page.getByRole("button", { name: "Unknown" }).click();
  await expect(page.getByRole("button", { name: "Unknown" })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await page.getByRole("button", { name: "Dark" }).click();
  await expect(page.locator(".app")).toHaveAttribute("data-theme", "dark");
  await page.getByRole("button", { name: "Paper" }).click();
  await expect(page.locator(".app")).toHaveAttribute("data-theme", "paper");

  await page.reload();
  await page.getByRole("button", { name: "Settings" }).click();
  await expect(page.locator("label", { hasText: "Steps/min" }).locator(".setting-value")).toHaveText(
    "133",
  );
  await expect(page.locator("label", { hasText: "Font" }).locator(".setting-value")).toHaveText(
    "80px",
  );
  await expect(page.locator("label", { hasText: "Words" }).locator(".setting-value")).toHaveText(
    "3",
  );
  await expect(page.locator("label", { hasText: "Max chars" }).locator(".setting-value")).toHaveText(
    "5",
  );
  await setRangeValue(page.locator("label", { hasText: "Steps/min" }).locator("input"), "150");
  await setRangeValue(page.locator("label", { hasText: "Words" }).locator("input"), "1");

  await page.locator(".migaku-buffer-surface [data-rsvp-sentence-id]").first().evaluate((surface) => {
    surface.innerHTML = `
      <span class="migaku-token unknown" data-mgk-term="猫" data-mgk-known-status="UNKNOWN" data-mgk-sentence="猫">
        <span class="migaku-surface">猫</span>
      </span>
      <span class="migaku-token known" data-mgk-term="が" data-mgk-known-status="KNOWN" data-mgk-sentence="が">
        <span class="migaku-surface">が</span>
      </span>
      <span class="migaku-token known" data-mgk-term="走る" data-mgk-known-status="KNOWN" data-mgk-sentence="走る">
        <span class="migaku-surface">走る</span>
      </span>
      <span>。</span>
    `;
  });

  await expect(page.locator(".migaku-pill")).toContainText("parsed");
  await expectVisibleSentenceText(page, "猫が走る。");
  await expectRsvpDisplayText(page, "猫");
  await expect(activeRsvpToken(page)).toHaveText("猫");
  await expect(activeRsvpToken(page)).toHaveClass(/unknown/);
  await expect(activeRsvpToken(page)).toHaveAttribute("data-mgk-sentence", "猫が走る。");
  await expectActiveStatusUnderlineIsOverlay(page);
  await activeRsvpToken(page).evaluate((element) => {
    const display = element.closest(".rsvp-token-display");
    display?.querySelector(".rsvp-sentence-track")?.setAttribute("data-mgk-sentence", "猫");
    display
      ?.querySelectorAll("[data-rsvp-display-token-index], [data-mgk-sentence]")
      .forEach((candidate) => candidate.setAttribute("data-mgk-sentence", "猫"));
    element.innerHTML =
      '<span class="migaku-token" data-mgk-term="猫" data-mgk-sentence="猫"><span class="migaku-fragment" data-mgk-sentence="猫"><span class="migaku-surface">猫</span></span></span>';
    element.setAttribute("data-mgk-sentence", "猫");
  });
  await expect(activeRsvpToken(page)).toHaveAttribute("data-mgk-sentence", "猫が走る。");
  await expect(page.locator(".rsvp-sentence-track")).toHaveAttribute(
    "data-mgk-sentence",
    "猫が走る。",
  );
  await expectAllVisibleMigakuSentenceAttrs(page, "猫が走る。");
  await expect(activeRsvpToken(page)).not.toHaveClass(/migaku-word-cont/);
  await expectContextTokensHaveNoDecoration(page);
  await expect(page.locator(".migaku-buffer-surface")).toHaveCSS("opacity", "0.07");
  await expectActiveTokenCentered(page);

  await page.getByRole("button", { name: "Next" }).click();
  await expectRsvpDisplayText(page, "が");
  await expect(activeRsvpToken(page)).toHaveText("が");
  await expect(activeRsvpToken(page)).toHaveClass(/known/);
  await expect(activeRsvpToken(page)).toHaveAttribute("data-mgk-sentence", "猫が走る。");
  await expectActiveStatusUnderlineIsOverlay(page);
  await expectActiveTokenCentered(page);
  await page.getByRole("button", { name: "Previous" }).click();
  await expectRsvpDisplayText(page, "猫");
  await expect(activeRsvpToken(page)).toHaveText("猫");
  await expect(activeRsvpToken(page)).toHaveClass(/unknown/);

  await page.getByRole("button", { name: "Play" }).click();
  await expect(page.getByRole("button", { name: "Play" })).toBeVisible();

  await page.locator(".migaku-buffer-surface [data-rsvp-sentence-id]").first().evaluate((surface) => {
    surface.innerHTML = `
      <span class="migaku-word-cont known">猫</span>
      <span class="migaku-word-cont known">が</span>
      <span class="migaku-word-cont unknown">走る</span>
      <span>。</span>
    `;
  });

  await expectRsvpDisplayText(page, "猫");
  await expect(activeRsvpToken(page)).toHaveClass(/known/);
  await page.getByRole("button", { name: "Play" }).click();
  await expectRsvpDisplayText(page, "走る。");
  await expect(activeRsvpToken(page)).toHaveText("走る");
  await expect(activeRsvpToken(page)).toHaveClass(/unknown/);
  await expect(page.getByRole("button", { name: "Play" })).toBeVisible();

  await page.getByRole("button", { name: "Next" }).click();
  await expectRsvpDisplayText(page, "犬");
  await expect(activeRsvpToken(page)).toHaveText("犬");
  await expect
    .poll(() => activeRsvpToken(page).getAttribute("data-mgk-term"))
    .not.toBe("走る");
  await expect(activeRsvpToken(page)).not.toHaveClass(/unknown/);
});

test("answers follow-up questions from the recap panel", async ({ page }, testInfo) => {
  const epubPath = path.join(testInfo.outputDir, "recap-follow-up.epub");
  await createSmallEpub(epubPath);
  const aiRequests: unknown[] = [];
  let releaseFollowUpResponse: (() => void) | undefined;
  const followUpResponseReady = new Promise<void>((resolve) => {
    releaseFollowUpResponse = resolve;
  });

  await page.route("**/api/ai/chat", async (route) => {
    const requestIndex = aiRequests.length;
    const payload = route.request().postDataJSON();
    aiRequests.push(payload);
    if (requestIndex === 1) {
      await followUpResponseReady;
    }

    await route.fulfill({
      status: 200,
      json: {
        choices: [
          {
            message: {
              content:
                requestIndex === 0
                  ? "The cat ran before the dog joined."
                  : "The cat ran.",
            },
          },
        ],
      },
    });
  });

  await page.goto("/");
  await page.evaluate(async () => {
    localStorage.clear();
    localStorage.setItem(
      "migaku-rsvp:settings",
      JSON.stringify({ recapApiUrl: "/api/ai/chat", recapModel: "test-model" }),
    );
    await indexedDB.deleteDatabase("migaku-rsvp");
  });
  await page.reload();
  await page.locator('input[type="file"]').setInputFiles(epubPath);

  await expect(page.locator(".rsvp-token-display")).toHaveText("猫が走る。", {
    timeout: 30_000,
  });
  await page.getByRole("button", { name: "Next" }).click();
  await page.getByRole("button", { name: "Next" }).click();
  await page.getByRole("button", { name: "Next" }).click();
  await expectVisibleSentenceText(page, "犬も走る。");

  await page.getByRole("button", { name: "Recap" }).click();
  const recapPanel = page.locator(".recap-panel");
  await expect(recapPanel).toContainText("The cat ran before the dog joined.");
  await expect(page.getByRole("textbox", { name: "Follow-up question" })).toBeVisible();

  await page.getByRole("textbox", { name: "Follow-up question" }).fill("Who ran?");
  await page.getByRole("button", { name: "Send follow-up" }).click();

  await expect(recapPanel).toContainText("Who ran?");
  await expect(recapPanel).toContainText("Answering...");
  await page.locator(".recap-followup-answer").evaluate((answer) => {
    answer.innerHTML = `
      <span class="migaku-sentence-group migaku-sentence -mgk-processed">Answer</span>
      <div class="migaku-sentence -mgk-injected">Answering...</div>
    `;
  });
  releaseFollowUpResponse?.();
  await expect(recapPanel).toContainText("The cat ran.");
  await expect(recapPanel).not.toContainText("Answering...");
  const recapCopyStyles = await recapPanel.evaluate((panel) => {
    const extensionStyle = document.createElement("style");
    extensionStyle.textContent = `
      .migaku-token {
        display: inline-flex !important;
        flex-direction: column !important;
        align-items: center !important;
        margin: 5px 0 !important;
        position: relative !important;
        vertical-align: text-bottom !important;
        white-space: nowrap !important;
      }

      .migaku-fragment {
        display: flex !important;
        flex-direction: column-reverse !important;
        align-items: center !important;
      }

      .migaku-fragment .migaku-surface {
        display: block !important;
        width: 100% !important;
        padding: 1px 0 !important;
        text-align: center !important;
        white-space: nowrap !important;
      }
    `;
    document.head.append(extensionStyle);

    const answerCopy = panel.querySelector<HTMLElement>(".recap-followup-answer .recap-copy");
    if (!answerCopy) {
      throw new Error("Missing answer copy");
    }
    answerCopy.innerHTML = `
      <span class="migaku-token">
        <span class="migaku-fragment -mgk-content">
          <span class="migaku-surface">The cat</span>
          <span class="migaku-spacer" aria-hidden="true">\u200b</span>
        </span>
      </span>
      <span class="migaku-token">
        <span class="migaku-fragment -mgk-content">
          <span class="migaku-surface">ran.</span>
          <span class="migaku-spacer" aria-hidden="true">\u200b</span>
        </span>
      </span>
    `;

    const token = answerCopy.querySelector<HTMLElement>(".migaku-token");
    const fragment = answerCopy.querySelector<HTMLElement>(".migaku-fragment");
    const surface = answerCopy.querySelector<HTMLElement>(".migaku-surface");
    if (!token || !fragment || !surface) {
      throw new Error("Missing Migaku fixture nodes");
    }

    const tokenStyle = getComputedStyle(token);
    const fragmentStyle = getComputedStyle(fragment);
    const surfaceStyle = getComputedStyle(surface);
    return {
      fragmentDisplay: fragmentStyle.display,
      surfaceDisplay: surfaceStyle.display,
      surfaceTextAlign: surfaceStyle.textAlign,
      tokenDisplay: tokenStyle.display,
      tokenMarginTop: tokenStyle.marginTop,
    };
  });
  expect(recapCopyStyles).toEqual({
    fragmentDisplay: "inline",
    surfaceDisplay: "inline",
    surfaceTextAlign: "start",
    tokenDisplay: "inline",
    tokenMarginTop: "0px",
  });
  expect(aiRequests).toHaveLength(2);
  expect(JSON.stringify(aiRequests[1])).toContain("The cat ran before the dog joined.");
  expect(JSON.stringify(aiRequests[1])).toContain("Who ran?");
});

test("restores the selected server-library book after refresh", async ({ page }, testInfo) => {
  const firstEpubPath = path.join(testInfo.outputDir, "server-first.epub");
  const secondEpubPath = path.join(testInfo.outputDir, "server-second.epub");
  await createSmallEpub(firstEpubPath, ["一番目。"]);
  await createSmallEpub(secondEpubPath, ["二番目。"]);

  const firstBytes = await fs.readFile(firstEpubPath);
  const secondBytes = await fs.readFile(secondEpubPath);
  const serverBooks = [
    {
      id: "server-first",
      fileName: "server-first.epub",
      relativePath: "server-first.epub",
      modifiedAt: "2026-07-05T00:00:00.000Z",
      size: firstBytes.byteLength,
    },
    {
      id: "server-second",
      fileName: "server-second.epub",
      relativePath: "server-second.epub",
      modifiedAt: "2026-07-04T00:00:00.000Z",
      size: secondBytes.byteLength,
    },
  ];
  const epubBytesByBookId = new Map([
    ["server-first", firstBytes],
    ["server-second", secondBytes],
  ]);
  const progressByBookId: Record<string, ReaderPosition> = {
    "server-first": { sentenceIndex: 0, tokenIndex: 0 },
    "server-second": { sentenceIndex: 0, tokenIndex: 0 },
  };

  await page.route("**/api/library/status", async (route) => {
    await route.fulfill({
      status: 200,
      json: { enabled: true, bookCount: serverBooks.length },
    });
  });
  await page.route("**/api/books", async (route) => {
    if (route.request().method() !== "GET") {
      await route.fulfill({ status: 405, json: { error: "Method not allowed." } });
      return;
    }

    await route.fulfill({
      status: 200,
      json: serverBooks.map((book) => ({
        ...book,
        progress: progressByBookId[book.id],
      })),
    });
  });
  await page.route(/\/api\/books\/[^/]+\/file$/, async (route) => {
    const bookId = decodeURIComponent(
      new URL(route.request().url()).pathname.split("/")[3] ?? "",
    );
    const epubBytes = epubBytesByBookId.get(bookId);

    if (!epubBytes) {
      await route.fulfill({ status: 404, json: { error: "Book not found." } });
      return;
    }

    await route.fulfill({
      status: 200,
      body: epubBytes,
      headers: { "Content-Type": "application/epub+zip" },
    });
  });
  await page.route(/\/api\/books\/[^/]+\/progress$/, async (route) => {
    const request = route.request();
    const bookId = decodeURIComponent(
      new URL(request.url()).pathname.split("/")[3] ?? "",
    );

    if (!(bookId in progressByBookId)) {
      await route.fulfill({ status: 404, json: { error: "Book not found." } });
      return;
    }

    if (request.method() === "GET") {
      await route.fulfill({ status: 200, json: progressByBookId[bookId] });
      return;
    }

    if (request.method() === "PUT") {
      progressByBookId[bookId] = request.postDataJSON() as ReaderPosition;
      await route.fulfill({ status: 200, json: progressByBookId[bookId] });
      return;
    }

    await route.fulfill({ status: 405, json: { error: "Method not allowed." } });
  });
  await page.route("**/api/reading-sessions", async (route) => {
    await route.fulfill({ status: 200, json: [] });
  });

  await page.goto("/");
  await page.evaluate(async () => {
    localStorage.clear();
    await indexedDB.deleteDatabase("migaku-rsvp");
  });
  await page.reload();

  await expect(page.locator(".rsvp-token-display")).toHaveText("一番目。", {
    timeout: 30_000,
  });
  await page.getByRole("button", { name: "server-second Server library" }).click();
  await expect(page.locator(".rsvp-token-display")).toHaveText("二番目。", {
    timeout: 30_000,
  });
  await expect
    .poll(() => page.evaluate(() => localStorage.getItem("migaku-rsvp:selected-book-id")))
    .toBe("server-second");

  await page.reload();
  await expect(page.locator(".rsvp-token-display")).toHaveText("二番目。", {
    timeout: 30_000,
  });
});

test("loads server reading stats and migrates local reading sessions", async ({
  page,
}, testInfo) => {
  const epubPath = path.join(testInfo.outputDir, "server-stats.epub");
  await createSmallEpub(epubPath);
  const epubBytes = await fs.readFile(epubPath);
  const serverBook = {
    id: "server-book",
    fileName: "server-book.epub",
    relativePath: "server-book.epub",
    modifiedAt: "2026-07-05T00:00:00.000Z",
    size: epubBytes.byteLength,
    progress: { sentenceIndex: 0, tokenIndex: 0 },
  };
  const nowMs = Date.now();
  const serverSession = createReadingSessionFixture({
    id: "server-session",
    bookId: "server-book",
    startedAtMs: nowMs - 12 * 60_000,
    durationMs: 12 * 60_000,
    characterCount: 480,
  });
  const olderServerSession = createReadingSessionFixture({
    id: "older-server-session",
    bookId: "server-book",
    startedAtMs: nowMs - 10 * 24 * 60 * 60_000,
    durationMs: 4 * 60_000,
    characterCount: 16,
  });
  const localSession = createReadingSessionFixture({
    id: "local-session",
    bookId: "server-book",
    startedAtMs: nowMs - 5 * 60_000,
    durationMs: 5 * 60_000,
    characterCount: 120,
  });
  const serverLookupEvent = createLookupEventFixture({
    id: "server-lookup",
    bookId: "server-book",
    occurredAtMs: nowMs - 6 * 60_000,
    term: "猫",
  });
  const olderServerLookupEvent = createLookupEventFixture({
    id: "older-server-lookup",
    bookId: "server-book",
    occurredAtMs: nowMs - 10 * 24 * 60 * 60_000,
    term: "犬",
  });
  const localLookupEvent = createLookupEventFixture({
    id: "local-lookup",
    bookId: "server-book",
    occurredAtMs: nowMs - 2 * 60_000,
    term: "走る",
  });
  const migratedSessions: unknown[] = [];
  const migratedLookupEvents: unknown[] = [];

  await page.route("**/api/library/status", async (route) => {
    await route.fulfill({ status: 200, json: { enabled: true, bookCount: 1 } });
  });
  await page.route("**/api/books", async (route) => {
    await route.fulfill({ status: 200, json: [serverBook] });
  });
  await page.route(/\/api\/books\/[^/]+\/file$/, async (route) => {
    await route.fulfill({
      status: 200,
      body: epubBytes,
      headers: { "Content-Type": "application/epub+zip" },
    });
  });
  await page.route(/\/api\/books\/[^/]+\/progress$/, async (route) => {
    await route.fulfill({ status: 200, json: serverBook.progress });
  });
  await page.route("**/api/reading-sessions", async (route) => {
    const request = route.request();
    if (request.method() === "GET") {
      await route.fulfill({ status: 200, json: [olderServerSession, serverSession] });
      return;
    }

    if (request.method() === "POST") {
      migratedSessions.push(request.postDataJSON());
      await route.fulfill({ status: 200, json: request.postDataJSON() });
      return;
    }

    await route.fulfill({ status: 405, json: { error: "Method not allowed." } });
  });
  await page.route("**/api/lookup-events", async (route) => {
    const request = route.request();
    if (request.method() === "GET") {
      await route.fulfill({ status: 200, json: [olderServerLookupEvent, serverLookupEvent] });
      return;
    }

    if (request.method() === "POST") {
      migratedLookupEvents.push(request.postDataJSON());
      await route.fulfill({ status: 200, json: request.postDataJSON() });
      return;
    }

    await route.fulfill({ status: 405, json: { error: "Method not allowed." } });
  });

  await page.goto("/");
  await page.evaluate(async ({ lookupEvent, session }) => {
    localStorage.clear();
    await new Promise<void>((resolve, reject) => {
      const request = indexedDB.open("migaku-rsvp");
      request.onupgradeneeded = () => {
        const database = request.result;
        if (!database.objectStoreNames.contains("books")) {
          const store = database.createObjectStore("books", { keyPath: "id" });
          store.createIndex("by-created", "createdAt");
        }
        if (!database.objectStoreNames.contains("readingSessions")) {
          const store = database.createObjectStore("readingSessions", { keyPath: "id" });
          store.createIndex("by-book", "bookId");
          store.createIndex("by-started", "startedAt");
        }
        if (!database.objectStoreNames.contains("lookupEvents")) {
          const store = database.createObjectStore("lookupEvents", { keyPath: "id" });
          store.createIndex("by-book", "bookId");
          store.createIndex("by-occurred", "occurredAt");
        }
      };
      request.onerror = () => reject(request.error);
      request.onsuccess = () => {
        const database = request.result;
        const transaction = database.transaction(["readingSessions", "lookupEvents"], "readwrite");
        transaction.objectStore("readingSessions").put(session);
        transaction.objectStore("lookupEvents").put(lookupEvent);
        transaction.onerror = () => reject(transaction.error);
        transaction.oncomplete = () => {
          database.close();
          resolve();
        };
      };
    });
  }, { lookupEvent: localLookupEvent, session: localSession });
  await page.reload();

  await expect(page.locator(".stats-summary span", { hasText: "Today" }).locator("strong"))
    .toHaveText("17m");
  await expect(page.locator(".stats-summary span", { hasText: "Chars" }).locator("strong"))
    .toHaveText("600");
  await expect(page.locator(".book-stats-grid span", { hasText: "Time read" }).locator("strong"))
    .toHaveText("21m");
  await expect(page.locator(".book-stats-grid span", { hasText: "Pace" }).locator("strong"))
    .toHaveText("29/min");
  await expect(page.locator(".book-stats-grid span", { hasText: "Lookups" }).locator("strong"))
    .toHaveText("3");
  await expect(page.locator(".book-stats-meta")).toContainText("616 characters");
  await expect(page.locator(".book-stats-meta")).toContainText("3 sessions");
  const dailyTimeChart = page.locator(".stats-section > .reading-chart");
  await expect(dailyTimeChart.locator(".reading-chart-day")).toHaveCount(11);
  const todayChartBar = dailyTimeChart.locator(".reading-chart-bar-track").last();
  const todayChartTooltip = dailyTimeChart.locator(".reading-chart-tooltip").last();
  await expect(todayChartTooltip).toBeHidden();
  await todayChartBar.hover();
  await expect(todayChartTooltip).toHaveText("17 min");
  await expect(todayChartTooltip).toBeVisible();
  await page.mouse.move(0, 0);
  await expect(todayChartTooltip).toBeHidden();
  await todayChartBar.click();
  await expect(todayChartTooltip).toBeVisible();
  const bookProgressChart = page.locator(".book-progress-chart");
  await expect(bookProgressChart.locator(".reading-chart-day")).toHaveCount(11);
  const latestBookProgressBar = bookProgressChart.locator(".reading-chart-bar-track").last();
  const latestBookProgressTooltip = bookProgressChart.locator(".reading-chart-tooltip").last();
  await latestBookProgressBar.hover();
  await expect(latestBookProgressTooltip).toHaveText("3% total, +2%");
  await expect(latestBookProgressTooltip).toBeVisible();
  const bookSpeedChart = page.locator(".book-speed-chart");
  await expect(bookSpeedChart.locator(".reading-chart-day")).toHaveCount(11);
  const latestBookSpeedBar = bookSpeedChart.locator(".reading-chart-bar-track").last();
  const latestBookSpeedTooltip = bookSpeedChart.locator(".reading-chart-tooltip").last();
  await latestBookSpeedBar.hover();
  await expect(latestBookSpeedTooltip).toHaveText("35/min, 17m");
  await expect(latestBookSpeedTooltip).toBeVisible();
  const bookLookupsChart = page.locator(".book-lookups-chart");
  await expect(bookLookupsChart.locator(".reading-chart-day")).toHaveCount(11);
  const latestBookLookupsBar = bookLookupsChart.locator(".reading-chart-bar-track").last();
  const latestBookLookupsTooltip = bookLookupsChart.locator(".reading-chart-tooltip").last();
  await latestBookLookupsBar.hover();
  await expect(latestBookLookupsTooltip).toHaveText("2 lookups");
  await expect(latestBookLookupsTooltip).toBeVisible();
  await expect.poll(() => migratedSessions).toContainEqual(localSession);
  await expect.poll(() => migratedLookupEvents).toContainEqual(localLookupEvent);
  const migratedSessionCount = migratedSessions.length;
  await page.getByRole("button", { name: "Play" }).click();
  await page.waitForTimeout(150);
  await page.evaluate(() => {
    window.dispatchEvent(new Event("blur"));
  });
  await expect(page.getByRole("button", { name: "Play" })).toBeVisible();
  await page.waitForTimeout(200);
  expect(migratedSessions).toHaveLength(migratedSessionCount);
});

test("uses prefixed API routes when the app is mounted below a path", async ({ page }) => {
  const session = createReadingSessionFixture({
    id: "prefixed-session",
    bookId: "server-book",
    startedAtMs: Date.now() - 3 * 60_000,
    durationMs: 3 * 60_000,
    characterCount: 77,
  });
  const requestedPaths: string[] = [];

  await page.route(/\/(?:rsvp\/)?api\/.*/, async (route) => {
    const request = route.request();
    const pathname = new URL(request.url()).pathname;
    requestedPaths.push(pathname);

    if (!pathname.startsWith("/rsvp/api/")) {
      await route.fulfill({ status: 404, json: { error: "Not found." } });
      return;
    }

    if (pathname === "/rsvp/api/library/status") {
      await route.fulfill({ status: 200, json: { enabled: true, bookCount: 0 } });
      return;
    }

    if (pathname === "/rsvp/api/books") {
      await route.fulfill({ status: 200, json: [] });
      return;
    }

    if (pathname === "/rsvp/api/reading-sessions") {
      await route.fulfill({ status: 200, json: [session] });
      return;
    }

    if (pathname === "/rsvp/api/lookup-events") {
      await route.fulfill({ status: 200, json: [] });
      return;
    }

    await route.fulfill({ status: 404, json: { error: "Not found." } });
  });

  await page.goto("/rsvp/");
  await expect(page.locator(".stats-summary span", { hasText: "Today" }).locator("strong"))
    .toHaveText("3m");
  await expect(page.locator(".stats-summary span", { hasText: "Chars" }).locator("strong"))
    .toHaveText("77");
  expect(requestedPaths).toContain("/api/library/status");
  expect(requestedPaths).toContain("/rsvp/api/library/status");
  expect(requestedPaths).toContain("/rsvp/api/reading-sessions");
  expect(requestedPaths).toContain("/rsvp/api/lookup-events");
});

test("uses Migaku token boundaries when Migaku spans multiple fallback tokens", async ({
  page,
}, testInfo) => {
  const epubPath = path.join(testInfo.outputDir, "migaku-boundaries.epub");
  await createSmallEpub(epubPath, ["猫が走る。"]);

  await page.goto("/");
  await page.evaluate(async () => {
    localStorage.clear();
    await indexedDB.deleteDatabase("migaku-rsvp");
  });
  await page.reload();
  await page.locator('input[type="file"]').setInputFiles(epubPath);

  await expect(page.locator(".rsvp-token-display")).toHaveText("猫が走る。", {
    timeout: 30_000,
  });
  await page.locator(".migaku-buffer-surface [data-rsvp-sentence-id]").first().evaluate((surface) => {
    surface.innerHTML = `
      <span class="migaku-token unknown" data-mgk-term="猫が" data-mgk-known-status="UNKNOWN" data-mgk-sentence="猫が">
        <span class="migaku-surface">猫が</span>
      </span>
      <span class="migaku-token known" data-mgk-term="走る" data-mgk-known-status="KNOWN" data-mgk-sentence="走る">
        <span class="migaku-surface">走る</span>
      </span>
      <span>。</span>
    `;
  });

  await expect(page.locator(".migaku-pill")).toContainText("parsed");
  await expectRsvpDisplayText(page, "猫が");
  await expect(activeRsvpToken(page)).toHaveCount(1);
  await expect(activeRsvpToken(page)).toHaveText("猫が");
  await expect(activeRsvpToken(page)).toHaveAttribute("data-rsvp-display-token-index", "0,1");
  await expect(activeRsvpToken(page)).toHaveClass(/unknown/);
  await expectActiveTokenCentered(page);

  await page.getByRole("button", { name: "Next" }).click();
  await expectRsvpDisplayText(page, "走る。");
  await expect(activeRsvpToken(page)).toHaveText("走る");
  await expect(activeRsvpToken(page)).toHaveClass(/known/);
  await expectActiveTokenCentered(page);

  await page.getByRole("button", { name: "Previous" }).click();
  await expectRsvpDisplayText(page, "猫が");
  await expect(activeRsvpToken(page)).toHaveText("猫が");
  await expectActiveTokenCentered(page);
});

test("uses vertical arrows for sentence jumps and horizontal arrows for token steps", async ({
  page,
}, testInfo) => {
  const epubPath = path.join(testInfo.outputDir, "keyboard.epub");
  await createSmallEpub(epubPath);

  await page.goto("/");
  await page.evaluate(async () => {
    localStorage.clear();
    await indexedDB.deleteDatabase("migaku-rsvp");
  });
  await page.reload();
  await page.locator('input[type="file"]').setInputFiles(epubPath);

  await expect(page.locator(".rsvp-token-display")).toHaveText("猫が走る。", {
    timeout: 30_000,
  });
  await expectRsvpDisplayText(page, "猫");
  await expectProgressCurrent(page, 1);
  await page.evaluate(() => {
    if (document.activeElement instanceof HTMLElement) {
      document.activeElement.blur();
    }
  });

  await page.keyboard.press("ArrowRight");
  await expectRsvpDisplayText(page, "が");
  await expectProgressCurrent(page, 2);

  await page.getByRole("button", { name: "Previous" }).click();
  await expectRsvpDisplayText(page, "猫");
  await expectProgressCurrent(page, 1);
  await page.getByRole("button", { name: "Next" }).click();
  await expectRsvpDisplayText(page, "が");
  await expectProgressCurrent(page, 2);
  await page.getByRole("button", { name: "Next" }).click();
  await expectRsvpDisplayText(page, "走る。");
  await expectProgressCurrent(page, 3);
  await page.getByRole("button", { name: "Previous" }).click();
  await expectRsvpDisplayText(page, "が");
  await expectProgressCurrent(page, 2);
  await page.getByRole("button", { name: "Previous" }).click();
  await expectRsvpDisplayText(page, "猫");
  await expectProgressCurrent(page, 1);

  await page.keyboard.press("ArrowDown");
  await expectVisibleSentenceText(page, "犬も走る。");
  await expectRsvpDisplayText(page, "犬");
  await expectProgressCurrent(page, 4);

  await page.getByRole("button", { name: "Next" }).click();
  await expectRsvpDisplayText(page, "も");
  await expectProgressCurrent(page, 5);
  await page.locator(".migaku-buffer-surface [data-rsvp-sentence-id]").nth(1).evaluate((surface) => {
    surface.innerHTML = `
      <span class="migaku-token known" data-mgk-term="犬も走る" data-mgk-known-status="KNOWN" data-mgk-sentence="犬も走る">
        <span class="migaku-surface">犬も走る</span>
      </span>
      <span>。</span>
    `;
  });
  await expectRsvpDisplayText(page, "も");

  await page.getByRole("button", { name: "Previous" }).click();
  await expectRsvpDisplayText(page, "犬");
  await expectProgressCurrent(page, 4);
  await page.getByRole("button", { name: "Next" }).click();
  await expectRsvpDisplayText(page, "も");
  await expectProgressCurrent(page, 5);

  await page.keyboard.press("ArrowRight");
  await expectRsvpDisplayText(page, "走る。");
  await expectProgressCurrent(page, 6);

  await page.getByRole("button", { name: "Next" }).click();
  await expectVisibleSentenceText(page, "鳥は空を見る。");
  await expectRsvpDisplayText(page, "鳥");
  await expectProgressCurrent(page, 7);

  await page.getByRole("button", { name: "Previous" }).click();
  await expectVisibleSentenceText(page, "犬も走る。");
  await expectRsvpDisplayText(page, "走る。");
  await expectProgressCurrent(page, 6);

  await page.keyboard.press("ArrowLeft");
  await expectRsvpDisplayText(page, "も");
  await expectProgressCurrent(page, 5);

  await page.keyboard.press("ArrowLeft");
  await expectRsvpDisplayText(page, "犬");
  await expectProgressCurrent(page, 4);

  await page.getByRole("button", { name: "Next" }).click();
  await expectRsvpDisplayText(page, "も");
  await expectProgressCurrent(page, 5);

  await page.keyboard.press("ArrowDown");
  await expectVisibleSentenceText(page, "鳥は空を見る。");
  await expectRsvpDisplayText(page, "鳥");
  await expectProgressCurrent(page, 7);

  await page.getByRole("button", { name: "Previous" }).click();
  await expectVisibleSentenceText(page, "犬も走る。");
  await expectRsvpDisplayText(page, "走る。");
  await expectProgressCurrent(page, 6);

  await page.keyboard.press("ArrowUp");
  await expectVisibleSentenceText(page, "猫が走る。");
  await expectRsvpDisplayText(page, "猫");
  await expectProgressCurrent(page, 1);
});

test("backs up from the playback position after manual steps", async ({ page }, testInfo) => {
  const epubPath = path.join(testInfo.outputDir, "playback-back-history.epub");
  await createSmallEpub(epubPath);

  await page.goto("/");
  await page.evaluate(async () => {
    localStorage.clear();
    localStorage.setItem(
      "migaku-rsvp:settings",
      JSON.stringify({ stepDurationMs: 500, stopMode: "never" }),
    );
    await indexedDB.deleteDatabase("migaku-rsvp");
  });
  await page.reload();
  await page.locator('input[type="file"]').setInputFiles(epubPath);

  await expect(page.locator(".rsvp-token-display")).toHaveText("猫が走る。", {
    timeout: 30_000,
  });
  await page.getByRole("button", { name: "Next" }).click();
  await expectRsvpDisplayText(page, "が");
  await page.getByRole("button", { name: "Next" }).click();
  await expectRsvpDisplayText(page, "走る。");
  await expectProgressCurrent(page, 3);

  await page.getByRole("button", { name: "Play" }).click();
  await expectProgressCurrent(page, 6);
  await page.getByRole("button", { name: "Pause" }).click();
  await expectVisibleSentenceText(page, "犬も走る。");
  await expectRsvpDisplayText(page, "走る。");

  await page.getByRole("button", { name: "Previous" }).click();
  await expectVisibleSentenceText(page, "犬も走る。");
  await expectRsvpDisplayText(page, "も");
  await expectProgressCurrent(page, 5);
});

test("keeps playback persistence and focus listeners bounded across steps", async ({
  page,
}, testInfo) => {
  const epubPath = path.join(testInfo.outputDir, "bounded-playback-effects.epub");
  await createSmallEpub(epubPath, ["猫が走る。".repeat(20)]);

  await installPlaybackMetrics(page);

  await page.goto("/");
  await page.evaluate(async () => {
    localStorage.clear();
    localStorage.setItem(
      "migaku-rsvp:settings",
      JSON.stringify({ stepsPerMinute: 150, stopMode: "never" }),
    );
    await indexedDB.deleteDatabase("migaku-rsvp");
  });
  await page.reload();
  await page.locator('input[type="file"]').setInputFiles(epubPath);

  await expect(page.locator(".rsvp-token-display")).toHaveText("猫が走る。", {
    timeout: 30_000,
  });
  const afterImport = await readPlaybackMetrics(page);

  await page.getByRole("button", { name: "Play" }).click();
  await expect(page.getByRole("button", { name: "Pause" })).toBeVisible();
  await expect
    .poll(async () => {
      const { focusListeners } = await readPlaybackMetrics(page);
      return Object.values(focusListeners).every(({ adds }) => adds > 0);
    })
    .toBe(true);
  const afterPlay = await readPlaybackMetrics(page);

  await expect
    .poll(async () => Number(await page.locator("progress").getAttribute("value")))
    .toBeGreaterThanOrEqual(4);
  await page.evaluate(
    () =>
      new Promise<void>((resolve) => {
        requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
      }),
  );
  const afterSteps = await readPlaybackMetrics(page);

  expect(afterSteps.bookPuts).toBe(afterImport.bookPuts);
  expect(afterSteps.focusListeners).toEqual(afterPlay.focusListeners);
  await page.getByRole("button", { name: "Pause" }).click();

  const todayBar = page
    .locator(".stats-section > .reading-chart .reading-chart-bar-track")
    .last();
  const todayTooltip = page
    .locator(".stats-section > .reading-chart .reading-chart-tooltip")
    .last();
  await todayBar.hover();
  await expect(todayTooltip).toBeVisible();
});

test("flushes playback progress before switching books", async ({ page }, testInfo) => {
  const firstEpubPath = path.join(testInfo.outputDir, "switch-progress-first.epub");
  const secondEpubPath = path.join(testInfo.outputDir, "switch-progress-second.epub");
  await createSmallEpub(firstEpubPath, ["猫が走る。".repeat(20)]);
  await createSmallEpub(secondEpubPath, ["犬が眠る。"]);
  await installPlaybackMetrics(page);

  await page.goto("/");
  await page.evaluate(async () => {
    localStorage.clear();
    localStorage.setItem(
      "migaku-rsvp:settings",
      JSON.stringify({ stepsPerMinute: 80, stopMode: "never" }),
    );
    await indexedDB.deleteDatabase("migaku-rsvp");
  });
  await page.reload();
  const fileInput = page.locator('input[type="file"]');
  await fileInput.setInputFiles(firstEpubPath);
  await expect(page.locator(".rsvp-token-display")).toHaveText("猫が走る。", {
    timeout: 30_000,
  });
  await fileInput.setInputFiles(secondEpubPath);
  await expect(page.locator(".rsvp-token-display")).toHaveText("犬が眠る。", {
    timeout: 30_000,
  });

  const libraryBooks = page.locator(".book-select");
  await expect(libraryBooks).toHaveCount(2);
  await libraryBooks.nth(1).click();
  await expect(page.locator(".rsvp-token-display")).toHaveText("猫が走る。");
  const beforePlayback = await readPlaybackMetrics(page);

  await page.getByRole("button", { name: "Play" }).click();
  await expect
    .poll(async () => Number(await page.locator("progress").getAttribute("value")))
    .toBeGreaterThan(1);
  const progressBeforeSwitch = Number(await page.locator("progress").getAttribute("value"));
  const beforeSwitch = await readPlaybackMetrics(page);
  expect(beforeSwitch.bookProgressPuts).toBe(beforePlayback.bookProgressPuts);

  await libraryBooks.first().click();
  await expect(page.locator(".rsvp-token-display")).toHaveText("犬が眠る。");
  await expect
    .poll(async () => (await readPlaybackMetrics(page)).bookProgressPuts)
    .toBeGreaterThan(beforeSwitch.bookProgressPuts);

  await libraryBooks.nth(1).click();
  await expect(page.locator(".rsvp-token-display")).toHaveText("猫が走る。");
  const resumedProgress = Number(await page.locator("progress").getAttribute("value"));
  expect(resumedProgress).toBeGreaterThanOrEqual(progressBeforeSwitch);

  await page.reload();
  await expect(page.locator(".rsvp-token-display")).toHaveText("猫が走る。", {
    timeout: 30_000,
  });
  await expect(page.locator("progress")).toHaveAttribute("value", String(resumedProgress));
});

test("continues character-mode playback inside a multi-character token", async ({
  page,
}, testInfo) => {
  const epubPath = path.join(testInfo.outputDir, "character-playback.epub");
  await createSmallEpub(epubPath, ["の職場だった。"]);

  await page.goto("/");
  await page.evaluate(async () => {
    localStorage.clear();
    localStorage.setItem(
      "migaku-rsvp:settings",
      JSON.stringify({
        stepGroupingMode: "characters",
        characterChunkSize: 1,
        stepsPerMinute: 80,
        stopMode: "never",
      }),
    );
    await indexedDB.deleteDatabase("migaku-rsvp");
  });
  await page.reload();
  await page.locator('input[type="file"]').setInputFiles(epubPath);

  await expect(page.locator(".rsvp-token-display")).toHaveText("の職場だった。", {
    timeout: 30_000,
  });
  await expectRsvpDisplayText(page, "の");
  await page.getByRole("button", { name: "Play" }).click();
  await expectRsvpDisplayText(page, "だ");
  await page.getByRole("button", { name: "Pause" }).click();
});

test("ignores repeated transport keydown events", async ({ page }, testInfo) => {
  const epubPath = path.join(testInfo.outputDir, "keyboard-repeat.epub");
  await createSmallEpub(epubPath);

  await page.goto("/");
  await page.evaluate(async () => {
    localStorage.clear();
    await indexedDB.deleteDatabase("migaku-rsvp");
  });
  await page.reload();
  await page.locator('input[type="file"]').setInputFiles(epubPath);

  await expect(page.locator(".rsvp-token-display")).toHaveText("猫が走る。", {
    timeout: 30_000,
  });
  await expectRsvpDisplayText(page, "猫");
  await page.evaluate(() => {
    if (document.activeElement instanceof HTMLElement) {
      document.activeElement.blur();
    }
  });

  await page.keyboard.press("ArrowDown");
  await expectVisibleSentenceText(page, "犬も走る。");
  await expectRsvpDisplayText(page, "犬");
  await page.keyboard.press("ArrowDown");
  await expectVisibleSentenceText(page, "鳥は空を見る。");
  await expectRsvpDisplayText(page, "鳥");

  await dispatchTransportKey(page, "ArrowLeft", false);
  await expectVisibleSentenceText(page, "犬も走る。");
  await expectRsvpDisplayText(page, "走る。");
  await expectProgressCurrent(page, 6);

  for (let repeatCount = 0; repeatCount < 4; repeatCount += 1) {
    await dispatchTransportKey(page, "ArrowLeft", true);
  }

  await expectVisibleSentenceText(page, "犬も走る。");
  await expectRsvpDisplayText(page, "走る。");
  await expectProgressCurrent(page, 6);
});

test("keeps Migaku-wrapped progress indicator synced while navigating and playing", async ({
  page,
}, testInfo) => {
  const epubPath = path.join(testInfo.outputDir, "wrapped-progress.epub");
  await createSmallEpub(epubPath);

  await page.goto("/");
  await page.evaluate(async () => {
    localStorage.clear();
    await indexedDB.deleteDatabase("migaku-rsvp");
  });
  await page.reload();
  await page.locator('input[type="file"]').setInputFiles(epubPath);

  await expect(page.locator(".rsvp-token-display")).toHaveText("猫が走る。", {
    timeout: 30_000,
  });
  await expectProgressCurrent(page, 1);
  await page.evaluate(() => {
    if (document.activeElement instanceof HTMLElement) {
      document.activeElement.blur();
    }
  });

  await wrapProgressWithMigakuMarkup(page);
  await page.keyboard.press("ArrowRight");
  await expectRsvpDisplayText(page, "が");
  await expectProgressCurrent(page, 2);
  await expect(page.locator(".reader-progress-value--full .migaku-token")).toHaveCount(0);

  await wrapProgressWithMigakuMarkup(page);
  const previousProgress = await page.locator("progress").getAttribute("value");
  await page.getByRole("button", { name: "Play" }).click();
  await expect.poll(() => page.locator("progress").getAttribute("value")).not.toBe(previousProgress);
  const currentProgress = await page.locator("progress").getAttribute("value");
  const totalProgress = await page.locator("progress").getAttribute("max");
  await expect(page.locator(".reader-progress-value--full")).toHaveText(
    `${Math.round((Number(currentProgress) / Number(totalProgress)) * 100)}%`,
  );
});

test("imports an EPUB dropped anywhere on the page", async ({ page }, testInfo) => {
  const epubPath = path.join(testInfo.outputDir, "dropped.epub");
  await createSmallEpub(epubPath);

  await page.goto("/");
  await page.evaluate(async () => {
    localStorage.clear();
    await indexedDB.deleteDatabase("migaku-rsvp");
  });
  await page.reload();

  const dataTransfer = await createEpubDataTransfer(page, epubPath);
  await page.locator(".app").dispatchEvent("dragenter", { dataTransfer });
  await expect(page.locator(".drop-overlay")).toBeVisible();
  await expect(page.locator(".drop-overlay")).toContainText("Drop EPUB to import");

  await page.locator(".app").dispatchEvent("dragleave", { dataTransfer });
  await expect(page.locator(".drop-overlay")).toBeHidden();

  await page.locator(".app").dispatchEvent("dragenter", { dataTransfer });
  await page.locator(".app").dispatchEvent("dragover", { dataTransfer });
  await page.locator(".app").dispatchEvent("drop", { dataTransfer });
  await dataTransfer.dispose();

  await expect(page.locator(".drop-overlay")).toBeHidden();
  await expect(page.getByRole("button", { name: "小さな本 Fixture" })).toBeVisible({
    timeout: 30_000,
  });
  await expect(page.locator(".rsvp-token-display")).toHaveText("猫が走る。");
});

test("keeps active line stable across status underline changes", async ({ page }, testInfo) => {
  const epubPath = path.join(testInfo.outputDir, "status-stability.epub");
  await createSmallEpub(epubPath);

  await page.goto("/");
  await page.evaluate(async () => {
    localStorage.clear();
    await indexedDB.deleteDatabase("migaku-rsvp");
  });
  await page.reload();
  await page.locator('input[type="file"]').setInputFiles(epubPath);

  await expect(page.locator(".rsvp-token-display")).toHaveText("猫が走る。", {
    timeout: 30_000,
  });
  await page.locator(".migaku-buffer-surface [data-rsvp-sentence-id]").first().evaluate((surface) => {
    surface.innerHTML = `
      <span class="migaku-token unknown" data-mgk-term="猫" data-mgk-known-status="UNKNOWN" data-mgk-sentence="猫">
        <span class="migaku-surface">猫</span>
      </span>
      <span class="migaku-token known" data-mgk-term="が" data-mgk-known-status="KNOWN" data-mgk-sentence="が">
        <span class="migaku-surface">が</span>
      </span>
      <span class="migaku-token known" data-mgk-term="走る" data-mgk-known-status="KNOWN" data-mgk-sentence="走る">
        <span class="migaku-surface">走る</span>
      </span>
      <span>。</span>
    `;
  });

  await expect(page.locator(".migaku-pill")).toContainText("parsed");
  await expect(activeRsvpToken(page)).toHaveText("猫");
  await expect(activeRsvpToken(page)).toHaveClass(/unknown/);
  await expect(activeRsvpToken(page)).toHaveClass(/\bmigaku-token\b/);
  await expectVisibleRsvpTokensUseOnlyRsvpClasses(page);
  await expectActiveStatusUnderlineIsOverlay(page);
  await expectActiveTokenCentered(page);
  const unknownActiveMiddle = await activeTokenMiddle(page);
  await expectActiveTokenMiddleToMatch(page, unknownActiveMiddle);

  await page.getByRole("button", { name: "Next" }).click();
  await expect(activeRsvpToken(page)).toHaveText("が");
  await expect(activeRsvpToken(page)).toHaveClass(/known/);
  await expectVisibleRsvpTokensUseOnlyRsvpClasses(page);
  await expectActiveStatusUnderlineIsOverlay(page);
  await expectActiveTokenCentered(page);
  await expectActiveTokenMiddleToMatch(page, unknownActiveMiddle);
});

test("keeps stopped hover context hidden while playback advances", async ({ page }, testInfo) => {
  const epubPath = path.join(testInfo.outputDir, "play-hover.epub");
  await createSmallEpub(epubPath);

  await page.goto("/");
  await page.evaluate(async () => {
    localStorage.clear();
    await indexedDB.deleteDatabase("migaku-rsvp");
  });
  await page.reload();
  await page.locator('input[type="file"]').setInputFiles(epubPath);

  await expect(page.locator(".rsvp-token-display")).toHaveText("猫が走る。", {
    timeout: 30_000,
  });
  await expectRsvpDisplayText(page, "猫");
  await page.locator(".rsvp-token-display").hover();
  await expectContextSentenceVisible(page);
  await expectRsvpTokensHaveNoTransition(page);
  const initialActiveMiddle = await activeTokenMiddle(page);

  await page.keyboard.press("Space");
  await expect(page.locator(".rsvp-token-display")).not.toHaveClass(
    /rsvp-token-display--show-context/,
  );
  await expectContextSentenceHidden(page);
  await expect
    .poll(() => page.locator(".rsvp-token-display").getAttribute("data-rsvp-display-text"))
    .not.toBe("猫");
  await expect(page.locator(".rsvp-token-display")).not.toHaveClass(
    /rsvp-token-display--show-context/,
  );
  await expectContextSentenceHidden(page);
  await expectActiveTokenCentered(page);
  await expectActiveTokenMiddleToMatch(page, initialActiveMiddle);
});

test("keeps Migaku ruby readings out of the visible RSVP layout", async ({ page }, testInfo) => {
  const epubPath = path.join(testInfo.outputDir, "ruby.epub");
  await createSmallEpub(epubPath);

  await page.goto("/");
  await page.evaluate(async () => {
    localStorage.clear();
    await indexedDB.deleteDatabase("migaku-rsvp");
  });
  await page.reload();
  await page.locator('input[type="file"]').setInputFiles(epubPath);

  await expect(page.locator(".rsvp-token-display")).toHaveText("猫が走る。", {
    timeout: 30_000,
  });
  await expectVisibleSentenceText(page, "猫が走る。");
  await expectRsvpDisplayText(page, "猫");

  await activeRsvpToken(page).evaluate((element) => {
    element.innerHTML =
      '<span class="migaku-token" data-mgk-term="猫" data-mgk-known-status="KNOWN" data-mgk-sentence="猫が走る。"><ruby class="migaku-ruby"><span class="migaku-fragment"><span class="migaku-surface">猫</span><span class="migaku-reading"><rp>(</rp><rt>ねこ</rt><rp>)</rp></span></span></ruby><span class="migaku-spacer">​</span></span>';
  });

  await expect
    .poll(() => activeRsvpToken(page).evaluate((element) => (element as HTMLElement).innerText.trim()))
    .toBe("猫");
  await expectVisibleSentenceText(page, "猫が走る。");
  await expect
    .poll(() =>
      page
        .locator('.rsvp-token-display [data-mgk-term="猫"]')
        .evaluateAll((elements) =>
          elements.every((element) => element.getAttribute("data-mgk-sentence") === "猫が走る。"),
        ),
    )
    .toBe(true);
  await expect
    .poll(() =>
      page
        .locator(
          ".rsvp-token-display rt, .rsvp-token-display rp, .rsvp-token-display .migaku-reading, .rsvp-token-display .migaku-spacer",
        )
        .evaluateAll((elements) =>
          elements.every((element) => {
            const rect = element.getBoundingClientRect();
            return rect.width === 0 && rect.height === 0;
          }),
        ),
    )
    .toBe(true);
  await expectActiveTokenCentered(page);
});

test("keeps active Migaku targets clickable after navigation and auto-stop", async ({
  page,
}, testInfo) => {
  const epubPath = path.join(testInfo.outputDir, "clickable.epub");
  await createSmallEpub(epubPath);

  await page.addInitScript(() => {
    const testWindow = window as Window & { __migakuParseEvents?: number; __clickedTerms?: string[] };
    testWindow.__migakuParseEvents = 0;
    testWindow.__clickedTerms = [];

    const originalDispatch = EventTarget.prototype.dispatchEvent;
    EventTarget.prototype.dispatchEvent = function dispatchEventWithMigakuCount(event) {
      if (event.type === "migakuParsePage") {
        testWindow.__migakuParseEvents = (testWindow.__migakuParseEvents ?? 0) + 1;
      }
      return originalDispatch.call(this, event);
    };

    document.addEventListener(
      "click",
      (event) => {
        const target = event.target as Element | null;
        const token = target?.closest<HTMLElement>(
          ".rsvp-token-display .migaku-token[data-mgk-term]",
        );
        if (token) {
          testWindow.__clickedTerms?.push(token.getAttribute("data-mgk-term") ?? "");
        }
      },
      true,
    );
  });

  await page.goto("/");
  await page.evaluate(async () => {
    localStorage.clear();
    await indexedDB.deleteDatabase("migaku-rsvp");
  });
  await page.reload();
  await page.locator('input[type="file"]').setInputFiles(epubPath);

  await expect(page.locator(".rsvp-token-display")).toHaveText("猫が走る。", {
    timeout: 30_000,
  });
  await page.getByRole("button", { name: "Settings" }).click();
  await setRangeValue(page.locator("label", { hasText: "Words" }).locator("input"), "1");

  await page.locator(".migaku-buffer-surface [data-rsvp-sentence-id]").first().evaluate((surface) => {
    surface.innerHTML = `
      <span class="migaku-token known" data-mgk-term="猫" data-mgk-known-status="KNOWN" data-mgk-sentence="猫">
        <span class="migaku-surface">猫</span>
      </span>
      <span class="migaku-token known" data-mgk-term="が" data-mgk-known-status="KNOWN" data-mgk-sentence="が">
        <span class="migaku-surface">が</span>
      </span>
      <span class="migaku-token unknown" data-mgk-term="走る" data-mgk-known-status="UNKNOWN" data-mgk-sentence="走る">
        <span class="migaku-surface">走る</span>
      </span>
      <span>。</span>
    `;
  });

  await expect(page.locator(".migaku-pill")).toContainText("parsed");
  await expectRsvpDisplayText(page, "猫");
  await expect(activeRsvpToken(page)).toHaveAttribute("data-mgk-term", "猫");
  await expect(activeRsvpToken(page)).toHaveClass(/\bmigaku-token\b/);
  await expectActiveTokenHitTarget(page);
  const initialParseEvents = await parseEventCount(page);

  await activeRsvpToken(page).click();
  await expectClickedTerms(page, ["猫"]);

  await page.getByRole("button", { name: "Next" }).click();
  await expectRsvpDisplayText(page, "が");
  await expect(activeRsvpToken(page)).toHaveAttribute("data-mgk-term", "が");
  await expect(activeRsvpToken(page)).toHaveClass(/\bmigaku-token\b/);
  await expectActiveTokenHitTarget(page);
  await expect.poll(() => parseEventCount(page)).toBe(initialParseEvents);

  const afterNextParseEvents = await parseEventCount(page);
  await activeRsvpToken(page).click();
  await expectClickedTerms(page, ["猫", "が"]);

  await page.getByRole("button", { name: "Previous" }).click();
  await expectRsvpDisplayText(page, "猫");
  await expect(activeRsvpToken(page)).toHaveAttribute("data-mgk-term", "猫");
  await expect(activeRsvpToken(page)).toHaveClass(/\bmigaku-token\b/);
  await expectActiveTokenHitTarget(page);
  await expect.poll(() => parseEventCount(page)).toBe(afterNextParseEvents);

  await page.getByRole("button", { name: "Play" }).click();
  await expectRsvpDisplayText(page, "走る。");
  await expect(activeRsvpToken(page)).toHaveAttribute("data-mgk-term", "走る");
  await expect(activeRsvpToken(page)).toHaveClass(/\bmigaku-token\b/);
  await expect(activeRsvpToken(page)).toHaveClass(/unknown/);
  await expect(page.getByRole("button", { name: "Play" })).toBeVisible();
  await expectActiveTokenHitTarget(page);

  await activeRsvpToken(page).click();
  await expectClickedTerms(page, ["猫", "が", "走る"]);
  await expect.poll(() => storedLookupTerms(page)).toEqual(["猫", "が", "走る"]);
});

test("keeps Migaku lookup cards from shrinking the mobile reader after word taps", async ({
  page,
}, testInfo) => {
  const epubPath = path.join(testInfo.outputDir, "mobile-lookup-card.epub");
  await createSmallEpub(epubPath);

  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  await page.evaluate(async () => {
    localStorage.clear();
    await indexedDB.deleteDatabase("migaku-rsvp");
  });
  await page.reload();
  await page.locator('input[type="file"]').setInputFiles(epubPath);

  await expect(page.locator(".rsvp-token-display")).toHaveText("猫が走る。", {
    timeout: 30_000,
  });
  await page.locator(".migaku-buffer-surface [data-rsvp-sentence-id]").first().evaluate((surface) => {
    surface.innerHTML = `
      <span class="migaku-token unknown" data-mgk-term="猫" data-mgk-known-status="UNKNOWN" data-mgk-sentence="猫">
        <span class="migaku-surface">猫</span>
      </span>
      <span class="migaku-token known" data-mgk-term="が" data-mgk-known-status="KNOWN" data-mgk-sentence="が">
        <span class="migaku-surface">が</span>
      </span>
      <span class="migaku-token known" data-mgk-term="走る" data-mgk-known-status="KNOWN" data-mgk-sentence="走る">
        <span class="migaku-surface">走る</span>
      </span>
      <span>。</span>
    `;
  });

  await expect(page.locator(".migaku-pill")).toContainText("parsed");
  await activeRsvpToken(page).click();
  const widthBeforeLookupCard = await page.evaluate(() => document.documentElement.scrollWidth);
  await activeRsvpToken(page).evaluate((element) => {
    const card = document.createElement("div");
    card.className = "migaku-wordcard";
    card.style.width = "1200px";
    card.style.height = "44px";
    card.textContent = "Injected Migaku lookup card";
    element.append(card);
  });
  await page.evaluate(() => {
    const card = document.createElement("div");
    card.className = "migaku-popup-card";
    card.style.position = "absolute";
    card.style.width = "1200px";
    card.style.height = "44px";
    card.textContent = "Body-level Migaku popup card";
    document.body.append(card);
  });
  await page.evaluate(
    () =>
      new Promise<void>((resolve) => {
        requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
      }),
  );

  await expect
    .poll(() =>
      page.locator(".rsvp-sentence-track").evaluate((track) =>
        Number(getComputedStyle(track).getPropertyValue("--rsvp-track-scale")),
      ),
    )
    .toBeGreaterThan(0.95);
  await expectVisibleRsvpTokensInsideDisplay(page);
  await expectActiveTokenCentered(page);
  await expect
    .poll(() =>
      page.evaluate(
        (widthBefore) => document.documentElement.scrollWidth <= widthBefore + 1,
        widthBeforeLookupCard,
      ),
    )
    .toBe(true);
});

test("wraps stopped hover sentence context without moving the active token", async ({
  page,
}, testInfo) => {
  const longSentence =
    "また、職安に行く予定もないので今日は図書館で日本語の本をゆっくり読んでいる。";
  const epubPath = path.join(testInfo.outputDir, "hover-wrap.epub");
  await createSmallEpub(epubPath, [longSentence]);

  await page.goto("/");
  await page.evaluate(async () => {
    localStorage.clear();
    await indexedDB.deleteDatabase("migaku-rsvp");
  });
  await page.reload();
  await page.locator('input[type="file"]').setInputFiles(epubPath);

  await expect(page.locator(".rsvp-token-display")).toHaveText(longSentence, {
    timeout: 30_000,
  });
  await page.getByRole("button", { name: "Next" }).click();
  await page.getByRole("button", { name: "Next" }).click();
  await expect(page.locator(".rsvp-token-display")).toHaveClass(/rsvp-token-display--stopped/);
  await page.locator(".rsvp-token-display").hover();
  await expectContextSentenceVisible(page);
  await expectRsvpTokensHaveNoTransition(page);
  await expectActiveTokenCentered(page);
  await expectContextOverlayAroundActiveStep(page);
  await expectStoppedHoverContextOverlayReady(page);
});

test("scales long active text to stay inside the mobile viewport", async ({ page }, testInfo) => {
  const activeText = "力ない男に張り付いたまま薄暗い部屋の奥まで歩いていった";
  const longSentence = `${activeText}ところで足を止めた。`;
  const epubPath = path.join(testInfo.outputDir, "mobile-long-active.epub");
  await createSmallEpub(epubPath, [longSentence]);

  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  await page.evaluate(async () => {
    localStorage.clear();
    localStorage.setItem(
      "migaku-rsvp:settings",
      JSON.stringify({ fontSize: 96, chunkSize: 1, maxWordStepCharacters: 64 }),
    );
    await indexedDB.deleteDatabase("migaku-rsvp");
  });
  await page.reload();
  await page.locator('input[type="file"]').setInputFiles(epubPath);

  await expect(page.locator(".rsvp-token-display")).toHaveText(longSentence, {
    timeout: 30_000,
  });
  await page.locator(".migaku-buffer-surface [data-rsvp-sentence-id]").first().evaluate(
    (surface, values) => {
      surface.innerHTML = `
        <span class="migaku-token unknown" data-mgk-term="${values.activeText}" data-mgk-known-status="UNKNOWN" data-mgk-sentence="${values.activeText}">
          <span class="migaku-surface">${values.activeText}</span>
        </span>
        <span class="migaku-token known" data-mgk-term="ところ" data-mgk-known-status="KNOWN" data-mgk-sentence="ところ">
          <span class="migaku-surface">ところ</span>
        </span>
        <span class="migaku-token known" data-mgk-term="で" data-mgk-known-status="KNOWN" data-mgk-sentence="で">
          <span class="migaku-surface">で</span>
        </span>
        <span class="migaku-token known" data-mgk-term="足" data-mgk-known-status="KNOWN" data-mgk-sentence="足">
          <span class="migaku-surface">足</span>
        </span>
        <span class="migaku-token known" data-mgk-term="を" data-mgk-known-status="KNOWN" data-mgk-sentence="を">
          <span class="migaku-surface">を</span>
        </span>
        <span class="migaku-token known" data-mgk-term="止めた" data-mgk-known-status="KNOWN" data-mgk-sentence="止めた">
          <span class="migaku-surface">止めた</span>
        </span>
        <span>。</span>
      `;
    },
    { activeText },
  );

  await expect(page.locator(".migaku-pill")).toContainText("parsed");
  await expectRsvpDisplayText(page, activeText);
  await expectActiveTokenCentered(page);
  await expectVisibleRsvpTokensInsideDisplay(page);
  await expect
    .poll(() =>
      page.locator(".rsvp-sentence-track").evaluate((track) => {
        const scale = getComputedStyle(track).getPropertyValue("--rsvp-track-scale");
        return Number(scale);
      }),
    )
    .toBeLessThan(1);
});

test("centers scaled long active groups away from the sentence middle", async ({
  page,
}, testInfo) => {
  const activeText = "でもチェックアウトしなければ";
  const sentence = `${activeText}ところで石神は死体に目を戻した。`;
  const epubPath = path.join(testInfo.outputDir, "mobile-long-offset-active.epub");
  await createSmallEpub(epubPath, [sentence]);

  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  await page.evaluate(async () => {
    localStorage.clear();
    localStorage.setItem(
      "migaku-rsvp:settings",
      JSON.stringify({ fontSize: 96, chunkSize: 1, maxWordStepCharacters: 64 }),
    );
    await indexedDB.deleteDatabase("migaku-rsvp");
  });
  await page.reload();
  await page.locator('input[type="file"]').setInputFiles(epubPath);

  await expect(page.locator(".rsvp-token-display")).toHaveText(sentence, {
    timeout: 30_000,
  });
  await page.locator(".migaku-buffer-surface [data-rsvp-sentence-id]").first().evaluate(
    (surface, values) => {
      surface.innerHTML = `
        <span class="migaku-token unknown" data-mgk-term="${values.activeText}" data-mgk-known-status="UNKNOWN" data-mgk-sentence="${values.activeText}">
          <span class="migaku-surface">${values.activeText}</span>
        </span>
        <span class="migaku-token known" data-mgk-term="ところ" data-mgk-known-status="KNOWN" data-mgk-sentence="ところ">
          <span class="migaku-surface">ところ</span>
        </span>
        <span class="migaku-token known" data-mgk-term="で" data-mgk-known-status="KNOWN" data-mgk-sentence="で">
          <span class="migaku-surface">で</span>
        </span>
        <span class="migaku-token known" data-mgk-term="石神" data-mgk-known-status="KNOWN" data-mgk-sentence="石神">
          <span class="migaku-surface">石神</span>
        </span>
        <span class="migaku-token known" data-mgk-term="は" data-mgk-known-status="KNOWN" data-mgk-sentence="は">
          <span class="migaku-surface">は</span>
        </span>
        <span class="migaku-token known" data-mgk-term="死体" data-mgk-known-status="KNOWN" data-mgk-sentence="死体">
          <span class="migaku-surface">死体</span>
        </span>
        <span class="migaku-token known" data-mgk-term="に" data-mgk-known-status="KNOWN" data-mgk-sentence="に">
          <span class="migaku-surface">に</span>
        </span>
        <span class="migaku-token known" data-mgk-term="目" data-mgk-known-status="KNOWN" data-mgk-sentence="目">
          <span class="migaku-surface">目</span>
        </span>
        <span class="migaku-token known" data-mgk-term="を" data-mgk-known-status="KNOWN" data-mgk-sentence="を">
          <span class="migaku-surface">を</span>
        </span>
        <span class="migaku-token known" data-mgk-term="戻した" data-mgk-known-status="KNOWN" data-mgk-sentence="戻した">
          <span class="migaku-surface">戻した</span>
        </span>
        <span>。</span>
      `;
    },
    { activeText },
  );

  await expect(page.locator(".migaku-pill")).toContainText("parsed");
  await expectRsvpDisplayText(page, activeText);
  await expect(activeRsvpToken(page)).toHaveText(activeText);
  await expectActiveTokenCentered(page);
  await expectVisibleRsvpTokensInsideDisplay(page);
  await expect
    .poll(() =>
      page.locator(".rsvp-sentence-track").evaluate((track) => {
        const scale = getComputedStyle(track).getPropertyValue("--rsvp-track-scale");
        return Number(scale);
      }),
    )
    .toBeLessThan(1);
});

test("keeps large progress labels on one line on mobile", async ({ page }, testInfo) => {
  const paragraphs = Array.from({ length: 140 }, (_, index) =>
    `長い進捗表示の確認文です${index}。さらに数を増やします。`,
  );
  const epubPath = path.join(testInfo.outputDir, "large-progress.epub");
  await createSmallEpub(epubPath, paragraphs);

  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  await page.evaluate(async () => {
    localStorage.clear();
    await indexedDB.deleteDatabase("migaku-rsvp");
  });
  await page.reload();
  await page.locator('input[type="file"]').setInputFiles(epubPath);

  await expect(page.locator(".rsvp-token-display")).toBeVisible({ timeout: 30_000 });
  await page.evaluate(() => {
    const progressButton = document.querySelector<HTMLButtonElement>(".progress-jump-button");
    if (!progressButton) {
      throw new Error("Missing progress button.");
    }
    progressButton.setAttribute("aria-label", "Jump to location, current 9669 of 102203");
    const full = progressButton.querySelector<HTMLElement>(".reader-progress-value--full");
    const location = progressButton.querySelector<HTMLElement>(".reader-progress-value--location");
    if (!full || !location) {
      throw new Error("Missing progress labels.");
    }
    full.textContent = "9%";
    location.textContent = " · 9669/102203";
  });

  await expect
    .poll(() =>
      page.locator(".progress-jump-button").evaluate((button) => ({
        height: button.getBoundingClientRect().height,
        scrollHeight: button.scrollHeight,
        text: (button as HTMLElement).innerText.trim(),
        locationVisible:
          getComputedStyle(button.querySelector(".reader-progress-value--location")!).display !==
          "none",
      })),
    )
    .toMatchObject({
      text: "9%",
      locationVisible: false,
    });
  await expect
    .poll(() =>
      page.locator(".progress-jump-button").evaluate((button) => {
        const height = button.getBoundingClientRect().height;
        return button.scrollHeight <= Math.ceil(height);
      }),
    )
    .toBe(true);
});

test("keeps desktop progress location control from shifting reader text", async ({
  page,
}, testInfo) => {
  const paragraphs = Array.from({ length: 140 }, (_, index) =>
    `長い進捗表示の確認文です${index}。さらに数を増やします。`,
  );
  const epubPath = path.join(testInfo.outputDir, "desktop-large-progress.epub");
  await createSmallEpub(epubPath, paragraphs);

  await page.setViewportSize({ width: 1024, height: 768 });
  await page.goto("/");
  await page.evaluate(async () => {
    localStorage.clear();
    await indexedDB.deleteDatabase("migaku-rsvp");
  });
  await page.reload();
  await page.locator('input[type="file"]').setInputFiles(epubPath);

  await expect(page.locator(".rsvp-token-display")).toBeVisible({ timeout: 30_000 });
  const initialDisplayTop = await page
    .locator(".rsvp-token-display")
    .evaluate((display) => display.getBoundingClientRect().top);
  const initialMetaHeight = await page
    .locator(".reader-meta")
    .evaluate((meta) => meta.getBoundingClientRect().height);
  await expect(page.locator(".reader-progress-value--full")).toHaveText(/\d+%/);
  await expect(page.locator(".reader-progress-value--location")).toBeHidden();
  await page.locator(".progress-jump-button").hover();
  await expect(page.locator(".reader-progress-value--location")).toBeVisible();
  await expect(page.locator(".reader-progress-value--location")).toContainText(/\d+\/\d+/);
  await page.mouse.move(0, 0);

  await page.evaluate(() => {
    const progressButton = document.querySelector<HTMLButtonElement>(".progress-jump-button");
    if (!progressButton) {
      throw new Error("Missing progress button.");
    }
    progressButton.setAttribute("aria-label", "Jump to location, current 99999 of 100000");
    progressButton.style.setProperty("height", "64px", "important");
    progressButton.style.setProperty("align-items", "flex-start", "important");
    const full = progressButton.querySelector<HTMLElement>(".reader-progress-value--full");
    const location = progressButton.querySelector<HTMLElement>(".reader-progress-value--location");
    if (!full || !location) {
      throw new Error("Missing progress labels.");
    }
    full.innerHTML = `
      <span class="simulated-progress-line">100% · 99999</span>
      <span class="simulated-progress-line">/100000</span>
    `;
    full.querySelectorAll<HTMLElement>(".simulated-progress-line").forEach((line) => {
      line.style.setProperty("display", "block", "important");
      line.style.setProperty("line-height", "28px", "important");
    });
    location.textContent = " · 99999/100000";
  });

  await expect(page.locator(".reader-progress-value--full .simulated-progress-line")).toHaveCount(
    2,
  );
  await expect
    .poll(() =>
      page
        .locator(".progress-jump-button")
        .evaluate((button) => button.getBoundingClientRect().height),
    )
    .toBeGreaterThan(60);
  await expect
    .poll(() =>
      page
        .locator(".reader-meta")
        .evaluate(
          (meta, expectedHeight) =>
            Math.abs(meta.getBoundingClientRect().height - expectedHeight),
          initialMetaHeight,
        ),
    )
    .toBeLessThan(1);
  await expect
    .poll(() =>
      page
        .locator(".rsvp-token-display")
        .evaluate(
          (display, expectedTop) => Math.abs(display.getBoundingClientRect().top - expectedTop),
          initialDisplayTop,
        ),
    )
    .toBeLessThan(1);
});

async function setRangeValue(locator: Locator, value: string) {
  await locator.fill(value);
}

async function installPlaybackMetrics(page: Page) {
  await page.addInitScript(() => {
    const metrics = {
      bookPuts: 0,
      bookProgressPuts: 0,
      focusListeners: {
        blur: { adds: 0, removes: 0 },
        pagehide: { adds: 0, removes: 0 },
        visibilitychange: { adds: 0, removes: 0 },
      },
    };
    const testWindow = window as Window & { __playbackMetrics?: typeof metrics };
    testWindow.__playbackMetrics = metrics;

    const originalPut = IDBObjectStore.prototype.put;
    IDBObjectStore.prototype.put = function (...args) {
      if (this.name === "books") {
        metrics.bookPuts += 1;
      }
      if (this.name === "bookProgress") {
        metrics.bookProgressPuts += 1;
      }
      return originalPut.apply(this, args);
    };

    const originalWindowAdd = window.addEventListener;
    const originalWindowRemove = window.removeEventListener;
    window.addEventListener = function (
      this: Window,
      type: string,
      listener: EventListenerOrEventListenerObject,
      options?: boolean | AddEventListenerOptions,
    ) {
      if (type === "blur" || type === "pagehide") {
        metrics.focusListeners[type].adds += 1;
      }
      return originalWindowAdd.call(this, type, listener, options);
    } as typeof window.addEventListener;
    window.removeEventListener = function (
      this: Window,
      type: string,
      listener: EventListenerOrEventListenerObject,
      options?: boolean | EventListenerOptions,
    ) {
      if (type === "blur" || type === "pagehide") {
        metrics.focusListeners[type].removes += 1;
      }
      return originalWindowRemove.call(this, type, listener, options);
    } as typeof window.removeEventListener;

    const originalDocumentAdd = document.addEventListener;
    const originalDocumentRemove = document.removeEventListener;
    document.addEventListener = function (
      this: Document,
      type: string,
      listener: EventListenerOrEventListenerObject,
      options?: boolean | AddEventListenerOptions,
    ) {
      if (type === "visibilitychange") {
        metrics.focusListeners.visibilitychange.adds += 1;
      }
      return originalDocumentAdd.call(this, type, listener, options);
    } as typeof document.addEventListener;
    document.removeEventListener = function (
      this: Document,
      type: string,
      listener: EventListenerOrEventListenerObject,
      options?: boolean | EventListenerOptions,
    ) {
      if (type === "visibilitychange") {
        metrics.focusListeners.visibilitychange.removes += 1;
      }
      return originalDocumentRemove.call(this, type, listener, options);
    } as typeof document.removeEventListener;
  });
}

async function readPlaybackMetrics(page: Page) {
  return page.evaluate(() => {
    const testWindow = window as Window & {
      __playbackMetrics?: {
        bookPuts: number;
        bookProgressPuts: number;
        focusListeners: Record<
          "blur" | "pagehide" | "visibilitychange",
          { adds: number; removes: number }
        >;
      };
    };
    if (!testWindow.__playbackMetrics) {
      throw new Error("Playback metrics were not installed.");
    }
    return structuredClone(testWindow.__playbackMetrics);
  });
}

async function expectRsvpDisplayText(page: Page, text: string) {
  await expect(page.locator(".rsvp-token-display")).toHaveAttribute("data-rsvp-display-text", text);
}

async function expectProgressCurrent(page: Page, current: number) {
  const total = await page.locator("progress").getAttribute("max");
  await expect(page.locator("progress")).toHaveAttribute("value", String(current));
  await expect(page.getByRole("button", { name: /Jump to location/ })).toHaveAttribute(
    "aria-label",
    `Jump to location, current ${current} of ${total}`,
  );
  await expect(page.locator(".reader-progress-value--full")).toHaveText(
    `${Math.round((current / Number(total)) * 100)}%`,
  );
}

function createReadingSessionFixture({
  id,
  bookId,
  startedAtMs,
  durationMs,
  characterCount,
}: {
  id: string;
  bookId: string;
  startedAtMs: number;
  durationMs: number;
  characterCount: number;
}): ReadingSession {
  return {
    id,
    bookId,
    startedAt: new Date(startedAtMs).toISOString(),
    endedAt: new Date(startedAtMs + durationMs).toISOString(),
    durationMs,
    wordCount: Math.max(1, Math.round(characterCount / 4)),
    characterCount,
    startLocation: {
      position: { sentenceIndex: 0, tokenIndex: 0 },
      progressCurrent: 1,
      progressTotal: 100,
    },
    endLocation: {
      position: { sentenceIndex: 0, tokenIndex: 1 },
      progressCurrent: 2,
      progressTotal: 100,
    },
  };
}

function createLookupEventFixture({
  id,
  bookId,
  occurredAtMs,
  term,
}: {
  id: string;
  bookId: string;
  occurredAtMs: number;
  term: string;
}): LookupEvent {
  return {
    id,
    bookId,
    occurredAt: new Date(occurredAtMs).toISOString(),
    term,
    status: "unknown",
    sentenceId: "chapter:0:sentence:0",
    position: { sentenceIndex: 0, tokenIndex: 0 },
  };
}

async function dispatchTransportKey(page: Page, code: string, repeat: boolean) {
  await page.evaluate(
    ({ keyCode, repeated }) => {
      document.body.dispatchEvent(
        new KeyboardEvent("keydown", {
          bubbles: true,
          cancelable: true,
          code: keyCode,
          key: keyCode,
          repeat: repeated,
        }),
      );
    },
    { keyCode: code, repeated: repeat },
  );
}

async function wrapProgressWithMigakuMarkup(page: Page) {
  const progressValue = page.locator(".reader-progress-value--full");
  const text = await progressValue.innerText();

  await progressValue.evaluate((element, currentText) => {
    element.innerHTML = `
      <span class="migaku-token -mgk-blacklisted -mgk-no-readings">
        <span class="migaku-fragment -mgk-content">
          <span class="migaku-surface"></span>
          <span class="migaku-spacer" aria-hidden="true">\u200b</span>
        </span>
      </span>
    `;
    const surface = element.querySelector(".migaku-surface");
    if (surface) {
      surface.textContent = currentText;
    }
  }, text);

  await expect(progressValue.locator(".migaku-surface")).toHaveText(text);
}

async function expectVisibleSentenceText(page: Page, text: string) {
  await expect
    .poll(() =>
      page
        .locator(".rsvp-token-display")
        .evaluate((element) => (element as HTMLElement).innerText),
    )
    .toBe(text);
}

async function expectAllVisibleMigakuSentenceAttrs(page: Page, sentence: string) {
  await expect
    .poll(() =>
      page.locator(".rsvp-token-display [data-mgk-sentence]").evaluateAll(
        (elements, expectedSentence) =>
          elements.every(
            (element) => element.getAttribute("data-mgk-sentence") === expectedSentence,
          ),
        sentence,
      ),
    )
    .toBe(true);
}

async function expectContextTokensHaveNoDecoration(page: Page) {
  await expect
    .poll(() =>
      page.locator(".rsvp-token-display .rsvp-display-token--context").evaluateAll((elements) =>
        elements.every((element) => getComputedStyle(element).textDecorationLine === "none"),
      ),
    )
    .toBe(true);
}

async function expectContextSentenceVisible(page: Page) {
  await expect
    .poll(() =>
      page.locator(".rsvp-token-display").evaluate((display) => {
        const before = getComputedStyle(display, "::before");
        const after = getComputedStyle(display, "::after");
        const hasContent = before.content !== '""' || after.content !== '""';
        return hasContent ? Math.max(Number(before.opacity), Number(after.opacity)) : 0;
      }),
    )
    .toBeGreaterThan(0.3);
}

async function expectContextSentenceHidden(page: Page) {
  await expect
    .poll(() =>
      page.locator(".rsvp-token-display").evaluate((display) => {
        const before = getComputedStyle(display, "::before");
        const after = getComputedStyle(display, "::after");
        return Math.max(Number(before.opacity), Number(after.opacity));
      }),
    )
    .toBe(0);
}

async function expectStoppedHoverContextOverlayReady(page: Page) {
  await expect
    .poll(() =>
      page.locator(".rsvp-token-display").evaluate((display) => {
        const before = getComputedStyle(display, "::before");
        const after = getComputedStyle(display, "::after");

        return {
          bounded:
            before.left === "0px" &&
            before.right === "0px" &&
            after.left === "0px" &&
            after.right === "0px",
          wraps: before.whiteSpace === "normal" && after.whiteSpace === "normal",
        };
      }),
    )
    .toEqual({ bounded: true, wraps: true });
}

async function expectContextOverlayAroundActiveStep(page: Page) {
  await expect
    .poll(() =>
      page.locator(".rsvp-token-display").evaluate((display) => {
        const activeElements = Array.from(
          display.querySelectorAll<HTMLElement>('[data-rsvp-visible-token="true"]'),
        );
        if (activeElements.length === 0) {
          return false;
        }

        const before = getComputedStyle(display, "::before").content;
        const after = getComputedStyle(display, "::after").content;
        const beforeText = display.getAttribute("data-rsvp-context-before") ?? "";
        const afterText = display.getAttribute("data-rsvp-context-after") ?? "";

        return {
          beforeVisible: beforeText.length > 0 && before !== '""',
          afterVisible: afterText.length > 0 && after !== '""',
        };
      }),
    )
    .toEqual({ beforeVisible: true, afterVisible: true });
}

async function expectRsvpTokensHaveNoTransition(page: Page) {
  await expect
    .poll(() =>
      page
        .locator(".rsvp-token-display [data-rsvp-display-token-index]")
        .evaluateAll((elements) =>
          elements.every((element) =>
            getComputedStyle(element).transitionDuration
              .split(",")
              .every((duration) => duration.trim() === "0s"),
          ),
        ),
    )
    .toBe(true);
}

async function expectVisibleRsvpTokensUseOnlyRsvpClasses(page: Page) {
  await expect
    .poll(() =>
      page.locator(".rsvp-token-display [data-rsvp-display-token-index]").evaluateAll((elements) =>
        elements.every((element) =>
          Array.from(element.classList).every(
            (className) => className.startsWith("rsvp-") || className === "migaku-token",
          ),
        ),
      ),
    )
    .toBe(true);
}

async function expectActiveStatusUnderlineIsOverlay(page: Page) {
  await expect
    .poll(() =>
      activeRsvpToken(page).evaluateAll((elements) =>
        elements.every((element) => {
          const style = getComputedStyle(element);
          const underline = getComputedStyle(element, "::after");
          return style.textDecorationLine === "none" && Number(underline.opacity) > 0;
        }),
      ),
    )
    .toBe(true);
}

async function expectActiveTokenMiddleToMatch(page: Page, expectedMiddle: number) {
  await expect.poll(() => activeTokenMiddle(page)).toBeCloseTo(expectedMiddle, 0);
}

async function activeTokenMiddle(page: Page) {
  return activeRsvpToken(page).evaluateAll((elements) => {
    const rects = elements.map((element) => element.getBoundingClientRect());
    const top = Math.min(...rects.map((rect) => rect.top));
    const bottom = Math.max(...rects.map((rect) => rect.bottom));
    return top + (bottom - top) / 2;
  });
}

async function expectActiveTokenHitTarget(page: Page) {
  await expect
    .poll(() =>
      page.locator(".rsvp-token-display").evaluate((display) => {
        const activeElements = Array.from(
          display.querySelectorAll<HTMLElement>('[data-rsvp-visible-token="true"]'),
        );
        if (activeElements.length === 0) {
          return false;
        }

        const activeLeft = Math.min(
          ...activeElements.map((element) => element.getBoundingClientRect().left),
        );
        const activeRight = Math.max(
          ...activeElements.map((element) => element.getBoundingClientRect().right),
        );
        const activeTop = Math.min(
          ...activeElements.map((element) => element.getBoundingClientRect().top),
        );
        const activeBottom = Math.max(
          ...activeElements.map((element) => element.getBoundingClientRect().bottom),
        );
        const target = document.elementFromPoint(
          activeLeft + (activeRight - activeLeft) / 2,
          activeTop + (activeBottom - activeTop) / 2,
        );

        return Boolean(target?.closest('[data-rsvp-visible-token="true"]'));
      }),
    )
    .toBe(true);
}

async function parseEventCount(page: Page) {
  return page.evaluate(() => {
    const testWindow = window as Window & { __migakuParseEvents?: number };
    return testWindow.__migakuParseEvents ?? 0;
  });
}

async function expectClickedTerms(page: Page, terms: string[]) {
  await expect
    .poll(() =>
      page.evaluate(() => {
        const testWindow = window as Window & { __clickedTerms?: string[] };
        return testWindow.__clickedTerms ?? [];
      }),
    )
    .toEqual(terms);
}

async function storedLookupTerms(page: Page) {
  return page.evaluate(
    () =>
      new Promise<string[]>((resolve, reject) => {
        const request = indexedDB.open("migaku-rsvp");
        request.onerror = () => reject(request.error);
        request.onsuccess = () => {
          const database = request.result;
          const transaction = database.transaction("lookupEvents", "readonly");
          const allRequest = transaction.objectStore("lookupEvents").getAll();
          allRequest.onerror = () => reject(allRequest.error);
          allRequest.onsuccess = () => {
            const events = allRequest.result as Array<{ occurredAt: string; id: string; term: string }>;
            resolve(
              events
                .sort(
                  (left, right) =>
                    left.occurredAt.localeCompare(right.occurredAt) ||
                    left.id.localeCompare(right.id),
                )
                .map((event) => event.term),
            );
          };
          transaction.oncomplete = () => database.close();
        };
      }),
  );
}

async function expectActiveTokenCentered(page: Page) {
  await expect
    .poll(() =>
      page.locator(".rsvp-token-display").evaluate((display) => {
        const activeElements = Array.from(
          display.querySelectorAll<HTMLElement>('[data-rsvp-visible-token="true"]'),
        );
        if (activeElements.length === 0) {
          return Number.POSITIVE_INFINITY;
        }

        const displayRect = display.getBoundingClientRect();
        const activeLeft = Math.min(
          ...activeElements.map((element) => element.getBoundingClientRect().left),
        );
        const activeRight = Math.max(
          ...activeElements.map((element) => element.getBoundingClientRect().right),
        );
        const activeTop = Math.min(
          ...activeElements.map((element) => element.getBoundingClientRect().top),
        );
        const activeBottom = Math.max(
          ...activeElements.map((element) => element.getBoundingClientRect().bottom),
        );
        const displayCenter = displayRect.left + displayRect.width / 2;
        const displayMiddle = displayRect.top + displayRect.height / 2;
        const activeCenter = activeLeft + (activeRight - activeLeft) / 2;
        const activeMiddle = activeTop + (activeBottom - activeTop) / 2;

        return Math.max(
          Math.abs(displayCenter - activeCenter),
          Math.abs(displayMiddle - activeMiddle),
        );
      }),
    )
    .toBeLessThanOrEqual(2);
}

async function expectVisibleRsvpTokensInsideDisplay(page: Page) {
  await expect
    .poll(() =>
      page.locator(".rsvp-token-display").evaluate((display) => {
        const visibleTokens = Array.from(
          display.querySelectorAll<HTMLElement>('[data-rsvp-visible-token="true"]'),
        );
        if (visibleTokens.length === 0) {
          return false;
        }

        const displayRect = display.getBoundingClientRect();
        const activeLeft = Math.min(
          ...visibleTokens.map((element) => element.getBoundingClientRect().left),
        );
        const activeRight = Math.max(
          ...visibleTokens.map((element) => element.getBoundingClientRect().right),
        );

        return activeLeft >= displayRect.left - 1 && activeRight <= displayRect.right + 1;
      }),
    )
    .toBe(true);
}

function activeRsvpToken(page: Page) {
  return page.locator('.rsvp-token-display [data-rsvp-visible-word="true"]');
}

async function createEpubDataTransfer(page: Page, epubPath: string) {
  const fileBytes = Array.from(await fs.readFile(epubPath));

  return page.evaluateHandle(({ bytes }) => {
    const dataTransfer = new DataTransfer();
    const file = new File([new Uint8Array(bytes)], "dropped.epub", {
      type: "application/epub+zip",
    });
    dataTransfer.items.add(file);
    return dataTransfer;
  }, { bytes: fileBytes });
}

test("uses Japanese tokenizer boundaries for inflected constructions", async ({ page }, testInfo) => {
  const epubPath = path.join(testInfo.outputDir, "tokenizer.epub");
  await createSmallEpub(epubPath, ["の職場だった。"]);

  await page.goto("/");
  await page.evaluate(async () => {
    localStorage.clear();
    await indexedDB.deleteDatabase("migaku-rsvp");
  });
  await page.reload();
  await page.locator('input[type="file"]').setInputFiles(epubPath);

  await expect(page.locator(".rsvp-token-display")).toHaveText("の職場だった。", { timeout: 30_000 });
  await expectRsvpDisplayText(page, "の");
  await expect(activeRsvpToken(page)).toHaveText("の");
  await expectActiveTokenCentered(page);
  await page.getByRole("button", { name: "Next" }).click();
  await expectRsvpDisplayText(page, "職場");
  await expect(activeRsvpToken(page)).toHaveText("職場");
  await expectActiveTokenCentered(page);
  await page.getByRole("button", { name: "Next" }).click();
  await expectRsvpDisplayText(page, "だった。");
  await expect(activeRsvpToken(page)).toHaveText("だった");
  await expectActiveTokenCentered(page);
  await page.getByRole("button", { name: "Next" }).click();
  await expectRsvpDisplayText(page, "だった。");
  await expect(activeRsvpToken(page)).toHaveText("だった");
  await expectActiveTokenCentered(page);
});
