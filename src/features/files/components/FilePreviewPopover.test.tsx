/** @vitest-environment jsdom */
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { FilePreviewPopover } from "./FilePreviewPopover";

vi.mock("@tauri-apps/api/core", () => ({
  convertFileSrc: vi.fn((path: string) => `asset://${path}`),
}));

vi.mock("../../app/components/OpenAppMenu", () => ({
  OpenAppMenu: () => <div data-testid="open-app-menu" />,
}));

vi.mock("./MonacoFileEditor", () => ({
  MonacoFileEditor: ({
    ariaLabel,
    disabled,
    language,
    onChange,
    onSelectionChange,
    value,
  }: {
    ariaLabel: string;
    disabled?: boolean;
    language: string;
    onChange: (content: string) => void;
    onSelectionChange?: (selection: { start: number; end: number } | null) => void;
    value: string;
  }) => (
    <textarea
      aria-label={ariaLabel}
      data-language={language}
      data-testid="monaco-file-editor"
      disabled={disabled}
      onChange={(event) => onChange(event.currentTarget.value)}
      onSelect={(event) => {
        const target = event.currentTarget;
        if (target.selectionStart === target.selectionEnd) {
          onSelectionChange?.(null);
          return;
        }
        const start = Math.min(target.selectionStart, target.selectionEnd);
        const end = Math.max(target.selectionStart, target.selectionEnd);
        onSelectionChange?.({
          start: target.value.slice(0, start).split("\n").length - 1,
          end: target.value.slice(0, Math.max(start, end - 1)).split("\n").length - 1,
        });
      }}
      value={value}
    />
  ),
}));

afterEach(() => {
  cleanup();
});

