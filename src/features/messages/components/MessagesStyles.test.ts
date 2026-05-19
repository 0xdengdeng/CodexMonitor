import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

function messagesCss() {
  return readFileSync(resolve(process.cwd(), "src/styles/messages.css"), "utf8");
}

function cssBlock(css: string, selector: string) {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return css.match(new RegExp(`${escaped}\\s*\\{(?<body>[^}]*)\\}`))?.groups
    ?.body ?? "";
}

describe("message image generation styles", () => {
  it("does not force auto-sized generated image thumbnails into a square", () => {
    const thumbnailBlock = cssBlock(
      messagesCss(),
      ".image-generation-preview--thumbnail",
    );

    expect(thumbnailBlock).toBeTruthy();
    expect(thumbnailBlock).not.toMatch(/aspect-ratio\s*:/);
  });
});

describe("message file link styles", () => {
  it("renders parent paths as a hover popover instead of inline text", () => {
    const css = messagesCss();
    const linkBlock = cssBlock(css, ".message .markdown .message-file-link");
    const pathBlock = cssBlock(
      css,
      ".message .markdown .message-file-link-path-popover",
    );
    const hoverBlock = cssBlock(
      css,
      ".message .markdown .message-file-link:hover .message-file-link-path-popover",
    );
    const focusBlock = cssBlock(
      css,
      ".message .markdown .message-file-link:focus-visible .message-file-link-path-popover",
    );

    expect(linkBlock).toContain("position: relative");
    expect(pathBlock).toContain("position: absolute");
    expect(pathBlock).toContain("opacity: 0");
    expect(pathBlock).toContain("pointer-events: none");
    expect(hoverBlock).toContain("opacity: 1");
    expect(focusBlock).toContain("opacity: 1");
  });
});
