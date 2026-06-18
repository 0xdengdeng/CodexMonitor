import { readAppLogTail } from "@services/tauri";

/**
 * Gather a human-pasteable diagnostics blob: app/platform/time, the error (if
 * any), and the tail of the app log. A normal user can't find the log file, so
 * on error we hand them everything to paste back in one copy.
 */
export async function collectDiagnostics(error?: unknown): Promise<string> {
  const lines: string[] = [
    `AgentDesk ${typeof __APP_VERSION__ === "string" ? __APP_VERSION__ : "?"}`,
    `Time: ${new Date().toISOString()}`,
    `UA: ${typeof navigator !== "undefined" ? navigator.userAgent : "?"}`,
  ];

  if (error) {
    const normalized = error instanceof Error ? error : new Error(String(error));
    lines.push("", `Error: ${normalized.message}`);
    if (normalized.stack) {
      lines.push(normalized.stack);
    }
  }

  let logTail: string;
  try {
    logTail = await readAppLogTail(20000);
  } catch (err) {
    logTail = `(could not read app log: ${err instanceof Error ? err.message : String(err)})`;
  }
  lines.push("", "--- recent logs ---", logTail.trimEnd());

  return lines.join("\n");
}

/**
 * Copy diagnostics to the clipboard. Returns the blob on success (so a caller
 * can fall back to showing it for manual selection) or throws if clipboard write
 * fails.
 */
export async function copyDiagnostics(error?: unknown): Promise<string> {
  const text = await collectDiagnostics(error);
  await navigator.clipboard.writeText(text);
  return text;
}
