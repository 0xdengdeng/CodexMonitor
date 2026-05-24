type MonacoModule = typeof import("monaco-editor");
type MonacoWorkerModule = { default: new () => Worker };

let monacoPromise: Promise<MonacoModule> | null = null;
let themesRegistered = false;

function registerThemes(monaco: MonacoModule) {
  if (themesRegistered) {
    return;
  }
  themesRegistered = true;

  monaco.editor.defineTheme("codex-file-light", {
    base: "vs",
    inherit: true,
    rules: [
      { token: "comment", foreground: "8a96a8" },
      { token: "tag", foreground: "c43b45" },
      { token: "attribute.name", foreground: "7b4bb3" },
      { token: "attribute.value", foreground: "1f7a3f" },
      { token: "string", foreground: "1f7a3f" },
      { token: "keyword", foreground: "0969da" },
      { token: "number", foreground: "9a6700" },
      { token: "type", foreground: "8250df" },
      { token: "function", foreground: "8250df" },
    ],
    colors: {
      "editor.background": "#ffffff",
      "editor.foreground": "#59636e",
      "editorLineNumber.foreground": "#b6c0ce",
      "editorLineNumber.activeForeground": "#6b7280",
      "editor.selectionBackground": "#cfe0ff",
      "editor.inactiveSelectionBackground": "#e5edff",
      "editor.lineHighlightBackground": "#f5f7fb",
      "editorCursor.foreground": "#111827",
    },
  });

  monaco.editor.defineTheme("codex-file-dark", {
    base: "vs-dark",
    inherit: true,
    rules: [
      { token: "comment", foreground: "96aac8" },
      { token: "tag", foreground: "ff7b72" },
      { token: "attribute.name", foreground: "d2a8ff" },
      { token: "attribute.value", foreground: "7ee787" },
      { token: "string", foreground: "7ee787" },
      { token: "keyword", foreground: "8bd5ff" },
      { token: "number", foreground: "f2cc60" },
      { token: "type", foreground: "d2a8ff" },
      { token: "function", foreground: "d2a8ff" },
    ],
    colors: {
      "editor.background": "#0c121d",
      "editor.foreground": "#c9d1d9",
      "editorLineNumber.foreground": "#5f6f86",
      "editorLineNumber.activeForeground": "#c9d1d9",
      "editor.selectionBackground": "#264f78",
      "editor.inactiveSelectionBackground": "#1e334d",
      "editor.lineHighlightBackground": "#111a29",
      "editorCursor.foreground": "#f8fafc",
    },
  });
}

export function monacoThemeForCurrentDocument() {
  const explicitTheme = document.documentElement.dataset.theme;
  if (explicitTheme === "dark" || explicitTheme === "dim") {
    return "codex-file-dark";
  }
  if (explicitTheme === "light") {
    return "codex-file-light";
  }
  return window.matchMedia?.("(prefers-color-scheme: dark)").matches
    ? "codex-file-dark"
    : "codex-file-light";
}

export async function loadMonacoEditor() {
  if (!monacoPromise) {
    monacoPromise = (async () => {
      const [
        editorWorker,
        jsonWorker,
        cssWorker,
        htmlWorker,
        tsWorker,
      ] = await Promise.all([
        import("monaco-editor/esm/vs/editor/editor.worker?worker"),
        import("monaco-editor/esm/vs/language/json/json.worker?worker"),
        import("monaco-editor/esm/vs/language/css/css.worker?worker"),
        import("monaco-editor/esm/vs/language/html/html.worker?worker"),
        import("monaco-editor/esm/vs/language/typescript/ts.worker?worker"),
      ]) as [
        MonacoWorkerModule,
        MonacoWorkerModule,
        MonacoWorkerModule,
        MonacoWorkerModule,
        MonacoWorkerModule,
      ];

      globalThis.MonacoEnvironment = {
        getWorker(_workerId: string, label: string) {
          if (label === "json") {
            return new jsonWorker.default();
          }
          if (label === "css" || label === "scss" || label === "less") {
            return new cssWorker.default();
          }
          if (label === "html" || label === "handlebars" || label === "razor") {
            return new htmlWorker.default();
          }
          if (label === "typescript" || label === "javascript") {
            return new tsWorker.default();
          }
          return new editorWorker.default();
        },
      };

      const monaco = await import("monaco-editor/esm/vs/editor/editor.api.js");
      await Promise.all([
        import("monaco-editor/esm/vs/language/css/monaco.contribution.js"),
        import("monaco-editor/esm/vs/language/html/monaco.contribution.js"),
        import("monaco-editor/esm/vs/language/json/monaco.contribution.js"),
        import("monaco-editor/esm/vs/language/typescript/monaco.contribution.js"),
        import("monaco-editor/esm/vs/basic-languages/cpp/cpp.contribution.js"),
        import("monaco-editor/esm/vs/basic-languages/go/go.contribution.js"),
        import("monaco-editor/esm/vs/basic-languages/java/java.contribution.js"),
        import("monaco-editor/esm/vs/basic-languages/kotlin/kotlin.contribution.js"),
        import("monaco-editor/esm/vs/basic-languages/markdown/markdown.contribution.js"),
        import("monaco-editor/esm/vs/basic-languages/python/python.contribution.js"),
        import("monaco-editor/esm/vs/basic-languages/ruby/ruby.contribution.js"),
        import("monaco-editor/esm/vs/basic-languages/rust/rust.contribution.js"),
        import("monaco-editor/esm/vs/basic-languages/shell/shell.contribution.js"),
        import("monaco-editor/esm/vs/basic-languages/swift/swift.contribution.js"),
        import("monaco-editor/esm/vs/basic-languages/yaml/yaml.contribution.js"),
      ]);
      registerThemes(monaco);
      return monaco;
    })();
  }
  return monacoPromise;
}
