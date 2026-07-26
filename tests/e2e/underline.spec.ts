import { expect, test } from "@playwright/test";

test("keeps the status underline below the active token", async ({ page }) => {
  await page.goto("/");
  await page.evaluate(() => {
    const root = document.querySelector<HTMLElement>("#root");
    if (root) {
      root.style.display = "none";
    }

    const fixture = document.createElement("div");
    fixture.className = "rsvp-token-display rsvp-token-display--beyond-i-plus-one";
    fixture.style.setProperty("--reader-font-size", "64px");
    fixture.innerHTML = `
      <span class="rsvp-sentence-track">
        <span class="rsvp-sentence-scale" style="line-height: 1">
          <span
            class="rsvp-display-token rsvp-display-token--active rsvp-display-token--unknown migaku-token"
            data-rsvp-visible-token="true"
          >
            <span class="rsvp-display-token-text">
              <span class="migaku-token rsvp-migaku-token">
                <span class="migaku-fragment">
                  <span class="migaku-surface">&#x8aad;</span>
                </span>
              </span>
            </span>
          </span>
        </span>
      </span>
    `;
    document.body.append(fixture);
  });

  const geometry = await page
    .locator('[data-rsvp-visible-token="true"]')
    .evaluate((token) => {
      const display = token.closest<HTMLElement>(".rsvp-token-display");
      if (!display) {
        throw new Error("Missing RSVP display fixture");
      }

      const displayRect = display.getBoundingClientRect();
      const tokenRect = token.getBoundingClientRect();
      const underline = getComputedStyle(token, "::after");
      const underlineBottom = tokenRect.bottom - Number.parseFloat(underline.bottom);
      const underlineTop = underlineBottom - Number.parseFloat(underline.height);

      return {
        gap: underlineTop - tokenRect.bottom,
        bottomInset: displayRect.bottom - underlineBottom,
        height: Number.parseFloat(underline.height),
      };
    });

  expect(geometry.gap).toBeGreaterThanOrEqual(2);
  expect(geometry.bottomInset).toBeGreaterThanOrEqual(0);
  expect(geometry.bottomInset).toBeLessThanOrEqual(6);
  expect(geometry.height).toBeCloseTo(3.84, 1);
});
