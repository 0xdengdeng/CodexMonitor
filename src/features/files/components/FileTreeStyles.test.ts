import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

function fileTreeCss() {
  return readFileSync(resolve(process.cwd(), "src/styles/file-tree.css"), "utf8");
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

describe("file preview action styles", () => {
  it("keeps modal action hover states calm and local to the file preview", () => {
    const css = fileTreeCss();
    const hoverBlock = cssBlock(
      css,
      ".file-preview-action--add:hover:not(:disabled),\n.file-preview-action--save:hover:not(:disabled)",
    );

    expect(hoverBlock).toContain("transform: none");
    expect(hoverBlock).toContain("box-shadow: none");
    expect(hoverBlock).toContain("background: color-mix");
  });
});
