import { describe, expect, it } from "vitest";
import type { Sentence } from "../types";
import { shouldStopForMode } from "./rsvp";
import { createSentence } from "./text";
import {
  markActiveMigakuToken,
  markActiveMigakuTokens,
  scanMigakuSurface,
  statusFromElement,
  syncVisibleSentenceContext,
} from "./migakuAdapter";

const sentence = createSentence("猫が走る。犬も走る。", "chapter:0", 0, 0, 0) as Sentence;

describe("Migaku adapter", () => {
  it("infers statuses from Migaku-like class and data attributes", () => {
    const element = document.createElement("span");
    element.className = "migaku-word-cont unknown";
    expect(statusFromElement(element)).toBe("unknown");

    element.className = "migaku-word-cont";
    element.setAttribute("data-status", "known");
    expect(statusFromElement(element)).toBe("known");

    element.setAttribute("data-status", "tracked");
    expect(statusFromElement(element)).toBe("tracked");

    element.setAttribute("data-status", "ignored");
    expect(statusFromElement(element)).toBe("ignored");

    element.setAttribute("data-status", "learning");
    expect(statusFromElement(element)).toBe("seen");
  });

  it("does not treat the reader's own status classes as Migaku status", () => {
    const element = document.createElement("span");
    element.className = "rsvp-display-token rsvp-display-token--unknown";
    element.setAttribute("data-rsvp-display-token-index", "0");

    expect(statusFromElement(element)).toBe("unparsed");
  });

  it("does not treat aggregate Migaku sentence classes as token status", () => {
    const element = document.createElement("span");
    element.className =
      "migaku-sentence-group migaku-sentence -mgk-has-unknowns -mgk-has-unknown-readings -mgk-show-known-status";

    expect(statusFromElement(element)).toBe("unparsed");
  });

  it("maps Migaku word elements back to sentence token indexes", () => {
    const root = document.createElement("div");
    root.innerHTML = `
      <span class="migaku-word-cont unknown">猫</span>
      <span>が</span>
      <span class="migaku-word-cont known">走る</span>
      <span>。</span>
      <span class="migaku-word-cont known">犬</span>
    `;

    const scan = scanMigakuSurface(root, sentence);
    const catIndex = sentence.tokens.find((token) => token.text.includes("猫"))?.index ?? 0;

    expect(scan.detected).toBe(true);
    expect(scan.parsed).toBe(true);
    expect(scan.statuses[catIndex]).toBe("unknown");
    expect(scan.mirrors[catIndex]).toMatchObject({
      status: "unknown",
      className: expect.stringContaining("unknown"),
      text: "猫",
    });
    expect(shouldStopForMode("unknown", scan.statuses, sentence, catIndex)).toBe(true);
  });

  it("does not map a sentence-level has-unknowns wrapper to every token", () => {
    const root = document.createElement("div");
    root.innerHTML = `
      <span class="migaku-sentence-group migaku-sentence -mgk-has-unknowns -mgk-has-unknown-readings">
        <span class="migaku-token" data-mgk-term="猫" data-mgk-known-status="KNOWN">
          <span class="migaku-surface">猫</span>
        </span>
        <span class="migaku-token" data-mgk-term="が" data-mgk-known-status="KNOWN">
          <span class="migaku-surface">が</span>
        </span>
        <span class="migaku-token" data-mgk-term="走る" data-mgk-known-status="UNKNOWN">
          <span class="migaku-surface">走る</span>
        </span>
      </span>
    `;

    const scan = scanMigakuSurface(root, sentence);
    const catIndex = sentence.tokens.find((token) => token.text.includes("猫"))?.index ?? 0;
    const particleIndex = sentence.tokens.find((token) => token.text.includes("が"))?.index ?? 1;
    const runIndex = sentence.tokens.find((token) => token.text.includes("走る"))?.index ?? 0;

    expect(scan.statuses[catIndex]).toBe("known");
    expect(scan.statuses[particleIndex]).toBe("known");
    expect(scan.statuses[runIndex]).toBe("unknown");
  });

  it("maps Migaku ruby markup by surface text instead of reading text", () => {
    const root = document.createElement("div");
    root.innerHTML = `
      <span class="migaku-token" data-mgk-term="猫" data-mgk-known-status="UNKNOWN">
        <ruby>
          <span class="migaku-surface">猫</span>
          <rp>(</rp><rt>ねこ</rt><rp>)</rp>
        </ruby>
      </span>
      <span class="migaku-token" data-mgk-term="が" data-mgk-known-status="KNOWN">
        <span class="migaku-surface">が</span><span class="migaku-spacer">​</span>
      </span>
    `;

    const scan = scanMigakuSurface(root, sentence);
    const catIndex = sentence.tokens.find((token) => token.text.includes("猫"))?.index ?? 0;
    const particleIndex = sentence.tokens.find((token) => token.text.includes("が"))?.index ?? 1;

    expect(scan.statuses[catIndex]).toBe("unknown");
    expect(scan.statuses[particleIndex]).toBe("known");
  });

  it("prefers nested Migaku status over reader wrapper underline styles", () => {
    const root = document.createElement("div");
    root.innerHTML = `
      <span
        class="rsvp-display-token rsvp-display-token--active"
        data-rsvp-display-token-index="0"
        data-mgk-sentence="猫"
        style="text-decoration-line: underline; text-decoration-color: rgb(120, 120, 120)"
      >
        <span class="migaku-token" data-mgk-term="猫" data-mgk-known-status="UNKNOWN">
          <span class="migaku-surface">猫</span>
        </span>
      </span>
    `;

    const scan = scanMigakuSurface(root, sentence);
    const catIndex = sentence.tokens.find((token) => token.text.includes("猫"))?.index ?? 0;

    expect(scan.statuses[catIndex]).toBe("unknown");
  });

  it("keeps every visible Migaku branch node pointed at the full sentence", () => {
    const root = document.createElement("div");
    root.setAttribute("data-rsvp-sentence-id", sentence.id);
    root.setAttribute("data-mgk-sentence", "猫");
    root.innerHTML = `
      <span class="rsvp-sentence-track" data-mgk-sentence="猫">
        <span
          class="rsvp-display-token rsvp-display-token--context migaku-token"
          data-rsvp-display-token-index="0"
          data-mgk-sentence="猫"
          data-mgk-term="猫"
        >
          <span class="migaku-surface">猫</span>
        </span>
        <span
          class="rsvp-display-token rsvp-display-token--active migaku-token"
          data-rsvp-display-token-index="2"
          data-mgk-sentence="走る"
          data-mgk-term="走る"
        >
          <span class="migaku-fragment" data-mgk-sentence="走る">
            <span class="migaku-surface">走る</span>
          </span>
        </span>
      </span>
    `;

    syncVisibleSentenceContext(root, sentence, [2]);

    expect(root.querySelector(".rsvp-sentence-track")).toHaveAttribute(
      "data-mgk-sentence",
      sentence.text,
    );
    expect(
      Array.from(root.querySelectorAll<HTMLElement>("[data-mgk-sentence]")).map((element) =>
        element.getAttribute("data-mgk-sentence"),
      ),
    ).toEqual(Array(root.querySelectorAll("[data-mgk-sentence]").length).fill(sentence.text));
  });

  it("maps a Migaku candidate spanning multiple RSVP tokens to every overlapped token", () => {
    const root = document.createElement("div");
    root.innerHTML = `<span class="migaku-word-cont unknown">猫が</span><span>走る。</span>`;

    const scan = scanMigakuSurface(root, sentence);
    const catIndex = sentence.tokens.find((token) => token.text.includes("猫"))?.index ?? 0;
    const particleIndex = sentence.tokens.find((token) => token.text.includes("が"))?.index ?? 1;

    expect(scan.statuses[catIndex]).toBe("unknown");
    expect(scan.statuses[particleIndex]).toBe("unknown");
    expect(shouldStopForMode("unknown", scan.statuses, sentence, particleIndex)).toBe(true);
  });

  it("infers status from Migaku-like computed underline colors", () => {
    const element = document.createElement("span");
    element.textContent = "猫";
    element.style.textDecorationLine = "underline";
    element.style.textDecorationColor = "rgb(255, 90, 130)";

    expect(statusFromElement(element)).toBe("unknown");
  });

  it("scans only the requested sentence when the buffer contains nearby sentences", () => {
    const root = document.createElement("div");
    root.innerHTML = `
      <p data-rsvp-sentence-id="chapter:0:sentence:unrelated">
        <span class="migaku-word-cont unknown">犬</span>
      </p>
      <p data-rsvp-sentence-id="${sentence.id}">
        <span class="migaku-word-cont known">猫</span>
        <span class="migaku-word-cont unknown">走る</span>
      </p>
    `;

    const scan = scanMigakuSurface(root, sentence);
    const catIndex = sentence.tokens.find((token) => token.text.includes("猫"))?.index ?? 0;
    const runIndex = sentence.tokens.find((token) => token.text.includes("走る"))?.index ?? 0;

    expect(scan.statuses[catIndex]).toBe("known");
    expect(scan.statuses[runIndex]).toBe("unknown");
    expect(Object.values(scan.statuses)).not.toContain("ignored");
  });

  it("scans a visible sentence root when the root itself carries the sentence id", () => {
    const root = document.createElement("div");
    root.setAttribute("data-rsvp-sentence-id", sentence.id);
    root.innerHTML = `
      <span class="migaku-word-cont unknown">猫</span>
      <span class="migaku-word-cont known">走る</span>
    `;

    const scan = scanMigakuSurface(root, sentence);
    const catIndex = sentence.tokens.find((token) => token.text.includes("猫"))?.index ?? 0;

    expect(scan.statuses[catIndex]).toBe("unknown");
  });

  it("keeps safe Migaku data attributes for mirrored display tokens", () => {
    const root = document.createElement("div");
    root.innerHTML = `
      <span
        class="rsvp-display-token rsvp-display-token--active migaku-word-cont unknown"
        data-status="unknown"
        data-migaku-id="abc"
        data-rsvp-visible-token="true"
        style="color: red"
        onclick="alert('x')"
      >猫</span>
    `;

    const scan = scanMigakuSurface(root, sentence);
    const catIndex = sentence.tokens.find((token) => token.text.includes("猫"))?.index ?? 0;

    expect(scan.mirrors[catIndex].attributes).toMatchObject({
      "data-status": "unknown",
      "data-migaku-id": "abc",
    });
    expect(scan.mirrors[catIndex].attributes).not.toHaveProperty("style");
    expect(scan.mirrors[catIndex].attributes).not.toHaveProperty("onclick");
    expect(scan.mirrors[catIndex].attributes).not.toHaveProperty("data-rsvp-visible-token");
    expect(scan.mirrors[catIndex].className).toBe("migaku-word-cont unknown");
  });

  it("marks the active parsed token for central styling", () => {
    const root = document.createElement("div");
    root.innerHTML = `<span class="migaku-word-cont unknown">猫</span>`;
    const scan = scanMigakuSurface(root, sentence);
    const activeIndex = Number(Object.keys(scan.statuses)[0]);

    markActiveMigakuToken(root, sentence.id, activeIndex);
    expect(root.querySelector(".rsvp-active-token")).toHaveTextContent("猫");
  });

  it("marks every token in a chunk and clears stale active markers", () => {
    const root = document.createElement("div");
    root.innerHTML = `
      <span data-rsvp-token-index="0" class="rsvp-active-token">猫</span>
      <span data-rsvp-token-index="1">が</span>
      <span data-rsvp-token-index="2">走る</span>
    `;

    markActiveMigakuTokens(root, sentence.id, [1, 2]);

    expect(root.querySelector('[data-rsvp-token-index="0"]')).not.toHaveClass("rsvp-active-token");
    expect(root.querySelector('[data-rsvp-token-index="1"]')).toHaveClass("rsvp-active-token");
    expect(root.querySelector('[data-rsvp-token-index="2"]')).toHaveClass("rsvp-active-token");
  });

  it("marks Migaku tokens whose parsed boundary spans multiple RSVP tokens", () => {
    const root = document.createElement("div");
    root.innerHTML = `<span data-rsvp-token-index="1,2">が走る</span>`;

    markActiveMigakuTokens(root, sentence.id, [2]);

    expect(root.querySelector('[data-rsvp-token-index="1,2"]')).toHaveClass("rsvp-active-token");
  });
});