describe("FilePreviewPopover", () => {
  it("renders selection hints for text previews", () => {
    render(
      <FilePreviewPopover
        path="src/example.ts"
        absolutePath="/workspace/src/example.ts"
        content={"one\ntwo"}
        truncated={false}
        previewKind="text"
        imageSrc={null}
        openTargets={[]}
        openAppIconById={{}}
        selectedOpenAppId=""
        onSelectOpenAppId={vi.fn()}
        selection={{ start: 0, end: 0 }}
        onSelectLine={vi.fn()}
        onClearSelection={vi.fn()}
        onAddSelection={vi.fn()}
        onClose={vi.fn()}
        selectionHints={["Shift + click or drag + click", "for multi-line selection"]}
      />,
    );

    expect(screen.getByText("Shift + click or drag + click")).toBeTruthy();
    expect(screen.getByText("for multi-line selection")).toBeTruthy();
  });

  it("wires drag selection mouse events to line handlers", () => {
    const onSelectLine = vi.fn();
    const onLineMouseDown = vi.fn();
    const onLineMouseEnter = vi.fn();
    const onLineMouseUp = vi.fn();

    render(
      <FilePreviewPopover
        path="src/example.ts"
        absolutePath="/workspace/src/example.ts"
        content={"one\ntwo"}
        truncated={false}
        previewKind="text"
        imageSrc={null}
        openTargets={[]}
        openAppIconById={{}}
        selectedOpenAppId=""
        onSelectOpenAppId={vi.fn()}
        selection={{ start: 0, end: 0 }}
        onSelectLine={onSelectLine}
        onLineMouseDown={onLineMouseDown}
        onLineMouseEnter={onLineMouseEnter}
        onLineMouseUp={onLineMouseUp}
        onClearSelection={vi.fn()}
        onAddSelection={vi.fn()}
        onClose={vi.fn()}
      />,
    );

    const firstLine = screen.getByText("one").closest("button");
    const secondLine = screen.getByText("two").closest("button");
    expect(firstLine).not.toBeNull();
    expect(secondLine).not.toBeNull();

    fireEvent.mouseDown(firstLine as HTMLButtonElement);
    fireEvent.mouseEnter(secondLine as HTMLButtonElement);
    fireEvent.mouseUp(secondLine as HTMLButtonElement);
    fireEvent.click(secondLine as HTMLButtonElement);

    expect(onLineMouseDown).toHaveBeenCalledWith(0, expect.any(Object));
    expect(onLineMouseEnter).toHaveBeenCalledWith(1, expect.any(Object));
    expect(onLineMouseUp).toHaveBeenCalledWith(1, expect.any(Object));
    expect(onSelectLine).toHaveBeenCalledWith(1, expect.any(Object));
  });

  it("disables add-to-chat when insertion is not allowed", () => {
    render(
      <FilePreviewPopover
        path="src/example.ts"
        absolutePath="/workspace/src/example.ts"
        content={"one\ntwo"}
        truncated={false}
        previewKind="text"
        imageSrc={null}
        openTargets={[]}
        openAppIconById={{}}
        selectedOpenAppId=""
        onSelectOpenAppId={vi.fn()}
        selection={{ start: 0, end: 0 }}
        onSelectLine={vi.fn()}
        onClearSelection={vi.fn()}
        onAddSelection={vi.fn()}
        onClose={vi.fn()}
        canInsertText={false}
      />,
    );

    const addButton = screen.getByRole("button", { name: "Add to chat" });
    expect(addButton.hasAttribute("disabled")).toBe(true);
  });

  it("opens text files as an editable modal and saves from the save button", async () => {
    const onSaveContent = vi.fn().mockResolvedValue(undefined);

    render(
      <FilePreviewPopover
        path="src/example.ts"
        absolutePath="/workspace/src/example.ts"
        content={"one\ntwo"}
        truncated={false}
        previewKind="text"
        imageSrc={null}
        openTargets={[]}
        openAppIconById={{}}
        selectedOpenAppId=""
        onSelectOpenAppId={vi.fn()}
        selection={null}
        onSelectLine={vi.fn()}
        onClearSelection={vi.fn()}
        onAddSelection={vi.fn()}
        onSaveContent={onSaveContent}
        onClose={vi.fn()}
        variant="modal"
      />,
    );

    const editor = screen.getByLabelText("File editor") as HTMLTextAreaElement;
    expect(editor.value).toBe("one\ntwo");

    fireEvent.change(editor, { target: { value: "one\nupdated" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => {
      expect(onSaveContent).toHaveBeenCalledWith("one\nupdated");
    });
  });

  it("passes the editable draft when adding a selection to chat", () => {
    const onAddSelection = vi.fn();

    render(
      <FilePreviewPopover
        path="src/example.ts"
        absolutePath="/workspace/src/example.ts"
        content={"one\ntwo"}
        truncated={false}
        previewKind="text"
        imageSrc={null}
        openTargets={[]}
        openAppIconById={{}}
        selectedOpenAppId=""
        onSelectOpenAppId={vi.fn()}
        selection={{ start: 1, end: 1 }}
        onSelectLine={vi.fn()}
        onClearSelection={vi.fn()}
        onAddSelection={onAddSelection}
        onSaveContent={vi.fn().mockResolvedValue(undefined)}
        onClose={vi.fn()}
        variant="modal"
      />,
    );

    fireEvent.change(screen.getByLabelText("File editor"), {
      target: { value: "one\nupdated" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Add to chat" }));

    expect(onAddSelection).toHaveBeenCalledWith("one\nupdated");
  });

  it("uses Monaco for editable text files instead of the textarea overlay", () => {
    render(
      <FilePreviewPopover
        path="src/example.ts"
        absolutePath="/workspace/src/example.ts"
        content={"one\ntwo"}
        truncated={false}
        previewKind="text"
        imageSrc={null}
        openTargets={[]}
        openAppIconById={{}}
        selectedOpenAppId=""
        onSelectOpenAppId={vi.fn()}
        selection={null}
        onSelectLine={vi.fn()}
        onClearSelection={vi.fn()}
        onAddSelection={vi.fn()}
        onSaveContent={vi.fn().mockResolvedValue(undefined)}
        onClose={vi.fn()}
        variant="modal"
      />,
    );

    expect(screen.getByTestId("monaco-file-editor")).toBeTruthy();
  });

  it("passes the matching Monaco language for editable code files", () => {
    render(
      <FilePreviewPopover
        path="index.html"
        absolutePath="/workspace/index.html"
        content={'<div class="hero">Hi</div>'}
        truncated={false}
        previewKind="text"
        imageSrc={null}
        openTargets={[]}
        openAppIconById={{}}
        selectedOpenAppId=""
        onSelectOpenAppId={vi.fn()}
        selection={null}
        onSelectLine={vi.fn()}
        onClearSelection={vi.fn()}
        onAddSelection={vi.fn()}
        onSaveContent={vi.fn().mockResolvedValue(undefined)}
        onClose={vi.fn()}
        variant="modal"
      />,
    );

    expect(screen.getByTestId("monaco-file-editor").getAttribute("data-language")).toBe(
      "html",
    );
  });

  it("renders editable html files in a sandboxed rendered preview", () => {
    render(
      <FilePreviewPopover
        path="index.html"
        absolutePath="/workspace/site/index.html"
        content={'<h1>Hello</h1><img src="assets/poster.png" />'}
        truncated={false}
        previewKind="text"
        imageSrc={null}
        openTargets={[]}
        openAppIconById={{}}
        selectedOpenAppId=""
        onSelectOpenAppId={vi.fn()}
        selection={null}
        onSelectLine={vi.fn()}
        onClearSelection={vi.fn()}
        onAddSelection={vi.fn()}
        onSaveContent={vi.fn().mockResolvedValue(undefined)}
        onClose={vi.fn()}
        variant="modal"
      />,
    );

    expect(screen.getByTestId("monaco-file-editor")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Preview" }));

    const frame = screen.getByTitle("Rendered preview") as HTMLIFrameElement;
    expect(frame.getAttribute("sandbox")).toBe("");
    expect(frame.srcdoc).toContain("<base href=\"asset:///workspace/site/\"");
    expect(frame.srcdoc).toContain("<h1>Hello</h1>");
    expect(screen.queryByTestId("monaco-file-editor")).toBeNull();
  });

  it("renders editable markdown files as markdown preview", () => {
    render(
      <FilePreviewPopover
        path="README.md"
        absolutePath="/workspace/README.md"
        content={"# Title\n\n- Item"}
        truncated={false}
        previewKind="text"
        imageSrc={null}
        openTargets={[]}
        openAppIconById={{}}
        selectedOpenAppId=""
        onSelectOpenAppId={vi.fn()}
        selection={null}
        onSelectLine={vi.fn()}
        onClearSelection={vi.fn()}
        onAddSelection={vi.fn()}
        onSaveContent={vi.fn().mockResolvedValue(undefined)}
        onClose={vi.fn()}
        variant="modal"
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Preview" }));

    expect(screen.getByRole("heading", { level: 1, name: "Title" })).toBeTruthy();
    expect(screen.getByText("Item")).toBeTruthy();
    expect(screen.queryByTestId("monaco-file-editor")).toBeNull();
  });

  it("does not show rendered preview mode for non-renderable code files", () => {
    render(
      <FilePreviewPopover
        path="src/example.ts"
        absolutePath="/workspace/src/example.ts"
        content={"const value = 1;"}
        truncated={false}
        previewKind="text"
        imageSrc={null}
        openTargets={[]}
        openAppIconById={{}}
        selectedOpenAppId=""
        onSelectOpenAppId={vi.fn()}
        selection={null}
        onSelectLine={vi.fn()}
        onClearSelection={vi.fn()}
        onAddSelection={vi.fn()}
        onSaveContent={vi.fn().mockResolvedValue(undefined)}
        onClose={vi.fn()}
        variant="modal"
      />,
    );

    expect(screen.queryByRole("button", { name: "Preview" })).toBeNull();
  });

  it("does not reset the editable draft when selection callback identity changes", () => {
    const props = {
      path: "src/example.ts",
      absolutePath: "/workspace/src/example.ts",
      content: "draft",
      truncated: false,
      previewKind: "text" as const,
      imageSrc: null,
      openTargets: [],
      openAppIconById: {},
      selectedOpenAppId: "",
      onSelectOpenAppId: vi.fn(),
      selection: null,
      onSelectLine: vi.fn(),
      onClearSelection: vi.fn(),
      onAddSelection: vi.fn(),
      onSaveContent: vi.fn().mockResolvedValue(undefined),
      onClose: vi.fn(),
      variant: "modal" as const,
    };

    const { rerender } = render(
      <FilePreviewPopover {...props} onTextSelectionChange={vi.fn()} />,
    );

    const editor = screen.getByLabelText("File editor") as HTMLTextAreaElement;
    fireEvent.change(editor, { target: { value: "edited draft" } });

    rerender(<FilePreviewPopover {...props} onTextSelectionChange={vi.fn()} />);

    expect((screen.getByLabelText("File editor") as HTMLTextAreaElement).value).toBe(
      "edited draft",
    );
  });

  it("saves editable modal changes with cmd+s and ctrl+s", async () => {
    const onSaveContent = vi.fn().mockResolvedValue(undefined);

    render(
      <FilePreviewPopover
        path="src/example.ts"
        absolutePath="/workspace/src/example.ts"
        content="draft"
        truncated={false}
        previewKind="text"
        imageSrc={null}
        openTargets={[]}
        openAppIconById={{}}
        selectedOpenAppId=""
        onSelectOpenAppId={vi.fn()}
        selection={null}
        onSelectLine={vi.fn()}
        onClearSelection={vi.fn()}
        onAddSelection={vi.fn()}
        onSaveContent={onSaveContent}
        onClose={vi.fn()}
        variant="modal"
      />,
    );

    const editor = screen.getByLabelText("File editor") as HTMLTextAreaElement;
    fireEvent.change(editor, { target: { value: "cmd save" } });
    fireEvent.keyDown(document, { key: "s", metaKey: true });

    await waitFor(() => {
      expect(onSaveContent).toHaveBeenCalledWith("cmd save");
    });

    fireEvent.change(editor, { target: { value: "ctrl save" } });
    fireEvent.keyDown(document, { key: "s", ctrlKey: true });

    await waitFor(() => {
      expect(onSaveContent).toHaveBeenCalledWith("ctrl save");
    });
  });

  it("prompts before closing an editable modal with unsaved changes", () => {
    const onClose = vi.fn();

    render(
      <FilePreviewPopover
        path="src/example.ts"
        absolutePath="/workspace/src/example.ts"
        content="draft"
        truncated={false}
        previewKind="text"
        imageSrc={null}
        openTargets={[]}
        openAppIconById={{}}
        selectedOpenAppId=""
        onSelectOpenAppId={vi.fn()}
        selection={null}
        onSelectLine={vi.fn()}
        onClearSelection={vi.fn()}
        onAddSelection={vi.fn()}
        onSaveContent={vi.fn().mockResolvedValue(undefined)}
        onClose={onClose}
        variant="modal"
      />,
    );

    fireEvent.change(screen.getByLabelText("File editor"), {
      target: { value: "changed" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Close preview" }));

    expect(screen.getByText("Save changes before closing?")).toBeTruthy();
    expect(onClose).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "Keep editing" }));
    expect(screen.queryByText("Save changes before closing?")).toBeNull();
    expect(onClose).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "Close preview" }));
    fireEvent.click(screen.getByRole("button", { name: "Discard" }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
