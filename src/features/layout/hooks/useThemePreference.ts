import { useEffect } from "react";
import type { ThemePreference } from "../../../types";

const THEME_SWITCHING_ATTR = "data-theme-switching";
const THEME_SWITCHING_DURATION_MS = 120;

export function useThemePreference(theme: ThemePreference) {
  useEffect(() => {
    const root = document.documentElement;
    root.setAttribute(THEME_SWITCHING_ATTR, "true");
    if (theme === "system") {
      delete root.dataset.theme;
    } else {
      root.dataset.theme = theme;
    }

    const timeout = window.setTimeout(() => {
      root.removeAttribute(THEME_SWITCHING_ATTR);
    }, THEME_SWITCHING_DURATION_MS);
    return () => {
      window.clearTimeout(timeout);
    };
  }, [theme]);
}
