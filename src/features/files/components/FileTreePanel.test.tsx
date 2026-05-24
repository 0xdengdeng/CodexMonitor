/** @vitest-environment jsdom */
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { FileTreePanel } from "./FileTreePanel";

vi.mock("@tanstack/react-virtual", () => ({
  useVirtualizer: ({ count }: { count: number }) => ({
    getTotalSize: () => count * 28,
    getVirtualItems: () =>
      Array.from({ length: count }, (_, index) => ({
        index,
        key: index,
        start: index * 28,
      })),
    measureElement: vi.fn(),
  }),
}));

vi.mock("./MonacoFileEditor", () => ({
  MonacoFileEditor: ({
    ariaLabel,
    disabled,
    onChange,
    onSelectionChange,
    value,
  }: {
    ariaLabel: string;
    disabled?: boolean;
    onChange: (content: string) => void;
    onSelectionChange?: (selection: { start: number; end: number } | null) => void;
    value: string;
  }) => (
    <textarea
      aria-label={ariaLabel}
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

vi.mock("@tauri-apps/api/menu", () => ({
  Menu: { new: vi.fn() },
  MenuItem: { new: vi.fn() },
}));

vi.mock("@tauri-apps/api/window", () => ({
  getCurrentWindow: vi.fn(),
}));

vi.mock("@tauri-apps/api/core", () => ({
  convertFileSrc: vi.fn((path: string) => path),
}));

vi.mock("@tauri-apps/plugin-opener", () => ({
  revealItemInDir: vi.fn(),
}));

vi.mock("../../../services/tauri", () => ({
  readWorkspaceFile: vi.fn(),
  writeWorkspaceFile: vi.fn(),
}));

import { readWorkspaceFile, writeWorkspaceFile } from "../../../services/tauri";

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

const baseProps = {
  workspaceId: "workspace-1",
  workspacePath: "/tmp/workspace",
  files: ["src/App.tsx", "README.md"],
  modifiedFiles: [],
  isLoading: false,
  filePanelMode: "files" as const,
  onFilePanelModeChange: vi.fn(),
  canInsertText: true,
  openTargets: [],
  openAppIconById: {},
  selectedOpenAppId: "",
  onSelectOpenAppId: vi.fn(),
};

describe("FileTreePanel", () => {
  it("calls the refresh handler from the toolbar button", () => {
    const onRefreshFiles = vi.fn();

    render(<FileTreePanel {...baseProps} onRefreshFiles={onRefreshFiles} />);

    fireEvent.click(screen.getByRole("button", { name: "Refresh files" }));

    expect(onRefreshFiles).toHaveBeenCalledTimes(1);
  });

  it("opens a file in an editable modal and saves changes through the workspace writer", async () => {
    const onRefreshFiles = vi.fn().mockResolvedValue(undefined);
    vi.mocked(readWorkspaceFile)
      .mockResolvedValueOnce({
        content: "hello\nworld",
        truncated: false,
        revision: "sha256:before",
      })
      .mockResolvedValueOnce({
        content: "hello\nupdated",
        truncated: false,
        revision: "sha256:after",
      });
    vi.mocked(writeWorkspaceFile).mockResolvedValueOnce(undefined);

    render(<FileTreePanel {...baseProps} onRefreshFiles={onRefreshFiles} />);

    fireEvent.click(screen.getByText("README.md"));

    const editor = await screen.findByLabelText("File editor");
    fireEvent.change(editor, { target: { value: "hello\nupdated" } });
    const saveButton = screen.getByRole("button", { name: "Save" }) as HTMLButtonElement;
    await waitFor(() => {
      expect(saveButton.disabled).toBe(false);
    });
    fireEvent.click(saveButton);

    await waitFor(() => {
      expect(writeWorkspaceFile).toHaveBeenCalledWith(
        "workspace-1",
        "README.md",
        "hello\nupdated",
        "sha256:before",
      );
      expect(onRefreshFiles).toHaveBeenCalledTimes(1);
    });
  });

  it("opens a requested workspace file from outside the panel", async () => {
    const onRefreshFiles = vi.fn().mockResolvedValue(undefined);
    vi.mocked(readWorkspaceFile).mockResolvedValueOnce({
      content: "export function App() {}",
      truncated: false,
      revision: "sha256:app",
    });

    render(
      <FileTreePanel
        {...baseProps}
        onRefreshFiles={onRefreshFiles}
        openFileRequest={{ id: 1, path: "src/App.tsx" }}
      />,
    );

    const editor = (await screen.findByLabelText("File editor")) as HTMLTextAreaElement;
    await waitFor(() => {
      expect(editor.value).toBe("export function App() {}");
    });
    expect(readWorkspaceFile).toHaveBeenCalledWith("workspace-1", "src/App.tsx");
    expect(screen.getByText("App.tsx")).toBeTruthy();
  });

  it("adds selected unsaved editor content to chat", async () => {
    const onRefreshFiles = vi.fn().mockResolvedValue(undefined);
    const onInsertText = vi.fn();
    vi.mocked(readWorkspaceFile).mockResolvedValueOnce({
      content: "first\nsecond",
      truncated: false,
      revision: "sha256:chat",
    });

    render(
      <FileTreePanel
        {...baseProps}
        onInsertText={onInsertText}
        onRefreshFiles={onRefreshFiles}
      />,
    );

    fireEvent.click(screen.getByText("README.md"));

    const editor = (await screen.findByLabelText("File editor")) as HTMLTextAreaElement;
    fireEvent.change(editor, { target: { value: "first\nupdated" } });
    editor.setSelectionRange("first\n".length, "first\nupdated".length);
    fireEvent.select(editor);
    fireEvent.click(screen.getByRole("button", { name: "Add to chat" }));

    expect(onInsertText).toHaveBeenCalledWith(
      "README.md:L2\n```markdown\nupdated\n```",
    );
  });
});
