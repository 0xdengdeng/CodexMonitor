import React from "react";
import ReactDOM from "react-dom/client";
import * as Sentry from "@sentry/react";
import App from "./App";
import { applyAppDocumentTitle, applyAppWindowTitle } from "./utils/appTitle";
import { isMobilePlatform } from "./utils/platformPaths";

const sentryDsn =
  import.meta.env.VITE_SENTRY_DSN ??
  "https://8ab67175daed999e8c432a93d8f98e49@o4510750015094784.ingest.us.sentry.io/4510750016012288";

Sentry.init({
  dsn: sentryDsn,
  enabled: Boolean(sentryDsn),
  release: __APP_VERSION__,
});

applyAppDocumentTitle(__APP_IS_DEV_BUILD__);
void applyAppWindowTitle(__APP_IS_DEV_BUILD__);

Sentry.metrics.count("app_open", 1, {
  attributes: {
    env: import.meta.env.MODE,
    platform: "macos",
  },
});

function disableMobileZoomGestures() {
  if (!isMobilePlatform() || typeof document === "undefined") {
    return;
  }
  const preventGesture = (event: Event) => event.preventDefault();
  const preventPinch = (event: TouchEvent) => {
    if (event.touches.length > 1) {
      event.preventDefault();
    }
  };

  document.addEventListener("gesturestart", preventGesture, { passive: false });
  document.addEventListener("gesturechange", preventGesture, { passive: false });
  document.addEventListener("gestureend", preventGesture, { passive: false });
  document.addEventListener("touchmove", preventPinch, { passive: false });
}

function syncMobileViewportHeight() {
  if (!isMobilePlatform() || typeof window === "undefined" || typeof document === "undefined") {
    return;
  }

  let rafHandle = 0;

  const setViewportHeight = () => {
    const visualViewport = window.visualViewport;
    const viewportHeight = visualViewport
      ? visualViewport.height + visualViewport.offsetTop
      : window.innerHeight;
    const nextHeight = Math.round(viewportHeight);
    document.documentElement.style.setProperty("--app-height", `${nextHeight}px`);
  };

  const scheduleViewportHeight = () => {
    if (rafHandle) {
      return;
    }
    rafHandle = window.requestAnimationFrame(() => {
      rafHandle = 0;
      setViewportHeight();
    });
  };

  const setComposerFocusState = () => {
    const activeElement = document.activeElement;
    const isComposerTextareaFocused =
      activeElement instanceof HTMLTextAreaElement &&
      activeElement.closest(".composer") !== null;
    document.documentElement.dataset.mobileComposerFocus = isComposerTextareaFocused
      ? "true"
      : "false";
  };

  setViewportHeight();
  setComposerFocusState();
  window.addEventListener("resize", scheduleViewportHeight, { passive: true });
  window.addEventListener("orientationchange", scheduleViewportHeight, { passive: true });
  window.visualViewport?.addEventListener("resize", scheduleViewportHeight, { passive: true });
  window.visualViewport?.addEventListener("scroll", scheduleViewportHeight, { passive: true });
  document.addEventListener("focusin", setComposerFocusState);
  document.addEventListener("focusout", () => {
    requestAnimationFrame(setComposerFocusState);
  });
}

disableMobileZoomGestures();
syncMobileViewportHeight();

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <Sentry.ErrorBoundary
      fallback={({ error }) => (
        // Inline styles on purpose: a render crash may be the stylesheet itself,
        // so the fallback must not depend on app CSS having loaded.
        <div
          role="alert"
          style={{
            padding: "24px",
            maxWidth: "560px",
            margin: "48px auto",
            fontFamily: "system-ui, sans-serif",
            lineHeight: 1.5,
          }}
        >
          <h1 style={{ fontSize: "18px", margin: "0 0 8px" }}>启航AI 遇到问题</h1>
          <p style={{ margin: "0 0 12px" }}>
            界面发生了无法恢复的错误，已记录。请重启应用；如反复出现，请反馈日志。
          </p>
          <pre style={{ whiteSpace: "pre-wrap", opacity: 0.7, fontSize: "12px" }}>
            {error instanceof Error ? error.message : String(error)}
          </pre>
        </div>
      )}
    >
      <App />
    </Sentry.ErrorBoundary>
  </React.StrictMode>,
);
