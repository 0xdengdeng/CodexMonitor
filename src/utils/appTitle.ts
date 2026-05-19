import { getCurrentWindow } from "@tauri-apps/api/window";

const APP_TITLE = "启航AI智慧平台";

export function getAppDocumentTitle(isDev: boolean): string {
  return isDev ? `${APP_TITLE} Dev` : APP_TITLE;
}

export function applyAppDocumentTitle(isDev: boolean): void {
  if (typeof document === "undefined") {
    return;
  }
  document.title = getAppDocumentTitle(isDev);
}

export async function applyAppWindowTitle(isDev: boolean): Promise<void> {
  try {
    await getCurrentWindow().setTitle(getAppDocumentTitle(isDev));
  } catch {
    // Browser-only test and preview contexts do not expose a Tauri window.
  }
}
