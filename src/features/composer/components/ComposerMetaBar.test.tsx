// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { I18nProvider } from "@/features/i18n/i18n";
import type { ThreadTokenUsage } from "@/types";
import { ComposerMetaBar } from "./ComposerMetaBar";

const emptyBreakdown = {
  totalTokens: 0,
  inputTokens: 0,
  cachedInputTokens: 0,
  outputTokens: 0,
  reasoningOutputTokens: 0,
};

function renderMetaBar(
  contextUsage: ThreadTokenUsage | null,
  overrides = {},
  languagePreference: "en" | "zh-CN" = "en",
) {
  return render(
    <I18nProvider languagePreference={languagePreference}>
      <ComposerMetaBar
        disabled={false}
        collaborationModes={[{ id: "default", label: "Default" }]}
        selectedCollaborationModeId={null}
        onSelectCollaborationMode={vi.fn()}
        models={[
          { id: "gpt-5", displayName: "GPT-5", model: "gpt-5" },
          { id: "gpt-5.5", displayName: "GPT-5.5", model: "gpt-5.5" },
        ]}
        selectedModelId={null}
        onSelectModel={vi.fn()}
        reasoningOptions={["medium", "high"]}
        selectedEffort={null}
        onSelectEffort={vi.fn()}
        selectedServiceTier={null}
        reasoningSupported
        accessMode="current"
        onSelectAccessMode={vi.fn()}
        contextUsage={contextUsage}
        {...overrides}
      />
    </I18nProvider>,
  );
}

