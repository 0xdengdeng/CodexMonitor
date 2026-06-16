import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

function sidebarCss() {
  return readFileSync(resolve(process.cwd(), "src/styles/sidebar.css"), "utf8");
}

function cssBlock(css: string, selector: string) {
  const index = css.indexOf(selector);
  if (index === -1) {
    return "";
  }
  const blockStart = css.indexOf("{", index);
  const blockEnd = css.indexOf("}", blockStart);
  return css.slice(blockStart + 1, blockEnd);
}

describe("sidebar styles", () => {
  it("does not clip icon-only header tooltips", () => {
    const block = cssBlock(
      sidebarCss(),
      ".sidebar-capabilities-toggle,\n.sidebar-search-toggle",
    );

    expect(block).toContain("width: 30px");
    expect(block).not.toContain("overflow: hidden");
  });
});
