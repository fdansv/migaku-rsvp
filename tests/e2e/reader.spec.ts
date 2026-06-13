import { expect, test, type Locator, type Page } from "@playwright/test";
import fs from "node:fs/promises";
import path from "node:path";
import { createSmallEpub } from "../fixtures/createSmallEpub";

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
  const progressLabel = page.locator(".reader-progress-value");
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

  await expect(page.getByRole("button", { name: "Recap" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Settings" })).toHaveAttribute(
    "aria-expanded",
    "false",
  );
  await page.getByRole("button", { name: "Settings" }).click();
  await setRangeValue(page.locator("label", { hasText: "Step time" }).locator("input"), "550");
  await expect(page.locator("label", { hasText: "Step time" }).locator(".setting-value")).toHaveText(
    "0.55s",
  );
  await setRangeValue(page.locator("label", { hasText: "Font" }).locator("input"), "80");
  await expect(page.locator("label", { hasText: "Font" }).locator(".setting-value")).toHaveText(
    "80px",
  );
  await setRangeValue(page.locator("label", { hasText: "Words" }).locator("input"), "3");
  await expect(page.locator("label", { hasText: "Words" }).locator(".setting-value")).toHaveText(
    "3",
  );
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
  await expect(page.locator("label", { hasText: "Step time" }).locator(".setting-value")).toHaveText(
    "0.55s",
  );
  await expect(page.locator("label", { hasText: "Font" }).locator(".setting-value")).toHaveText(
    "80px",
  );
  await expect(page.locator("label", { hasText: "Words" }).locator(".setting-value")).toHaveText(
    "3",
  );
  await setRangeValue(page.locator("label", { hasText: "Step time" }).locator("input"), "400");
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
  await expect(page.locator(".status-strip")).toContainText("unknown");
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
  await expect(page.locator(".status-strip")).toContainText("Paused on stop rule");

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
  await expect(page.locator(".status-strip")).toContainText("Paused on stop rule");

  await page.getByRole("button", { name: "Next" }).click();
  await expectRsvpDisplayText(page, "犬");
  await expect(activeRsvpToken(page)).toHaveText("犬");
  await expect
    .poll(() => activeRsvpToken(page).getAttribute("data-mgk-term"))
    .not.toBe("走る");
  await expect(activeRsvpToken(page)).not.toHaveClass(/unknown/);
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

  await page.keyboard.press("ArrowDown");
  await expectVisibleSentenceText(page, "犬も走る。");
  await expectRsvpDisplayText(page, "犬");
  await expectProgressCurrent(page, 4);

  await page.getByRole("button", { name: "Next" }).click();
  await expectRsvpDisplayText(page, "も");
  await expectProgressCurrent(page, 5);

  await page.keyboard.press("ArrowRight");
  await expectRsvpDisplayText(page, "走る。");
  await expectProgressCurrent(page, 6);

  await page.getByRole("button", { name: "Previous" }).click();
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
  await expect(page.locator(".reader-progress-value .migaku-token")).toHaveCount(0);

  await wrapProgressWithMigakuMarkup(page);
  const previousProgress = await page.locator("progress").getAttribute("value");
  await page.getByRole("button", { name: "Play" }).click();
  await expect.poll(() => page.locator("progress").getAttribute("value")).not.toBe(previousProgress);
  const currentProgress = await page.locator("progress").getAttribute("value");
  const totalProgress = await page.locator("progress").getAttribute("max");
  await expect(page.locator(".reader-progress-value")).toContainText(
    `${currentProgress}/${totalProgress}`,
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
  await expectStatusStripStableRow(page);
  await page.addStyleTag({
    content: ".status-strip.is-jittery span:first-child { font-size: 18px; line-height: normal; }",
  });
  await page.locator(".status-strip").evaluate((element) => element.classList.add("is-jittery"));
  await expectStatusStripStableRow(page);
  await expectActiveTokenMiddleToMatch(page, unknownActiveMiddle);

  await page.getByRole("button", { name: "Next" }).click();
  await expect(activeRsvpToken(page)).toHaveText("が");
  await expect(activeRsvpToken(page)).toHaveClass(/known/);
  await expectVisibleRsvpTokensUseOnlyRsvpClasses(page);
  await expectActiveStatusUnderlineIsOverlay(page);
  await expectActiveTokenCentered(page);
  await expectStatusStripStableRow(page);
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
  await expect.poll(() => parseEventCount(page)).toBeGreaterThan(initialParseEvents);

  const afterNextParseEvents = await parseEventCount(page);
  await activeRsvpToken(page).click();
  await expectClickedTerms(page, ["猫", "が"]);

  await page.getByRole("button", { name: "Previous" }).click();
  await expectRsvpDisplayText(page, "猫");
  await expect(activeRsvpToken(page)).toHaveAttribute("data-mgk-term", "猫");
  await expect(activeRsvpToken(page)).toHaveClass(/\bmigaku-token\b/);
  await expectActiveTokenHitTarget(page);
  await expect.poll(() => parseEventCount(page)).toBeGreaterThan(afterNextParseEvents);

  await page.getByRole("button", { name: "Play" }).click();
  await expectRsvpDisplayText(page, "走る。");
  await expect(activeRsvpToken(page)).toHaveAttribute("data-mgk-term", "走る");
  await expect(activeRsvpToken(page)).toHaveClass(/\bmigaku-token\b/);
  await expect(activeRsvpToken(page)).toHaveClass(/unknown/);
  await expect(page.locator(".status-strip")).toContainText("Paused on stop rule");
  await expectActiveTokenHitTarget(page);

  await activeRsvpToken(page).click();
  await expectClickedTerms(page, ["猫", "が", "走る"]);
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
  const longSentence = "力ない男に張り付いたまま薄暗い部屋の奥まで歩いていった。";
  const epubPath = path.join(testInfo.outputDir, "mobile-long-active.epub");
  await createSmallEpub(epubPath, [longSentence]);

  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  await page.evaluate(async () => {
    localStorage.clear();
    localStorage.setItem("migaku-rsvp:settings", JSON.stringify({ fontSize: 96, chunkSize: 1 }));
    await indexedDB.deleteDatabase("migaku-rsvp");
  });
  await page.reload();
  await page.locator('input[type="file"]').setInputFiles(epubPath);

  await expect(page.locator(".rsvp-token-display")).toHaveText(longSentence, {
    timeout: 30_000,
  });
  await page.locator(".migaku-buffer-surface [data-rsvp-sentence-id]").first().evaluate(
    (surface, sentence) => {
      surface.innerHTML = `
        <span class="migaku-token unknown" data-mgk-term="${sentence}" data-mgk-known-status="UNKNOWN" data-mgk-sentence="${sentence}">
          <span class="migaku-surface">${sentence}</span>
        </span>
      `;
    },
    longSentence,
  );

  await expect(page.locator(".migaku-pill")).toContainText("parsed");
  await expectRsvpDisplayText(page, longSentence);
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

async function setRangeValue(locator: Locator, value: string) {
  await locator.fill(value);
}

async function expectRsvpDisplayText(page: Page, text: string) {
  await expect(page.locator(".rsvp-token-display")).toHaveAttribute("data-rsvp-display-text", text);
}

async function expectProgressCurrent(page: Page, current: number) {
  const total = await page.locator("progress").getAttribute("max");
  await expect(page.locator("progress")).toHaveAttribute("value", String(current));
  await expect(page.locator(".reader-progress-value")).toContainText(`${current}/${total}`);
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
  const progressValue = page.locator(".reader-progress-value");
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

async function expectStatusStripStableRow(page: Page) {
  await expect
    .poll(() =>
      page.locator(".status-strip").evaluate((element) => {
        const rect = element.getBoundingClientRect();
        const style = getComputedStyle(element);
        return {
          height: rect.height,
          lineHeight: style.lineHeight,
          overflow: style.overflow,
        };
      }),
    )
    .toEqual({ height: 20, lineHeight: "20px", overflow: "hidden" });
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
