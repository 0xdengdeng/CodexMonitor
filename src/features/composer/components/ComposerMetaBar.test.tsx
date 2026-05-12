// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
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

function renderMetaBar(contextUsage: ThreadTokenUsage | null) {
  return render(
    <I18nProvider languagePreference="en">
      <ComposerMetaBar
        disabled={false}
        collaborationModes={[]}
        selectedCollaborationModeId={null}
        onSelectCollaborationMode={vi.fn()}
        models={[]}
        selectedModelId={null}
        onSelectModel={vi.fn()}
        reasoningOptions={[]}
        selectedEffort={null}
        onSelectEffort={vi.fn()}
        selectedServiceTier={null}
        reasoningSupported
        accessMode="current"
        onSelectAccessMode={vi.fn()}
        contextUsage={contextUsage}
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
});
