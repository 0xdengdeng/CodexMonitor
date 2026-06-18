import { readAppLogTail, readDaemonLogTail } from "@services/tauri";

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

  if (error instanceof Error) {
    lines.push("", `Error: ${error.message}`);
    if (error.stack) {
      lines.push(error.stack);
    }
  } else if (error !== undefined && error !== null && error !== "") {
    // A plain string/value (e.g. a toast's title+message): include the text, but
    // no synthetic stack — it would only point back here, not at the real cause.
    lines.push("", `Error: ${String(error)}`);
  }

  let appLog: string;
  try {
    appLog = (await readAppLogTail(20000)).trimEnd();
  } catch (err) {
    appLog = `(could not read app log: ${err instanceof Error ? err.message : String(err)})`;
  }
  lines.push("", "--- recent app logs ---", appLog);

  // The daemon log only exists in remote/headless mode; a read failure there
  // usually just means it was never started, so note it briefly rather than fail.
  let daemonLog: string;
  try {
    daemonLog = (await readDaemonLogTail(20000)).trimEnd();
  } catch {
    daemonLog = "(no daemon log — remote/headless mode not in use)";
  }
  lines.push("", "--- recent daemon logs ---", daemonLog);

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
