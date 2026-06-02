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
  await expectNoPseudoFallback(page);
  await expectActiveTokenCentered(page);

  await page.getByRole("button", { name: "Next" }).click();
  await expect(page.locator(".rsvp-token-display")).toHaveText("猫が走る。");
  await expectVisibleSentenceText(page, "猫が走る。");
  await expectRsvpDisplayText(page, "が");
  await expect(activeRsvpToken(page)).toHaveText("が");
  await expectActiveTokenCentered(page);
  await page.getByRole("button", { name: "Previous" }).click();
  await expectRsvpDisplayText(page, "猫");
  await expect(activeRsvpToken(page)).toHaveText("猫");
  await expectActiveTokenCentered(page);

  await expect(page.getByRole("button", { name: "Recap" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Settings" })).toHaveAttribute(
    "aria-expanded",
    "false",
  );
  await page.getByRole("button", { name: "Settings" }).click();
  await setRangeValue(page.locator("label", { hasText: "Speed" }).locator("input"), "550");
  await expect(page.locator("label", { hasText: "Speed" }).locator(".setting-value")).toHaveText(
    "550 wpm",
  );
  await setRangeValue(page.locator("label", { hasText: "Font" }).locator("input"), "80");
  await expect(page.locator("label", { hasText: "Font" }).locator(".setting-value")).toHaveText(
    "80px",
  );
  await setRangeValue(page.locator("label", { hasText: "Words" }).locator("input"), "3");
  await expect(page.locator("label", { hasText: "Words" }).locator(".setting-value")).toHaveText(
    "3",
  );
  await setRangeValue(page.locator("label", { hasText: "Punctuation" }).locator("input"), "500");
  await expect(page.locator("label", { hasText: "Punctuation" }).locator(".setting-value")).toHaveText(
    "500ms",
  );

  await page.reload();
  await page.getByRole("button", { name: "Settings" }).click();
  await expect(page.locator("label", { hasText: "Speed" }).locator(".setting-value")).toHaveText(
    "550 wpm",
  );
  await expect(page.locator("label", { hasText: "Font" }).locator(".setting-value")).toHaveText(
    "80px",
  );
  await expect(page.locator("label", { hasText: "Words" }).locator(".setting-value")).toHaveText(
    "3",
  );
  await expect(page.locator("label", { hasText: "Punctuation" }).locator(".setting-value")).toHaveText(
    "500ms",
  );
  await setRangeValue(page.locator("label", { hasText: "Speed" }).locator("input"), "150");
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
  await expectRsvpDisplayText(page, "走る");
  await expect(activeRsvpToken(page)).toHaveText("走る");
  await expect(activeRsvpToken(page)).toHaveClass(/unknown/);
  await expect(page.locator(".status-strip")).toContainText("Paused on stop rule");

  await page.getByRole("button", { name: "Next" }).click();
  await expectRsvpDisplayText(page, "。");
  await page.getByRole("button", { name: "Next" }).click();
  await expectRsvpDisplayText(page, "犬");
  await expect(activeRsvpToken(page)).toHaveText("犬");
  await expect
    .poll(() => activeRsvpToken(page).getAttribute("data-mgk-term"))
    .not.toBe("走る");
  await expect(activeRsvpToken(page)).not.toHaveClass(/unknown/);
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
        const token = target?.closest<HTMLElement>(".rsvp-token-display [data-mgk-term]");
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
  await expectActiveTokenHitTarget(page);
  const initialParseEvents = await parseEventCount(page);

  await activeRsvpToken(page).click();
  await expectClickedTerms(page, ["猫"]);

  await page.getByRole("button", { name: "Next" }).click();
  await expectRsvpDisplayText(page, "が");
  await expect(activeRsvpToken(page)).toHaveAttribute("data-mgk-term", "が");
  await expectActiveTokenHitTarget(page);
  await expect.poll(() => parseEventCount(page)).toBeGreaterThan(initialParseEvents);

  const afterNextParseEvents = await parseEventCount(page);
  await activeRsvpToken(page).click();
  await expectClickedTerms(page, ["猫", "が"]);

  await page.getByRole("button", { name: "Previous" }).click();
  await expectRsvpDisplayText(page, "猫");
  await expect(activeRsvpToken(page)).toHaveAttribute("data-mgk-term", "猫");
  await expectActiveTokenHitTarget(page);
  await expect.poll(() => parseEventCount(page)).toBeGreaterThan(afterNextParseEvents);

  await page.getByRole("button", { name: "Play" }).click();
  await expectRsvpDisplayText(page, "走る");
  await expect(activeRsvpToken(page)).toHaveAttribute("data-mgk-term", "走る");
  await expect(activeRsvpToken(page)).toHaveClass(/unknown/);
  await expect(page.locator(".status-strip")).toContainText("Paused on stop rule");
  await expectActiveTokenHitTarget(page);

  await activeRsvpToken(page).click();
  await expectClickedTerms(page, ["猫", "が", "走る"]);
});

async function setRangeValue(locator: Locator, value: string) {
  await locator.fill(value);
}

async function expectRsvpDisplayText(page: Page, text: string) {
  await expect(page.locator(".rsvp-token-display")).toHaveAttribute("data-rsvp-display-text", text);
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

async function expectNoPseudoFallback(page: Page) {
  await expect
    .poll(() =>
      page.locator(".rsvp-token-display").evaluate((element) => {
        const content = getComputedStyle(element, "::after").content;
        return content === "none" || content === '""';
      }),
    )
    .toBe(true);
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
        const displayCenter = displayRect.left + displayRect.width / 2;
        const activeCenter = activeLeft + (activeRight - activeLeft) / 2;

        return Math.abs(displayCenter - activeCenter);
      }),
    )
    .toBeLessThanOrEqual(2);
}

function activeRsvpToken(page: Page) {
  return page.locator('.rsvp-token-display [data-rsvp-visible-token="true"]');
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
  await expectRsvpDisplayText(page, "だった");
  await expect(activeRsvpToken(page)).toHaveText("だった");
  await expectActiveTokenCentered(page);
  await page.getByRole("button", { name: "Next" }).click();
  await expectRsvpDisplayText(page, "。");
  await expect(activeRsvpToken(page)).toHaveText("。");
  await expectActiveTokenCentered(page);
});