describe("ComposerMetaBar", () => {
  afterEach(() => {
    cleanup();
  });

  it("shows context window usage as a meter with visible token counts", () => {
    renderMetaBar({
      total: {
        ...emptyBreakdown,
        totalTokens: 500_000,
      },
      last: {
        totalTokens: 42_800,
        inputTokens: 30_000,
        cachedInputTokens: 10_000,
        outputTokens: 2_000,
        reasoningOutputTokens: 800,
      },
      modelContextWindow: 128_000,
    });

    expect(screen.getByText("Context 33%")).toBeTruthy();
    expect(screen.getByText("42.8k / 128k")).toBeTruthy();
    const meter = screen.getByRole("meter", { name: "Context window usage" });
    expect(meter.getAttribute("aria-valuenow")).toBe("33");
    expect(meter.getAttribute("aria-valuetext")).toBe(
      "Context 33% used, 42.8k of 128k",
    );
  });

  it("uses custom combobox controls for model selection", () => {
    const onSelectModel = vi.fn();
    const { container } = renderMetaBar(null, {
      selectedModelId: "gpt-5",
      onSelectModel,
    });

    expect(container.querySelector("select")).toBeNull();

    fireEvent.click(screen.getByRole("combobox", { name: "Model" }));
    fireEvent.click(screen.getByRole("option", { name: "GPT-5.5" }));

    expect(onSelectModel).toHaveBeenCalledWith("gpt-5.5");
  });

  it("localizes reasoning effort labels", () => {
    renderMetaBar(null, {}, "zh-CN");

    fireEvent.click(screen.getByRole("combobox", { name: "思考深度" }));

    expect(screen.getByRole("option", { name: "中等" })).toBeTruthy();
    expect(screen.getByRole("option", { name: "高" })).toBeTruthy();
  });

  it("localizes the selected reasoning fallback when it is not in options", () => {
    renderMetaBar(
      null,
      {
        reasoningOptions: [],
        selectedEffort: "medium",
      },
      "zh-CN",
    );

    expect(screen.getByRole("combobox", { name: "思考深度" }).textContent).toContain(
      "中等",
    );
  });

  it("marks every composer meta control for shared sizing", () => {
    const { container } = renderMetaBar(null, {
      collaborationModes: [
        { id: "default", label: "Default" },
        { id: "plan", label: "Plan" },
      ],
      selectedCollaborationModeId: "plan",
    });

    const controls = Array.from(container.querySelectorAll(".composer-select-wrap"));
    expect(controls.length).toBeGreaterThanOrEqual(4);
    expect(
      controls.every((control) => control.classList.contains("composer-meta-control")),
    ).toBe(true);
  });

  it("keeps composer meta controls compact and type-consistent", () => {
    const { container } = renderMetaBar(null, {
      collaborationModes: [
        { id: "default", label: "Default" },
        { id: "plan", label: "Plan" },
      ],
      selectedCollaborationModeId: "plan",
    });
    const css = readFileSync(resolve(process.cwd(), "src/styles/composer.css"), "utf8");
    const planControl = container.querySelector(".composer-plan-toggle-wrap");
    const metaControlBlock = css.match(
      /\.composer-meta-control\s*\{(?<body>[^}]*)\}/,
    )?.groups?.body;
    const planBlock = css.match(
      /\.composer-plan-toggle-wrap\s*\{(?<body>[^}]*)\}/,
    )?.groups?.body;
    const selectBlock = css.match(/\.composer-select\s*\{(?<body>[^}]*)\}/)?.groups
      ?.body;
    const scopedSelectBlock = css.match(
      /\.composer-select-wrap \.composer-select\s*\{(?<body>[^}]*)\}/,
    )?.groups?.body;
    const modelBlock = css.match(/\.composer-select--model\s*\{(?<body>[^}]*)\}/)
      ?.groups?.body;
    const effortBlock = css.match(/\.composer-select--effort\s*\{(?<body>[^}]*)\}/)
      ?.groups?.body;
    const approvalBlock = css.match(
      /\.composer-select--approval\s*\{(?<body>[^}]*)\}/,
    )?.groups?.body;

    expect(planControl?.classList.contains("composer-meta-control")).toBe(true);
    expect(metaControlBlock).toContain("height: 30px");
    expect(planBlock).toContain("min-width: 78px");
    expect(selectBlock).toContain("font-size: 11px");
    expect(scopedSelectBlock).toContain("font-size: 11px");
    expect(scopedSelectBlock).toContain("gap: 5px");
    expect(modelBlock).toContain("width: 66px");
    expect(effortBlock).toContain("width: 58px");
    expect(approvalBlock).toContain("width: 78px");
  });

  it("does not clip composer dropdown popovers from the meta row", () => {
    const css = readFileSync(resolve(process.cwd(), "src/styles/composer.css"), "utf8");
    const composerMetaBlocks = Array.from(
      css.matchAll(/(?:^|\n)[^{\n]*\.composer-meta\s*\{(?<body>[^}]*)\}/g),
      (match) => match.groups?.body ?? "",
    );

    expect(composerMetaBlocks.length).toBeGreaterThan(0);
    for (const block of composerMetaBlocks) {
      expect(block).not.toMatch(/overflow(?:-[xy])?\s*:\s*(auto|hidden|scroll|clip)/);
    }
  });

  it("keeps composer dropdowns anchored and visually lightweight", () => {
    const css = readFileSync(resolve(process.cwd(), "src/styles/composer.css"), "utf8");
    const selectRootBlock = css.match(
      /\.composer-select-wrap \.ds-select\s*\{(?<body>[^}]*)\}/,
    )?.groups?.body;
    const popoverBlock = css.match(
      /\.composer-select-popover\s*\{(?<body>[^}]*)\}/,
    )?.groups?.body;
    const alignedPopoverBlock = css.match(
      /\.composer-select-popover\[data-align="end"\]\s*\{(?<body>[^}]*)\}/,
    )?.groups?.body;
    const topPlacementBlock = css.match(
      /\.composer-select-popover\[data-placement="top"\]\s*\{(?<body>[^}]*)\}/,
    )?.groups?.body;
    const expandedBlock = css.match(
      /\.composer-select-wrap:has\(\.composer-select\[aria-expanded="true"\]\)\s*\{(?<body>[^}]*)\}/,
    )?.groups?.body;

    expect(selectRootBlock).toContain("position: static");
    expect(popoverBlock).toBeTruthy();
    expect(alignedPopoverBlock).toContain("left: 0");
    expect(alignedPopoverBlock).toContain("right: auto");
    expect(topPlacementBlock).toBeTruthy();
    expect(expandedBlock).toBeTruthy();
    expect(popoverBlock).toContain("--ds-popover-shadow");
    expect(topPlacementBlock).toContain("bottom: calc(100% + 4px)");
    expect(expandedBlock).not.toContain("--cm-control-focus-ring");
  });
});
