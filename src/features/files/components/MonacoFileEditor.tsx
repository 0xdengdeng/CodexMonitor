import { useEffect, useRef } from "react";
import type * as Monaco from "monaco-editor";
import { loadMonacoEditor, monacoThemeForCurrentDocument } from "./monacoRuntime";

type MonacoRuntime = typeof import("monaco-editor");

export type MonacoFileEditorSelection = { start: number; end: number };

type MonacoFileEditorProps = {
  ariaLabel: string;
  disabled?: boolean;
  language: string;
  onChange: (content: string) => void;
  onSave: () => void;
  onSelectionChange?: (selection: MonacoFileEditorSelection | null) => void;
  path: string;
  value: string;
};

function normalizeEditorLineHeight(lineHeight: string, fontSize: number) {
  const parsedLineHeight = Number.parseFloat(lineHeight);
  if (!Number.isFinite(parsedLineHeight)) {
    return Math.round(fontSize * 1.28);
  }
  if (lineHeight.trim().endsWith("px")) {
    return Math.round(parsedLineHeight);
  }
  if (lineHeight.trim().endsWith("%")) {
    return Math.round(fontSize * (parsedLineHeight / 100));
  }
  if (parsedLineHeight > 4) {
    return Math.round(parsedLineHeight);
  }
  return Math.round(fontSize * parsedLineHeight);
}

function readEditorFont(container: HTMLElement) {
  const styles = window.getComputedStyle(container);
  const fontSize = Number.parseFloat(styles.fontSize);
  const normalizedFontSize = Number.isFinite(fontSize) ? fontSize : 12;
  return {
    fontFamily: styles.fontFamily || 'ui-monospace, Menlo, Monaco, "Courier New", monospace',
    fontSize: normalizedFontSize,
    fontWeight: styles.fontWeight || "400",
    lineHeight: normalizeEditorLineHeight(styles.lineHeight, normalizedFontSize),
  };
}

export function MonacoFileEditor({
  ariaLabel,
  disabled = false,
  language,
  onChange,
  onSave,
  onSelectionChange,
  path,
  value,
}: MonacoFileEditorProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const editorRef = useRef<Monaco.editor.IStandaloneCodeEditor | null>(null);
  const modelRef = useRef<Monaco.editor.ITextModel | null>(null);
  const monacoRef = useRef<MonacoRuntime | null>(null);
  const onChangeRef = useRef(onChange);
  const onSaveRef = useRef(onSave);
  const onSelectionChangeRef = useRef(onSelectionChange);
  const disabledRef = useRef(disabled);
  const languageRef = useRef(language);
  const valueRef = useRef(value);

  useEffect(() => {
    onChangeRef.current = onChange;
  }, [onChange]);

  useEffect(() => {
    onSaveRef.current = onSave;
  }, [onSave]);

  useEffect(() => {
    onSelectionChangeRef.current = onSelectionChange;
  }, [onSelectionChange]);

  useEffect(() => {
    disabledRef.current = disabled;
  }, [disabled]);

  useEffect(() => {
    languageRef.current = language;
  }, [language]);

  useEffect(() => {
    valueRef.current = value;
  }, [value]);

  useEffect(() => {
    let cancelled = false;
    let subscriptions: Array<{ dispose: () => void }> = [];

    void loadMonacoEditor().then((monaco) => {
      if (cancelled || !containerRef.current) {
        return;
      }
      monacoRef.current = monaco;
      const { fontFamily, fontSize, fontWeight, lineHeight } = readEditorFont(
        containerRef.current,
      );
      const model = monaco.editor.createModel(valueRef.current, languageRef.current);
      const editor = monaco.editor.create(containerRef.current, {
        automaticLayout: true,
        contextmenu: true,
        domReadOnly: disabledRef.current,
        fixedOverflowWidgets: true,
        fontFamily,
        fontWeight,
        fontLigatures: false,
        fontSize,
        glyphMargin: false,
        lineDecorationsWidth: 10,
        lineHeight,
        lineNumbers: "on",
        lineNumbersMinChars: 3,
        minimap: { enabled: false },
        model,
        padding: { top: 8, bottom: 8 },
        readOnly: disabledRef.current,
        renderLineHighlight: "line",
        roundedSelection: false,
        scrollBeyondLastLine: false,
        scrollbar: {
          alwaysConsumeMouseWheel: false,
          horizontalScrollbarSize: 10,
          verticalScrollbarSize: 10,
        },
        theme: monacoThemeForCurrentDocument(),
        wordWrap: "off",
      });

      editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS, () => {
        onSaveRef.current();
      });
      subscriptions = [
        model.onDidChangeContent(() => {
          onChangeRef.current(model.getValue());
        }),
        editor.onDidChangeCursorSelection((event: Monaco.editor.ICursorSelectionChangedEvent) => {
          const selection = event.selection;
          if (selection.isEmpty()) {
            onSelectionChangeRef.current?.(null);
            return;
          }
          const start = Math.min(selection.startLineNumber, selection.endLineNumber) - 1;
          const end = Math.max(selection.startLineNumber, selection.endLineNumber) - 1;
          onSelectionChangeRef.current?.({ start, end });
        }),
      ];
      editorRef.current = editor;
      modelRef.current = model;
      requestAnimationFrame(() => editor.layout());
    });

    return () => {
      cancelled = true;
      subscriptions.forEach((subscription) => subscription.dispose());
      editorRef.current?.dispose();
      modelRef.current?.dispose();
      editorRef.current = null;
      modelRef.current = null;
      monacoRef.current = null;
    };
  }, []);

  useEffect(() => {
    const editor = editorRef.current;
    const monaco = monacoRef.current;
    if (!editor || !monaco) {
      return undefined;
    }

    const applyTheme = () => {
      monaco.editor.setTheme(monacoThemeForCurrentDocument());
    };
    applyTheme();
    const observer = new MutationObserver(applyTheme);
    observer.observe(document.documentElement, {
      attributeFilter: ["data-theme"],
      attributes: true,
    });
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const model = modelRef.current;
    if (!model || model.getValue() === value) {
      return;
    }
    model.setValue(value);
  }, [value]);

  useEffect(() => {
    editorRef.current?.updateOptions({
      domReadOnly: disabled,
      readOnly: disabled,
    });
  }, [disabled]);

  useEffect(() => {
    const monaco = monacoRef.current;
    const model = modelRef.current;
    if (!monaco || !model) {
      return;
    }
    monaco.editor.setModelLanguage(model, language);
  }, [language, path]);

  return (
    <div
      ref={containerRef}
      aria-label={ariaLabel}
      className="file-preview-monaco"
      data-testid="monaco-file-editor"
      data-language={language}
      role="textbox"
    />
  );
}
