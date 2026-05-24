/** @vitest-environment jsdom */
import { act, cleanup, render, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MonacoFileEditor } from "./MonacoFileEditor";

const monacoMocks = vi.hoisted(() => {
  const createEditor = vi.fn((_container: HTMLElement, _options: Record<string, unknown>) => editor);
  const createModel = vi.fn((_value: string, _language: string) => model);
  const model = {
    dispose: vi.fn(),
    getValue: vi.fn(() => "content"),
    onDidChangeContent: vi.fn(() => ({ dispose: vi.fn() })),
    setValue: vi.fn(),
  };
  const editor = {
    addCommand: vi.fn(),
    dispose: vi.fn(),
    layout: vi.fn(),
    onDidChangeCursorSelection: vi.fn(() => ({ dispose: vi.fn() })),
    updateOptions: vi.fn(),
  };
  const runtime = {
    KeyCode: { KeyS: 49 },
    KeyMod: { CtrlCmd: 2048 },
    editor: {
      create: createEditor,
      createModel,
      setModelLanguage: vi.fn(),
      setTheme: vi.fn(),
    },
  };
  let resolveDeferredLoad: ((value: typeof runtime) => void) | null = null;
  const loadMonacoEditor = vi.fn(async () => runtime);
  return {
    createEditor,
    createModel,
    deferNextLoad: () => {
      loadMonacoEditor.mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            resolveDeferredLoad = resolve;
          }),
      );
    },
    editor,
    loadMonacoEditor,
    model,
    resolveDeferredLoad: () => {
      if (!resolveDeferredLoad) {
        throw new Error("No deferred Monaco load is pending");
      }
      resolveDeferredLoad(runtime);
      resolveDeferredLoad = null;
    },
  };
});

vi.mock("./monacoRuntime", () => ({
  loadMonacoEditor: monacoMocks.loadMonacoEditor,
  monacoThemeForCurrentDocument: vi.fn(() => "codex-file-light"),
}));

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  document.head.innerHTML = "";
});

describe("MonacoFileEditor", () => {
  it("normalizes the app code font tokens before creating Monaco", async () => {
    const style = document.createElement("style");
    style.textContent = `
      .file-preview-monaco {
        font-family: "Cascadia Mono", Menlo, monospace;
        font-size: 11px;
        font-weight: 400;
        line-height: 1.28;
      }
    `;
    document.head.append(style);

    render(
      <MonacoFileEditor
        ariaLabel="File editor"
        language="typescript"
        onChange={vi.fn()}
        onSave={vi.fn()}
        path="src/example.ts"
        value="content"
      />,
    );

    await waitFor(() => {
      expect(monacoMocks.createEditor).toHaveBeenCalled();
    });

    const options = monacoMocks.createEditor.mock.calls[0]?.[1];
    expect(options?.fontFamily).toContain("Cascadia Mono");
    expect(options?.fontSize).toBe(11);
    expect(options?.fontWeight).toBe("400");
    expect(options?.lineHeight).toBe(14);
  });

  it("uses the latest value when Monaco finishes loading after content arrives", async () => {
    monacoMocks.deferNextLoad();

    const { rerender } = render(
      <MonacoFileEditor
        ariaLabel="File editor"
        language="typescript"
        onChange={vi.fn()}
        onSave={vi.fn()}
        path="src/example.ts"
        value=""
      />,
    );

    rerender(
      <MonacoFileEditor
        ariaLabel="File editor"
        language="typescript"
        onChange={vi.fn()}
        onSave={vi.fn()}
        path="src/example.ts"
        value="loaded content"
      />,
    );

    await act(async () => {
      monacoMocks.resolveDeferredLoad();
    });

    await waitFor(() => {
      expect(monacoMocks.createModel).toHaveBeenCalled();
    });

    expect(monacoMocks.createModel).toHaveBeenCalledWith(
      "loaded content",
      "typescript",
    );
  });
});
