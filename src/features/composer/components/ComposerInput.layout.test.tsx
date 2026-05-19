/** @vitest-environment jsdom */
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { createRef } from "react";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ComposerInput } from "./ComposerInput";

vi.mock("../../../services/dragDrop", () => ({
  subscribeWindowDragDrop: vi.fn(() => () => {}),
}));

vi.mock("@tauri-apps/api/core", () => ({
  convertFileSrc: (path: string) => `tauri://${path}`,
}));

function renderComposerInput({
  text = "",
  isExpanded = false,
}: {
  text?: string;
  isExpanded?: boolean;
} = {}) {
  const textareaRef = createRef<HTMLTextAreaElement>();
  render(
    <div className="app">
      <ComposerInput
        text={text}
        disabled={false}
        sendLabel="Send"
        canStop={false}
        canSend={text.trim().length > 0}
        isProcessing={false}
        onStop={() => {}}
        onSend={() => {}}
        attachments={[]}
        onAddAttachment={() => {}}
        onAttachImages={() => {}}
        onRemoveAttachment={() => {}}
        onTextChange={() => {}}
        onSelectionChange={() => {}}
        onKeyDown={() => {}}
        isExpanded={isExpanded}
        onToggleExpand={() => {}}
        textareaRef={textareaRef}
        suggestionsOpen={false}
        suggestions={[]}
        highlightIndex={0}
        onHighlightIndex={() => {}}
        onSelectSuggestion={() => {}}
      />
    </div>,
  );
  return screen.getByRole("textbox") as HTMLTextAreaElement;
}

describe("ComposerInput layout", () => {
  afterEach(() => {
    cleanup();
  });

  it("keeps an empty expanded composer from opening as a large blank panel", async () => {
    const textarea = renderComposerInput({ isExpanded: true, text: "" });

    await waitFor(() => {
      expect(textarea.style.minHeight).toBe("96px");
      expect(textarea.style.height).toBe("96px");
    });
  });

  it("keeps composer action buttons aligned with the first input row", () => {
    const css = readFileSync(resolve(process.cwd(), "src/styles/composer.css"), "utf8");
    const actionsBlock = css.match(
      /\.composer-input-actions\s*\{(?<body>[^}]*)\}/,
    )?.groups?.body;

    expect(actionsBlock).toBeTruthy();
    expect(actionsBlock).toContain("align-self: flex-start");
  });
});
