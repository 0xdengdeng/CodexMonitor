import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const settingsCss = () =>
  readFileSync(resolve(process.cwd(), "src/styles/settings.css"), "utf8");

function cssBlock(css: string, selector: string) {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return css.match(new RegExp(`${escaped}\\s*\\{(?<body>[^}]*)\\}`))?.groups
    ?.body;
}

describe("settings select styles", () => {
  it("keeps custom select triggers visibly framed in settings", () => {
    const css = settingsCss();
    const triggerBlock = cssBlock(css, ".ds-select-trigger.settings-select");
    const hoverBlock = cssBlock(
      css,
      ".ds-select-trigger.settings-select:hover:not(:disabled)",
    );

    expect(triggerBlock).toContain(
      "border: 1px solid var(--button-secondary-border, var(--border-muted))",
    );
    expect(triggerBlock).toContain("background-color: var(--surface-control)");
    expect(triggerBlock).toContain("min-height: 38px");
    expect(triggerBlock).toContain("font-size: 12px");
    expect(triggerBlock).toContain("justify-content: space-between");
    expect(hoverBlock).toContain("border-color: var(--border-strong)");
  });

  it("keeps compact settings selects framed but smaller", () => {
    const compactBlock = cssBlock(
      settingsCss(),
      ".ds-select-trigger.settings-select--compact",
    );

    expect(compactBlock).toContain("min-height: 30px");
    expect(compactBlock).toContain("font-size: 11px");
  });
});
