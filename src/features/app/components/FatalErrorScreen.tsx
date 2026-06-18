import { useState } from "react";

import { collectDiagnostics, copyDiagnostics } from "@services/diagnostics";

// Inline styles on purpose: a render crash may be the stylesheet itself, so this
// recovery screen must not depend on app CSS having loaded.
const container: React.CSSProperties = {
  padding: "24px",
  maxWidth: "560px",
  margin: "48px auto",
  fontFamily: "system-ui, sans-serif",
  lineHeight: 1.5,
};

const button: React.CSSProperties = {
  marginTop: "12px",
  padding: "8px 14px",
  fontSize: "13px",
  cursor: "pointer",
};

const code: React.CSSProperties = {
  whiteSpace: "pre-wrap",
  opacity: 0.7,
  fontSize: "12px",
};

/**
 * Fatal-error recovery screen shown by the top-level Sentry.ErrorBoundary. A
 * normal user can't find the log file, so the primary action is "copy
 * diagnostics" (error + recent logs) for them to paste back; if the clipboard is
 * blocked, fall back to a selectable textarea.
 */
export function FatalErrorScreen({ error }: { error: unknown }) {
  const [status, setStatus] = useState<"idle" | "copied" | "manual">("idle");
  const [manualText, setManualText] = useState("");

  const message = error instanceof Error ? error.message : String(error);

  const handleCopy = async () => {
    try {
      await copyDiagnostics(error);
      setStatus("copied");
    } catch {
      const text = await collectDiagnostics(error);
      setManualText(text);
      setStatus("manual");
    }
  };

  return (
    <div role="alert" style={container}>
      <h1 style={{ fontSize: "18px", margin: "0 0 8px" }}>启航AI 遇到问题</h1>
      <p style={{ margin: "0 0 12px" }}>
        界面发生了无法恢复的错误，已记录。请重启应用；如反复出现，点下面复制诊断信息发给我们。
      </p>
      <pre style={code}>{message}</pre>
      <button type="button" style={button} onClick={handleCopy}>
        {status === "copied" ? "已复制 ✓" : "复制诊断信息"}
      </button>
      {status === "manual" && (
        <>
          <p style={{ margin: "12px 0 4px", fontSize: "12px" }}>
            无法自动复制，请全选下面内容手动复制：
          </p>
          <textarea
            readOnly
            value={manualText}
            onFocus={(event) => event.currentTarget.select()}
            style={{ width: "100%", height: "160px", fontSize: "11px", fontFamily: "monospace" }}
          />
        </>
      )}
    </div>
  );
}
